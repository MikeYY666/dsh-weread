/**
 * The two views share one cache subscription; host-owned daily synchronization
 * survives navigation and keeps previously saved notes visible during updates.
 * Calendar keys deliberately use browser-local dates rather than UTC slices.
 * @module dsh-weread/client/journal
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { fetchBookshelf, fetchJournalCache, refreshJournalCache, fetchStats } from './api.js'
import { duration } from './format.js'
import { journalDayKey as dayKey, journalDaySeconds } from './journalDates.js'
import { selectJournalQuote, selectJournalBookQuote } from './journalQuote.js'
import type { BookshelfPayload, JournalNote, ReadingStats } from '../types.js'

type JournalProps = { onOpenBook: (bookId: string) => void; refreshKey?: string | number }
type Filter = 'all' | 'highlight' | 'thought'
const PAGE_SIZE = 100

function noteKey(note: JournalNote): string { return `${note.bookId}:${note.kind}:${note.id}` }
function message(error: unknown): string { return error instanceof Error ? error.message : '请求失败，请稍后重试' }
function useToday(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    const timer = window.setTimeout(() => setNow(new Date()), Math.max(1000, next.getTime() - Date.now() + 100))
    return () => window.clearTimeout(timer)
  }, [now])
  return now
}

/** A single host-cache subscription is shared across both journal views. */
function useJournalLoader(refreshKey: number) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState({ notes: [] as readonly JournalNote[], total: 0, scanned: 0, failed: 0, loading: true, syncing: false, hasCache: false, updatedAt: 0, complete: false, error: '' })
  useEffect(() => {
    const controller = new AbortController()
    let timer: number | undefined
    const read = async (force: boolean) => {
      try {
        const value = await (force ? refreshJournalCache(controller.signal) : fetchJournalCache(controller.signal))
        if (controller.signal.aborted) return
        setState({ notes: value.notes, total: value.totalBooks, scanned: value.scannedBooks, failed: value.failedBooks, loading: value.syncing && !value.hasCache, syncing: value.syncing, hasCache: value.hasCache, updatedAt: value.updatedAt, complete: value.updatedAt > 0, error: value.error })
        // Poll only an active host sync; cached visits make a single local request.
        if (value.syncing) timer = window.setTimeout(() => { void read(false) }, 2000)
        else if (value.updatedAt > 0 && !value.error) {
          const untilNextDay = value.updatedAt + 24 * 60 * 60_000 - Date.now()
          timer = window.setTimeout(() => { void read(false) }, Math.max(60_000, untilNextDay))
        }
      } catch (error) {
        if (!controller.signal.aborted) setState((previous) => ({ ...previous, loading: false, syncing: false, error: message(error) }))
      }
    }
    void read(attempt > 0 || refreshKey > 0)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [refreshKey, attempt])
  return { ...state, retry: () => setAttempt((value) => value + 1) }
}

type JournalState = ReturnType<typeof useJournalLoader>
const JournalContext = createContext<JournalState | null>(null)
export function JournalProvider({ children, refreshKey }: { children: ReactNode; refreshKey: number }): ReactNode {
  const journal = useJournalLoader(refreshKey)
  return <JournalContext.Provider value={journal}>{children}</JournalContext.Provider>
}
function useJournal(): JournalState {
  const journal = useContext(JournalContext)
  if (journal === null) throw new Error('阅读手记缺少缓存上下文')
  return journal
}
function Coverage({ journal }: { journal: JournalState }): ReactNode {
  return <div className="weread-journal-coverage" aria-live="polite" aria-atomic="true">
    <span>{journal.hasCache ? `已缓存 ${journal.notes.length} 条笔记${journal.updatedAt > 0 ? ` · 上次同步 ${new Date(journal.updatedAt).toLocaleString('zh-CN')}` : ' · 部分内容'}` : `首次整理笔记 · 已扫描 ${journal.scanned} / ${journal.total} 本 · ${journal.notes.length} 条`}{journal.hasCache && journal.syncing ? ' · 正在后台同步' : ''}</span>
    {journal.failed > 0 ? <span className="weread-journal-warning">{journal.failed} 本笔记获取失败，当前内容尚不完整。</span> : null}
    {journal.error ? <span className="weread-journal-warning" role="alert">{journal.error}</span> : null}
    {!journal.loading && !journal.complete ? <button type="button" className="weread-journal-button" onClick={journal.retry}>重试加载笔记</button> : null}
  </div>
}
function useResource<T>(load: (signal: AbortSignal) => Promise<T>, refreshKey: string) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ value: T | null; error: string; loading: boolean }>({ value: null, error: '', loading: true })
  useEffect(() => {
    const controller = new AbortController()
    setState({ value: null, error: '', loading: true })
    void load(controller.signal).then((value) => {
      if (!controller.signal.aborted) setState({ value, error: '', loading: false })
    }, (error: unknown) => {
      if (!controller.signal.aborted) setState({ value: null, error: message(error), loading: false })
    })
    return () => controller.abort()
  }, [load, refreshKey, attempt])
  return { ...state, retry: () => setAttempt((value) => value + 1) }
}
const loadShelf = (signal: AbortSignal): Promise<BookshelfPayload> => fetchBookshelf(signal)
function ResourceError({ error, retry }: { error: string; retry: () => void }): ReactNode {
  return <div className="weread-journal-warning" role="alert">{error} <button type="button" className="weread-journal-button" onClick={retry}>重试</button></div>
}

