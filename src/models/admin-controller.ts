import { loadModelCatalog, type Purpose } from './catalog'
import { modelRequest, type AdminModels } from './admin-api'
import { defaultsForm, escape, kinds, providerForm, purposes } from './admin-views'
import { providerGroups } from './provider-groups'
import { bindEditorDiscovery } from './editor-discovery'
import { bindProviderKeys, providerDraft } from './provider-editor'
import { chooseModel } from './model-picker'
import { modelPurposes } from './model-purpose'
import { bindInlineModelForm, inlineModelDraft, inlineModelForm } from './inline-model-editor'
import { bindKeyVerification } from './key-verification'

export class AdminModelController {
  private readonly page = document.createElement('dialog')
  private readonly editor = document.createElement('dialog')
  private state?: AdminModels
  private busy = false
  private providerDirty = false
  private inline?: { form: HTMLFormElement; dirty: boolean }
  private defaultsDirty = false
  private loadVersion = 0
  private filter = ''
  private readonly collapsedProviders = new Set<string>()
  constructor(private readonly options: { isAdmin(): boolean; closeUserMenu(): void }) {
    this.page.className = 'model-workspace'
    this.page.setAttribute('aria-label', '全局模型管理')
    this.page.innerHTML = `<header><div><h1>全局模型</h1><p>服务商连接、模型用途与计费，在这里统一管理。</p></div><button type="button" data-close>返回画布</button></header><div class="model-page-body"><output class="model-feedback" aria-live="polite"></output><section data-default-area aria-label="默认分配"></section><div class="model-section-heading"><div><h2>服务商</h2><p>一个连接，管理多个模型。</p></div><button type="button" class="model-primary" data-new>＋ 添加服务商</button></div><div class="model-toolbar"><input type="search" aria-label="搜索服务商或模型" placeholder="搜索服务商或模型" data-search><div class="model-kind-filters" aria-label="筛选模型类型"><button type="button" data-kind="" aria-pressed="true">全部</button>${Object.entries(kinds).map(([key, title]) => `<button type="button" data-kind="${key}" aria-pressed="false">${title}</button>`).join('')}</div><button type="button" data-refresh>刷新</button></div><section data-content aria-label="服务商与模型"></section></div>`
    this.editor.className = 'model-editor'
    this.editor.setAttribute('aria-label', '服务商配置')
    document.body.append(this.page, this.editor)
    this.page.addEventListener('cancel', event => { event.preventDefault(); void this.closePage() })
    this.page.addEventListener('click', event => {
      const button = (event.target as Element).closest<HTMLButtonElement>('button')
      if (!button || this.busy) return
      if (button.hasAttribute('data-close')) void this.closePage()
      if (button.hasAttribute('data-refresh')) void this.refresh()
      if (button.hasAttribute('data-new')) this.editProvider()
      if (button.dataset.toggleModels) {
        const id = button.dataset.toggleModels
        if (button.getAttribute('aria-expanded') === 'true') this.collapsedProviders.add(id)
        else this.collapsedProviders.delete(id)
        this.setProviderExpanded(button.closest<HTMLElement>('[data-provider]')!, !this.collapsedProviders.has(id))
      }
      if (button.dataset.editProvider) this.editProvider(button.dataset.editProvider)
      if (button.dataset.editModel) void this.editModel(button.dataset.editModel)
      if (button.dataset.discover) void this.discover(button.dataset.discover)
      if (button.dataset.addModel) void this.editModel(undefined, button.dataset.addModel)
      if (button.dataset.defaultPurpose) void this.pickDefault(button.dataset.defaultPurpose as Purpose)
      if (button.hasAttribute('data-kind')) {
        this.filter = button.dataset.kind || ''
        this.page.querySelectorAll('[data-kind]').forEach(b => b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.kind === this.filter)))
        this.filterContent()
      }
    })
    this.page.querySelector('[data-search]')!.addEventListener('input', () => this.filterContent())
    this.editor.addEventListener('cancel', event => { event.preventDefault(); void this.closeProvider() })
    this.page.addEventListener('close', () => { this.loadVersion++; this.state = undefined; this.inline = undefined; this.defaultsDirty = false; this.page.querySelector('[data-content]')!.replaceChildren() })
  }
  async open() {
    if (!this.options.isAdmin() || this.page.open) return
    this.options.closeUserMenu(); this.page.showModal(); await this.load()
  }
  close() { this.editor.close(); this.editor.replaceChildren(); this.page.close(); this.state = undefined }
  private async closePage() {
    if (this.busy || !(await this.discardDrafts())) return
    this.page.close()
  }
  private async refresh() { if (!this.busy && await this.discardDrafts()) await this.load() }
  private async discardDrafts() {
    if ((this.inline?.dirty || this.defaultsDirty) && !(await this.confirm('放弃未保存的修改？', '模型或默认分配尚未保存。'))) return false
    this.inline = undefined; this.defaultsDirty = false; return true
  }
  private async load() {
    if (this.busy) return
    const version = ++this.loadVersion
    this.feedback('正在读取配置…')
    try {
      const state = await modelRequest<AdminModels>('/admin/models')
      if (version !== this.loadVersion || !this.page.open || !this.options.isAdmin()) return
      this.state = state; this.render(); this.feedback(''); await loadModelCatalog()
    } catch (error) { if (version === this.loadVersion && this.page.open) this.feedback((error as Error).message, true) }
  }
  private feedback(message: string, error = false) {
    const output = this.page.querySelector<HTMLOutputElement>('output')!
    output.textContent = message; output.classList.toggle('is-error', error)
  }
  private render() {
    if (!this.state) return
    const defaults = this.page.querySelector<HTMLElement>('[data-default-area]')!
    defaults.innerHTML = `<div class="model-default-heading"><h2>默认分配</h2><span>新请求生效</span></div>${defaultsForm(this.state)}`
    defaults.querySelector('form')!.addEventListener('submit', event => {
      event.preventDefault()
      if (this.inline?.dirty) { this.feedback('请先保存或取消正在编辑的模型。', true); return }
      void this.save('/admin/model-defaults', 'PUT', { defaults: Object.fromEntries(new FormData(event.target as HTMLFormElement)) })
    })
    this.page.querySelector('[data-content]')!.innerHTML = providerGroups(this.state, '', '') + '<p class="model-empty" data-filter-empty hidden>没有匹配的服务商或模型，请调整搜索条件。</p>'
    this.page.querySelectorAll<HTMLElement>('[data-provider]').forEach((group, index) => {
      const list = group.querySelector<HTMLElement>('.model-provider-models')!
      list.id = `provider-model-list-${index}`
      const toggle = document.createElement('button')
      toggle.type = 'button'; toggle.dataset.toggleModels = group.dataset.provider
      toggle.setAttribute('aria-controls', list.id)
      group.querySelector('.model-provider-actions')!.prepend(toggle)
    })
    this.filterContent()
  }
  private setProviderExpanded(group: HTMLElement, expanded: boolean) {
    const button = group.querySelector<HTMLButtonElement>('[data-toggle-models]')!
    button.setAttribute('aria-expanded', String(expanded))
    button.innerHTML = `<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>${expanded ? '收起模型' : '展开模型'}`
    group.classList.toggle('is-collapsed', !expanded)
    group.querySelectorAll<HTMLElement>(':scope > .model-provider-models, :scope > [data-new-model-editor], :scope > footer').forEach(el => { el.hidden = !expanded })
  }
  private filterContent() {
    if (!this.state) return
    const query = this.page.querySelector<HTMLInputElement>('[data-search]')!.value.trim().toLowerCase()
    for (const group of this.page.querySelectorAll<HTMLElement>('[data-provider]')) {
      const provider = this.state.providers.find(p => p.id === group.dataset.provider)!
      const match = `${provider.name} ${provider.baseUrl}`.toLowerCase().includes(query)
      let visible = 0
      for (const row of group.querySelectorAll<HTMLElement>('[data-model-entry]')) {
        const model = this.state.models.find(m => m.id === row.dataset.modelEntry)!
        const editing = !!this.inline && row.contains(this.inline.form)
        row.hidden = !editing && ((!match && !`${model.name} ${model.model}`.toLowerCase().includes(query)) || (!!this.filter && model.kind !== this.filter))
        if (!row.hidden) visible++
      }
      group.hidden = !visible && !(this.inline && group.contains(this.inline.form)) && (!match || !!this.filter)
      this.setProviderExpanded(group, !!query || !!this.filter || !this.collapsedProviders.has(provider.id))
    }
    const empty = this.page.querySelector<HTMLElement>('[data-filter-empty]')
    if (empty) empty.hidden = !this.state.providers.length || [...this.page.querySelectorAll<HTMLElement>('[data-provider]')].some(el => !el.hidden)
  }
  private async pickDefault(purpose: Purpose) {
    if (!this.state) return
    if (this.inline?.dirty) { this.feedback('请先保存或取消模型修改，再调整默认分配。', true); return }
    const state = this.state, version = this.loadVersion
    const input = this.page.querySelector<HTMLInputElement>(`[data-defaults] [name=${purpose}]`)!
    const candidates = state.models.filter(m => m.enabled && modelPurposes(m).includes(purpose) && state.providers.some(p => p.id === m.providerId && p.enabled)).sort((a, b) => a.order - b.order)
    const choices = [{ value: '@auto', title: '自动分配', detail: '按用途和优先级，选择已启用的模型' }, { value: '', title: '手动选择', detail: '不指定默认模型' }, ...candidates.map(m => ({ value: m.id, title: m.name, detail: `${state.providers.find(p => p.id === m.providerId)?.name} · 优先级 ${m.order} · ${m.creditCost ? m.creditCost + ' 点 / 次' : '免费'}` }))]
    const selected = await chooseModel(`选择${purposes[purpose]}默认模型`, choices, input.value)
    if (selected === undefined || version !== this.loadVersion || !this.page.open) return
    input.value = selected; this.defaultsDirty = true
    const button = input.parentElement!.querySelector('button')!, choice = choices.find(c => c.value === selected)!
    button.querySelector('[data-default-name]')!.textContent = choice.title
    button.querySelector('[data-default-detail]')!.textContent = choice.detail
  }
  private async save(path: string, method: string, body: Record<string, unknown>, form?: HTMLFormElement) {
    if (this.busy || !this.state) return
    this.busy = true
    const controls = [...this.page.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button,input,select'), ...this.editor.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button,input,select')]
    const disabled = controls.map(control => control.disabled)
    controls.forEach(control => control.disabled = true)
    const output = form?.querySelector<HTMLOutputElement>('output')
    if (output) { output.textContent = '正在保存…'; output.classList.remove('is-error') }
    this.feedback('正在保存…')
    try {
      this.state = await modelRequest<AdminModels>(path, method, { ...body, revision: this.state.revision })
      if (!this.page.open || !this.options.isAdmin()) { this.state = undefined; return }
      this.inline = undefined; this.providerDirty = false; this.defaultsDirty = false
      if (form && this.editor.contains(form)) { this.editor.close(); this.editor.replaceChildren() }
      this.render(); this.feedback('已保存，新请求立即生效。')
      await loadModelCatalog().catch(() => this.feedback('配置已保存，模型目录刷新失败，请点击刷新。', true))
    } catch (error) {
      this.feedback((error as Error).message, true)
      if (output) { output.textContent = (error as Error).message; output.classList.add('is-error'); output.focus() }
    } finally { this.busy = false; controls.forEach((control, index) => control.disabled = disabled[index]) }
  }
  private editProvider(id?: string) {
    if (!this.state || this.busy) return
    if (this.inline?.dirty || this.defaultsDirty) { this.feedback('请先保存或取消模型和默认分配的修改。', true); return }
    const provider = this.state.providers.find(p => p.id === id)
    this.providerDirty = false
    this.editor.innerHTML = `<header><div><h2>${id ? '连接配置' : '添加服务商'}</h2><p>连接信息供此服务商下的所有模型共用。</p></div><button type="button" data-cancel aria-label="关闭编辑">×</button></header><form><output tabindex="-1" aria-live="polite" class="model-feedback"></output><fieldset>${providerForm(provider)}</fieldset><footer><button type="button" data-cancel>取消</button><button type="submit" class="model-primary">保存服务商</button></footer></form>`
    const form = this.editor.querySelector('form')!
    bindProviderKeys(form); bindEditorDiscovery(form, 'provider', provider?.id)
    bindKeyVerification(form, provider, () => {
      const group = [...this.page.querySelectorAll<HTMLElement>('[data-provider]')].find(el => el.dataset.provider === provider?.id)
      const summary = group?.querySelector('.model-provider-meta > span:last-child')
      const cooling = provider?.keys?.filter(key => key.status === 'cooling').length || 0
      if (summary) summary.textContent = `${provider?.keyCount ?? provider?.keys?.length ?? 0} Key${cooling ? ` · ${cooling} 冷却中` : ''}`
    })
    form.addEventListener('input', () => this.providerDirty = true)
    form.addEventListener('submit', event => { event.preventDefault(); void this.save(`/admin/model-providers${id ? '/' + encodeURIComponent(id) : ''}`, id ? 'PUT' : 'POST', providerDraft(form), form) })
    this.editor.querySelectorAll('[data-cancel]').forEach(button => button.addEventListener('click', () => void this.closeProvider()))
    this.editor.showModal()
  }
  private async closeProvider() {
    if (this.busy || (this.providerDirty && !(await this.confirm('放弃未保存的修改？', '服务商连接尚未保存。')))) return
    this.editor.close(); this.editor.replaceChildren(); this.providerDirty = false
  }
  private async editModel(id?: string, providerId?: string, upstreamId = '') {
    if (!this.state || this.busy) return
    if (this.defaultsDirty) { this.feedback('请先保存默认分配，再编辑模型。', true); return }
    if (this.inline?.dirty && !(await this.confirm('放弃未保存的模型修改？', '当前模型尚未保存。'))) return
    const previous = this.inline?.form.closest<HTMLElement>('[data-model-entry]')
    if (id && previous?.dataset.modelEntry === id) {
      this.inline!.form.remove(); this.inline = undefined
      previous.querySelector('[data-edit-model]')!.setAttribute('aria-expanded', 'false')
      this.filterContent(); return
    }
    this.inline?.form.remove(); this.inline = undefined
    this.page.querySelectorAll('[data-edit-model]').forEach(b => b.setAttribute('aria-expanded', 'false'))
    const model = this.state.models.find(m => m.id === id), connection = providerId || model?.providerId
    if (!connection) return
    const group = [...this.page.querySelectorAll<HTMLElement>('[data-provider]')].find(el => el.dataset.provider === connection)!
    this.collapsedProviders.delete(connection)
    const row = id ? [...group.querySelectorAll<HTMLElement>('[data-model-entry]')].find(el => el.dataset.modelEntry === id) : undefined
    const host = (row || group).querySelector<HTMLElement>(row ? '[data-model-editor]' : '[data-new-model-editor]')!
    row?.querySelector('[data-edit-model]')?.setAttribute('aria-expanded', 'true')
    host.innerHTML = inlineModelForm(this.state, connection, model, upstreamId)
    const form = host.querySelector('form')!
    bindInlineModelForm(form, !model); this.inline = { form, dirty: false }
    form.addEventListener('input', () => { if (this.inline) this.inline.dirty = true })
    form.addEventListener('submit', event => { event.preventDefault(); void this.save(`/admin/models${id ? '/' + encodeURIComponent(id) : ''}`, id ? 'PUT' : 'POST', inlineModelDraft(form), form) })
    form.querySelector('[data-model-test]')?.addEventListener('click', () => void this.testModel(id!, form))
    form.querySelector('[data-inline-cancel]')!.addEventListener('click', async () => {
      if (this.busy || (this.inline?.dirty && !(await this.confirm('放弃未保存的模型修改？', '当前模型尚未保存。')))) return
      form.remove(); this.inline = undefined; row?.querySelector('[data-edit-model]')?.setAttribute('aria-expanded', 'false'); this.filterContent()
    })
    this.filterContent(); form.scrollIntoView({ block: 'nearest' }); form.querySelector<HTMLInputElement>('[name=name]')!.focus({ preventScroll: true })
  }
  private async discover(id: string) {
    if (this.busy || !this.state) return
    if (this.inline?.dirty || this.defaultsDirty) { this.feedback('请先保存或取消当前修改，再添加模型。', true); return }
    const version = this.loadVersion
    this.busy = true; this.feedback('正在读取服务商模型列表…')
    try {
      const result = await modelRequest<{ models: string[] }>(`/admin/model-providers/${encodeURIComponent(id)}/discover`, 'POST', {})
      if (!this.page.open || !this.options.isAdmin() || version !== this.loadVersion) return
      const selected = await chooseModel('添加模型', result.models.map(model => ({ value: model, title: model, detail: this.state!.models.some(m => m.providerId === id && m.model === model) ? '已添加 · 可配置另一个用途或协议' : '选择后配置用途、优先级与计费' })))
      this.busy = false; this.feedback('')
      if (selected !== undefined) await this.editModel(undefined, id, selected)
    } catch (error) { this.feedback((error as Error).message, true) }
    finally { this.busy = false }
  }
  private async testModel(id: string, form: HTMLFormElement) {
    if (this.busy || !(await this.confirm('开始实际生成测试？', '使用已保存的模型配置，可能产生服务商费用；不扣用户创作点数，不写入画布。'))) return
    this.busy = true
    const output = form.querySelector('output')!; output.textContent = '正在测试生成…'
    try { const result = await modelRequest<{ message: string }>(`/admin/models/${encodeURIComponent(id)}/test`, 'POST', { confirmCost: true }); output.textContent = result.message }
    catch (error) { output.textContent = (error as Error).message; output.classList.add('is-error') }
    finally { this.busy = false }
  }
  private confirm(title: string, detail: string) {
    return new Promise<boolean>(resolve => {
      const dialog = document.createElement('dialog'); dialog.className = 'model-confirm'
      dialog.innerHTML = `<h2>${escape(title)}</h2><p>${escape(detail)}</p><footer><button type="button" data-no>取消</button><button type="button" class="model-primary" data-yes>确认</button></footer>`
      const finish = (yes: boolean) => { dialog.close(); dialog.remove(); resolve(yes) }
      dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false) })
      dialog.querySelector('[data-no]')!.addEventListener('click', () => finish(false))
      dialog.querySelector('[data-yes]')!.addEventListener('click', () => finish(true))
      document.body.append(dialog); dialog.showModal()
    })
  }
}
