import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchAllMineReviews, fetchJournalPage, journalBooks, parseJournalCursor, parseJournalNotes, ReviewPaginationError } from '../lib/host/weread/journal.js'
import { createRouter } from '../lib/host/routes.js'
import { fetchAllNotebooks } from '../lib/host/weread/paginate.js'
import { createCache } from '../lib/host/store/cache.js'

const notebook = (bookId) => ({ bookId, book: { title: `Book ${bookId}`, author: 'Author', cover: 'https://x/s_cover' } })
const thought = (reviewId, createTime = 1700000000) => ({ review: { reviewId, content: 'thought', createTime, chapterName: 'Chapter' } })

test('notebook pagination completes in order with bounded independent signals', async () => {
  const calls = []
  const books = await fetchAllNotebooks(undefined, async (api, params, signal) => {
    assert.equal(api, '/user/notebooks')
    assert.ok(signal instanceof AbortSignal)
    assert.equal(signal.aborted, false)
    calls.push(params)
    return params.lastSort === undefined ? { books: [{ bookId: 'a', sort: 5 }], hasMore: 1 } : { books: [{ bookId: 'b', sort: 4 }], hasMore: 0 }
  })
  assert.deepEqual(books.map((book) => book.bookId), ['a', 'b'])
  assert.deepEqual(calls, [{ count: 300 }, { count: 300, lastSort: 5 }])
  assert.deepEqual(await fetchAllNotebooks(undefined, async () => ({})), [])
  const aborted = AbortSignal.abort()
  await fetchAllNotebooks(aborted, async (api, params, signal) => { assert.equal(signal.aborted, true); return {} })
})

test('notebook pagination rejects empty continuation, missing/invalid/repeated cursors and safety truncation', async () => {
  for (const sort of [undefined, null, '5', NaN, Infinity, -1]) {
    await assert.rejects(fetchAllNotebooks(undefined, async () => ({ books: [{ bookId: 'a', sort }], hasMore: 1 })), (error) => error.code === 'weread/incomplete-notebooks')
  }
  await assert.rejects(fetchAllNotebooks(undefined, async () => ({ books: [], hasMore: 1 })), /列表未完整/)
  await assert.rejects(fetchAllNotebooks(undefined, async () => ({ books: [{ sort: 5 }], hasMore: 1 })), /重复/)
  let pages = 0
  await assert.rejects(fetchAllNotebooks(undefined, async () => ({ books: [{ sort: ++pages }], hasMore: 1 }), 2), /安全页数/)
  assert.equal(pages, 2)
})

test('journal cursor validates exact nonnegative safe integers', () => {
  assert.equal(parseJournalCursor(null), 0)
  assert.equal(parseJournalCursor('6'), 6)
  for (const value of ['', '-1', '1.2', '1e2', ' 6', '+6', 'Infinity', '9007199254740992']) {
    assert.throws(() => parseJournalCursor(value), (error) => error.status === 400)
  }
})

test('journal normalizes numeric IDs, nested-only books, sparse fields and source-scoped duplicates', () => {
  assert.deepEqual(parseJournalNotes(null, null, null), [])
  const notes = parseJournalNotes({ book: { bookId: 42 } }, {
    chapters: [null, { chapterUid: 3, title: 'Chapter' }],
    updated: [null, { bookmarkId: 7, markText: ' quote ', chapterUid: 3, createTime: 1700000000 }, { bookmarkId: 7, markText: 'duplicate', createTime: 1700000000 }],
  }, { reviews: [null, thought(7), thought('7')] })
  assert.equal(notes.length, 2)
  assert.deepEqual(notes.map((note) => note.id), ['42:highlight:7', '42:thought:7'])
  assert.ok(notes.every((note) => note.createTime === 1700000000000 && note.bookTitle === '' && note.cover === ''))
  assert.equal(notes[0].chapterTitle, 'Chapter')
  assert.equal(notes[0].text, 'quote')
  assert.equal(notes[1].chapterTitle, 'Chapter')
})

test('journal excludes empty text, missing IDs, bookmarks and unknown/nonfinite dates', () => {
  const highlights = [undefined, null, 0, -1, Infinity, NaN, '', 'bad', 'Infinity', 1e308].map((createTime, index) => ({ bookmarkId: index, markText: 'text', createTime }))
  highlights.push({ bookmarkId: 'blank', markText: '  ', createTime: 1700000000 }, { markText: 'no id', createTime: 1700000000 }, { bookmarkId: 'bookmark', type: 0, markText: 'bookmark', createTime: 1700000000 })
  assert.deepEqual(parseJournalNotes(notebook('b'), { updated: highlights }, { reviews: [thought('bad', Infinity)] }), [])
})

