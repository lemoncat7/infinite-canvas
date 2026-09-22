import { ModelConfigError } from './types.js'
/** Preserve retry classification without exposing upstream bodies or credentials. */
export function safeModelError(error: unknown): Error {
  if (error instanceof ModelConfigError) return error
  const message = error instanceof Error ? error.message : String(error)
  if (/video queue is full|queue full|queue is full|server queue.*full|队列.*(?:已满|繁忙)/i.test(message))
    return new Error('模型服务队列已满，请稍后重试')
  if (/forbidden field|extra inputs are not permitted/i.test(message))
    return new Error('模型参数校验失败：请求包含该模型不支持的字段；请检查模型适配，不是密钥认证失败')
  if (/auth_unavailable|no auth available/i.test(message))
    return new Error('上游模型渠道没有可用认证资源，请联系服务商；不代表本地 API Key 填写错误')
  if (/forbidden|\b403\b/i.test(message))
    return new Error('模型或接口访问被拒绝（HTTP 403），请检查模型权限、IP 或服务商策略；不代表整个 Key 已失效')
  if (/unauthori[sz]ed|\b401\b/i.test(message))
    return new Error('模型服务认证失败，请管理员检查密钥和权限')
  if (/unexpected EOF|ETIMEDOUT|timeout|timed out|aborted due to timeout|backend-api\/codex\/images/i.test(message))
    return new Error('模型调用 timeout；请确认上游任务状态后重试')
  if (/ECONNRESET|ECONNREFUSED|fetch failed|socket|network|temporar|HTTP\/2 stream.*not closed cleanly|curl:\s*\(18\)|502|503|504/i.test(message))
    return new Error('模型服务 network 暂时不可用，请稍后重试')
  return new Error('模型调用失败，请管理员检查连接或重试；上游错误正文已隐藏')
}
