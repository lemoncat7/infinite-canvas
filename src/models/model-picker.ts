import { escape } from './admin-views'

export interface ModelChoice { value: string; title: string; detail: string }

/** Searchable chooser with native button keyboard behavior, focus restoration and no long select. */
export function chooseModel(title: string, choices: ModelChoice[], selected = ''): Promise<string | undefined> {
  return new Promise(resolve => {
    const trigger = document.activeElement as HTMLElement | null
    const dialog = document.createElement('dialog')
    dialog.className = 'model-picker'; dialog.setAttribute('aria-label', title)
    dialog.innerHTML = `<header><h2>${escape(title)}</h2><button type="button" data-close aria-label="关闭选择">×</button></header><label class="model-picker-search">搜索模型<input type="search" placeholder="模型名称、服务商或 ID" autofocus></label><div data-choices></div><output aria-live="polite"></output>`
    const finish = (value?: string) => { dialog.close(); dialog.remove(); trigger?.focus(); resolve(value) }
    const render = () => {
      const query = dialog.querySelector('input')!.value.trim().toLowerCase()
      const visible = choices.filter(c => `${c.title} ${c.detail}`.toLowerCase().includes(query))
      dialog.querySelector('[data-choices]')!.innerHTML = visible.map(c => `<button type="button" class="model-choice" data-value="${escape(c.value)}" aria-pressed="${c.value === selected}"><span><strong>${escape(c.title)}</strong><small>${escape(c.detail)}</small></span><span aria-hidden="true">${c.value === selected ? '✓' : '›'}</span></button>`).join('')
      dialog.querySelector('output')!.textContent = visible.length ? `${visible.length} 个选项` : '没有匹配的模型'
    }
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish() })
    dialog.addEventListener('click', event => {
      const button = (event.target as Element).closest<HTMLButtonElement>('button')
      if (button?.hasAttribute('data-close')) finish()
      else if (button?.hasAttribute('data-value')) finish(button.dataset.value!)
    })
    dialog.querySelector('input')!.addEventListener('input', render)
    document.body.append(dialog); render(); dialog.showModal()
  })
}
