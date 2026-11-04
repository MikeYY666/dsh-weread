/**
 * Host half of dsh-weread.
 *
 * Serves the browser half's data routes on the shared `/api/weread/*` channel and
 * proxies every WeChat Reading call behind the API-key credential so the key never
 * reaches the browser. Also owns the AI summary route, which streams through
 * dsh's provider-neutral LLM service (`ctx.llm`).
 * @module dsh-weread
 */

import type { Disposer, Logger, PluginContext } from '../cordis.js'
import { createRouter, type RouteDeps } from './routes.js'
import { createCache } from './store/cache.js'
import { getAuthStatus, readConfig, setApiKey } from './config.js'

export { name } from './constants.js'
export type * from '../types.js'

/** The Host services this plugin cannot work without. */
export const inject = ['connection'] as const

/** Version of the WeChat Reading Agent API this plugin targets. */
export const SKILL_VERSION = '1.0.3'

/** The slice of `ctx.connection` this plugin relies on. */
export interface HostConnection {
  readonly fetch?: {
    readonly register?: (route: RouteDef) => Disposer | Promise<Disposer>
  }
}

/** One exact Fetch route as the connection service registers it. */
export interface RouteDef {
  readonly path: string
  readonly methods: readonly string[]
  readonly requestBody: 'buffered' | 'streaming'
  readonly fetch: (request: Request) => Promise<Response>
}

/**
 * Register every dsh-weread route for the browser half.
 * @param ctx - the host plugin context.
 */
export function apply(ctx: PluginContext): void {
  const logger = ctx.logger('dsh-weread')
  ctx.inject(['connection'], (scope) => {
    const connection = scope.get<HostConnection>('connection')
    const registry = connection?.fetch
    const register = registry?.register
    if (registry === undefined || typeof register !== 'function') {
      logger.warn('dsh-weread: host connection exposes no fetch registry; the panel will render without data')
      return
    }

    const cache = createCache()
    const deps: RouteDeps = { logger, cache, scope }

    for (const route of createRouter(deps)) {
      ctx.effect(
        () => register.call(registry, route.def),
        `dsh-weread: ${route.def.path}`,
      )
    }
  })
}

/** Re-exported for tests and diagnostics. */
export { createCache, getAuthStatus, readConfig, setApiKey }
export type { Logger }
