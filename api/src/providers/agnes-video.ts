import type { GenerationInput, GenerationProvider, GenerationUpdate } from './types.js'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { currentProviderKeys, ProviderKeyCooldownError } from '../models/key-pool.js'
import { agnesResponseError } from './agnes-errors.js'
import { createAgnes25Body, isAgnesVideo25 } from './agnes-video-v25.js'
import { ModelConfigError } from '../models/types.js'
import sharp from 'sharp'
import { EMBEDDED_ONLY, URL_FIRST, prepareReferenceImages, canFallbackReference } from './reference-transport.js'
import { TrackingDeferred } from './task-tracking.js'

type AgnesTask = {
  id?: string
  task_id?: string
  video_id?: string
  status?: string
  progress?: number
  url?: string
  seconds?: string
  size?: string
  created_at?: number
  completed_at?: number
  metadata?: { url?: string; size_mapping?: Record<string, unknown> }
  error?: { message?: string } | string | null
  message?: string
  code?: string
  data?: { param?: string }
}

const agnesCooldownMs = Math.max(1000, Number(process.env.AGNES_VIDEO_KEY_COOLDOWN_MS || 60000))
const agnesCredentialPool = [process.env.AGNES_VIDEO_API_KEY, process.env.AGNES_VIDEO_API_KEY_2, ...(process.env.AGNES_VIDEO_API_KEYS || '').split(',')]
  .map(value => String(value || '').trim()).filter((value, index, values) => value && values.indexOf(value) === index)
  .map((key, index) => ({ key, channel:index + 1, nextAvailableAt:0 }))

const managedCooldowns = new Map<string, number>()
async function acquireAgnesCredential(managedKeys?: string[]) {
  if (managedKeys !== undefined) {
    const managedKey = managedKeys.reduce((best, key) => (managedCooldowns.get(createHash('sha256').update(key).digest('hex')) || 0) < (managedCooldowns.get(createHash('sha256').update(best).digest('hex')) || 0) ? key : best)
    const now = Date.now(), id = createHash('sha256').update(managedKey).digest('hex')
    for (const [key, at] of managedCooldowns) if (at < now) managedCooldowns.delete(key)
    const reservedAt = Math.max(now, managedCooldowns.get(id) || 0)
    managedCooldowns.set(id, reservedAt + agnesCooldownMs)
    if (reservedAt > now) await wait(reservedAt - now)
    return { key: managedKey, channel: 1, nextAvailableAt: reservedAt }
  }
  if (!agnesCredentialPool.length) throw new Error('AGNES_VIDEO_API_KEY is required when using agnes-video')
  const credential = agnesCredentialPool.reduce((earliest, item) => item.nextAvailableAt < earliest.nextAvailableAt ? item : earliest)
  const reservedAt = Math.max(Date.now(), credential.nextAvailableAt)
  credential.nextAvailableAt = reservedAt + agnesCooldownMs
  const waitMs = reservedAt - Date.now()
  if (waitMs > 0) {
    console.info('[agnes-video] waiting for credential cooldown', { channel:credential.channel, waitMs, channelCount:agnesCredentialPool.length })
    await wait(waitMs)
  }
  return credential
}

export class AgnesVideoProvider implements GenerationProvider {
  referencePolicy(model: string) { return isAgnesVideo25(model || this.defaultModel) ? EMBEDDED_ONLY : URL_FIRST }
  readonly name = 'agnes-video'
  private readonly baseUrl: string
  private readonly managedKeys?: string[]
  private readonly proxyUrl?: string
  constructor(config?: { baseUrl: string; apiKey: string; apiKeys?: string[]; proxyUrl?: string }) {
    this.baseUrl = (config?.baseUrl || required('AGNES_VIDEO_BASE_URL')).replace(/\/$/, '')
    this.managedKeys = config ? config.apiKeys?.length ? config.apiKeys : [config.apiKey] : undefined
    this.proxyUrl = config ? config.proxyUrl || '' : process.env.AGNES_VIDEO_HTTPS_PROXY
  }
  private readonly defaultModel = process.env.AGNES_VIDEO_DEFAULT_MODEL || 'agnes-video-v2.0'
  private readonly pollInterval = Number(process.env.AGNES_VIDEO_POLL_INTERVAL_MS || 8000)
  private readonly timeout = Number(process.env.AGNES_VIDEO_TIMEOUT_MS || 900000)
  private readonly createTimeout = Number(process.env.AGNES_VIDEO_CREATE_TIMEOUT_MS || 45000)
  private readonly embeddedCreateTimeout = Number(process.env.AGNES_VIDEO_EMBEDDED_CREATE_TIMEOUT_MS || 180000)
  private readonly queryTimeout = Number(process.env.AGNES_VIDEO_QUERY_TIMEOUT_MS || 30000)
  private readonly publicBaseUrl = (process.env.GENERATION_PUBLIC_BASE_URL || '').replace(/\/$/, '')
  private readonly assetMode = process.env.AGNES_VIDEO_ASSET_MODE || 'auto'
  private readonly cdnUploadUrl = process.env.ASSET_CDN_UPLOAD_URL || ''
  private readonly cdnApiKey = process.env.ASSET_CDN_API_KEY || ''

