import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgnesVideoProvider } from '../dist/providers/agnes-video.js'
import { OpenAiVideoProvider } from '../dist/providers/openai-video.js'
import { TrackingDeferred, TrackingStopped } from '../dist/providers/task-tracking.js'
import { ProviderKeyPool, withProviderKeys } from '../dist/models/key-pool.js'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'canvas-tracking-test-'))
const { database, getOne } = await import('../dist/storage/database.js')
const { saveAcceptedTask, loadAcceptedTask, deferTracking, recoverTracking, checkTracking } = await import('../dist/generation/task-tracking.js')
const { nextQueuedGenerationJob } = await import('../dist/generation/queue.js')
const input = { internalJobId: 'tracking', projectId: 'test', nodeId: 1, kind: 'video', model: 'agnes-video-v2.0', prompt: 'test' }
const connection = { baseUrl: 'https://example.invalid', apiKey: 'one', apiKeys: ['one', 'two'], proxyUrl: '' }
const json = (payload, status = 200) => new Response(JSON.stringify(payload), { status })

for (const failure of ['SSL connection timeout', 'curl: (92) HTTP/2 stream error', 429, 502, 503, 404]) {
  test(`Agnes polling ${failure}: resumes same ID/key, exactly one creation`, async () => {
    let checkpoint, creates = 0, broken = true
    const seen = [], pool = new ProviderKeyPool()
    const provider = new AgnesVideoProvider(connection)
    provider.pollInterval = 1
    provider.requestWithKey = async (path, init, timeout, key) => {
      seen.push({ path, key })
      if (init.method === 'POST') { creates++; return json({ id: 'accepted-1' }) }
      if (broken) {
        if (typeof failure === 'string') throw new Error(failure)
        return json({}, failure)
      }
      return json({ status: 'completed', url: 'https://example.invalid/result.mp4' })
    }
    await assert.rejects(withProviderKeys(connection, true, () => provider.run({ ...input, saveAcceptedTask: task => { checkpoint = task } }, () => {}), pool), TrackingDeferred)
    assert.equal(checkpoint.id, 'accepted-1')
    broken = false
    // New process/session equivalent: no shared pool health or pin; restore persisted identity.
    const result = await withProviderKeys(connection, true, () => provider.run({ ...input, acceptedTask: checkpoint,
      inputUrls: ['missing-original'], readInputAsDataUrl: () => { throw new Error('must not reload originals') } }, () => {}), new ProviderKeyPool())
    assert.equal(result.status, 'succeeded')
    assert.equal(creates, 1)
    assert.ok(seen.every(request => request.key === checkpoint.key))
    assert.ok(seen.filter(request => !request.path.endsWith('/videos')).every(request => request.path.includes('accepted-1')))
  })
}

test('Agnes elapsed slice and malformed responses defer, explicit upstream failure terminates', async () => {
  const provider = new AgnesVideoProvider(connection)
  provider.pollInterval = 1; provider.timeout = 5
  const acceptedTask = { provider: provider.name, id: 'original', key: 'one' }
  provider.requestWithKey = async () => new Response('not json')
  await assert.rejects(provider.run({ ...input, acceptedTask }, () => {}), TrackingDeferred)
  provider.requestWithKey = async () => json({ status: 'failed', error: 'confirmed failure' })
  await assert.rejects(provider.run({ ...input, acceptedTask }, () => {}), /confirmed failure/)
  await assert.rejects(provider.run({ ...input, acceptedTask, checkTracking: () => { throw new TrackingStopped() } }, () => {}), TrackingStopped)
})

test('creation transport failure never retries and has no accepted checkpoint', async () => {
  const provider = new AgnesVideoProvider(connection)
  let creates = 0, checkpoint
  provider.requestWithKey = async () => { creates++; throw new Error('ambiguous POST timeout') }
  await assert.rejects(withProviderKeys(connection, true, () => provider.run({ ...input, saveAcceptedTask: task => { checkpoint = task } }, () => {})), /ambiguous/)
  assert.equal(creates, 1); assert.equal(checkpoint, undefined)
})

