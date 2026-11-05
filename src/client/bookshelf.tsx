/**
 * The 书架 tab rendered from the WeChat Reading book shelf (`/shelf/sync`).
 *
 * This is the shelf as the app itself shows it: folders (书单) are entries just
 * like books — a folder draws its own books' covers as a thumbnail mosaic and
 * sits in the same grid, sorted by the same rule. Books inside a folder are not
 * repeated at the top level, so the view has two levels: the shelf root, and one
 * folder's page.
 * @module dsh-weread/client/bookshelf
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApiError, fetchBookshelf, fetchProgressBatch } from './api.js'
import { BookCard } from './bookCard.js'
import type { BookshelfPayload, ShelfAlbum, ShelfBook, ShelfFolder } from '../types.js'

/** How many book ids ride one `/progress-batch` request. */
const PROGRESS_CHUNK = 20

/** Which books survive the toolbar's filter. The shelf source has no note counts. */
type ShelfFilter = 'all' | 'reading' | 'finished'

/** The toolbar's sort orders for the shelf root. */
type ShelfSort = 'recent' | 'title' | 'progress'

/** How many covers a folder mosaic shows; more would not fit the card. */
const MOSAIC_CELLS = 4

const FILTER_LABELS: ReadonlyArray<{ id: ShelfFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'reading', label: '在读' },
  { id: 'finished', label: '读完' },
]

const SORT_LABELS: ReadonlyArray<{ id: ShelfSort; label: string }> = [
  { id: 'recent', label: '最近阅读' },
  { id: 'title', label: '书名' },
  { id: 'progress', label: '进度' },
]

/** Compare two titles with the locale-aware collator (Chinese pinyin). */
const titleCollator = new Intl.Collator('zh-Hans-CN', { sensitivity: 'base' })

/**
 * One entry of the shelf root grid.
 *
 * Folders and books share one list so they can be filtered and sorted together;
 * `books` is the folder's resolved content (ids the shelf payload also returned).
 */
type ShelfItem =
  | { readonly kind: 'book'; readonly book: ShelfBook }
  | { readonly kind: 'folder'; readonly folder: ShelfFolder; readonly books: readonly ShelfBook[] }

/** True when a book matches the active filter. */
function matchesFilter(book: ShelfBook, filter: ShelfFilter): boolean {
  switch (filter) {
    case 'reading':
      return !book.progress.isFinished && book.progress.progress > 0
    case 'finished':
      return book.progress.isFinished
    case 'all':
    default:
      return true
  }
}

/** True when a book matches the search box. */
function matchesQuery(book: ShelfBook, needle: string): boolean {
  return book.title.toLowerCase().includes(needle) || book.author.toLowerCase().includes(needle)
}

/** A folder matches when any book inside it does; an empty folder only under 全部. */
function itemMatchesFilter(item: ShelfItem, filter: ShelfFilter): boolean {
  if (item.kind === 'book') return matchesFilter(item.book, filter)
  if (item.books.length === 0) return filter === 'all'
  return item.books.some((book) => matchesFilter(book, filter))
}

/** A folder matches by its own name, or by any book inside it. */
function itemMatchesQuery(item: ShelfItem, needle: string): boolean {
  if (item.kind === 'book') return matchesQuery(item.book, needle)
  if (item.folder.name.toLowerCase().includes(needle)) return true
  return item.books.some((book) => matchesQuery(book, needle))
}

/** Most recent read inside a folder, so folders sort by recency like books do. */
function itemLastRead(item: ShelfItem): number {
  if (item.kind === 'book') return item.book.lastReadDate
  return item.books.reduce((latest, book) => Math.max(latest, book.lastReadDate), 0)
}

/** Mean progress inside a folder, so the progress sort treats it as one unit. */
function itemProgress(item: ShelfItem): number {
  if (item.kind === 'book') return item.book.progress.progress
  if (item.books.length === 0) return 0
  const total = item.books.reduce((sum, book) => sum + book.progress.progress, 0)
  return total / item.books.length
}

