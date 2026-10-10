import { loadModelCatalog, type Purpose } from './catalog'
import { modelRequest, type AdminModels } from './admin-api'
import { concurrencyForm, defaultsForm, escape, providerForm, purposes } from './admin-views'
import { providerGroups } from './provider-groups'
import { bindEditorDiscovery } from './editor-discovery'
import { bindProviderKeys, providerDraft } from './provider-editor'
import { chooseModel } from './model-picker'
import { modelPurposes } from './model-purpose'
import { bindInlineModelForm, inlineModelDraft, inlineModelForm } from './inline-model-editor'
import { bindKeyVerification } from './key-verification'
import { renderProviderNavigation, workspaceLayout } from './workspace-layout'
import { layoutEditorForm } from './editor-layout'

export class AdminModelController {
  private readonly page = document.createElement('dialog')
  private readonly editor = document.createElement('dialog')
  private state?: AdminModels
  private busy = false
  private providerDirty = false
  private inline?: { form: HTMLFormElement; dirty: boolean }
  private defaultsDirty = false
  private concurrencyDirty = false
  private loadVersion = 0
  private filter = ''
  private selectedProvider = ''
  constructor(private readonly options: { isAdmin(): boolean; closeUserMenu(): void }) {
    this.page.className = 'model-workspace'
    this.page.setAttribute('aria-label', '全局模型管理')
    this.page.innerHTML = workspaceLayout()
    this.editor.className = 'model-editor'
    this.editor.setAttribute('aria-label', '服务商配置')
    document.body.append(this.page, this.editor)
    this.page.addEventListener('cancel', event => { event.preventDefault(); void this.closePage() })
    this.page.addEventListener('click', event => {
      const button = (event.target as Element).closest<HTMLButtonElement>('button')
      if (!button || this.busy) return
      const menu = button.closest<HTMLDetailsElement>('.model-add-menu')
      if (menu) menu.open = false
      if (button.hasAttribute('data-close')) void this.closePage()
      if (button.hasAttribute('data-refresh')) void this.refresh()
      if (button.hasAttribute('data-new')) this.editProvider()
      if (button.hasAttribute('data-settings')) void this.toggleSettings()
      if (button.hasAttribute('data-select-provider')) this.selectProvider(button.dataset.selectProvider || '')
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
    this.page.querySelector('[data-provider-select]')!.addEventListener('change', event => this.selectProvider((event.target as HTMLSelectElement).value))
    this.editor.addEventListener('cancel', event => { event.preventDefault(); void this.closeProvider() })
    this.page.addEventListener('close', () => { this.loadVersion++; this.state = undefined; this.inline = undefined; this.defaultsDirty = false; this.concurrencyDirty = false; this.page.querySelector('[data-content]')!.replaceChildren() })
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
    if ((this.inline?.dirty || this.defaultsDirty || this.concurrencyDirty) && !(await this.confirm('放弃未保存的修改？', '模型、默认分配或生成并发尚未保存。'))) return false
    this.inline = undefined; this.defaultsDirty = false; this.concurrencyDirty = false; return true
  }
  private async load() {
    if (this.busy) return
    const version = ++this.loadVersion
    this.feedback('正在读取配置…')
    try {
      const state = await modelRequest<AdminModels>('/admin/models')
      if (version !== this.loadVersion || !this.page.open || !this.options.isAdmin()) return
      this.state = state; this.defaultsDirty = false; this.concurrencyDirty = false; this.render(); this.feedback(''); await loadModelCatalog()
    } catch (error) { if (version === this.loadVersion && this.page.open) this.feedback((error as Error).message, true) }
  }
  private feedback(message: string, error = false) {
    const output = this.page.querySelector<HTMLOutputElement>('output')!
    output.textContent = message; output.classList.toggle('is-error', error)
  }
  private selectProvider(id: string) {
    this.selectedProvider = id
    if (this.state) renderProviderNavigation(this.page, this.state, id)
    this.filterContent()
  }
  private async toggleSettings() {
    const panel = this.page.querySelector<HTMLElement>('[data-settings-page]')!
    if (!panel.hidden && !(await this.discardDrafts())) return
    panel.hidden = !panel.hidden
    this.page.querySelector<HTMLElement>('[data-browser]')!.hidden = !panel.hidden
    this.page.querySelector('[data-settings]')!.setAttribute('aria-pressed', String(!panel.hidden))
    if (!panel.hidden) panel.querySelector<HTMLElement>('h2')!.focus()
    else { this.render(); this.page.querySelector<HTMLInputElement>('[data-search]')!.focus() }
  }
  private render() {
    if (!this.state) return
    const defaults = this.page.querySelector<HTMLElement>('[data-default-area]')!
    defaults.innerHTML = `<div class="model-default-heading"><h2>默认分配</h2><span>新请求生效</span></div>${defaultsForm(this.state)}`
    defaults.querySelector('form')!.addEventListener('submit', event => {
      event.preventDefault()
      if (this.inline?.dirty) { this.feedback('请先保存或取消正在编辑的模型。', true); return }
      if (this.concurrencyDirty) { this.feedback('请先保存或刷新生成并发设置。', true); return }
      void this.save('/admin/model-defaults', 'PUT', { defaults: Object.fromEntries(new FormData(event.target as HTMLFormElement)) })
    })
    const concurrency = this.page.querySelector<HTMLElement>('[data-concurrency-area]')!
    concurrency.innerHTML = concurrencyForm(this.state)
    const concurrencyFormElement = concurrency.querySelector<HTMLFormElement>('form')!
    concurrencyFormElement.addEventListener('input', event => {
      if (this.inline?.dirty || this.defaultsDirty) {
        const input = event.target as HTMLInputElement
        input.value = String(this.state!.concurrency[input.name as 'image' | 'video'])
        this.feedback('请先保存或取消模型、默认分配的修改。', true)
        return
      }
      this.concurrencyDirty = true
    })
    concurrencyFormElement.addEventListener('submit', event => {
      event.preventDefault()
      if (this.inline?.dirty || this.defaultsDirty) { this.feedback('请先保存或取消模型、默认分配的修改。', true); return }
      const values = new FormData(concurrencyFormElement)
      void this.save('/admin/generation-concurrency', 'PUT', { concurrency: { image: Number(values.get('image')), video: Number(values.get('video')) } })
    })
    this.page.querySelector('[data-content]')!.innerHTML = providerGroups(this.state, '', '') + '<p class="model-empty" data-filter-empty hidden>没有匹配的服务商或模型，请调整搜索条件。</p>'
    if (!this.state.providers.some(p => p.id === this.selectedProvider)) this.selectedProvider = ''
    renderProviderNavigation(this.page, this.state, this.selectedProvider)
    this.filterContent()
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
      group.hidden = (!!this.selectedProvider && this.selectedProvider !== provider.id) || (!visible && (!match || !!this.filter))
    }
    const empty = this.page.querySelector<HTMLElement>('[data-filter-empty]')
    if (empty) empty.hidden = !this.state.providers.length || [...this.page.querySelectorAll<HTMLElement>('[data-provider]')].some(el => !el.hidden)
  }
  private async pickDefault(purpose: Purpose) {
    if (!this.state) return
    if (this.inline?.dirty || this.concurrencyDirty) { this.feedback('请先保存或取消模型、生成并发的修改，再调整默认分配。', true); return }
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
      this.inline = undefined; this.providerDirty = false; this.defaultsDirty = false; this.concurrencyDirty = false
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
    if (this.inline?.dirty || this.defaultsDirty || this.concurrencyDirty) { this.feedback('请先保存或取消模型、默认分配和生成并发的修改。', true); return }
    const provider = this.state.providers.find(p => p.id === id)
    this.editor.setAttribute('aria-label', '服务商配置')
    this.providerDirty = false
    this.editor.innerHTML = `<header><div><h2>${id ? '连接配置' : '添加服务商'}</h2><p>连接信息供此服务商下的所有模型共用。</p></div><button type="button" data-cancel aria-label="关闭编辑">×</button></header><form><output tabindex="-1" aria-live="polite" class="model-feedback"></output><fieldset>${providerForm(provider)}</fieldset><footer><button type="button" data-cancel>取消</button><button type="submit" class="model-primary">保存服务商</button></footer></form>`
    const form = this.editor.querySelector('form')!
    layoutEditorForm(form)
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
    if (this.busy || ((this.providerDirty || this.inline?.dirty) && !(await this.confirm('放弃未保存的修改？', '当前配置尚未保存。')))) return
    this.editor.close(); this.editor.replaceChildren(); this.providerDirty = false; this.inline = undefined
  }
  private async editModel(id?: string, providerId?: string, upstreamId = '') {
    if (!this.state || this.busy) return
    if (this.defaultsDirty || this.concurrencyDirty) { this.feedback('请先保存默认分配或生成并发，再编辑模型。', true); return }
    if (this.inline?.dirty && !(await this.confirm('放弃未保存的模型修改？', '当前模型尚未保存。'))) return
    this.inline?.form.remove(); this.inline = undefined
    const model = this.state.models.find(m => m.id === id), connection = providerId || model?.providerId
    if (!connection) return
    this.editor.setAttribute('aria-label', '模型配置')
    this.editor.innerHTML = `<header><div><h2>${model ? escape(model.name) : '添加模型'}</h2><p>${escape(this.state.providers.find(p => p.id === connection)?.name)}</p></div><button type="button" data-cancel aria-label="关闭编辑">×</button></header>${inlineModelForm(this.state, connection, model, upstreamId)}`
    this.editor.querySelector('[data-cancel]')!.addEventListener('click', () => void this.closeProvider())
    const form = this.editor.querySelector('form')!
    layoutEditorForm(form)
    bindInlineModelForm(form, !model); this.inline = { form, dirty: false }
    form.addEventListener('input', () => { if (this.inline) this.inline.dirty = true })
    form.addEventListener('submit', event => { event.preventDefault(); void this.save(`/admin/models${id ? '/' + encodeURIComponent(id) : ''}`, id ? 'PUT' : 'POST', inlineModelDraft(form), form) })
    form.querySelector('[data-model-test]')?.addEventListener('click', () => void this.testModel(id!, form))
    form.querySelector('[data-model-delete]')?.addEventListener('click', () => void this.deleteModel(id!, model!.name, form))
    form.querySelector('[data-inline-cancel]')!.addEventListener('click', () => void this.closeProvider())
    this.editor.showModal(); form.querySelector<HTMLInputElement>('[name=name]')!.focus({ preventScroll: true })
  }
  private async discover(id: string) {
    if (this.busy || !this.state) return
    if (this.inline?.dirty || this.defaultsDirty || this.concurrencyDirty) { this.feedback('请先保存或取消当前修改，再添加模型。', true); return }
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
  private async deleteModel(id: string, name: string, form: HTMLFormElement) {
    if (this.busy || !this.state) return
    const defaultNames = Object.entries(this.state.defaults).filter(([, modelId]) => modelId === id).map(([purpose]) => purposes[purpose as Purpose])
    const detail = `删除后无法恢复，已选择此模型的画布需要重新选择。${defaultNames.length ? `当前它还是${defaultNames.join('、')}默认模型，删除后这些用途会改为手动选择。` : ''}`
    if (!(await this.confirm(`删除“${name}”？`, detail, '删除模型', true))) return
    this.busy = true
    const controls = [...this.page.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button,input,select')]
    const disabled = controls.map(control => control.disabled)
    controls.forEach(control => control.disabled = true)
    const output = form.querySelector<HTMLOutputElement>('output')!
    output.textContent = '正在删除模型…'; output.classList.remove('is-error')
    this.feedback('正在删除模型…')
    try {
      this.state = await modelRequest<AdminModels>(`/admin/models/${encodeURIComponent(id)}`, 'DELETE', { revision: this.state.revision })
      if (!this.page.open || !this.options.isAdmin()) { this.state = undefined; return }
      this.inline = undefined; this.defaultsDirty = false
      this.editor.close(); this.editor.replaceChildren()
      this.render(); this.feedback(`已删除“${name}”，新请求立即生效。`)
      await loadModelCatalog().catch(() => this.feedback('模型已删除，模型目录刷新失败，请点击刷新。', true))
    } catch (error) {
      const message = (error as Error).message
      this.feedback(message, true); output.textContent = message; output.classList.add('is-error'); output.focus()
    } finally { this.busy = false; controls.forEach((control, index) => control.disabled = disabled[index]) }
  }
  private confirm(title: string, detail: string, confirmLabel = '确认', danger = false) {
    return new Promise<boolean>(resolve => {
      const dialog = document.createElement('dialog'); dialog.className = 'model-confirm'
      dialog.innerHTML = `<h2>${escape(title)}</h2><p>${escape(detail)}</p><footer><button type="button" data-no>取消</button><button type="button" class="${danger ? 'model-danger' : 'model-primary'}" data-yes>${escape(confirmLabel)}</button></footer>`
      const finish = (yes: boolean) => { dialog.close(); dialog.remove(); resolve(yes) }
      dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false) })
      dialog.querySelector('[data-no]')!.addEventListener('click', () => finish(false))
      dialog.querySelector('[data-yes]')!.addEventListener('click', () => finish(true))
      document.body.append(dialog); dialog.showModal(); dialog.querySelector<HTMLButtonElement>('[data-no]')!.focus()
    })
  }
}
