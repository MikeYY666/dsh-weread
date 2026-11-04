/**
 * The 统计 (Stats) tab — a redesigned, heatmap-first reading dashboard.
 *
 * Not a 1:1 port of the obsidian plugin: this leads with a large daily-reading
 * heatmap (fed by the dedicated `/heatmap` route, since `/stats` buckets are
 * yearly/monthly, not daily), then a compact hero band, category/time-of-day
 * charts, author/publisher rankings, a most-read list, a yearly trend, and the
 * earned-medal wall. AI profile stays as a streaming card at the end.
 * @module dsh-weread/client/stats
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ApiError, fetchHeatmap, fetchStats } from './api.js'
import { AiPanel } from './aiPanel.js'
import {
  BarList,
  Donut,
  Heatmap,
  HourDial,
  paletteColor,
  YearBars,
  type BarItem,
  type DonutSegment,
} from './charts.js'
import { compactNumber, duration, durationShort, signedPercent } from './format.js'
import type { ReadingStats, ReadingStatsMode } from '../types.js'

/** The period selector options, in display order. */
const MODES: ReadonlyArray<{ id: ReadingStatsMode; label: string }> = [
  { id: 'overall', label: '累计' },
  { id: 'annually', label: '今年' },
  { id: 'monthly', label: '本月' },
  { id: 'weekly', label: '本周' },
]


/** One big hero number. */
function HeroStat({ label, value, unit, sub }: { label: string; value: string; unit?: string; sub?: string }): ReactNode {
  return (
    <div className="weread-hero-stat">
      <span className="weread-hero-value">
        {value}
        {unit !== undefined ? <span className="weread-hero-unit">{unit}</span> : null}
      </span>
      <span className="weread-hero-label">{label}</span>
      {sub !== undefined ? <span className="weread-hero-sub">{sub}</span> : null}
    </div>
  )
}

