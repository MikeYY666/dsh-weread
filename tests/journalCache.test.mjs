/** Persistent journal cache behavior, using fake upstream, storage and clock. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createJournalCache, createJournalFileStorage, journalAccount, JOURNAL_TTL, JOURNAL_RETRY } from '../lib/host/store/journalCache.js'
import { createRouter } from '../lib/host/routes.js'
import { createCache } from '../lib/host/store/cache.js'

const note = (id = 'a') => ({ id, kind: 'highlight', bookId: id, bookTitle: 'Book', author: '', cover: '', chapterTitle: '', text: id, createTime: 1_700_000_000_000 })
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }
function setup(overrides = {}) {
  let time = 1_800_000_000_000
  const disk = new Map()
  const calls = { books: 0, pages: 0 }
  const deps = {
    now: () => time,
    storage: { load: async (key) => structuredClone(disk.get(key)), save: async (key, value) => { disk.set(key, structuredClone(value)) } },
    fetchBooks: async () => { calls.books++; return [{ bookId: 'a' }] },
    fetchPage: async () => { calls.pages++; return { notes: [note()], totalBooks: 1, scannedBooks: 1, failedBooks: 0, nextCursor: null } },
    ...overrides,
  }
  return { cache: createJournalCache(deps), deps, calls, disk, advance: (ms) => { time += ms } }
}

test('first GET returns quickly, concurrent GET/POST singleflight, repeated fresh GET never calls upstream', async () => {
  const gate = deferred()
  let books = 0
  const run = setup({ fetchBooks: async () => { books++; await gate.promise; return [{ bookId: 'a' }] } })
  const first = await run.cache.get('secret')
  assert.equal(first.syncing, true)
  assert.equal(first.hasCache, false)
  const all = await Promise.all(Array.from({ length: 20 }, (_, i) => run.cache.get('secret', i % 2 === 0)))
  assert.ok(all.every((state) => state.syncing))
  assert.equal(books, 1)
  gate.resolve()
  await run.cache.settled('secret')
  const result = await run.cache.get('secret')
  assert.equal(result.hasCache, true)
  assert.equal(result.syncing, false)
  assert.equal(result.notes.length, 1)
  await Promise.all(Array.from({ length: 20 }, () => run.cache.get('secret')))
  assert.equal(books, 1)
  assert.equal(run.calls.pages, 1)
})

test('a fresh persisted complete cache survives controller/process restart without upstream', async () => {
  const run = setup()
  await run.cache.get('key')
  await run.cache.settled('key')
  const restarted = createJournalCache(run.deps)
  assert.equal((await restarted.get('key')).notes[0].id, 'a')
  await restarted.settled('key')
  assert.deepEqual(run.calls, { books: 1, pages: 1 })
})

test('24h boundary refresh retains old notes and timestamp until the new sync completes', async () => {
  const run = setup()
  await run.cache.get('key'); await run.cache.settled('key')
  const original = await run.cache.get('key')
  run.advance(JOURNAL_TTL - 1)
  assert.equal((await run.cache.get('key')).syncing, false)
  const gate = deferred()
  run.deps.fetchPage = async () => { await gate.promise; return { notes: [note('new')], scannedBooks: 1, failedBooks: 0, nextCursor: null } }
  run.advance(1)
  const stale = await run.cache.get('key')
  assert.equal(stale.syncing, true)
  assert.deepEqual(stale.notes, original.notes)
  assert.equal(stale.updatedAt, original.updatedAt)
  gate.resolve(); await run.cache.settled('key')
  const fresh = await run.cache.get('key')
  assert.equal(fresh.notes[0].id, 'new')
  assert.equal(fresh.updatedAt, original.updatedAt + JOURNAL_TTL)
})

test('POST force refresh bypasses TTL but returns unchanged visible data immediately', async () => {
  const run = setup()
  await run.cache.get('key'); await run.cache.settled('key')
  const old = await run.cache.get('key')
  const gate = deferred()
  run.deps.fetchBooks = async () => { await gate.promise; return [] }
  const forced = await run.cache.get('key', true)
  assert.deepEqual(forced.notes, old.notes)
  assert.equal(forced.updatedAt, old.updatedAt)
  assert.equal(forced.syncing, true)
  gate.resolve(); await run.cache.settled('key')
  assert.deepEqual((await run.cache.get('key')).notes, [])
})

test('failed refresh keeps good disk notes and timestamp; failures cool down for five minutes', async () => {
  const run = setup()
  await run.cache.get('key'); await run.cache.settled('key')
  const original = await run.cache.get('key')
  let attempts = 0
  run.deps.fetchBooks = async () => { attempts++; throw new Error('secret-key must not reach browser') }
  run.advance(JOURNAL_TTL)
  await run.cache.get('key'); await run.cache.settled('key')
  const failed = await run.cache.get('key')
  assert.deepEqual(failed.notes, original.notes)
  assert.equal(failed.updatedAt, original.updatedAt)
  assert.equal(failed.hasCache, true)
  assert.ok(failed.error)
  assert.ok(!failed.error.includes('secret-key'))
  assert.deepEqual(run.disk.get(journalAccount('key')).state.notes, original.notes)
  const restarted = createJournalCache(run.deps)
  await restarted.get('key'); await restarted.settled('key')
  assert.equal(attempts, 1)
  run.advance(JOURNAL_RETRY)
  await restarted.get('key'); await restarted.settled('key')
  assert.equal(attempts, 2)
})

test('partial first sync remains visible, never fresh; a failed book preserves good old data', async () => {
  const run = setup({ fetchPage: async () => ({ notes: [note('partial')], scannedBooks: 1, failedBooks: 1, nextCursor: null }) })
  await run.cache.get('key'); await run.cache.settled('key')
  const partial = await run.cache.get('key')
  assert.equal(partial.hasCache, true)
  assert.equal(partial.updatedAt, 0)
  assert.equal(partial.failedBooks, 1)
  assert.ok(partial.error)
  assert.equal(partial.notes[0].id, 'partial')
  run.deps.fetchPage = async () => ({ notes: [note('good')], scannedBooks: 1, failedBooks: 0, nextCursor: null })
  await run.cache.get('key', true); await run.cache.settled('key')
  const good = await run.cache.get('key')
  run.deps.fetchPage = async () => ({ notes: [note('bad')], scannedBooks: 1, failedBooks: 1, nextCursor: null })
  await run.cache.get('key', true); await run.cache.settled('key')
  const failed = await run.cache.get('key')
  assert.deepEqual(failed.notes, good.notes)
  assert.equal(failed.updatedAt, good.updatedAt)
})

test('accounts have independent memory, disk hashes and upstream producers', async () => {
  const run = setup({ fetchBooks: async (key) => [{ bookId: key }], fetchPage: async (books) => ({ notes: [note(books[0].bookId)], scannedBooks: 1, failedBooks: 0, nextCursor: null }) })
  await Promise.all([run.cache.get('alice'), run.cache.get('bob')])
  await Promise.all([run.cache.settled('alice'), run.cache.settled('bob')])
  assert.equal((await run.cache.get('alice')).notes[0].id, 'alice')
  assert.equal((await run.cache.get('bob')).notes[0].id, 'bob')
  assert.deepEqual([...run.disk.keys()].sort(), [journalAccount('alice'), journalAccount('bob')].sort())
  assert.equal(JSON.stringify(await run.cache.get('alice')).includes(journalAccount('alice')), false)
})

test('changing credentials during an upstream page discards that page before caching', async () => {
  let current = 'alice'
  const gate = deferred()
  const started = deferred()
  const run = setup({
    assertAccount: (key) => { if (key !== current) throw new Error('account changed') },
    fetchPage: async (books, cursor, key) => {
      if (key === 'alice') { started.resolve(); await gate.promise }
      return { notes: [note(key)], scannedBooks: 1, failedBooks: 0, nextCursor: null }
    },
  })
  await run.cache.get('alice')
  await started.promise
  current = 'bob'
  await run.cache.get('bob'); await run.cache.settled('bob')
  gate.resolve(); await run.cache.settled('alice')
  const alice = run.disk.get(journalAccount('alice')).state
  const bob = await run.cache.get('bob')
  assert.deepEqual(alice.notes, [])
  assert.equal(alice.updatedAt, 0)
  assert.ok(alice.error)
  assert.deepEqual(bob.notes.map((row) => row.id), ['bob'])
})

test('pages run sequentially; first-load progress checkpoints resume after restart', async () => {
  const run = setup({ fetchBooks: async () => Array.from({ length: 12 }, (_, i) => ({ bookId: String(i) })) })
  const gate = deferred()
  const cursors = []
  run.deps.fetchPage = async (books, cursor) => {
    cursors.push(cursor)
    if (cursor === 6) await gate.promise
    run.advance(30_000)
    return { notes: [note(String(cursor))], scannedBooks: 6, failedBooks: 0, nextCursor: cursor === 0 ? 6 : null }
  }
  await run.cache.get('key')
  // Flush the finite promise chain until page two is reached, without sleeps.
  for (let i = 0; i < 20 && cursors.length < 2; i++) await Promise.resolve()
  assert.deepEqual(cursors, [0, 6])
  const progress = await run.cache.get('key')
  assert.equal(progress.scannedBooks, 6)
  assert.equal(progress.notes[0].id, '0')
  assert.equal(run.disk.get(journalAccount('key')).checkpoint.cursor, 6)
  const resumedCursors = []
  const restarted = createJournalCache({ ...run.deps, fetchBooks: async () => { throw new Error('must resume') }, fetchPage: async (books, cursor) => {
    resumedCursors.push(cursor)
    return { notes: [note('6')], scannedBooks: 6, failedBooks: 0, nextCursor: null }
  } })
  run.advance(JOURNAL_RETRY)
  await restarted.get('key'); await restarted.settled('key')
  assert.deepEqual(resumedCursors, [6])
  assert.equal((await restarted.get('key')).notes.length, 2)
  gate.resolve(); await run.cache.settled('key')
})

test('disk cache atomic replacement uses owner-only permissions, rejects path traversal and invalid JSON', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'weread-journal-test-'))
  const storage = createJournalFileStorage(join(directory, 'config.json'))
  const account = journalAccount('host-secret')
  const state = { notes: [note()], totalBooks: 1, scannedBooks: 1, failedBooks: 0, syncing: false, updatedAt: 100, error: '', hasCache: true }
  await storage.save(account, { version: 1, state, lastAttempt: 90 })
  const cacheDirectory = join(directory, 'journal-cache')
  const filename = join(cacheDirectory, `${account}.json`)
  assert.equal((await stat(cacheDirectory)).mode & 0o777, 0o700)
  assert.equal((await stat(filename)).mode & 0o777, 0o600)
  assert.deepEqual((await storage.load(account)).state, state)
  assert.equal((await readFile(filename, 'utf8')).includes('host-secret'), false)
  assert.deepEqual(await readdir(cacheDirectory), [`${account}.json`])
  await assert.rejects(storage.save('../escape', { version: 1, state, lastAttempt: 90 }), /Invalid/)
  await writeFile(filename, '{bad')
  assert.equal(await storage.load(account), undefined)
  await writeFile(filename, JSON.stringify({ version: 1, state: { ...state, notes: [{}] }, lastAttempt: 0 }))
  assert.equal(await storage.load(account), undefined)
})

const revisionBook = (bookId, noteCount = 1, reviewCount = 0, sort = 1_700_000_000) => ({ bookId, noteCount, reviewCount, sort })
function incrementalSetup(initial = [revisionBook('a'), revisionBook('b')]) {
  let books = initial
  const fetched = []
  const run = setup({
    fetchBooks: async () => books,
    fetchPage: async (changed, cursor) => {
      const page = changed.slice(cursor, cursor + 6)
      fetched.push(...page.map((book) => book.bookId))
      return { notes: page.flatMap((book) => Array.from({ length: Math.max(0, book.noteCount ?? 1) }, (_, i) => ({ ...note(`${book.bookId}-${i}`), bookId: book.bookId }))),
        scannedBooks: page.length, failedBooks: 0, nextCursor: cursor + 6 < changed.length ? cursor + 6 : null }
    },
  })
  return { ...run, fetched, setBooks: (next) => { books = next } }
}

test('daily incremental sync fetches one notebook snapshot and no details for unchanged books, including after restart', async () => {
  const run = incrementalSetup()
  let snapshots = 0
  const fetchBooks = run.deps.fetchBooks
  run.deps.fetchBooks = async (...args) => { snapshots++; return fetchBooks(...args) }
  await run.cache.get('key'); await run.cache.settled('key')
  assert.deepEqual(run.fetched, ['a', 'b'])
  run.fetched.length = 0
  run.advance(JOURNAL_TTL)
  await run.cache.get('key'); await run.cache.settled('key')
  assert.equal(snapshots, 2)
  assert.deepEqual(run.fetched, [])
  assert.equal((await run.cache.get('key')).scannedBooks, 2)
  const restarted = createJournalCache(run.deps)
  await restarted.get('key', true); await restarted.settled('key')
  assert.equal(snapshots, 3)
  assert.deepEqual(run.fetched, [])
  assert.deepEqual(Object.keys(run.disk.get(journalAccount('key')).bookRevisions).sort(), ['a', 'b'])
})

test('incremental sync refreshes only changed or new books, excludes removed books and catches same-count edits', async () => {
  const run = incrementalSetup([revisionBook('a'), revisionBook('b'), revisionBook('removed')])
  await run.cache.get('key'); await run.cache.settled('key')
  run.fetched.length = 0
  run.setBooks([revisionBook('a'), revisionBook('b', 2), revisionBook('new')])
  await run.cache.get('key', true); await run.cache.settled('key')
  assert.deepEqual(run.fetched, ['b', 'new'])
  const state = await run.cache.get('key')
  assert.deepEqual(state.notes.map((row) => row.bookId).sort(), ['a', 'b', 'b', 'new'])
  assert.equal(state.totalBooks, 3)
  run.fetched.length = 0
  run.setBooks([revisionBook('a', 1, 0, 1_700_000_001), revisionBook('b', 2), revisionBook('new')])
  await run.cache.get('key', true); await run.cache.settled('key')
  assert.deepEqual(run.fetched, ['a'])
})

test('unknown or invalid count and timestamp fields always refresh rather than claiming unchanged', async () => {
  const books = [revisionBook('missingCount'), revisionBook('stringCount'), revisionBook('missingSort'), revisionBook('negative')]
  delete books[0].noteCount
  books[1].reviewCount = '0'
  delete books[2].sort
  books[3].noteCount = -1
  const run = incrementalSetup(books)
  await run.cache.get('key'); await run.cache.settled('key')
  run.fetched.length = 0
  await run.cache.get('key', true); await run.cache.settled('key')
  assert.deepEqual(run.fetched, books.map((book) => book.bookId))
})

test('legacy complete cache adopts only exact kind counts and non-newer valid timestamps', async () => {
  const run = incrementalSetup([revisionBook('safe'), revisionBook('mismatch', 2), revisionBook('edited', 1, 0, 1_900_000_000)])
  const state = { notes: ['safe', 'mismatch', 'edited'].map((id) => ({ ...note(id), bookId: id })), totalBooks: 3,
    scannedBooks: 3, failedBooks: 0, syncing: false, updatedAt: run.deps.now(), error: '', hasCache: true }
  run.disk.set(journalAccount('key'), { version: 1, state, lastAttempt: run.deps.now() })
  await run.cache.get('key', true); await run.cache.settled('key')
  assert.deepEqual(run.fetched, ['mismatch', 'edited'])
  assert.equal((await run.cache.get('key')).notes.some((row) => row.id === 'safe'), true)
  run.fetched.length = 0
  await run.cache.get('key', true); await run.cache.settled('key')
  assert.deepEqual(run.fetched, [])
})

test('failed incremental page retains good notes and manifest so changed books retry later', async () => {
  const run = incrementalSetup()
  await run.cache.get('key'); await run.cache.settled('key')
  const good = await run.cache.get('key')
  const oldManifest = structuredClone(run.disk.get(journalAccount('key')).bookRevisions)
  run.setBooks([revisionBook('a'), revisionBook('b', 2)])
  const fetchPage = run.deps.fetchPage
  run.deps.fetchPage = async () => ({ notes: [note('partial')], scannedBooks: 1, failedBooks: 1, nextCursor: null })
  await run.cache.get('key', true); await run.cache.settled('key')
  assert.deepEqual((await run.cache.get('key')).notes, good.notes)
  assert.deepEqual(run.disk.get(journalAccount('key')).bookRevisions, oldManifest)
  run.fetched.length = 0
  run.deps.fetchPage = fetchPage
  await run.cache.get('key', true); await run.cache.settled('key')
  assert.deepEqual(run.fetched, ['b'])
})

test('new journal cache registers both methods once and leaves legacy pagination intact', () => {
  const noop = () => {}
  const routes = createRouter({ logger: { info: noop, warn: noop, error: noop }, cache: createCache(), scope: {} })
  const paths = routes.map((route) => route.def.path)
  assert.equal(new Set(paths).size, paths.length)
  assert.deepEqual(routes.find((route) => route.def.path === '/api/weread/journal-cache').def.methods, ['GET', 'POST'])
  assert.ok(paths.includes('/api/weread/journal-notes'))
})