test('journalBooks deduplicates without dropping rows lacking the outer bookId', () => {
  const nested = { book: { bookId: 2, title: 'nested' } }
  assert.deepEqual(journalBooks([null, {}, notebook(1), notebook('1'), nested]), [notebook(1), nested])
})

test('personal reviews follow every synckey and deduplicate numeric/string IDs', async () => {
  const params = []
  const result = await fetchAllMineReviews('b', async (api, input) => {
    assert.equal(api, '/review/list/mine')
    params.push(input)
    return input.synckey === 0 ? { reviews: [thought(1)], hasMore: 1, synckey: 9 } : { reviews: [thought('1'), thought(2)], hasMore: 0 }
  })
  assert.deepEqual(params.map((item) => item.synckey), [0, 9])
  assert.ok(params.every((item) => item.bookid === 'b' && item.count === 100))
  assert.deepEqual(result.reviews.map((item) => item.review.reviewId), ['1', '2'])
})

test('personal reviews explicitly fail on missing/invalid/cyclic cursor and page safety cap', async () => {
  for (const synckey of [undefined, null, '9', NaN, Infinity, -1, 0]) {
    await assert.rejects(fetchAllMineReviews('b', async () => ({ reviews: [thought(1)], hasMore: 1, synckey })), (error) => error instanceof ReviewPaginationError && error.reviews.length === 1)
  }
  let count = 0
  await assert.rejects(fetchAllMineReviews('b', async () => ({ reviews: [thought(++count)], hasMore: 1, synckey: count }), 2), /安全页数/)
  assert.equal(count, 2)
  await assert.rejects(fetchAllMineReviews('b', async (api, params) => ({ reviews: [], hasMore: 1, synckey: params.synckey === 0 ? 2 : 2 })), /重复/)
})

test('review pagination errors retain successful pages and initial errors preserve their status', async () => {
  const initial = Object.assign(new Error('auth'), { status: 401 })
  await assert.rejects(fetchAllMineReviews('b', async () => { throw initial }), (error) => error === initial)
  await assert.rejects(fetchAllMineReviews('b', async (api, params) => {
    if (params.synckey !== 0) throw new Error('network')
    return { reviews: [thought(1)], hasMore: 1, synckey: 2 }
  }), (error) => error instanceof ReviewPaginationError && error.reviews.length === 1)
})

test('journal scans six ordered books with at most two books in flight and retains partial successes', async () => {
  const active = new Set()
  let maxActive = 0
  const calls = []
  const page = await fetchJournalPage(Array.from({ length: 8 }, (_, index) => notebook(index + 1)), 0, async (api, params) => {
    const bookId = params.bookId ?? params.bookid
    active.add(bookId)
    maxActive = Math.max(maxActive, active.size)
    calls.push([api, bookId])
    await new Promise((resolve) => setImmediate(resolve))
    if (api === '/book/bookmarklist') return { updated: [{ bookmarkId: 'h', markText: 'highlight', createTime: 1700000000 }] }
    active.delete(bookId)
    if (bookId === '2') throw new Error('book source failed')
    if (bookId === '3') return { reviews: [thought('partial')], hasMore: 1, synckey: 0 }
    return { reviews: [thought('r')], hasMore: 0 }
  })
  assert.equal(maxActive, 2)
  assert.equal(calls.length, 12)
  assert.equal(page.totalBooks, 8)
  assert.equal(page.scannedBooks, 6)
  assert.equal(page.failedBooks, 2)
  assert.equal(page.nextCursor, 6)
  assert.equal(page.notes.length, 11)
  assert.ok(page.notes.some((note) => note.id === '2:highlight:h'))
  assert.ok(page.notes.some((note) => note.id === '3:thought:partial'))
  const tail = await fetchJournalPage(Array.from({ length: 8 }, (_, index) => notebook(index + 1)), 6, async () => ({}))
  assert.equal(tail.scannedBooks, 2)
  assert.equal(tail.nextCursor, null)
  assert.deepEqual(await fetchJournalPage([], 0), { notes: [], totalBooks: 0, scannedBooks: 0, failedBooks: 0, nextCursor: null })
})