/** Covers come from cached notebook metadata; no extra book-info calls. */
function JournalBookSource({ note, onOpenBook, children }: { note: JournalNote; onOpenBook: JournalProps['onOpenBook']; children?: ReactNode }): ReactNode {
  const [failedCover, setFailedCover] = useState('')
  return <div className="weread-journal-note-source">
    <button type="button" className="weread-journal-note-cover" aria-label={`查看《${note.bookTitle || '未命名书籍'}》详情`} onClick={() => onOpenBook(note.bookId)}>
      {note.cover && failedCover !== note.cover ? <img src={note.cover} alt="" loading="lazy" decoding="async" onError={() => setFailedCover(note.cover)} /> : <span aria-hidden="true">书</span>}
    </button>
    <div className="weread-journal-note-content">
      {children}
      <div className="weread-journal-note-book-meta">
        <button type="button" className="weread-journal-book-link" onClick={() => onOpenBook(note.bookId)}>《{note.bookTitle || '未命名书籍'}》</button>
        {note.author ? <span>{note.author}</span> : null}
        {note.chapterTitle ? <span>{note.chapterTitle}</span> : null}
      </div>
    </div>
  </div>
}

function NoteList({ notes, onOpenBook, empty }: { notes: readonly JournalNote[]; onOpenBook: JournalProps['onOpenBook']; empty: string }): ReactNode {
  const [limit, setLimit] = useState(PAGE_SIZE)
  useEffect(() => setLimit(PAGE_SIZE), [notes])
  if (notes.length === 0) return <p className="weread-journal-empty">{empty}</p>
  return <>
    <div className="weread-journal-notes">{notes.slice(0, limit).map((note) => <article className={`weread-journal-note is-${note.kind}`} key={noteKey(note)}>
      <JournalBookSource note={note} onOpenBook={onOpenBook}>
        <div className="weread-journal-note-meta"><span>{note.kind === 'highlight' ? '划线' : '想法'}</span><time dateTime={dayKey(new Date(note.createTime))}>{new Date(note.createTime).toLocaleDateString('zh-CN')}</time></div>
        <p className="weread-journal-note-text">{note.text}</p>
      </JournalBookSource>
      <footer><a href={`weread://reading?bId=${encodeURIComponent(note.bookId)}`} aria-label={`在微信读书打开${note.bookTitle}`}>打开阅读 ↗</a></footer>
    </article>)}</div>
    {limit < notes.length ? <button type="button" className="weread-journal-button weread-journal-more" onClick={() => setLimit((value) => value + PAGE_SIZE)}>再看 {Math.min(PAGE_SIZE, notes.length - limit)} 条（剩余 {notes.length - limit} 条）</button> : null}
  </>
}
function Quote({ notes, today, complete, onOpenBook, preferToday = false }: { notes: readonly JournalNote[]; today: Date; complete: boolean; onOpenBook: JournalProps['onOpenBook']; preferToday?: boolean }): ReactNode {
  const key = dayKey(today)
  const [choice, setChoice] = useState<{ day: string; quote: JournalNote | undefined }>(() => ({ day: key, quote: undefined }))
  const highlights = useMemo(() => notes.filter((note) => note.kind === 'highlight' && dayKey(new Date(note.createTime)) <= key && note.text.trim()).slice().sort((a, b) => noteKey(a).localeCompare(noteKey(b))), [notes, key])
  const todayHighlights = useMemo(() => preferToday ? highlights.filter((note) => dayKey(new Date(note.createTime)) === key) : [], [highlights, key, preferToday])
  const candidates = todayHighlights.length > 0 ? todayHighlights : highlights.filter((note) => dayKey(new Date(note.createTime)) < key)
  const seed = [...key].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0)
  const quote = selectJournalQuote(choice.day === key ? choice.quote : undefined, candidates, seed)
  // Batch arrivals expand the candidates, but never replace text being read.
  useEffect(() => {
    if (choice.day !== key || choice.quote !== quote) setChoice({ day: key, quote })
  }, [choice, key, quote])
  const title = quote !== undefined && dayKey(new Date(quote.createTime)) === key ? '今日划下的一句' : '旧句重逢'
  const sameBookHighlights = highlights.filter((note) => note.bookId === quote?.bookId)
  const canChangeBook = highlights.some((note) => note.bookId !== quote?.bookId)
  return <section className="weread-journal-quote" aria-label={title}>
    <div className="weread-journal-section-head"><h2>{title}</h2><div className="weread-journal-quote-actions">
      <button type="button" className="weread-journal-button" title="换一句当前书里的划线" disabled={!sameBookHighlights.some((note) => note.id !== quote?.id)} onClick={() => setChoice({ day: key, quote: selectJournalQuote(quote, sameBookHighlights, seed, true) })}>换一句</button>
      <button type="button" className="weread-journal-button" title={canChangeBook ? '从已缓存的划线中换一本不同的书' : '当前没有其他书的划线'} disabled={!canChangeBook} onClick={() => setChoice({ day: key, quote: selectJournalBookQuote(quote, highlights, seed) })}>换一本</button>
    </div></div>
    {quote ? <><JournalBookSource note={quote} onOpenBook={onOpenBook}><blockquote>{quote.text}</blockquote><p className="weread-journal-caption">你在 {new Date(quote.createTime).toLocaleDateString('zh-CN')} 留下的划线{complete ? '' : ' · 从已加载笔记中选取'}</p></JournalBookSource></> : <p className="weread-journal-empty">{complete ? '还没有往日划线。下一次遇到心动的句子，留给未来的自己。' : '已加载笔记中暂无往日划线，笔记加载完成后再来看看。'}</p>}
  </section>
}

