/**
 * The 读书墙 (Reading Wall) tab — a poster-style "annual book wall".
 *
 * One row per month (1月…12月), each row a strip of small book covers of the
 * books read that month, inside a light card. A year selector switches between
 * years. Display-only: covers are plain <img> tags.
 * @module dsh-weread/client/bookwall
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApiError, fetchProgressBatch, fetchShelf } from './api.js'
import type { ShelfBook } from '../types.js'
import { readYearOf, readTimeOf } from './readyear.js'

/** How many book ids ride one `/progress-batch` request. */
const PROGRESS_CHUNK = 20

export interface BookWallProps {
  /** Open a book's detail view. */
  readonly onOpenBook: (bookId: string) => void
  /** Bumping this (from the parent refresh) re-runs the fetch. */
  readonly refreshKey?: number
}

/** Chinese month labels for the wall rows. */
const MONTHS_CN = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']

/** One month row: its books (read that month), or empty. */
interface MonthRow {
  readonly month: number // 0-11
  readonly books: readonly ShelfBook[]
}

/** Group a year's books by the month they were last read. */
function rowsForYear(books: readonly ShelfBook[], year: number): MonthRow[] {
  const byMonth: ShelfBook[][] = Array.from({ length: 12 }, () => [])
  for (const book of books) {
    // The month within the year comes from whichever timestamp the year uses.
    const t = readTimeOf(book)
    if (t <= 0) continue
    const d = new Date(t)
    if (d.getFullYear() !== year) continue
    byMonth[d.getMonth()]!.push(book)
  }
  return byMonth.map((list, month) => ({ month, books: list }))
}

/** Every year that has at least one read book, newest first. */
function yearsOf(books: readonly ShelfBook[]): number[] {
  const set = new Set<number>()
  for (const b of books) {
    const y = readYearOf(b)
    if (y > 0) set.add(y)
  }
  return [...set].sort((a, b) => b - a)
}

/** Count of read books placed in a year. */
function countForYear(books: readonly ShelfBook[], year: number): number {
  let n = 0
  for (const b of books) {
    if (readYearOf(b) === year) n += 1
  }
  return n
}

/** One small cover on the wall. */
function WallThumb({ book, onOpen }: { book: ShelfBook; onOpen: () => void }): ReactNode {
  return (
    <button type="button" className="weread-yw-cover" onClick={onOpen} title={`${book.title} · ${book.author}`}>
      {book.cover !== '' ? (
        <img src={book.cover} alt="" loading="lazy" className="weread-yw-cover-img" />
      ) : (
        <span className="weread-yw-cover-fallback">{book.title.slice(0, 1)}</span>
      )}
    </button>
  )
}

/**
 * The annual book wall: a light poster card with one cover-strip row per month
 * and a year switcher. Book count headlines it; clicking a cover opens detail.
 */
export function BookWall({ onOpenBook, refreshKey = 0 }: BookWallProps): ReactNode {
  const [books, setBooks] = useState<ShelfBook[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [year, setYear] = useState<number | null>(null)
  const years = useMemo(() => (books === null ? [] : yearsOf(books)), [books])

  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  /** Fill per-book progress (finishTime matters for the year) in the background. */
  const fillProgress = useCallback(async (books: readonly ShelfBook[]) => {
    const ids = books.map((b) => b.bookId)
    for (let start = 0; start < ids.length; start += PROGRESS_CHUNK) {
      const chunk = ids.slice(start, start + PROGRESS_CHUNK)
      let map: Awaited<ReturnType<typeof fetchProgressBatch>>
      try {
        map = await fetchProgressBatch(chunk)
      } catch {
        continue
      }
      if (!aliveRef.current) return
      let merged: ShelfBook[] | null = null
      setBooks((prev) => {
        if (prev === null) return prev
        merged = prev.map((b) => (map[b.bookId] === undefined ? b : { ...b, progress: map[b.bookId]! }))
        return merged
      })
      // Years can shift once finish times arrive, so re-pick the active year.
      if (merged !== null) {
        const ys = yearsOf(merged)
        setYear((y) => (y !== null && ys.includes(y) ? y : (ys[0] ?? new Date().getFullYear())))
      }
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await fetchShelf()
      setBooks(rows)
      const ys = yearsOf(rows)
      setYear((prev) => (prev !== null && ys.includes(prev) ? prev : (ys[0] ?? new Date().getFullYear())))
      void fillProgress(rows)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : String(caught))
      setBooks([])
    } finally {
      setLoading(false)
    }
  }, [fillProgress])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const activeYear = year ?? (years[0] ?? new Date().getFullYear())
  const rows = useMemo(() => (books === null ? [] : rowsForYear(books, activeYear)), [books, activeYear])
  const totalYear = useMemo(() => (books === null ? 0 : countForYear(books, activeYear)), [books, activeYear])

  if (loading && books === null) {
    return (
      <div className="weread-state">
        <span className="weread-spinner" aria-hidden="true" />
        <p>生成年度书墙…</p>
      </div>
    )
  }

  return (
    <div className="weread-yw">
      <div className="weread-yw-bar">
        <div className="weread-yw-years" role="group" aria-label="选择年份">
          {years.length === 0 ? null : (
            <select
              className="weread-yw-year-select"
              value={activeYear}
              aria-label="年份"
              onChange={(e) => setYear(Number(e.target.value))}
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y} 年
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {error !== null ? <div className="weread-error">{error}</div> : null}

      {/* The poster card itself. */}
      <div className="weread-yw-card">
        <header className="weread-yw-head">
          <div className="weread-yw-title">
            <span className="weread-yw-year">{activeYear}</span>
            <span className="weread-yw-sub">年度书墙</span>
          </div>
          <div className="weread-yw-count">
            <span className="weread-yw-count-num">{totalYear}</span>
            <span className="weread-yw-count-label">本</span>
          </div>
        </header>

        {totalYear === 0 ? (
          <p className="weread-yw-empty">这一年还没有阅读记录</p>
        ) : (
          <div className="weread-yw-rows">
            {rows.map((row) => (
              <div className="weread-yw-row" key={row.month}>
                <div className="weread-yw-row-label">
                  <span className="weread-yw-row-cn">{MONTHS_CN[row.month]}</span>
                  {row.books.length > 0 ? <span className="weread-yw-row-num">{row.books.length}</span> : null}
                </div>
                <div className="weread-yw-strip">
                  {row.books.map((b) => (
                    <WallThumb key={b.bookId} book={b} onOpen={() => onOpenBook(b.bookId)} />
                  ))}
                  {row.books.length === 0 ? <span className="weread-yw-row-empty">{MONTHS_CN[row.month]}·无</span> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
