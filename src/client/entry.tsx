/**
 * The dsh-weread main panel, rendered into the center column when the sidebar
 * icon is selected.
 *
 * Unlike the earlier overlay-drawer design, this is a normal in-flow page: the
 * center column is ours while selected, so the three tabs (书架 / 统计 / 设置)
 * get the full width and height without any fixed positioning or open state.
 * @module dsh-weread/client/entry
 */

import { useCallback, useState, type ReactNode } from 'react'
import { BookDetailView } from './bookDetail.js'
import { BookWall } from './bookwall.js'
import { Shelf } from './shelf.js'
import { Stats } from './stats.js'

/** The panel's top-level tabs. Settings lives in dsh's global Settings, not here. */
type PanelTab = 'shelf' | 'wall' | 'stats'

const TABS: ReadonlyArray<{ id: PanelTab; label: string }> = [
  { id: 'shelf', label: '书架' },
  { id: 'stats', label: '统计' },
  { id: 'wall', label: '读书墙' },
]

/**
 * The panel body: a header with a refresh action, a tab bar, and the active tab.
 *
 * Bumping `refreshKey` remounts the active tab (which re-runs its fetch) — the
 * simplest way to refresh without threading a refetch callback through every
 * child. A selected book opens as a second-level view over the shelf tab.
 */
export function WereadPanel(): ReactNode {
  const [tab, setTab] = useState<PanelTab>('shelf')
  const [bookId, setBookId] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const refresh = useCallback(() => {
    setBookId(null)
    setRefreshKey((n) => n + 1)
  }, [])

  const switchTab = useCallback((next: PanelTab) => {
    setTab(next)
    setBookId(null)
  }, [])

  const openBook = useCallback((id: string) => setBookId(id), [])
  const closeBook = useCallback(() => setBookId(null), [])

  return (
    <div className="weread-panel">
      <header className="weread-panel-head">
        <div className="weread-panel-title">
          {bookId !== null ? (
            <button type="button" className="weread-back" onClick={closeBook} aria-label="返回书架">
              ← 返回
            </button>
          ) : null}
          <span className="weread-panel-name">微信读书</span>
        </div>
        <div className="weread-panel-actions">
          <button type="button" className="weread-icon-btn" title="刷新" aria-label="刷新" onClick={refresh}>
            ⟳
          </button>
        </div>
      </header>

      {bookId === null ? (
        <nav className="weread-panel-tabs" role="tablist">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={`weread-panel-tab${tab === item.id ? ' is-active' : ''}`}
              onClick={() => switchTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      ) : null}

      <div className="weread-panel-body">
        {bookId !== null ? (
          <BookDetailView key={`${bookId}:${refreshKey}`} bookId={bookId} onBack={closeBook} />
        ) : tab === 'shelf' ? (
          <Shelf key={refreshKey} onOpenBook={openBook} />
        ) : tab === 'wall' ? (
          <BookWall key={refreshKey} refreshKey={refreshKey} onOpenBook={openBook} />
        ) : (
          <Stats key={refreshKey} />
        )}
      </div>
    </div>
  )
}
