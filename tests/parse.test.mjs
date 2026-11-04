import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  groupHighlightsByChapter,
  parseChapters,
  parseHighlights,
  parsePopularHighlights,
  parseProgress,
  parseReadingStats,
  parseReviews,
  parseShelfBook,
} from '../lib/host/weread/parse.js'

test('parseShelfBook maps a notebook entry', () => {
  const raw = {
    book: { bookId: 'b1', title: '三体', author: '刘慈欣', cover: 'https://x/s_1.jpg', type: 0, publishTime: '2008-01-01 00:00:00' },
    sort: 1700000000,
    noteCount: 12,
    reviewCount: 3,
  }
  const book = parseShelfBook(raw)
  assert.equal(book.bookId, 'b1')
  assert.equal(book.title, '三体')
  assert.equal(book.cover, 'https://x/t7_1.jpg') // hi-res variant
  assert.equal(book.lastReadDate, 1700000000000)
  assert.equal(book.noteCount, 12)
  assert.equal(book.isArticle, false)
  assert.equal(book.publishYear, 2008)
  assert.deepEqual(book.progress, { progress: 0, readingTime: 0, isFinished: false })
})

test('parseShelfBook reads readingProgress and categories', () => {
  const book = parseShelfBook({
    book: { bookId: 'x', title: 't', author: 'a', categories: [{ title: '历史-历史典籍' }] },
    readingProgress: 76,
    markedStatus: 2,
  })
  assert.equal(book.progress.progress, 76)
  assert.equal(book.progress.isFinished, false)
  assert.equal(book.category, '历史-历史典籍')
})

test('parseShelfBook marks finished only at 100% progress', () => {
  const done = parseShelfBook({ book: { bookId: 'y', title: 't', finished: 1 }, readingProgress: 100, markedStatus: 4 })
  assert.equal(done.progress.isFinished, true)
  // book.finished=1 (title complete) must NOT imply the reader finished it.
  const reading = parseShelfBook({ book: { bookId: 'z', title: 't', finished: 1 }, readingProgress: 12, markedStatus: 3 })
  assert.equal(reading.progress.isFinished, false)
})

test('parseShelfBook flags articles and rewrites author brackets', () => {
  const book = parseShelfBook({ book: { bookId: 'a', title: 't', author: '[美]某人', type: 3 } })
  assert.equal(book.isArticle, true)
  assert.equal(book.author, '【美】某人')
})

test('parseProgress derives finished and reads time', () => {
  assert.deepEqual(parseProgress({ book: { progress: 100, readingTime: 3600 } }), {
    progress: 100,
    readingTime: 3600,
    isFinished: true,
  })
  assert.equal(parseProgress({ book: { progress: 40 } }).isFinished, false)
  assert.deepEqual(parseProgress(null), { progress: 0, readingTime: 0, isFinished: false })
})

test('parseChapters accepts the V2 flat chapters shape and sorts by idx', () => {
  const chapters = parseChapters({
    chapters: [
      { chapterUid: 2, chapterIdx: 2, title: 'B', level: 1 },
      { chapterUid: 1, chapterIdx: 1, title: 'A', level: 1 },
    ],
  })
  assert.deepEqual(chapters.map((c) => c.title), ['A', 'B'])
})

test('parseChapters accepts the nested data[0].updated shape', () => {
  const chapters = parseChapters({ data: [{ updated: [{ chapterUid: 9, chapterIdx: 0, title: 'X' }] }] })
  assert.equal(chapters.length, 1)
  assert.equal(chapters[0].title, 'X')
})

test('parseHighlights + groupHighlightsByChapter group by chapter', () => {
  const raw = {
    updated: [
      { bookmarkId: 'm_1', chapterUid: 10, markText: 'hello', colorStyle: 2, createTime: 100 },
      { bookmarkId: 'm_2', chapterUid: 10, markText: 'world', colorStyle: 1, createTime: 50 },
      { bookmarkId: 'm_3', chapterUid: 20, markText: 'x', createTime: 10 },
    ],
    chapters: [
      { chapterUid: 10, chapterIdx: 1, title: 'Ch1' },
      { chapterUid: 20, chapterIdx: 2, title: 'Ch2' },
    ],
  }
  const highlights = parseHighlights(raw)
  assert.equal(highlights.length, 3)
  assert.equal(highlights[0].bookmarkId, 'm-1') // underscores → dashes
  assert.equal(highlights[0].chapterTitle, 'Ch1')
  assert.equal(highlights[0].createTime, 100000) // seconds → ms

  const groups = groupHighlightsByChapter(highlights)
  assert.equal(groups.length, 2)
  assert.equal(groups[0].chapterTitle, 'Ch1')
  assert.equal(groups[0].highlights.length, 2)
  // within a chapter ordered by createTime ascending
  assert.equal(groups[0].highlights[0].markText, 'world')
})

test('parseReviews strips html and prefers htmlContent', () => {
  const reviews = parseReviews({
    reviews: [
      { review: { reviewId: 'r1', createTime: 5, content: 'plain' } },
      { review: { reviewId: 'r2', createTime: 6, htmlContent: '<p>hi <b>there</b></p>', content: 'ignored' } },
    ],
  })
  assert.equal(reviews.length, 2)
  assert.equal(reviews[1].content, 'hi there')
  assert.equal(reviews[0].createTime, 5000)
})

test('parsePopularHighlights sorts by count desc and maps chapter titles', () => {
  const popular = parsePopularHighlights({
    items: [
      { bookmarkId: 'p_1', chapterUid: 1, markText: 'a', totalCount: 10 },
      { bookmarkId: 'p_2', chapterUid: 1, markText: 'b', totalCount: 99 },
    ],
    chapters: [{ chapterUid: 1, title: 'Chapter One' }],
  })
  assert.equal(popular[0].totalCount, 99)
  assert.equal(popular[0].chapterTitle, 'Chapter One')
})

test('parseReadingStats extracts dashboard fields', () => {
  const stats = parseReadingStats(
    {
      totalReadTime: 7200,
      readDays: 5,
      dayAverageReadTime: 1440,
      compare: 0.2,
      readStat: [{ stat: '读过', counts: '10本' }],
      preferCategory: [{ categoryTitle: '文学', parentCategoryTitle: '', readingCount: 3, readingTime: 100 }],
      preferAuthor: [{ name: '某人', count: 2, readTime: '1小时' }],
      readTimes: { '1700000000000': 600 },
      yearReport: [{ year: 2025, times: [1, 2, 3] }],
    },
    'overall',
  )
  assert.equal(stats.totalReadTime, 7200)
  assert.equal(stats.mode, 'overall')
  assert.equal(stats.compare, 0.2)
  assert.equal(stats.readTimes['1700000000000'], 600)
  assert.deepEqual(stats.yearReport[0].times, [1, 2, 3])
})
