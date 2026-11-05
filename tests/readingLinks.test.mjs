/** Shared deep-link contract and book-detail highlight parsing regressions. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bookReadingUrl, buildJournalNoteLink } from '../lib/readingLinks.js'
import { buildJournalNoteLink as journalLink } from '../lib/host/weread/journal.js'
import { parseHighlights, parsePopularHighlights, groupHighlightsByChapter } from '../lib/host/weread/parse.js'

const valid = { bookmarkId: 42, chapterUid: '3', range: '0-99', markText: 'quote' }
const parsePersonal = (row, bookId) => parseHighlights({ updated: [row] }, bookId)[0]
const parsePopular = (row, bookId) => parsePopularHighlights({ items: [row] }, bookId)[0]

test('shared reading helper encodes IDs and journal keeps its existing export', () => {
  assert.equal(bookReadingUrl(42), 'weread://reading?bId=42')
  assert.equal(bookReadingUrl('a&b /中'), 'weread://reading?bId=a%26b%20%2F%E4%B8%AD')
  assert.equal(journalLink, buildJournalNoteLink)
})

for (const [name, parse] of [['personal', parsePersonal], ['popular', parsePopular]]) {
  test(`${name} highlights expose only precise documented positions`, () => {
    assert.equal(parse(valid, 'book').sourceUrl, buildJournalNoteLink('book', valid).url)
    assert.equal(parse({ ...valid, chapterUid: 0 }, 'book').sourceUrl, buildJournalNoteLink('book', { ...valid, chapterUid: 0 }).url)
    for (const chapterUid of [undefined, null, '', true, {}, -1, 1.5, Infinity, NaN, '1e2', ' 3', '3&evil=1', '9007199254740992']) {
      assert.equal(Object.hasOwn(parse({ ...valid, chapterUid }, 'book'), 'sourceUrl'), false, String(chapterUid))
    }
    for (const range of [undefined, null, 2, {}, '', '-1-3', '3-2', '3-3', '0-1.5', '0-1e2', ' 0-2', '0-2&evil=1', '0-9007199254740992']) {
      assert.equal(Object.hasOwn(parse({ ...valid, range }, 'book'), 'sourceUrl'), false, String(range))
    }
    assert.equal(Object.hasOwn(parse({ ...valid, chapterUid: undefined, chapterId: 3, rangeStart: 0, rangeEnd: 99 }, 'book'), 'sourceUrl'), false)
  })

  test(`${name} link book ID comes exclusively from the authoritative argument`, () => {
    const row = { ...valid, bookId: 42 }
    assert.equal(parse(row, '42').sourceUrl, buildJournalNoteLink('42', valid).url)
    for (const bookId of [undefined, '', 'other']) {
      assert.equal(Object.hasOwn(parse(row, bookId), 'sourceUrl'), false)
    }
    assert.equal(Object.hasOwn(parse(valid), 'sourceUrl'), false)
    assert.equal(Object.hasOwn(parse({ ...valid, bookId: 'other' }, '42'), 'sourceUrl'), false)
    assert.equal(parse(valid, 'a&b').sourceUrl, buildJournalNoteLink('a&b', valid).url)
    // Existing bookmark normalization is independent of the position link.
    assert.equal(parse({ ...valid, bookmarkId: 'a_b~c' }, '42').bookmarkId, 'a-b-c')
    assert.equal(parse(valid, '42').bookmarkId, '42')
  })

  test(`${name} absent positions preserve the complete previous DTO shape`, () => {
    const { range, ...row } = valid
    assert.deepEqual(parse(row, '42'), parse(row))
  })
}

test('chapter grouping preserves source URLs and timestamp ordering', () => {
  const highlights = parseHighlights({ updated: [
    { ...valid, createTime: 2 },
    { ...valid, bookmarkId: 'earlier', createTime: 1 },
  ] }, '42')
  const group = groupHighlightsByChapter(highlights)[0]
  assert.equal(group.highlights[0].bookmarkId, 'earlier')
  assert.ok(group.highlights.every((row) => row.sourceUrl === buildJournalNoteLink('42', valid).url))
})

test('popular rows without positions remain renderable with book reading fallback', () => {
  const items = parsePopularHighlights({ items: [
    { bookmarkId: 'missing', markText: 'popular', totalCount: 10 },
    { ...valid, totalCount: 3 },
  ] }, '42')
  assert.deepEqual(items.map((row) => row.bookmarkId), ['missing', '42'])
  assert.equal(Object.hasOwn(items[0], 'sourceUrl'), false)
  assert.equal(items[0].sourceUrl ?? bookReadingUrl('42'), 'weread://reading?bId=42')
  assert.equal(items[1].sourceUrl, buildJournalNoteLink('42', valid).url)
})
