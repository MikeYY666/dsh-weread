/** Backend original-location validation, lazy caching, and credential isolation. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildJournalNoteLink, parseJournalNotes, resolveJournalNoteLink } from '../lib/host/weread/journal.js'
import { createRouter } from '../lib/host/routes.js'
import { createCache } from '../lib/host/store/cache.js'
import { setApiKey } from '../lib/host/config.js'

const valid = { bookmarkId: 7, chapterUid: 3, range: '0-99' }

test('original-location links accept numeric IDs and encode book IDs', () => {
  assert.deepEqual(buildJournalNoteLink(42, valid), { url: 'weread://bestbookmark?bookId=42&chapterUid=3&rangeStart=0&rangeEnd=99', precise: true })
  assert.equal(buildJournalNoteLink('a&b /中', valid).url, 'weread://bestbookmark?bookId=a%26b%20%2F%E4%B8%AD&chapterUid=3&rangeStart=0&rangeEnd=99')
  assert.equal(buildJournalNoteLink('42', { ...valid, chapterUid: '3' }).precise, true)
})

test('original-location links reject coercions and invalid or missing positions', () => {
  for (const chapterUid of [undefined, null, '', true, {}, -1, 1.5, Infinity, NaN, '1e2', ' 3', '3&evil=1', '9007199254740992']) {
    assert.deepEqual(buildJournalNoteLink('42', { ...valid, chapterUid }), { url: 'weread://reading?bId=42', precise: false })
  }
  for (const range of [undefined, null, 2, {}, '', '-1-3', '3-2', '3-3', '0-1.5', '0-1e2', ' 0-2', '0-2&evil=1', '0-9007199254740992']) {
    assert.equal(buildJournalNoteLink('42', { ...valid, range }).precise, false)
  }
  assert.deepEqual(buildJournalNoteLink('a&b', null), { url: 'weread://reading?bId=a%26b', precise: false })
  assert.equal(buildJournalNoteLink('42', { chapterId: 3, rangeStart: 0, rangeEnd: 99 }).precise, false)
})

test('journal emits only precise source URLs and resolves exact namespaced highlight IDs', () => {
  const notes = parseJournalNotes({ bookId: 42 }, { updated: [
    { ...valid, markText: 'quote', createTime: 1700000000 },
    { bookmarkId: 8, markText: 'other', createTime: 1700000000 },
  ] }, {})
  assert.equal(notes[0].sourceUrl, buildJournalNoteLink(42, valid).url)
  assert.equal(Object.hasOwn(notes[1], 'sourceUrl'), false)
  assert.equal(resolveJournalNoteLink('42', '42:highlight:7', { updated: [valid] }).precise, true)
  assert.equal(resolveJournalNoteLink('42', '42:highlight:8', { updated: [{ bookmarkId: '8' }] }).precise, false)
  for (const updated of [[], [{ ...valid, type: 0 }], [{ ...valid, bookId: 99 }]]) {
    assert.throws(() => resolveJournalNoteLink('42', '42:highlight:7', { updated }), (error) => error.status === 404)
  }
})

test('link route rejects malformed and mismatched IDs before cache or upstream access', async () => {
  const route = createRouter({ cache: { get() { throw new Error('cache must not run') } }, logger: { warn() {}, error() {} }, scope: {} }).find((r) => r.def.path === '/api/weread/journal-note-link').def
  for (const query of ['', 'bookId=42', 'bookId=42&noteId=', 'bookId=42&noteId=43:highlight:7', 'bookId=42&noteId=42:thought:7', 'bookId=42&noteId=42:highlight:', 'bookId=42&noteId=42:highlight:7:extra', 'bookId=42&noteId=42:highlight:7&bookId=43', 'bookId=42&noteId=42:highlight:7&noteId=42:highlight:8', 'bookId=%20&noteId=%20:highlight:7']) {
    const response = await route.fetch(new Request(`http://localhost/api/weread/journal-note-link?${query}`))
    assert.equal(response.status, 400, query)
    assert.equal((await response.json()).error.code, 'weread/bad-request')
  }
})

test('link route caches only requested-book raw bookmarks for 24h and guards account changes', async () => {
  const previousHome = process.env.DSH_HOME
  const home = mkdtempSync(join(tmpdir(), 'weread-link-test-'))
  process.env.DSH_HOME = home
  try {
    setApiKey('wrk-test-account-a')
    let calls = 0
    let swap = false
    const keys = []
    const cache = createCache()
    const route = createRouter({
      cache: { ...cache, get(key, ttl, produce) { keys.push(key); assert.equal(ttl, 86400000); return cache.get(key, ttl, produce) } },
      logger: { warn() {}, error() {} }, scope: {},
      journalLinkCall: async (api, params, signal) => {
        calls++
        assert.equal(api, '/book/bookmarklist')
        assert.deepEqual(Object.keys(params), ['bookId'])
        assert.ok(signal instanceof AbortSignal)
        assert.equal(signal.aborted, false)
        if (swap) setApiKey('wrk-test-account-b')
        return { updated: [valid, { bookmarkId: 8 }] }
      },
    }).find((r) => r.def.path === '/api/weread/journal-note-link').def
    const request = (bookId, note = '7') => route.fetch(new Request(`http://localhost/api/weread/journal-note-link?bookId=${bookId}&noteId=${bookId}:highlight:${note}`))
    assert.equal((await (await request('42')).json()).value.precise, true)
    assert.equal((await (await request('42', '8')).json()).value.precise, false)
    assert.equal((await request('42', 'missing')).status, 404)
    assert.equal(calls, 1)
    assert.equal((await request('43')).status, 200)
    assert.equal(calls, 2)
    assert.match(keys[0], /^weread:journal:links:[a-f0-9]{64}:42$/)
    swap = true
    assert.equal((await request('44')).status, 409)
    swap = false
    assert.equal((await request('42')).status, 200)
    assert.equal(calls, 4)
    assert.notEqual(keys[0], keys.at(-1))
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  }
})
