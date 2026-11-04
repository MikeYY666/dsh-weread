/**
 * Inline-SVG chart primitives — no chart library, because the client bundle may
 * only require React from the shell's frozen module table. Every visual is drawn
 * with SVG or styled divs, colored from `--dsw-*` theme tokens so light/dark mode
 * follows the shell automatically.
 * @module dsh-weread/client/charts
 */

import { useMemo, useState, type ReactNode } from 'react'

/** A small harmonious palette used for category segments / bars; leads with weread blue. */
export const PALETTE: readonly string[] = [
  '#1b88ee',
  '#46b87a',
  '#f3b13d',
  '#e06fb4',
  '#8a7bff',
  '#3fb6c6',
  '#f2685f',
  '#9aa5b1',
]

/** Wrap an index into {@link PALETTE}, so any number of categories gets a color. */
function paletteColor(index: number): string {
  return PALETTE[index % PALETTE.length] ?? '#1b88ee'
}

// ── Heatmap ───────────────────────────────────────────────────────────────

/** One day of reading activity in the heatmap. */
interface HeatCell {
  readonly key: string
  readonly date: Date
  /** Seconds read that day; `EMPTY` = pad (no cell), `FUTURE` = not yet reached. */
  readonly seconds: number
}

/** Pad marker (outside the year): render nothing. */
const EMPTY = -1
/** Future marker (later than today): render a faint empty cell so the year stays full. */
const FUTURE = -2

/**
 * Build a full-calendar-year grid: Monday-first columns spanning from the week
 * that contains Jan 1 to the week that contains Dec 31 of the CURRENT year, so
 * the heatmap always shows one whole year — including future days, which render
 * as faint empty cells instead of being omitted.
 * @param byDayInput - the `YYYY-MM-DD → seconds` map from `/heatmap`.
 * @param year - the calendar year to show (defaults to the current year).
 * @returns columns of 7 cells (Mon..Sun), oldest week first.
 */
function buildHeatGrid(byDayInput: Readonly<Record<string, number>>, year: number = new Date().getFullYear()): HeatCell[][] {
  // Match on a `YYYY-M-D` key (month 0-based) to line up with local Date parts.
  const byDay = new Map<string, number>()
  for (const [key, seconds] of Object.entries(byDayInput)) {
    if (!Number.isFinite(seconds)) continue
    const [y, m, d] = key.split('-').map(Number)
    if (y === undefined || m === undefined || d === undefined) continue
    byDay.set(`${y}-${m - 1}-${d}`, (byDay.get(`${y}-${m - 1}-${d}`) ?? 0) + seconds)
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // First cell: the Monday on/before Jan 1 of the target year.
  const jan1 = new Date(year, 0, 1)
  const start = new Date(jan1)
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7)) // Mon=0

  // Last cell: the Sunday on/after Dec 31 of the target year.
  const dec31 = new Date(year, 11, 31)
  const end = new Date(dec31)
  end.setDate(end.getDate() + (6 - ((end.getDay() + 6) % 7))) // advance to Sunday

  const columns: HeatCell[][] = []
  let column: HeatCell[] = []
  const cursor = new Date(start)
  while (cursor <= end) {
    const key = `${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`
    let seconds: number
    if (cursor.getFullYear() !== year) seconds = EMPTY // outside the year: pad
    else if (cursor > today) seconds = FUTURE // not reached yet
    else seconds = byDay.get(key) ?? 0
    column.push({ key, date: new Date(cursor), seconds })
    if (column.length === 7) {
      columns.push(column)
      column = []
    }
    cursor.setDate(cursor.getDate() + 1)
  }
  if (column.length > 0) columns.push(column)
  return columns
}

/** Map a day's seconds to one of five intensity levels (0 = no reading). */
function heatLevel(seconds: number): number {
  if (seconds <= 0) return 0
  if (seconds < 600) return 1
  if (seconds < 1800) return 2
  if (seconds < 3600) return 3
  return 4
}

