/**
 * The wire contract shared by both halves of dsh-weread.
 *
 * The host serializes these DTOs over the `/api/weread/*` routes; the browser
 * half only consumes the shapes, so this module stays free of runtime imports
 * and can be compiled into either side.
 * @module dsh-weread/src/types
 */

/** The envelope every host route answers with. */
export type Envelope<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** Reading progress of one shelf book, as resolved from `/book/getprogress`. */
export interface BookProgress {
  /** 0–100 */
  readonly progress: number
  /** Total reading time in seconds. */
  readonly readingTime: number
  readonly isFinished: boolean
  /** When the book was finished, in ms epoch (0 when not finished / unknown). */
  readonly finishTime: number
}

/** One row in the shelf grid. */
export interface ShelfBook {
  readonly bookId: string
  readonly title: string
  readonly author: string
  /** Hi-res cover URL (`/t7_` variant). */
  readonly cover: string
  readonly noteCount: number
  readonly reviewCount: number
  /** ms epoch of the last read, or 0. */
  readonly lastReadDate: number
  /** True for official-account articles (bookType 3). */
  readonly isArticle: boolean
  /** Category / publisher when known from the shelf payload. */
  readonly category?: string
  /** Publication year parsed from `publishTime`, or 0 when unknown. */
  readonly publishYear: number
  readonly progress: BookProgress
  /**
   * True when the user pinned this book (`isTop` in `/shelf/sync`). Only the
   * book-shelf source carries it; the notebook source leaves it undefined.
   */
  readonly isTop?: boolean
  /** True for a 私密阅读 book (`secret` in `/shelf/sync`). */
  readonly secret?: boolean
}

/** Book metadata for the detail header. */
export interface BookDetail {
  readonly bookId: string
  readonly title: string
  readonly author: string
  readonly cover: string
  readonly intro: string
  readonly category: string
  readonly publisher: string
  readonly isbn: string
  readonly totalWords: number
  readonly publishTime: string
  /** Rating label, e.g. 神作 / 好评如潮. */
  readonly ratingTitle: string
  readonly ratingCount: number
  readonly ratingGood: number
  readonly ratingFair: number
  readonly ratingPoor: number
  /** 0–100 progress. */
  readonly progress: number
  /** Reading time in seconds. */
  readonly readingTime: number
  readonly isFinished: boolean
}

/** One chapter entry. */
export interface Chapter {
  readonly chapterUid: number
  readonly chapterIdx: number
  readonly title: string
  readonly level: number
  readonly isMPChapter: boolean
}

/** One of the user's highlights. */
export interface Highlight {
  readonly bookmarkId: string
  readonly chapterUid: number
  readonly chapterTitle: string
  readonly markText: string
  /** 1–5 weread color style. */
  readonly colorStyle: number
  /** ms epoch. */
  readonly createTime: number
  /** The user's thought attached to this highlight, when present. */
  readonly reviewContent?: string
  readonly isPopular?: boolean
  readonly popularCount?: number
}

/** A highlight grouped under its chapter for display. */
export interface ChapterHighlights {
  readonly chapterUid: number
  readonly chapterIdx: number
  readonly chapterTitle: string
  readonly level: number
  readonly highlights: readonly Highlight[]
}

/** One personal review / thought. */
export interface Review {
  readonly reviewId: string
  readonly chapterUid?: number
  readonly chapterTitle?: string
  /** Plain-text (or lightly markdowned) content. */
  readonly content: string
  readonly abstract?: string
  /** ms epoch. */
  readonly createTime: number
}

/** A popular (community) highlight. */
export interface PopularHighlight {
  readonly bookmarkId: string
  readonly chapterUid: number
  readonly chapterTitle: string
  readonly markText: string
  /** Number of co-readers who highlighted it. */
  readonly totalCount: number
}

/** A public book review. */
export interface PublicReview {
  readonly reviewId: string
  readonly author: string
  readonly content: string
  readonly createTime: number
  readonly likeCount: number
}

// ── Reading stats (`/readdata/detail`) ─────────────────────────────────────

export type ReadingStatsMode = 'weekly' | 'monthly' | 'annually' | 'overall'

/** One labeled counter, e.g. {stat:'读过', counts:'98本'}. */
export interface ReadingStatItem {
  readonly stat: string
  readonly counts: string
}

/** Category preference row. */
export interface ReadingCategoryPref {
  readonly categoryTitle: string
  readonly parentCategoryTitle: string
  readonly readingCount: number
  /** seconds */
  readonly readingTime: number
}

/** Author preference row. */
export interface ReadingAuthorPref {
  readonly name: string
  readonly count: number
  /** preformatted, e.g. "5小时30分钟" */
  readonly readTime: string
}

/** Longest-read item (a book). */
export interface ReadingLongestItem {
  readonly title: string
  readonly author: string
  readonly cover?: string
  /** seconds */
  readonly readTime: number
}

/** One year's monthly reading times (seconds, 12 entries). */
export interface YearReportEntry {
  readonly year: number
  readonly times: readonly number[]
}

