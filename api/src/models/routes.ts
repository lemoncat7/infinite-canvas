import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { ModelStore } from './store.js'
import { ModelConfigError } from './types.js'
import { discoverModels } from './network.js'
import { configuredProvider } from './runtime.js'

export function registerModelRoutes(app: FastifyInstance, store: ModelStore, guards: {
  user(request: FastifyRequest, reply: FastifyReply): unknown;
  admin(request: FastifyRequest, reply: FastifyReply): unknown;
}) {
  const busy = new Set<string>()
  const route = (method: 'GET' | 'POST' | 'PUT', url: string, action: (body: Record<string, unknown>, id: string) => unknown, admin = true) => {
    app.route({ method, url, handler: async (request, reply) => {
      if (!(admin ? guards.admin : guards.user)(request, reply)) return
      reply.header('cache-control', 'no-store')
      if (method !== 'GET') {
        const origin = request.headers.origin
        if (origin) {
          let matches = false
          try { matches = new URL(origin).host === request.headers.host } catch { /* malformed Origin is denied */ }
          if (!matches) return reply.code(403).send({ error: '不允许跨站修改模型配置' })
        }
        if (!request.headers['content-type']?.startsWith('application/json')) return reply.code(415).send({ error: '请使用 JSON 请求' })
      }
      try { return await action((request.body || {}) as Record<string, unknown>, (request.params as { id?: string }).id || '') }
      catch (error) { return reply.code(error instanceof ModelConfigError ? error.statusCode : 500).send({ error: error instanceof ModelConfigError ? error.message : '模型配置操作失败，请重试；服务商错误正文已隐藏' }) }
    } })
  }
  route('GET', '/models/catalog', () => store.catalog(), false)
  route('GET', '/admin/models', () => store.admin())
  route('POST', '/admin/models/import-environment', body => store.importEnvironment(body.revision))
  route('POST', '/admin/model-providers', body => store.saveProvider(body))
  route('PUT', '/admin/model-providers/:id', (body, id) => store.saveProvider(body, id))
  route('POST', '/admin/models', body => store.saveModel(body))
  route('PUT', '/admin/models/:id', (body, id) => store.saveModel(body, id))
  route('PUT', '/admin/model-defaults', body => store.saveDefaults(body))
  async function exclusive<T>(key: string, run: () => Promise<T>) {
    if (busy.has(key) || busy.size >= 10) throw new ModelConfigError('已有测试正在执行，请稍后重试', 429)
    busy.add(key); try { return await run() } finally { busy.delete(key) }
  }
  route('POST', '/admin/model-providers/:id/discover', (_body, id) => exclusive(id, async () => ({ models: await discoverModels(store.connection(id)), checkedAt: new Date().toISOString() })))
  route('POST', '/admin/models/:id/test', (body, id) => exclusive(id, async () => {
    if (body.confirmCost !== true) throw new ModelConfigError('实际生成测试可能产生上游费用，请先确认')
    const model = store.catalog().models.find(m => m.id === id)
    if (!model || model.kind === 'text') throw new ModelConfigError('请选择已启用的图片或视频模型进行实际测试')
    const resolved = store.resolve(id, model.kind, model.kind)!
    const c = model.capabilities
    const parameters = model.kind === 'video'
      ? { seconds: c.minSeconds, ...(c.resolutions.length ? { resolution: c.resolutions[0] } : {}), ...(c.aspectRatios.length ? { aspect_ratio: c.aspectRatios[0] } : {}) }
      : c.sizes.length ? { size: c.sizes[0] } : {}
    const result = await configuredProvider(resolved).run({ internalJobId: 'admin-test', projectId: 'admin-test', nodeId: 0, kind: model.kind, model: model.model, prompt: 'A small blue circle on a plain white background.', parameters }, () => {})
    if (result.status !== 'succeeded') throw new ModelConfigError('测试未生成成功，请检查服务商配置后重试', 502)
    return { ok: true, message: '已收到生成结果。测试结果不写入用户画布。' }
  }))
}