export interface HeatmapProps {
  /** `YYYY-MM-DD` → seconds read that day, from `/heatmap`. */
  readonly days: Readonly<Record<string, number>>
  /** Calendar year to render (defaults to the current year). Always a full year. */
  readonly year?: number
  /** Accessible label. */
  readonly label?: string
}

const CELL = 12
const GAP = 3
/** Monday-first single-char weekday labels; only rows 0/2/4 are printed, as in GitHub. */
const WEEKDAY_ROWS: ReadonlyArray<{ row: number; label: string }> = [
  { row: 0, label: '一' },
  { row: 2, label: '三' },
  { row: 4, label: '五' },
]
/** Month index → short label shown above the column that opens it. */
const MONTH_LABELS: readonly string[] = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']

/**
 * A GitHub-style calendar heatmap drawn with SVG rects.
 *
 * Adds weekday row labels (Mon/Wed/Fri) on the left and month labels above the
 * columns whose week crosses into a new month, matching the reference layout but
 * as plain SVG. Cell colors come from `weread-heat-l{level}` classes.
 */
export function Heatmap({ days, year, label = '阅读热力图' }: HeatmapProps): ReactNode {
  const columns = useMemo(() => buildHeatGrid(days, year ?? new Date().getFullYear()), [days, year])

  // Left gutter holds the weekday labels; a top strip holds the month labels.
  const GUTTER = 22
  const TOP = 14
  const COL_STEP = CELL + GAP
  const width = GUTTER + columns.length * COL_STEP
  const height = TOP + 7 * COL_STEP

  // Place one month label per new month, but drop any whose left edge sits closer
  // than MIN_LABEL_GAP px to the previous label so 4月/5月 never crowd together.
  const MIN_LABEL_GAP = 34
  const monthLabels: Array<{ ci: number; text: string }> = []
  let lastLabelX = -Infinity
  columns.forEach((column, ci) => {
    const firstDay = column.find((c) => Number.isFinite(c.date.getTime()))
    const prevFirst = ci > 0 ? columns[ci - 1]?.find((c) => Number.isFinite(c.date.getTime())) : undefined
    if (firstDay === undefined) return
    const opensMonth = prevFirst === undefined || prevFirst.date.getMonth() !== firstDay.date.getMonth()
    if (!opensMonth) return
    const x = GUTTER + ci * COL_STEP
    if (x - lastLabelX < MIN_LABEL_GAP) return
    monthLabels.push({ ci, text: MONTH_LABELS[firstDay.date.getMonth()] ?? '' })
    lastLabelX = x
  })

  return (
    <div className="weread-heat" role="img" aria-label={label}>
      <svg width={width} height={height} className="weread-heat-svg" viewBox={`0 0 ${width} ${height}`}>
        {/* Weekday row labels. */}
        {WEEKDAY_ROWS.map(({ row, label: wd }) => (
          <text key={`wd-${row}`} x={0} y={TOP + row * COL_STEP + CELL - 2} className="weread-heat-wd">
            {wd}
          </text>
        ))}
        {/* Month labels on their own pass so the gap filter above applies cleanly. */}
        {monthLabels.map(({ ci, text }) => (
          <text key={`mon-${ci}`} x={GUTTER + ci * COL_STEP} y={TOP - 4} className="weread-heat-mon">
            {text}
          </text>
        ))}
        {columns.map((column, ci) => (
          <g key={`col-${ci}`}>
            {column.map((cell, ri) => {
              if (cell.seconds === EMPTY) return null // outside the year
              const future = cell.seconds === FUTURE
              return (
                <rect
                  key={`${ci}-${ri}`}
                  x={GUTTER + ci * COL_STEP}
                  y={TOP + ri * COL_STEP}
                  width={CELL}
                  height={CELL}
                  rx={2}
                  className={future ? 'weread-heat-future' : `weread-heat-l${heatLevel(cell.seconds)}`}
                >
                  <title>{`${cell.date.getFullYear()}-${cell.date.getMonth() + 1}-${cell.date.getDate()} · ${future ? '未来' : heatLabel(cell.seconds)}`}</title>
                </rect>
              )
            })}
          </g>
        ))}
      </svg>
      <div className="weread-heat-legend" aria-hidden="true">
        <span>少</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <span key={level} className={`weread-heat-swatch weread-heat-l${level}`} />
        ))}
        <span>多</span>
      </div>
    </div>
  )
}

