/**
 * Typed fetch helpers over the host's `/api/weread/*` routes.
 *
 * Every route answers with the `Envelope<T>` shape, so a single `getJson` unwraps
 * success and turns a failure envelope into a thrown {@link ApiError}. AI routes
 * stream plain text instead, so they get a separate reader-based helper.
 * @module dsh-weread/client/api
 */

import type {
  AuthStatus,
  BookDetail,
  BookProgress,
  BookshelfPayload,
  ChapterHighlights,
  Envelope,
  PopularHighlight,
  PublicReview,
  ReadingStats,
  ReadingStatsMode,
  Review,
  ShelfBook,
  ShelfMode,
  WereadSettings,
} from '../types.js'

/** Base path every JSON route shares. */
const BASE = '/api/weread'

/** A failure surfaced from an envelope, carrying the host's own code. */
export class ApiError extends Error {
  /** Host error code, e.g. `weread/bad-key`. */
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

/**
 * GET one JSON route and unwrap its envelope.
 * @param path - path below {@link BASE}, with any query string already encoded.
 * @param signal - optional abort signal for cancellation.
 * @returns the success value; throws {@link ApiError} on a failure envelope.
 */
async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${BASE}${path}`, { signal })
  // The host always answers JSON for the JSON routes, including failures; a body
  // that fails to parse almost certainly came from a proxy error page instead.
  let body: Envelope<T>
  try {
    body = (await response.json()) as Envelope<T>
  } catch {
    throw new ApiError('weread/bad-response', `接口返回了非 JSON 响应（HTTP ${response.status}）`)
  }
  if (!body.ok) throw new ApiError(body.error.code, body.error.message)
  return body.value
}

/** GET `/auth/status`. */
export function fetchAuthStatus(signal?: AbortSignal): Promise<AuthStatus> {
  return getJson<AuthStatus>('/auth/status', signal)
}

/** POST `/auth/key`; an empty key clears the stored credential. */
export async function saveApiKey(apiKey: string): Promise<AuthStatus> {
  const response = await fetch(`${BASE}/auth/key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  })
  let body: Envelope<AuthStatus>
  try {
    body = (await response.json()) as Envelope<AuthStatus>
  } catch {
    throw new ApiError('weread/bad-response', `接口返回了非 JSON 响应（HTTP ${response.status}）`)
  }
  if (!body.ok) throw new ApiError(body.error.code, body.error.message)
  return body.value
}

/** GET `/shelf`. */
export function fetchShelf(signal?: AbortSignal): Promise<ShelfBook[]> {
  return getJson<ShelfBook[]>('/shelf', signal)
}

/** GET `/bookshelf` — the book-shelf source, folders and albums included. */
export function fetchBookshelf(signal?: AbortSignal): Promise<BookshelfPayload> {
  return getJson<BookshelfPayload>('/bookshelf', signal)
}

/** GET `/settings`. */
export function fetchSettings(signal?: AbortSignal): Promise<WereadSettings> {
  return getJson<WereadSettings>('/settings', signal)
}