  async run(input: GenerationInput, onUpdate: (update: GenerationUpdate) => void) {
    if (input.kind !== 'video') throw new Error('Agnes Video Adapter 仅支持视频任务')
    if (input.acceptedTask) {
      if (input.acceptedTask.provider !== this.name) throw new TrackingDeferred(300000)
      currentProviderKeys()?.restoreKey(input.acceptedTask.key)
      return this.poll(input, onUpdate, input.acceptedTask.id, input.acceptedTask.taskId, input.acceptedTask.key)
    }
    const credential = currentProviderKeys() ? { key: '', channel: 1 } : await acquireAgnesCredential(this.managedKeys)
    const settings = normalizeAgnesSettings(input.parameters)
    const referenceMode = input.parameters?.reference_mode === 'keyframes' ? 'keyframes' : 'references'
    const imageSources = input.inputUrls ?? []
    const modern = isAgnesVideo25(input.model || this.defaultModel)
    if (modern) createAgnes25Body(input, imageSources)
    if (!modern && referenceMode === 'keyframes' && imageSources.length < 2) throw new ModelConfigError(`参考图数量不符合要求：当前 ${imageSources.length} 张，Agnes 关键帧动画至少需要 2 张按时间顺序排列的图片`)
    if (!modern && referenceMode !== 'keyframes' && imageSources.length > 1) throw new ModelConfigError(`参考图数量超出接口限制：当前 ${imageSources.length} 张，Agnes 此模式最多支持 1 张参考图；多张图片请改用关键帧动画`)
    // Agnes accepts embedded image data for keyframes as well as ordinary
    // image-to-video jobs. Prefer the signed public URL when it is usable, but
    // never make a CDN a hard requirement: the upstream service occasionally
    // rejects an otherwise reachable URL and must then receive embedded data.
    let images = modern
      ? await prepareReferenceImages(input, EMBEDDED_ONLY, { proxyUrl: this.proxyUrl })
      : await Promise.all(imageSources.map(source => this.resolveImage(source)))
    if (modern) {
      let totalBytes = 0;
      for (const [index, image] of images.entries()) {
        if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(image)) throw new ModelConfigError(`参考图 ${index + 1} 无法读取为图片，请检查素材地址`);
        const bytes = Buffer.from(image.slice(image.indexOf(',') + 1), 'base64');
        totalBytes += bytes.length;
        const metadata = await sharp(bytes).metadata();
        if (!metadata.width || !metadata.height || Math.min(metadata.width, metadata.height) < 256 || Math.max(metadata.width, metadata.height) > 5760)
          throw new ModelConfigError(`参考图 ${index + 1} 尺寸为 ${metadata.width || 0}×${metadata.height || 0}；Agnes Video 2.5 要求宽高均为 256–5760 像素，请更换符合尺寸的图片`);
        if (bytes.length >= 15 * 1024 * 1024) throw new ModelConfigError(`参考图 ${index + 1} 必须小于 15 MiB`);
      }
      if (totalBytes >= 50 * 1024 * 1024) throw new ModelConfigError('Agnes Video 2.5 参考图片总大小必须小于 50 MiB');
    }
    onUpdate({ status: 'running', progress: 0 })
    console.info('[agnes-video] preparing ordered inputs', { internalJobId: input.internalJobId, imageCount: images.length, orderedInputIndexes: images.map((_, index) => index + 1) })
    console.info('[agnes-video] credential assigned', { internalJobId:input.internalJobId, channel:credential.channel, channelCount:agnesCredentialPool.length })
    let response = await this.request('/v1/videos', { method: 'POST', body: createAgnesRequestBody(input, images, settings, this.defaultModel, referenceMode) }, this.timeoutForImages(images), credential.key)
    let created = await readTask(response)
    if (!response.ok && canFallbackReference(response.status, created, images)) {
      console.info('[agnes-video] public image rejected, retrying with embedded images', { internalJobId: input.internalJobId, imageCount: imageSources.length })
      images = await prepareReferenceImages(input, EMBEDDED_ONLY, { proxyUrl: this.proxyUrl })
      response = await this.request('/v1/videos', { method: 'POST', body: createAgnesRequestBody(input, images, settings, this.defaultModel, referenceMode) }, this.timeoutForImages(images), credential.key)
      created = await readTask(response)
    }
    if (!modern && !response.ok && [400, 422].includes(response.status) && !created.id && !created.task_id && !created.video_id && /num_frames exceeds max frames/i.test(taskError(created))) {
      const reducedSettings = reduceAgnesFrames(settings)
      console.warn('[agnes-video] resolved resolution has a lower frame budget; retrying with adjusted frame rate', {
        internalJobId:input.internalJobId,
        requestedFrames:settings.num_frames,
        adjustedFrames:reducedSettings.num_frames,
        adjustedFrameRate:reducedSettings.frame_rate,
      })
      response = await this.request('/v1/videos', { method:'POST', body:createAgnesRequestBody(input, images, reducedSettings, this.defaultModel, referenceMode) }, this.timeoutForImages(images), credential.key)
      created = await readTask(response)
    }
    if (!response.ok) throw agnesResponseError(response.status, created, 'create')
    const videoId = created.video_id || created.task_id || created.id
    const taskId = created.task_id || created.id || videoId
    if (!videoId) throw new Error('Agnes 创建任务响应中没有 video_id 或 task_id')
    input.saveAcceptedTask?.({ provider: this.name, id: videoId, taskId, key: currentProviderKeys()?.pinnedKey() ?? credential.key })
    console.info('[agnes-video] task created', { internalJobId: input.internalJobId, videoId, model: input.model || this.defaultModel, imageCount: images.length, mode: images.length > 1 ? referenceMode : images.length ? 'ti2vid' : 'text' })

