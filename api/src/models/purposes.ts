import { purposeKinds, type GlobalModel, type ModelConfiguration, type ModelPurpose } from './types.js'

export const AUTO_MODEL = '@auto'
export function modelPurposes(model: GlobalModel): ModelPurpose[] {
  return model.purposes ?? (Object.keys(purposeKinds) as ModelPurpose[]).filter(purpose => purposeKinds[purpose] === model.kind)
}
export function resolvedDefaults(config: ModelConfiguration) {
  const defaults = { ...config.defaults }
  for (const purpose of Object.keys(purposeKinds) as ModelPurpose[]) {
    if (defaults[purpose] !== AUTO_MODEL) continue
    defaults[purpose] = config.models.filter(model => model.enabled && modelPurposes(model).includes(purpose) && config.providers.some(p => p.id === model.providerId && p.enabled))
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))[0]?.id || ''
  }
  return defaults
}
