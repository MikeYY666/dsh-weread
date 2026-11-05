/**
 * Pure WeRead deep links shared by browser and host without runtime dependencies.
 * Only documented chapter/range positions produce precise highlight links.
 * @module dsh-weread/src/readingLinks
 */
import type { JournalNoteLink } from './types.js'

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const id = (value: unknown): string => typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : ''

/** Open the book at its last reading position using the documented reading schema. */
export function bookReadingUrl(bookId: string | number): string {
  return `weread://reading?bId=${encodeURIComponent(id(bookId))}`
}

/** Numeric upstream IDs may be strings; reject coercions, fractions and unsafe values. */
function positionInteger(value: unknown): string | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined
  const raw = String(value)
  return /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) ? raw : undefined
}

/** Only documented chapterUid/range fields can identify a highlight's location. */
export function buildJournalNoteLink(bookId: string | number, highlight: unknown): JournalNoteLink {
  const book = id(bookId)
  const fallback = { url: bookReadingUrl(book), precise: false }
  const h = object(highlight)
  const chapter = positionInteger(h.chapterUid)
  const range = typeof h.range === 'string' ? /^(\d+)-(\d+)$/.exec(h.range) : null
  if (book === '' || chapter === undefined || range === null) return fallback
  const start = positionInteger(range[1])
  const end = positionInteger(range[2])
  if (start === undefined || end === undefined || Number(end) <= Number(start)) return fallback
  return { url: `weread://bestbookmark?bookId=${encodeURIComponent(book)}&chapterUid=${encodeURIComponent(chapter)}&rangeStart=${encodeURIComponent(start)}&rangeEnd=${encodeURIComponent(end)}`, precise: true }
}
