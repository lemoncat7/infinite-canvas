import { safeModelError } from '../models/errors.js'

/** Extract diagnostic fields only; never echo the body, prompt, URL or credentials. */
export function imageResponseError(status: number, payload: unknown, requestId?: string | null): Error {
  const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const nested = body.error && typeof body.error === 'object' ? body.error as Record<string, unknown> : {}
  const message = [typeof body.error === 'string' ? body.error : '', nested.message, nested.code, body.message].filter(item => typeof item === 'string').join(' ')
  return safeModelError(new Error(message), { status, stage: '图片生成', requestId: requestId || (typeof body.request_id === 'string' ? body.request_id : undefined) })
}
