/**
 * The 设置 (Settings) tab: credential status, key entry, and a note on how AI is
 * served. Saves go through the host's validating `/auth/key` route, so the panel
 * reflects exactly what the host accepted.
 * @module dsh-weread/client/settings
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ApiError, fetchAuthStatus, fetchSettings, saveApiKey, saveSettings } from './api.js'
import type { AuthState, AuthStatus, ShelfMode, WereadSettings } from '../types.js'

/** Where the user can mint an API key. */
const KEY_URL = 'https://weread.qq.com/api/skills/apikeyGet'

/** Human label + tone for each auth state. */
const STATE_META: Record<AuthState, { label: string; tone: string }> = {
  unset: { label: '未设置', tone: 'idle' },
  valid: { label: '已授权', tone: 'ok' },
  invalid: { label: '已失效', tone: 'bad' },
  unknown: { label: '未知', tone: 'idle' },
}

/** A status chip for one auth state. */
function StatusChip({ status }: { status: AuthStatus }): ReactNode {
  const meta = STATE_META[status.state] ?? STATE_META.unknown
  return (
    <div className="weread-auth-status">
      <span className={`weread-status-chip is-${meta.tone}`}>{meta.label}</span>
      {status.masked !== undefined && status.masked !== '' ? (
        <code className="weread-masked">{status.masked}</code>
      ) : null}
      {status.message !== undefined && status.message !== '' ? (
        <span className="weread-auth-message">{status.message}</span>
      ) : null}
    </div>
  )
}

/**
 * The settings panel.
 *
 * Loads the current status once, then lets the user replace the key. On save it
 * shows the host-reported result inline (valid / invalid + masked prefix) instead
 * of assuming success.
 */
export function Settings(): ReactNode {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [settings, setSettings] = useState<WereadSettings | null>(null)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [savingMode, setSavingMode] = useState(false)

  const loadStatus = useCallback(async () => {
    setLoadError(null)
    try {
      setStatus(await fetchAuthStatus())
    } catch (caught) {
      setLoadError(caught instanceof ApiError ? caught.message : String(caught))
    }
  }, [])

  const loadSettings = useCallback(async () => {
    setSettingsError(null)
    try {
      setSettings(await fetchSettings())
    } catch (caught) {
      setSettingsError(caught instanceof ApiError ? caught.message : String(caught))
    }
  }, [])

  useEffect(() => {
    void loadStatus()
    void loadSettings()
  }, [loadStatus, loadSettings])

  /** Persist the 书架 data-source switch; the host echoes the stored value. */
  const chooseMode = useCallback(async (next: ShelfMode) => {
    setSavingMode(true)
    setSettingsError(null)
    try {
      setSettings(await saveSettings({ shelfMode: next }))
    } catch (caught) {
      setSettingsError(caught instanceof ApiError ? caught.message : String(caught))
    } finally {
      setSavingMode(false)
    }
  }, [])

  const save = useCallback(async () => {
    setSaving(true)
    setSaveResult(null)
    try {
      const next = await saveApiKey(apiKey.trim())
      setStatus(next)
      if (next.state === 'valid') {
        setSaveResult({ ok: true, message: 'API Key 校验通过，已保存。' })
        setApiKey('')
      } else if (next.state === 'unset') {
        setSaveResult({ ok: true, message: '已清除 API Key。' })
        setApiKey('')
      } else {
        setSaveResult({ ok: false, message: next.message ?? 'API Key 校验失败，请检查后重试。' })
      }
    } catch (caught) {
      setSaveResult({ ok: false, message: caught instanceof ApiError ? caught.message : String(caught) })
    } finally {
      setSaving(false)
    }
  }, [apiKey])

  return (
    <div className="weread-settings">
      <header className="weread-settings-head">
        <h2 className="weread-settings-title">微信读书</h2>
        <p className="weread-settings-sub">管理 dsh-weread 插件的微信读书授权与 AI 说明。</p>
      </header>
      <section className="weread-settings-section">
        <h3 className="weread-section-title">微信读书授权</h3>
        {loadError !== null ? (
          <div className="weread-error">{loadError}</div>
        ) : status === null ? (
          <div className="weread-state weread-state-inline">
            <span className="weread-spinner" aria-hidden="true" />
            <p>读取授权状态…</p>
          </div>
        ) : (
          <StatusChip status={status} />
        )}

        <label className="weread-field">
          <span className="weread-field-label">API Key</span>
          <input
            type="password"
            className="weread-input"
            placeholder="粘贴你的微信读书 API Key"
            value={apiKey}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </label>
        <div className="weread-settings-actions">
          <button
            type="button"
            className="weread-btn weread-btn-primary"
            onClick={save}
            disabled={saving}
          >
            {saving ? '校验中…' : '保存并校验'}
          </button>
          {saveResult !== null ? (
            <span className={`weread-save-result ${saveResult.ok ? 'is-ok' : 'is-bad'}`}>{saveResult.message}</span>
          ) : null}
        </div>

        <p className="weread-hint">
          还没有 API Key？前往{' '}
          <a href={KEY_URL} target="_blank" rel="noreferrer noopener">
            微信读书 · 获取 API Key
          </a>{' '}
          生成后粘贴到上方。
        </p>
      </section>

      <section className="weread-settings-section">
        <h3 className="weread-section-title">书架数据源</h3>
        {settingsError !== null ? <div className="weread-error">{settingsError}</div> : null}
        <label className={`weread-switch${savingMode ? ' is-busy' : ''}`}>
          <input
            type="checkbox"
            className="weread-switch-input"
            checked={settings?.shelfMode === 'bookshelf'}
            disabled={settings === null || savingMode}
            onChange={(event) => void chooseMode(event.target.checked ? 'bookshelf' : 'notebooks')}
          />
          <span className="weread-switch-track" aria-hidden="true">
            <span className="weread-switch-thumb" />
          </span>
          <span className="weread-switch-text">
            <span className="weread-switch-title">使用微信读书书架接口（/shelf/sync）</span>
            <span className="weread-switch-desc">
              开启后书架显示你书架上的全部书籍、文件夹（书单）和有声书；关闭则用笔记接口（/user/notebooks），只列出有笔记的书。
            </span>
          </span>
        </label>
        <p className="weread-hint">
          {settings === null
            ? '读取书架设置…'
            : settings.shelfMode === 'bookshelf'
              ? '当前：书架模式（含文件夹）。切换后点面板右上角「⟳ 刷新」即可生效。'
              : '当前：笔记模式。切换后点面板右上角「⟳ 刷新」即可生效。'}
        </p>
      </section>

      <section className="weread-settings-section">
        <h3 className="weread-section-title">关于 AI</h3>
        <p className="weread-hint">
          AI 总结与阅读画像由当前 dsh 会话的模型服务生成，无需在此配置额外的模型密钥。
        </p>
      </section>
    </div>
  )
}