/** POST `/settings`; returns the settings the host stored. */
export async function saveSettings(patch: { shelfMode: ShelfMode }): Promise<WereadSettings> {
  const response = await fetch(`${BASE}/settings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  })
  let body: Envelope<WereadSettings>
  try {
    body = (await response.json()) as Envelope<WereadSettings>
  } catch {
    throw new ApiError('weread/bad-response', `接口返回了非 JSON 响应（HTTP ${response.status}）`)
  }
  if (!body.ok) throw new ApiError(body.error.code, body.error.message)
  return body.value
}

/**
 * GET `/progress-batch` for the given book ids.
 * @returns a map of bookId → progress, missing ids omitted.
 */
export function fetchProgressBatch(
  bookIds: readonly string[],
  signal?: AbortSignal,
): Promise<Record<string, BookProgress>> {
  if (bookIds.length === 0) return Promise.resolve({})
  const list = bookIds.map((id) => encodeURIComponent(id)).join(',')
  return getJson<Record<string, BookProgress>>(`/progress-batch?bookIds=${list}`, signal)
}

/** GET `/book`. */
export function fetchBook(bookId: string, signal?: AbortSignal): Promise<BookDetail> {
  return getJson<BookDetail>(`/book?bookId=${encodeURIComponent(bookId)}`, signal)
}

/** GET `/highlights`, grouped by chapter. */
export function fetchHighlights(bookId: string, signal?: AbortSignal): Promise<ChapterHighlights[]> {
  return getJson<ChapterHighlights[]>(`/highlights?bookId=${encodeURIComponent(bookId)}`, signal)
}

/** GET `/reviews` (the user's own notes). */
export function fetchReviews(bookId: string, signal?: AbortSignal): Promise<Review[]> {
  return getJson<Review[]>(`/reviews?bookId=${encodeURIComponent(bookId)}`, signal)
}

/** GET `/popular` (community highlights). */
export function fetchPopular(bookId: string, signal?: AbortSignal): Promise<PopularHighlight[]> {
  return getJson<PopularHighlight[]>(`/popular?bookId=${encodeURIComponent(bookId)}`, signal)
}

/** GET `/public-reviews`. */
export function fetchPublicReviews(bookId: string, signal?: AbortSignal): Promise<PublicReview[]> {
  return getJson<PublicReview[]>(`/public-reviews?bookId=${encodeURIComponent(bookId)}`, signal)
}

/** GET `/stats` for one period. */
export function fetchStats(mode: ReadingStatsMode, signal?: AbortSignal): Promise<ReadingStats> {
  return getJson<ReadingStats>(`/stats?mode=${encodeURIComponent(mode)}`, signal)
}

/** GET `/heatmap` — a `YYYY-MM-DD → seconds` map for the last `months` months. */
export function fetchHeatmap(year: number, signal?: AbortSignal): Promise<Record<string, number>> {
  return getJson<Record<string, number>>(`/heatmap?year=${encodeURIComponent(String(year))}`, signal)
}

/** AI task names the streaming route accepts. */
export type AiTask = 'summary' | 'highlights-themes' | 'shelf-profile'

/** Options common to every AI stream request. */
export interface AiStreamOptions {
  readonly task: AiTask
  readonly bookId?: string
  readonly provider?: string
  readonly model?: string
  readonly signal?: AbortSignal
}

/**
 * The marker the host appends when a stream fails after it has started sending
 * bytes. Callers detect it to distinguish a truncated answer from a complete one.
 */
export const AI_INTERRUPT_MARKER = '[生成中断'

/**
 * POST `/ai` and stream the answer incrementally.
 *
 * The response is `text/plain`; each chunk may split a multi-byte character, so
 * decoding uses a `TextDecoder` in streaming mode. `onChunk` receives the growing
 * accumulated text after every non-empty delta, which drives the typing effect.
 *
 * A pre-stream failure comes back as a JSON envelope (non-OK status), reported here
 * as {@link ApiError}; a mid-stream failure arrives inside the text and is the
 * caller's to detect via {@link AI_INTERRUPT_MARKER}.
 *
 * @param options - task + optional book/provider/model and an abort signal.
 * @param onChunk - called with the full text so far after each delta.
 * @returns the complete accumulated text when the stream closes.
 */
export async function streamAi(options: AiStreamOptions, onChunk: (text: string) => void): Promise<string> {
  const body: Record<string, unknown> = { task: options.task }
  if (options.bookId !== undefined) body.bookId = options.bookId
  if (options.provider !== undefined && options.model !== undefined) {
    body.provider = options.provider
    body.model = options.model
  }
  const response = await fetch(`${BASE}/ai`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: options.signal,
  })

  // Errors before the first byte are JSON envelopes, not a text stream.
  const contentType = response.headers.get('content-type') ?? ''
  if (!response.ok || contentType.includes('application/json')) {
    let message = `AI 生成失败（HTTP ${response.status}）`
    let code = 'weread/ai-failed'
    try {
      const envelope = (await response.json()) as Envelope<never>
      if (!envelope.ok) {
        message = envelope.error.message
        code = envelope.error.code
      }
    } catch {
      // Keep the generic message; the status is already meaningful.
    }
    throw new ApiError(code, message)
  }

  if (response.body === null) {
    throw new ApiError('weread/ai-failed', 'AI 响应没有可读取的流')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value === undefined) continue
      const delta = decoder.decode(value, { stream: true })
      if (delta === '') continue
      text += delta
      onChunk(text)
    }
    // Flush any trailing partial multi-byte sequence.
    const tail = decoder.decode()
    if (tail !== '') {
      text += tail
      onChunk(text)
    }
  } finally {
    reader.releaseLock()
  }
  return text
}
