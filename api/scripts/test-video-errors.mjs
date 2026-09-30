import test from 'node:test'
import assert from 'node:assert/strict'
import {videoResponseError} from '../dist/providers/video-errors.js'
import {OpenAiVideoProvider} from '../dist/providers/openai-video.js'
import {validateGeneration} from '../dist/models/validation.js'
import {estimatedVideoProgress, exactProgress, expectedVideoDuration, timestampMilliseconds} from '../dist/providers/progress.js'

test('fallback progress is explicit, monotonic and never claims completion', () => {
  const startedAt = 1_000_000
  const duration = expectedVideoDuration('agnes-video-2.5-flash')
  const samples = [0, 60_000, 240_000, 720_000, 3_600_000]
    .map(elapsed => estimatedVideoProgress(startedAt, duration, startedAt + elapsed))
  assert.deepEqual([...samples].sort((a, b) => a - b), samples)
  assert.ok(samples[0] >= 1)
  assert.ok(samples.at(-1) <= 95)
  assert.equal(exactProgress(undefined), undefined)
  assert.equal(exactProgress('10'), 10)
  assert.equal(exactProgress('not-a-number'), undefined)
  assert.equal(timestampMilliseconds(1_700_000_000), 1_700_000_000_000)
  assert.equal(timestampMilliseconds('2026-09-30T00:00:00Z'), Date.parse('2026-09-30T00:00:00Z'))
})

test('video diagnostics distinguish duration, moderation, quota and unavailable credentials without leaking bodies', () => {
  for (const [payload, expected] of [
    [{error: {message: 'duration must be between 1 and 10 seconds'}}, /时长被上游拒绝/],
    [{detail: [{msg: 'invalid resolution'}]}, /分辨率或画幅/],
    [{data: {error: {code: 'content_policy_violation'}}}, /安全审核/],
    [{error: 'insufficient_quota'}, /额度不足/],
    [{error: 'auth_unavailable: no auth available'}, /没有可用认证资源/],
  ]) {
    const error = videoResponseError(400, {...payload, prompt: 'private prompt', token: 'secret'}, '视频创建')
    assert.match(error.message, expected)
    assert.match(error.message, /未自动重复提交/)
    assert.equal(error.statusCode, 400)
    assert.doesNotMatch(error.message, /private prompt|secret/)
  }
  assert.doesNotMatch(videoResponseError(400, {error: 'Bearer secret https://private/?token=secret private prompt'}, '视频创建').message, /secret|private/)
  assert.match(videoResponseError(400, null, '视频创建').message, /未获得更具体/)
})

test('failed submission surfaces diagnosis and never submits twice', async () => {
  const provider = new OpenAiVideoProvider({baseUrl: 'https://example.invalid', apiKey: 'secret'})
  let calls = 0
  provider.response = async () => {calls++; return {ok: false, status: 400, payload: {error: {message: 'duration must be <= 10 seconds'}}}}
  await assert.rejects(provider.run({kind: 'video', model: 'test', prompt: 'test', parameters: {seconds: 18}}, () => {}), /时长被上游拒绝/)
  assert.equal(calls, 1)
})

test('unsupported adapter parameters never reach upstream', async () => {
  const provider = new OpenAiVideoProvider({baseUrl: 'https://example.invalid', apiKey: 'secret'})
  let calls = 0
  provider.response = async () => {calls++; throw new Error('must not submit')}
  for (const parameters of [{seconds: 0}, {seconds: 1.5}, {resolution: '1080p'}]) {
    await assert.rejects(provider.run({kind: 'video', model: 'test', prompt: 'test', parameters}, () => {}), /尚未提交上游/)
  }
  assert.equal(calls, 0)
})

test('configured duration bounds remain authoritative; no guessed ten second ceiling', () => {
  const model = {kind: 'video', capabilities: {referenceImages: 1, sizes: [], resolutions: [], aspectRatios: [], minSeconds: 1, maxSeconds: 18}}
  assert.doesNotThrow(() => validateGeneration(model, 0, {seconds: 18}))
  for (const seconds of [0, 1.5, 19, 'NaN']) assert.throws(() => validateGeneration(model, 0, {seconds}), /整数/)
})
