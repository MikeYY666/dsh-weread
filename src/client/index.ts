/**
 * Browser half of dsh-weread.
 *
 * Targets the dsh 0.2.2 sidebar contract: a global panel is a pair of
 * registrations sharing one id — an icon in the root-scoped `sidebar.panellist`
 * list, and the panel body in the root-scoped `main` keyed slot under the same
 * key. Selecting the icon (the sidebar wires it to `ctx.layout.selectPanel(id)`)
 * swaps the center column to the panel; no overlay or toggle is involved.
 *
 * The earlier 0.2.1 approach registered `shell.leading`, which 0.2.2 repurposed
 * as the single window-chrome seat owned by `@deepseek-ai/dsh-client-ui-sidebar`;
 * a second occupant there aborts that plugin's activation.
 * @module dsh-weread/client
 */

import { createElement } from 'react'
import { WereadPanel } from './entry.js'
import { WereadIcon } from './icon.js'
import { Settings } from './settings.js'
import { injectStyles } from './styles.js'

/** Stable Cordis plugin name. */
export const name = 'dsh-weread'

/** Client services this browser half cannot work without. */
export const inject = ['slots']

/** The panel id shared by the sidebar icon and the main panel key. */
export const PANEL_ID = 'dsh-weread'

/** The slice of the root slot service this plugin uses. */
interface SlotsService {
  register(options: Record<string, unknown>, component: unknown): () => void
  inject(seat: string, callback: () => unknown): unknown
}

/** Row config as it reaches the browser half. */
export interface ClientConfig {
  /** Reserved for a future configurable shelf refresh interval. */
  intervalMs?: number
}

/**
 * Register the sidebar icon and the main panel. This is the browser half's
 * plugin body; the loader factory publishes it via `module.exports` below.
 */
export function register(ctx: { slots?: SlotsService }, _config: ClientConfig = {}): void {
  const slots = ctx.slots
  if (slots === undefined || typeof slots.register !== 'function') return

  injectStyles()

  // Sidebar nav row (icon only). The sidebar renders the icon with { size, active }.
  slots.inject('sidebar.panellist', () =>
    slots.register(
      { name: 'sidebar.panellist', id: PANEL_ID, order: 60, label: '微信读书' },
      () => createElement(WereadIcon, {}),
    ),
  )

  // Center-column panel body, dispatched when the icon's id is selected.
  slots.inject('main', () =>
    slots.register({ name: 'main', key: PANEL_ID }, () => createElement(WereadPanel, {})),
  )

  // Settings page in dsh's global Settings (nav row + section body). Reusing the
  // same id keeps the icon matched to its section; the shell owns the button.
  slots.inject('settings.section', () =>
    slots.register(
      { name: 'settings.section', id: PANEL_ID, order: 120, label: '微信读书' },
      () => createElement(Settings, {}),
    ),
  )
  slots.inject('settings.section.icon', () =>
    slots.register(
      { name: 'settings.section.icon', id: PANEL_ID },
      () => createElement(WereadIcon, {}),
    ),
  )
}

const shared = module.exports as Record<string, unknown>
shared.name = name
shared.inject = inject
shared.apply = register
