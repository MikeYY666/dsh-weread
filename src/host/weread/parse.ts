/**
 * Transform raw Agent-Gateway payloads into the browser-facing DTOs in
 * `src/types.ts`.
 *
 * The reference plugin (obsidian-weread) used `window.moment` for dates and
 * `CryptoJS` to derive stable file names; this plugin renders in a web panel and
 * writes no files, so it uses plain date helpers and drops CryptoJS entirely.
 * @module dsh-weread/src/host/weread/parse
 */

import type {
  BookDetail,
  BookProgress,
  BookshelfPayload,
  Chapter,
  ChapterHighlights,
  Highlight,
  PopularHighlight,
  PublicReview,
  ReadingStats,
  ReadingStatsMode,
  Review,
  ShelfAlbum,
  ShelfBook,
  ShelfFolder,
} from '../../types.js'

/** Coerce an unknown to a finite number, else 0. */
function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

/** Coerce an unknown to a trimmed string, else ''. */
function str(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

/** weread covers are `…/s_<id>.jpg`; `t7_` is the hi-res variant. */
function hdCover(cover: string): string {
  return cover.replace('/s_', '/t7_')
}

/** Strip tags from an HTML snippet and decode a few common entities. */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Read the `progress`/`book.progress` percent and reading time from a getprogress payload. */
export function parseProgress(raw: unknown): BookProgress {
  const root = (raw ?? {}) as Record<string, unknown>
  const book = (root.book ?? {}) as Record<string, unknown>
  const progress = num(book.progress)
  const readingTime = num(book.readingTime)
  const finishSeconds = num(book.finishTime)
  const isFinished = finishSeconds > 0 || progress >= 100
  return {
    progress,
    readingTime,
    isFinished,
    // finishTime arrives in seconds; convert to ms for the DTO.
    finishTime: finishSeconds > 0 ? finishSeconds * 1000 : 0,
  }
}

/** One raw notebook entry from `/user/notebooks` or `/shelf/sync`. */
interface RawNotebook {
  book?: Record<string, unknown>
  sort?: number
  noteCount?: number
  reviewCount?: number
  /** Reading percent (0–100) carried on the notebook row itself. */
  readingProgress?: number
  /** 1 unread, 2 reading, 3 finished (weread's own marker). */
  markedStatus?: number
}

/** Read a raw book field, tolerating both notebook and shelf shapes. */
function bookOf(raw: RawNotebook): Record<string, unknown> {
  return (raw.book ?? {}) as Record<string, unknown>
}

/** Pull a display category from the book's `categories[]` (first title) or a scalar. */
function categoryOf(book: Record<string, unknown>): string | undefined {
  const categories = book.categories
  if (Array.isArray(categories) && categories.length > 0) {
    const first = categories[0] as Record<string, unknown>
    const title = str(first.title)
    if (title !== '') return title
  }
  const scalar = str(book.category)
  return scalar !== '' ? scalar : undefined
}

/** Extract a four-digit year from a `publishTime` string like "2021-08-01 00:00:00". */
function yearOf(value: unknown): number {
  const text = str(value)
  const match = /(\d{4})/.exec(text)
  if (match === null) return 0
  const year = Number(match[1])
  return Number.isFinite(year) ? year : 0
}

/**
 * Build one shelf row from a notebook/shelf entry.
 *
 * The notebook payload already carries `readingProgress` (0–100) and
 * `markedStatus` per book, so the row is fully populated without a second
 * request; `progress` is only a fallback the client may overwrite via
 * `/progress-batch` when a value is missing here.
 */
export function parseShelfBook(raw: RawNotebook): ShelfBook {
  const book = bookOf(raw)
  const bookId = str(book.bookId)
  const author = str(book.author).replace(/\[(.*?)\]/g, '【$1】')
  const lastRead = num(raw.sort)
  const progressPct = Math.min(100, Math.max(0, num(raw.readingProgress)))
  // "读完" is purely progress-based: markedStatus values are inconsistent with real
  // progress (a 12% book can be marked 3, a 56% book marked 4), and `book.finished`
  // means the TITLE is complete, not that the reader finished it. Full progress is
  // the one unambiguous signal.
  const finished = progressPct >= 100
  return {
    bookId,
    title: str(book.title),
    author,
    cover: hdCover(str(book.cover)),
    noteCount: num(raw.noteCount),
    reviewCount: num(raw.reviewCount),
    lastReadDate: lastRead > 0 ? lastRead * 1000 : 0,
    isArticle: num(book.type) === 3,
    category: categoryOf(book),
    publishYear: yearOf(book.publishTime),
    // finishTime is filled later from /progress-batch; unknown at list level.
    progress: { progress: progressPct, readingTime: 0, isFinished: finished, finishTime: 0 },
  }
}

/** Extract the notebook array from either `/user/notebooks` or `/shelf/sync`. */
export function notebookArray(raw: unknown): RawNotebook[] {
  const root = (raw ?? {}) as Record<string, unknown>
  const books = root.books
  if (Array.isArray(books)) {
    return books as RawNotebook[]
  }
  return []
}

/** Parse `/book/info` into a {@link BookDetail}. */
export function parseBookDetail(raw: unknown, progress: BookProgress): BookDetail {
  const book = (raw ?? {}) as Record<string, unknown>
  const rating = (book.newRatingDetail ?? {}) as Record<string, unknown>
  return {
    bookId: str(book.bookId),
    title: str(book.title),
    author: str(book.author).replace(/\[(.*?)\]/g, '【$1】'),
    cover: hdCover(str(book.cover)),
    intro: str(book.intro),
    category: str(book.category),
    publisher: str(book.publisher),
    isbn: str(book.isbn),
    totalWords: num(book.totalWords),
    publishTime: str(book.publishTime),
    ratingTitle: str(rating.title),
    ratingCount: num(book.newRatingCount),
    ratingGood: num(rating.good),
    ratingFair: num(rating.fair),
    ratingPoor: num(rating.poor),
    progress: progress.progress,
    readingTime: progress.readingTime,
    isFinished: progress.isFinished,
  }
}

/** Parse `/book/chapterinfo` (V2 flat `chapters`) into chapter rows. */
export function parseChapters(raw: unknown): Chapter[] {
  const root = (raw ?? {}) as Record<string, unknown>
  const list = Array.isArray(root.chapters)
    ? (root.chapters as Record<string, unknown>[])
    : Array.isArray((root.data as Record<string, unknown>[] | undefined)?.[0]?.updated)
      ? ((root.data as Record<string, unknown>[])[0]!.updated as Record<string, unknown>[])
      : []
  return list
    .map((c, index) => ({
      chapterUid: num(c.chapterUid),
      chapterIdx: num(c.chapterIdx) || index,
      title: str(c.title),
      level: num(c.level) || 1,
      isMPChapter: num(c.isMPChapter) === 1,
    }))
    .filter((c) => c.title !== '')
    .sort((a, b) => a.chapterIdx - b.chapterIdx)
}

/** Parse `/book/bookmarklist` into flat highlights keyed by chapterUid. */
export function parseHighlights(raw: unknown): HighlightWrap[] {
  const root = (raw ?? {}) as Record<string, unknown>
  const updated = Array.isArray(root.updated) ? (root.updated as Record<string, unknown>[]) : []
  const chapters = Array.isArray(root.chapters) ? (root.chapters as Record<string, unknown>[]) : []
  const titleByUid = new Map<number, string>()
  const idxByUid = new Map<number, number>()
  for (const [i, c] of chapters.entries()) {
    const uid = num(c.chapterUid)
    titleByUid.set(uid, str(c.title))
    idxByUid.set(uid, num(c.chapterIdx) || i)
  }
  return updated
    .map((h) => {
      const uid = num(h.chapterUid)
      const markText = str(h.markText)
      return {
        bookmarkId: str(h.bookmarkId).replace(/[_~]/g, '-'),
        chapterUid: uid,
        chapterTitle: titleByUid.get(uid) ?? str(h.chapterName) ?? '未知章节',
        markText,
        colorStyle: num(h.colorStyle) || 1,
        createTime: num(h.createTime) * 1000,
        chapterIdx: idxByUid.get(uid) ?? 0,
      }
    })
    .filter((h) => h.markText !== '')
}

/** A highlight plus the chapter index it belongs to, for stable grouping. */
export interface HighlightWrap extends Highlight {
  readonly chapterIdx: number
}

/** Group flat highlights by chapter, ordered by chapter index. */
export function groupHighlightsByChapter(highlights: readonly HighlightWrap[]): ChapterHighlights[] {
  const groups = new Map<number, { chapterUid: number; chapterIdx: number; chapterTitle: string; level: number; highlights: HighlightWrap[] }>()
  for (const h of highlights) {
    const existing = groups.get(h.chapterUid)
    if (existing === undefined) {
      groups.set(h.chapterUid, {
        chapterUid: h.chapterUid,
        chapterIdx: h.chapterIdx,
        chapterTitle: h.chapterTitle,
        level: 1,
        highlights: [h],
      })
    } else {
      existing.highlights.push(h)
    }
  }
  return [...groups.values()]
    .sort((a, b) => a.chapterIdx - b.chapterIdx)
    .map((g) => ({
      chapterUid: g.chapterUid,
      chapterIdx: g.chapterIdx,
      chapterTitle: g.chapterTitle,
      level: g.level,
      highlights: [...g.highlights].sort((a, b) => a.createTime - b.createTime),
    }))
}

/** Parse `/review/list/mine` into personal reviews, newest first. */
export function parseReviews(raw: unknown): Review[] {
  const root = (raw ?? {}) as Record<string, unknown>
  const reviews = Array.isArray(root.reviews) ? (root.reviews as Record<string, unknown>[]) : []
  return reviews
    .map((wrapper) => {
      const r = ((wrapper.review ?? wrapper) as Record<string, unknown>) ?? {}
      const html = str(r.htmlContent)
      const content = html !== '' ? stripHtml(html) : str(r.content)
      return {
        reviewId: str(r.reviewId),
        chapterUid: num(r.chapterUid) || undefined,
        chapterTitle: str(r.chapterTitle) || str(r.chapterName) || undefined,
        content,
        abstract: str(r.abstract) || undefined,
        createTime: num(r.createTime) * 1000,
      }
    })
    .filter((r) => r.content !== '')
}

/** Parse `/book/bestbookmarks` into popular highlights. */
export function parsePopularHighlights(raw: unknown): PopularHighlight[] {
  const root = (raw ?? {}) as Record<string, unknown>
  const items = Array.isArray(root.items) ? (root.items as Record<string, unknown>[]) : []
  const chapters = Array.isArray(root.chapters) ? (root.chapters as Record<string, unknown>[]) : []
  const titleByUid = new Map<number, string>()
  for (const c of chapters) titleByUid.set(num(c.chapterUid), str(c.title))
  return items
    .map((item) => {
      const uid = num(item.chapterUid)
      return {
        bookmarkId: str(item.bookmarkId).replace(/[_~]/g, '-'),
        chapterUid: uid,
        chapterTitle: titleByUid.get(uid) ?? '未知章节',
        markText: str(item.markText),
        totalCount: num(item.totalCount),
      }
    })
    .filter((p) => p.markText !== '')
    .sort((a, b) => b.totalCount - a.totalCount)
}

/** Parse `/review/list` (public reviews) into the DTO. */
export function parsePublicReviews(raw: unknown): PublicReview[] {
  const root = (raw ?? {}) as Record<string, unknown>
  const reviews = Array.isArray(root.reviews) ? (root.reviews as Record<string, unknown>[]) : []
  return reviews
    .map((wrapper) => {
      const r = ((wrapper.review ?? wrapper) as Record<string, unknown>) ?? {}
      const author = (r.author ?? {}) as Record<string, unknown>
      const html = str(r.htmlContent)
      const content = html !== '' ? stripHtml(html) : str(r.content)
      return {
        reviewId: str(r.reviewId),
        author: str(author.name),
        content,
        createTime: num(r.createTime) * 1000,
        likeCount: num(r.likeCount),
      }
    })
    .filter((r) => r.content !== '')
}

/** Parse `/readdata/detail` into {@link ReadingStats}. */
export function parseReadingStats(raw: unknown, mode: ReadingStatsMode): ReadingStats {
  const root = (raw ?? {}) as Record<string, unknown>
  const readStat = Array.isArray(root.readStat)
    ? (root.readStat as Record<string, unknown>[]).map((s) => ({ stat: str(s.stat), counts: str(s.counts) }))
    : []
  const readLongest = Array.isArray(root.readLongest)
    ? (root.readLongest as Record<string, unknown>[]).map((item) => {
        const book = (item.book ?? {}) as Record<string, unknown>
        const album = (item.albumInfo ?? {}) as Record<string, unknown>
        return {
          title: str(book.title) || str(album.name),
          author: str(book.author) || str(album.authorName),
          cover: book.cover !== undefined ? hdCover(str(book.cover)) : undefined,
          readTime: num(item.readTime),
        }
      })
    : []
  const preferCategory = Array.isArray(root.preferCategory)
    ? (root.preferCategory as Record<string, unknown>[]).map((c) => ({
        categoryTitle: str(c.categoryTitle),
        parentCategoryTitle: str(c.parentCategoryTitle),
        readingCount: num(c.readingCount),
        readingTime: num(c.readingTime),
      }))
    : []
  const preferAuthor = Array.isArray(root.preferAuthor)
    ? (root.preferAuthor as Record<string, unknown>[]).map((a) => ({
        name: str(a.name),
        count: num(a.count),
        readTime: str(a.readTime),
      }))
    : []
  const preferTime = Array.isArray(root.preferTime) ? (root.preferTime as unknown[]).map(num) : []
  const yearReport = Array.isArray(root.yearReport)
    ? (root.yearReport as Record<string, unknown>[]).map((y) => ({
        year: num(y.year),
        times: Array.isArray(y.times) ? (y.times as unknown[]).map(num) : [],
      }))
    : []
  const readTimesRaw = (root.readTimes ?? {}) as Record<string, unknown>
  const readTimes: Record<string, number> = {}
  for (const [k, v] of Object.entries(readTimesRaw)) readTimes[k] = num(v)

  const preferPublisher = Array.isArray(root.preferPublisher)
    ? (root.preferPublisher as Record<string, unknown>[]).map((p) => ({
        name: str(p.name),
        count: num(p.count),
      }))
    : []

  return {
    mode,
    baseTime: num(root.baseTime),
    totalReadTime: num(root.totalReadTime),
    readDays: num(root.readDays),
    dayAverageReadTime: num(root.dayAverageReadTime),
    compare: typeof root.compare === 'number' ? root.compare : undefined,
    readStat,
    readLongest,
    readTimes,
    preferCategory,
    preferAuthor,
    preferTime,
    yearReport,
    authorCount: num(root.authorCount),
    registTime: num(root.registTime),
    preferCategoryWord: str(root.preferCategoryWord) || undefined,
    preferTimeWord: str(root.preferTimeWord) || undefined,
    preferPublisher,
  }
}

// ── Book shelf (`/shelf/sync`) ────────────────────────────────────────────

/**
 * Build one shelf row from a `/shelf/sync` `books[]` entry.
 *
 * This payload is flat (no nested `book`) and carries different facts than the
 * notebook list: `finishReading` instead of a percentage, `readUpdateTime`
 * instead of `sort`, and no note/review counts at all. Progress is therefore
 * binary here (finished → 100), and `/progress-batch` fills in the real numbers
 * afterwards — exactly the fallback the notebook source already relies on.
 */
function parseSyncBook(raw: Record<string, unknown>): ShelfBook {
  const finished = num(raw.finishReading) === 1
  const lastRead = num(raw.readUpdateTime)
  return {
    bookId: str(raw.bookId),
    title: str(raw.title),
    author: str(raw.author).replace(/\[(.*?)\]/g, '【$1】'),
    cover: hdCover(str(raw.cover)),
    // The shelf payload has no per-book annotation counts, so the "有笔记"
    // filter has nothing to match on in book-shelf mode.
    noteCount: 0,
    reviewCount: 0,
    lastReadDate: lastRead > 0 ? lastRead * 1000 : 0,
    isArticle: num(raw.type) === 3,
    category: categoryOf(raw),
    publishYear: 0,
    progress: { progress: finished ? 100 : 0, readingTime: 0, isFinished: finished, finishTime: 0 },
    isTop: num(raw.isTop) === 1,
    secret: num(raw.secret) === 1,
  }
}

/**
 * Parse `/shelf/sync` `archive[]` into folders.
 *
 * Each entry is only `{ name, bookIds }`: there is no folder id upstream and
 * names are user-editable (so not unique), and the position is the only stable
 * handle — hence the synthesised `f<index>` id.
 */
function parseFolders(raw: unknown): ShelfFolder[] {
  const list = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : []
  return list.map((entry, index) => {
    const ids = Array.isArray(entry.bookIds) ? entry.bookIds : []
    return {
      id: `f${index}`,
      name: str(entry.name) || `书单 ${index + 1}`,
      bookIds: ids.map((id) => str(id)).filter((id) => id !== ''),
    }
  })
}

/** Parse `/shelf/sync` `albums[]` (audiobooks/专辑) into display rows. */
function parseAlbums(raw: unknown): ShelfAlbum[] {
  const list = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : []
  /** The payload carries no explicit order, so put recently-listened first. */
  const listenedAt = (entry: Record<string, unknown>): number =>
    num(((entry.albumInfoExtra ?? {}) as Record<string, unknown>).lectureReadUpdateTime)
  return list
    .slice()
    .sort((a, b) => listenedAt(b) - listenedAt(a))
    .map((entry) => {
      const info = (entry.albumInfo ?? {}) as Record<string, unknown>
      return {
        albumId: str(info.albumId),
        name: str(info.name),
        author: str(info.authorName),
        cover: hdCover(str(info.cover)),
        trackCount: num(info.trackCount),
        isFinished: num(info.finish) === 1,
      }
    })
    .filter((album) => album.albumId !== '' || album.name !== '')
}

/**
 * Parse the whole `/shelf/sync` payload into the book shelf the panel renders.
 *
 * Books inside a folder still appear in `books[]`, so the browser resolves a
 * folder's contents by id without extra requests.
 * @param raw - the gateway payload.
 * @returns books, folders, albums, and whether the shelf has a 文章收藏 entry.
 */
export function parseShelfSync(raw: unknown): BookshelfPayload {
  const root = (raw ?? {}) as Record<string, unknown>
  const books = (Array.isArray(root.books) ? (root.books as Record<string, unknown>[]) : [])
    .map(parseSyncBook)
    .filter((book) => book.bookId !== '')
  const mp = root.mp
  const hasArticleCollection =
    typeof mp === 'object' && mp !== null ? Object.keys(mp as Record<string, unknown>).length > 0 : Boolean(mp)
  return {
    books,
    folders: parseFolders(root.archive),
    albums: parseAlbums(root.albums),
    hasArticleCollection,
  }
}
