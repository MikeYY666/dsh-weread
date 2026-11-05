import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectJournalQuote, selectJournalBookQuote } from '../src/client/journalQuote.ts'

const a = { id: 'a', text: 'first' }
const b = { id: 'b', text: 'second' }
const c = { id: 'c', text: 'third' }

test('progressive note batches do not replace the displayed quote', () => {
  let selected = selectJournalQuote(undefined, [a], 1)
  assert.equal(selected, a)
  selected = selectJournalQuote(selected, [a, b], 1)
  assert.equal(selected, a)
  selected = selectJournalQuote(selected, [c, b, a], 1)
  assert.equal(selected, a)
  assert.equal(selectJournalQuote(selected, [], 1), a)
  // Even a newly discovered today highlight must wait for manual advancement.
  assert.equal(selectJournalQuote(selected, [c], 1), a)
})

test('explicit next selects a different quote and survives later batches', () => {
  const selected = selectJournalQuote(a, [a, b, c], 1, true)
  assert.equal(selected, b)
  assert.equal(selectJournalQuote(selected, [c, b, a], 1), b)
  assert.equal(selectJournalQuote(c, [a, b, c], 1, true), a)
  assert.equal(selectJournalQuote(a, [a], 1, true), a)
  assert.equal(selectJournalQuote(undefined, [], 1), undefined)
})

test('change book rotates distinct books even when one book has most highlights', () => {
  const many = Array.from({ length: 100 }, (_, index) => ({ id: `a-${index}`, bookId: 'A' }))
  const other = { id: 'b', bookId: 'B' }
  const third = { id: 'c', bookId: 'C' }
  const notes = [...many, other, third]
  const next = selectJournalBookQuote(many[50], notes, 17)
  assert.equal(next, other)
  assert.equal(selectJournalBookQuote(next, notes, 17), third)
  assert.equal(selectJournalBookQuote(third, notes, 17).bookId, 'A')
})

test('change book uses historical highlights even if today only contains one book', () => {
  const today = { id: 'today', bookId: 'A', day: '2026-11-05' }
  const historical = { id: 'past', bookId: 'B', day: '2025-01-01' }
  const next = selectJournalBookQuote(today, [today, historical], 42)
  assert.equal(next, historical)
  // New cache data must still not replace a manually selected book.
  assert.equal(selectJournalQuote(next, [today, historical, { id: 'new', bookId: 'C' }], 42), historical)
})

test('change book preserves the quote if no alternative exists and handles empty selection', () => {
  const current = { id: 'a', bookId: 'A' }
  assert.equal(selectJournalBookQuote(current, [current, { id: 'another-a', bookId: 'A' }], 3), current)
  assert.equal(selectJournalBookQuote(current, [], 3), current)
  assert.equal(selectJournalBookQuote(undefined, [], 3), undefined)
  assert.equal(selectJournalBookQuote(undefined, [current], 3), current)
  assert.equal(selectJournalBookQuote({ id: 'gone', bookId: 'removed' }, [current], 3), current)
})
