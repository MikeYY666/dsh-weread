/**
 * The `/api/weread/*` route table.
 *
 * Each entry wraps one upstream workflow behind the dsh connection's exact Fetch
 * registry. Routes own no HTTP plumbing: they return `Response` objects and rely
 * on the connection layer for auth, Host/Origin checks, and channel routing.
 * @module dsh-weread/src/host/routes
 */

import type { Logger, PluginContext } from '../cordis.js'
import type { RouteDef } from './index.js'
import type { Envelope } from '../types.js'
import type { Cache } from './store/cache.js'
import { callAgent, validateKey, WereadError } from './weread/gateway.js'
import { fetchAllNotebooks } from './weread/paginate.js'
import {
  groupHighlightsByChapter,
  parseBookDetail,
  parseChapters,
  parseHighlights,
  parsePopularHighlights,
  parseProgress,
  parsePublicReviews,
  parseReadingStats,
  parseReviews,
  parseShelfBook,
  parseShelfSync,
} from './weread/parse.js'
import { getAuthStatus, getSettings, readConfig, setApiKey, setShelfMode, maskKey } from './config.js'
import { handleAiRoute } from './ai/handler.js'

/** Dependencies every route handler receives. */
export interface RouteDeps {
  readonly logger: Logger
  readonly cache: Cache
  readonly scope: PluginContext
}

/** One registered route plus its path for logging. */
export interface RouterEntry {
  readonly def: RouteDef
}

/** JSON success envelope, never cacheable (data is proxied live). */
function ok<T>(value: T): Response {
  return Response.json({ ok: true, value } satisfies Envelope<T>, {
    headers: { 'cache-control': 'no-store' },
  })
}

/** How many per-book progress calls run at once during a batch fill. */
const PROGRESS_CONCURRENCY = 4

/**
 * Run `worker` over `items` with at most `limit` in flight, preserving nothing
 * about order (callers key results by item). Failures are the caller's concern:
 * `worker` must catch its own so one bad book never aborts the batch.
 */
async function mapLimit<T>(items: readonly T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      await worker(items[index] as T)
    }
  })
  await Promise.all(runners)
}

/** JSON failure envelope. */
function fail(code: string, message: string, status = 500): Response {
  return Response.json({ ok: false, error: { code, message } } satisfies Envelope<never>, {
    status,
    headers: { 'cache-control': 'no-store' },
  })
}

/** Translate thrown errors into a failure envelope. */
function toResponse(error: unknown, logger: Logger, label: string): Response {
  if (error instanceof WereadError) {
    logger.warn(`dsh-weread/${label}: ${error.code} ${error.message}`)
    return fail(error.code, error.message, error.status)
  }
  logger.error(`dsh-weread/${label}: ${String(error)}`)
  return fail('weread/internal', String(error), 500)
}

/** Read a required `?bookId=` query parameter (or throw). */
function requireBookId(request: Request): string {
  const bookId = new URL(request.url).searchParams.get('bookId') ?? ''
  if (bookId === '') throw new WereadError('weread/bad-request', '缺少 bookId 参数', 400)
  return bookId
}

/** Read an optional query parameter. */
function query(request: Request, name: string): string | undefined {
  const value = new URL(request.url).searchParams.get(name)
  return value === null || value === '' ? undefined : value
}

/**
 * Build the full route table for this plugin instance.
 * @param deps - logger, cache, and the scoped context.
 */
