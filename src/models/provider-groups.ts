import type { AdminModels } from './admin-api'
import { escape, kinds, purposes } from './admin-views'
import { modelPurposes } from './model-purpose'

/** One ownership hierarchy: connection → models. Filtering never moves models between providers. */
export function providerGroups(state: AdminModels, query: string, kind: string) {
  const search = query.trim().toLowerCase()
  const groups = state.providers.map(provider => {
    const own = state.models.filter(model => model.providerId === provider.id)
    const providerMatches = `${provider.name} ${provider.baseUrl}`.toLowerCase().includes(search)
    const models = own.filter(model => (!kind || model.kind === kind) && (providerMatches || `${model.name} ${model.model}`.toLowerCase().includes(search)))
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    if ((!providerMatches && !models.length) || (kind && !models.length)) return ''
    const cooling = provider.keys?.filter(key => key.status === 'cooling').length || 0
    const count = provider.keyCount ?? (provider.hasKey ? 1 : 0)
    return `<article class="model-provider-group" data-provider="${escape(provider.id)}" aria-label="${escape(provider.name)}">
      <header class="model-provider-row"><span class="model-provider-monogram" aria-hidden="true">${escape(provider.name.slice(0, 1).toUpperCase())}</span><div class="model-provider-title"><h3>${escape(provider.name)}</h3><small>${escape(provider.baseUrl)}</small><div class="model-provider-meta"><span>${provider.enabled ? '已启用' : '已停用'}</span><span>${own.length} 个模型</span><span>${count} Key${cooling ? ` · ${cooling} 冷却中` : ''}</span></div></div><div class="model-provider-actions"><button type="button" data-edit-provider="${escape(provider.id)}">连接配置</button><button type="button" data-discover="${escape(provider.id)}">添加模型</button></div></header>
      <div class="model-provider-models">${models.map(model => `<section class="model-entry" data-model-entry="${escape(model.id)}"><div class="model-owned-row"><div class="model-model-title"><strong>${escape(model.name)}</strong><small>${escape(model.model)}</small></div><div class="model-model-purpose"><span class="model-kind">${kinds[model.kind]}</span>${modelPurposes(model).map(p => `<span>${purposes[p]}</span>`).join('') || '<span>未分配用途</span>'}</div><div class="model-metric"><small>优先级</small><strong>${model.order}</strong></div><div class="model-metric"><small>计费 / 次</small><strong>${model.creditCost ? `${model.creditCost} 点` : '免费'}</strong></div><button type="button" data-edit-model="${escape(model.id)}" aria-expanded="false" aria-label="配置 ${escape(model.name)}">配置</button></div><div class="model-entry-status">${model.enabled && provider.enabled ? '' : '<span>已停用</span>'}${Object.entries(state.defaults).filter(([, id]) => id === model.id).map(([p]) => `<span>${purposes[p as keyof typeof purposes]}默认</span>`).join('')}</div><div data-model-editor></div></section>`).join('') || '<p class="model-group-empty">连接已就绪，添加此服务商提供的模型。</p>'}</div>
      <div data-new-model-editor></div>
      <footer><button type="button" data-add-model="${escape(provider.id)}">手动添加模型</button></footer>
    </article>`
  }).join('')
  return groups || `<p class="model-empty">${state.providers.length ? '没有匹配的服务商或模型，请调整搜索条件。' : '还没有服务商。点击“添加服务商”配置接口地址和 Key，再选择模型。'}</p>`
}
