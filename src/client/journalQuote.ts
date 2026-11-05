/** Stable quote choice for progressively loaded personal notes. */

/** Preserve a displayed quote until explicit advancement, even during retries. */
export function selectJournalQuote<T extends { readonly id: string }>(
  current: T | undefined,
  candidates: readonly T[],
  seed: number,
  advance = false,
): T | undefined {
  if (current !== undefined && !advance) return current
  if (candidates.length === 0) return current
  const position = current === undefined ? -1 : candidates.findIndex((note) => note.id === current.id)
  return candidates[position >= 0 && advance ? (position + 1) % candidates.length : seed % candidates.length]
}

/** Rotate distinct books rather than stepping through a book-sorted note list. */
export function selectJournalBookQuote<T extends { readonly id: string; readonly bookId: string }>(
  current: T | undefined,
  candidates: readonly T[],
  seed: number,
): T | undefined {
  const books = new Map<string, T[]>()
  for (const note of candidates) {
    const group = books.get(note.bookId) ?? []
    group.push(note)
    books.set(note.bookId, group)
  }
  const ids = [...books.keys()].sort()
  if (ids.length === 0 || (ids.length === 1 && ids[0] === current?.bookId)) return current
  const position = current === undefined ? -1 : ids.indexOf(current.bookId)
  const nextId = ids[position < 0 ? seed % ids.length : (position + 1) % ids.length]
  const notes = books.get(nextId!)!
  return notes[seed % notes.length]
}
