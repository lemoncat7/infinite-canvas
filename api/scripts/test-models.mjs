import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { ModelStore } from '../dist/models/store.js'
import { registerModelRoutes } from '../dist/models/routes.js'
import { validateGeneration } from '../dist/models/validation.js'
import { configuredProvider } from '../dist/models/runtime.js'
import { safeModelError } from '../dist/models/errors.js'
import { credentialId } from '../dist/models/key-pool.js'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import sharp from 'sharp'

test('sanitized errors retain retry semantics without reflecting secrets', () => {
  for (const [raw, expected] of [['queue is full PRIVATE', /队列已满/], ['ECONNRESET PRIVATE', /network/], ['timeout PRIVATE', /timeout/], ['401 PRIVATE', /认证/], ['PRIVATE', /正文已隐藏/]]) {
    const error = safeModelError(new Error(raw))
    assert.match(error.message, expected)
    assert.doesNotMatch(error.message, /PRIVATE/)
  }
})

function setup(t, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'canvas-model-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return { dir, store: new ModelStore(dir, env) }
}
function provider(store, values = {}) { return store.saveProvider({ revision: store.admin().revision, name: 'Test connection', baseUrl: 'https://example.com/v1', apiKey: 'PRIVATE_TEST_CREDENTIAL', ...values }).providers.at(-1) }
function model(store, providerId, values = {}) { return store.saveModel({ revision: store.admin().revision, name: '中文模型', model: 'image-v1', adapter: 'openai-image', providerId, capabilities: { referenceImages: 1, transparent: true }, ...values }).models.at(-1) }

test('replacement Key persists after restart and old unchecked Keys are actually removed', t => {
  const { dir, store } = setup(t)
  const p = provider(store, { apiKeys: ['old-one', 'old-two'] })
  store.saveProvider({ ...p, revision: store.admin().revision, retainedKeyIds: [], apiKeys: ['new-key'] }, p.id)
  const restored = new ModelStore(dir, {})
  assert.deepEqual(restored.connection(p.id).apiKeys, ['new-key'])
  assert.equal(restored.connection(p.id).apiKey, 'new-key')
  assert.deepEqual(restored.admin().providers[0].keys.map(k => k.id), [credentialId('new-key')])
})

test('encrypted persistence, no credentials in public/admin output, restart and immutable execution snapshot', t => {
  const { dir, store } = setup(t)
  const p = provider(store), m = model(store, p.id)
  store.saveDefaults({ revision: store.admin().revision, defaults: { image: m.id } })
  const snapshot = store.secrets.seal(store.resolve(undefined, 'image', 'image'))
  const next = store.saveProvider({ ...p, revision: store.admin().revision, baseUrl: 'https://second.example.com', apiKey: 'NEW_PRIVATE_CREDENTIAL' }, p.id)
  assert.doesNotMatch(JSON.stringify(next), /PRIVATE_TEST_CREDENTIAL|NEW_PRIVATE_CREDENTIAL/)
  assert.doesNotMatch(JSON.stringify(store.catalog()), /baseUrl|apiKey|proxyUrl/)
  assert.doesNotMatch(readFileSync(join(dir, 'model-config.json'), 'utf8'), /PRIVATE|image-v1|second.example/)
  const restored = new ModelStore(dir, {})
  assert.equal(restored.resolve(undefined, 'image', 'image').connection.apiKey, 'NEW_PRIVATE_CREDENTIAL')
  assert.equal(restored.secrets.open(snapshot).connection.apiKey, 'PRIVATE_TEST_CREDENTIAL')
  assert.equal(restored.secrets.open(snapshot).connection.baseUrl, 'https://example.com/v1')
  assert.throws(() => restored.saveProvider({ ...p, revision: 0 }, p.id), /其他管理员/)
  assert.equal(restored.admin().revision, store.admin().revision)
  unlinkSync(join(dir, 'model-config.key'))
  assert.throws(() => new ModelStore(dir, {}), /密钥缺失/)
})

