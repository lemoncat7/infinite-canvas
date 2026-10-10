import type { AdminModels } from './admin-api'
import { escape, kinds } from './admin-views'

export function workspaceLayout() {
  return `<header><h1>全局模型</h1><div class="model-header-actions"><button type="button" data-settings aria-pressed="false">默认与并发</button><button type="button" data-close>返回画布</button></div></header>
    <output class="model-feedback model-workspace-feedback" aria-live="polite"></output>
    <div class="model-browser" data-browser>
      <aside class="model-navigation"><div class="model-nav-heading">服务商</div><nav aria-label="选择服务商" data-provider-nav></nav><button type="button" data-new>＋ 添加服务商</button></aside>
      <div class="model-page-body">
        <div class="model-toolbar"><label class="model-mobile-provider">服务商<select data-provider-select aria-label="选择服务商"></select></label><input type="search" aria-label="搜索服务商或模型" placeholder="搜索服务商或模型" data-search><div class="model-kind-filters" aria-label="筛选模型类型"><button type="button" data-kind="" aria-pressed="true">全部</button>${Object.entries(kinds).map(([key, title]) => `<button type="button" data-kind="${key}" aria-pressed="false">${title}</button>`).join('')}</div><button type="button" data-refresh>刷新</button><button type="button" class="model-mobile-new" data-new>＋ 服务商</button></div>
        <section data-content aria-label="服务商与模型"></section>
      </div>
    </div>
    <div class="model-settings-page" data-settings-page hidden><header><h2 tabindex="-1">默认与并发</h2><p>全平台共用，保存后用于新请求。</p></header><section data-default-area aria-label="默认分配"></section><section data-concurrency-area aria-label="生成并发"></section></div>`
}

/** Navigation presentation only; model editing and persistence stay in their controllers. */
export function renderProviderNavigation(page: HTMLElement, state: AdminModels, selected: string) {
  const items = [{ id: '', name: '全部模型', count: state.models.length }, ...state.providers.map(p => ({ id: p.id, name: p.name, count: state.models.filter(m => m.providerId === p.id).length }))]
  page.querySelector('[data-provider-nav]')!.innerHTML = items.map(p => `<button type="button" data-select-provider="${escape(p.id)}" aria-pressed="${selected === p.id}"><span>${escape(p.name)}</span><small>${p.count}</small></button>`).join('')
  page.querySelector('[data-provider-select]')!.innerHTML = items.map(p => `<option value="${escape(p.id)}" ${selected === p.id ? 'selected' : ''}>${escape(p.name)} (${p.count})</option>`).join('')
}