    return this.poll(input, onUpdate, videoId, taskId, credential.key)
  }

  private async poll(input: GenerationInput, onUpdate: (update: GenerationUpdate) => void, videoId: string, taskId: string | undefined, key: string) {
    const startedAt = Date.now()
    while (Date.now() - startedAt < this.timeout) {
      input.checkTracking?.()
      await wait(this.pollInterval)
      input.checkTracking?.()
      const query = `/agnesapi?video_id=${encodeURIComponent(videoId)}&model_name=${encodeURIComponent(input.model || this.defaultModel)}`
      let statusResponse: Response, task: AgnesTask
      try {
        statusResponse = await this.request(query, {}, this.queryTimeout, key)
        task = await readTask(statusResponse)
        if (statusResponse.status === 404 && taskId) {
          statusResponse = await this.request(`/v1/videos/${encodeURIComponent(taskId)}`, {}, this.queryTimeout, key)
          task = await readTask(statusResponse)
        }
      }
      catch (error) {
        throw new TrackingDeferred(error instanceof ProviderKeyCooldownError ? Math.max(15000, error.until - Date.now()) : 15000)
      }
      if (!statusResponse.ok) {
        throw new TrackingDeferred(statusResponse.status === 429 ? 60000 : 15000)
      }
      input.checkTracking?.()
      if (!task || typeof task.status !== 'string') throw new TrackingDeferred()
      if (['failed', 'error', 'canceled', 'cancelled'].includes(task.status)) throw new Error(taskError(task) || 'Agnes 视频任务失败或已取消')
      if (task.status === 'completed') {
        const resultUrl = task.url || task.metadata?.url
        if (!resultUrl) throw new TrackingDeferred()
        const resultMetadata = {
          ...(task.seconds ? { seconds:task.seconds } : {}),
          ...(task.size ? { size:task.size } : {}),
          ...(task.metadata?.size_mapping ? { sizeMapping:task.metadata.size_mapping } : {}),
          ...(task.created_at ? { createdAt:task.created_at } : {}),
          ...(task.completed_at ? { completedAt:task.completed_at } : {}),
          videoId,
          taskId,
        }
        const result: GenerationUpdate = { status: 'succeeded', progress: 100, resultUrl, resultMetadata }; onUpdate(result); return result
      }
      const progress = Math.min(99, Math.max(0, Number(task.progress || 0)))
      console.info('[agnes-video] task progress', { internalJobId: input.internalJobId, videoId, status: task.status, progress })
      onUpdate({ status: 'running', progress })
    }
    throw new TrackingDeferred()
  }

  private async request(path: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}, timeout = this.queryTimeout, apiKey = required('AGNES_VIDEO_API_KEY')) {
    const pool = currentProviderKeys()
    return pool ? pool.run(key => this.requestWithKey(path, init, timeout, key)) : this.requestWithKey(path, init, timeout, apiKey)
  }
  private async requestWithKey(path: string, init: { method?: string; body?: string; headers?: Record<string, string> }, timeout: number, apiKey: string) {
    // curl is used only by the Agnes adapter. Its HTTP CONNECT implementation is
    // compatible with the configured LAN proxy; Undici stalls on this proxy/API pair.
    const marker = '\n__AGNES_HTTP_STATUS__:'
    const args = [
      '--silent', '--show-error', '--dump-header', '-',
      '--connect-timeout', '10', '--max-time', String(Math.ceil(timeout / 1000)),
      '--write-out', `${marker}%{http_code}`,
      '--header', `Authorization: Bearer ${apiKey}`,
      '--header', 'Content-Type: application/json',
    ]
    if (this.proxyUrl) args.push('--proxy', this.proxyUrl)
    for (const [name, value] of Object.entries(init.headers || {})) args.push('--header', `${name}: ${value}`)
    if (init.method === 'POST') args.push('--request', 'POST', '--data-binary', '@-')
    args.push(`${this.baseUrl}${path}`)
    try {
      const stdout = await runCurl(args, init.method === 'POST' ? init.body || '{}' : undefined, timeout + 5000)
      const markerIndex = stdout.lastIndexOf(marker)
      if (markerIndex < 0) throw new Error('Agnes 响应缺少 HTTP 状态码')
      const status = Number(stdout.slice(markerIndex + marker.length).trim())
      // CONNECT proxies and 100 Continue can prepend header blocks. Only the
      // final upstream headers belong to the response (not the proxy's headers).
      let body = stdout.slice(0, markerIndex), headers = new Headers()
      while (/^HTTP\/\S+ \d{3}/.test(body)) {
        const boundary = /\r?\n\r?\n/.exec(body)
        if (!boundary) break
        headers = new Headers()
        for (const line of body.slice(0, boundary.index).split(/\r?\n/).slice(1)) {
          const colon = line.indexOf(':')
          if (colon > 0 && line.slice(0, colon).toLowerCase() === 'retry-after') headers.set('retry-after', line.slice(colon + 1).trim())
        }
        body = body.slice(boundary.index + boundary[0].length)
      }
      return new Response(status === 204 || status === 304 ? null : body, { status, headers })
    } catch (error) {
      const action = init.method === 'POST' ? '创建任务' : '查询任务'
      const message = sanitizeError(error instanceof Error ? error.message : String(error))
      console.warn('[agnes-video] request failed', { action, path, message })
      if (/aborted|timeout|timed out|curl: \(28\)/i.test(message)) throw new Error(`Agnes ${action}请求超时，请检查代理连接后重试`)
      throw error
    }
  }

  private timeoutForImages(images: string[]) {
    return images.some(image => image.startsWith('data:')) ? this.embeddedCreateTimeout : this.createTimeout
  }

  private async resolveImage(source: string, forceEmbedded = false) {
    if (source.startsWith('data:')) return source
    if (/^https?:\/\//i.test(source) && !forceEmbedded) return source
    if (/^https?:\/\//i.test(source) && forceEmbedded) {
      // Resolved owned assets may arrive here as this application's public
      // URL. If Agnes rejects that URL, embedding must read the same asset over
      // the container-local API instead of depending on public DNS/proxy
      // hairpinning, which commonly fails with the unhelpful `fetch failed`.
      let readUrl = source
      try {
        const parsed = new URL(source), publicOrigin = this.publicBaseUrl ? new URL(this.publicBaseUrl).origin : ''
        if (publicOrigin && parsed.origin === publicOrigin && parsed.pathname.startsWith('/api/'))
          readUrl = `http://127.0.0.1:${process.env.PORT ?? 3000}/${parsed.pathname.slice(5)}${parsed.search}`
      } catch { /* keep the original external URL */ }
      const response = await fetch(readUrl, { signal:AbortSignal.timeout(30000) })
      if (!response.ok) throw new Error(`重新读取 Agnes 参考图片失败（${response.status}）`)
      const mimeType = response.headers.get('content-type')?.split(';')[0] || 'image/png'
      const bytes = Buffer.from(await response.arrayBuffer())
      return `data:${mimeType};base64,${bytes.toString('base64')}`
    }
    if (source.startsWith('/api/')) {
      const publicUrl = `${this.publicBaseUrl}${source}`
      if (!forceEmbedded && this.assetMode === 'url' && this.hasPublicDomain()) return publicUrl
      if (!forceEmbedded && this.assetMode === 'auto' && this.hasPublicDomain() && await this.isPublicUrlUsable(publicUrl)) {
        return publicUrl
      }
      const response = await fetch(`http://127.0.0.1:${process.env.PORT ?? 3000}/${source.slice(5)}`, { signal: AbortSignal.timeout(30000) })
      if (!response.ok) throw new Error(`读取首帧图片失败（${response.status}）`)
      const mimeType = response.headers.get('content-type')?.split(';')[0] || 'image/png'
      const bytes = Buffer.from(await response.arrayBuffer())
      if (!bytes.length || bytes.length > 15 * 1024 * 1024) throw new Error('首帧图片为空或超过 15MB')
      if (!forceEmbedded && (this.assetMode === 'cdn' || this.assetMode === 'auto') && this.cdnUploadUrl) {
        try { return await this.uploadToCdn(bytes, mimeType) }
        catch (error) { console.warn('[agnes-video] CDN upload failed, using data URL', { message: sanitizeError(error instanceof Error ? error.message : String(error)) }) }
      }
      return `data:${mimeType};base64,${bytes.toString('base64')}`
    }
    if (!this.publicBaseUrl) throw new Error('图生视频需要公网图片 URL 或本地资产')
    return `${this.publicBaseUrl}${source.startsWith('/') ? '' : '/'}${source}`
  }

  private hasPublicDomain() {
    if (!this.publicBaseUrl) return false
    try {
      const hostname = new URL(this.publicBaseUrl).hostname
      return hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '::1' && !/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)
    } catch { return false }
  }

  private async isPublicUrlUsable(url: string) {
    try {
      const response = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(8000) })
      return response.ok && (response.headers.get('content-type') || '').startsWith('image/')
    } catch (error) {
      console.warn('[agnes-video] public asset check failed, using upload fallback', { url: new URL(url).origin, message: sanitizeError(error instanceof Error ? error.message : String(error)) })
      return false
    }
  }

  private async uploadToCdn(bytes: Buffer, mimeType: string) {
    const response = await fetch(this.cdnUploadUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(this.cdnApiKey ? { authorization: `Bearer ${this.cdnApiKey}` } : {}) },
      body: JSON.stringify({ filename: `agnes-input-${Date.now()}.${mimeType.split('/')[1] || 'bin'}`, mimeType, data: bytes.toString('base64') }),
      signal: AbortSignal.timeout(60000),
    })
    const result = await response.json() as { url?: string; data?: { url?: string } }
    const url = result.url || result.data?.url
    if (!response.ok || !url || !/^https?:\/\//i.test(url)) throw new Error(`CDN 上传失败（${response.status}）`)
    return url
  }
}