test('defaults protect enabled connections and models; unsupported inputs fail closed', t => {
  const { store } = setup(t), p = provider(store), m = model(store, p.id)
  store.saveDefaults({ revision: store.admin().revision, defaults: { image: m.id } })
  assert.throws(() => store.saveModel({ ...m, enabled: false, revision: store.admin().revision }, m.id), /替代模型/)
  assert.throws(() => store.saveProvider({ ...p, enabled: false, revision: store.admin().revision }, p.id), /替代模型/)
  assert.throws(() => store.resolve(m.id, 'video', 'video'), /类型不匹配/)
  assert.throws(() => store.resolve('arbitrary-model', 'image', 'image'), /不存在/)
  assert.throws(() => provider(store, { baseUrl: 'file:///etc/passwd' }), /HTTP/)
  assert.throws(() => provider(store, { baseUrl: 'http://169.254.169.254/latest' }), /元数据/)
  assert.throws(() => model(store, p.id, { adapter: '__proto__' }), /协议/)
  assert.throws(() => model(store, p.id, { creditCost: -1 }), /点数/)
  assert.throws(() => validateGeneration(m, 2, {}), /参考图/)
  store.saveDefaults({ revision: store.admin().revision, defaults: { image: '' } })
  store.saveModel({ ...m, enabled: false, revision: store.admin().revision }, m.id)
  assert.throws(() => store.resolve(m.id, 'image', 'image'), /停用/)
  assert.throws(() => store.resolve(undefined, 'image', 'image'), /未指定默认/)
})

test('saved configuration upgrades without reading environment and preserves hand-edited models, credentials and backup', t => {
  const { dir, store: initial } = setup(t)
  const p = provider(initial), m = model(initial, p.id, { model: 'user-edited-id' })
  initial.saveDefaults({ revision: initial.admin().revision, defaults: { image: m.id } })
  const config = initial.secrets.open(readFileSync(join(dir, 'model-config.json'), 'utf8'))
  delete config.schemaVersion; config.imported = false
  config.providers[0].id = 'env-image'; config.providers[0].name = '环境 · OpenAI 图片'; config.models[0].providerId = 'env-image'
  config.providers.push({ ...config.providers[0], id: 'env-text', name: '环境 · 文本助手' })
  config.providers.push({ ...config.providers[0], id: 'env-other', name: '环境 · Agnes 视频', apiKey: 'DIFFERENT_KEY', apiKeys: ['DIFFERENT_KEY'] })
  const before = initial.secrets.seal(config)
  writeFileSync(join(dir, 'model-config.json'), before)
  const env = { OPENAI_IMAGE_BASE_URL: 'https://must-not-load.example.com', OPENAI_IMAGE_API_KEY: 'ENV_SECRET' }
  const store = new ModelStore(dir, env)
  assert.equal(store.admin().schemaVersion, 2)
  assert.equal(store.admin().providers.length, 2)
  assert.equal(store.admin().models.length, 1)
  assert.equal(store.resolve(undefined, 'image', 'image').model.model, 'user-edited-id')
  assert.equal(store.connection('env-image').apiKey, 'PRIVATE_TEST_CREDENTIAL')
  assert.equal(store.connection('env-other').apiKey, 'DIFFERENT_KEY')
  assert.doesNotMatch(JSON.stringify(store.admin()), /环境|ENV_SECRET/)
  assert.equal(readFileSync(join(dir, 'model-config.json.before-provider-v2'), 'utf8'), before)
  const restarted = new ModelStore(dir, env)
  assert.equal(restarted.admin().revision, store.admin().revision)
  assert.throws(() => restarted.importEnvironment(store.admin().revision), /取消环境模型导入/)
})

test('pre-import installations do not import environment definitions on upgrade', t => {
  const { dir, store } = setup(t)
  writeFileSync(join(dir, 'model-config.json'), store.secrets.seal({ revision: 0, imported: false, providers: [], models: [], defaults: { video: 'global:env-agnes-video-0' } }))
  const upgraded = new ModelStore(dir, { AGNES_VIDEO_BASE_URL: 'https://example.com', AGNES_VIDEO_API_KEY: 'MUST_NOT_IMPORT' })
  assert.equal(upgraded.admin().providers.length, 0)
  assert.equal(upgraded.catalog().models.length, 0)
  assert.equal(upgraded.catalog().defaults.video, '')
})

