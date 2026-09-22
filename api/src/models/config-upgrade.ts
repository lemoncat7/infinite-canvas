import { connectionKeys } from './key-pool.js'
import { modelPurposes } from './purposes.js'
import type { ModelConfiguration, ModelPurpose, ProviderConnection } from './types.js'

/** Only saved data is upgraded. Environment variables never create providers or models. */
export function upgradeModelConfiguration(value: ModelConfiguration): ModelConfiguration {
  const next = structuredClone(value)
  const aliases = new Map<string, string>()
  const providers: ProviderConnection[] = []
  const signatures = new Map<string, string>()
  for (const provider of next.providers) {
    if (provider.id.startsWith('env-') && /^(环境\s*·\s*|OpenAI (图片|视频)|文本助手|Agnes (图片|视频))/.test(provider.name)) {
      const signature = JSON.stringify([provider.baseUrl.replace(/\/$/, ''), provider.proxyUrl, provider.enabled, [...connectionKeys(provider)].sort()])
      const existing = signatures.get(signature)
      if (existing) { aliases.set(provider.id, existing); continue }
      signatures.set(signature, provider.id)
      provider.name = provider.name.replace(/^环境\s*·\s*/, '')
    }
    providers.push(provider)
  }
  next.providers = providers
  next.models = next.models.map(model => ({ ...model, providerId: aliases.get(model.providerId) || model.providerId, purposes: modelPurposes(model) }))
  for (const id of new Set(aliases.values())) {
    const provider = next.providers.find(p => p.id === id)!
    if (/^OpenAI|^文本助手/.test(provider.name)) provider.name = 'OpenAI 兼容'
    else if (/^Agnes/.test(provider.name)) provider.name = 'Agnes'
  }
  // Pre-import configurations could point at transient environment models that were never saved.
  for (const [purpose, id] of Object.entries(next.defaults)) {
    if (id && id !== '@auto' && !next.models.some(model => model.id === id)) next.defaults[purpose as ModelPurpose] = ''
  }
  next.imported = true
  next.schemaVersion = 2
  return next
}
