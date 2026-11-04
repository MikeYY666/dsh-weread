/**
 * Thin wrapper over dsh's provider-neutral LLM service (`ctx.llm`).
 *
 * The service streams token-level chunks; this module extracts the visible text
 * deltas (`text-delta` chunks carry `.text`) and exposes them as one async text
 * iterator, so route handlers never touch the raw chunk vocabulary.
 * @module dsh-weread/src/host/ai/llm
 */

import type { LlmService } from '../../cordis.js'
import { readConfig } from '../config.js'

/** Resolved provider/model + the service handle. */
export interface LlmTarget {
  readonly service: LlmService
  readonly provider: string
  readonly model: string
}

/** dsh profile default, used when neither the request nor config names one. */
const DEFAULT_PROVIDER = 'magpie'
const DEFAULT_MODEL = 'workbuddy/deepseek-v4.1-flash'

/**
 * Pick the provider/model for one call.
 * Precedence: explicit request > stored config > built-in default.
 */
export function resolveTarget(
  service: LlmService,
  requestProvider?: string,
  requestModel?: string,
): LlmTarget {
  const config = readConfig()
  const provider = requestProvider?.trim() || config.aiProvider?.trim() || DEFAULT_PROVIDER
  const model = requestModel?.trim() || config.aiModel?.trim() || DEFAULT_MODEL
  return { service, provider, model }
}

/**
 * Stream one prompt and yield visible text deltas as they arrive.
 * @param target - resolved provider/model/service.
 * @param system - system prompt, or undefined for none.
 * @param user - the user message.
 * @param signal - abort signal from the request.
 */
export async function* streamText(
  target: LlmTarget,
  system: string | undefined,
  user: string,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const messages = [] as Array<{ role: 'system' | 'user'; content: Array<{ type: 'text'; text: string }> }>
  if (system !== undefined && system !== '') {
    messages.push({ role: 'system', content: [{ type: 'text', text: system }] })
  }
  messages.push({ role: 'user', content: [{ type: 'text', text: user }] })

  const stream = target.service.stream({
    provider: target.provider,
    model: target.model,
    messages,
    ...(signal !== undefined ? { signal } : {}),
  })

  for await (const chunk of stream) {
    if (signal?.aborted === true) return
    if (chunk.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text !== '') {
      yield chunk.text
    }
  }
}
