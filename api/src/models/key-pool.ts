import { createHash } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { ModelConfigError, type ProviderConnection } from './types.js'
import { keyFailure, type KeyFailure } from './key-policy.js'

type Health = { until: number; reason?: KeyFailure; used: number; failures: number; verifying?: boolean; verifiedAt?: number }
export class ProviderKeyCooldownError extends ModelConfigError {
  constructor(readonly until: number, readonly pollingRateLimit: boolean, now: number, scope = '生成', reasons = '') {
    super(`${scope} Key 冷却中${reasons ? `（${reasons}）` : ''}，约 ${Math.max(1, Math.ceil((until - now) / 1000))} 秒后可重试；认证问题可在服务商配置中重新验证`, 429)
  }
}
type ResponseLike = { ok: boolean; status: number; headers: { get(name: string): string | null }; clone(): { text(): Promise<string> }; body?: { cancel(): Promise<unknown> } | null }
export const connectionKeys = (p: Pick<ProviderConnection, 'apiKey' | 'apiKeys'>) => [...new Set((p.apiKeys?.length ? p.apiKeys : [p.apiKey]).map(k => k.trim()).filter(Boolean))]
export const credentialId = (key: string) => createHash('sha256').update(key).digest('hex').slice(0, 24)

/** Shared across requests/models, isolated by endpoint + credential. No raw secrets in health state. */
export class ProviderKeyPool {
  private health = new Map<string, Health>()
  constructor(private now = Date.now, private scope = '生成') {}
  private state(p: ProviderConnection, key: string) {
    // Draft discovery and edited configurations must not retain inactive health
    // entries forever. Never discard an active cooldown to make space.
    if (this.health.size > 4096) for (const [id, entry] of this.health) {
      if (!entry.verifying && entry.until <= this.now() && entry.used < this.now() - 24 * 60 * 60_000) this.health.delete(id)
    }
    const id = createHash('sha256').update(p.baseUrl.replace(/\/?v1\/?$/, '').replace(/\/$/, '') + '\0' + key).digest('hex')
    let state = this.health.get(id)
    if (!state) { state = { until: 0, used: 0, failures: 0 }; this.health.set(id, state) }
    return state
  }
  status(p: ProviderConnection) {
    return connectionKeys(p).map(key => {
      const state = this.state(p, key), cooling = state.until > this.now()
      return { id: credentialId(key), status: cooling ? 'cooling' as const : 'ready' as const, cooldownUntil: cooling ? new Date(state.until).toISOString() : null, reason: cooling ? state.reason : undefined }
    })
  }
  /** Explicit read-only check; never clears quota/rate limits or newer concurrent failures. */
  async verifyAuthentication(p: ProviderConnection, key: string, probe: () => Promise<void>) {
    const state = this.state(p, key), failures = state.failures
    if (state.verifying || (state.verifiedAt !== undefined && this.now() - state.verifiedAt < 15_000))
      throw new ModelConfigError('刚刚已验证此 Key，请等待 15 秒再试', 429)
    state.verifying = true; state.verifiedAt = this.now(); state.used = this.now()
    try {
      await probe()
      if (state.failures === failures && state.reason === 'authentication') { state.until = 0; state.reason = undefined }
    } finally { state.verifying = false }
  }
  session(p: ProviderConnection, pinOnSuccess = false) {
    const keys = connectionKeys(p); let pinned: string | undefined
    return { run: async <R extends ResponseLike>(send: (key: string) => Promise<R>, signal?: AbortSignal): Promise<R> => {
      if (!keys.length) return send('') // Explicitly unauthenticated local endpoints remain supported.
      const tried = new Set<string>()
      while (tried.size < keys.length) {
        signal?.throwIfAborted()
        const candidates = (pinned !== undefined ? [pinned] : keys).filter(key => !tried.has(key) && this.state(p, key).until <= this.now())
        candidates.sort((a, b) => this.state(p, a).used - this.state(p, b).used)
        const key = candidates[0]
        if (key === undefined) break
        tried.add(key); this.state(p, key).used = Math.max(this.now(), ...keys.map(k => this.state(p, k).used)) + 1
        // Transport exceptions are ambiguous: never rotate/replay them.
        const response = await send(key)
        if (response.ok) { if (pinOnSuccess) pinned = key; return response }
        let message = ''
        if ([400, 401, 402, 403, 429].includes(response.status)) {
          // Error bodies are used only for classification and never exposed in status/API output.
          message = (await response.clone().text().catch(() => '')).slice(0, 8192)
        }
        const reason = keyFailure(response.status, message)
        if (!reason) return response
        const retry = response.headers.get('retry-after')
        const seconds = retry && /^\d+(?:\.\d+)?$/.test(retry) ? Number(retry) * 1000 : retry ? Date.parse(retry) - this.now() : 0
        const fallback = reason === 'rate-limit' ? 60_000 : reason === 'quota' ? 15 * 60_000 : 5 * 60_000
        const state = this.state(p, key)
        state.until = this.now() + Math.max(fallback, Math.min(24 * 60 * 60_000, Number.isFinite(seconds) ? seconds : 0)); state.reason = reason
        state.failures++
        await response.body?.cancel().catch(() => {})
        if (pinned !== undefined) break
      }
      const until = Math.min(...(pinned !== undefined ? [pinned] : keys).map(key => this.state(p, key).until))
      const labels = { 'rate-limit': '限流', quota: '额度不足', authentication: '认证失败' }
      const reasons = [...new Set((pinned !== undefined ? [pinned] : keys).map(key => this.state(p, key).reason).filter((r): r is KeyFailure => !!r).map(r => labels[r]))].join('、')
      throw new ProviderKeyCooldownError(until, pinned !== undefined && this.state(p, pinned).reason === 'rate-limit', this.now(), this.scope, reasons)
    } }
  }
}
export const providerKeyPool = new ProviderKeyPool()
export const discoveryKeyPool = new ProviderKeyPool(Date.now, '查询列表')
export function providerKeyStatus(connection: ProviderConnection) {
  const discovery = discoveryKeyPool.status(connection)
  return providerKeyPool.status(connection).map(key => ({ ...key, discovery: discovery.find(k => k.id === key.id)! }))
}
export const requestWithProviderKeys = <R extends ResponseLike>(connection: ProviderConnection | undefined, fallbackKey: string, send: (key: string) => Promise<R>, signal?: AbortSignal) => connection ? providerKeyPool.session(connection).run(send, signal) : send(fallbackKey)
const context = new AsyncLocalStorage<ReturnType<ProviderKeyPool['session']>>()
export const withProviderKeys = <T>(connection: ProviderConnection, pin: boolean, run: () => Promise<T>, pool = providerKeyPool) => context.run(pool.session(connection, pin), run)
export const currentProviderKeys = () => context.getStore()
