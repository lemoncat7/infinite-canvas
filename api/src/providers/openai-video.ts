import type { GenerationInput, GenerationProvider, GenerationStatus, GenerationUpdate } from './types.js'
import { modelFetch } from '../models/network.js'
import { currentProviderKeys, ProviderKeyCooldownError } from '../models/key-pool.js'
import { TrackingDeferred, type AcceptedVideoTask } from './task-tracking.js'
import { estimatedVideoProgress, exactProgress, expectedVideoDuration } from './progress.js'
import { URL_FIRST, prepareReferenceImages, submitWithReferenceFallback } from './reference-transport.js'
import { ModelConfigError } from '../models/types.js'
import { videoResponseError } from './video-errors.js'
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
    if (input.acceptedTask) {
      if (input.acceptedTask.provider !== this.name) throw new TrackingDeferred(300000)
      currentProviderKeys()?.restoreKey(input.acceptedTask.key)
      return this.poll(input, onUpdate, input.acceptedTask, [])
    }
    onUpdate({ status: 'running', progress: 0, stage: 'local_generation' })
    if ((input.inputUrls?.length ?? 0) > 7) throw new ModelConfigError(`参考图数量超出接口限制：当前 ${input.inputUrls!.length} 张，Grok 多图视频最多支持 7 张参考图片。请减少参考图后重新提交。`)
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
    const seconds = String(parameters.seconds ?? '5')
    if (!Number.isSafeInteger(Number(seconds)) || Number(seconds) < 1) throw new ModelConfigError('视频时长必须为正整数秒；尚未提交上游')
    const aspectRatio = String(parameters.aspect_ratio || '16:9')
    const requestedResolution = String(parameters.resolution || '720p')
    if (!['480p', '720p'].includes(requestedResolution)) throw new ModelConfigError('当前视频适配器仅支持 480p、720p；尚未提交上游')
    const resolution = requestedResolution
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
    if (!submission.ok) throw videoResponseError(submission.status, submission.payload, '视频创建', submission.requestId)
    const created = submission.payload
    const immediate = normalize(created)
    if (immediate.status === 'succeeded' && immediate.resultUrl) { onUpdate(immediate); return immediate }
    if (immediate.status === 'failed') this.throwTaskFailure(created, submittedImages)
    const id = text(created.request_id) || text(created.id) || text(created.video_id) || text(nested(created, 'data', 'id'))
    if (!id) throw new Error(`CPA/Grok 创建响应未返回 request_id（字段：${Object.keys(created).join(', ') || '空响应'}）`)
    const acceptedTask: AcceptedVideoTask = { provider: this.name, id, key: currentProviderKeys()?.pinnedKey() ?? this.apiKey }
    input.saveAcceptedTask?.(acceptedTask)
    onUpdate({ status: 'running', progress: 0, stage: 'cloud_queue' })
    return this.poll(input, onUpdate, acceptedTask, submittedImages)
  }

  private async poll(input: GenerationInput, onUpdate: (update: GenerationUpdate) => void, initialTask: AcceptedVideoTask, submittedImages: string[]) {
    const startedAt = Date.now(), id = initialTask.id, key = initialTask.key
    let acceptedTask = initialTask, lastProgress = 0, lastProgressEstimated = false, started = false
    while (Date.now() - startedAt < this.timeout) {
      input.checkTracking?.()
      let payload: Payload
      try { payload = await this.request(`/v1/videos/${encodeURIComponent(id)}`, {}, key) }
      catch (error) {
        throw new TrackingDeferred(error instanceof ProviderKeyCooldownError ? Math.max(15000, error.until - Date.now()) : 15000)
      }
      input.checkTracking?.()
      if (!payload || !(payload.status || nested(payload, 'data', 'status'))) throw new TrackingDeferred()
      const normalized = normalize(payload, id, this.baseUrl)
      const normalizedStatus = (started || normalized.progress > 1) && normalized.status === 'queued' ? 'running' as const : normalized.status
      if (normalizedStatus === 'running' && normalized.progressEstimated && !acceptedTask.startedAt) {
        acceptedTask = { ...acceptedTask, startedAt: Date.now() }
        input.saveAcceptedTask?.(acceptedTask)
      }
      const candidateProgress = normalizedStatus === 'running' && normalized.progressEstimated
        ? estimatedVideoProgress(acceptedTask.startedAt ?? Date.now(), expectedVideoDuration(input.model))
        : normalized.progress
      let progress = candidateProgress, progressEstimated = Boolean(normalized.progressEstimated)
      if (lastProgress > candidateProgress) {
        progress = lastProgress
        progressEstimated = lastProgressEstimated
      }
      const update: GenerationUpdate = {
        ...normalized,
        status: normalizedStatus,
        progress,
        progressEstimated,
        stage: normalizedStatus === 'queued' ? 'cloud_queue' : 'cloud_generation',
      }
      if (update.status === 'running') started = true
      lastProgress = update.progress
      lastProgressEstimated = Boolean(update.progressEstimated)
      console.info('[openai-video] task progress', { internalJobId: input.internalJobId, requestId: id, status: update.status, progress: update.progress, imageCount: input.inputUrls?.length || 0,
        ...(update.status === 'failed' ? { failureCategory: isReferenceDownloadFailure(payload) ? 'reference_download' : 'upstream_task', referenceTransport: submittedImages.some(image => /^https?:/i.test(image)) ? 'url' : 'embedded', embeddedFallbackEligible: canFallbackTerminalReference(payload, submittedImages) } : {}) })
      // Do not settle/refund the local job before a permitted embedded fallback.
      if (update.status === 'failed') this.throwTaskFailure(payload, submittedImages)
      if (update.status === 'succeeded' && !update.resultUrl) throw new TrackingDeferred()
      onUpdate(update)
      if (update.status === 'succeeded') {
        if (!update.resultUrl) throw new Error('CPA video API 已完成但未返回视频地址')
        return update
      }
      await wait(this.pollInterval)
    }
    throw new TrackingDeferred()
  }

  private throwTaskFailure(payload: Payload, images: string[]): never {
    if (isReferenceDownloadFailure(payload)) throw new ReferenceDownloadFailure(canFallbackTerminalReference(payload, images))
    throw videoResponseError(422, payload, '视频执行')
  }

  private async request(path: string, init: RequestInit = {}, key = this.apiKey) {
    const result = await this.response(path, init, key)
    if (!result.ok) throw videoResponseError(result.status, result.payload, '视频查询', result.requestId)
    return result.payload
  }

  private async response(path: string, init: RequestInit = {}, key = this.apiKey) {
    const response = await modelFetch(`${this.baseUrl}${path}`, { ...init, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(init.headers as Record<string, string> | undefined) }, signal: AbortSignal.timeout(120000) }, this.proxyUrl)
    const body = await response.text(); let payload: Payload = {}
    try {
      const parsed: unknown = body ? JSON.parse(body) : {}
      payload = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Payload : {error: typeof parsed === 'string' ? parsed : 'Invalid JSON response'}
    } catch {
      throw new ModelConfigError(`视频接口返回非 JSON 响应（HTTP ${response.status}）；未自动重复提交，请先核对上游是否已接受任务`, response.ok ? 502 : response.status)
    }
    return { ok: response.ok, status: response.status, payload, requestId: response.headers.get('x-request-id') }
  }

}

