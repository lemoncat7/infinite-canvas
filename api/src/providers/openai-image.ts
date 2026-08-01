import type { GenerationInput, GenerationProvider, GenerationUpdate } from './types.js'

type ImageResponse = { data?: Array<{ url?: string; b64_json?: string; revised_prompt?: string }>; error?: { message?: string } }

export class OpenAiImageProvider implements GenerationProvider {
  readonly name = 'openai-image'
  private readonly baseUrl = required('OPENAI_IMAGE_BASE_URL').replace(/\/$/, '')
  private readonly apiKey = required('OPENAI_IMAGE_API_KEY')

  async run(input: GenerationInput, onUpdate: (update: GenerationUpdate) => void) {
    if (input.kind !== 'image') throw new Error('OpenAI Image Adapter 仅支持图片任务')
    onUpdate({ status: 'running', progress: 15 })
    const response = input.inputUrls?.length ? await this.edit(input) : await this.create(input)
    const payload = await response.json() as ImageResponse
    if (!response.ok) throw new Error(payload.error?.message || `CPA image API returned ${response.status}`)
    const image = payload.data?.[0]
    const resultUrl = image?.url || (image?.b64_json ? `data:image/png;base64,${image.b64_json}` : undefined)
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

  private timeoutSignal() { return AbortSignal.timeout(Number(process.env.OPENAI_IMAGE_TIMEOUT_MS ?? 600000)) }
}

function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`${name} is required when GENERATION_PROVIDER=openai-image`); return value }
