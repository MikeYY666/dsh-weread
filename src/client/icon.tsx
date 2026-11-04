/**
 * The sidebar navigation icon for dsh-weread.
 *
 * The sidebar renders each `sidebar.panellist` occupant with `{ size, active }`
 * and paints its own button, so this component is just the glyph — a simple book
 * mark — sized to the requested square edge.
 * @module dsh-weread/client/icon
 */

import { createElement, type ReactNode } from 'react'

/** Props supplied by the sidebar panel row. */
export interface WereadIconProps {
  /** Requested square edge in pixels (16 when wide, 18 when collapsed). */
  readonly size?: number
  /** Whether this panel is the current selection. */
  readonly active?: boolean
}

/** The book-mark glyph used as the sidebar panel icon. */
export function WereadIcon({ size = 18 }: WereadIconProps): ReactNode {
  return createElement(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      'aria-hidden': 'true',
      focusable: 'false',
    },
    createElement('path', {
      d: 'M4 4.5A1.5 1.5 0 0 1 5.5 3H11a2 2 0 0 1 2 2v15a2 2 0 0 1-2-2H5.5A1.5 1.5 0 0 1 4 16.5v-12Z',
      stroke: 'currentColor',
      strokeWidth: '1.6',
      strokeLinejoin: 'round',
    }),
    createElement('path', {
      d: 'M20 4.5A1.5 1.5 0 0 0 18.5 3H13v17a2 2 0 0 0 2-2h3.5a1.5 1.5 0 0 0 1.5-1.5v-12Z',
      stroke: 'currentColor',
      strokeWidth: '1.6',
      strokeLinejoin: 'round',
    }),
  )
}
