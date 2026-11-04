/**
 * The second-level book detail view: header metadata plus five tabs of reading
 * material. All fetches run in parallel on mount; each tab shows independent
 * loading / error / empty states so one slow route never blocks the others.
 * @module dsh-weread/client/bookDetail
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  ApiError,
  fetchBook,
  fetchHighlights,
  fetchPopular,
  fetchPublicReviews,
  fetchReviews,
} from './api.js'
import { AiPanel } from './aiPanel.js'
import { compactNumber, date, durationShort, percent, wordCount } from './format.js'
import type {
  BookDetail,
  ChapterHighlights,
  PopularHighlight,
  PublicReview,
  Review,
} from '../types.js'

export interface BookDetailViewProps {
  readonly bookId: string
  /** Return to the shelf. */
  readonly onBack: () => void
}

/** The detail tabs, in display order. */
type DetailTab = 'highlights' | 'reviews' | 'popular' | 'public' | 'ai'

const TABS: ReadonlyArray<{ id: DetailTab; label: string }> = [
  { id: 'highlights', label: '划线' },
  { id: 'reviews', label: '笔记' },
  { id: 'popular', label: '热门划线' },
  { id: 'public', label: '书评' },
  { id: 'ai', label: 'AI 总结' },
]

/** A tiny helper to keep the five parallel resources' states uniform. */
interface Resource<T> {
  status: 'loading' | 'ready' | 'error'
  data: T | null
  error: string | null
}

/** Empty-state placeholder row. */
function Empty({ children = '暂无数据' }: { children?: ReactNode }): ReactNode {
  return <p className="weread-empty weread-empty-inline">{children}</p>
}

/** Shared loading row. */
function Loading({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="weread-state weread-state-inline">
      <span className="weread-spinner" aria-hidden="true" />
      <p>{children}</p>
    </div>
  )
}

/** Map a caught fetch error to an error banner. */
function ErrorNote({ message }: { message: string }): ReactNode {
  return <div className="weread-error">{message}</div>
}

/** 划线: highlights grouped by chapter. */
function HighlightsTab({ resource }: { resource: Resource<ChapterHighlights[]> }): ReactNode {
  if (resource.status === 'loading') return <Loading>加载划线与笔记…</Loading>
  if (resource.status === 'error') return <ErrorNote message={resource.error ?? '加载失败'} />
  const groups = resource.data ?? []
  if (groups.length === 0) return <Empty />
  return (
    <div className="weread-highlights">
      {groups.map((group) => (
        <section key={group.chapterUid} className="weread-hl-group">
          <h3 className="weread-hl-chapter">{group.chapterTitle}</h3>
          {group.highlights.map((hl) => (
            <blockquote key={hl.bookmarkId} className={`weread-hl-item weread-hl-color-${hl.colorStyle}`}>
              <p className="weread-hl-text">{hl.markText}</p>
              {hl.reviewContent !== undefined && hl.reviewContent !== '' ? (
                <p className="weread-hl-note">💭 {hl.reviewContent}</p>
              ) : null}
              <footer className="weread-hl-foot">
                <span>{date(hl.createTime)}</span>
                {hl.popularCount !== undefined && hl.popularCount > 0 ? (
                  <span className="weread-hl-pop">🔥 {compactNumber(hl.popularCount)}</span>
                ) : null}
              </footer>
            </blockquote>
          ))}
        </section>
      ))}
    </div>
  )
}

/** 笔记: the user's personal reviews. */
function ReviewsTab({ resource }: { resource: Resource<Review[]> }): ReactNode {
  if (resource.status === 'loading') return <Loading>加载笔记…</Loading>
  if (resource.status === 'error') return <ErrorNote message={resource.error ?? '加载失败'} />
  const reviews = resource.data ?? []
  if (reviews.length === 0) return <Empty />
  return (
    <div className="weread-reviews">
      {reviews.map((review) => (
        <article key={review.reviewId} className="weread-review-item">
          {review.chapterTitle ? <h4 className="weread-review-chapter">{review.chapterTitle}</h4> : null}
          {review.abstract !== undefined && review.abstract !== '' ? (
            <p className="weread-review-abstract">「{review.abstract}」</p>
          ) : null}
          <p className="weread-review-content">{review.content}</p>
          <footer className="weread-review-foot">{date(review.createTime)}</footer>
        </article>
      ))}
    </div>
  )
}

