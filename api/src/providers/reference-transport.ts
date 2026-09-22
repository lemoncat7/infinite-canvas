import sharp from 'sharp'
import { rawModelFetch } from '../models/network.js'
import { ModelConfigError } from '../models/types.js'
import type { GenerationInput, ReferencePolicy } from './types.js'

export const URL_FIRST: ReferencePolicy = { preferred: 'url', fallbackToBase64: true }
export const EMBEDDED_ONLY: ReferencePolicy = { preferred: 'base64', fallbackToBase64: false }

export function isReferenceDownloadFailure(payload: Record<string, unknown>) {
  const error = payload.error as { message?: unknown; code?: unknown } | string | undefined
  const message = `${typeof error === 'string' ? error : error?.message || ''} ${typeof error === 'object' ? error?.code || '' : ''} ${payload.message || ''}`
  return /image_download_(?:interrupted|error|failed)|(?:failed|unable) to (?:download|fetch) (?:the (?:provided )?)?(?:image|reference)|(?:image|reference).{0,60}(?:download failed|fetch failed|unreachable|inaccessible)|invalid_image_url/i.test(message)
}

/** Only a confirmed terminal failure, never an HTTP timeout or unknown task state. */
export function canFallbackTerminalReference(payload: Record<string, unknown>, images: string[]) {
  const data = payload.data as Record<string, unknown> | undefined
  const hasOutput = payload.video || payload.url || payload.video_url || payload.result_url || payload.output_url || payload.output ||
    data?.url || data?.video || data?.video_url || data?.result_url || data?.output_url || data?.output
  return payload.status === 'failed' && !hasOutput &&
    images.some(image => /^https?:\/\//i.test(image)) && isReferenceDownloadFailure(payload)
}

export class ReferenceDownloadFailure extends ModelConfigError {
  constructor(readonly canRetryEmbedded: boolean) {
    super('上游读取参考图片失败（下载中断或图片链接不可达）；不是密钥认证错误', 422)
  }
}

export async function runWithTerminalReferenceFallback<T>(images: string[], run: (images: string[]) => Promise<T>, embed: () => Promise<string[]>) {
  try { return await run(images) }
  catch (error) {
    if (!(error instanceof ReferenceDownloadFailure) || !error.canRetryEmbedded) throw error
    return run(await embed())
  }
}

/** Read owned originals through the caller, not through public DNS or an authenticated asset URL. */
export async function referenceDataUrl(input: GenerationInput, index: number, proxyUrl = '') {
  if (input.readInputAsDataUrl) return input.readInputAsDataUrl(index, proxyUrl)
  const source = input.inputUrls?.[index] || ''
  if (source.startsWith('data:image/')) return source
  const url = source.startsWith('/api/') ? `http://127.0.0.1:${process.env.PORT || 3000}/${source.slice(5)}` : source
  if (!/^https?:\/\//i.test(url)) throw new ModelConfigError('参考图片地址无效')
  let response: Response
  try { response = await rawModelFetch(url, { signal: AbortSignal.timeout(30000) }, source.startsWith('/api/') ? '' : proxyUrl, 30 * 1024 * 1024) }
  catch { throw new ModelConfigError('读取参考图片失败，请检查素材链接或代理', 422) }
  const mime = response.headers.get('content-type')?.split(';')[0] || ''
  if (!response.ok || !mime.startsWith('image/')) throw new ModelConfigError(`参考图未返回有效图片（HTTP ${response.status}）`, 422)
  return `data:${mime};base64,${Buffer.from(await response.arrayBuffer()).toString('base64')}`
}

/** Optional adapter budget: derives a temporary copy, never overwrites the original. */
export async function prepareReferenceImages(input: GenerationInput, policy: ReferencePolicy, options: { forceEmbedded?: boolean; proxyUrl?: string; embeddedBudget?: number } = {}) {
  return Promise.all((input.inputUrls || []).map(async (source, index) => {
    if (!options.forceEmbedded && policy.preferred === 'url' && /^https?:\/\//i.test(source)) return source
    const data = await referenceDataUrl(input, index, options.proxyUrl)
    if (!options.embeddedBudget || Buffer.byteLength(data) <= options.embeddedBudget) return data
    const bytes = Buffer.from(data.slice(data.indexOf(',') + 1), 'base64')
    for (const width of [1024, 768, 512]) {
      const copy = await sharp(bytes).rotate().resize({ width, height: width, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 78 }).toBuffer()
      const embedded = `data:image/jpeg;base64,${copy.toString('base64')}`
      if (Buffer.byteLength(embedded) <= options.embeddedBudget) return embedded
    }
    throw new ModelConfigError('参考图的内嵌副本仍超过接口预算，请使用可访问的图片链接；原图未修改', 413)
  }))
}

/** Only explicit pre-acceptance URL failures permit another submission. */
export function canFallbackReference(status: number, payload: Record<string, unknown>, images: string[]) {
  const data = payload.data as Record<string, unknown> | undefined
  if (![400, 422].includes(status) || !images.some(image => /^https?:\/\//i.test(image))) return false
  if (payload.id || payload.request_id || payload.task_id || payload.video_id || data?.id || data?.task_id || data?.request_id || data?.video_id) return false
  if (/^(queued|pending|running|processing|completed|succeeded|success|done)$/i.test(String(payload.status || data?.status || ''))) return false
  const error = payload.error as { message?: unknown; code?: unknown } | string | undefined
  const text = `${typeof error === 'string' ? error : error?.message || ''} ${typeof error === 'object' ? error?.code || '' : ''} ${payload.message || ''}`
  return /(?:image|reference|图片|图像).{0,100}(?:download|fetch|unreachable|inaccessible|读取失败|下载失败)|(?:download|fetch).{0,60}(?:image|reference)|invalid_image_url/i.test(text)
}

export async function submitWithReferenceFallback<T extends { ok: boolean; status: number; payload: Record<string, unknown> }>(
  images: string[], policy: ReferencePolicy, submit: (images: string[]) => Promise<T>, embed: () => Promise<string[]>,
) {
  const first = await submit(images)
  if (!first.ok && policy.fallbackToBase64 && canFallbackReference(first.status, first.payload, images)) return submit(await embed())
  return first
}