test('journal skips explicitly zero sources and still fetches unknown counts', async () => {
  const calls = []
  const books = [
    { ...notebook('bookmark-only'), noteCount: 0, reviewCount: 0 },
    { ...notebook('no-highlights'), noteCount: 0 },
    { ...notebook('no-reviews'), reviewCount: 0 },
    { ...notebook('unknown'), noteCount: '0', reviewCount: null },
  ]
  await fetchJournalPage(books, 0, async (api, params) => { calls.push([api, params.bookId ?? params.bookid]); return {} })
  assert.deepEqual(calls.filter(([, bookId]) => bookId === 'bookmark-only'), [])
  assert.deepEqual(calls.filter(([, bookId]) => bookId === 'no-highlights').map(([api]) => api), ['/review/list/mine'])
  assert.deepEqual(calls.filter(([, bookId]) => bookId === 'no-reviews').map(([api]) => api), ['/book/bookmarklist'])
  assert.equal(calls.filter(([, bookId]) => bookId === 'unknown').length, 2)
})

test('journal snapshot freezes notebook order and expires explicitly instead of mixing lists', async () => {
  const cache = createCache()
  const books = Array.from({ length: 8 }, (_, index) => ({ ...notebook(index), noteCount: 0, reviewCount: 0 }))
  await cache.get('weread:journal:notebooks:raw', 300000, async () => books)
  const route = createRouter({ cache, logger: { warn() {}, error() {} }, scope: {} }).find((entry) => entry.def.path === '/api/weread/journal-notes').def
  const request = (query) => route.fetch(new Request(`http://localhost/api/weread/journal-notes?${query}`))
  const first = (await (await request('cursor=0')).json()).value
  assert.match(first.snapshot, /^[a-f0-9]{32}$/)
  assert.equal(first.totalBooks, 8)
  cache.invalidate('weread:journal:notebooks:raw')
  await cache.get('weread:journal:notebooks:raw', 300000, async () => books.slice(0, 1))
  const tail = (await (await request(`cursor=6&snapshot=${first.snapshot}`)).json()).value
  assert.equal(tail.totalBooks, 8)
  assert.equal(tail.scannedBooks, 2)
  assert.equal(tail.snapshot, first.snapshot)
  const fresh = (await (await request('cursor=0')).json()).value
  assert.equal(fresh.totalBooks, 1)
  assert.notEqual(fresh.snapshot, first.snapshot)
  cache.invalidate(`weread:journal:snapshot:${first.snapshot}`)
  const expired = await request(`cursor=6&snapshot=${first.snapshot}`)
  assert.equal(expired.status, 409)
  assert.equal((await expired.json()).error.code, 'weread/journal-snapshot-expired')
  for (const query of ['snapshot=', 'snapshot=bad', `snapshot=${fresh.snapshot}&snapshot=${fresh.snapshot}`]) assert.equal((await request(query)).status, 400)
})

test('journal route rejects malformed/repeated cursors and invalidates partial pages', async () => {
  const keys = []
  const invalidated = []
  const value = { notes: [], totalBooks: 6, scannedBooks: 6, failedBooks: 1, nextCursor: null }
  const cache = { get: async (key, ttl, produce) => { keys.push(key); return key.includes(':page:') ? value : key.endsWith(':raw') ? [] : produce() }, invalidate: (key) => invalidated.push(key) }
  const logger = { warn() {}, error() {} }
  const route = createRouter({ cache, logger, scope: {} }).find((entry) => entry.def.path === '/api/weread/journal-notes').def
  for (const query of ['cursor=', 'cursor=-1', 'cursor=1.5', 'cursor=0&cursor=6']) {
    const response = await route.fetch(new Request(`http://localhost/api/weread/journal-notes?${query}`))
    assert.equal(response.status, 400)
    assert.equal((await response.json()).ok, false)
  }
  assert.equal(keys.length, 0)
  const response = await route.fetch(new Request('http://localhost/api/weread/journal-notes?cursor=6'))
  assert.deepEqual(await response.json(), { ok: true, value })
  assert.equal(keys[0], 'weread:journal:notebooks:raw')
  assert.match(keys[1], /^weread:journal:snapshot:[a-f0-9]{32}$/)
  assert.match(keys[2], /^weread:journal:page:[a-f0-9]{32}:6$/)
  assert.deepEqual(invalidated, [keys[2]])
})
