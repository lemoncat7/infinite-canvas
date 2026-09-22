import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import sharp from 'sharp'
import { URL_FIRST, EMBEDDED_ONLY, prepareReferenceImages, canFallbackReference, submitWithReferenceFallback } from '../dist/providers/reference-transport.js'
import { OpenAiVideoProvider } from '../dist/providers/openai-video.js'
import { canFallbackTerminalReference, runWithTerminalReferenceFallback, ReferenceDownloadFailure } from '../dist/providers/reference-transport.js'

test('terminal fallback excludes active, ambiguous, canceled and unrelated failures', async () => {
  const images = ['https://assets.example/a']
  const error = { code: 'invalid_argument', message: 'Failed to download the provided image (image_download_error=image_download_interrupted)' }
  assert.equal(canFallbackTerminalReference({ status: 'failed', error }, images), true)
  for (const status of ['running', 'queued', 'canceled', 'error', '', 'done']) assert.equal(canFallbackTerminalReference({ status, error }, images), false)
  assert.equal(canFallbackTerminalReference({ status: 'failed', error: 'moderation failed' }, images), false)
  assert.equal(canFallbackTerminalReference({ status: 'failed', error, video: { url: 'result' } }, images), false)
  assert.equal(canFallbackTerminalReference({ status: 'failed', error }, ['data:image/png;base64,AA==']), false)
  let attempts = 0
  await assert.rejects(runWithTerminalReferenceFallback(images, async () => { attempts++; throw new ReferenceDownloadFailure(true) }, async () => ['data:image/png;base64,AA==']))
  assert.equal(attempts, 2)
})

test('accepted task with image download failure retries embedded once without publishing a terminal local failure', async () => {
  const requests = [], updates = []
  let posts = 0
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk
    requests.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null })
    res.setHeader('content-type', 'application/json')
    if (req.method === 'POST') res.end(JSON.stringify({ request_id: `job-${++posts}` }))
    else if (posts === 1) res.end(JSON.stringify({ status: 'failed', error: { code: 'invalid_argument', message: 'Failed to download the provided image (image_download_error=image_download_interrupted)' } }))
    else res.end(JSON.stringify({ status: 'done', video: { url: 'https://output.example/video.mp4' } }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const provider = new OpenAiVideoProvider({ baseUrl: `http://127.0.0.1:${server.address().port}`, apiKey: 'test-only' })
    const result = await provider.run({ kind: 'video', model: 'grok-imagine-video-1.5', prompt: 'test', inputUrls: ['https://assets.example/ref'], readInputAsDataUrl: async () => 'data:image/png;base64,AA==' }, update => updates.push(update))
    assert.equal(result.status, 'succeeded')
    assert.deepEqual(requests.map(r => r.method), ['POST', 'GET', 'POST', 'GET'])
    assert.equal(requests[2].body.input_reference.image_url, 'data:image/png;base64,AA==')
    assert.equal(updates.some(u => u.status === 'failed'), false)
    assert.equal(requests[3].url, '/v1/videos/job-2')
  } finally { await new Promise(resolve => server.close(resolve)) }
})

test('URL first is lazy; embedded fallback preserves ordering and original bytes', async () => {
  const calls = []
  const input = { inputUrls: ['https://assets.example/one', 'https://assets.example/two'], readInputAsDataUrl: async i => { calls.push(i); return `data:image/png;base64,${Buffer.from(String(i)).toString('base64')}` } }
  assert.deepEqual(await prepareReferenceImages(input, URL_FIRST), input.inputUrls)
  assert.deepEqual(calls, [])
  const embedded = await prepareReferenceImages(input, EMBEDDED_ONLY)
  assert.deepEqual(calls, [0, 1])
  assert.ok(embedded[0].endsWith('MA=='))
  assert.ok(embedded[1].endsWith('MQ=='))
})

test('fallback only follows an explicit pre-acceptance image fetch rejection', () => {
  const images = ['https://assets.example/a']
  const error = { error: { message: 'Failed to download reference image' } }
  assert.equal(canFallbackReference(400, error, images), true)
  for (const status of [401, 403, 408, 429, 500, 502, 503]) assert.equal(canFallbackReference(status, error, images), false)
  for (const task of [{ id: 'accepted' }, { request_id: 'accepted' }, { data: { task_id: 'accepted' } }]) assert.equal(canFallbackReference(422, { ...error, ...task }, images), false)
  assert.equal(canFallbackReference(400, { error: 'length limit exceeded' }, images), false)
  assert.equal(canFallbackReference(400, error, ['data:image/png;base64,AA==']), false)
})

test('fallback happens at most once; ambiguous network errors never replay POST', async () => {
  let count = 0
  const submit = async () => { count++; return { ok: false, status: 400, payload: { error: 'image download failed' } } }
  await submitWithReferenceFallback(['https://assets.example/a'], URL_FIRST, submit, async () => ['data:image/png;base64,AA=='])
  assert.equal(count, 2)
  count = 0
  await assert.rejects(submitWithReferenceFallback(['https://assets.example/a'], URL_FIRST, async () => { count++; throw new Error('socket lost') }, async () => []))
  assert.equal(count, 1)
})

test('budget creates a temporary smaller image without modifying original', async () => {
  const original = await sharp({ create: { width: 2048, height: 2048, channels: 3, background: 'green' } }).png().toBuffer()
  const data = `data:image/png;base64,${original.toString('base64')}`
  const input = { inputUrls: [data] }
  const [copy] = await prepareReferenceImages(input, EMBEDDED_ONLY, { embeddedBudget: 12000 })
  assert.ok(Buffer.byteLength(copy) <= 12000)
  assert.equal(input.inputUrls[0], data)
})

test('video adapter sends URL first, then original embedded bytes, then polls the accepted job', async () => {
  const requests = []
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk
    requests.push({ method: req.method, body: body ? JSON.parse(body) : null })
    res.setHeader('content-type', 'application/json')
    if (requests.length === 1) { res.statusCode = 422; res.end(JSON.stringify({ error: 'Failed to download image' })) }
    else if (req.method === 'POST') res.end(JSON.stringify({ request_id: 'accepted-job' }))
    else res.end(JSON.stringify({ status: 'done', video: { url: 'https://output.example/video.mp4' } }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const provider = new OpenAiVideoProvider({ baseUrl: `http://127.0.0.1:${server.address().port}`, apiKey: 'test-only' })
    const result = await provider.run({ kind: 'video', model: 'grok-imagine-video-1.5', prompt: 'test', inputUrls: ['https://assets.example/ref'], readInputAsDataUrl: async () => 'data:image/png;base64,AA==' }, () => {})
    assert.equal(result.status, 'succeeded')
    assert.equal(requests[0].body.input_reference.image_url, 'https://assets.example/ref')
    assert.equal(requests[1].body.input_reference.image_url, 'data:image/png;base64,AA==')
    assert.deepEqual(requests.map(r => r.method), ['POST', 'POST', 'GET'])
  } finally { await new Promise(resolve => server.close(resolve)) }
})
