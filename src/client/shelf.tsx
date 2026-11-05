/**
 * The 书架 (Shelf) tab: a searchable, filterable, sortable grid of the user's
 * books. Selecting a card lifts the book id to the drawer, which swaps in the
 * detail view.
 * @module dsh-weread/client/shelf
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApiError, fetchProgressBatch, fetchShelf } from './api.js'
import { compactNumber, date, percent } from './format.js'
import type { ShelfBook } from '../types.js'
import { readYearOf } from './readyear.js'

/** How many book ids ride one `/progress-batch` request. */
const PROGRESS_CHUNK = 20

/** Which books survive the toolbar's filter. */
type ShelfFilter = 'all' | 'reading' | 'finished' | 'noted'

/** The toolbar's sort orders. */
type ShelfSort = 'recent' | 'title' | 'progress'

/** How the grid is sectioned. */
type ShelfGroup = 'none' | 'category' | 'year'

export interface ShelfProps {
  /** Open a book's detail view. */
  readonly onOpenBook: (bookId: string) => void
}

/** Prettier filter labels for the toolbar. */
const FILTER_LABELS: ReadonlyArray<{ id: ShelfFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'reading', label: '在读' },
  { id: 'finished', label: '读完' },
  { id: 'noted', label: '有笔记' },
]

/** Prettier sort labels for the toolbar. */
const SORT_LABELS: ReadonlyArray<{ id: ShelfSort; label: string }> = [
  { id: 'recent', label: '最近阅读' },
  { id: 'title', label: '书名' },
  { id: 'progress', label: '进度' },
]

/** Prettier group labels for the toolbar. */
const GROUP_LABELS: ReadonlyArray<{ id: ShelfGroup; label: string }> = [
  { id: 'none', label: '不分组' },
  { id: 'category', label: '按分类' },
  { id: 'year', label: '按年份' },
]

/** One rendered section: a heading and the books under it. */
interface ShelfSection {
  readonly key: string
  readonly label: string
  readonly books: readonly ShelfBook[]
}

/**
 * Section the (already filtered+sorted) books by the chosen grouping.
 *
 * Category groups use the book's own category path (its first segment becomes
 * the heading so `个人成长-沟通表达` lands under `个人成长`); unknown categories
 * collect under `未分类`. Year groups use the READING year (the year of the
 * book's last-read date), newest first, with `未知年份` last. `none` yields one
 * unlabeled section.
 */
function sectionize(books: readonly ShelfBook[], group: ShelfGroup): ShelfSection[] {
  if (group === 'none') return [{ key: 'all', label: '', books }]

  const buckets = new Map<string, { label: string; sortKey: number; books: ShelfBook[] }>()
  for (const book of books) {
    let key: string
    let label: string
    let sortKey: number
    if (group === 'year') {
      // Year = finish year for finished books (accurate), else last-read year.
      const year = readYearOf(book)
      key = `y:${year}`
      label = year > 0 ? `${year} 年` : '未知年份'
      sortKey = year === 0 ? -Infinity : -year // newest first; unknown last
    } else {
      const raw = (book.category ?? '').trim()
      const head = raw === '' ? '' : raw.split(/[-—/]/)[0]!.trim() || raw
      key = `c:${head === '' ? '∅' : head}`
      label = head === '' ? '未分类' : head
      sortKey = head === '' ? Infinity : 0 // unknown last
    }
    const bucket = buckets.get(key)
    if (bucket === undefined) buckets.set(key, { label, sortKey, books: [book] })
    else bucket.books.push(book)
  }

  return [...buckets.entries()]
    .map(([key, bucket]) => ({ key, label: bucket.label, sortKey: bucket.sortKey, books: bucket.books }))
    .sort((a, b) => (a.sortKey !== b.sortKey ? a.sortKey - b.sortKey : titleCollator.compare(a.label, b.label)))
    .map(({ key, label, books: sectionBooks }) => ({ key, label, books: sectionBooks }))
}

/** Compare two books by title using the locale-aware collator (Chinese pinyin). */
const titleCollator = new Intl.Collator('zh-Hans-CN', { sensitivity: 'base' })

/** True when a book matches the active filter. */
function matchesFilter(book: ShelfBook, filter: ShelfFilter): boolean {
  switch (filter) {
    case 'reading':
      return !book.progress.isFinished && book.progress.progress > 0
    case 'finished':
      return book.progress.isFinished
    case 'noted':
      return book.noteCount > 0 || book.reviewCount > 0
    case 'all':
    default:
      return true
  }
}

/** Order books for the active sort. */
function compareBooks(a: ShelfBook, b: ShelfBook, sort: ShelfSort): number {
  switch (sort) {
    case 'title':
      return titleCollator.compare(a.title, b.title)
    case 'progress':
      return b.progress.progress - a.progress.progress
    case 'recent':
    default:
      return b.lastReadDate - a.lastReadDate
  }
}