/** 热门划线: community highlights with their highlight counts. */
function PopularTab({ resource }: { resource: Resource<PopularHighlight[]> }): ReactNode {
  if (resource.status === 'loading') return <Loading>加载热门划线…</Loading>
  if (resource.status === 'error') return <ErrorNote message={resource.error ?? '加载失败'} />
  const items = resource.data ?? []
  if (items.length === 0) return <Empty />
  return (
    <div className="weread-popular">
      {items.map((item) => (
        <blockquote key={item.bookmarkId} className="weread-popular-item">
          <p className="weread-hl-text">{item.markText}</p>
          <footer className="weread-hl-foot">
            <span className="weread-popular-chapter">{item.chapterTitle}</span>
            <span className="weread-hl-pop">🔥 {compactNumber(item.totalCount)} 人划线</span>
          </footer>
        </blockquote>
      ))}
    </div>
  )
}

/** 书评: public reviews. */
function PublicTab({ resource }: { resource: Resource<PublicReview[]> }): ReactNode {
  if (resource.status === 'loading') return <Loading>加载书评…</Loading>
  if (resource.status === 'error') return <ErrorNote message={resource.error ?? '加载失败'} />
  const items = resource.data ?? []
  if (items.length === 0) return <Empty />
  return (
    <div className="weread-public">
      {items.map((item) => (
        <article key={item.reviewId} className="weread-public-item">
          <header className="weread-public-head">
            <span className="weread-public-author">{item.author || '匿名'}</span>
            <span className="weread-public-date">{date(item.createTime)}</span>
          </header>
          <p className="weread-public-content">{item.content}</p>
          {item.likeCount > 0 ? <footer className="weread-public-foot">👍 {compactNumber(item.likeCount)}</footer> : null}
        </article>
      ))}
    </div>
  )
}

/** The AI 总结 tab: two streaming panels for summary and themes. */
function AiTab({ bookId }: { bookId: string }): ReactNode {
  return (
    <div className="weread-ai-tab">
      <AiPanel task="summary" bookId={bookId} buttonLabel="生成AI总结" hint="基于本书划线、笔记与简介生成" />
      <hr className="weread-divider" />
      <AiPanel
        task="highlights-themes"
        bookId={bookId}
        buttonLabel="生成划线主题"
        hint="从本书划线中提炼主题脉络"
      />
    </div>
  )
}

/** Build an initial loading resource. */
function loadingResource<T>(): Resource<T> {
  return { status: 'loading', data: null, error: null }
}

/** Turn a fetch rejection into an error resource, preserving the host message. */
function errorResource<T>(caught: unknown): Resource<T> {
  return {
    status: 'error',
    data: null,
    error: caught instanceof ApiError ? caught.message : String(caught),
  }
}

/**
 * The book detail view.
 *
 * `bookId` identifies one book; changing it (navigating between books) refetches
 * everything. Each sub-resource resolves into its own `Resource` slot so a single
 * failing route degrades only its own tab.
 */
