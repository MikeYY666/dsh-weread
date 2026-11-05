/**
 * Account-scoped JSON journal cache with host-owned stale-while-refresh sync.
 * A successful snapshot is retained until its replacement is complete; first-load
 * checkpoints let a restarted host resume without rescanning completed pages.
 * @module dsh-weread/src/host/store/journalCache
 */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, chmod, readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { JournalCacheState, JournalNote, JournalPage } from '../../types.js'

export const JOURNAL_TTL = 24 * 60 * 60_000
export const JOURNAL_RETRY = 5 * 60_000
const CHECKPOINT_INTERVAL = 30_000

type Book = Record<string, unknown>
interface BookRevision {
  noteCount: number
  reviewCount: number
  sort: number
}
type BookRevisions = Record<string, BookRevision>
interface Checkpoint {
  books: Book[]
  totalBooks?: number
  cursor: number
  notes: JournalNote[]
  scannedBooks: number
  failedBooks: number
  bookRevisions?: BookRevisions
}
export interface JournalCacheRecord {
  version: 1
  state: JournalCacheState
  lastAttempt: number
  checkpoint?: Checkpoint
  bookRevisions?: BookRevisions
}
export interface JournalCacheStorage {
  load(account: string): Promise<JournalCacheRecord | undefined>
  save(account: string, record: JournalCacheRecord): Promise<void>
}
export interface JournalCacheDeps {
  storage: JournalCacheStorage
  fetchBooks(apiKey: string): Promise<Book[]>
  fetchPage(books: readonly Book[], cursor: number, apiKey: string): Promise<JournalPage>
  assertAccount?: (apiKey: string) => void
  now?: () => number
}
interface Entry {
  state: JournalCacheState
  lastAttempt: number
  checkpoint?: Checkpoint
  bookRevisions?: BookRevisions
  inflight?: Promise<void>
}
const empty = (): JournalCacheState => ({ notes: [], totalBooks: 0, scannedBooks: 0, failedBooks: 0, syncing: false, updatedAt: 0, error: '', hasCache: false })

/** Missing/ambiguous counts or update times must never imply unchanged content. */
function revisionOf(book: Book): BookRevision | undefined {
  const { noteCount, reviewCount, sort } = book
  if (typeof noteCount !== 'number' || !Number.isSafeInteger(noteCount) || noteCount < 0
    || typeof reviewCount !== 'number' || !Number.isSafeInteger(reviewCount) || reviewCount < 0
    || typeof sort !== 'number' || !Number.isSafeInteger(sort) || sort <= 0) return undefined
  return { noteCount, reviewCount, sort }
}
function bookIdOf(book: Book): string {
  const nested = book.book !== null && typeof book.book === 'object' ? book.book as Book : {}
  const value = book.bookId ?? nested.bookId
  return typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
}
function sameRevision(left: BookRevision | undefined, right: BookRevision): boolean {
  return left !== undefined && left.noteCount === right.noteCount && left.reviewCount === right.reviewCount && left.sort === right.sort
}
function normalizeRevisions(value: unknown): BookRevisions {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).flatMap(([key, revision]) => {
    if (revision === null || typeof revision !== 'object') return []
    const valid = revisionOf(revision as Book)
    return valid === undefined ? [] : [[key, valid]]
  }))
}
function legacyMatches(notes: readonly JournalNote[], revision: BookRevision, updatedAt: number): boolean {
  const sortMs = revision.sort < 1e12 ? revision.sort * 1000 : revision.sort
  return updatedAt > 0 && sortMs <= updatedAt
    && notes.filter((note) => note.kind === 'highlight').length === revision.noteCount
    && notes.filter((note) => note.kind === 'thought').length === revision.reviewCount
}

/** Hashes are storage identities only and never enter response DTOs. */
export function journalAccount(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex')
}

/** Restrict rename/unlink destinations to exactly the intended cache directory. */
function cachePath(directory: string, name: string): string {
  const path = resolve(directory, name)
  if (dirname(path) !== directory || !/^[a-f0-9]{64}(?:\.[a-f0-9-]+\.tmp)?\.json$/.test(name)) {
    throw new Error('Invalid journal cache path')
  }
  return path
}

function validState(value: unknown): value is JournalCacheState {
  if (value === null || typeof value !== 'object') return false
  const state = value as JournalCacheState
  return Array.isArray(state.notes) && state.notes.every((note) => note !== null && typeof note === 'object'
    && ['id', 'bookId', 'bookTitle', 'author', 'cover', 'chapterTitle', 'text'].every((key) => typeof (note as unknown as Record<string, unknown>)[key] === 'string')
    && (note.kind === 'highlight' || note.kind === 'thought') && Number.isFinite(note.createTime) && note.createTime > 0)
    && [state.totalBooks, state.scannedBooks, state.failedBooks, state.updatedAt].every((number) => Number.isFinite(number) && number >= 0)
    && typeof state.hasCache === 'boolean' && typeof state.error === 'string'
}

