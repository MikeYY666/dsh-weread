/**
 * The `/api/weread/ai` streaming route.
 *
 * Reads the task + bookId from the POST body, gathers the source material from the
 * cached WeChat Reading routes, builds the prompt, and streams the model's answer
 * back as `text/plain` chunks. Errors before the first byte become a JSON envelope;
 * after streaming starts, a mid-stream failure surfaces as a trailing marker.
 * @module dsh-weread/src/host/ai/handler
 */

import type { LlmService, Logger, PluginContext } from '../../cordis.js'
import type { Cache } from '../store/cache.js'
import type { AiRequest, AiTask } from '../../types.js'
import { callAgent } from '../weread/gateway.js'
import { parseHighlights, parseReviews } from '../weread/parse.js'
import { resolveTarget, streamText } from './llm.js'
import { highlightsThemesPrompt, PROMPT_VERSION, shelfProfilePrompt, summaryPrompt } from './prompts.js'

/** Deps the AI handler shares with the rest of the routes. */
export interface AiDeps {
  readonly logger: Logger
  readonly cache: Cache
  readonly scope: PluginContext
}

const VALID_TASKS: readonly AiTask[] = ['summary', 'highlights-themes', 'shelf-profile']

/**
 * Validate and dispatch one AI request.
 * @returns a streaming text Response on success, or a JSON error envelope.
 */
export async function handleAiRoute(request: Request, deps: AiDeps): Promise<Response> {
  const { logger, cache, scope } = deps

  let body: AiRequest
  try {
    body = (await request.json()) as AiRequest
  } catch {
    return jsonError('weread/bad-request', '请求体不是合法 JSON', 400)
  }
  if (!VALID_TASKS.includes(body.task)) {
    return jsonError('weread/bad-request', `未知任务：${String(body.task)}`, 400)
  }

  const llm = scope.get<LlmService>('llm')
  if (llm === undefined || typeof llm.stream !== 'function') {
    return jsonError('weread/no-llm', '当前 dsh 未提供 LLM 服务，无法生成 AI 总结', 503)
  }

  try {
    const target = resolveTarget(llm, body.provider, body.model)
    const prompt = await buildPrompt(body, cache, request.signal)

    // Cache the assembled prompt inputs under a stable key is handled upstream;
    // here we stream directly. Chunked plain text keeps the client parse trivial.
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const delta of streamText(target, prompt.system, prompt.user, request.signal)) {
            controller.enqueue(encoder.encode(delta))
          }
          controller.close()
        } catch (error) {
          logger.warn(`dsh-weread/ai: stream failed: ${String(error)}`)
          controller.enqueue(encoder.encode(`\n\n[生成中断：${String(error)}]`))
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
        'x-weread-provider': target.provider,
        'x-weread-model': target.model,
      },
    })
  } catch (error) {
    logger.error(`dsh-weread/ai: ${String(error)}`)
    return jsonError('weread/ai-failed', String(error), 500)
  }
}

/** Assemble the prompt for one task from cached upstream data. */
async function buildPrompt(
  body: AiRequest,
  cache: Cache,
  signal?: AbortSignal,
): Promise<{ system: string; user: string }> {
  if (body.task === 'shelf-profile') {
    return buildShelfProfile(body, cache, signal)
  }
  if (body.bookId === undefined || body.bookId === '') {
    throw new Error('缺少 bookId')
  }
  const key = `weread:ai:${PROMPT_VERSION}:${body.task}:${body.bookId}`
  return cache.get(key, 60 * 60_000, async () => {
    const bookId = body.bookId as string
    const [infoRaw, hlRaw, revRaw] = await Promise.all([
      callAgent('/book/info', { bookId }, signal),
      cache.get(`weread:highlights:${bookId}`, 10 * 60_000, () =>
        callAgent('/book/bookmarklist', { bookId }, signal),
      ),
      cache.get(`weread:reviews:${bookId}`, 10 * 60_000, () =>
        callAgent('/review/list/mine', { bookid: bookId, synckey: 0 }, signal),
      ),
    ])
    const info = (infoRaw ?? {}) as Record<string, unknown>
    const title = typeof info.title === 'string' ? info.title : '未知书名'
    const author = typeof info.author === 'string' ? info.author : ''
    const intro = typeof info.intro === 'string' ? info.intro : ''

    const highlights = parseHighlights(hlRaw).map((h) => h.markText)
    const reviews = parseReviews(revRaw).map((r) => r.content)

    if (body.task === 'highlights-themes') {
      return highlightsThemesPrompt({ title, highlights })
    }
    return summaryPrompt({ title, author, intro, highlights, reviews })
  })
}

/** Build the whole-shelf reading profile prompt from cached shelf + stats. */
async function buildShelfProfile(
  body: AiRequest,
  cache: Cache,
  signal?: AbortSignal,
): Promise<{ system: string; user: string }> {
  const key = `weread:ai:${PROMPT_VERSION}:shelf-profile`
  return cache.get(key, 60 * 60_000, async () => {
    const stats = await cache.get('weread:stats:overall:', 10 * 60_000, () =>
      callAgent('/readdata/detail', { mode: 'overall' }, signal),
    )
    const statsObj = (stats ?? {}) as Record<string, unknown>
    const preferCategory = Array.isArray(statsObj.preferCategory)
      ? (statsObj.preferCategory as Record<string, unknown>[])
      : []
    const preferAuthor = Array.isArray(statsObj.preferAuthor)
      ? (statsObj.preferAuthor as Record<string, unknown>[])
      : []
    const totalReadTime = Number(statsObj.totalReadTime) || 0
    const readDays = Number(statsObj.readDays) || 0

    const shelf = await cache.get('weread:shelf', 5 * 60_000, async () => {
      const { fetchAllNotebooks } = await import('../weread/paginate.js')
      return fetchAllNotebooks(signal)
    })
    const titles = shelf
      .map((b) => {
        const book = (b.book ?? {}) as Record<string, unknown>
        return typeof book.title === 'string' ? book.title : ''
      })
      .filter((t) => t !== '')

    void body
    return shelfProfilePrompt({
      bookCount: shelf.length,
      totalReadHours: totalReadTime / 3600,
      readDays,
      categories: preferCategory.map((c) => String(c.categoryTitle ?? '')).filter(Boolean),
      authors: preferAuthor.map((a) => String(a.name ?? '')).filter(Boolean),
      titles,
    })
  })
}

/** A JSON error envelope with the given status. */
function jsonError(code: string, message: string, status: number): Response {
  return Response.json({ ok: false, error: { code, message } }, {
    status,
    headers: { 'cache-control': 'no-store' },
  })
}