export function normalizeAgnesSettings(parameters: Record<string, unknown> | undefined) {
  const seconds = Math.min(18, Math.max(1, Number(parameters?.seconds || 5)))
  const requestedFrameRate = Number(parameters?.frame_rate)
  const resolution = String(parameters?.resolution || '720p')
  const ratio = String(parameters?.aspect_ratio || '16:9')
  const maxFrames = resolution === '1080p' ? 241 : 441
  let frameRate = Number.isFinite(requestedFrameRate) ? Math.min(60, Math.max(1, requestedFrameRate)) : 24
  let frames = Math.max(25, Math.round((seconds * frameRate - 1) / 8) * 8 + 1)
  while (frames > maxFrames && frameRate > 1) {
    frameRate = Math.max(1, frameRate - 1)
    frames = Math.max(25, Math.round((seconds * frameRate - 1) / 8) * 8 + 1)
  }
  frames = Math.min(maxFrames, frames)
  const dimensions: Record<string, Record<string, [number, number]>> = {
    '480p': { '1:1': [480, 480], '4:3': [640, 480], '3:4': [480, 640], '16:9': [832, 448], '9:16': [448, 832] },
    '720p': { '1:1': [720, 720], '4:3': [960, 720], '3:4': [720, 960], '16:9': [1280, 720], '9:16': [720, 1280] },
    '1080p': { '1:1': [1080, 1080], '4:3': [1440, 1080], '3:4': [1080, 1440], '16:9': [1920, 1080], '9:16': [1080, 1920] },
  }
  const [width, height] = dimensions[resolution]?.[ratio] || dimensions['720p']['16:9']
  const seed = Number(parameters?.seed)
  const inferenceSteps = Number(parameters?.num_inference_steps)
  const negativePrompt = String(parameters?.negative_prompt || '').trim().slice(0, 1200)
  return {
    width, height, num_frames:frames, frame_rate:frameRate,
    ...(Number.isSafeInteger(seed) && seed >= 0 ? { seed } : {}),
    ...(Number.isSafeInteger(inferenceSteps) && inferenceSteps > 0 ? { num_inference_steps:Math.min(1000, inferenceSteps) } : {}),
    ...(negativePrompt ? { negative_prompt:negativePrompt } : {}),
  }
}

