/**
 * Locale-neutral formatting helpers for the Weread UI.
 *
 * Numbers, durations and dates appear in tight UI slots, so these stick to whole
 * units and short, stable strings rather than locale-specific formatting.
 * @module dsh-weread/client/format
 */

/** Format a seconds count as reading time, e.g. `5400` → `1小时30分钟`. */
export function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '–'
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (hours > 0) return minutes > 0 ? `${hours}小时${minutes}分钟` : `${hours}小时`
  if (minutes > 0) return `${minutes}分钟`
  return `${total}秒`
}

/** Compact reading time for tiles, e.g. `5400` → `1.5h`, `300` → `5m`. */
export function durationShort(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '–'
  const total = Math.floor(seconds)
  if (total >= 3600) {
    const hours = total / 3600
    return `${hours >= 10 ? Math.round(hours) : hours.toFixed(1).replace(/\.0$/, '')}h`
  }
  if (total >= 60) return `${Math.round(total / 60)}m`
  return `${total}s`
}

/** Format a 0–100 progress number as a whole percent. */
export function percent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–'
  return `${Math.round(Math.min(100, Math.max(0, value)))}%`
}

/** Format a fractional change as a signed percent, e.g. `0.2` → `+20%`. */
export function signedPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–'
  const pct = Math.round(value * 100)
  return `${pct >= 0 ? '+' : ''}${pct}%`
}

/** Format an ms-epoch timestamp as `YYYY-MM-DD`, or `—` when absent. */
export function date(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms <= 0) return '—'
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return '—'
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Format a large counter compactly, e.g. `1234` → `1234`, `12000` → `1.2万`. */
export function compactNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–'
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1).replace(/\.0$/, '')}亿`
  if (value >= 10_000) return `${(value / 10_000).toFixed(1).replace(/\.0$/, '')}万`
  return String(Math.round(value))
}

/** Format a word count, e.g. `120000` → `12.0万字`. */
export function wordCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return '—'
  if (value >= 10_000) return `${(value / 10_000).toFixed(1).replace(/\.0$/, '')}万字`
  return `${value}字`
}
