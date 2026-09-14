import { catalogModel } from './catalog'
import type { FlowNode } from '../nodes/node-types'

/** Only an explicit model switch may normalize stored settings. Opening old work must not. */
export function normalizeModelSettings(node: FlowNode) {
  const model = catalogModel(node.model)
  if (!model) return
  const c = model.capabilities
  if (node.kind === 'image') {
    const settings = node.imageSettings ??= {}
    if (c.sizes.length && !c.sizes.includes(settings.size || 'auto')) settings.size = c.sizes[0]
    if (!c.transparent && settings.background === 'transparent') settings.background = 'auto'
  } else if (node.kind === 'video') {
    const settings = node.videoSettings ??= {}
    if (c.resolutions.length && !c.resolutions.includes(settings.resolution || '720p')) settings.resolution = c.resolutions[0]
    if (c.aspectRatios.length && !c.aspectRatios.includes(settings.aspectRatio || '16:9')) settings.aspectRatio = c.aspectRatios[0]
    settings.seconds = String(Math.max(c.minSeconds, Math.min(c.maxSeconds, Number(settings.seconds) || 5)))
  }
}

export function bindCatalogSettings(panel: HTMLElement, node: FlowNode, changed: () => void) {
  panel.querySelectorAll('[data-catalog-setting]').forEach(el => el.remove())
  panel.querySelectorAll<HTMLElement>('[data-catalog-hidden]').forEach(el => { el.hidden = false; delete el.dataset.catalogHidden })
  const model = catalogModel(node.model)
  if (!model) return
  const c = model.capabilities
  const hide = (element: HTMLElement | null) => { if (element) { element.hidden = true; element.dataset.catalogHidden = '' } }
  const select = (anchor: HTMLElement | null, title: string, values: string[], value: string, update: (value: string) => void) => {
    if (!anchor || !values.length) return
    hide(anchor)
    const label = document.createElement('label'); label.dataset.catalogSetting = ''; label.className = 'catalog-setting'
    const caption = document.createElement('span'); caption.textContent = title
    const input = document.createElement('select'); input.setAttribute('aria-label', title)
    input.replaceChildren(...values.map(value => new Option(value, value)))
    if (!values.includes(value)) { const old = new Option(`${value}（原设置不受支持）`, value); old.disabled = true; input.append(old) }
    input.value = value
    input.addEventListener('change', () => { update(input.value); changed() })
    label.append(caption, input); anchor.after(label)
  }
  if (node.kind === 'image') {
    select(panel.querySelector('.image-aspect-options'), '图片尺寸', c.sizes, node.imageSettings?.size || 'auto', value => { (node.imageSettings ??= {}).size = value })
    if (!c.transparent) hide(panel.querySelector('.image-background-setting'))
  } else if (node.kind === 'video') {
    for (const [key, title, values, fallback] of [
      ['resolution', '视频分辨率', c.resolutions, '720p'],
      ['aspectRatio', '视频画幅', c.aspectRatios, '16:9'],
    ] as const) {
      const anchor = panel.querySelector<HTMLElement>(`[data-video-setting="${key}"]`)?.parentElement || null
      select(anchor, title, [...values], node.videoSettings?.[key] || fallback, value => { (node.videoSettings ??= {})[key] = value })
    }
  }
}
