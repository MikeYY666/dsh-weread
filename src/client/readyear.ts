/**
 * The year a book "belongs" to, for the shelf grouping and the annual wall.
 *
 * `lastReadDate` alone is misleading: it is the time the book was *last opened*,
 * so re-opening an old finished book drags it into the current year. When the
 * richer progress data is present (filled in from `/progress-batch`), a finished
 * book is attributed to the year it was actually FINISHED; an in-progress book
 * still falls back to its last-read date.
 * @module dsh-weread/client/readyear
 */

import type { ShelfBook } from '../types.js'

/** True when a reliable finish timestamp is available. */
function hasFinish(book: ShelfBook): boolean {
  return book.progress.isFinished && book.progress.finishTime > 0
}

/**
 * The ms-epoch timestamp that best represents "when this read counts", for year
 * bucketing: the finish time for a finished book, else the last-read time.
 * @returns ms epoch, or 0 when no usable time exists.
 */
export function readTimeOf(book: ShelfBook): number {
  if (hasFinish(book)) return book.progress.finishTime
  return book.lastReadDate
}

/**
 * The calendar year a book belongs to for time grouping.
 * @returns a year, or 0 when no usable time exists.
 */
export function readYearOf(book: ShelfBook): number {
  const t = readTimeOf(book)
  return t > 0 ? new Date(t).getFullYear() : 0
}
