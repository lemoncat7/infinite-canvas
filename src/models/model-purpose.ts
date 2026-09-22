import type { CatalogModel, Purpose } from './catalog'

export const purposeKinds = { image: 'image', video: 'video', prompt: 'text', comic: 'text' } as const
export function modelPurposes(model: CatalogModel): Purpose[] {
  return model.purposes ?? (Object.keys(purposeKinds) as Purpose[]).filter(p => purposeKinds[p] === model.kind)
}
