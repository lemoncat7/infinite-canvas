import { fetch as undiciFetch, ProxyAgent } from 'undici'
import type { ProviderConnection } from './types.js'
import { ModelConfigError } from './types.js'
import { currentProviderKeys, withProviderKeys } from './key-pool.js'

export function apiRoot(baseUrl: string) { return baseUrl.replace(/\/$/, '').replace(/\/v1$/, '') }
/** Buffers bounded API responses so a per-request proxy can always be released. Never follows credentialed redirects. */
export async function modelFetch(url: string, init: RequestInit, proxyUrl = '', maxBytes = 128 * 1024 * 1024): Promise<Response> {
  const pool = currentProviderKeys()
  return pool ? pool.run(key => rawModelFetch(url, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), authorization: `Bearer ${key}` } }, proxyUrl, maxBytes), init.signal || undefined) : rawModelFetch(url, init, proxyUrl, maxBytes)
}
async function rawModelFetch(url: string, init: RequestInit, proxyUrl: string, maxBytes: number): Promise<Response> {
  const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined
  try {
    const response = await undiciFetch(url, { ...init, redirect: 'error', ...(dispatcher ? { dispatcher } : {}) } as Parameters<typeof undiciFetch>[1])
    const chunks: Uint8Array[] = []; let size = 0
    if (response.body) for await (const chunk of response.body) {
      size += chunk.byteLength
      if (size > maxBytes) throw new ModelConfigError('接口响应过大，请检查服务商地址', 502)
      chunks.push(chunk)
    }
    return new Response(response.status === 204 || response.status === 304 ? null : Buffer.concat(chunks), { status: response.status, headers: Object.fromEntries(response.headers) })
  } finally { await dispatcher?.destroy() }
}
export async function discoverModels(connection: ProviderConnection) {
  try {
    const response = await withProviderKeys(connection, false, () => modelFetch(`${apiRoot(connection.baseUrl)}/v1/models`, { headers: { authorization: `Bearer ${connection.apiKey}` }, signal: AbortSignal.timeout(15_000) }, connection.proxyUrl, 2 * 1024 * 1024))
    if (!response.ok) throw new ModelConfigError(`连接检查返回 HTTP ${response.status}；请检查地址、密钥或手动填写模型`, 502)
    const body = await response.json() as { data?: { id?: unknown }[] }
    if (!Array.isArray(body.data)) throw new ModelConfigError('接口未返回标准模型列表；仍可手动添加模型', 502)
    return [...new Set(body.data.flatMap(item => typeof item?.id === 'string' && item.id.length <= 120 ? [item.id] : []))].slice(0, 1000)
  } catch (error) {
    if (error instanceof ModelConfigError) throw error
    throw new ModelConfigError('连接失败或超时，请检查地址、代理和密钥；接口错误正文已隐藏', 502)
  }
}
