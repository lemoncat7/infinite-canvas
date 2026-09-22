import { modelRequest } from './admin-api'
import { providerDraft } from './provider-editor'

/** Discover without saving or rebuilding the editor, preserving all draft fields. */
export function bindEditorDiscovery(form: HTMLFormElement, kind: 'model' | 'provider', providerId?: string) {
  const button = document.createElement('button')
  button.type = 'button'; button.textContent = '获取上游模型'; button.dataset.fetchModels = ''
  const results = document.createElement('select')
  results.hidden = true; results.setAttribute('aria-label', '选择上游模型')
  const output = form.querySelector<HTMLOutputElement>('output')!
  const fieldset = form.querySelector('fieldset')!
  const anchor = form.querySelector('[name=model]')?.parentElement
  if (anchor) anchor.after(button, results)
  else fieldset.append(button, results)
  let version = 0
  form.addEventListener('input', event => {
    const name = (event.target as HTMLInputElement).name
    if (['providerId', 'baseUrl', 'apiKey', 'proxyUrl', 'retainedKeyIds'].includes(name) || event.target === form) {
      version++; results.hidden = true; results.replaceChildren()
      form.querySelector('datalist')?.replaceChildren()
    }
  })
  button.addEventListener('click', async () => {
    const current = ++version
    const values = kind === 'provider' ? providerDraft(form) : Object.fromEntries(new FormData(form))
    const id = String(values.providerId || '')
    if (kind === 'model' && !id) { output.textContent = '请先选择服务商'; return }
    button.disabled = true; button.textContent = '正在获取…'
    output.classList.remove('is-error'); output.textContent = '正在读取上游模型，不会保存配置或发起生成…'
    try {
      const result = await modelRequest<{ models: string[] }>(kind === 'model'
        ? `/admin/model-providers/${encodeURIComponent(id)}/discover` : '/admin/model-providers/discover', 'POST',
      kind === 'model' ? {} : { ...values, providerId })
      if (!form.isConnected || current !== version) return
      results.replaceChildren(new Option('选择模型（也可手填）', ''), ...result.models.map(id => new Option(id, id)))
      results.hidden = kind === 'provider' || !result.models.length
      const suggestions = form.querySelector('datalist')
      suggestions?.replaceChildren(...result.models.map(id => new Option(id, id)))
      output.textContent = result.models.length ? `已获取 ${result.models.length} 个模型。请按上游文档确认协议与能力；尚未保存配置。` : '上游没有返回模型，可以继续手动填写。'
    } catch (error) {
      if (!form.isConnected || current !== version) return
      output.textContent = (error as Error).message; output.classList.add('is-error')
    } finally { if (form.isConnected) { button.disabled = false; button.textContent = '获取上游模型' } }
  })
  results.addEventListener('change', () => {
    const input = form.querySelector<HTMLInputElement>('[name=model]')
    if (!input || !results.value) return
    input.value = results.value; input.dispatchEvent(new Event('input', { bubbles: true }))
    const name = form.querySelector<HTMLInputElement>('[name=name]')!
    if (!name.value.trim()) name.value = results.value
  })
}