/** 今日: current reading evidence and personal notes, with independent failures. */
export function Today({ onOpenBook, refreshKey }: JournalProps): ReactNode {
  const today = useToday()
  const key = dayKey(today)
  const journal = useJournal()
  const [refresh, setRefresh] = useState(0)
  const resourceKey = `${refreshKey ?? ''}:${refresh}:${key}`
  const baseTime = Math.floor(new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12).getTime() / 1000)
  const loadStats = useMemo(() => (signal: AbortSignal): Promise<ReadingStats> => fetchStats('monthly', signal, baseTime), [baseTime])
  const stats = useResource(loadStats, resourceKey)
  const shelf = useResource(loadShelf, resourceKey)
  const notes = useMemo(() => journal.notes.filter((note) => dayKey(new Date(note.createTime)) === key), [journal.notes, key])
  const books = shelf.value?.books.filter((book) => !book.isArticle && book.lastReadDate > 0 && dayKey(new Date(book.lastReadDate)) === key).sort((a, b) => b.lastReadDate - a.lastReadDate)
  const readTime = stats.value === null ? undefined : journalDaySeconds(stats.value.readTimes, key)
  const refreshAll = () => { setRefresh((value) => value + 1); journal.retry() }
  return <div className="weread-journal">
    <header className="weread-journal-heading"><div><p className="weread-journal-eyebrow">阅读手记 · 今日</p><h1>把今天，读进生活里。</h1><time dateTime={key}>{today.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</time></div><button type="button" className="weread-journal-button" onClick={refreshAll}>刷新今日</button></header>
    <section className="weread-journal-summary" aria-label="今日概览">
      <div><span>阅读 / 收听时长</span><strong>{stats.loading ? '加载中…' : readTime === undefined ? stats.error ? '暂不可用' : '今日暂无记录' : duration(readTime)}</strong>{stats.error ? <ResourceError error={stats.error} retry={stats.retry} /> : null}</div>
      <div><span>今日划线{journal.complete ? '' : ' · 已加载'}</span><strong>{journal.loading && journal.notes.length === 0 ? '加载中…' : !journal.complete && journal.notes.length === 0 ? '暂不可用' : `${notes.filter((note) => note.kind === 'highlight').length} 条`}</strong></div>
      <div><span>今日想法{journal.complete ? '' : ' · 已加载'}</span><strong>{journal.loading && journal.notes.length === 0 ? '加载中…' : !journal.complete && journal.notes.length === 0 ? '暂不可用' : `${notes.filter((note) => note.kind === 'thought').length} 条`}</strong></div>
    </section>
    <section className="weread-journal-section"><div className="weread-journal-section-head"><h2>今天翻开的书</h2><span className="weread-journal-caption">按书架最近阅读日期 · 电子书</span></div>
      {shelf.loading ? <p className="weread-journal-empty" role="status">正在查看今日书架…</p> : shelf.error ? <ResourceError error={shelf.error} retry={shelf.retry} /> : books?.length === 0 ? <p className="weread-journal-empty">书架中还没有最近阅读日期为今天的电子书。打开一本，让今天多一页。</p> : <div className="weread-journal-books">{books?.map((book) => <article className="weread-journal-book" key={book.bookId}>
        <button type="button" className="weread-journal-book-main" onClick={() => onOpenBook(book.bookId)}>{book.cover ? <img src={book.cover} alt="" loading="lazy" /> : <span className="weread-journal-cover">书</span>}<span><strong>{book.title}</strong><small>{book.author || '未知作者'}</small><small>查看书籍与笔记 →</small></span></button><a href={`weread://reading?bId=${encodeURIComponent(book.bookId)}`} aria-label={`在微信读书继续阅读${book.title}`}>继续阅读 ↗</a>
      </article>)}</div>}
    </section>
    <Quote notes={journal.notes} today={today} complete={journal.complete} onOpenBook={onOpenBook} preferToday />
    <section className="weread-journal-section"><div className="weread-journal-section-head"><h2>今天留下的痕迹</h2><span className="weread-journal-caption">个人划线与想法</span></div><Coverage journal={journal} /><NoteList notes={notes} onOpenBook={onOpenBook} empty={journal.complete ? '今天还没有笔记。好句子和新想法，随时值得记下来。' : '已加载范围内暂无今日笔记；当前笔记尚未完整。'} /></section>
  </div>
}

