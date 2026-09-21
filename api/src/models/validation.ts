import { adapterKinds, ModelConfigError, type GlobalModel, type ModelAdapter, type ProviderConnection } from './types.js'
import { connectionKeys, credentialId } from './key-pool.js'
export function text(value: unknown, label: string, max = 120) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f]/.test(value)) throw new ModelConfigError(`${label}不能为空、包含控制字符或超过 ${max} 字`)
  return value.trim()
}
export function endpoint(value: unknown, label = '接口地址', optional = false) {
  if (optional && (value === '' || value === undefined)) return ''
  const input = text(value, label, 2048)
  let url: URL
  try { url = new URL(input) } catch { throw new ModelConfigError(`${label}不是有效 URL`) }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new ModelConfigError(`${label}仅支持 HTTP/HTTPS，不能包含账号、密码、查询参数或片段`)
  // Administrators may intentionally connect LAN model servers. Cloud metadata is never a model endpoint.
  if (['169.254.169.254', 'metadata.google.internal', '[fd00:ec2::254]'].includes(url.hostname.toLowerCase())) throw new ModelConfigError('不能使用云元数据地址')
  return url.toString().replace(/\/$/, '')
}
function integer(value: unknown, label: string, min: number, max: number, fallback: number) {
  const number = value === undefined ? fallback : Number(value)
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new ModelConfigError(`${label}必须为 ${min}–${max} 的整数`)
  return number
}
function list(value: unknown, label: string) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 30) throw new ModelConfigError(`${label}最多 30 项`)
  return [...new Set(value.map(item => text(item, label, 40)))]
}
export function providerInput(body: Record<string, unknown>, id: string, previous?: ProviderConnection): ProviderConnection {
  let keys = previous ? connectionKeys(previous) : []
  if (body.apiKeys !== undefined) {
    if (!Array.isArray(body.apiKeys) || body.apiKeys.length > 32) throw new ModelConfigError('每个服务商最多支持 32 个 Key')
    const added = body.apiKeys.map(key => text(key, '密钥', 8192))
    if (body.retainedKeyIds !== undefined) {
      if (!Array.isArray(body.retainedKeyIds) || body.retainedKeyIds.length > 32 || body.retainedKeyIds.some(id => typeof id !== 'string' || !keys.some(k => credentialId(k) === id))) throw new ModelConfigError('保留的 Key 已变化，请刷新配置后重试')
      keys = keys.filter(key => (body.retainedKeyIds as string[]).includes(credentialId(key)))
    } else keys = []
    keys = [...new Set([...keys, ...added])]
  } else if (body.apiKey !== undefined && body.apiKey !== '') keys = [text(body.apiKey, '密钥', 8192)]
  if (keys.length > 32) throw new ModelConfigError('每个服务商最多支持 32 个 Key')
  return { id, name: text(body.name, '连接名称'), baseUrl: endpoint(body.baseUrl), proxyUrl: endpoint(body.proxyUrl, '代理地址', true), apiKey: keys[0] || '', apiKeys: keys, enabled: body.enabled !== false }
}
export function modelInput(body: Record<string, unknown>, id: string): GlobalModel {
  const adapter = String(body.adapter) as ModelAdapter
  if (!Object.hasOwn(adapterKinds, adapter)) throw new ModelConfigError('不支持的接口协议，请选择已有适配器')
  const c = body.capabilities as Record<string, unknown> | undefined
  const capabilities = {
    referenceImages: integer(c?.referenceImages, '参考图数量', 0, 32, 0), transparent: c?.transparent === true,
    sizes: list(c?.sizes, '图片尺寸'), resolutions: list(c?.resolutions, '分辨率'), aspectRatios: list(c?.aspectRatios, '画幅'),
    minSeconds: integer(c?.minSeconds, '最短时长', 1, 600, 1), maxSeconds: integer(c?.maxSeconds, '最长时长', 1, 600, 18),
  }
  if (capabilities.minSeconds > capabilities.maxSeconds) throw new ModelConfigError('最短时长不能大于最长时长')
  const creditCost = integer(body.creditCost, '单次点数', 0, 100000, 0)
  if (adapterKinds[adapter] === 'text' && creditCost) throw new ModelConfigError('文本助手暂不支持按次计费，请填 0')
  return { id, name: text(body.name, '显示名称'), model: text(body.model, '上游模型 ID'), providerId: text(body.providerId, '服务商'),
    adapter, kind: adapterKinds[adapter], enabled: body.enabled !== false, order: integer(body.order, '排序', 0, 10000, 0), creditCost, capabilities }
}
export function validateGeneration(model: GlobalModel, references: number, parameters: Record<string, unknown>) {
  const c = model.capabilities
  if (references > c.referenceImages) throw new ModelConfigError(`该模型最多支持 ${c.referenceImages} 张参考图`)
  if (parameters.background === 'transparent' && !c.transparent) throw new ModelConfigError('该模型不支持透明背景')
  for (const [key, values] of [['size', c.sizes], ['resolution', c.resolutions], ['aspect_ratio', c.aspectRatios]] as const) {
    if (parameters[key] !== undefined && values.length && !values.includes(String(parameters[key]))) throw new ModelConfigError(`模型不支持当前 ${key}，请重新选择`)
  }
  if (model.kind === 'video' && parameters.seconds !== undefined && (!Number.isFinite(Number(parameters.seconds)) || Number(parameters.seconds) < c.minSeconds || Number(parameters.seconds) > c.maxSeconds)) throw new ModelConfigError(`视频时长须为 ${c.minSeconds}–${c.maxSeconds} 秒`)
}