/** Display title: a book's title or the folder's name. */
function itemTitle(item: ShelfItem): string {
  return item.kind === 'book' ? item.book.title : item.folder.name
}

/**
 * Order shelf entries for the active sort. Only a book can be pinned on the
 * shelf root; a folder inherits its books' recency and mean progress.
 */
function compareItems(a: ShelfItem, b: ShelfItem, sort: ShelfSort): number {
  const pinnedA = a.kind === 'book' && a.book.isTop === true ? 1 : 0
  const pinnedB = b.kind === 'book' && b.book.isTop === true ? 1 : 0
  if (pinnedA !== pinnedB) return pinnedB - pinnedA
  switch (sort) {
    case 'title':
      return titleCollator.compare(itemTitle(a), itemTitle(b))
    case 'progress':
      return itemProgress(b) - itemProgress(a)
    case 'recent':
    default:
      return itemLastRead(b) - itemLastRead(a)
  }
}

/**
 * One folder, drawn at book size: its books' covers tiled as a thumbnail mosaic.
 *
 * The mosaic shows at most {@link MOSAIC_CELLS} covers on a 1/2/4-cell layout, so
 * a folder of any size still reads at a glance. An empty folder (or one whose
 * books the payload does not enumerate) falls back to a folder glyph.
 */
function FolderTile({
  folder,
  books,
  onOpen,
}: {
  folder: ShelfFolder
  books: readonly ShelfBook[]
  onOpen: () => void
}): ReactNode {
  // Total is the server's own count: `books` may miss ids the payload did not list.
  const total = folder.bookIds.length
  const preview = books.slice(0, MOSAIC_CELLS)
  return (
    <button type="button" className="weread-card weread-folder-tile" onClick={onOpen} title={folder.name}>
      <div className="weread-card-cover">
        {preview.length === 0 ? (
          <span className="weread-cover-fallback" aria-hidden="true">
            <svg viewBox="0 0 48 40" width="52%" height="52%" role="presentation">
              <path
                d="M4 8.5A3.5 3.5 0 0 1 7.5 5h10.2c1 0 2 .45 2.7 1.2l2 2.3h16.1A3.5 3.5 0 0 1 42 12v19.5a3.5 3.5 0 0 1-3.5 3.5h-31A3.5 3.5 0 0 1 4 31.5Z"
                fill="currentColor"
                opacity="0.28"
              />
            </svg>
          </span>
        ) : (
          <div className="weread-mosaic" data-count={String(preview.length)}>
            {preview.map((book) => (
              <span key={book.bookId} className="weread-mosaic-cell">
                {book.cover !== '' ? (
                  <img src={book.cover} alt="" loading="lazy" className="weread-cover-img" />
                ) : (
                  <span className="weread-cover-fallback">{book.title.slice(0, 1)}</span>
                )}
              </span>
            ))}
          </div>
        )}
        <span className="weread-folder-mark" title="文件夹" aria-hidden="true">
          <svg viewBox="0 0 24 20" width="11" height="9" role="presentation">
            <path
              d="M1 4.2A2.2 2.2 0 0 1 3.2 2h6.1c.6 0 1.2.28 1.7.75l1.2 1.35h8.6A2.2 2.2 0 0 1 23 6.3v10.5A2.2 2.2 0 0 1 20.8 19H3.2A2.2 2.2 0 0 1 1 16.8Z"
              fill="currentColor"
            />
          </svg>
        </span>
        <span className="weread-card-badge">{total}</span>
      </div>
      <div className="weread-card-body">
        <span className="weread-card-title" title={folder.name}>
          {folder.name}
        </span>
        <span className="weread-card-author">文件夹 · {total} 本</span>
      </div>
    </button>
  )
}

