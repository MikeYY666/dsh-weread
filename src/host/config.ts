/**
 * Plugin configuration and credential storage.
 *
 * The WeChat Reading API key is a secret: it lives only on the host under
 * `$DSH_HOME/storages/dsh-weread/config.json` (mode 600) and never reaches the
 * browser. The browser only ever sees the masked prefix and a validity state.
 * @module dsh-weread/src/host/config
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { AuthStatus, ShelfMode, WereadSettings } from '../types.js'

/** Persisted config shape. */
export interface WereadConfig {
  /** Bearer API key for the Agent Gateway; empty when unset. */
  apiKey: string
  /** Optional HTTPS proxy for outbound requests to i.weread.qq.com. */
  proxy?: string
  /** Optional provider override for AI calls. */
  aiProvider?: string
  /** Optional model override for AI calls. */
  aiModel?: string
  /** Which upstream list the 书架 tab reads; absent means `notebooks`. */
  shelfMode?: ShelfMode
}

const EMPTY: WereadConfig = { apiKey: '' }

/**
 * Which source the 书架 tab uses when the setting has never been changed.
 * The book shelf is the real shelf (folders and audiobooks included), so it is
 * the default; the notebook list stays available as the opt-out.
 */
const DEFAULT_SHELF_MODE: ShelfMode = 'bookshelf'

/** Validate a stored/requested mode, falling back to the default source. */
function shelfModeOf(value: unknown): ShelfMode {
  return value === 'bookshelf' || value === 'notebooks' ? value : DEFAULT_SHELF_MODE
}

/** `$DSH_HOME`, else `~/.dsh`. */
function dshHome(): string {
  const raw = process.env.DSH_HOME?.trim()
  if (raw !== undefined && raw !== '') return raw
  return join(homedir(), '.dsh')
}

/** Absolute path of the plugin config file. */
export function configPath(): string {
  return join(dshHome(), 'storages', 'dsh-weread', 'config.json')
}

/** Read the persisted config, or the empty default when absent/corrupt. */
export function readConfig(): WereadConfig {
  const path = configPath()
  if (!existsSync(path)) return { ...EMPTY }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<WereadConfig>
    // Optional keys are attached only when the file actually carries them, so a
    // read never invents fields the on-disk file does not have.
    const config: WereadConfig = { apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '' }
    if (typeof parsed.proxy === 'string' && parsed.proxy !== '') config.proxy = parsed.proxy
    if (typeof parsed.aiProvider === 'string' && parsed.aiProvider !== '') config.aiProvider = parsed.aiProvider
    if (typeof parsed.aiModel === 'string' && parsed.aiModel !== '') config.aiModel = parsed.aiModel
    if (parsed.shelfMode === 'bookshelf' || parsed.shelfMode === 'notebooks') config.shelfMode = parsed.shelfMode
    return config
  } catch {
    return { ...EMPTY }
  }
}

/** Persist the config (creating the directory) with owner-only permissions. */
export function writeConfig(config: WereadConfig): void {
  const path = configPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 })
  try {
    chmodSync(path, 0o600)
  } catch {
    // Best effort: some filesystems ignore mode bits.
  }
}

/** Mask a key for display: keep a short prefix and the last 4 chars. */
export function maskKey(key: string): string {
  if (key === '') return ''
  const tail = key.length > 4 ? key.slice(-4) : ''
  return `wrk-****${tail}`
}

/** Read the current auth status without any network call. */
export function getAuthStatus(): AuthStatus {
  const { apiKey } = readConfig()
  if (apiKey === '') return { state: 'unset' }
  return { state: 'unknown', masked: maskKey(apiKey) }
}

/** Store a new API key; passing an empty string clears it. */
export function setApiKey(apiKey: string): AuthStatus {
  const config = readConfig()
  config.apiKey = apiKey.trim()
  writeConfig(config)
  return apiKey.trim() === '' ? { state: 'unset' } : { state: 'unknown', masked: maskKey(apiKey.trim()) }
}

/** The non-secret settings the panel exposes. */
export function getSettings(): WereadSettings {
  return { shelfMode: readConfig().shelfMode ?? DEFAULT_SHELF_MODE }
}

/** Persist the 书架 data-source switch and return the stored value. */
export function setShelfMode(mode: ShelfMode): WereadSettings {
  const config = readConfig()
  const next = shelfModeOf(mode)
  config.shelfMode = next
  writeConfig(config)
  return { shelfMode: next }
}