test('purpose eligibility and priority govern automatic defaults without switching explicit choices', t => {
  const { store } = setup(t), p = provider(store)
  const first = model(store, p.id, { model: 'first', adapter: 'openai-chat', purposes: ['prompt'], order: 20 })
  const second = model(store, p.id, { model: 'second', adapter: 'openai-chat', purposes: ['prompt', 'comic'], order: 10 })
  store.saveDefaults({ revision: store.admin().revision, defaults: { prompt: '@auto', comic: '@auto' } })
  assert.equal(store.resolve(undefined, 'text', 'prompt').model.id, second.id)
  assert.equal(store.catalog().defaults.comic, second.id)
  assert.throws(() => store.resolve(first.id, 'text', 'comic'), /用途/)
  assert.throws(() => model(store, p.id, { purposes: ['prompt'] }), /用途/)
  store.saveModel({ ...second, enabled: false, revision: store.admin().revision }, second.id)
  assert.equal(store.resolve(undefined, 'text', 'prompt').model.id, first.id)
  assert.throws(() => store.resolve(undefined, 'text', 'comic'), /未指定默认/)
  store.saveDefaults({ revision: store.admin().revision, defaults: { prompt: first.id } })
  assert.throws(() => store.saveModel({ ...first, purposes: [], revision: store.admin().revision }, first.id), /替代模型/)
})

test('new installations ignore environment model definitions', t => {
  const { dir, store } = setup(t, { OPENAI_IMAGE_BASE_URL: 'https://example.com', OPENAI_IMAGE_API_KEY: 'ENV_SECRET' })
  assert.equal(store.admin().imported, true)
  assert.equal(store.admin().providers.length, 0)
  assert.equal(new ModelStore(dir, { OPENAI_IMAGE_BASE_URL: 'https://another.example.com' }).catalog().models.length, 0)
  assert.throws(() => store.resolve(undefined, 'image', 'image'), /未指定默认/)
})

test('routes enforce admin, same-origin mutations, revision, and redact discovery failures', async t => {
  const { store } = setup(t), app = Fastify()
  t.after(() => app.close())
  registerModelRoutes(app, store, {
    user: (request, reply) => request.headers.authorization ? true : (reply.code(401).send({ error: 'login' }), false),
    admin: (request, reply) => request.headers.authorization === 'admin' ? true : (reply.code(403).send({ error: 'admin only' }), false),
  })
  assert.equal((await app.inject({ url: '/models/catalog' })).statusCode, 401)
  assert.equal((await app.inject({ url: '/admin/models', headers: { authorization: 'user' } })).statusCode, 403)
  assert.equal((await app.inject({ url: '/admin/model-providers', method: 'POST', headers: { authorization: 'admin', origin: 'https://evil.example' }, payload: {} })).statusCode, 403)
  for (const origin of ['http://127.0.0.1:4173', 'https://canvas.example:2439']) {
    const host = new URL(origin).host
    const request = { url: '/admin/model-defaults', method: 'PUT', headers: { authorization: 'admin', origin, host }, payload: { revision: -1, defaults: {} } }
    // Full authority passes origin validation and reaches the revision guard.
    assert.equal((await app.inject(request)).statusCode, 409)
    assert.equal((await app.inject({ ...request, headers: { ...request.headers, host: new URL(origin).hostname } })).statusCode, 403)
  }
  const result = await app.inject({ url: '/admin/model-providers', method: 'POST', headers: { authorization: 'admin' }, payload: { revision: 0, name: 'No auth local', baseUrl: 'http://127.0.0.1:1', apiKey: 'PRIVATE_TEST_CREDENTIAL' } })
  assert.equal(result.statusCode, 200)
  assert.doesNotMatch(result.body, /PRIVATE_TEST_CREDENTIAL/)
  const id = result.json().providers[0].id
  const verification = { url: `/admin/model-providers/${id}/verify-key`, method: 'POST', payload: { keyId: credentialId('PRIVATE_TEST_CREDENTIAL') } }
  assert.equal((await app.inject({ ...verification, headers: { authorization: 'user' } })).statusCode, 403)
  assert.equal((await app.inject({ ...verification, headers: { authorization: 'admin', origin: 'https://evil.example' } })).statusCode, 403)
  const verificationFailure = await app.inject({ ...verification, headers: { authorization: 'admin' } })
  assert.equal(verificationFailure.statusCode, 502)
  assert.doesNotMatch(verificationFailure.body, /PRIVATE_TEST_CREDENTIAL/)
  const beforeDiscovery = store.admin().revision
  const changedEndpoint = await app.inject({ url: '/admin/model-providers/discover', method: 'POST', headers: { authorization: 'admin' }, payload: { providerId: id, baseUrl: 'https://different.example', apiKey: '' } })
  assert.equal(changedEndpoint.statusCode, 400)
  assert.doesNotMatch(changedEndpoint.body, /PRIVATE_TEST_CREDENTIAL/)
  const draftDiscovery = await app.inject({ url: '/admin/model-providers/discover', method: 'POST', headers: { authorization: 'admin' }, payload: { name: 'Draft only', baseUrl: 'http://127.0.0.1:1' } })
  assert.equal(draftDiscovery.statusCode, 502)
  assert.equal(store.admin().revision, beforeDiscovery)
  const failed = await app.inject({ url: `/admin/model-providers/${id}/discover`, method: 'POST', headers: { authorization: 'admin' }, payload: {} })
  assert.equal(failed.statusCode, 502)
  assert.doesNotMatch(failed.body, /PRIVATE_TEST_CREDENTIAL/)
})

