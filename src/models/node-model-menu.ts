import { catalogModel, currentCatalog } from './catalog'
type PersonalModel = { id: string; kind: 'image' | 'video'; name: string; model: string }
export function modelMenu(kind: 'image' | 'video', selected: string | undefined, personal: PersonalModel[], credits: number, escape: (text: string) => string) {
  const catalog = currentCatalog()
  if (!catalog) return undefined
  const selectedModel = catalogModel(selected)
  const items = catalog.models.filter(m => m.kind === kind && (m.enabled || m.id === selectedModel?.id)).map(m => ({ id: m.id, name: m.name, detail: m.enabled ? `${m.model} · 全局模型` : '已停用，请选择其他模型', enabled: m.enabled && credits >= m.creditCost, cost: m.creditCost }))
  items.push(...personal.filter(m => m.kind === kind).map(m => ({ id: `custom:${m.id}`, name: m.name, detail: `${m.model} · 个人模型`, enabled: true, cost: 0 })))
  if (selected && !items.some(m => m.id === selected || m.id === selectedModel?.id)) items.push({ id: selected, name: selected, detail: '原模型不可用，请重新选择', enabled: false, cost: 0 })
  // Keep raw legacy node IDs selectable until the user explicitly selects a catalog entry.
  if (selectedModel && selected !== selectedModel.id) {
    const item = items.find(m => m.id === selectedModel.id)
    if (item) item.id = selected!
  }
  return {
    buttons: `<small>选择${kind === 'image' ? '图像' : '视频'}模型</small>` + (items.length ? items.map(m => `<button type="button" data-${kind === 'image' ? 'image-model' : 'video-model-option'}="${escape(m.id)}" ${m.enabled ? '' : 'disabled'}><span><b>${escape(m.name)}</b><small>${escape(m.detail)}</small></span><em class="model-price">${m.cost ? `×${m.cost}` : '免费'}</em><i>✓</i></button>`).join('') : '<p>尚未配置可用模型，请联系管理员</p>'),
    options: items.map(m => `<option value="${escape(m.id)}" ${m.enabled ? '' : 'disabled'}>${escape(m.name)}</option>`).join(''),
  }
}