export function BookDetailView({ bookId, onBack }: BookDetailViewProps): ReactNode {
  const [tab, setTab] = useState<DetailTab>('highlights')
  const [book, setBook] = useState<Resource<BookDetail>>(loadingResource)
  const [highlights, setHighlights] = useState<Resource<ChapterHighlights[]>>(loadingResource)
  const [reviews, setReviews] = useState<Resource<Review[]>>(loadingResource)
  const [popular, setPopular] = useState<Resource<PopularHighlight[]>>(loadingResource)
  const [publicReviews, setPublicReviews] = useState<Resource<PublicReview[]>>(loadingResource)
  const [reloadToken, setReloadToken] = useState(0)

  const reload = useCallback(() => setReloadToken((n) => n + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    setBook(loadingResource())
    setHighlights(loadingResource())
    setReviews(loadingResource())
    setPopular(loadingResource())
    setPublicReviews(loadingResource())

    const signal = controller.signal
    fetchBook(bookId, signal)
      .then((value) => setBook({ status: 'ready', data: value, error: null }))
      .catch((caught) => {
        if (!signal.aborted) setBook(errorResource(caught))
      })
    fetchHighlights(bookId, signal)
      .then((value) => setHighlights({ status: 'ready', data: value, error: null }))
      .catch((caught) => {
        if (!signal.aborted) setHighlights(errorResource(caught))
      })
    fetchReviews(bookId, signal)
      .then((value) => setReviews({ status: 'ready', data: value, error: null }))
      .catch((caught) => {
        if (!signal.aborted) setReviews(errorResource(caught))
      })
    fetchPopular(bookId, signal)
      .then((value) => setPopular({ status: 'ready', data: value, error: null }))
      .catch((caught) => {
        if (!signal.aborted) setPopular(errorResource(caught))
      })
    fetchPublicReviews(bookId, signal)
      .then((value) => setPublicReviews({ status: 'ready', data: value, error: null }))
      .catch((caught) => {
        if (!signal.aborted) setPublicReviews(errorResource(caught))
      })

    return () => controller.abort()
  }, [bookId, reloadToken])

  const meta = book.data
  return (
    <div className="weread-detail">
      <div className="weread-detail-topbar">
        <button type="button" className="weread-back" onClick={onBack} aria-label="返回书架">
          ← 返回
        </button>
        <button type="button" className="weread-icon-btn" onClick={reload} title="重新加载" aria-label="重新加载">
          ⟳
        </button>
      </div>

      {book.status === 'loading' ? (
        <Loading>加载书籍信息…</Loading>
      ) : book.status === 'error' ? (
        <ErrorNote message={book.error ?? '加载失败'} />
      ) : meta !== null && meta !== undefined ? (
        <header className="weread-detail-header">
          <div className="weread-detail-cover">
            {meta.cover !== '' ? (
              <img src={meta.cover} alt="" className="weread-cover-img" />
            ) : (
              <span className="weread-cover-fallback">{meta.title.slice(0, 1)}</span>
            )}
          </div>
          <div className="weread-detail-meta">
            <h2 className="weread-detail-title">{meta.title}</h2>
            <p className="weread-detail-author">{meta.author || '未知作者'}</p>
            <div className="weread-detail-facts">
              {meta.category !== '' ? <span className="weread-tag">{meta.category}</span> : null}
              {meta.ratingTitle !== '' ? (
                <span className="weread-rating">★ {meta.ratingTitle}</span>
              ) : null}
              <span className="weread-detail-progress">
                进度 {percent(meta.progress)}
                {meta.isFinished ? ' · 已读完' : ''}
              </span>
              {meta.readingTime > 0 ? <span>累计 {durationShort(meta.readingTime)}</span> : null}
              {meta.totalWords > 0 ? <span>{wordCount(meta.totalWords)}</span> : null}
            </div>
            {meta.intro !== '' ? <p className="weread-detail-intro">{meta.intro}</p> : null}
          </div>
        </header>
      ) : null}

      <nav className="weread-tabs" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`weread-tab${tab === item.id ? ' is-active' : ''}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="weread-tabpanel" role="tabpanel">
        {tab === 'highlights' ? <HighlightsTab resource={highlights} /> : null}
        {tab === 'reviews' ? <ReviewsTab resource={reviews} /> : null}
        {tab === 'popular' ? <PopularTab resource={popular} /> : null}
        {tab === 'public' ? <PublicTab resource={publicReviews} /> : null}
        {tab === 'ai' ? <AiTab bookId={bookId} /> : null}
      </div>
    </div>
  )
}
