import { loadModelCatalog, type CatalogModel } from './catalog'
import { modelRequest, type AdminModels } from './admin-api'
import { defaultsForm, escape, kinds, modelForm, modelRows, providerForm, providerRows } from './admin-views'
import { bindEditorDiscovery } from './editor-discovery'

export class AdminModelController {
  private readonly page = document.createElement('dialog')
  private readonly editor = document.createElement('dialog')
  private state?: AdminModels
  private tab = 'models'
  private busy = false
  private dirty = false
  private discovered?: { providerId: string; models: string[] }
  private loadVersion = 0
  constructor(private readonly options: { isAdmin(): boolean; closeUserMenu(): void }) {
    this.page.className = 'model-workspace'
    this.page.setAttribute('aria-label', '全局模型管理')
    this.page.innerHTML = `<header><div><small>管理员工作区</small><h1>全局模型</h1><p>统一配置连接与模型，供所有用户使用。</p></div><button type="button" data-close>返回画布</button></header><nav aria-label="模型管理分类">${[['models', '模型目录'], ['providers', '服务商连接'], ['defaults', '默认分配']].map(([id, title]) => `<button type="button" data-tab="${id}" aria-pressed="${id === 'models'}">${title}</button>`).join('')}</nav><div class="model-page-body"><output class="model-feedback" aria-live="polite"></output><div data-import></div><div class="model-toolbar"><input type="search" aria-label="搜索模型" placeholder="搜索名称或模型 ID" data-search><select aria-label="筛选模型类型" data-kind><option value="">全部类型</option>${Object.entries(kinds).map(([key, title]) => `<option value="${key}">${title}</option>`).join('')}</select><button type="button" data-refresh>刷新</button><button type="button" class="model-primary" data-new>新增模型</button></div><section data-content aria-label="模型配置"></section></div>`
    this.editor.className = 'model-editor'
    this.editor.setAttribute('aria-label', '编辑模型配置')
    document.body.append(this.page, this.editor)
    this.page.querySelector('[data-close]')!.addEventListener('click', () => { if (!this.busy) this.page.close() })
    this.page.addEventListener('cancel', event => { if (this.busy) event.preventDefault() })
    this.page.querySelector('[data-refresh]')!.addEventListener('click', () => void this.load())
    this.page.querySelector('[data-new]')!.addEventListener('click', () => this.edit(this.tab === 'providers' ? 'provider' : 'model'))
    this.page.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(button => button.addEventListener('click', () => { this.tab = button.dataset.tab!; this.render() }))
    this.page.querySelector('[data-search]')!.addEventListener('input', () => this.renderContent())
    this.page.querySelector('[data-kind]')!.addEventListener('change', () => this.renderContent())
    this.page.addEventListener('click', event => {
      const button = (event.target as Element).closest<HTMLButtonElement>('button')
      if (button?.dataset.editModel) this.edit('model', button.dataset.editModel)
      if (button?.dataset.editProvider) this.edit('provider', button.dataset.editProvider)
      if (button?.dataset.discover) void this.discover(button.dataset.discover)
    })
    this.editor.addEventListener('cancel', event => { event.preventDefault(); void this.closeEditor() })
    this.page.addEventListener('close', () => { this.loadVersion++; this.state = undefined; this.page.querySelector('[data-content]')!.replaceChildren() })
  }
  async open() {
    if (!this.options.isAdmin() || this.page.open) return
    this.options.closeUserMenu()
    this.page.showModal()
    await this.load()
  }
  close() { this.editor.close(); this.page.close(); this.state = undefined }
  private async load() {
    if (this.busy) return
    const version = ++this.loadVersion
    this.feedback('正在读取配置…')
    try {
      const state = await modelRequest<AdminModels>('/admin/models')
      if (version !== this.loadVersion || !this.page.open || !this.options.isAdmin()) return
      this.state = state; this.render(); this.feedback('')
      await loadModelCatalog()
    }
    catch (error) { if (version === this.loadVersion && this.page.open) this.feedback((error as Error).message, true) }
  }
  private feedback(message: string, error = false) {
    const output = this.page.querySelector<HTMLOutputElement>('output')!
    output.textContent = message; output.classList.toggle('is-error', error)
  }
  private render() {
    if (!this.state) return
    this.page.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.tab === this.tab)))
    const importArea = this.page.querySelector<HTMLElement>('[data-import]')!
    importArea.innerHTML = this.state.imported ? '' : '<aside class="model-notice"><span>环境配置仍兼容运行。导入后可在这里编辑，重启不会覆盖页面配置。</span><button type="button" data-import-button>导入环境配置</button></aside>'
    importArea.querySelector('button')?.addEventListener('click', async () => {
      if (await this.confirm('导入环境配置？', '将复制当前配置到页面管理，不删除环境变量，也不改动已提交任务。')) void this.save('/admin/models/import-environment', 'POST', {})
    })
    const add = this.page.querySelector<HTMLButtonElement>('[data-new]')!
    add.textContent = this.tab === 'providers' ? '新增连接' : '新增模型'
    add.hidden = this.tab === 'defaults'
    for (const selector of ['[data-search]', '[data-kind]']) (this.page.querySelector(selector) as HTMLElement).hidden = this.tab !== 'models'
    this.renderContent()
  }
  private renderContent() {
    if (!this.state) return
    const content = this.page.querySelector<HTMLElement>('[data-content]')!
    content.innerHTML = this.tab === 'models' ? modelRows(this.state, (this.page.querySelector('[data-search]') as HTMLInputElement).value, (this.page.querySelector('[data-kind]') as HTMLSelectElement).value) : this.tab === 'providers' ? providerRows(this.state) : defaultsForm(this.state)
    content.querySelector<HTMLFormElement>('[data-defaults]')?.addEventListener('submit', event => {
      event.preventDefault()
      void this.save('/admin/model-defaults', 'PUT', { defaults: Object.fromEntries(new FormData(event.target as HTMLFormElement)) })
    })
  }
  private async save(path: string, method: string, body: Record<string, unknown>, fromEditor = false) {
    if (this.busy || !this.state) return
    this.busy = true
    const form = this.editor.querySelector('form')
    const output = this.editor.querySelector('output')
    if (output && fromEditor) { output.textContent = '正在保存…'; output.classList.remove('is-error') }
    this.feedback('正在保存…')
    this.page.querySelectorAll<HTMLButtonElement>('button').forEach(b => b.disabled = true)
    form?.querySelectorAll<HTMLButtonElement>('button').forEach(b => b.disabled = true)
    try {
      this.state = await modelRequest<AdminModels>(path, method, { ...body, revision: this.state.revision })
      if (!this.page.open || !this.options.isAdmin()) { this.state = undefined; return }
      this.dirty = false
      if (fromEditor) this.editor.close()
      this.render(); this.feedback('已保存，新请求立即生效。')
      await loadModelCatalog().catch(() => this.feedback('配置已保存，但当前页面目录刷新失败，请点击刷新重试。', true))
    } catch (error) {
      this.feedback((error as Error).message, true)
      if (output && fromEditor) { output.textContent = (error as Error).message; output.classList.add('is-error'); output.focus() }
    } finally {
      this.busy = false
      this.page.querySelectorAll<HTMLButtonElement>('button').forEach(b => b.disabled = false)
      form?.querySelectorAll<HTMLButtonElement>('button').forEach(b => b.disabled = false)
    }
  }
  private edit(kind: 'model' | 'provider', id?: string) {
    if (!this.state || this.busy) return
    const provider = kind === 'provider' ? this.state.providers.find(p => p.id === id) : undefined
    const model = kind === 'model' ? this.state.models.find(m => m.id === id) : undefined
    const readonly = provider?.readOnly || (!this.state.imported && model?.id.startsWith('global:env-'))
    this.dirty = false
    this.editor.innerHTML = `<header><h2>${id ? '编辑' : '新增'}${kind === 'provider' ? '服务商连接' : '模型'}</h2><button type="button" data-cancel aria-label="关闭编辑">×</button></header><form><output tabindex="-1" aria-live="polite" class="model-feedback"></output>${readonly ? '<p class="model-notice">当前为环境配置，请先导入后编辑。</p>' : ''}<fieldset ${readonly ? 'disabled' : ''}>${kind === 'provider' ? providerForm(provider) : modelForm(this.state, model, this.discovered)}</fieldset><footer><button type="button" data-cancel>取消</button>${!readonly ? '<button type="submit" class="model-primary">保存配置</button>' : ''}${model?.enabled && model.kind !== 'text' ? '<button type="button" data-test>实际生成测试</button>' : ''}</footer></form>`
    this.editor.showModal()
    this.editor.querySelectorAll('[data-cancel]').forEach(button => button.addEventListener('click', () => void this.closeEditor()))
    this.editor.querySelector('[data-reveal]')?.addEventListener('click', event => {
      const input = this.editor.querySelector<HTMLInputElement>('[name=apiKey]')!
      input.type = input.type === 'password' ? 'text' : 'password'; (event.target as HTMLElement).textContent = input.type === 'password' ? '显示密钥' : '隐藏密钥'
    })
    const form = this.editor.querySelector('form')!
    if (!readonly) bindEditorDiscovery(form, kind, provider?.id)
    form.addEventListener('input', () => { this.dirty = true })
    const updateCapabilities = () => {
      const value = this.editor.querySelector<HTMLSelectElement>('[name=adapter]')?.value || ''
      this.editor.querySelectorAll<HTMLElement>('[data-image-capability]').forEach(el => el.hidden = !value.endsWith('image'))
      this.editor.querySelectorAll<HTMLElement>('[data-video-capability]').forEach(el => el.hidden = !value.endsWith('video'))
    }
    this.editor.querySelector('[name=adapter]')?.addEventListener('change', updateCapabilities); updateCapabilities()
    form.addEventListener('submit', event => {
      event.preventDefault()
      if (readonly) return
      const values = Object.fromEntries(new FormData(form)) as Record<string, unknown>
      values.enabled = values.enabled === 'on'
      if (kind === 'model') {
        const split = (key: string) => String(values[key] || '').split(/[,，\n]/).map(s => s.trim()).filter(Boolean)
        values.capabilities = { referenceImages: Number(values.referenceImages), transparent: values.transparent === 'on', sizes: split('sizes'), resolutions: split('resolutions'), aspectRatios: split('aspectRatios'), minSeconds: Number(values.minSeconds), maxSeconds: Number(values.maxSeconds) }
      }
      void this.save(`${kind === 'model' ? '/admin/models' : '/admin/model-providers'}${id ? '/' + encodeURIComponent(id) : ''}`, id ? 'PUT' : 'POST', values, true)
    })
    this.editor.querySelector('[data-test]')?.addEventListener('click', () => void this.test(model!))
  }
  private async closeEditor() {
    if (this.busy) return
    if (this.dirty && !(await this.confirm('放弃未保存的修改？', '当前输入尚未保存，关闭后需要重新填写。'))) return
    this.editor.close(); this.editor.replaceChildren(); this.dirty = false
  }
  private async discover(id: string) {
    if (this.busy) return
    this.busy = true; this.feedback('正在测试连接并获取模型列表…')
    try {
      const result = await modelRequest<{ models: string[] }>(`/admin/model-providers/${encodeURIComponent(id)}/discover`, 'POST', {})
      if (!this.page.open || !this.options.isAdmin()) return
      this.discovered = { providerId: id, models: result.models }
      this.feedback(`连接成功，找到 ${result.models.length} 个模型。新增模型时可从建议列表选择，也可以手填。`)
      this.busy = false; this.edit('model')
    } catch (error) { this.feedback((error as Error).message, true) }
    finally { this.busy = false }
  }
  private async test(model: CatalogModel) {
    if (this.busy || !(await this.confirm('开始实际生成测试？', '将使用已保存配置发起真实生成，可能产生服务商费用。不会扣用户创作点数或写入画布。'))) return
    this.busy = true
    const output = this.editor.querySelector('output')!; output.textContent = '测试生成中，请稍候…'
    try { const result = await modelRequest<{ message: string }>(`/admin/models/${encodeURIComponent(model.id)}/test`, 'POST', { confirmCost: true }); output.textContent = result.message }
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
