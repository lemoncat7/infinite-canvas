import type { GenerationInput, GenerationProvider, GenerationStatus, GenerationUpdate } from './types.js'
import { modelFetch } from '../models/network.js'
import { ProviderKeyCooldownError } from '../models/key-pool.js'
import { URL_FIRST, prepareReferenceImages, submitWithReferenceFallback } from './reference-transport.js'
import { ModelConfigError } from '../models/types.js'
import { canFallbackTerminalReference, isReferenceDownloadFailure, ReferenceDownloadFailure, runWithTerminalReferenceFallback } from './reference-transport.js'

type Payload = Record<string, unknown>

export class OpenAiVideoProvider implements GenerationProvider {
  readonly name = 'openai-video'
  referencePolicy(_model: string) { return URL_FIRST }
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly pollInterval = Number(process.env.OPENAI_VIDEO_POLL_INTERVAL_MS || 5000)
  private readonly timeout = Number(process.env.OPENAI_VIDEO_TIMEOUT_MS || 900000)

  private readonly proxyUrl: string
  constructor(config?: { baseUrl: string; apiKey: string; proxyUrl?: string }) {
    this.baseUrl = (config?.baseUrl || required('OPENAI_VIDEO_BASE_URL', process.env.OPENAI_IMAGE_BASE_URL)).replace(/\/$/, '')
    this.apiKey = config ? config.apiKey : required('OPENAI_VIDEO_API_KEY', process.env.OPENAI_IMAGE_API_KEY)
    this.proxyUrl = config?.proxyUrl || ''
  }

  async run(input: GenerationInput, onUpdate: (update: GenerationUpdate) => void) {
    if (input.kind !== 'video') throw new Error('OpenAI Video Adapter 仅支持视频任务')
    onUpdate({ status: 'queued', progress: 0 })
    if ((input.inputUrls?.length ?? 0) > 7) throw new Error('Grok 多图视频最多支持 7 张参考图片')
    // A conservative embedded payload budget, not an upstream image-size claim.
    const options = { proxyUrl: this.proxyUrl, embeddedBudget: Math.floor(768 * 1024 / Math.max(1, input.inputUrls?.length || 0)) }
    const imageUrls = await prepareReferenceImages(input, URL_FIRST, options)
    return runWithTerminalReferenceFallback(imageUrls,
      images => this.runAttempt(input, onUpdate, images),
      async () => {
        console.info('[openai-video] terminal image download failure; using embedded reference once', { internalJobId: input.internalJobId })
        return prepareReferenceImages(input, URL_FIRST, { ...options, forceEmbedded: true })
      })
  }