/** Atomic same-directory replacement, with no database or note truncation. */
export function createJournalFileStorage(configFile: string): JournalCacheStorage {
  const directory = resolve(dirname(configFile), 'journal-cache')
  return {
    async load(account) {
      const path = cachePath(directory, `${account}.json`)
      let record: JournalCacheRecord
      try {
        record = JSON.parse(await readFile(path, 'utf8')) as JournalCacheRecord
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return undefined
        throw error
      }
      if (record === null || typeof record !== 'object' || record.version !== 1 || !validState(record.state) || !Number.isFinite(record.lastAttempt)) return undefined
      const checkpoint = record.checkpoint
      if (checkpoint !== undefined && (!Array.isArray(checkpoint.books) || !Array.isArray(checkpoint.notes)
        || !Number.isSafeInteger(checkpoint.cursor) || checkpoint.cursor < 0 || checkpoint.cursor > checkpoint.books.length
        || !validState({ ...record.state, notes: checkpoint.notes }) || !Number.isFinite(checkpoint.scannedBooks) || !Number.isFinite(checkpoint.failedBooks))) {
        delete record.checkpoint
      }
      return record
    },
    async save(account, record) {
      const path = cachePath(directory, `${account}.json`)
      const temporary = cachePath(directory, `${account}.${randomUUID()}.tmp.json`)
      await mkdir(directory, { recursive: true, mode: 0o700 })
      await chmod(directory, 0o700)
      try {
        await writeFile(temporary, JSON.stringify(record), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
        // Both resolved absolute paths were checked against the intended directory.
        await rename(temporary, path)
      } finally {
        await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
      }
    },
  }
}

/** Dependency injection keeps singleflight, restart and clock behavior testable. */
export function createJournalCache(deps: JournalCacheDeps) {
  const now = deps.now ?? Date.now
  const entries = new Map<string, Promise<Entry>>()
  async function entryFor(account: string): Promise<Entry> {
    let pending = entries.get(account)
    if (pending === undefined) {
      pending = Promise.resolve().then(async () => {
        const record = await deps.storage.load(account)
        return record === undefined ? { state: empty(), lastAttempt: -Infinity }
          : { state: { ...record.state, syncing: false }, lastAttempt: record.lastAttempt,
            ...(record.bookRevisions === undefined ? {} : { bookRevisions: normalizeRevisions(record.bookRevisions) }),
            ...(record.checkpoint === undefined ? {} : { checkpoint: record.checkpoint }) }
      })
      entries.set(account, pending)
      // Failed disk reads are retryable and cannot leave an unhandled rejection.
      void pending.catch(() => { if (entries.get(account) === pending) entries.delete(account) })
    }
    return pending
  }
  function recordOf(entry: Entry): JournalCacheRecord {
    return { version: 1, state: { ...entry.state, syncing: false }, lastAttempt: entry.lastAttempt,
      ...(entry.bookRevisions === undefined ? {} : { bookRevisions: entry.bookRevisions }),
      ...(entry.checkpoint === undefined ? {} : { checkpoint: entry.checkpoint }) }
  }
  async function sync(account: string, apiKey: string, entry: Entry): Promise<void> {
    const previous = entry.state
    const previousRevisions = entry.bookRevisions
    const keepGood = previous.updatedAt > 0
    let checkpointAt = now()
    try {
      const resume = !keepGood ? entry.checkpoint : undefined
      deps.assertAccount?.(apiKey)
      const books = resume?.books ?? await deps.fetchBooks(apiKey)
      const totalBooks = resume?.totalBooks ?? books.length
      deps.assertAccount?.(apiKey)
      const grouped = new Map<string, JournalNote[]>()
      for (const note of previous.notes) {
        const notes = grouped.get(note.bookId) ?? []
        notes.push(note)
        grouped.set(note.bookId, notes)
      }
      const nextRevisions: BookRevisions = Object.assign(Object.create(null), normalizeRevisions(resume?.bookRevisions))
      const collected = new Map<string, JournalNote>((resume?.notes ?? []).map((note) => [note.id, note]))
      const changed: Book[] = []
      let scannedBooks = resume?.scannedBooks ?? 0
      if (resume !== undefined) changed.push(...books)
      else for (const book of books) {
        const bookId = bookIdOf(book)
        const revision = revisionOf(book)
        const cached = grouped.get(bookId) ?? []
        const saved = entry.bookRevisions?.[bookId]
        // Older cache files have no manifest. Counts of dated notes are a
        // conservative migration check; any mismatch takes the normal fetch path.
        const reusable = revision !== undefined && (sameRevision(saved, revision)
          || (entry.bookRevisions === undefined && legacyMatches(cached, revision, previous.updatedAt)))
        if (reusable && revision !== undefined) {
          for (const note of cached) collected.set(note.id, note)
          nextRevisions[bookId] = revision
          scannedBooks += 1
        } else changed.push(book)
      }
      let cursor = resume?.cursor ?? 0
      let failedBooks = resume?.failedBooks ?? 0
      entry.state = { ...entry.state, totalBooks, scannedBooks, failedBooks }
      while (cursor < changed.length) {
        deps.assertAccount?.(apiKey)
        const page = await deps.fetchPage(changed, cursor, apiKey)
        deps.assertAccount?.(apiKey)
        for (const note of page.notes) collected.set(note.id, note)
        // Page failures are aggregate: promote no revisions from a failed page,
        // so none of its books can silently become permanently cached partials.
        if (page.failedBooks === 0) {
          for (const book of changed.slice(cursor, page.nextCursor ?? changed.length)) {
            const revision = revisionOf(book)
            if (revision !== undefined) nextRevisions[bookIdOf(book)] = revision
          }
        }
        scannedBooks += page.scannedBooks
        failedBooks += page.failedBooks
        const notes = [...collected.values()].sort((a, b) => b.createTime - a.createTime || a.id.localeCompare(b.id))
        entry.state = { ...entry.state, notes: keepGood ? previous.notes : notes, scannedBooks, failedBooks,
          hasCache: keepGood || notes.length > 0 }
        const next = page.nextCursor ?? changed.length
        if (!Number.isSafeInteger(next) || next <= cursor || next > changed.length) throw new Error('Invalid journal page cursor')
        cursor = next
        if (!keepGood) {
          entry.checkpoint = { books: changed, totalBooks, cursor, notes, scannedBooks, failedBooks, bookRevisions: nextRevisions }
          if (now() - checkpointAt >= CHECKPOINT_INTERVAL) {
            await deps.storage.save(account, recordOf(entry))
            checkpointAt = now()
          }
        }
      }
      delete entry.checkpoint
      entry.lastAttempt = now()
      if (failedBooks > 0) {
        if (!keepGood) entry.bookRevisions = nextRevisions
        entry.state = { ...entry.state, syncing: false, error: `${failedBooks} 本书的笔记未完整同步，请稍后重试`,
          hasCache: true }
      } else {
        entry.bookRevisions = nextRevisions
        entry.state = { notes: [...collected.values()].sort((a, b) => b.createTime - a.createTime || a.id.localeCompare(b.id)),
          totalBooks, scannedBooks, failedBooks: 0, syncing: false, updatedAt: now(), error: '', hasCache: true }
      }
      await deps.storage.save(account, recordOf(entry))
    } catch {
      // Upstream errors may contain credentials or request URLs. Expose only a
      // fixed message and retain the last good snapshot (including its timestamp).
      entry.lastAttempt = now()
      if (keepGood) {
        if (previousRevisions === undefined) delete entry.bookRevisions
        else entry.bookRevisions = previousRevisions
      }
      entry.state = { ...(keepGood ? previous : entry.state), updatedAt: previous.updatedAt, syncing: false, error: '笔记同步失败，已保留缓存，请稍后重试' }
      try { await deps.storage.save(account, recordOf(entry)) } catch {
        entry.state = { ...entry.state, error: '笔记缓存写入失败，已保留内存中的笔记，请稍后重试' }
      }
    }
  }
  return {
    async get(apiKey: string, force = false): Promise<JournalCacheState> {
      const account = journalAccount(apiKey)
      const entry = await entryFor(account)
      const time = now()
      const fresh = entry.state.updatedAt > 0 && time - entry.state.updatedAt < JOURNAL_TTL
      if (entry.inflight === undefined && (force || (!fresh && time - entry.lastAttempt >= JOURNAL_RETRY))) {
        entry.lastAttempt = time
        entry.state = { ...entry.state, syncing: true, error: '' }
        // Defer every upstream operation until after inflight is assigned. Even a
        // synchronous fake/throwing producer cannot race another GET or POST.
        entry.inflight = Promise.resolve().then(() => sync(account, apiKey, entry)).catch(() => {
          entry.state = { ...entry.state, syncing: false, error: '笔记同步失败，请稍后重试' }
        }).finally(() => { delete entry.inflight })
      }
      return { ...entry.state }
    },
    /** For lifecycle/tests only; browser requests never wait for sync completion. */
    async settled(apiKey: string): Promise<void> {
      const entry = await entryFor(journalAccount(apiKey))
      await entry.inflight
    },
  }
}
