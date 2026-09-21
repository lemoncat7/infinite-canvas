/** One serializer for saving and testing a provider draft. Existing secrets never return to the browser. */
export function providerDraft(form: HTMLFormElement): Record<string, unknown> {
  const data = new FormData(form)
  return {
    ...Object.fromEntries(data),
    apiKey: undefined,
    apiKeys: [...new Set(data.getAll('apiKey').map(value => String(value).trim()).filter(Boolean))],
    retainedKeyIds: data.getAll('retainedKeyIds'),
    enabled: data.get('enabled') === 'on',
  }
}

export function bindProviderKeys(form: HTMLFormElement) {
  let revealed = false
  const list = form.querySelector<HTMLElement>('[data-new-keys]')!
  form.querySelector('[data-add-key]')?.addEventListener('click', () => {
    if (list.children.length >= 32) return
    const row = document.createElement('div'); row.className = 'model-key-input'
    const input = document.createElement('input')
    input.name = 'apiKey'; input.type = revealed ? 'text' : 'password'; input.autocomplete = 'new-password'; input.maxLength = 8192
    input.setAttribute('aria-label', '新增 API 密钥'); input.placeholder = '输入新的 Key'
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '移除'
    remove.addEventListener('click', () => { row.remove(); form.dispatchEvent(new Event('input', { bubbles: true })) })
    row.append(input, remove); list.append(row); input.focus()
  })
  form.querySelector('[data-reveal]')?.addEventListener('click', event => {
    revealed = !revealed
    list.querySelectorAll<HTMLInputElement>('input').forEach(input => input.type = revealed ? 'text' : 'password')
    ;(event.currentTarget as HTMLButtonElement).textContent = revealed ? '隐藏密钥' : '显示密钥'
  })
}