test('OpenAI-compatible video query failures resume without resubmitting', async () => {
  const provider = new OpenAiVideoProvider(connection)
  let checkpoint, creates = 0, broken = true
  provider.response = async (path, init, key) => {
    if (init.method === 'POST') { creates++; return { ok: true, status: 200, payload: { id: 'grok-1' } } }
    assert.equal(path, '/v1/videos/grok-1')
    if (broken) throw new Error('fetch failed')
    assert.equal(key, 'one')
    return { ok: true, status: 200, payload: { status: 'completed', url: 'https://example.invalid/result.mp4' } }
  }
  await assert.rejects(provider.run({ ...input, saveAcceptedTask: task => { checkpoint = task } }, () => {}), TrackingDeferred)
  broken = false
  assert.equal((await provider.run({ ...input, acceptedTask: checkpoint }, () => {})).status, 'succeeded')
  assert.equal(creates, 1)
})

test('checkpoint storage is encrypted and excluded from public jobs; restart/cancel preserve semantics', () => {
  const now = new Date().toISOString()
  database.run("INSERT INTO jobs(id,node_id,kind,prompt,model,status,progress,created_at,updated_at) VALUES ('durable',1,'video','test','test','running',47,?,?)", [now, now])
  const task = { provider: 'agnes-video', id: 'upstream-private', key: 'secret-credential' }
  saveAcceptedTask('durable', task)
  assert.deepEqual(loadAcceptedTask('durable'), task)
  const encrypted = getOne("SELECT checkpoint FROM video_task_checkpoints WHERE job_id='durable'").checkpoint
  assert.ok(!encrypted.includes(task.key)); assert.ok(!encrypted.includes(task.id))
  assert.ok(!JSON.stringify(getOne("SELECT * FROM jobs WHERE id='durable'")).includes(task.key))
  deferTracking('durable', new TrackingDeferred())
  let job = getOne("SELECT * FROM jobs WHERE id='durable'")
  assert.equal(job.status, 'running'); assert.equal(job.progress, 47)
  assert.equal(job.credit_settled, 0)
  assert.equal(nextQueuedGenerationJob('video'), undefined)
  recoverTracking()
  assert.equal(nextQueuedGenerationJob('video').id, 'durable')
  database.run("UPDATE jobs SET status='canceled' WHERE id='durable'")
  assert.throws(() => checkTracking('durable', false), TrackingStopped)
  deferTracking('durable', new TrackingDeferred()); recoverTracking()
  assert.equal(getOne("SELECT status FROM jobs WHERE id='durable'").status, 'canceled')
  assert.equal(nextQueuedGenerationJob('video'), undefined)
})

test('restored multi-key session never rotates an already accepted task', async () => {
  const pool = new ProviderKeyPool(), session = pool.session(connection, true)
  session.restoreKey('two')
  const seen = []
  await assert.rejects(session.run(async key => { seen.push(key); return json({}, 401) }))
  assert.deepEqual(seen, ['two'])
  assert.equal(session.pinnedKey(), 'two')
})

test('real worker defers tracking errors without settling credits or losing progress', async () => {
  const { executeQueuedJob } = await import('../dist/generation/queue.js')
  const { modelStore } = await import('../dist/generation/config.js')
  const now = new Date().toISOString()
  database.run("INSERT INTO jobs(id,node_id,kind,prompt,model,status,progress,created_at,updated_at,model_snapshot) VALUES ('worker',1,'video','test','test','running',63,?,?,?)", [now, now,
    modelStore.secrets.seal({ revision: 1, connection, model: { adapter: 'agnes-video', kind: 'video', model: 'test' } })])
  saveAcceptedTask('worker', { provider: 'agnes-video', id: 'accepted-worker', key: 'two' })
  const original = AgnesVideoProvider.prototype.requestWithKey
  process.env.AGNES_VIDEO_POLL_INTERVAL_MS = '1'
  AgnesVideoProvider.prototype.requestWithKey = async (path, init) => {
    assert.notEqual(init.method, 'POST')
    assert.ok(path.includes('accepted-worker'))
    throw new Error('SSL connection timeout')
  }
  try {
    await executeQueuedJob(getOne("SELECT * FROM jobs WHERE id='worker'"))
    const job = getOne("SELECT * FROM jobs WHERE id='worker'")
    assert.equal(job.status, 'running'); assert.equal(job.credit_settled, 0)
    assert.equal(job.progress, 63); assert.ok(job.retry_after)
    assert.match(job.error, /不会重复生成/)
  } finally { AgnesVideoProvider.prototype.requestWithKey = original }
})
