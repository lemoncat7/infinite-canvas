import { ModelConfigError } from './types.js'
/** Preserve retry classification without exposing upstream bodies or credentials. */
export function safeModelError(error: unknown): Error {
  if (error instanceof ModelConfigError) return error
  const message = error instanceof Error ? error.message : String(error)
  if (/video queue is full|queue full|queue is full|server queue.*full|队列.*(?:已满|繁忙)/i.test(message))
    return new Error('模型服务队列已满，请稍后重试')
  if (/auth_unavailable|no auth available|unauthori[sz]ed|forbidden|\b401\b|\b403\b/i.test(message))
    return new Error('模型服务认证失败，请管理员检查密钥和权限')
  if (/unexpected EOF|ETIMEDOUT|timeout|timed out|aborted due to timeout|backend-api\/codex\/images/i.test(message))
    return new Error('模型调用 timeout；请确认上游任务状态后重试')
  if (/ECONNRESET|ECONNREFUSED|fetch failed|socket|network|temporar|HTTP\/2 stream.*not closed cleanly|curl:\s*\(18\)|502|503|504/i.test(message))
    return new Error('模型服务 network 暂时不可用，请稍后重试')
  return new Error('模型调用失败，请管理员检查连接或重试；上游错误正文已隐藏')
}
