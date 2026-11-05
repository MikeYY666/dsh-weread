/**
 * Dated personal notes assembled in memory from notebook books and both note APIs.
 * Pagination failures retain already fetched content for the journal while the
 * ordinary reviews endpoint rejects incomplete results rather than hiding truncation.
 * @module dsh-weread/src/host/weread/journal
 */
import type { JournalNote, JournalPage } from '../../types.js'
import { callAgent, WereadError } from './gateway.js'
import { parseReviews } from './parse.js'

const PAGE_SIZE = 6
const MAX_REVIEW_PAGES = 100

type Raw = Record<string, unknown>
type AgentCall = (api: string, params: Raw) => Promise<unknown>
// A shared producer cannot inherit one subscriber's cancellation, but each
// upstream request still needs a deadline when the gateway stops responding.
const boundedAgent: AgentCall = (api, params) => callAgent(api, params, AbortSignal.timeout(30_000))
const object = (value: unknown): Raw => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Raw : {}
const rows = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const text = (value: unknown): string => typeof value === 'string' ? value : ''
const id = (value: unknown): string => typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : ''

/** Strict nonnegative book offset; blank, exponent and fractional cursors are invalid. */
export function parseJournalCursor(value: string | null): number {
  if (value === null) return 0
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new WereadError('weread/bad-request', 'cursor 必须是非负安全整数', 400)
  }
  return Number(value)
}

/** Keep upstream notebook order and remove malformed or repeated book identities. */
export function journalBooks(input: readonly unknown[]): Raw[] {
  const seen = new Set<string>()
  return input.map(object).filter((row) => {
    const bookId = id(row.bookId) || id(object(row.book).bookId)
    if (bookId === '' || seen.has(bookId)) return false
    seen.add(bookId)
    return true
  })
}

/** Explicit failure with successfully fetched review pages for partial journal output. */
export class ReviewPaginationError extends WereadError {
  constructor(message: string, readonly reviews: readonly unknown[]) {
    super('weread/incomplete-reviews', message, 502)
  }
}

/** Walk every personal-review synckey; never silently accept cycles or a safety cutoff. */
export async function fetchAllMineReviews(bookId: string, call: AgentCall = boundedAgent, maxPages = MAX_REVIEW_PAGES): Promise<{ reviews: unknown[] }> {
  const reviews: unknown[] = []
  const seenIds = new Set<string>()
  const cursors = new Set<number>([0])
  let synckey = 0
  for (let page = 0; page < maxPages; page += 1) {
    let root: Raw
    try {
      root = object(await call('/review/list/mine', { bookid: bookId, synckey, count: 100 }))
    } catch (error) {
      // Preserve auth/network status for an initial failure on the reviews route.
      if (page === 0) throw error
      throw new ReviewPaginationError(`想法分页请求失败：${String(error)}`, reviews)
    }
    for (const item of rows(root.reviews)) {
      const wrapper = object(item)
      const review = object(wrapper.review ?? wrapper)
      const reviewId = id(review.reviewId) || id(wrapper.reviewId)
      if (reviewId !== '' && seenIds.has(reviewId)) continue
      if (reviewId !== '') seenIds.add(reviewId)
      reviews.push({ review: { ...review, reviewId } })
    }
    if (root.hasMore !== 1 && root.hasMore !== true && root.hasMore !== '1') return { reviews }
    const next = root.synckey
    if (typeof next !== 'number' || !Number.isSafeInteger(next) || next < 0 || cursors.has(next)) {
      throw new ReviewPaginationError('想法分页游标缺失、无效或重复，内容未完整获取', reviews)
    }
    cursors.add(next)
    synckey = next
  }
  throw new ReviewPaginationError('想法分页超过安全页数，内容未完整获取', reviews)
}

/** Unknown, zero, negative and nonfinite timestamps must not become journal dates. */
function milliseconds(value: unknown): number | undefined {
  if (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === '')) return undefined
  const seconds = Number(value)
  const ms = seconds * 1000
  return seconds > 0 && Number.isFinite(ms) && ms <= 8.64e15 ? ms : undefined
}

