import { test } from 'node:test'
import assert from 'node:assert/strict'
import { journalDayKey, journalDaySeconds } from '../src/client/journalDates.ts'

function inTimeZone(zone, verify) {
  const previous = process.env.TZ
  process.env.TZ = zone
  try { verify() } finally {
    if (previous === undefined) delete process.env.TZ
    else process.env.TZ = previous
  }
}

test('journal assigns UTC midnight-adjacent notes to the browser local date', () => {
  inTimeZone('Asia/Shanghai', () => {
    assert.equal(journalDayKey(new Date('2026-11-04T16:30:00Z')), '2026-11-05')
  })
  inTimeZone('America/Los_Angeles', () => {
    assert.equal(journalDayKey(new Date('2026-11-05T02:30:00Z')), '2026-11-04')
  })
})

test('daily reading seconds distinguish explicit zero from absent/invalid daily data', () => {
  inTimeZone('Asia/Shanghai', () => {
    const midnight = new Date(2026, 10, 5).getTime() / 1000
    assert.equal(journalDaySeconds({ [midnight]: 0 }, '2026-11-05'), 0)
    assert.equal(journalDaySeconds({}, '2026-11-05'), undefined)
    assert.equal(journalDaySeconds({ [midnight]: -1, invalid: 100 }, '2026-11-05'), undefined)
    assert.equal(journalDaySeconds({ [midnight]: Infinity }, '2026-11-05'), undefined)
    assert.equal(journalDaySeconds({ [midnight]: 120, [midnight + 3600]: 60, [midnight - 1]: 999 }, '2026-11-05'), 180)
  })
})

test('journal uses calendar dates across repeated daylight-saving hours and leap days', () => {
  inTimeZone('America/New_York', () => {
    const first = new Date('2026-11-01T05:30:00Z')
    const repeated = new Date('2026-11-01T06:30:00Z')
    assert.equal(journalDayKey(first), '2026-11-01')
    assert.equal(journalDayKey(repeated), '2026-11-01')
    assert.equal(journalDaySeconds({ [first.getTime() / 1000]: 60, [repeated.getTime() / 1000]: 120 }, '2026-11-01'), 180)
    assert.equal(journalDayKey(new Date(2024, 1, 29, 23, 59)), '2024-02-29')
    assert.equal(journalDayKey(new Date(2024, 1, 30)), '2024-03-01')
  })
})
