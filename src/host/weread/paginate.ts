/**
 * Complete cursor pagination for `/user/notebooks`.
 * Invalid cursors and safety cutoffs fail explicitly so the journal never treats
 * a truncated notebook list as a complete account history.
 * @module dsh-weread/src/host/weread/paginate
 */
import { callAgent, WereadError } from './gateway.js'

const PAGE_SIZE = 300
const MAX_PAGES = 40

type NotebookCall = (api: string, params: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>

/**
 * Fetch every notebook in upstream order, honoring caller cancellation when
 * present while bounding each call even for shared cache producers.
 */
export async function fetchAllNotebooks(signal?: AbortSignal, call: NotebookCall = callAgent, maxPages = MAX_PAGES): Promise<Array<Record<string, unknown>>> {
  const all: Array<Record<string, unknown>> = []
  const seen = new Set<number>()
  let lastSort: number | undefined
  for (let page = 0; page < maxPages; page += 1) {
    const params: Record<string, unknown> = { count: PAGE_SIZE }
    if (lastSort !== undefined) params.lastSort = lastSort
    const timeout = AbortSignal.timeout(30_000)
    const raw = await call('/user/notebooks', params, signal === undefined ? timeout : AbortSignal.any([signal, timeout]))
    const result = raw !== null && typeof raw === 'object' ? raw as Record<string, unknown> : {}
    const books = Array.isArray(result.books) ? result.books.filter((book): book is Record<string, unknown> => book !== null && typeof book === 'object' && !Array.isArray(book)) : []
    all.push(...books)
    if (result.hasMore !== 1 && result.hasMore !== true && result.hasMore !== '1') return all
    const sort = books.at(-1)?.sort
    if (books.length === 0 || typeof sort !== 'number' || !Number.isSafeInteger(sort) || sort < 0 || seen.has(sort)) {
      throw new WereadError('weread/incomplete-notebooks', '笔记本分页游标缺失、无效或重复，列表未完整获取', 502)
    }
    seen.add(sort)
    lastSort = sort
  }
  throw new WereadError('weread/incomplete-notebooks', '笔记本分页超过安全页数，列表未完整获取', 502)
}
