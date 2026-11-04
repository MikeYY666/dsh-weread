/**
 * Small in-memory LRU + TTL cache with single-flight in-flight coalescing.
 *
 * Every upstream WeChat Reading call is expensive and shared across browser
 * tabs; this keeps one copy, drops stale entries, and collapses a burst of
 * identical concurrent reads into one upstream request.
 * @module dsh-weread/src/host/store/cache
 */

interface Entry<T> {
  readonly value: T
  readonly expiresAt: number
}

/** A cache bound to one plugin instance. */
export interface Cache {
  /**
   * Return a cached value when fresh, otherwise run `produce` once and cache it.
   * Concurrent callers for the same key share the single in-flight promise.
   */
  get<T>(key: string, ttlMs: number, produce: () => Promise<T>): Promise<T>
  /** Drop one key (both cached value and in-flight record). */
  invalidate(key: string): void
  /** Drop every key whose name starts with `prefix`. */
  invalidatePrefix(prefix: string): void
  /** Drop everything. */
  clear(): void
}

/** Default cap on distinct keys before the least-recently-used one is evicted. */
const MAX_ENTRIES = 200

export function createCache(): Cache {
  const values = new Map<string, Entry<unknown>>()
  const inflight = new Map<string, Promise<unknown>>()

  /** Move a key to the most-recently-used end and evict the oldest if over cap. */
  function touch(key: string, entry: Entry<unknown>): void {
    values.delete(key)
    values.set(key, entry)
    while (values.size > MAX_ENTRIES) {
      const oldest = values.keys().next()
      if (oldest.done === true) break
      values.delete(oldest.value)
    }
  }

  return {
    async get<T>(key: string, ttlMs: number, produce: () => Promise<T>): Promise<T> {
      const now = Date.now()
      const hit = values.get(key) as Entry<T> | undefined
      if (hit !== undefined && hit.expiresAt > now) {
        touch(key, hit as Entry<unknown>)
        return hit.value
      }
      const running = inflight.get(key) as Promise<T> | undefined
      if (running !== undefined) return running

      const task = produce()
        .then((value) => {
          touch(key, { value, expiresAt: Date.now() + ttlMs })
          return value
        })
        .finally(() => {
          if (inflight.get(key) === task) inflight.delete(key)
        })
      inflight.set(key, task)
      return task
    },
    invalidate(key: string): void {
      values.delete(key)
      inflight.delete(key)
    },
    invalidatePrefix(prefix: string): void {
      for (const key of [...values.keys()]) if (key.startsWith(prefix)) values.delete(key)
      for (const key of [...inflight.keys()]) if (key.startsWith(prefix)) inflight.delete(key)
    },
    clear(): void {
      values.clear()
      inflight.clear()
    },
  }
}