export function createRouter(deps: RouteDeps): RouterEntry[] {
  const { logger, cache, scope } = deps

  /** Register one exact GET route. */
  function get(path: string, handler: (request: Request) => Promise<Response>): RouterEntry {
    return {
      def: { path, methods: ['GET'], requestBody: 'buffered', fetch: handler },
    }
  }

  const routes: RouterEntry[] = []

  // ── Auth ──────────────────────────────────────────────────────────────
  routes.push(
    get('/api/weread/auth/status', async () => {
      const status = getAuthStatus()
      if (status.state === 'unset') return ok(status)
      // Probe validity lazily; refresh the key prefix from storage each time.
      const verdict = await cache.get('weread:auth:valid', 60_000, () => validateKey())
      const config = readConfig()
      const message =
        verdict === 'invalid'
          ? 'API Key 无效或已过期，请在设置中更新'
          : verdict === 'blocked'
            ? 'API Key 有效，但当前网络出口被微信读书风控拦截（403），请改用可访问微信读书的代理'
            : verdict === 'unknown'
              ? '无法确认 API Key 状态（网络异常），请稍后重试'
              : undefined
      return ok({
        state: verdict === 'valid' ? 'valid' : verdict === 'invalid' ? 'invalid' : 'unknown',
        masked: maskKey(config.apiKey),
        message,
      })
    }),
  )

  // ── Shelf ─────────────────────────────────────────────────────────────
  routes.push(
    get('/api/weread/shelf', async (request) => {
      try {
        const books = await cache.get('weread:shelf', 5 * 60_000, () => fetchAllNotebooks(request.signal))
        const rows = books.map(parseShelfBook)
        return ok(rows)
      } catch (error) {
        return toResponse(error, logger, 'shelf')
      }
    }),
  )

  // The book-shelf source: everything on the WeChat-Reading shelf, plus the
  // user's folders (`archive[]`) and audiobooks (`albums[]`). `/shelf/sync`
  // returns the whole shelf in one response, so this needs no pagination.
  routes.push(
    get('/api/weread/bookshelf', async (request) => {
      try {
        const value = await cache.get('weread:bookshelf', 5 * 60_000, async () =>
          parseShelfSync(await callAgent('/shelf/sync', {}, request.signal)),
        )
        return ok(value)
      } catch (error) {
        return toResponse(error, logger, 'bookshelf')
      }
    }),
  )

  // ── Settings (non-secret) ─────────────────────────────────────────────
  // One route for both verbs: the connection's exact Fetch registry is keyed by
  // path alone and throws when a second route claims the same path, so a GET and
  // a POST must share one entry and branch on the method here.
  routes.push({
    def: {
      path: '/api/weread/settings',
      methods: ['GET', 'POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        if (request.method === 'GET') return ok(getSettings())
        try {
          const body = (await request.json()) as { shelfMode?: unknown }
          if (body.shelfMode !== 'notebooks' && body.shelfMode !== 'bookshelf') {
            throw new WereadError('weread/bad-request', 'shelfMode 只能是 notebooks 或 bookshelf', 400)
          }
          const next = setShelfMode(body.shelfMode)
          // Both list caches belong to the mode that just changed.
          cache.invalidate('weread:shelf')
          cache.invalidate('weread:bookshelf')
          return ok(next)
        } catch (error) {
          return toResponse(error, logger, 'settings')
        }
      },
    },
  })

  // Batch per-book progress for the shelf cards. The notebook list carries no
  // reliable progress, so the client asks for the visible books in chunks after
  // the grid renders, keeping the initial shelf load fast.
  routes.push(
    get('/api/weread/progress-batch', async (request) => {
      try {
        const raw = query(request, 'bookIds') ?? ''
        const ids = raw
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s !== '')
        const out: Record<string, unknown> = {}
        await mapLimit(ids, PROGRESS_CONCURRENCY, async (bookId) => {
          out[bookId] = await cache.get(`weread:progress:${bookId}`, 5 * 60_000, async () => {
            const progressRaw = await callAgent('/book/getprogress', { bookId }, request.signal).catch(() => ({}))
            return parseProgress(progressRaw)
          })
        })
        return ok(out)
      } catch (error) {
        return toResponse(error, logger, 'progress-batch')
      }
    }),
  )

  // ── Book detail + progress + chapters ─────────────────────────────────
  routes.push(
    get('/api/weread/book', async (request) => {
      try {
        const bookId = requireBookId(request)
        const value = await cache.get(`weread:book:${bookId}`, 60 * 60_000, async () => {
          const [infoRaw, progressRaw] = await Promise.all([
            callAgent('/book/info', { bookId }, request.signal),
            callAgent('/book/getprogress', { bookId }, request.signal).catch(() => ({})),
          ])
          return parseBookDetail(infoRaw, parseProgress(progressRaw))
        })
        return ok(value)
      } catch (error) {
        return toResponse(error, logger, 'book')
      }
    }),
  )

  routes.push(
    get('/api/weread/chapters', async (request) => {
      try {
        const bookId = requireBookId(request)
        const value = await cache.get(`weread:chapters:${bookId}`, 60 * 60_000, async () => {
          const raw = await callAgent('/book/chapterinfo', { bookId }, request.signal)
          return parseChapters(raw)
        })
        return ok(value)
      } catch (error) {
        return toResponse(error, logger, 'chapters')
      }
    }),
  )

  // ── Highlights / reviews / popular / public ───────────────────────────
  routes.push(
    get('/api/weread/highlights', async (request) => {
      try {
        const bookId = requireBookId(request)
        const value = await cache.get(`weread:highlights:${bookId}`, 10 * 60_000, async () => {
          const raw = await callAgent('/book/bookmarklist', { bookId }, request.signal)
          return groupHighlightsByChapter(parseHighlights(raw))
        })
        return ok(value)
      } catch (error) {
        return toResponse(error, logger, 'highlights')
      }
    }),
  )

  routes.push(
    get('/api/weread/reviews', async (request) => {
      try {
        const bookId = requireBookId(request)
        const value = await cache.get(`weread:reviews:${bookId}`, 10 * 60_000, async () => {
          const raw = await callAgent('/review/list/mine', { bookid: bookId, synckey: 0 }, request.signal)
          return parseReviews(raw)
        })
        return ok(value)
      } catch (error) {
        return toResponse(error, logger, 'reviews')
      }
    }),
  )

  routes.push(
    get('/api/weread/popular', async (request) => {
      try {
        const bookId = requireBookId(request)
        const value = await cache.get(`weread:popular:${bookId}`, 24 * 60 * 60_000, async () => {
          const raw = await callAgent('/book/bestbookmarks', { bookId, chapterUid: 0 }, request.signal)
          return parsePopularHighlights(raw)
        })
        return ok(value)
      } catch (error) {
        return toResponse(error, logger, 'popular')
      }
    }),
  )

  routes.push(
    get('/api/weread/public-reviews', async (request) => {
      try {
        const bookId = requireBookId(request)
        const value = await cache.get(`weread:public:${bookId}`, 60 * 60_000, async () => {
          const raw = await callAgent('/review/list', { bookId, reviewListType: 0, count: 30 }, request.signal)
          return parsePublicReviews(raw)
        })
        return ok(value)
      } catch (error) {
        return toResponse(error, logger, 'public-reviews')
      }
    }),
  )

  // ── Stats ─────────────────────────────────────────────────────────────
  routes.push(
    get('/api/weread/stats', async (request) => {
      try {
        const modeRaw = query(request, 'mode') ?? 'overall'
        const modes = ['weekly', 'monthly', 'annually', 'overall'] as const
        const mode: (typeof modes)[number] = modes.includes(modeRaw as (typeof modes)[number])
          ? (modeRaw as (typeof modes)[number])
          : 'overall'
        const baseTime = query(request, 'baseTime')
        const value = await cache.get(`weread:stats:${mode}:${baseTime ?? ''}`, 10 * 60_000, async () => {
          const params: Record<string, unknown> = { mode }
          if (baseTime !== undefined) params.baseTime = Number(baseTime)
          const raw = await callAgent('/readdata/detail', params, request.signal)
          return parseReadingStats(raw, mode)
        })
        return ok(value)
      } catch (error) {
        return toResponse(error, logger, 'stats')
      }
    }),
  )

  // Daily reading heatmap. `/readdata/detail?mode=monthly&baseTime=…` returns one
  // calendar month of per-day seconds (the `overall`/`annually` modes bucket by
  // year/month instead), so the heatmap walks back N months and merges their
  // day keys into one `YYYY-MM-DD → seconds` map.
  routes.push(
    get('/api/weread/heatmap', async (request) => {
      try {
        // Preferred: a specific calendar year (all 12 months). Falls back to the
        // trailing `months` window from the current month when no year is given.
        const yearRaw = query(request, 'year')
        const year = yearRaw !== undefined ? Number(yearRaw) : undefined
        const monthsRaw = Number(query(request, 'months') ?? '12')
        const months = Number.isFinite(monthsRaw) ? Math.min(24, Math.max(1, monthsRaw)) : 12
        const cacheKey = year !== undefined ? `weread:heatmap:y${year}` : `weread:heatmap:m${months}`
        const value = await cache.get(cacheKey, 30 * 60_000, async () => {
          let targets: Date[]
          if (year !== undefined && Number.isFinite(year)) {
            targets = Array.from({ length: 12 }, (_, m) => new Date(year, m, 1))
          } else {
            const now = new Date()
            const anchor = new Date(now.getFullYear(), now.getMonth(), 1)
            targets = Array.from({ length: months }, (_, i) => new Date(anchor.getFullYear(), anchor.getMonth() - i, 1))
          }
          const days: Record<string, number> = {}
          await mapLimit(targets, 3, async (monthStart) => {
            const baseTime = Math.floor(monthStart.getTime() / 1000)
            const raw = await callAgent('/readdata/detail', { mode: 'monthly', baseTime }, request.signal).catch(
              () => ({}),
            )
            const readTimes = ((raw as Record<string, unknown>).readTimes ?? {}) as Record<string, unknown>
            for (const [ts, sec] of Object.entries(readTimes)) {
              const seconds = Number(sec)
              if (!Number.isFinite(seconds) || seconds <= 0) continue
              const d = new Date(Number(ts) * 1000)
              if (Number.isNaN(d.getTime())) continue
              // Only keep days inside the requested year, so a baseTime month that
              // spills into an adjacent year does not leak into this wall.
              if (year !== undefined && Number.isFinite(year) && d.getFullYear() !== year) continue
              const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
              days[key] = (days[key] ?? 0) + seconds
            }
          })
          return days
        })
        return ok(value)
      } catch (error) {
        return toResponse(error, logger, 'heatmap')
      }
    }),
  )

  // ── AI (streaming) ────────────────────────────────────────────────────
  routes.push({
    def: {
      path: '/api/weread/ai',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: (request) => handleAiRoute(request, { logger, cache, scope }),
    },
  })

  // ── Key management (write) ────────────────────────────────────────────
  routes.push({
    def: {
      path: '/api/weread/auth/key',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const body = (await request.json()) as { apiKey?: unknown }
          const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
          cache.invalidatePrefix('weread:')
          const stored = setApiKey(apiKey)
          if (apiKey === '') return ok(stored)
          const verdict = await validateKey()
          if (verdict === 'valid') {
            return ok({ state: 'valid', masked: stored.masked })
          }
          if (verdict === 'blocked') {
            return ok({
              state: 'valid',
              masked: stored.masked,
              message: 'API Key 已保存且有效，但当前网络出口被微信读书风控拦截（403），请配置可访问微信读书的代理',
            })
          }
          if (verdict === 'invalid') {
            return ok({ state: 'invalid', masked: stored.masked, message: 'API Key 无效，请检查后重试' })
          }
          return ok({ state: 'unknown', masked: stored.masked, message: '无法确认 API Key 状态（网络异常），已保存，请稍后重试' })
        } catch (error) {
          return toResponse(error, logger, 'auth-key')
        }
      },
    },
  })

  return routes
}
