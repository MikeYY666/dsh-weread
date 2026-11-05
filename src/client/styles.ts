/**
 * Injects this bundle's stylesheet once per page.
 *
 * The bundle is served as a classic script, so a `?inline` CSS import cannot work;
 * the sheet travels as a string and is tagged with the `data-plugin` /
 * `data-plugin-css` markers the DSH module system uses to claim a style for its
 * owning plugin and remove it again on HMR or disable.
 * @module dsh-weread/client/styles
 */

import css from './styles.css'

/** Style tag identity: one per plugin artifact. */
const TAG_ID = 'dsh-weread/styles.css?v=12'

/**
 * Adopt the bundle's stylesheet into the document, idempotently.
 *
 * Called from the plugin's `register` body; safe to call more than once.
 */
export function injectStyles(): void {
  if (typeof document === 'undefined') return
  const selector = `style[data-plugin-css=${JSON.stringify(TAG_ID)}]`
  if (document.querySelector(selector) !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-weread'
  tag.dataset.pluginCss = TAG_ID
  tag.textContent = css
  document.head.appendChild(tag)
}