/** One book card. */
function BookCard({ book, onOpen }: { book: ShelfBook; onOpen: () => void }): ReactNode {
  const pct = Math.min(100, Math.max(0, book.progress.progress))
  const noted = book.noteCount > 0 || book.reviewCount > 0
  return (
    <button type="button" className="weread-card" onClick={onOpen} title={book.title}>
      <div className="weread-card-cover">
        {book.cover !== '' ? (
          <img src={book.cover} alt="" loading="lazy" className="weread-cover-img" />
        ) : (
          <span className="weread-cover-fallback">{book.title.slice(0, 1)}</span>
        )}
        {noted ? <span className="weread-card-badge">{compactNumber(book.noteCount + book.reviewCount)}</span> : null}
      </div>
      <div className="weread-card-body">
        <span className="weread-card-title" title={book.title}>
          {book.title}
        </span>
        <span className="weread-card-author" title={book.author}>
          {book.author || '未知作者'}
        </span>
        <div className="weread-progress" aria-label={`阅读进度 ${percent(pct)}`}>
          <span className="weread-progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="weread-card-meta">
          {book.progress.isFinished ? '已读完' : pct > 0 ? percent(pct) : '未开始'}
          <span className="weread-card-dot">·</span>
          {date(book.lastReadDate)}
        </span>
      </div>
    </button>
  )
}

/**
 * The shelf grid with its toolbar.
 *
 * Fetches once on mount; the toolbar filters and sorts the in-memory list so the
 * controls stay instant and the network stays quiet.
 */
export function Shelf({ onOpenBook }: ShelfProps): ReactNode {
  const [books, setBooks] = useState<ShelfBook[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ShelfFilter>('all')
  const [sort, setSort] = useState<ShelfSort>('recent')
  const [group, setGroup] = useState<ShelfGroup>('none')
  // Guards post-unmount state writes while progress chunks are still flowing.
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  /** Fetch progress in chunks and merge each chunk into the grid as it arrives. */
  const fillProgress = useCallback(async (bookIds: string[]) => {
    for (let start = 0; start < bookIds.length; start += PROGRESS_CHUNK) {
      const chunk = bookIds.slice(start, start + PROGRESS_CHUNK)
      let map: Awaited<ReturnType<typeof fetchProgressBatch>>
      try {
        map = await fetchProgressBatch(chunk)
      } catch {
        // Progress is a progressive enhancement; a failed chunk leaves cards at 0.
        continue
      }
      if (!aliveRef.current) return
      setBooks((prev) =>
        prev === null
          ? prev
          : prev.map((book) => {
              const next = map[book.bookId]
              return next === undefined ? book : { ...book, progress: next }
            }),
      )
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await fetchShelf()
      setBooks(rows)
      // Progress is not in the notebook list; fill it in after the grid renders,
      // a chunk at a time, so the shelf appears immediately and stays responsive.
      void fillProgress(rows.map((b) => b.bookId))
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : String(caught))
      setBooks([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const visible = useMemo(() => {
    if (books === null) return []
    const needle = query.trim().toLowerCase()
    return books
      .filter((book) => matchesFilter(book, filter))
      .filter(
        (book) =>
          needle === '' ||
          book.title.toLowerCase().includes(needle) ||
          book.author.toLowerCase().includes(needle),
      )
      .slice()
      .sort((a, b) => compareBooks(a, b, sort))
  }, [books, query, filter, sort])

  const sections = useMemo(() => sectionize(visible, group), [visible, group])

  if (loading && books === null) {
    return (
      <div className="weread-state">
        <span className="weread-spinner" aria-hidden="true" />
        <p>加载书架中…</p>
      </div>
    )
  }

  return (
    <div className="weread-shelf">
      <div className="weread-toolbar">
        <input
          type="search"
          className="weread-search"
          placeholder="搜索书名或作者"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="weread-chips" role="group" aria-label="筛选">
          {FILTER_LABELS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`weread-chip${filter === item.id ? ' is-active' : ''}`}
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <select
          className="weread-select"
          value={sort}
          aria-label="排序"
          onChange={(event) => setSort(event.target.value as ShelfSort)}
        >
          {SORT_LABELS.map((item) => (
            <option key={item.id} value={item.id}>
              排序：{item.label}
            </option>
          ))}
        </select>
        <select
          className="weread-select"
          value={group}
          aria-label="分组"
          onChange={(event) => setGroup(event.target.value as ShelfGroup)}
        >
          {GROUP_LABELS.map((item) => (
            <option key={item.id} value={item.id}>
              分组：{item.label}
            </option>
          ))}
        </select>
      </div>

      {error !== null ? <div className="weread-error">{error}</div> : null}

      {visible.length === 0 && error === null ? (
        <p className="weread-empty">暂无数据</p>
      ) : group === 'none' ? (
        <div className="weread-grid">
          {visible.map((book) => (
            <BookCard key={book.bookId} book={book} onOpen={() => onOpenBook(book.bookId)} />
          ))}
        </div>
      ) : (
        <div className="weread-groups">
          {sections.map((section) => (
            <section key={section.key} className="weread-group">
              <h3 className="weread-group-title">
                {section.label}
                <span className="weread-group-count">{section.books.length}</span>
              </h3>
              <div className="weread-grid">
                {section.books.map((book) => (
                  <BookCard key={book.bookId} book={book} onOpen={() => onOpenBook(book.bookId)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
