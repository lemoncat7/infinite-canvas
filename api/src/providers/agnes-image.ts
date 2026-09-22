import { modelFetch } from '../models/network.js'
import { safeModelError } from '../models/errors.js'
import { imageResponseError } from './image-errors.js'
import type { GenerationInput, GenerationProvider, GenerationUpdate } from './types.js'
import { URL_FIRST, prepareReferenceImages, submitWithReferenceFallback } from './reference-transport.js'

type AgnesImageResponse = {
  data?: Array<{ url?: string; b64_json?: string }>
  error?: { message?: string } | string
}

export class AgnesImageProvider implements GenerationProvider {
  readonly name = 'agnes-image'
  referencePolicy(_model: string) { return URL_FIRST }
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly proxyUrl: string
  constructor(config?: { baseUrl: string; apiKey: string; proxyUrl?: string }) {
    this.baseUrl = (config?.baseUrl || required('AGNES_IMAGE_BASE_URL', process.env.AGNES_VIDEO_BASE_URL || 'https://apihub.agnes-ai.com')).replace(/\/$/, '')
    this.apiKey = config ? config.apiKey : required('AGNES_IMAGE_API_KEY', process.env.AGNES_VIDEO_API_KEY)
    this.proxyUrl = config ? config.proxyUrl || '' : process.env.AGNES_IMAGE_HTTPS_PROXY || process.env.AGNES_VIDEO_HTTPS_PROXY || ''
  }
  private readonly timeout = Number(process.env.AGNES_IMAGE_TIMEOUT_MS || 180000)

  async run(input: GenerationInput, onUpdate: (update: GenerationUpdate) => void) {
    if (input.kind !== 'image') throw new Error('Agnes Image Adapter 仅支持图片任务')
    onUpdate({ status:'running', progress:12 })
    const images = await prepareReferenceImages(input, URL_FIRST, { proxyUrl: this.proxyUrl })
    const aspectRatio = normalizedAspectRatio(input.parameters?.size)
    const body = {
      model:input.model || 'agnes-image-2.1-flash', prompt:input.prompt, n:1,
      ...(aspectRatio ? { aspect_ratio:aspectRatio } : {}),
      ...(images.length ? { extra_body:{ image:images, response_format:'url' } } : {}),
    }
    const response = await submitWithReferenceFallback(images, URL_FIRST, async references => {
    let result: Response
    try { result = await modelFetch(`${this.baseUrl}/v1/images/generations`, {
      method:'POST',
      headers:{ authorization:`Bearer ${this.apiKey}`, 'content-type':'application/json' },
      body:JSON.stringify({ ...body, ...(references.length ? { extra_body: { image: references, response_format: 'url' } } : {}) }),
      signal:AbortSignal.timeout(this.timeout),
    }, this.proxyUrl) } catch (error) { throw safeModelError(error, { stage: '图片生成', timeoutMs: this.timeout }) }
    let payload: Record<string, unknown>
    try { payload = await result.json() as Record<string, unknown> }
    catch { throw imageResponseError(result.status, { message: 'Invalid JSON response' }, result.headers.get('x-request-id')) }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw imageResponseError(result.status, { message: 'Invalid JSON response' }, result.headers.get('x-request-id'))
    return { ok: result.ok, status: result.status, payload, requestId: result.headers.get('x-request-id') }
    }, () => prepareReferenceImages(input, URL_FIRST, { proxyUrl: this.proxyUrl, forceEmbedded: true }))
    const payload = response.payload as AgnesImageResponse
    if (!response.ok) throw imageResponseError(response.status, payload, response.requestId)
    const image = payload?.data?.[0]
    const resultUrl = image?.url || (image?.b64_json ? `data:image/png;base64,${image.b64_json}` : undefined)
    if (!resultUrl) throw imageResponseError(response.status, { message: '未返回图片结果' }, response.requestId)
    const result:GenerationUpdate = { status:'succeeded', progress:100, resultUrl }
    onUpdate(result)
    return result
  }

}

function normalizedAspectRatio(value:unknown) {
  const ratios:Record<string,string>={ '1024x1024':'1:1','1536x1024':'3:2','1024x1536':'2:3','1536x864':'16:9','864x1536':'9:16' }
  return ratios[String(value||'')]
}
function required(name:string,fallback?:string) { const value=process.env[name]||fallback; if(!value)throw new Error(`${name} is required when using Agnes image models`); return value }
