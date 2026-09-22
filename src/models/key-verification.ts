import { modelRequest, type KeyStatus, type ProviderView } from './admin-api'

export function keyStatusText(key: KeyStatus): string {
  const reasons: Record<string, string> = { 'rate-limit': '限流', quota: '额度不足', authentication: '认证失败' }
  const describe = (scope: string, value: KeyStatus) => value.status === 'cooling'
    ? `${scope}：${reasons[value.reason || ''] || '暂不可用'}，${value.cooldownUntil ? new Date(value.cooldownUntil).toLocaleString() : ''} 后可重试`
    : `${scope}：无冷却（不代表已验证）`
  return [describe('生成', key), ...(key.discovery?.status === 'cooling' ? [describe('查询列表', key.discovery)] : [])].join('；')
}

/** Keep the form and unsaved Key selections intact while checking a saved credential. */
export function bindKeyVerification(form: HTMLFormElement, provider?: ProviderView, onUpdated?: () => void) {
  if (!provider) return
  form.querySelectorAll<HTMLInputElement>('[name=retainedKeyIds]').forEach((checkbox, index) => {
    const label = checkbox.closest('label')!
    const status = label.querySelector('span small')!
    const key = provider.keys?.find(k => k.id === checkbox.value)
    if (key) status.textContent = keyStatusText(key)
    const row = document.createElement('div'); row.className = 'model-key-verification'
    const button = document.createElement('button'); button.type = 'button'; button.textContent = '重新验证'
    button.setAttribute('aria-label', `重新验证 Key ${index + 1}`)
    const output = document.createElement('output'); output.setAttribute('aria-live', 'polite')
    row.append(button, output); label.after(row)
    button.addEventListener('click', async () => {
      const data = new FormData(form)
      if (String(data.get('baseUrl')).trim() !== provider.baseUrl || String(data.get('proxyUrl') || '').trim() !== provider.proxyUrl || !checkbox.checked) {
        output.textContent = '请先保存连接或 Key 的变更，再验证；此按钮只验证已保存的 Key。'; return
      }
      button.disabled = true; output.textContent = '正在验证已保存的 Key，不保存表单，也不发起生成…'
      try {
        const result = await modelRequest<{ key: KeyStatus; message: string }>(`/admin/model-providers/${encodeURIComponent(provider.id)}/verify-key`, 'POST', { keyId: checkbox.value })
        if (!form.isConnected) return
        provider.keys = provider.keys?.map(k => k.id === result.key.id ? result.key : k)
        status.textContent = keyStatusText(result.key); output.textContent = result.message
        onUpdated?.()
      } catch (error) { if (form.isConnected) output.textContent = (error as Error).message }
      finally { button.disabled = false }
    })
  })
}
