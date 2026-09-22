import type { Purpose } from './catalog'
import { modelPurposes } from './model-purpose'
import type { AdminModels, ProviderView } from './admin-api'
export const kinds = { image: '图片', video: '视频', text: '文本' }
export const purposes = { image: '图片生成', video: '视频生成', prompt: '提示词助手', comic: '漫画对话与规划' }
export const adapters: Record<string, string> = { 'openai-image': 'OpenAI 兼容 · 图片', 'openai-video': 'OpenAI 兼容 · 视频', 'agnes-image': 'Agnes · 图片', 'agnes-video': 'Agnes · 视频', 'openai-chat': 'OpenAI 兼容 · Chat Completions' }
export const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
const field = (name: string, title: string, value: unknown = '', options = '') => `<label>${title}<input name="${name}" value="${escape(value)}" ${options}></label>`
export function providerForm(provider?: ProviderView) {
  const reasons: Record<string, string> = { 'rate-limit': '触发限流', quota: '额度不足', authentication: '认证失败' }
  return `${field('name', '连接名称', provider?.name, 'required maxlength="120"')}${field('baseUrl', '接口地址', provider?.baseUrl, 'required type="url" placeholder="https://api.example.com/v1"')}<section class="model-key-section" aria-label="API 密钥池"><h3>API 密钥 <small>最多 32 个</small></h3><p class="model-help">自动轮换可用 Key；限流、额度不足或认证失败时冷却并尝试下一个。</p>${(provider?.keys || []).map((key, index) => `<label class="model-saved-key"><input type="checkbox" name="retainedKeyIds" value="${escape(key.id)}" checked><span>Key ${index + 1}<small>${key.status === 'cooling' ? `${escape(reasons[key.reason || ''] || '暂不可用')} · ${escape(key.cooldownUntil ? new Date(key.cooldownUntil).toLocaleString() : '')} 后可重试` : '可用'}</small></span><small>保留</small></label>`).join('')}${provider?.keys?.length ? '<p class="model-help">取消勾选并保存即可移除。已保存的密钥不回显。</p>' : ''}<div data-new-keys><div class="model-key-input">${field('apiKey', '新增 API 密钥', '', 'type="password" autocomplete="new-password" maxlength="8192" placeholder="无认证的本地接口可留空"')}</div></div><div class="model-key-actions"><button type="button" data-add-key>＋ 添加 Key</button><button type="button" data-reveal>显示密钥</button></div></section><details ${provider?.proxyUrl ? 'open' : ''}><summary>代理设置（可选）</summary>${field('proxyUrl', '代理地址', provider?.proxyUrl, 'type="url" placeholder="http://127.0.0.1:7893"')}</details><label class="model-check"><input name="enabled" type="checkbox" ${provider?.enabled !== false ? 'checked' : ''}>启用连接</label>`
}
export function defaultsForm(state: AdminModels) {
  return `<form data-defaults><div class="model-default-grid">${Object.entries(purposes).map(([purpose, title]) => {
    const id = state.defaults[purpose as Purpose] || ''
    const model = state.models.find(m => m.id === id)
    const provider = state.providers.find(p => p.id === model?.providerId)
    const candidates = state.models.filter(m => m.enabled && modelPurposes(m).includes(purpose as Purpose) && state.providers.some(p => p.id === m.providerId && p.enabled)).sort((a, b) => a.order - b.order)
    const name = id === '@auto' ? '自动分配' : model?.name || '手动选择'
    const detail = id === '@auto' ? (candidates[0]?.name || '等待添加可用模型') : provider?.name || '不指定默认模型'
    return `<div class="model-default-item"><input type="hidden" name="${purpose}" value="${escape(id)}"><button type="button" data-default-purpose="${purpose}" aria-label="选择${title}默认模型"><span class="model-default-label">${title}</span><strong data-default-name>${escape(name)}</strong><small data-default-detail>${escape(detail)}</small><span class="model-default-arrow" aria-hidden="true">↗</span></button></div>`
  }).join('')}</div><div class="model-default-footer"><p>自动分配按模型用途和优先级选择，也可固定指定模型。</p><button type="submit">保存默认分配</button></div></form>`
}
