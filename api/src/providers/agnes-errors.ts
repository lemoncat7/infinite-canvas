import { ModelConfigError } from '../models/types.js';

type ErrorResponse = { code?: unknown; message?: unknown; data?: { param?: unknown }; error?: string | { message?: unknown; code?: unknown; param?: unknown } | null };
const label = (value: unknown) => typeof value === 'string' && /^[a-zA-Z_][a-zA-Z0-9_.-]{0,63}$/.test(value) ? value : undefined;

/** Preserve diagnostics without returning arbitrary upstream text, URLs or credentials. */
export function agnesResponseError(status: number, task: ErrorResponse, stage: 'create' | 'poll') {
  const nested = task.error && typeof task.error === 'object' ? task.error : undefined;
  const code = label(task.code ?? nested?.code);
  const param = label(task.data?.param ?? nested?.param);
  const message = String(typeof task.error === 'string' ? task.error : nested?.message ?? task.message ?? '');
  const context = `${stage === 'create' ? '提交' : '查询'}视频，HTTP ${status}${code ? `，错误码 ${code}` : ''}${param ? `，字段 ${param}` : ''}`;
  if (status === 400 || status === 422)
    return new ModelConfigError(`模型参数校验失败（${context}）；请检查当前模型的参数格式，不是密钥认证失败`, 422);
  if (/auth_unavailable|no auth available/i.test(message + ' ' + code))
    return new ModelConfigError(`上游模型渠道没有可用认证资源（${context}）；请联系服务商，不代表本地 API Key 填写错误`, 503);
  if (status === 401 || status === 403)
    return new ModelConfigError(`模型服务拒绝认证或权限（${context}）；请检查 Key、模型授权或上游访问限制`, status);
  if (status === 404)
    return new ModelConfigError(`模型或任务不存在（${context}）；请核对模型 ID 和接口地址`, 404);
  if (status === 429 || /queue.*full|队列.*(?:已满|繁忙)/i.test(message))
    return new ModelConfigError(`模型服务限流或队列已满（${context}），请稍后重试`, 429);
  return new ModelConfigError(`模型服务调用失败（${context}）；上游正文已隐藏，请按错误码联系服务商`, status >= 500 ? 502 : 422);
}