function normalize(payload: Payload, id?: string, baseUrl?: string): GenerationUpdate {
  const raw = String(payload.status ?? nested(payload, 'data', 'status') ?? '').toLowerCase()
  const status: GenerationStatus = ['completed', 'complete', 'succeeded', 'success', 'done'].includes(raw) ? 'succeeded' : ['failed', 'error', 'cancelled', 'canceled'].includes(raw) ? 'failed' : ['queued', 'pending'].includes(raw) ? 'queued' : 'running'
  const upstreamProgress = exactProgress(payload.progress ?? nested(payload, 'data', 'progress'))
  const progress = status === 'succeeded' ? 100 : upstreamProgress ?? 0
  const direct = text(payload.video_url) || text(nested(payload, 'video', 'url')) || text(payload.url) || text(payload.result_url) || text(payload.output_url) || text(nested(payload, 'data', 'url')) || text(nested(payload, 'output', 'url'))
  const resultUrl = direct || (status === 'succeeded' && id && baseUrl ? `${baseUrl}/v1/videos/${encodeURIComponent(id)}/content` : undefined)
  return { status, progress, progressEstimated: status === 'running' && upstreamProgress === undefined, stage: status === 'queued' ? 'cloud_queue' : 'cloud_generation', resultUrl, error: text(nested(payload, 'error', 'message')) || text(payload.error) || text(payload.message) }
}
function nested(value: Payload, first: string, second: string) { const child = value[first]; return child && typeof child === 'object' ? (child as Payload)[second] : undefined }
function text(value: unknown) { return typeof value === 'string' && value ? value : undefined }
function required(name: string, fallback?: string) { const value = process.env[name] || fallback; if (!value) throw new Error(`${name} is required when using openai-video`); return value }
const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))
function withNumberedReferences(prompt: string, count: number) {
  const labels = Array.from({ length: count }, (_, index) => `<IMAGE_${index + 1}>`).join(', ')
  return `${prompt}\n\nNumbered visual references available: ${labels}. The numbers identify the corresponding people, objects, environments, or visual styles mentioned in the prompt; they are not a chronological timeline. Match every IMAGE_n reference to the same numbered image, preserve its defining identity and appearance, and do not swap the numbered references.`
}