test('configured adapter calls the snapshotted endpoint/model, not environment defaults', async t => {
  const upstream = Fastify(), requests = []
  upstream.post('/v1/images/generations', async req => { requests.push({ auth: req.headers.authorization, model: req.body.model }); return { data: [{ b64_json: 'dGVzdA==' }] } })
  await upstream.listen({ host: '127.0.0.1', port: 0 }); t.after(() => upstream.close())
  const { store } = setup(t)
  const p = provider(store, { baseUrl: upstream.listeningOrigin }), m = model(store, p.id)
  const snapshot = store.resolve(m.id, 'image', 'image')
  store.saveProvider({ ...p, revision: store.admin().revision, baseUrl: 'http://127.0.0.1:1', apiKey: 'CHANGED' }, p.id)
  const result = await configuredProvider(snapshot).run({ kind: 'image', model: snapshot.model.model, prompt: 'test', internalJobId: 'test', projectId: 'test', nodeId: 1 }, () => {})
  assert.equal(result.status, 'succeeded')
  assert.deepEqual(requests, [{ auth: 'Bearer PRIVATE_TEST_CREDENTIAL', model: 'image-v1' }])
})

test('real API queue retains submitted configuration and cost after admin edits', { timeout: 30000 }, async t => {
  const { dir } = setup(t)
  const upstream = Fastify(), calls = [], textCalls = []
  const png = (await sharp({ create: { width: 16, height: 16, channels: 3, background: '#808080' } }).png().toBuffer()).toString('base64')
  let release
  const barrier = new Promise(resolve => { release = resolve })
  upstream.post('/v1/images/generations', async request => {
    calls.push({ model: request.body.model, auth: request.headers.authorization })
    if (calls.length === 1) await barrier
    return { data: [{ b64_json: png }] }
  })
  upstream.post('/v1/chat/completions', async request => {
    textCalls.push(request.body.model)
    return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ finalPrompt: '一只蓝色小鸟', action: 'create', targetType: 'image', summary: '蓝色小鸟', shouldGenerate: false, steps: [{ title: '小鸟', kind: 'image', prompt: '一只蓝色小鸟', dependsOn: [], referenceIndexes: [] }] }) } }] }
  })
  await upstream.listen({ host: '127.0.0.1', port: 0 })
  const child = spawn(process.execPath, ['dist/server.js'], {
    cwd: new URL('../', import.meta.url),
    env: { PATH: process.env.PATH, DATA_DIR: dir, PORT: '0', GENERATION_PROVIDER: 'router', IMAGE_GENERATION_PROVIDER: 'model-image', VIDEO_GENERATION_PROVIDER: 'model-video', ADMIN_API_KEY: 'test-admin-only', REGISTRATION_INVITE_CODE: 'test-invite', IMAGE_GENERATION_CONCURRENCY: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(async () => { release(); if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit') } await upstream.close() })
  let logs = ''; child.stdout.on('data', data => { logs += data }); child.stderr.on('data', data => { logs += data })
  const until = async predicate => {
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) { const value = await predicate(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 40)) }
    throw new Error('Timed out waiting for isolated model API')
  }
  const address = await until(() => logs.match(/Server listening at http:\/\/[^:"\s]+:(\d+)/)?.[1])
  const base = `http://127.0.0.1:${address}`
  let cookie = ''
  async function request(path, body, admin = false, method = body ? 'POST' : 'GET') {
    const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(admin ? { 'x-admin-key': 'test-admin-only' } : { cookie }) }, body: body ? JSON.stringify(body) : undefined })
    if (path === '/auth/register' || path === '/auth/login') cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    const result = await response.json()
    assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(result)}`)
    return result
  }
  await request('/auth/register', { name: 'model-test', email: 'model-test@example.com', password: 'test-password-only', inviteCode: 'test-invite' })
  // The application's first registered account intentionally becomes administrator.
  await request('/auth/register', { name: 'ordinary-model-test', email: 'ordinary-model-test@example.com', password: 'test-password-only', inviteCode: 'test-invite' })
  assert.equal((await fetch(base + '/admin/models', { headers: { cookie } })).status, 403)
  let config = await request('/admin/model-providers', { revision: 0, name: 'Queue test', baseUrl: upstream.listeningOrigin, apiKey: 'SNAPSHOT_KEY' }, true)
  const connection = config.providers[0]
  config = await request('/admin/models', { revision: config.revision, name: 'Image', model: 'old-image', adapter: 'openai-image', providerId: connection.id, creditCost: 0 }, true)
  const selected = config.models[0]
  const project = (await request('/projects'))[0]
  const submit = nodeId => request('/jobs', { projectId: project.id, nodeId, kind: 'image', model: selected.id, prompt: 'test' })
  const first = await submit(1)
  await until(() => calls.length === 1)
  const second = await submit(2)
  assert.equal((await request(`/jobs/${second.id}`)).status, 'queued')
  config = await request(`/admin/model-providers/${connection.id}`, { ...connection, revision: config.revision, apiKey: 'NEW_KEY' }, true, 'PUT')
  config = await request(`/admin/models/${selected.id}`, { ...selected, revision: config.revision, model: 'new-image', creditCost: 3 }, true, 'PUT')
  release()
  for (const job of [first, second]) {
    const finished = await until(async () => { const value = await request(`/jobs/${job.id}`); return ['succeeded', 'failed'].includes(value.status) && value })
    assert.equal(finished.status, 'succeeded', finished.error)
    assert.equal(finished.credit_cost, 0)
    assert.ok(!Object.hasOwn(finished, 'model_snapshot'))
    assert.doesNotMatch(JSON.stringify(finished), /SNAPSHOT_KEY|NEW_KEY/)
  }
  assert.deepEqual(calls, [{ model: 'old-image', auth: 'Bearer SNAPSHOT_KEY' }, { model: 'old-image', auth: 'Bearer SNAPSHOT_KEY' }])
  const catalog = await request('/models/catalog')
  assert.equal(catalog.models[0].model, 'new-image')
  assert.equal(catalog.models[0].creditCost, 3)
  config = await request('/admin/models', { revision: config.revision, name: 'Custom text', model: 'custom-text-model', adapter: 'openai-chat', providerId: connection.id }, true)
  const textModel = config.models.find(model => model.kind === 'text')
  await request('/admin/model-defaults', { revision: config.revision, defaults: { prompt: textModel.id, comic: textModel.id } }, true, 'PUT')
  const answer = await request('/agents/prompt', { idea: '设计一只蓝色小鸟', kind: 'image' })
  assert.equal(answer.finalPrompt, '一只蓝色小鸟')
  assert.deepEqual(textCalls, ['custom-text-model'])
  const identity = cookie.split('; ').find(value => value.startsWith('flow_browser_device='))
  assert.ok(identity)
  for (let i = 0; i < 3; i++) {
    await request('/auth/login', { email: 'ordinary-model-test@example.com', password: 'test-password-only' })
    assert.equal(cookie.split('; ').find(value => value.startsWith('flow_browser_device=')), identity)
    const devices = await request('/auth/devices')
    assert.equal(devices.length, 1)
    assert.equal(devices[0].current, true)
  }
})
