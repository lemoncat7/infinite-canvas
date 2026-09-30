import { safeModelError } from '../models/errors.js'
import { ModelConfigError } from '../models/types.js'

/** Inspect diagnostic fields, never serialize upstream bodies or echoed inputs. */
export function videoResponseError(status: number, payload: unknown, stage: '视频创建' | '视频执行' | '视频查询', requestId?: string | null): ModelConfigError {
  const messages: string[] = []
  const visit = (value: unknown, depth = 0): void => {
    if (depth > 4) return
    if (typeof value === 'string') { messages.push(value.slice(0, 2000)); return }
    if (Array.isArray(value)) { value.slice(0, 8).forEach(item => visit(item, depth + 1)); return }
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    for (const key of ['error', 'message', 'msg', 'code', 'detail', 'errors', 'data']) visit(record[key], depth + 1)
  }
  visit(payload)
  const diagnostic = messages.join(' ')
  const context = {status, stage, requestId}
  let reason = safeModelError(new Error(diagnostic), context).message
  // Use fixed descriptions: arbitrary upstream messages may echo credentials or prompts.
  if ((status === 400 || status === 422) && /seconds|duration|时长/i.test(diagnostic) && /invalid|unsupported|must|between|range|maximum|minimum|exceed|不支持|必须|范围|超出/i.test(diagnostic)) {
    reason = `视频时长被上游拒绝，请核对当前模型支持的秒数（HTTP ${status}；阶段：${stage}）`
  } else if ((status === 400 || status === 422) && /resolution|aspect_ratio|分辨率|画幅/i.test(diagnostic) && /invalid|unsupported|must|不支持|无效/i.test(diagnostic)) {
    reason = `视频分辨率或画幅被上游拒绝，请核对当前模型支持的参数（HTTP ${status}；阶段：${stage}）`
  }
  return new ModelConfigError(`${reason}；未自动重复提交生成任务`, status)
}
