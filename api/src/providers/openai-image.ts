import type { GenerationInput, GenerationProvider, GenerationUpdate } from './types.js'

type ImageResponse = { data?: Array<{ url?: string; b64_json?: string; revised_prompt?: string }>; error?: { message?: string } }

export class OpenAiImageProvider implements GenerationProvider {
  readonly name = 'openai-image'
  private readonly baseUrl: string
  private readonly apiKey: string

  constructor(config?: { baseUrl: string; apiKey: string }) {
    this.baseUrl = (config?.baseUrl || required('OPENAI_IMAGE_BASE_URL')).replace(/\/$/, '')
    this.apiKey = config?.apiKey || required('OPENAI_IMAGE_API_KEY')
  }

  async run(input: GenerationInput, onUpdate: (update: GenerationUpdate) => void) {
    if (input.kind !== 'image') throw new Error('OpenAI Image Adapter 仅支持图片任务')
    onUpdate({ status: 'running', progress: 15 })
    const mode = input.inputUrls?.length ? 'edit' : 'create'
    let response: Response | undefined, payload: ImageResponse | undefined
    for (let attempt = 1; attempt <= 1; attempt++) {
      const startedAt = Date.now()
      response = undefined
      console.info('[image-generation-request]', { stage: 'started', mode, attempt, model: input.model || 'gpt-image-2' })
      try {
        response = input.inputUrls?.length ? await this.edit(input) : await this.create(input)
        console.info('[image-generation-request]', { stage: 'headers', mode, attempt, elapsedMs: Date.now() - startedAt, status: response.status, contentType: response.headers.get('content-type'), contentLength: response.headers.get('content-length') })
        payload = await response.json() as ImageResponse
        const image = payload.data?.[0]
        console.info('[image-generation-request]', { stage: 'body', mode, attempt, elapsedMs: Date.now() - startedAt, status: response.status, keys: Object.keys(payload), dataCount: payload.data?.length ?? 0, imageKeys: image ? Object.keys(image) : [], hasError: Boolean(payload.error) })
        break
      } catch (error) {
        const bodyStage = Boolean(response), timedOut = error instanceof Error && error.name === 'TimeoutError'
        console.error('[image-generation-request]', { stage: bodyStage ? 'body-error' : 'request-error', mode, attempt, elapsedMs: Date.now() - startedAt, status: response?.status, errorName: error instanceof Error ? error.name : 'UnknownError', errorMessage: error instanceof Error ? error.message : String(error) })
        if (bodyStage && timedOut) throw new Error('CPA 已返回响应头，但图片结果传输超时')
        if (timedOut) throw new Error('图片生成请求超时')
        throw error
      }
    }
    if (!response || !payload) throw new Error('图片生成未返回结果')
    if (!response.ok) throw new Error(payload.error?.message || `CPA image API returned ${response.status}`)
    const image = payload.data?.[0]
    const resultUrl = image?.url || (image?.b64_json ? `data:${base64ImageMime(image.b64_json)};base64,${image.b64_json}` : undefined)
    if (!resultUrl) throw new Error('CPA image API did not return data[0].url or data[0].b64_json')
    const result: GenerationUpdate = { status: 'succeeded', progress: 100, resultUrl }
    onUpdate(result)
    return result
  }

  private create(input: GenerationInput) {
    const parameters = input.parameters ?? {}
    console.info('[image-generation]', { mode: 'create', model: input.model || 'gpt-image-2', size: parameters.size ?? 'auto', quality: parameters.quality ?? 'auto' })
    return fetch(`${this.baseUrl}/v1/images/generations`, {
      method: 'POST', headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: input.model || 'gpt-image-2', prompt: input.prompt, n: 1, response_format: 'b64_json', output_format: 'png', ...parameters }), signal: this.timeoutSignal(),
    })
  }

  private async edit(input: GenerationInput) {
    const form = new FormData()
    const parameters = input.parameters ?? {}
    console.info('[image-generation]', { mode: 'edit', model: input.model || 'gpt-image-2', size: parameters.size ?? 'auto', quality: parameters.quality ?? 'auto' })
    form.set('model', input.model || 'gpt-image-2'); form.set('prompt', input.prompt); form.set('n', '1'); form.set('response_format', 'b64_json'); form.set('output_format', 'png')
    for (const [key, value] of Object.entries(parameters)) form.set(key, String(value))
    for (const [index, source] of (input.inputUrls ?? []).entries()) {
      const url = source.startsWith('/api/') ? `http://127.0.0.1:${process.env.PORT ?? 3000}/${source.slice(5)}` : source
      const image = await fetch(url, { signal: AbortSignal.timeout(120000) })
      if (!image.ok) throw new Error(`读取上游图片失败（${image.status}）`)
      const type = image.headers.get('content-type')?.split(';')[0] || 'image/png'
      form.append('image', new Blob([await image.arrayBuffer()], { type }), `input-${index}.${type.split('/')[1] || 'png'}`)
    }
    return fetch(`${this.baseUrl}/v1/images/edits`, { method: 'POST', headers: { authorization: `Bearer ${this.apiKey}` }, body: form, signal: this.timeoutSignal() })
  }

  private timeoutSignal() { return AbortSignal.timeout(Number(process.env.OPENAI_IMAGE_TIMEOUT_MS ?? 180000)) }
}

function base64ImageMime(value: string) {
  const bytes = Buffer.from(value.slice(0, 32), 'base64')
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  if (bytes.subarray(0, 6).toString('ascii').startsWith('GIF8')) return 'image/gif'
  return 'image/png'
}

function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`${name} is required when GENERATION_PROVIDER=openai-image`); return value }
