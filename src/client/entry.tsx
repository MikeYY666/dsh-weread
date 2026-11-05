/**
 * The dsh-weread main panel, rendered into the center column when the sidebar
 * icon is selected.
 *
 * The center column belongs to this panel while selected. Today and retrospective
 * notes share the same book-detail navigation as the shelf and reading wall.
 * @module dsh-weread/client/entry
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { BookDetailView } from './bookDetail.js'
import { BookWall } from './bookwall.js'
import { Shelf } from './shelf.js'
import { Stats } from './stats.js'
import { Today, Retrospect, JournalProvider } from './journal.js'

/** The panel's top-level tabs. Settings lives in dsh's global Settings, not here. */
type PanelTab = 'today' | 'shelf' | 'retrospect' | 'wall' | 'stats'

const TABS: ReadonlyArray<{ id: PanelTab; label: string }> = [
  { id: 'today', label: '今日' },
  { id: 'shelf', label: '书架' },
  { id: 'retrospect', label: '回顾' },
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
  const [tab, setTab] = useState<PanelTab>('today')
  const [visitedJournal, setVisitedJournal] = useState({ today: true, retrospect: false })
  const [bookId, setBookId] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [credentialRevision, setCredentialRevision] = useState(0)
  useEffect(() => {
    const reset = () => { setRefreshKey(0); setBookId(null); setCredentialRevision((value) => value + 1) }
    window.addEventListener('weread:credentials-changed', reset)
    return () => window.removeEventListener('weread:credentials-changed', reset)
  }, [])

  const refresh = useCallback(() => {
    setBookId(null)
    setRefreshKey((n) => n + 1)
  }, [])

  const switchTab = useCallback((next: PanelTab) => {
    setTab(next)
    if (next === 'today' || next === 'retrospect') {
      setVisitedJournal((previous) => ({ ...previous, [next]: true }))
    }
    setBookId(null)
  }, [])

  const openBook = useCallback((id: string) => setBookId(id), [])
  const closeBook = useCallback(() => setBookId(null), [])

  return (
    <JournalProvider key={credentialRevision} refreshKey={refreshKey}>
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
        {visitedJournal.today ? <div hidden={bookId !== null || tab !== 'today'}>
          <Today refreshKey={refreshKey} onOpenBook={openBook} />
        </div> : null}
        {visitedJournal.retrospect ? <div hidden={bookId !== null || tab !== 'retrospect'}>
          <Retrospect refreshKey={refreshKey} onOpenBook={openBook} />
        </div> : null}
        {bookId !== null ? (
          <BookDetailView key={`${bookId}:${refreshKey}`} bookId={bookId} onBack={closeBook} />
        ) : tab === 'shelf' ? (
          <Shelf key={refreshKey} onOpenBook={openBook} />
        ) : tab === 'wall' ? (
          <BookWall key={refreshKey} refreshKey={refreshKey} onOpenBook={openBook} />
        ) : tab === 'stats' ? (
          <Stats key={refreshKey} />
        ) : null}
      </div>
    </div>
    </JournalProvider>
  )
}
