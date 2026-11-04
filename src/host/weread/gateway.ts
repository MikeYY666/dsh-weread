/**
 * WeChat Reading Agent Gateway client.
 *
 * Every data call is one POST to `https://i.weread.qq.com/api/agent/gateway`
 * with `{ api_name, skill_version, ...flat params }` and a Bearer API key. Only
 * the API-key (V2) path is implemented; there is no Cookie fallback by design.
 * @module dsh-weread/src/host/weread/gateway
 */

import { ProxyAgent, fetch as undiciFetch } from 'undici'
import { readConfig } from '../config.js'

const GATEWAY_URL = 'https://i.weread.qq.com/api/agent/gateway'
const SKILL_VERSION = '1.0.3'

/** A structured failure carrying the gateway error code. */
export class WereadError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status = 502) {
    super(message)
    this.name = 'WereadError'
    this.code = code
    this.status = status
  }
}

/** Cached proxy dispatcher, rebuilt when the configured proxy changes. */
let cachedProxy: { url: string; agent: ProxyAgent } | null = null

function dispatcher(): ProxyAgent | undefined {
  const proxy = readConfig().proxy
  if (proxy === undefined || proxy === '') return undefined
  if (cachedProxy !== null && cachedProxy.url === proxy) return cachedProxy.agent
  const agent = new ProxyAgent(proxy)
  cachedProxy = { url: proxy, agent }
  return agent
}

/** The API key, or throw a stable error when unset. */
function requireKey(): string {
  const key = readConfig().apiKey
  if (key === '') throw new WereadError('weread/no-key', '未配置微信读书 API Key', 401)
  return key
}

/**
 * Call one Agent API method and return its parsed JSON payload.
 * @param apiName - the `api_name`, e.g. `/shelf/sync`.
 * @param params - flat business parameters merged at the body top level.
 * @param signal - optional abort signal from the incoming request.
 * @returns the raw JSON response (an object or `{ books }`-style payload).
 */
export async function callAgent<T = unknown>(
  apiName: string,
  params: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<T> {
  const key = requireKey()
  const body = JSON.stringify({ api_name: apiName, skill_version: SKILL_VERSION, ...params })
  const agent = dispatcher()

  let response: Awaited<ReturnType<typeof undiciFetch>>
  try {
    response = await undiciFetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        accept: 'application/json, text/plain, */*',
      },
      body,
      signal,
      ...(agent !== undefined ? { dispatcher: agent } : {}),
    })
  } catch (error) {
    throw new WereadError('weread/network', `请求微信读书失败：${String(error)}`, 502)
  }

  // 401 = bad/expired key; 403 = the key is accepted but the request is blocked
  // by weread's risk control (usually the egress IP), so they must not share a code
  // or the panel would wrongly say "API Key 无效".
  if (response.status === 401) {
    throw new WereadError('weread/unauthorized', 'API Key 无效或已过期', 401)
  }
  if (response.status === 403) {
    throw new WereadError(
      'weread/blocked',
      '微信读书拒绝了当前网络出口（风控 403）。API Key 可能有效，但本机出口 IP 被限制，请改用可正常访问微信读书的代理。',
      403,
    )
  }
  if (!response.ok) {
    throw new WereadError('weread/http', `微信读书接口返回 HTTP ${response.status}`, 502)
  }

  let json: unknown
  try {
    json = await response.json()
  } catch (error) {
    throw new WereadError('weread/parse', `微信读书返回非 JSON：${String(error)}`, 502)
  }

  const errcode = (json as { errcode?: unknown })?.errcode
  if (typeof errcode === 'number' && errcode !== 0) {
    const errmsg = (json as { errmsg?: unknown })?.errmsg
    throw new WereadError(
      `weread/${errcode}`,
      typeof errmsg === 'string' ? errmsg : `微信读书错误码 ${errcode}`,
      200,
    )
  }
  return json as T
}

/** Validity verdict for the configured key. */
export type KeyVerdict = 'valid' | 'invalid' | 'blocked' | 'unknown'

/**
 * Lightweight key probe via `/_list`, distinguishing three outcomes so the
 * panel never mislabels a network block as a bad key: 401→invalid, 403→blocked
 * (key accepted but egress is risk-controlled), anything else→unknown.
 */
export async function validateKey(signal?: AbortSignal): Promise<KeyVerdict> {
  try {
    await callAgent('/_list', {}, signal)
    return 'valid'
  } catch (error) {
    if (error instanceof WereadError) {
      if (error.code === 'weread/unauthorized') return 'invalid'
      if (error.code === 'weread/blocked') return 'blocked'
    }
    return 'unknown'
  }
}
