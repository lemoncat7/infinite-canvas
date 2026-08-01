import type { GenerationInput, GenerationProvider, GenerationStatus, GenerationUpdate } from './types.js'

type Payload = Record<string, unknown>

export class OpenAiVideoProvider implements GenerationProvider {
  readonly name = 'openai-video'
  private readonly baseUrl = required('OPENAI_VIDEO_BASE_URL', process.env.OPENAI_IMAGE_BASE_URL).replace(/\/$/, '')
  private readonly apiKey = required('OPENAI_VIDEO_API_KEY', process.env.OPENAI_IMAGE_API_KEY)
  private readonly pollInterval = Number(process.env.OPENAI_VIDEO_POLL_INTERVAL_MS || 5000)
  private readonly timeout = Number(process.env.OPENAI_VIDEO_TIMEOUT_MS || 900000)
  private readonly publicBaseUrl = (process.env.GENERATION_PUBLIC_BASE_URL || '').replace(/\/$/, '')

  async run(input: GenerationInput, onUpdate: (update: GenerationUpdate) => void) {
    if (input.kind !== 'video') throw new Error('OpenAI Video Adapter 仅支持视频任务')
    onUpdate({ status: 'running', progress: 5 })
    const parameters = input.parameters ?? {}
    const imageUrl = input.inputUrls?.[0] ? await this.resolveImage(input.inputUrls[0]) : undefined
    const seconds = String(parameters.seconds || '5')
    const aspectRatio = String(parameters.aspect_ratio || '16:9')
    const requestedResolution = String(parameters.resolution || '720p')
    const resolution = requestedResolution === '480p' ? '480p' : '720p'
    const created = await this.request('/v1/videos/generations', {
      method: 'POST',
      body: JSON.stringify({ model: input.model, prompt: input.prompt, seconds, aspect_ratio: aspectRatio, resolution, ...(imageUrl ? { input_reference: { image_url: imageUrl } } : {}) }),
    })
    const immediate = normalize(created)
    if (immediate.status === 'succeeded' && immediate.resultUrl) { onUpdate(immediate); return immediate }
    const id = text(created.request_id) || text(created.id) || text(created.video_id) || text(nested(created, 'data', 'id'))
    if (!id) throw new Error(`CPA/Grok 创建响应未返回 request_id（字段：${Object.keys(created).join(', ') || '空响应'}）`)
    const startedAt = Date.now()
    while (Date.now() - startedAt < this.timeout) {
      const payload = await this.request(`/v1/videos/${encodeURIComponent(id)}`)
      const update = normalize(payload, id, this.baseUrl)
      onUpdate(update)
      if (update.status === 'succeeded') {
        if (!update.resultUrl) throw new Error('CPA video API 已完成但未返回视频地址')
        return update
      }
      if (update.status === 'failed') throw new Error(update.error || 'CPA video API 生成失败')
      await wait(this.pollInterval)
    }
    throw new Error(`CPA video API 超时（${Math.round(this.timeout / 1000)} 秒）`)
  }

  private async request(path: string, init: RequestInit = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json', ...(init.headers as Record<string, string> | undefined) }, signal: AbortSignal.timeout(120000) })
    const body = await response.text(); let payload: Payload = {}
    try { payload = body ? JSON.parse(body) as Payload : {} } catch { throw new Error(`CPA video API 返回了非 JSON 内容（${response.status}）`) }
    if (!response.ok) throw new Error(text(nested(payload, 'error', 'message')) || text(payload.message) || `CPA video API returned ${response.status}`)
    return payload
  }

  private async resolveImage(source: string) {
    if (/^https?:\/\//i.test(source) || source.startsWith('data:')) return source
    if (source.startsWith('/api/') && this.publicBaseUrl) return `${this.publicBaseUrl}${source}`
    if (source.startsWith('/api/')) {
      const response = await fetch(`http://127.0.0.1:${process.env.PORT ?? 3000}/${source.slice(5)}`, { signal: AbortSignal.timeout(30000) })
      if (!response.ok) throw new Error(`读取 Grok 首帧图片失败（${response.status}）`)
      const mimeType = response.headers.get('content-type')?.split(';')[0] || 'image/png'
      const bytes = Buffer.from(await response.arrayBuffer())
      if (!bytes.length || bytes.length > 15 * 1024 * 1024) throw new Error('Grok 首帧图片为空或超过 15MB')
      return `data:${mimeType};base64,${bytes.toString('base64')}`
    }
    if (!this.publicBaseUrl) throw new Error('图生视频需要公网图片 URL 或本地资产')
    return `${this.publicBaseUrl}${source.startsWith('/') ? '' : '/'}${source}`
  }
}

function normalize(payload: Payload, id?: string, baseUrl?: string): GenerationUpdate {
  const raw = String(payload.status ?? nested(payload, 'data', 'status') ?? '').toLowerCase()
  const status: GenerationStatus = ['completed', 'complete', 'succeeded', 'success', 'done'].includes(raw) ? 'succeeded' : ['failed', 'error', 'cancelled', 'canceled'].includes(raw) ? 'failed' : ['queued', 'pending'].includes(raw) ? 'queued' : 'running'
  const rawProgress = Number(payload.progress ?? nested(payload, 'data', 'progress') ?? (status === 'succeeded' ? 100 : 10))
  const direct = text(payload.video_url) || text(nested(payload, 'video', 'url')) || text(payload.url) || text(payload.result_url) || text(payload.output_url) || text(nested(payload, 'data', 'url')) || text(nested(payload, 'output', 'url'))
  const resultUrl = direct || (status === 'succeeded' && id && baseUrl ? `${baseUrl}/v1/videos/${encodeURIComponent(id)}/content` : undefined)
  return { status, progress: Math.max(0, Math.min(100, Number.isFinite(rawProgress) ? rawProgress : 10)), resultUrl, error: text(nested(payload, 'error', 'message')) || text(payload.error) || text(payload.message) }
}
function nested(value: Payload, first: string, second: string) { const child = value[first]; return child && typeof child === 'object' ? (child as Payload)[second] : undefined }
function text(value: unknown) { return typeof value === 'string' && value ? value : undefined }
function required(name: string, fallback?: string) { const value = process.env[name] || fallback; if (!value) throw new Error(`${name} is required when using openai-video`); return value }
const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))