function reduceAgnesFrames(settings: Record<string, unknown>) {
  const requestedFrames = Number(settings.num_frames) || 121
  const requestedRate = Number(settings.frame_rate) || 24
  const seconds = requestedFrames / requestedRate
  let frameRate = Math.max(1, requestedRate - 1)
  let numFrames = Math.max(25, Math.round((seconds * frameRate - 1) / 8) * 8 + 1)
  while (numFrames >= requestedFrames && frameRate > 1) {
    frameRate -= 1
    numFrames = Math.max(25, Math.round((seconds * frameRate - 1) / 8) * 8 + 1)
  }
  return { ...settings, frame_rate:frameRate, num_frames:Math.min(241, numFrames) }
}

async function readTask(response: Response) { try { return await response.json() as AgnesTask } catch { return {} } }
function taskError(task: AgnesTask) { return typeof task.error === 'string' ? task.error : task.error?.message || task.message || '' }
function wait(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)) }
function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value }
export function createAgnesRequestBody(input: GenerationInput, images: string[], settings: Record<string, unknown>, defaultModel: string, referenceMode: 'keyframes'|'references') {
  if (isAgnesVideo25(input.model || defaultModel)) return JSON.stringify(createAgnes25Body({ ...input, model: input.model || defaultModel }, images))
  const media = images.length > 1
    ? { extra_body: { image: images, mode: 'keyframes' } }
    : images.length === 1 ? { image: images[0], mode: 'ti2vid' } : {}
  const prompt = images.length > 1 ? referenceMode === 'keyframes' ? withOrderedKeyframes(input.prompt, images.length) : withNumberedReferences(input.prompt, images.length) : input.prompt
  const generationSettings = referenceMode === 'keyframes' && images.length > 1 && !settings.negative_prompt
    ? { ...settings, negative_prompt:'extra action, separate attack, pose reset, character redesign, identity change, clothing change, prop change, scene change, camera-axis break, text, subtitle, watermark' }
    : settings
  return JSON.stringify({ model: input.model || defaultModel, prompt, ...media, ...generationSettings })
}
function withOrderedKeyframes(prompt: string, count: number) {
  const labels = Array.from({ length: count }, (_, index) => `Image ${index + 1}`).join(' → ')
  return `${prompt}\n\nCreate one smooth chronological transition through ${labels}. Maintain character identity, scene continuity, and the camera progression shown by the supplied keyframes. Pass through every image in order and finish on Image ${count}.`
}
function withNumberedReferences(prompt: string, count: number) {
  const labels = Array.from({ length: count }, (_, index) => `Image ${index + 1}`).join(', ')
  return `${prompt}\n\nNumbered visual references available: ${labels}. These numbers identify the corresponding people, objects, environments, or visual styles in the prompt; they do not define a chronological timeline. Preserve each numbered reference's identity and appearance, and do not swap numbered references.`
}
function sanitizeError(message: string) { return message.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]').replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED]') }

function runCurl(args: string[], stdin: string | undefined, timeout: number) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn('curl', args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const stdout: Buffer[] = [], stderr: Buffer[] = []
    let size = 0
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('curl timed out')) }, timeout)
    child.stdout.on('data', chunk => { size += chunk.length; if (size <= 4 * 1024 * 1024) stdout.push(chunk) })
    child.stderr.on('data', chunk => stderr.push(chunk))
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('close', code => {
      clearTimeout(timer)
      if (size > 4 * 1024 * 1024) return reject(new Error('Agnes 响应超过 4MB'))
      if (code !== 0) return reject(new Error(Buffer.concat(stderr).toString('utf8').trim() || `curl exited with ${code}`))
      resolve(Buffer.concat(stdout).toString('utf8'))
    })
    child.stdin.end(stdin)
  })
}