/** Human label for one heatmap cell's tooltip. */
function heatLabel(seconds: number): string {
  if (seconds <= 0) return '未阅读'
  const minutes = Math.round(seconds / 60)
  return minutes > 0 ? `${minutes} 分钟` : `${seconds} 秒`
}

// ── Donut ─────────────────────────────────────────────────────────────────

/** One slice of the donut. */
export interface DonutSegment {
  readonly key: string
  readonly label: string
  readonly value: number
  readonly color: string
}

export interface DonutProps {
  readonly segments: readonly DonutSegment[]
  /** Large center caption (e.g. total reading time). */
  readonly centerTop: ReactNode
  /** Small center subtitle. */
  readonly centerSub?: ReactNode
  readonly size?: number
}

/** Gap (in path units) carved between adjacent arcs so slices read separately. */
const SEG_GAP = 0.5

/**
 * An SVG donut using `<circle stroke-dasharray>` arcs on a 42×42 viewBox.
 *
 * Each segment's arc length is its percentage of the whole; `stroke-dashoffset`
 * rotates it into place. A per-segment hover dims the rest via a wrapper class,
 * and a side legend lists the shared percentages. Slices are cycled through the
 * palette; a hovered slice and its legend row light up together.
 */
export function Donut({ segments, centerTop, centerSub, size = 128 }: DonutProps): ReactNode {
  const [hoverKey, setHoverKey] = useState<string | null>(null)
  const total = segments.reduce((sum, s) => sum + (Number.isFinite(s.value) && s.value > 0 ? s.value : 0), 0)

  // Convert percentages into dasharcs; the reference rotates the first arc to 12
  // o'clock and trims a small gap between neighbours for separation.
  const arcs: Array<{ key: string; color: string; len: number; offset: number }> = []
  let acc = 0
  if (total > 0) {
    for (const seg of segments) {
      const value = Number.isFinite(seg.value) && seg.value > 0 ? seg.value : 0
      if (value === 0) continue
      const pct = (value / total) * 100
      arcs.push({ key: seg.key, color: seg.color, len: pct, offset: 100 - acc + 25 })
      acc += pct
    }
  }
  if (arcs.length > 1) {
    for (const arc of arcs) {
      const cut = Math.min(SEG_GAP / 2, arc.len / 4)
      arc.len -= cut * 2
      arc.offset -= cut
    }
  }
  const hovering = hoverKey !== null && arcs.some((a) => a.key === hoverKey)

  return (
    <div className="weread-donut-wrap">
      <div
        className={`weread-donut${hovering ? ' is-dim' : ''}`}
        style={{ width: size, height: size }}
        onMouseLeave={() => setHoverKey(null)}
      >
        <svg viewBox="0 0 42 42" width={size} height={size} aria-hidden="true">
          <circle className="weread-donut-track" cx="21" cy="21" r="15.9155" fill="none" strokeWidth="4" />
          {arcs.map((arc) => (
            <circle
              key={arc.key}
              className={`weread-donut-seg${hoverKey === arc.key ? ' is-on' : ''}`}
              cx="21"
              cy="21"
              r="15.9155"
              fill="none"
              strokeWidth="4"
              strokeDasharray={`${arc.len} ${100 - arc.len}`}
              strokeDashoffset={arc.offset}
              style={{ stroke: arc.color }}
              onMouseEnter={() => setHoverKey(arc.key)}
            />
          ))}
        </svg>
        <div className="weread-donut-center">
          <b style={{ fontSize: Math.max(11, Math.round(size * 0.13)) }}>{centerTop}</b>
          {centerSub !== undefined ? (
            <span style={{ fontSize: Math.max(9, Math.round(size * 0.1)) }}>{centerSub}</span>
          ) : null}
        </div>
      </div>
      <ul className="weread-donut-legend">
        {segments.map((seg) => {
          const pct = total > 0 && Number.isFinite(seg.value) ? Math.round((seg.value / total) * 100) : 0
          return (
            <li
              key={seg.key}
              className={`weread-donut-legend-item${hoverKey === seg.key ? ' is-on' : ''}`}
              onMouseEnter={() => setHoverKey(seg.key)}
              onMouseLeave={() => setHoverKey(null)}
            >
              <i className="weread-donut-dot" style={{ background: seg.color }} />
              <span className="weread-donut-legend-label" title={seg.label}>
                {seg.label}
              </span>
              <span className="weread-donut-legend-pct">{pct}%</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ── HourDial ──────────────────────────────────────────────────────────────

export interface HourDialProps {
  /** 24 values of seconds; index 0 = 06:00, so slot i is the hour `(6+i)%24`. */
  readonly preferTime: readonly number[]
  /** Accessible label. */
  readonly label?: string
}

/** Format an hour number as `HH时`. */
function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}时`
}

/**
 * A vertical "time clock": 24 bars, one per two-ish-hour window, in reading
 * order starting at 06:00. Each bar's height is its share of the busiest slot;
 * hour labels sit beneath, and the peak slot is called out above the chart.
 *
 * Chosen over a radial 24-spoke dial because a vertical bar row reads cleanly at
 * the drawer's width and keeps hour labels legible.
 */
export function HourDial({ preferTime, label = '阅读时段偏好' }: HourDialProps): ReactNode {
  const [hover, setHover] = useState<number | null>(null)
  // Normalise to 24 slots even if the host trims trailing zeros.
  const values = Array.from({ length: 24 }, (_, i) => {
    const v = preferTime[i]
    return Number.isFinite(v) && (v as number) > 0 ? (v as number) : 0
  })
  const max = values.reduce((m, v) => (v > m ? v : m), 0)
  let peakSlot = -1
  if (max > 0) peakSlot = values.indexOf(max)

  const peakHour = peakSlot >= 0 ? (6 + peakSlot) % 24 : -1

  return (
    <div className="weread-dial" role="img" aria-label={label}>
      {peakHour >= 0 ? (
        <p className="weread-dial-peak">
          最常阅读时段：<b>{hourLabel(peakHour)}</b> 前后（{durationMinutes(max)}）
        </p>
      ) : (
        <p className="weread-empty weread-empty-inline">暂无时段数据</p>
      )}
      <div className="weread-dial-bars" onMouseLeave={() => setHover(null)}>
        {values.map((value, slot) => {
          const ratio = max > 0 ? value / max : 0
          const hour = (6 + slot) % 24
          return (
            <div
              key={slot}
              className={`weread-dial-col${hover === slot ? ' is-on' : ''}${value <= 0 ? ' is-empty' : ''}`}
              onMouseEnter={() => setHover(slot)}
              title={`${hourLabel(hour)} · ${value > 0 ? durationMinutes(value) : '未阅读'}`}
            >
              <span className="weread-dial-fill" style={{ height: `${Math.max(2, ratio * 100)}%` }} />
              {slot % 3 === 0 ? <span className="weread-dial-tick">{String(hour).padStart(2, '0')}</span> : <span className="weread-dial-tick" />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Format a seconds count as a short `Xh Ym` / `Xm` string for hour tooltips. */
function durationMinutes(seconds: number): string {
  const total = Math.round(seconds / 60)
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  if (hours > 0) return minutes > 0 ? `${hours}小时${minutes}分` : `${hours}小时`
  return `${minutes}分钟`
}

// ── YearBars ──────────────────────────────────────────────────────────────

export interface YearReportEntryLike {
  readonly year: number
  readonly times: readonly number[]
}

export interface YearBarsProps {
  readonly years: readonly YearReportEntryLike[]
  /** Highlight this year's group; defaults to the newest year present. */
  readonly highlightYear?: number
}

const MONTH_TICKS: ReadonlyArray<number> = [0, 2, 4, 6, 8, 10]

/**
 * Grouped vertical bars: one group of 12 monthly bars per year, with the current
 * (newest) year emphasized. Months with no reading still occupy a zero-height
 * slot so the 12-month rhythm stays aligned across years.
 */
export function YearBars({ years, highlightYear }: YearBarsProps): ReactNode {
  if (years.length === 0) return null
  const active = highlightYear ?? years.reduce((m, y) => (y.year > m ? y.year : m), years[0]?.year ?? 0)
  // Per-year maxima drive per-group scaling so a quiet year is still legible.
  const groups = years.map((y) => {
    const times = Array.from({ length: 12 }, (_, i) => {
      const v = y.times[i]
      return Number.isFinite(v) && (v as number) > 0 ? (v as number) : 0
    })
    const max = times.reduce((m, v) => (v > m ? v : m), 0)
    return { year: y.year, times, max }
  })

  return (
    <div className="weread-yearbars" role="img" aria-label="年度阅读趋势">
      {groups.map((group) => {
        const isActive = group.year === active
        return (
          <div key={group.year} className={`weread-year-group${isActive ? ' is-active' : ''}`}>
            <span className="weread-year-label">{group.year}年</span>
            <div className="weread-year-months">
              {group.times.map((seconds, mi) => {
                const ratio = group.max > 0 ? seconds / group.max : 0
                return (
                  <div
                    key={mi}
                    className={`weread-year-col${MONTH_TICKS.includes(mi) ? ' has-tick' : ''}`}
                    title={`${group.year}年${mi + 1}月 · ${seconds > 0 ? durationMinutes(seconds) : '未阅读'}`}
                  >
                    <span className="weread-year-bar" style={{ height: `${seconds > 0 ? Math.max(3, ratio * 100) : 0}%` }} />
                    {MONTH_TICKS.includes(mi) ? <span className="weread-year-tick">{mi + 1}月</span> : null}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── BarList (unchanged API) ───────────────────────────────────────────────

/** One bar in a horizontal bar list. */
export interface BarItem {
  readonly label: string
  /** Raw magnitude used for bar length and ordering. */
  readonly value: number
  /** Formatted value shown at the right. */
  readonly display?: string
}

export interface BarListProps {
  readonly items: readonly BarItem[]
  /** Text shown when there are no items. */
  readonly empty?: string
}

/**
 * A simple horizontal bar list; bar width is relative to the largest value.
 * Rendered with divs + percentage widths, which resize cleanly inside the drawer.
 */
export function BarList({ items, empty = '暂无数据' }: BarListProps): ReactNode {
  if (items.length === 0) return <p className="weread-empty weread-empty-inline">{empty}</p>
  const max = items.reduce((m, item) => (item.value > m ? item.value : m), 0)
  return (
    <div className="weread-bars">
      {items.map((item) => {
        const ratio = max > 0 ? Math.max(0.02, item.value / max) : 0
        return (
          <div key={item.label} className="weread-bar-row">
            <span className="weread-bar-label" title={item.label}>
              {item.label}
            </span>
            <span className="weread-bar-track">
              <span className="weread-bar-fill" style={{ width: `${ratio * 100}%` }} />
            </span>
            <span className="weread-bar-value">{item.display ?? String(item.value)}</span>
          </div>
        )
      })}
    </div>
  )
}

export { paletteColor }