/** One audiobook tile. Albums cannot open the book detail view (different id space). */
function AlbumCard({ album }: { album: ShelfAlbum }): ReactNode {
  return (
    <div className="weread-album" title={album.name}>
      <div className="weread-card-cover">
        {album.cover !== '' ? (
          <img src={album.cover} alt="" loading="lazy" className="weread-cover-img" />
        ) : (
          <span className="weread-cover-fallback">{album.name.slice(0, 1)}</span>
        )}
        <span className="weread-album-tag">有声书</span>
      </div>
      <div className="weread-card-body">
        <span className="weread-card-title" title={album.name}>
          {album.name}
        </span>
        <span className="weread-card-author">{album.author || '未知演播'}</span>
        <span className="weread-card-meta">
          {album.trackCount > 0 ? `${album.trackCount} 集` : '专辑'}
          {album.isFinished ? ' · 已完结' : ''}
        </span>
      </div>
    </div>
  )
}

export interface BookshelfProps {
  /** Open a book's detail view. */
  readonly onOpenBook: (bookId: string) => void
}

/**
 * The book-shelf view: the shelf root (folders and books in one grid, then
 * audiobooks) and one folder page per drilled-in folder.
 */
export function Bookshelf({ onOpenBook }: BookshelfProps): ReactNode {
  const [payload, setPayload] = useState<BookshelfPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ShelfFilter>('all')
  const [sort, setSort] = useState<ShelfSort>('recent')
  const [folderId, setFolderId] = useState<string | null>(null)
  // Guards post-unmount state writes while progress chunks are still flowing.
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  /** Fetch progress in chunks and merge each chunk in as it arrives. */
  const fillProgress = useCallback(async (bookIds: string[]) => {
    for (let start = 0; start < bookIds.length; start += PROGRESS_CHUNK) {
      const chunk = bookIds.slice(start, start + PROGRESS_CHUNK)
      let map: Awaited<ReturnType<typeof fetchProgressBatch>>
      try {
        map = await fetchProgressBatch(chunk)
      } catch {
        // Progress is a progressive enhancement; a failed chunk leaves cards at 0.
        continue
      }
      if (!aliveRef.current) return
      setPayload((prev) =>
        prev === null
          ? prev
          : {
              ...prev,
              books: prev.books.map((book) => {
                const next = map[book.bookId]
                return next === undefined ? book : { ...book, progress: next }
              }),
            },
      )
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await fetchBookshelf()
      setPayload(next)
      // The shelf payload carries no percentage, only `finishReading`, so the
      // real progress arrives afterwards card by card.
      void fillProgress(next.books.map((book) => book.bookId))
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : String(caught))
      setPayload(null)
    } finally {
      setLoading(false)
    }
  }, [fillProgress])

  useEffect(() => {
    void load()
  }, [load])

  const books = payload?.books ?? []
  const folders = payload?.folders ?? []
  const albums = payload?.albums ?? []

  const bookById = useMemo(() => {
    const map = new Map<string, ShelfBook>()
    for (const book of books) map.set(book.bookId, book)
    return map
  }, [books])

  /** Ids that live in a folder; they are not repeated on the shelf root. */
  const filedIds = useMemo(() => {
    const ids = new Set<string>()
    for (const folder of folders) for (const id of folder.bookIds) ids.add(id)
    return ids
  }, [folders])

  const openFolder = folderId === null ? undefined : folders.find((folder) => folder.id === folderId)

  /** Books of the open folder, in the folder's own order. */
  const folderBooks = useMemo(() => {
    if (openFolder === undefined) return []
    return openFolder.bookIds
      .map((id) => bookById.get(id))
      .filter((book): book is ShelfBook => book !== undefined)
  }, [openFolder, bookById])

  /**
   * The shelf root: folders first as entries, then every book the user did not
   * put in one — both in a single list so they mix under one sort.
   */
  const items = useMemo<ShelfItem[]>(() => {
    const list: ShelfItem[] = []
    for (const folder of folders) {
      const contents = folder.bookIds
        .map((id) => bookById.get(id))
        .filter((book): book is ShelfBook => book !== undefined)
      list.push({ kind: 'folder', folder, books: contents })
    }
    for (const book of books) {
      if (!filedIds.has(book.bookId)) list.push({ kind: 'book', book })
    }
    return list
  }, [folders, books, filedIds, bookById])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = items
      .filter((item) => itemMatchesFilter(item, filter))
      .filter((item) => needle === '' || itemMatchesQuery(item, needle))
    return filtered.slice().sort((a, b) => compareItems(a, b, sort))
  }, [items, query, filter, sort])

  /** Folder-page books after search + filter; the folder's own order is kept. */
  const visibleFolderBooks = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return folderBooks
      .filter((book) => matchesFilter(book, filter))
      .filter((book) => needle === '' || matchesQuery(book, needle))
  }, [folderBooks, query, filter])

  if (loading && payload === null) {
    return (
      <div className="weread-state">
        <span className="weread-spinner" aria-hidden="true" />
        <p>加载书架中…</p>
      </div>
    )
  }

  return (
    <div className="weread-shelf">
      {openFolder !== undefined ? (
        <nav className="weread-breadcrumb" aria-label="目录">
          <button type="button" className="weread-back" onClick={() => setFolderId(null)}>
            ← 书架
          </button>
          <span className="weread-breadcrumb-sep">/</span>
          <span className="weread-breadcrumb-current">{openFolder.name}</span>
          <span className="weread-group-count">{folderBooks.length}</span>
        </nav>
      ) : null}

      <div className="weread-toolbar">
        <input
          type="search"
          className="weread-search"
          placeholder="搜索书名或作者"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="weread-chips" role="group" aria-label="筛选">
          {FILTER_LABELS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`weread-chip${filter === item.id ? ' is-active' : ''}`}
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {openFolder === undefined ? (
          <select
            className="weread-select"
            value={sort}
            aria-label="排序"
            onChange={(event) => setSort(event.target.value as ShelfSort)}
          >
            {SORT_LABELS.map((item) => (
              <option key={item.id} value={item.id}>
                排序：{item.label}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {error !== null ? <div className="weread-error">{error}</div> : null}

      {openFolder !== undefined ? (
        visibleFolderBooks.length === 0 ? (
          <p className="weread-empty">{folderBooks.length === 0 ? '这个文件夹是空的' : '没有符合条件的书'}</p>
        ) : (
          <div className="weread-grid">
            {visibleFolderBooks.map((book) => (
              <BookCard key={book.bookId} book={book} onOpen={() => onOpenBook(book.bookId)} />
            ))}
          </div>
        )
      ) : visible.length === 0 ? (
        <p className="weread-empty">{items.length === 0 ? '书架上还没有书' : '没有符合条件的书'}</p>
      ) : (
        <div className="weread-grid">
          {visible.map((item) =>
            item.kind === 'book' ? (
              <BookCard key={item.book.bookId} book={item.book} onOpen={() => onOpenBook(item.book.bookId)} />
            ) : (
              <FolderTile
                key={`folder:${item.folder.id}`}
                folder={item.folder}
                books={item.books}
                onOpen={() => {
                  setQuery('')
                  setFolderId(item.folder.id)
                }}
              />
            ),
          )}
        </div>
      )}

      {openFolder === undefined && albums.length > 0 ? (
        <section className="weread-block">
          <h3 className="weread-group-title">
            有声书
            <span className="weread-group-count">{albums.length}</span>
          </h3>
          <div className="weread-grid">
            {albums.map((album) => (
              <AlbumCard key={album.albumId} album={album} />
            ))}
          </div>
        </section>
      ) : null}

      {openFolder === undefined && payload?.hasArticleCollection === true ? (
        <p className="weread-hint">书架上还有一个「文章收藏」入口，内容请在微信读书 App 中查看。</p>
      ) : null}
    </div>
  )
}
