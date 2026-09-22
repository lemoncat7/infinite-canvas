import { ModelConfigError } from './types.js'
export type ModelErrorContext = {
  status?: number
  stage?: '图片生成' | '参考图片读取' | '生成结果校验'
  timeoutMs?: number
  requestId?: string | null
}
class SafeModelCallError extends Error {}
/** Preserve retry classification without exposing upstream bodies or credentials. */
export function safeModelError(error: unknown, context: ModelErrorContext = {}): Error {
  if (error instanceof ModelConfigError || error instanceof SafeModelCallError) return error
  const cause = error instanceof Error ? error.cause : undefined
  const message = [error instanceof Error ? error.message : String(error), cause instanceof Error ? `${cause.name} ${cause.message}` : ''].join(' ')
  const requestId = context.requestId || message.match(/request[ _-]?id\s*[:：]?\s*([a-zA-Z0-9_-]{8,128})\b/i)?.[1]
  const details = [context.status && Number.isInteger(context.status) && context.status >= 100 && context.status <= 599 ? `HTTP ${context.status}` : '', context.stage ? `阶段：${context.stage}` : '', requestId && /^(?:[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}|req_[a-zA-Z0-9_-]{8,100})$/i.test(requestId) ? `Request ID: ${requestId}` : ''].filter(Boolean)
  const result = (text: string) => new SafeModelCallError(`${text}${details.length ? `（${details.join('；')}）` : ''}`)
  if (/safety system|content.?policy|safety_violations?|moderation_blocked|安全(?:审核|检查)|内容政策/i.test(message))
    return result('上游安全审核拒绝：提示词或参考图片未通过审核；上游未说明具体触发项')
  if (context.stage === '参考图片读取')
    return result(/timeout|timed out|超时/i.test(message) || error instanceof Error && error.name === 'TimeoutError' ? '参考图片读取超时；尚未提交图片生成请求' : '参考图片读取失败；尚未提交图片生成请求')
  if (/透明背景验收失败/.test(message)) return result('透明背景验收失败：模型返回的图片不含有效 Alpha 通道')
  if (/video queue is full|queue full|queue is full|server queue.*full|队列.*(?:已满|繁忙)/i.test(message))
    return result('模型服务队列已满，请稍后重试')
  if (/insufficient_quota|quota.?exceeded|billing|额度不足|余额不足/i.test(message)) return result('模型服务额度不足；请检查服务商余额或配额')
  if (context.status === 429 || /rate.?limit|too many requests/i.test(message)) return result('模型服务请求过于频繁（HTTP 429）；请稍后重试')
  if (/forbidden field|extra inputs are not permitted/i.test(message))
    return result('模型参数校验失败：请求包含该模型不支持的字段；请检查模型适配，不是密钥认证失败')
  if (/auth_unavailable|no auth available/i.test(message))
    return result('上游模型渠道没有可用认证资源，请联系服务商；不代表本地 API Key 填写错误')
  if (context.status === 403 || /forbidden|\b403\b/i.test(message))
    return result('模型或接口访问被拒绝（HTTP 403），请检查模型权限、IP 或服务商策略；不代表整个 Key 已失效')
  if (context.status === 401 || /unauthori[sz]ed|\b401\b/i.test(message))
    return result('模型服务认证失败，请管理员检查密钥和权限')
  if (/\bEOF\b|ECONNRESET|socket hang up|other side closed/i.test(message))
    return result('上游连接中断（network）：连接在返回完整结果前被关闭；不能确认上游任务是否完成')
  if (error instanceof Error && error.name === 'TimeoutError' || /ETIMEDOUT|timeout|timed out|aborted due to timeout|超时/i.test(message))
    return result(`模型等待超时（timeout）${context.timeoutMs && Number.isFinite(context.timeoutMs) ? `：已达到本次请求 ${Math.ceil(context.timeoutMs / 1000)} 秒等待上限` : ''}；未收到完整结果，请先确认上游任务状态，避免重复提交`)
  if (/ECONNRESET|ECONNREFUSED|fetch failed|socket|network|temporar|HTTP\/2 stream.*not closed cleanly|curl:\s*\(18\)|502|503|504/i.test(message))
    return result('模型服务网络连接失败（network）；请检查服务商连接与代理')
  if (context.status && context.status >= 500) return result('上游生成服务异常；请稍后检查服务状态')
  if (context.status === 400 || context.status === 422) return result('上游拒绝生成请求；请检查模型参数与输入要求，未获得更具体的失败原因')
  if (context.status === 404) return result('模型或接口不存在；请检查模型 ID 与接口地址')
  if (/未返回图片结果|未返回结果|did not return data|Unexpected token|JSON/i.test(message)) return result('模型响应格式异常：未获得可用图片结果')
  return result('模型调用失败，未获得可识别的错误原因；上游错误正文已隐藏')
}
