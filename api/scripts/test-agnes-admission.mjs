import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agnesResponseError, AgnesQueueCapacityError } from '../dist/providers/agnes-errors.js'
import { ProviderKeyPool, withProviderKeys } from '../dist/models/key-pool.js'
import { TrackingDeferred } from '../dist/providers/task-tracking.js'
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'agnes-admission-'))
process.env.AGNES_VIDEO_KEY_COOLDOWN_MS = '1000'
const { AgnesVideoProvider } = await import('../dist/providers/agnes-video.js')
const { database, getOne } = await import('../dist/storage/database.js')
const { executeQueuedJob, isProviderQueueCapacityError } = await import('../dist/generation/queue.js')
const { modelStore } = await import('../dist/generation/config.js')
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'x-request-id': 'request-12345678' } })
const connection = { baseUrl: 'https://example.invalid', apiKey: 'secret', apiKeys: ['secret', 'secret2'] }
const input = { internalJobId: 'test', projectId: 'test', nodeId: 1, kind: 'video', model: 'agnes-video-2.5-flash', prompt: 'test' }

for (const body of [{ video_id: 'video-1', task_id: 'task-1' }, { task_id: 'task-1' }, { id: 'task-1' }, { data: { video_id: 'video-1', task_id: 'task-1' } }]) {
  test(`persist accepted identity before cloud state: ${JSON.stringify(body)}`, async () => {
    const p = new AgnesVideoProvider(connection); p.pollInterval = 1
    let saved, creates = 0
    p.requestWithKey = async (path, init) => {
      if (init.method === 'POST') { creates++; return json(body) }
      assert.ok(path.includes(saved.id)); throw new Error('query timeout')
    }
    await assert.rejects(p.run({ ...input, saveAcceptedTask: task => { saved = task } }, update => {
      if (update.stage === 'cloud_queue') { assert.ok(saved); assert.equal(update.resultMetadata.videoId, saved.id) }
    }), TrackingDeferred)
    assert.equal(saved.taskId, 'task-1'); assert.equal(creates, 1)
  })
}
test('invalid or missing success ID never enters cloud queue or resubmits', async () => {
  for (const body of [null, {}, { id: {} }, { id: '  ' }, { id: 'https://bad.test/key' }, { error: 'rejected', data: { id: 'not-accepted' } }]) {
    const p = new AgnesVideoProvider(connection); let creates = 0
    p.requestWithKey = async () => { creates++; return json(body) }
    await assert.rejects(p.run({ ...input, saveAcceptedTask: () => assert.fail('must not save') }, u => assert.notEqual(u.stage, 'cloud_queue')), /未返回有效任务 ID/)
    assert.equal(creates, 1)
  }
})
test('wrapped completed status wins over stale internal pending status', async () => {
  const p = new AgnesVideoProvider(connection); p.pollInterval = 1
  p.requestWithKey = async (_path, init) => {
    assert.notEqual(init.method, 'POST')
    return json({ data: { status: 'completed', internal_status: 'pending', url: 'https://example.invalid/video.mp4' } })
  }
  const result = await p.run({ ...input, acceptedTask: { provider: 'agnes-video', id: 'existing-id', key: 'secret' } }, () => {})
  assert.equal(result.status, 'succeeded')
})
test('capacity, ordinary rate limit and diagnostics remain distinct', () => {
  for (const status of [429, 503]) {
    const error = agnesResponseError(status, { code: 'video_queue_full', message: 'private body' }, 'create', new Headers({ 'x-request-id': 'request-12345678' }))
    assert.ok(error instanceof AgnesQueueCapacityError); assert.ok(isProviderQueueCapacityError(error))
    assert.match(error.message, new RegExp(`HTTP ${status}`)); assert.match(error.message, /request-12345678/)
    assert.doesNotMatch(error.message, /private body/)
  }
  const limited = agnesResponseError(429, { message: 'rate limit' }, 'create')
  assert.equal(isProviderQueueCapacityError(limited), false)
  const unsafe = agnesResponseError(503, { code: 'video_queue_full', message: 'Bearer secret' }, 'create', new Headers({ 'x-request-id': 'https://private/key' }))
  assert.doesNotMatch(unsafe.message, /secret|private/)
})
test('capacity 429 does not rotate credentials or lose upstream diagnosis', async () => {
  const p = new AgnesVideoProvider(connection); let calls = 0
  p.requestWithKey = async () => { calls++; return json({ code: 'video_queue_full', message: 'video queue is full' }, 429) }
  await assert.rejects(withProviderKeys(connection, true, () => p.run(input, () => {}), new ProviderKeyPool()), AgnesQueueCapacityError)
  assert.equal(calls, 1)
})
test('worker capacity retry has no checkpoint and preserves failure diagnostics', async () => {
  const id = 'capacity-worker', now = new Date().toISOString()
  database.run("INSERT INTO jobs(id,node_id,kind,prompt,model,status,created_at,updated_at,model_snapshot) VALUES (?,1,'video','test','agnes-video-2.5-flash','running',?,?,?)", [id, now, now, modelStore.secrets.seal({ revision: 1, connection, model: { adapter: 'agnes-video', kind: 'video', model: input.model } })])
  const original = AgnesVideoProvider.prototype.requestWithKey
  AgnesVideoProvider.prototype.requestWithKey = async () => json({ code: 'video_queue_full' }, 503)
  try { await executeQueuedJob(getOne('SELECT * FROM jobs WHERE id=?', [id])) } finally { AgnesVideoProvider.prototype.requestWithKey = original }
  const row = getOne('SELECT * FROM jobs WHERE id=?', [id])
  assert.equal(row.status, 'queued'); assert.equal(row.generation_stage, 'upstream_submission')
  assert.equal(row.retry_count, 1); assert.match(row.error, /尚无任务 ID/)
  assert.match(row.error, /HTTP 503/); assert.match(row.error, /request-12345678/)
  assert.equal(getOne('SELECT * FROM video_task_checkpoints WHERE job_id=?', [id]), undefined)
})
