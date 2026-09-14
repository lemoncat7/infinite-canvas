import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, openSync, fsyncSync, closeSync, unlinkSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { ModelSecrets } from './secrets.js'
import { legacyModels } from './legacy.js'
import { modelInput, providerInput } from './validation.js'
import { ModelConfigError, purposeKinds, type ModelConfiguration, type ModelKind, type ModelPurpose, type ResolvedModel } from './types.js'

export class ModelStore {
  private config: ModelConfiguration
  readonly secrets: ModelSecrets
  private readonly path: string
  private readonly legacy: ModelConfiguration
  constructor(directory: string, env = process.env) {
    mkdirSync(directory, { recursive: true })
    this.path = `${directory}/model-config.json`
    this.secrets = new ModelSecrets(directory, existsSync(this.path))
    this.legacy = legacyModels(env)
    this.config = existsSync(this.path) ? this.secrets.open<ModelConfiguration>(readFileSync(this.path, 'utf8')) : { revision: 0, imported: false, providers: [], models: [], defaults: {} }
  }
  private effective(): ModelConfiguration {
    return this.config.imported ? this.config : { ...this.config,
      providers: [...this.legacy.providers, ...this.config.providers], models: [...this.legacy.models, ...this.config.models], defaults: { ...this.legacy.defaults, ...this.config.defaults } }
  }
  admin() {
    const value = this.effective()
    return { ...value, providers: value.providers.map(({ apiKey, apiKeys, ...provider }) => ({ ...provider, hasKey: !!apiKey, keyCount: apiKeys?.length || (apiKey ? 1 : 0), readOnly: !value.imported && provider.id.startsWith('env-') })) }
  }
  catalog() {
    const value = this.effective(), enabled = new Set(value.providers.filter(p => p.enabled).map(p => p.id))
    return { revision: value.revision, defaults: value.defaults, models: value.models.map(m => ({ ...m, enabled: m.enabled && enabled.has(m.providerId) })).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)) }
  }
  private save(expected: unknown, mutate: (draft: ModelConfiguration) => void) {
    if (expected !== this.config.revision) throw new ModelConfigError('配置已被其他管理员更新，请刷新后再保存；当前输入不会自动覆盖', 409)
    const draft = structuredClone(this.config)
    mutate(draft)
    if (draft.providers.length > 100 || draft.models.length > 1000) throw new ModelConfigError('最多支持 100 个连接和 1000 个模型')
    const effective = draft.imported ? draft : { ...draft, providers: [...this.legacy.providers, ...draft.providers], models: [...this.legacy.models, ...draft.models], defaults: { ...this.legacy.defaults, ...draft.defaults } }
    for (const [purpose, id] of Object.entries(effective.defaults)) {
      if (!id) continue
      const model = effective.models.find(m => m.id === id)
      if (!model?.enabled || model.kind !== purposeKinds[purpose as ModelPurpose] || !effective.providers.find(p => p.id === model.providerId)?.enabled) throw new ModelConfigError('请先为默认用途指定可用的替代模型，再停用当前模型或连接')
    }
    draft.revision++
    const temp = `${this.path}.${randomUUID()}.tmp`
    try {
      writeFileSync(temp, this.secrets.seal(draft), { mode: 0o600, flag: 'wx' })
      const fd = openSync(temp, 'r'); try { fsyncSync(fd) } finally { closeSync(fd) }
      renameSync(temp, this.path)
      this.config = draft
    } finally { if (existsSync(temp)) unlinkSync(temp) }
    return this.admin()
  }
  importEnvironment(revision: unknown) { return this.save(revision, draft => {
    if (draft.imported) throw new ModelConfigError('环境配置已导入，不会重复覆盖')
    draft.providers.unshift(...this.legacy.providers); draft.models.unshift(...this.legacy.models)
    draft.defaults = { ...this.legacy.defaults, ...draft.defaults }; draft.imported = true
  }) }
  saveProvider(body: Record<string, unknown>, id?: string) { return this.save(body.revision, draft => {
    const old = id ? draft.providers.find(p => p.id === id) : undefined
    if (id && !old) throw new ModelConfigError('连接不存在或仍由环境变量管理，请先导入', 404)
    const next = providerInput(body, id || randomUUID(), old)
    draft.providers = [...draft.providers.filter(p => p.id !== next.id), next]
  }) }
  saveModel(body: Record<string, unknown>, id?: string) { return this.save(body.revision, draft => {
    if (id && !draft.models.some(m => m.id === id)) throw new ModelConfigError('模型不存在或仍由环境变量管理，请先导入', 404)
    const next = modelInput(body, id || `global:${randomUUID()}`)
    if (![...draft.providers, ...(!draft.imported ? this.legacy.providers : [])].some(p => p.id === next.providerId)) throw new ModelConfigError('请选择有效服务商')
    draft.models = [...draft.models.filter(m => m.id !== next.id), next]
  }) }
  saveDefaults(body: Record<string, unknown>) { return this.save(body.revision, draft => {
    const defaults = body.defaults as Record<string, unknown>
    if (!defaults || typeof defaults !== 'object') throw new ModelConfigError('默认模型配置无效')
    for (const [purpose, id] of Object.entries(defaults)) {
      if (!Object.hasOwn(purposeKinds, purpose) || typeof id !== 'string') throw new ModelConfigError('默认用途或模型无效')
      draft.defaults[purpose as ModelPurpose] = id
    }
  }) }
  connection(id: string) {
    const connection = this.effective().providers.find(p => p.id === id)
    if (!connection) throw new ModelConfigError('服务商不存在', 404)
    return structuredClone(connection)
  }
  resolve(requested: string | undefined, kind: ModelKind, purpose: ModelPurpose): ResolvedModel | undefined {
    const config = this.effective(), id = requested || config.defaults[purpose]
    const exact = config.models.find(m => m.id === id)
    const aliases = config.models.filter(m => m.model === id && m.kind === kind)
    if (!exact && aliases.length > 1) throw new ModelConfigError('有多个同名模型，请在模型菜单中重新选择')
    const model = exact || aliases[0]
    if (!model) {
      if (id?.startsWith('global:') || config.imported || requested || Object.hasOwn(this.config.defaults, purpose)) throw new ModelConfigError('模型不存在或未指定默认，请重新选择', 404)
      return undefined
    }
    const connection = config.providers.find(p => p.id === model.providerId)
    if (!model.enabled || !connection?.enabled || model.kind !== kind) throw new ModelConfigError('模型已停用或类型不匹配，请重新选择')
    return structuredClone({ revision: config.revision, model, connection })
  }
}
