import type { GenerationInput, GenerationProvider, GenerationStatus, GenerationUpdate } from './types.js'

type RemotePayload = Record<string, unknown>

export class CustomApiGenerationProvider implements GenerationProvider {
  readonly name = 'custom-api'
  private readonly baseUrl = required('CUSTOM_GENERATION_BASE_URL').replace(/\/$/, '')
  private readonly submitPath = process.env.CUSTOM_GENERATION_SUBMIT_PATH ?? '/generations'
  private readonly statusPath = process.env.CUSTOM_GENERATION_STATUS_PATH ?? '/generations/{id}'
  private readonly apiKey = process.env.CUSTOM_GENERATION_API_KEY ?? ''
  private readonly pollInterval = Number(process.env.CUSTOM_GENERATION_POLL_INTERVAL_MS ?? 1200)
  private readonly timeout = Number(process.env.CUSTOM_GENERATION_TIMEOUT_MS ?? 600000)

  async run(input: GenerationInput, onUpdate: (update: GenerationUpdate) => void) {
    const submitted = await this.request(this.submitPath, {
      method: 'POST',
      body: JSON.stringify({
        type: input.kind,
        prompt: input.prompt,
        model: input.model,
        inputUrls: input.inputUrls ?? [],
        parameters: input.parameters ?? {},
        callbackMetadata: { internalJobId: input.internalJobId, projectId: input.projectId, nodeId: input.nodeId },
      }),
    })
    const remoteId = stringValue(submitted.id) ?? stringValue(submitted.taskId) ?? stringValue(nested(submitted, 'data', 'id'))
    if (!remoteId) throw new Error('Custom generation API did not return id or taskId')
    const startedAt = Date.now()
    while (Date.now() - startedAt < this.timeout) {
      const update = normalize(await this.request(this.statusPath.replace('{id}', encodeURIComponent(remoteId))))
      onUpdate(update)
      if (update.status === 'succeeded') {
        if (!update.resultUrl) throw new Error('Custom generation API succeeded without resultUrl')
        return update
      }
      if (update.status === 'failed') throw new Error(update.error ?? 'Custom generation API task failed')
      await wait(this.pollInterval)
    }
    throw new Error(`Custom generation API timed out after ${this.timeout}ms`)
  }

  private async request(path: string, init: RequestInit = {}) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000)
    try {
      const response = await fetch(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`, {
        ...init,
        signal: controller.signal,
        headers: { 'content-type': 'application/json', ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}), ...(init.headers as Record<string, string> | undefined) },
      })
      if (!response.ok) throw new Error(`Custom generation API returned ${response.status}: ${await response.text()}`)
      return await response.json() as RemotePayload
    } finally { clearTimeout(timer) }
  }
}

function normalize(payload: RemotePayload): GenerationUpdate {
  const rawStatus = String(payload.status ?? nested(payload, 'data', 'status') ?? 'running').toLowerCase()
  const status: GenerationStatus = ['success', 'succeeded', 'completed', 'done'].includes(rawStatus) ? 'succeeded' : ['failed', 'error', 'cancelled', 'canceled'].includes(rawStatus) ? 'failed' : ['queued', 'pending'].includes(rawStatus) ? 'queued' : 'running'
  const progressValue = Number(payload.progress ?? nested(payload, 'data', 'progress') ?? (status === 'succeeded' ? 100 : 0))
  return { status, progress: Math.max(0, Math.min(100, Number.isFinite(progressValue) ? progressValue : 0)), resultUrl: stringValue(payload.resultUrl) ?? stringValue(payload.result_url) ?? stringValue(nested(payload, 'data', 'resultUrl')) ?? stringValue(nested(payload, 'data', 'result_url')) ?? stringValue(nested(payload, 'output', 'url')), error: stringValue(payload.error) ?? stringValue(payload.message) }
}
function nested(value: RemotePayload, first: string, second: string) { const child = value[first]; return child && typeof child === 'object' ? (child as RemotePayload)[second] : undefined }
function stringValue(value: unknown) { return typeof value === 'string' && value ? value : undefined }
function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`${name} is required when GENERATION_PROVIDER=custom-api`); return value }
const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))
