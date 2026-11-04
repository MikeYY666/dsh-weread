/**
 * Cursor pagination for `/user/notebooks`.
 *
 * V2 returns pages of at most `count` books plus a `hasMore` flag; the next page
 * is requested with `lastSort` set to the last entry's `sort`. `/shelf/sync`
 * returns the whole shelf in one response and needs no pagination.
 * @module dsh-weread/src/host/weread/paginate
 */

import { callAgent } from './gateway.js'

const PAGE_SIZE = 300
/** Hard safety cap so a malformed cursor cannot loop forever. */
const MAX_PAGES = 40

interface NotebookPage {
  books?: Array<Record<string, unknown> & { sort?: number }>
  hasMore?: number
}

/**
 * Fetch every notebook by walking the `lastSort` cursor.
 * @param signal - abort signal from the incoming request.
 * @returns the merged `books` array in shelf order.
 */
export async function fetchAllNotebooks(signal?: AbortSignal): Promise<Array<Record<string, unknown>>> {
  const all: Array<Record<string, unknown>> = []
  let lastSort: number | undefined
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params: Record<string, unknown> = { count: PAGE_SIZE }
    if (lastSort !== undefined) params.lastSort = lastSort
    const result = await callAgent<NotebookPage>('/user/notebooks', params, signal)
    const books = Array.isArray(result.books) ? result.books : []
    all.push(...books)
    if (result.hasMore !== 1 || books.length === 0) break
    const last = books[books.length - 1]
    if (last === undefined || typeof last.sort !== 'number') break
    lastSort = last.sort
  }
  return all
}