/** Full reading-stats payload for the dashboard. */
export interface ReadingStats {
  readonly mode: ReadingStatsMode
  readonly baseTime: number
  /** seconds */
  readonly totalReadTime: number
  readonly readDays: number
  /** seconds */
  readonly dayAverageReadTime: number
  /** fractional change vs previous period, e.g. 0.2 = +20% */
  readonly compare?: number
  readonly readStat: readonly ReadingStatItem[]
  readonly readLongest: readonly ReadingLongestItem[]
  /**
   * Period reading times. The KEY GRANULARITY depends on `mode`: `overall`
   * buckets by year, `annually` by month, `monthly`/`weekly` by day. Only the
   * daily granularity is renderable as a calendar heatmap; use `/heatmap` for
   * that instead. Keys are epoch seconds; values are seconds read.
   */
  readonly readTimes: Readonly<Record<string, number>>
  readonly preferCategory: readonly ReadingCategoryPref[]
  readonly preferAuthor: readonly ReadingAuthorPref[]
  /** 24h distribution from 06:00, each value = seconds. */
  readonly preferTime: readonly number[]
  readonly yearReport: readonly YearReportEntry[]
  /** Distinct authors read, when reported. */
  readonly authorCount: number
  /** Epoch seconds of registration, or 0. */
  readonly registTime: number
  /** weread's own one-line summaries, e.g. "偏好阅读历史". */
  readonly preferCategoryWord?: string
  readonly preferTimeWord?: string
  /** Top publishers by books read. */
  readonly preferPublisher: readonly { readonly name: string; readonly count: number }[]
}

// ── Shelf sources (`/shelf/sync` vs `/user/notebooks`) ────────────────────

/**
 * Which upstream list feeds the 书架 tab.
 *
 * - `notebooks` — `/user/notebooks`, the note-oriented list; carries note and
 *   review counts, but has no folders and only books the user ever annotated.
 * - `bookshelf` — `/shelf/sync`, the real WeChat-Reading shelf: every book on
 *   the shelf, plus the user's folders (书单) and audiobooks (专辑).
 */
export type ShelfMode = 'notebooks' | 'bookshelf'

/**
 * One user folder from `/shelf/sync` `archive[]`.
 *
 * WeRead returns only a name and the contained book ids, so `id` is synthesised
 * from the entry's position — names are user-editable and not guaranteed unique.
 */
export interface ShelfFolder {
  readonly id: string
  readonly name: string
  /** Book ids inside this folder, in the server's order. */
  readonly bookIds: readonly string[]
}

/** One audiobook / 专辑 from `/shelf/sync` `albums[]`. */
export interface ShelfAlbum {
  readonly albumId: string
  readonly name: string
  /** Narrator / author. */
  readonly author: string
  readonly cover: string
  readonly trackCount: number
  readonly isFinished: boolean
}

/**
 * `/api/weread/bookshelf`: the book-shelf source, folders and albums included.
 *
 * `books` is the shelf's own book array; a book that sits in a folder still
 * appears here, so the browser can resolve folder contents without extra calls.
 */
export interface BookshelfPayload {
  readonly books: readonly ShelfBook[]
  readonly folders: readonly ShelfFolder[]
  readonly albums: readonly ShelfAlbum[]
  /** `mp` is present, i.e. the shelf shows a 文章收藏 entry. */
  readonly hasArticleCollection: boolean
}

/** Persisted plugin settings the panel can change. */
export interface WereadSettings {
  readonly shelfMode: ShelfMode
}

// ── Auth ──────────────────────────────────────────────────────────────────

export type AuthState = 'unset' | 'valid' | 'invalid' | 'unknown'

/** Credential status shown in the settings panel. */
export interface AuthStatus {
  readonly state: AuthState
  /** Masked key prefix, e.g. "wrk-****1234". */
  readonly masked?: string
  readonly message?: string
}

// ── AI ────────────────────────────────────────────────────────────────────

export type AiTask = 'summary' | 'highlights-themes' | 'shelf-profile'

/** Request body for `/api/weread/ai/*`. */
export interface AiRequest {
  readonly task: AiTask
  readonly bookId?: string
  /** Optional provider/model overrides; both must be set together. */
  readonly provider?: string
  readonly model?: string
}

/** Non-streaming failure shape for AI routes (success is a text stream). */
export interface AiError {
  readonly code: string
  readonly message: string
}

/** One dated personal note for 今日 / 回顾. */
export interface JournalNote {
  /** Stable across pages; includes the book and note kind. */
  readonly id: string
  readonly kind: 'highlight' | 'thought'
  readonly bookId: string
  readonly bookTitle: string
  readonly author: string
  readonly cover: string
  readonly chapterTitle: string
  readonly text: string
  /** Finite, positive epoch milliseconds; undated notes are omitted. */
  readonly createTime: number
}

/** Account-scoped persistent journal; stale notes stay visible during host sync. */
export interface JournalCacheState {
  readonly notes: readonly JournalNote[]
  readonly totalBooks: number
  readonly scannedBooks: number
  readonly failedBooks: number
  readonly syncing: boolean
  /** Epoch milliseconds of the last complete successful sync; 0 before success. */
  readonly updatedAt: number
  readonly error: string
  readonly hasCache: boolean
}

/** A page scans up to six notebook books, using a book-offset cursor. */
export interface JournalPage {
  /** Carry on subsequent requests to keep notebook offsets stable for 30 minutes. */
  readonly snapshot?: string
  readonly notes: readonly JournalNote[]
  readonly totalBooks: number
  readonly nextCursor: number | null
  /** Books with failed upstream operations; successful notes remain available. */
  readonly failedBooks: number
  readonly scannedBooks: number
}
