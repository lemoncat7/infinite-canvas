import { apiFetch } from '../services/api'
export type ModelKind = 'image' | 'video' | 'text'
export type Purpose = 'image' | 'video' | 'prompt' | 'comic'
export type CatalogModel = {
  id: string; name: string; model: string; providerId: string; adapter: string; kind: ModelKind; enabled: boolean; order: number; creditCost: number;
  capabilities: { referenceImages: number; transparent: boolean; sizes: string[]; resolutions: string[]; aspectRatios: string[]; minSeconds: number; maxSeconds: number }
}
export type Catalog = { revision: number; defaults: Partial<Record<Purpose, string>>; models: CatalogModel[] }
let catalog: Catalog | undefined
let loading: Promise<void> | undefined
let epoch = 0
export function currentCatalog() { return catalog }
export function catalogModel(id?: string) { return catalog?.models.find(m => m.id === id) || catalog?.models.find(m => m.model === id) }
export function defaultModel(purpose: Purpose, fallback = '') { return catalog ? catalog.defaults[purpose] || '' : fallback }
export function upstreamModel(id?: string) { return catalogModel(id)?.model || id || '' }
export function modelLabel(id?: string) { return catalogModel(id)?.name || id || '' }
export function isAgnesVideo(id?: string) { return catalogModel(id)?.adapter === 'agnes-video' || upstreamModel(id).startsWith('agnes-') }
export function clearCatalog() { epoch++; catalog = undefined; loading = undefined }
export async function loadModelCatalog() {
  if (loading) return loading
  const version = epoch
  loading = (async () => {
    const response = await apiFetch('/api/models/catalog')
    if (!response.ok) throw new Error('模型目录读取失败，请刷新重试')
    const next = await response.json() as Catalog
    if (version !== epoch) return
    if (!Array.isArray(next.models) || !next.defaults || typeof next.revision !== 'number') throw new Error('模型目录响应无效，请刷新重试')
    const changed = JSON.stringify(next) !== JSON.stringify(catalog)
    catalog = next
    if (changed) document.dispatchEvent(new CustomEvent('model-catalog-updated'))
  })().finally(() => { if (version === epoch) loading = undefined })
  return loading
}