/** Pure raw JSON → dated journal notes, including numeric IDs and sparse metadata. */
export function parseJournalNotes(notebook: unknown, highlights: unknown, reviews: unknown): JournalNote[] {
  const row = object(notebook)
  const book = object(row.book)
  const bookId = id(row.bookId) || id(book.bookId)
  if (bookId === '') return []
  const metadata = { bookId, bookTitle: text(book.title) || text(row.title), author: text(book.author) || text(row.author), cover: (text(book.cover) || text(row.cover)).replace('/s_', '/t7_') }
  const root = object(highlights)
  const chapterTitles = new Map(rows(root.chapters).map((chapter) => { const c = object(chapter); return [id(c.chapterUid), text(c.title)] }))
  const notes: JournalNote[] = []
  const seen = new Set<string>()
  function add(kind: JournalNote['kind'], sourceId: string, content: string, time: unknown, chapterTitle: string): void {
    const createTime = milliseconds(time)
    const noteId = `${bookId}:${kind}:${sourceId}`
    if (sourceId === '' || content.trim() === '' || createTime === undefined || seen.has(noteId)) return
    seen.add(noteId)
    notes.push({ ...metadata, id: noteId, kind, chapterTitle, text: content.trim(), createTime })
  }
  for (const item of rows(root.updated)) {
    const h = object(item)
    if (h.type === 0 || h.type === '0') continue
    add('highlight', id(h.bookmarkId), text(h.markText), h.createTime, chapterTitles.get(id(h.chapterUid)) || text(h.chapterName))
  }
  for (const item of rows(object(reviews).reviews)) {
    const wrapper = object(item)
    const r = object(wrapper.review ?? wrapper)
    const reviewId = id(r.reviewId) || id(wrapper.reviewId)
    const parsed = parseReviews({ reviews: [{ review: { ...r, reviewId } }] })[0]
    if (parsed !== undefined) add('thought', reviewId, parsed.content, r.createTime, parsed.chapterTitle ?? '')
  }
  return notes.sort((a, b) => b.createTime - a.createTime || a.id.localeCompare(b.id))
}

/** Fetch at most two books concurrently; errors affect only their book and source. */
export async function fetchJournalPage(input: readonly unknown[], cursor: number, call: AgentCall = boundedAgent): Promise<JournalPage> {
  const books = journalBooks(input)
  const selected = books.slice(cursor, cursor + PAGE_SIZE)
  const notes: JournalNote[] = []
  let failedBooks = 0
  let index = 0
  await Promise.all(Array.from({ length: Math.min(2, selected.length) }, async () => {
    for (;;) {
      const row = selected[index++]
      if (row === undefined) return
      const bookId = id(row.bookId) || id(object(row.book).bookId)
      const [highlights, reviews] = await Promise.allSettled([
        row.noteCount === 0 ? Promise.resolve({}) : call('/book/bookmarklist', { bookId }),
        row.reviewCount === 0 ? Promise.resolve({ reviews: [] }) : fetchAllMineReviews(bookId, call),
      ])
      if (highlights.status === 'rejected' || reviews.status === 'rejected') failedBooks += 1
      const partial = reviews.status === 'rejected' && reviews.reason instanceof ReviewPaginationError ? { reviews: reviews.reason.reviews } : {}
      notes.push(...parseJournalNotes(row, highlights.status === 'fulfilled' ? highlights.value : {}, reviews.status === 'fulfilled' ? reviews.value : partial))
    }
  }))
  notes.sort((a, b) => b.createTime - a.createTime || a.id.localeCompare(b.id))
  return { notes, totalBooks: books.length, scannedBooks: selected.length, failedBooks, nextCursor: cursor + PAGE_SIZE < books.length ? cursor + PAGE_SIZE : null }
}
