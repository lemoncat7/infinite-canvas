import test from 'node:test'
import assert from 'node:assert/strict'
import { ProviderKeyPool, credentialId, withProviderKeys } from '../dist/models/key-pool.js'
import { providerInput } from '../dist/models/validation.js'
import { modelFetch } from '../dist/models/network.js'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { configuredProvider } from '../dist/models/runtime.js'

const connection = { id: 'pool', name: 'pool', baseUrl: 'https://example.invalid/v1', apiKey: 'one', apiKeys: ['one', 'two'], proxyUrl: '', enabled: true }
test('multiple credentials retain, remove, deduplicate and support legacy input', () => {
  const draft = { name: 'pool', baseUrl: connection.baseUrl, apiKeys: [' three ', 'three'], retainedKeyIds: [credentialId('two')] }
  const updated = providerInput(draft, 'pool', connection)
  assert.deepEqual(updated.apiKeys, ['two', 'three'])
  assert.equal(updated.apiKey, 'two')
  assert.deepEqual(providerInput({ ...draft, apiKeys: [], retainedKeyIds: [] }, 'pool', connection).apiKeys, [])
  assert.deepEqual(providerInput({ name: 'pool', baseUrl: connection.baseUrl, apiKey: '' }, 'pool', connection).apiKeys, ['one', 'two'])
  assert.deepEqual(providerInput({ name: 'pool', baseUrl: connection.baseUrl, apiKey: 'legacy' }, 'pool', connection).apiKeys, ['legacy'])
  assert.throws(() => providerInput({ ...draft, retainedKeyIds: ['unknown'] }, 'pool', connection), /刷新/)
  assert.throws(() => providerInput({ ...draft, apiKeys: Array(33).fill('key') }, 'pool'), /32/)
})
test('429 rotates, honors Retry-After and expires shared cooldown without exposing secrets', async () => {
  let now = 1_000_000; const pool = new ProviderKeyPool(() => now), seen = []
  await pool.session(connection).run(async key => { seen.push(key); return new Response('{}', { status: key === 'one' ? 429 : 200, headers: { 'retry-after': '120' } }) })
  assert.deepEqual(seen, ['one', 'two'])
  assert.equal(pool.status(connection)[0].cooldownUntil, new Date(now + 120_000).toISOString())
  assert.doesNotMatch(JSON.stringify(pool.status(connection)), /"one"|"two"/)
  await pool.session({ ...connection, id: 'another-model' }).run(async key => { assert.equal(key, 'two'); return new Response('{}') })
  now += 120_001
  await pool.session(connection).run(async key => { assert.equal(key, 'one'); return new Response('{}') })
})
test('quota and authentication cooldowns; no requests when all keys are cooling', async () => {
  const pool = new ProviderKeyPool(), seen = []
  await assert.rejects(pool.session(connection).run(async key => { seen.push(key); return new Response(key === 'one' ? '{"code":"insufficient_quota"}' : '{}', { status: key === 'one' ? 429 : 401 }) }), /冷却/)
  assert.deepEqual(pool.status(connection).map(k => k.reason), ['quota', 'authentication'])
  await assert.rejects(pool.session(connection).run(async () => { throw new Error('must not send') }), /冷却/)
  assert.equal(seen.length, 2)
  await pool.session({ ...connection, baseUrl: 'https://other.invalid' }).run(async () => new Response('{}'))
})
test('transport failure, generic 400 and 5xx do not replay against another key', async () => {
  const pool = new ProviderKeyPool(); let calls = 0
  await assert.rejects(pool.session(connection).run(async () => { calls++; throw new Error('timeout') }), /timeout/)
  assert.equal(calls, 1)
  for (const status of [400, 500, 503]) {
    calls = 0
    const response = await pool.session(connection).run(async () => { calls++; return new Response('{}', { status }) })
    assert.equal(response.status, status); assert.equal(calls, 1)
  }
})
test('accepted video is pinned: failed polling never switches keys or creates another task', async () => {
  const pool = new ProviderKeyPool(), session = pool.session(connection, true), seen = []
  await session.run(async key => { seen.push(key); return new Response('{"id":"video-1"}') })
  await assert.rejects(session.run(async key => { seen.push(key); return new Response('{}', { status: 429 }) }), /冷却/)
  assert.deepEqual(seen, ['one', 'one'])
  await assert.rejects(session.run(async () => { throw new Error('must not send') }), /冷却/)
})
test('concurrent requests use different keys and successful streams are never consumed by the pool', async () => {
  const pool = new ProviderKeyPool(), seen = []
  const results = await Promise.all([1, 2].map(() => pool.session(connection).run(async key => { seen.push(key); return new Response('data: hello\n\n') })))
  assert.deepEqual(seen, ['one', 'two'])
  assert.equal(await results[0].text(), 'data: hello\n\n')
})
test('Retry-After date, abort and uncredentialed local endpoints', async () => {
  const now = 1_000_000, pool = new ProviderKeyPool(() => now)
  await assert.rejects(pool.session({ ...connection, apiKeys: ['one'] }).run(async () => new Response('{}', { status: 429, headers: { 'retry-after': new Date(now + 300_000).toUTCString() } })), /冷却/)
  assert.equal(pool.status(connection)[0].cooldownUntil, new Date(now + 300_000).toISOString())
  await assert.rejects(pool.session(connection).run(async () => { throw new Error('unexpected send') }, AbortSignal.abort()), /abort/i)
  await pool.session({ ...connection, apiKey: '', apiKeys: [] }).run(async key => { assert.equal(key, ''); return new Response('{}') })
})
test('real video adapter rotates rejected creation and polls the accepted key only', async t => {
  const seen = [], server = createServer((req, res) => {
    seen.push([req.method, req.headers.authorization])
    const rejected = req.headers.authorization === 'Bearer one'
    res.writeHead(rejected ? 429 : 200, { 'content-type': 'application/json' })
    res.end(rejected ? '{}' : req.method === 'POST' ? '{"id":"video-1"}' : '{"status":"completed","url":"https://example.invalid/video.mp4"}')
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  const result = await configuredProvider({ revision: 1, connection: { ...connection, baseUrl: `http://127.0.0.1:${server.address().port}` }, model: { adapter: 'openai-video', kind: 'video', model: 'test-video' } }).run({ internalJobId: 'test', projectId: 'test', nodeId: 1, kind: 'video', model: 'test-video', prompt: 'test' }, () => {})
  assert.equal(result.status, 'succeeded')
  assert.deepEqual(seen, [['POST', 'Bearer one'], ['POST', 'Bearer two'], ['GET', 'Bearer two']])
})
test('buffered generation transport rotates authorization under an execution context', async t => {
  const seen = [], server = createServer((req, res) => {
    seen.push(req.headers.authorization)
    res.writeHead(req.headers.authorization === 'Bearer one' ? 429 : 200, { 'content-type': 'application/json' }); res.end('{}')
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  const url = `http://127.0.0.1:${server.address().port}`
  const response = await withProviderKeys({ ...connection, baseUrl: url }, false, () => modelFetch(`${url}/v1/images/generations`, { method: 'POST', body: '{}', signal: AbortSignal.timeout(3000) }))
  assert.equal(response.status, 200); assert.deepEqual(seen, ['Bearer one', 'Bearer two'])
})
