/** Browser-local calendar helpers shared by the journal views and date checks. */

/** Avoid UTC conversion: late-night notes belong to the user's local day. */
export function journalDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Monthly stats keys are epoch seconds, while note timestamps are milliseconds. */
export function journalDaySeconds(readTimes: Readonly<Record<string, number>>, day: string): number | undefined {
  let result: number | undefined
  for (const [timestamp, seconds] of Object.entries(readTimes)) {
    const date = new Date(Number(timestamp) * 1000)
    if (Number.isFinite(date.getTime()) && journalDayKey(date) === day && Number.isFinite(seconds) && seconds >= 0) result = (result ?? 0) + seconds
  }
  return result
}
