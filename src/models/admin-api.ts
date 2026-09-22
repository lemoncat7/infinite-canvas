import { apiFetch } from '../services/api'
import type { Catalog } from './catalog'
export type KeyStatus = { id: string; status: 'ready' | 'cooling'; cooldownUntil: string | null; reason?: string; discovery?: Omit<KeyStatus, 'discovery'> }
export type ProviderView = { id: string; name: string; baseUrl: string; proxyUrl: string; enabled: boolean; hasKey: boolean; readOnly: boolean; keyCount?: number; keys?: KeyStatus[] }
export type AdminModels = Catalog & { imported: boolean; providers: ProviderView[] }
export async function modelRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await apiFetch(`/api${path}`, { method, signal: AbortSignal.timeout(path.endsWith('/test') ? 20 * 60_000 : 25_000), headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  } catch {
    throw new Error(method === 'GET' ? '网络中断或请求超时，请刷新重试' : '网络中断或请求超时；操作可能已生效，请先刷新确认，避免重复提交')
  }
  const data = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) throw new Error(data.error || '操作失败，请重试')
  return data as T
}
