/**
 * The one book card both shelf sources render.
 *
 * Extracted from `shelf.tsx` so the notebook list and the book-shelf list share
 * exactly one card: the two sources differ in how they are fetched and grouped,
 * never in how a single book looks.
 * @module dsh-weread/client/bookCard
 */

import type { ReactNode } from 'react'
import { compactNumber, date, percent } from './format.js'
import type { ShelfBook } from '../types.js'

/**
 * One book card: cover, title, author, progress bar, and last-read date.
 * @param props.book - the row to render.
 * @param props.onOpen - open the book's detail view.
 */
export function BookCard({ book, onOpen }: { book: ShelfBook; onOpen: () => void }): ReactNode {
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
        {book.isTop === true ? <span className="weread-card-pin" title="置顶">置顶</span> : null}
        {book.secret === true ? <span className="weread-card-lock" title="私密阅读">私密</span> : null}
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
