/**
 * The streaming AI answer panel.
 *
 * Shared by the book detail (`summary` / `highlights-themes`) and the stats tab
 * (`shelf-profile`). It owns only its own stream state: request, accumulate,
 * abort on unmount, and distinguish a complete answer from a truncated one.
 * @module dsh-weread/client/aiPanel
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ApiError, AI_INTERRUPT_MARKER, streamAi, type AiTask } from './api.js'

export interface AiPanelProps {
  /** Which task to run. */
  readonly task: AiTask
  /** Book id, required by every task except `shelf-profile`. */
  readonly bookId?: string
  /** Button label. */
  readonly buttonLabel: string
  /** Optional helper line under the button. */
  readonly hint?: string
  /** Optional provider/model override forwarded to the host. */
  readonly provider?: string
  readonly model?: string
}

/** A minimal, safe markdown-ish renderer: headings, bullets, bold, paragraphs. */
function renderRichText(text: string): ReactNode {
  if (text === '') return null
  const lines = text.split('\n')
  const blocks: ReactNode[] = []
  let bulletBuffer: string[] = []

  const flushBullets = (): void => {
    if (bulletBuffer.length === 0) return
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="weread-ai-list">
        {bulletBuffer.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
        ))}
      </ul>,
    )
    bulletBuffer = []
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (line.trim() === '') {
      flushBullets()
      continue
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading !== null) {
      flushBullets()
      const level = Math.min(4, (heading[1] ?? '#').length)
      blocks.push(
        <div key={`h-${blocks.length}`} className={`weread-ai-heading weread-ai-h${level}`}>
          {renderInline(heading[2] ?? '')}
        </div>,
      )
      continue
    }
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line)
    if (bullet !== null) {
      bulletBuffer.push(bullet[1] ?? '')
      continue
    }
    flushBullets()
    blocks.push(
      <p key={`p-${blocks.length}`} className="weread-ai-p">
        {renderInline(line)}
      </p>,
    )
  }
  flushBullets()
  return blocks
}

/** Render `**bold**` spans within one line. */
function renderInline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, i) => {
    const bold = /^\*\*([^*]+)\*\*$/.exec(part)
    return bold !== null ? <strong key={i}>{bold[1]}</strong> : <span key={i}>{part}</span>
  })
}

/** Detect the host's mid-stream failure marker. */
function isInterrupted(text: string): boolean {
  return text.includes(AI_INTERRUPT_MARKER)
}

/**
 * Render a button that streams one AI answer into a scrollable card.
 *
 * While streaming, the accumulated text is shown live (a typing effect falls out
 * of chunk-by-chunk updates). Re-running resets the card, and unmount aborts the
 * in-flight request so no state lands on a gone component.
 */
export function AiPanel({ task, bookId, buttonLabel, hint, provider, model }: AiPanelProps): ReactNode {
  const [text, setText] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // Abort on unmount so a tab switch or drawer close cancels the stream.
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const run = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    setError(null)
    setDone(false)
    setText('')
    try {
      const finalText = await streamAi(
        { task, bookId, provider, model, signal: controller.signal },
        (partial) => setText(partial),
      )
      setText(finalText)
      setDone(true)
    } catch (caught) {
      if (controller.signal.aborted) return
      const message = caught instanceof ApiError ? caught.message : String(caught)
      setError(message)
    } finally {
      if (abortRef.current === controller) {
        setRunning(false)
        abortRef.current = null
      }
    }
  }, [task, bookId, provider, model])

  const interrupted = done && isInterrupted(text)

  return (
    <div className="weread-ai">
      <div className="weread-ai-toolbar">
        <button type="button" className="weread-btn weread-btn-primary" onClick={run} disabled={running}>
          {running ? '生成中…' : buttonLabel}
        </button>
        {hint !== undefined ? <span className="weread-ai-hint">{hint}</span> : null}
      </div>
      {error !== null ? <div className="weread-error">{error}</div> : null}
      {text === '' && !running && error === null ? (
        <p className="weread-empty weread-empty-inline">
          {done ? 'AI 未返回内容' : '点击上方按钮生成内容'}
        </p>
      ) : null}
      {text !== '' ? (
        <div className="weread-ai-output" aria-live="polite">
          {renderRichText(text)}
          {running ? <span className="weread-ai-caret">▍</span> : null}
          {interrupted ? <p className="weread-ai-interrupted">生成中断，可重试。</p> : null}
        </div>
      ) : null}
    </div>
  )
}
