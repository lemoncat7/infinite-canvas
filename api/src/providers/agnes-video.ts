import type { GenerationInput, GenerationProvider, GenerationUpdate } from './types.js'
import { spawn } from 'node:child_process'

type AgnesTask = {
  id?: string
  task_id?: string
  video_id?: string
  status?: string
  progress?: number
  url?: string
  metadata?: { url?: string }
  error?: { message?: string } | string | null
  message?: string
  code?: string
}

const agnesCooldownMs = Math.max(1000, Number(process.env.AGNES_VIDEO_KEY_COOLDOWN_MS || 60000))
const agnesCredentialPool = [process.env.AGNES_VIDEO_API_KEY, process.env.AGNES_VIDEO_API_KEY_2, ...(process.env.AGNES_VIDEO_API_KEYS || '').split(',')]
  .map(value => String(value || '').trim()).filter((value, index, values) => value && values.indexOf(value) === index)
  .map((key, index) => ({ key, channel:index + 1, nextAvailableAt:0 }))

async function acquireAgnesCredential() {
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
  readonly name = 'agnes-video'
  private readonly baseUrl = required('AGNES_VIDEO_BASE_URL').replace(/\/$/, '')
  private readonly defaultModel = process.env.AGNES_VIDEO_DEFAULT_MODEL || 'agnes-video-v2.0'
  private readonly pollInterval = Number(process.env.AGNES_VIDEO_POLL_INTERVAL_MS || 8000)
  private readonly timeout = Number(process.env.AGNES_VIDEO_TIMEOUT_MS || 900000)
  private readonly createTimeout = Number(process.env.AGNES_VIDEO_CREATE_TIMEOUT_MS || 45000)
  private readonly embeddedCreateTimeout = Number(process.env.AGNES_VIDEO_EMBEDDED_CREATE_TIMEOUT_MS || 180000)
  private readonly queryTimeout = Number(process.env.AGNES_VIDEO_QUERY_TIMEOUT_MS || 30000)
  private readonly publicBaseUrl = (process.env.GENERATION_PUBLIC_BASE_URL || '').replace(/\/$/, '')
  private readonly proxyUrl = process.env.AGNES_VIDEO_HTTPS_PROXY
  private readonly assetMode = process.env.AGNES_VIDEO_ASSET_MODE || 'auto'
  private readonly cdnUploadUrl = process.env.ASSET_CDN_UPLOAD_URL || ''
  private readonly cdnApiKey = process.env.ASSET_CDN_API_KEY || ''

  async run(input: GenerationInput, onUpdate: (update: GenerationUpdate) => void) {
    if (input.kind !== 'video') throw new Error('Agnes Video Adapter 仅支持视频任务')
    const credential = await acquireAgnesCredential()
    const settings = normalizeSettings(input.parameters)
    const referenceMode = input.parameters?.reference_mode === 'keyframes' ? 'keyframes' : 'references'
    const imageSources = input.inputUrls ?? []
    let images = await Promise.all(imageSources.map(source => this.resolveImage(source)))
    onUpdate({ status: 'running', progress: 0 })
    console.info('[agnes-video] preparing ordered inputs', { internalJobId: input.internalJobId, imageCount: images.length, orderedInputIndexes: images.map((_, index) => index + 1) })
    console.info('[agnes-video] credential assigned', { internalJobId:input.internalJobId, channel:credential.channel, channelCount:agnesCredentialPool.length })
    let response = await this.request('/v1/videos', { method: 'POST', body: createBody(input, images, settings, this.defaultModel, referenceMode) }, this.timeoutForImages(images), credential.key)
    let created = await readTask(response)
    if (!response.ok && imageSources.length && images.some(image => /^https?:\/\//i.test(image)) && /image URL|image.*download/i.test(taskError(created))) {
      console.info('[agnes-video] public image rejected, retrying with embedded images', { internalJobId: input.internalJobId, imageCount: imageSources.length })
      images = await Promise.all(imageSources.map(source => this.resolveImage(source, true)))
      response = await this.request('/v1/videos', { method: 'POST', body: createBody(input, images, settings, this.defaultModel, referenceMode) }, this.timeoutForImages(images), credential.key)
      created = await readTask(response)
    }
    if (!response.ok) throw new Error(taskError(created) || `Agnes 创建视频任务失败（${response.status}）`)
    const videoId = created.video_id || created.task_id || created.id
    if (!videoId) throw new Error('Agnes 创建任务响应中没有 video_id 或 task_id')
    console.info('[agnes-video] task created', { internalJobId: input.internalJobId, videoId, model: input.model || this.defaultModel, imageCount: images.length, mode: images.length > 1 ? referenceMode : images.length ? 'ti2vid' : 'text' })

    const startedAt = Date.now()
    while (Date.now() - startedAt < this.timeout) {
      await wait(this.pollInterval)
      const query = `/agnesapi?video_id=${encodeURIComponent(videoId)}&model_name=${encodeURIComponent(input.model || this.defaultModel)}`
      const statusResponse = await this.request(query, {}, this.queryTimeout, credential.key)
      const task = await readTask(statusResponse)
      if (!statusResponse.ok) {
        if (statusResponse.status === 429 || /rate limit/i.test(taskError(task))) continue
        throw new Error(taskError(task) || `Agnes 查询视频任务失败（${statusResponse.status}）`)
      }
      if (task.status === 'failed') throw new Error(taskError(task) || 'Agnes 视频生成失败')
      if (task.status === 'completed') {
        const resultUrl = task.url || task.metadata?.url
        if (!resultUrl) throw new Error('Agnes 任务已完成，但响应中没有视频 URL')
        const result: GenerationUpdate = { status: 'succeeded', progress: 100, resultUrl }; onUpdate(result); return result
      }
      const progress = Math.min(99, Math.max(0, Number(task.progress || 0)))
      console.info('[agnes-video] task progress', { internalJobId: input.internalJobId, videoId, status: task.status, progress })
      onUpdate({ status: 'running', progress })
    }
    throw new Error('Agnes 视频生成超时')
  }

  private async request(path: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}, timeout = this.queryTimeout, apiKey = required('AGNES_VIDEO_API_KEY')) {
    // curl is used only by the Agnes adapter. Its HTTP CONNECT implementation is
    // compatible with the configured LAN proxy; Undici stalls on this proxy/API pair.
    const marker = '\n__AGNES_HTTP_STATUS__:'
    const args = [
      '--silent', '--show-error', '--location',
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
      return new Response(stdout.slice(0, markerIndex), { status })
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
    if (/^https?:\/\//i.test(source)) return source
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
      if ((this.assetMode === 'cdn' || this.assetMode === 'auto') && this.cdnUploadUrl) {
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

function normalizeSettings(parameters: Record<string, unknown> | undefined) {
  const seconds = Math.min(18, Math.max(1, Number(parameters?.seconds || 5)))
  const frameRate = 24
  const frames = Math.min(441, Math.max(25, Math.round((seconds * frameRate - 1) / 8) * 8 + 1))
  const resolution = String(parameters?.resolution || '720p')
  const ratio = String(parameters?.aspect_ratio || '16:9')
  const dimensions: Record<string, Record<string, [number, number]>> = {
    '480p': { '1:1': [480, 480], '4:3': [640, 480], '16:9': [832, 448] },
    '720p': { '1:1': [720, 720], '4:3': [960, 720], '16:9': [1280, 720] },
    '1080p': { '1:1': [1080, 1080], '4:3': [1440, 1080], '16:9': [1920, 1080] },
  }
  const [width, height] = dimensions[resolution]?.[ratio] || dimensions['720p']['16:9']
  return { width, height, num_frames: frames, frame_rate: frameRate }
}

async function readTask(response: Response) { try { return await response.json() as AgnesTask } catch { return {} } }
function taskError(task: AgnesTask) { return typeof task.error === 'string' ? task.error : task.error?.message || task.message || '' }
function wait(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)) }
function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value }
function createBody(input: GenerationInput, images: string[], settings: Record<string, unknown>, defaultModel: string, referenceMode: 'keyframes'|'references') {
  const media = images.length > 1
    ? { mode: 'keyframes', extra_body: { image: images, mode: 'keyframes' } }
    : images.length === 1 ? { image: images[0], mode: 'ti2vid' } : {}
  const prompt = images.length > 1 ? referenceMode === 'keyframes' ? withOrderedKeyframes(input.prompt, images.length) : withNumberedReferences(input.prompt, images.length) : input.prompt
  return JSON.stringify({ model: input.model || defaultModel, prompt, ...media, ...settings })
}
function withOrderedKeyframes(prompt: string, count: number) {
  const labels = Array.from({ length: count }, (_, index) => `Image ${index + 1}`).join(' → ')
  return `${prompt}\n\nOrdered chronological keyframes: ${labels}. Begin on Image 1 exactly and end on Image ${count} exactly. Interpolate only the shortest directly visible motion required to transform each image into the next image, strictly in this order. Every supplied image is a mandatory visual state, not a loose style reference. Preserve the exact character count, identity, face, clothing, hairstyle, props, environment, spatial layout, camera axis, lighting, and art style between keyframes. Do not swap, skip, reinterpret, redesign, or move beyond any keyframe. Do not invent intermediate events, extra attacks, gestures, turns, walking, facial performances, idle motion, secondary movement, scene changes, or camera movement unless explicitly required to reach the next supplied image. No action may continue after the final keyframe state is reached.`
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