/** 回顾: calendar of note creation dates, never inferred reading history. */
export function Retrospect({ onOpenBook, refreshKey }: JournalProps): ReactNode {
  const today = useToday()
  const journal = useJournal()
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [selected, setSelected] = useState(() => dayKey(today))
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const counts = useMemo(() => {
    const result = new Map<string, number>()
    for (const note of journal.notes) { const key = dayKey(new Date(note.createTime)); result.set(key, (result.get(key) ?? 0) + 1) }
    return result
  }, [journal.notes])
  const matches = (note: JournalNote) => (filter === 'all' || note.kind === filter) && `${note.bookTitle} ${note.author} ${note.text}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  const selectedNotes = useMemo(() => journal.notes.filter((note) => dayKey(new Date(note.createTime)) === selected && matches(note)), [journal.notes, selected, filter, query])
  const anniversaries = useMemo(() => journal.notes.filter((note) => { const date = new Date(note.createTime); return date.getFullYear() < today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate() && matches(note) }), [journal.notes, dayKey(today), filter, query])
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const offset = (month.getDay() + 6) % 7
  const canNext = month.getFullYear() < today.getFullYear() || (month.getFullYear() === today.getFullYear() && month.getMonth() < today.getMonth())
  const moveMonth = (delta: number) => { const next = new Date(month.getFullYear(), month.getMonth() + delta, 1); setMonth(next); setSelected(dayKey(next)) }
  const jumpTo = (date: Date) => { setMonth(new Date(date.getFullYear(), date.getMonth(), 1)); setSelected(dayKey(date)) }
  const latestNote = journal.notes.find((note) => dayKey(new Date(note.createTime)) <= dayKey(today))
  const monthValue = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`
  return <div className="weread-journal is-retrospect">
    <header className="weread-journal-heading"><div><p className="weread-journal-eyebrow">阅读手记 · 回顾</p><h1>重逢，曾经心动的文字。</h1><p className="weread-journal-caption">按笔记创建日期回顾，你的划线与想法。</p></div><button type="button" className="weread-journal-button" onClick={journal.retry}>立即同步</button></header>
    <Coverage journal={journal} />
    <div className="weread-journal-filters"><div className="weread-journal-filter-buttons" role="group" aria-label="笔记类型">{([{ id: 'all', label: '全部' }, { id: 'highlight', label: '划线' }, { id: 'thought', label: '想法' }] as const).map((item) => <button type="button" className="weread-journal-button" key={item.id} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</button>)}</div><label className="weread-journal-search"><span>搜索笔记</span><input type="search" placeholder="书名、作者或文字" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div>
    <div className="weread-journal-retro-grid"><section className="weread-journal-calendar" aria-label="笔记日历">
      <div className="weread-journal-month"><button type="button" className="weread-journal-button" aria-label="上个月" onClick={() => moveMonth(-1)}>←</button><h2 aria-live="polite">{month.getFullYear()} 年 {month.getMonth() + 1} 月</h2><button type="button" className="weread-journal-button" aria-label="下个月" disabled={!canNext} onClick={() => moveMonth(1)}>→</button></div>
      <label className="weread-journal-month-jump">跳至月份<input type="month" aria-label="跳至笔记月份" value={monthValue} max={dayKey(today).slice(0, 7)} onChange={(event) => { const value = event.target.value; if (/^\d{4}-\d{2}$/.test(value) && value <= dayKey(today).slice(0, 7)) { const [year, monthNumber] = value.split('-').map(Number); if (year !== undefined && monthNumber !== undefined && monthNumber >= 1 && monthNumber <= 12) jumpTo(new Date(year, monthNumber - 1, 1)) } }} /></label>
      <div className="weread-journal-calendar-grid">{['一', '二', '三', '四', '五', '六', '日'].map((day) => <span className="weread-journal-weekday" key={day} aria-hidden="true">{day}</span>)}{Array.from({ length: offset }, (_, index) => <span key={`empty-${index}`} />)}{Array.from({ length: days }, (_, index) => { const date = new Date(month.getFullYear(), month.getMonth(), index + 1); const key = dayKey(date); const count = counts.get(key) ?? 0; return <button type="button" className={`weread-journal-day${count > 0 ? ' has-notes' : ''}`} key={key} disabled={key > dayKey(today)} aria-pressed={selected === key} aria-current={key === dayKey(today) ? 'date' : undefined} aria-label={`${key}，${journal.complete ? '' : '已加载'}${count} 条笔记`} onClick={() => setSelected(key)}><span>{index + 1}</span><small>{count > 0 ? count : '·'}</small></button> })}</div>
      <p className="weread-journal-caption">标记为笔记数量{journal.complete ? '' : '（当前已加载范围）'}</p><button type="button" className="weread-journal-button" onClick={() => jumpTo(today)}>回到今天</button>{latestNote ? <button type="button" className="weread-journal-button" onClick={() => jumpTo(new Date(latestNote.createTime))}>最近笔记日{journal.complete ? '' : '（已加载）'}</button> : null}
    </section><section className="weread-journal-section weread-journal-day-notes"><div className="weread-journal-section-head"><h2>{selected}</h2><span className="weread-journal-caption">{selectedNotes.length} 条{journal.complete ? '' : ' · 已加载'}</span></div><NoteList notes={selectedNotes} onOpenBook={onOpenBook} empty={journal.complete ? '这一天没有符合筛选的笔记，试着翻翻其他日子。' : '已加载范围内，这一天暂无符合筛选的笔记。笔记尚不完整。'} /></section></div>
    <section className="weread-journal-section"><div className="weread-journal-section-head"><h2>那年今日</h2><span className="weread-journal-caption">往年 {today.getMonth() + 1} 月 {today.getDate()} 日的笔记</span></div><NoteList notes={anniversaries} onOpenBook={onOpenBook} empty={journal.complete ? '往年今日没有符合筛选的笔记。去「旧句重逢」看看其他日子的相遇。' : '已加载范围内暂无往年今日的笔记，当前笔记尚未完整。'} /></section>
    {anniversaries.length === 0 ? <Quote notes={journal.notes} today={today} complete={journal.complete} onOpenBook={onOpenBook} /> : null}
  </div>
}