  private async runAttempt(input: GenerationInput, onUpdate: (update: GenerationUpdate) => void, imageUrls: string[]) {
    const parameters = input.parameters ?? {}
    const options = { proxyUrl: this.proxyUrl, embeddedBudget: Math.floor(768 * 1024 / Math.max(1, imageUrls.length)) }
    let submittedImages = imageUrls
    const seconds = String(parameters.seconds || '5')
    const aspectRatio = String(parameters.aspect_ratio || '16:9')
    const requestedResolution = String(parameters.resolution || '720p')
    const resolution = requestedResolution === '480p' ? '480p' : '720p'
    const referenceMode = parameters.reference_mode === 'keyframes' ? 'keyframes' : 'references'
    if (referenceMode === 'keyframes') throw new Error('Grok 当前接口没有原生连续帧参数，请改用参考图模式')
    const prompt = imageUrls.length > 1 ? withNumberedReferences(input.prompt, imageUrls.length) : input.prompt
    console.info('[openai-video] creating task', { internalJobId: input.internalJobId, model: input.model, imageCount: imageUrls.length, orderedInputIndexes: imageUrls.map((_, index) => index + 1), mode: imageUrls.length > 1 ? referenceMode : imageUrls.length ? 'image-to-video' : 'text-to-video' })
    const submission = await submitWithReferenceFallback(imageUrls, URL_FIRST, images => {
      submittedImages = images
      return this.response('/v1/videos/generations', {
      method: 'POST',
      body: JSON.stringify({
        model: input.model, prompt, seconds, aspect_ratio: aspectRatio, resolution,
        ...(images.length > 1 ? { reference_images: images.map(url => ({ url })) } : images.length === 1 ? { input_reference: { image_url: images[0] } } : {}),
      }),
    }) }, () => prepareReferenceImages(input, URL_FIRST, { ...options, forceEmbedded: true }))
    if (!submission.ok) throw new ModelConfigError(`视频创建失败（HTTP ${submission.status}），未自动重复提交`, submission.status)
    const created = submission.payload
    const immediate = normalize(created)
    if (immediate.status === 'succeeded' && immediate.resultUrl) { onUpdate(immediate); return immediate }
    if (immediate.status === 'failed') this.throwTaskFailure(created, submittedImages)
    const id = text(created.request_id) || text(created.id) || text(created.video_id) || text(nested(created, 'data', 'id'))
    if (!id) throw new Error(`CPA/Grok 创建响应未返回 request_id（字段：${Object.keys(created).join(', ') || '空响应'}）`)
    const startedAt = Date.now(); let lastProgress = 0, started = false
    while (Date.now() - startedAt < this.timeout) {
      let payload: Payload
      try { payload = await this.request(`/v1/videos/${encodeURIComponent(id)}`) }
      catch (error) {
        if (!(error instanceof ProviderKeyCooldownError) || !error.pollingRateLimit) throw error
        // Preserve the accepted task; wait for its own key instead of creating
        // another job or querying a different account's task namespace.
        await wait(Math.min(Math.max(1000, error.until - Date.now()), Math.max(1, this.timeout - (Date.now() - startedAt))))
        continue
      }
      const normalized = normalize(payload, id, this.baseUrl)
      const update = { ...normalized, status: (started || normalized.progress > 1) && normalized.status === 'queued' ? 'running' as const : normalized.status, progress: Math.max(lastProgress, normalized.progress) }
      if (update.status === 'running') started = true
      lastProgress = update.progress
      console.info('[openai-video] task progress', { internalJobId: input.internalJobId, requestId: id, status: update.status, progress: update.progress, imageCount: imageUrls.length,
        ...(update.status === 'failed' ? { failureCategory: isReferenceDownloadFailure(payload) ? 'reference_download' : 'upstream_task', referenceTransport: submittedImages.some(image => /^https?:/i.test(image)) ? 'url' : 'embedded', embeddedFallbackEligible: canFallbackTerminalReference(payload, submittedImages) } : {}) })
      // Do not settle/refund the local job before a permitted embedded fallback.
      if (update.status === 'failed') this.throwTaskFailure(payload, submittedImages)
      onUpdate(update)
      if (update.status === 'succeeded') {
        if (!update.resultUrl) throw new Error('CPA video API 已完成但未返回视频地址')
        return update
      }
      await wait(this.pollInterval)
    }
    throw new Error(`CPA video API 超时（${Math.round(this.timeout / 1000)} 秒）`)
  }

  private throwTaskFailure(payload: Payload, images: string[]): never {
    if (isReferenceDownloadFailure(payload)) throw new ReferenceDownloadFailure(canFallbackTerminalReference(payload, images))
    throw new ModelConfigError('上游视频任务已失败，未自动重复提交；请检查内容限制或联系服务商查询任务', 422)
  }

  private async request(path: string, init: RequestInit = {}) {
    const result = await this.response(path, init)
    if (!result.ok) throw new ModelConfigError(`视频查询失败（HTTP ${result.status}）`, result.status)
    return result.payload
  }

  private async response(path: string, init: RequestInit = {}) {
    const response = await modelFetch(`${this.baseUrl}${path}`, { ...init, headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json', ...(init.headers as Record<string, string> | undefined) }, signal: AbortSignal.timeout(120000) }, this.proxyUrl)
    const body = await response.text(); let payload: Payload = {}
    try { payload = body ? JSON.parse(body) as Payload : {} } catch { throw new Error(`CPA video API 返回了非 JSON 内容（${response.status}）`) }
    return { ok: response.ok, status: response.status, payload }
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
function withNumberedReferences(prompt: string, count: number) {
  const labels = Array.from({ length: count }, (_, index) => `<IMAGE_${index + 1}>`).join(', ')
  return `${prompt}\n\nNumbered visual references available: ${labels}. The numbers identify the corresponding people, objects, environments, or visual styles mentioned in the prompt; they are not a chronological timeline. Match every IMAGE_n reference to the same numbered image, preserve its defining identity and appearance, and do not swap the numbered references.`
}
