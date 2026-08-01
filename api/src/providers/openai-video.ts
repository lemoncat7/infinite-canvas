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
    onUpdate({ status: 'queued', progress: 0 })
    const parameters = input.parameters ?? {}
    if ((input.inputUrls?.length ?? 0) > 7) throw new Error('Grok 多图视频最多支持 7 张参考图片')
    const imageUrls = await Promise.all((input.inputUrls ?? []).map(source => this.resolveImage(source)))
    const seconds = String(parameters.seconds || '5')
    const aspectRatio = String(parameters.aspect_ratio || '16:9')
    const requestedResolution = String(parameters.resolution || '720p')
    const resolution = requestedResolution === '480p' ? '480p' : '720p'
    const prompt = imageUrls.length > 1 ? `${input.prompt}\n\nReference image order: ${imageUrls.map((_, index) => `<IMAGE_${index + 1}>`).join(', ')}. Use the numbered reference images as visual guidance and preserve their defining subjects, appearance, and style.` : input.prompt
    console.info('[openai-video] creating task', { internalJobId: input.internalJobId, model: input.model, imageCount: imageUrls.length, mode: imageUrls.length > 1 ? 'reference-to-video' : imageUrls.length ? 'image-to-video' : 'text-to-video' })
    const created = await this.request('/v1/videos/generations', {
      method: 'POST',
      body: JSON.stringify({
        model: input.model, prompt, seconds, aspect_ratio: aspectRatio, resolution,
        ...(imageUrls.length > 1 ? { reference_images: imageUrls.map(url => ({ url })) } : imageUrls.length === 1 ? { input_reference: { image_url: imageUrls[0] } } : {}),
      }),
    })
    const immediate = normalize(created)
    if (immediate.status === 'succeeded' && immediate.resultUrl) { onUpdate(immediate); return immediate }
    const id = text(created.request_id) || text(created.id) || text(created.video_id) || text(nested(created, 'data', 'id'))
    if (!id) throw new Error(`CPA/Grok 创建响应未返回 request_id（字段：${Object.keys(created).join(', ') || '空响应'}）`)
    const startedAt = Date.now(); let lastProgress = 0, started = false
    while (Date.now() - startedAt < this.timeout) {
      const payload = await this.request(`/v1/videos/${encodeURIComponent(id)}`)
      const normalized = normalize(payload, id, this.baseUrl)
      const update = { ...normalized, status: (started || normalized.progress > 1) && normalized.status === 'queued' ? 'running' as const : normalized.status, progress: Math.max(lastProgress, normalized.progress) }
      if (update.status === 'running') started = true
      lastProgress = update.progress
      console.info('[openai-video] task progress', { internalJobId: input.internalJobId, requestId: id, status: update.status, progress: update.progress, imageCount: imageUrls.length })
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
  const rawProgress = Number(payload.progress ?? nested(payload, 'data', 'progress') ?? (status === 'succeeded' ? 100 : 0))
  const direct = text(payload.video_url) || text(nested(payload, 'video', 'url')) || text(payload.url) || text(payload.result_url) || text(payload.output_url) || text(nested(payload, 'data', 'url')) || text(nested(payload, 'output', 'url'))
  const resultUrl = direct || (status === 'succeeded' && id && baseUrl ? `${baseUrl}/v1/videos/${encodeURIComponent(id)}/content` : undefined)
  return { status, progress: Math.max(0, Math.min(100, Number.isFinite(rawProgress) ? rawProgress : 10)), resultUrl, error: text(nested(payload, 'error', 'message')) || text(payload.error) || text(payload.message) }
}
function nested(value: Payload, first: string, second: string) { const child = value[first]; return child && typeof child === 'object' ? (child as Payload)[second] : undefined }
function text(value: unknown) { return typeof value === 'string' && value ? value : undefined }
function required(name: string, fallback?: string) { const value = process.env[name] || fallback; if (!value) throw new Error(`${name} is required when using openai-video`); return value }
const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))