/** A titled card block. */
function Card({ title, extra, children, wide }: { title?: string; extra?: ReactNode; children: ReactNode; wide?: boolean }): ReactNode {
  return (
    <section className={`weread-card-block${wide === true ? ' is-wide' : ''}`}>
      {title !== undefined || extra !== undefined ? (
        <header className="weread-card-head">
          {title !== undefined ? <h3 className="weread-card-title">{title}</h3> : <span />}
          {extra !== undefined ? <div className="weread-card-extra">{extra}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  )
}

/** Read a named counter from `readStat` (weread labels, e.g. 读过/读完/阅读/笔记). */
function statCount(stats: ReadingStats, name: string): string | undefined {
  return stats.readStat.find((s) => s.stat.includes(name))?.counts
}

/** Build category bars, sorted by time. */
function categoryBars(stats: ReadingStats): BarItem[] {
  return stats.preferCategory
    .slice()
    .sort((a, b) => b.readingTime - a.readingTime)
    .slice(0, 8)
    .map((item) => ({
      label: item.categoryTitle || item.parentCategoryTitle || '未分类',
      value: item.readingTime,
      display: durationShort(item.readingTime),
    }))
}

/** Build donut segments for the category distribution (top 6 + 其他). */
function categoryDonut(stats: ReadingStats): DonutSegment[] {
  const sorted = stats.preferCategory
    .filter((item) => Number.isFinite(item.readingTime) && item.readingTime > 0)
    .slice()
    .sort((a, b) => b.readingTime - a.readingTime)
  if (sorted.length === 0) return []
  const top = sorted.slice(0, 6)
  const rest = sorted.slice(6)
  const segments: DonutSegment[] = top.map((item, index) => ({
    key: `cat-${index}`,
    label: item.categoryTitle || item.parentCategoryTitle || '未分类',
    value: item.readingTime,
    color: paletteColor(index),
  }))
  const restTime = rest.reduce((sum, item) => sum + item.readingTime, 0)
  if (restTime > 0) segments.push({ key: 'cat-other', label: '其他', value: restTime, color: paletteColor(6) })
  return segments
}

/** Sum of category reading time, for the donut centre. */
function categoryTotal(stats: ReadingStats): number {
  return stats.preferCategory.reduce(
    (sum, item) => sum + (Number.isFinite(item.readingTime) && item.readingTime > 0 ? item.readingTime : 0),
    0,
  )
}

/** Quick summary of a day map: active days, total seconds, longest streak. */
function heatSummary(days: Readonly<Record<string, number>>): { activeDays: number; total: number; streak: number } {
  const keys = Object.keys(days)
    .filter((k) => (days[k] ?? 0) > 0)
    .sort()
  let total = 0
  for (const k of keys) total += days[k] ?? 0
  // Longest run of consecutive calendar days with any reading.
  let streak = 0
  let best = 0
  let prev: Date | null = null
  for (const k of keys) {
    const [y, m, d] = k.split('-').map(Number)
    if (y === undefined || m === undefined || d === undefined) continue
    const cur = new Date(y, m - 1, d)
    if (prev !== null) {
      const gap = Math.round((cur.getTime() - prev.getTime()) / 86_400_000)
      streak = gap === 1 ? streak + 1 : 1
    } else {
      streak = 1
    }
    best = Math.max(best, streak)
    prev = cur
  }
  return { activeDays: keys.length, total, streak: best }
}

/** The dashboard body for one loaded stats payload plus the day map. */
function StatsBody({
  stats,
  days,
  heatYear,
  onPrevYear,
  onNextYear,
  canNext,
}: {
  stats: ReadingStats
  days: Readonly<Record<string, number>> | null
  heatYear: number
  onPrevYear: () => void
  onNextYear: () => void
  canNext: boolean
}): ReactNode {
  const donut = categoryDonut(stats)
  const donutTotal = categoryTotal(stats)
  const summary = days !== null ? heatSummary(days) : null
  const registeredYear = stats.registTime > 0 ? new Date(stats.registTime * 1000).getFullYear() : 0

  return (
    <div className="weread-dash">
      {/* Hero band: big numbers + weread's own one-liners. */}
      <div className="weread-hero">
        <div className="weread-hero-stats">
          <HeroStat label="累计阅读" value={durationShort(stats.totalReadTime)} sub={duration(stats.totalReadTime)} />
          <HeroStat label="阅读天数" value={String(stats.readDays)} unit="天" />
          {statCount(stats, '读完') !== undefined ? (
            <HeroStat label="读完" value={statCount(stats, '读完') as string} />
          ) : null}
          {statCount(stats, '读过') !== undefined ? (
            <HeroStat label="读过" value={statCount(stats, '读过') as string} />
          ) : null}
        </div>
        <div className="weread-hero-words">
          {stats.preferCategoryWord !== undefined ? <span className="weread-word-chip">📚 {stats.preferCategoryWord}</span> : null}
          {stats.preferTimeWord !== undefined ? <span className="weread-word-chip">⏰ {stats.preferTimeWord}</span> : null}
          {registeredYear > 0 ? <span className="weread-word-chip">🗓 {registeredYear} 年加入</span> : null}
          {stats.authorCount > 0 ? <span className="weread-word-chip">✍️ {stats.authorCount} 位作者</span> : null}
        </div>
      </div>

      {/* The heatmap is the primary visual. */}
      <Card
        title="阅读热力图"
        extra={
          <div className="weread-heat-head">
            {summary !== null ? (
              <span className="weread-heat-summary">
                活跃 {summary.activeDays} 天 · 最长连续 {summary.streak} 天
              </span>
            ) : null}
            <div className="weread-heat-yearnav" role="group" aria-label="切换年份">
              <button type="button" className="weread-heat-arrow" aria-label="上一年" onClick={onPrevYear}>
                ‹
              </button>
              <span className="weread-heat-year">{heatYear}</span>
              <button
                type="button"
                className="weread-heat-arrow"
                aria-label="下一年"
                onClick={onNextYear}
                disabled={!canNext}
              >
                ›
              </button>
            </div>
          </div>
        }
        wide
      >
        {days === null ? (
          <div className="weread-state weread-state-inline">
            <span className="weread-spinner" aria-hidden="true" />
            <p>加载热力图…</p>
          </div>
        ) : (
          <Heatmap days={days} year={heatYear} />
        )}
      </Card>

      <div className="weread-dash-cols">
        <Card title="阅读分类分布">
          {donut.length === 0 ? (
            <p className="weread-empty weread-empty-inline">暂无分类数据</p>
          ) : (
            <Donut segments={donut} centerTop={durationShort(donutTotal)} centerSub="累计分类阅读" size={132} />
          )}
        </Card>
        <Card title="阅读时段偏好">
          <HourDial preferTime={stats.preferTime} />
        </Card>
      </div>

      <div className="weread-dash-cols">
        <Card title="偏好分类">
          <BarList items={categoryBars(stats)} empty="暂无分类数据" />
        </Card>
        <Card title="偏爱作者">
          <BarList
            items={stats.preferAuthor.slice(0, 8).map((a) => ({ label: a.name, value: a.count, display: `${a.count}本 · ${a.readTime}` }))}
            empty="暂无作者数据"
          />
        </Card>
      </div>

      {stats.preferPublisher.length > 0 ? (
        <Card title="偏爱出版社">
          <BarList
            items={stats.preferPublisher.slice(0, 8).map((p) => ({ label: p.name, value: p.count, display: `${p.count} 本` }))}
          />
        </Card>
      ) : null}

      <Card title="阅读最多">
        {stats.readLongest.length === 0 ? (
          <p className="weread-empty weread-empty-inline">暂无数据</p>
        ) : (
          <ul className="weread-longest">
            {stats.readLongest.slice(0, 10).map((item, index) => (
              <li key={`${item.title}-${index}`} className="weread-longest-item">
                <span className="weread-longest-rank">{index + 1}</span>
                {item.cover !== undefined && item.cover !== '' ? (
                  <img src={item.cover} alt="" loading="lazy" className="weread-longest-cover" />
                ) : null}
                <span className="weread-longest-info">
                  <span className="weread-longest-title">{item.title}</span>
                  <span className="weread-longest-author">{item.author}</span>
                </span>
                <span className="weread-longest-time">{durationShort(item.readTime)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {stats.yearReport.length > 0 ? (
        <Card title="年度趋势">
          <YearBars years={stats.yearReport} />
        </Card>
      ) : null}

      <Card title="AI 阅读画像">
        <AiPanel task="shelf-profile" buttonLabel="生成阅读画像" hint="综合书架与阅读数据生成个人阅读画像" />
      </Card>
    </div>
  )
}

/**
 * The stats tab.
 *
 * Loads the period payload and (independently) the heatmap day map. The heatmap
 * has its own range toggle; switching it only re-fetches `/heatmap`, leaving the
 * stats payload in place.
 */
export function Stats(): ReactNode {
  const [mode, setMode] = useState<ReadingStatsMode>('overall')
  const [stats, setStats] = useState<ReadingStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [days, setDays] = useState<Record<string, number> | null>(null)
  const [heatYear, setHeatYear] = useState<number>(new Date().getFullYear())

  const loadStats = useCallback(async (target: ReadingStatsMode) => {
    setLoading(true)
    setError(null)
    try {
      setStats(await fetchStats(target))
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : String(caught))
      setStats(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadHeat = useCallback(async (year: number) => {
    setDays(null)
    try {
      setDays(await fetchHeatmap(year))
    } catch {
      setDays({})
    }
  }, [])

  useEffect(() => {
    void loadStats(mode)
  }, [mode, loadStats])

  useEffect(() => {
    void loadHeat(heatYear)
  }, [heatYear, loadHeat])

  const modeChips = useMemo(
    () => (
      <div className="weread-chips" role="group" aria-label="统计周期">
        {MODES.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`weread-chip${mode === item.id ? ' is-active' : ''}`}
            aria-pressed={mode === item.id}
            onClick={() => setMode(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
    ),
    [mode],
  )

  return (
    <div className="weread-stats">
      <div className="weread-stats-bar">{modeChips}</div>

      {loading ? (
        <div className="weread-state">
          <span className="weread-spinner" aria-hidden="true" />
          <p>加载阅读统计…</p>
        </div>
      ) : error !== null ? (
        <div className="weread-error">{error}</div>
      ) : stats !== null ? (
        <StatsBody
          stats={stats}
          days={days}
          heatYear={heatYear}
          onPrevYear={() => setHeatYear((y) => y - 1)}
          onNextYear={() => setHeatYear((y) => y + 1)}
          canNext={heatYear < new Date().getFullYear()}
        />
      ) : (
        <p className="weread-empty">暂无数据</p>
      )}
    </div>
  )
}
