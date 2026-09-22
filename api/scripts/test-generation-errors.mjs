import test from 'node:test'
import assert from 'node:assert/strict'
import { safeModelError } from '../dist/models/errors.js'
import { imageResponseError } from '../dist/providers/image-errors.js'
import { createServer } from 'node:http'
import { OpenAiImageProvider } from '../dist/providers/openai-image.js'
import { AgnesImageProvider } from '../dist/providers/agnes-image.js'

test('image adapters preserve HTTP errors and reject malformed success responses', async () => {
  let status = 400, body = JSON.stringify({ error: { message: 'Your request was rejected by the safety system' } })
  const server = createServer((req, res) => {
    req.resume()
    res.writeHead(status, { 'content-type': 'application/json', 'x-request-id': 'req_local_test_12345678' })
    res.end(body)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    for (const Adapter of [OpenAiImageProvider, AgnesImageProvider]) {
      const provider = new Adapter({ baseUrl: `http://127.0.0.1:${server.address().port}`, apiKey: 'test-only' })
      const input = { kind: 'image', prompt: 'test', model: 'test' }
      status = 400
      body = JSON.stringify({ error: { message: 'Your request was rejected by the safety system' } })
      await assert.rejects(provider.run(input, () => {}), error => /安全审核拒绝/.test(error.message) && /HTTP 400/.test(error.message) && /req_local_test_12345678/.test(error.message))
      status = 200
      for (body of ['null', '[]', '{}', '<html>PRIVATE_TOKEN</html>']) {
        await assert.rejects(provider.run(input, () => {}), error => /响应格式异常/.test(error.message) && !/PRIVATE_TOKEN/.test(error.message))
      }
    }
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
})

test('safe reasons survive repeated sanitization without exposing bodies', () => {
  const id = '11111111-2222-3333-4444-555555555555'
  const error = imageResponseError(400, { error: { message: 'Your request was rejected by the safety system PRIVATE_TOKEN https://private.example', code: 'safety_violations' }, request_id: id })
  assert.match(error.message, /安全审核拒绝/)
  assert.match(error.message, /HTTP 400/)
  assert.ok(error.message.includes(id))
  assert.doesNotMatch(error.message, /PRIVATE_TOKEN|private.example/)
  assert.equal(safeModelError(error), error)
})

test('EOF from codex image endpoint is not a timeout', () => {
  const error = imageResponseError(500, { error: { message: 'Post https://private.example/backend-api/codex/images: EOF' } })
  assert.match(error.message, /连接中断/)
  assert.doesNotMatch(error.message, /timeout|超时|private.example/)
})

test('timeouts retain duration and reference stage', () => {
  const error = new DOMException('The operation was aborted due to timeout', 'TimeoutError')
  assert.match(safeModelError(error, { timeoutMs: 180000 }).message, /180 秒等待上限/)
  assert.match(safeModelError(error, { stage: '参考图片读取' }).message, /参考图片读取超时/)
  assert.match(safeModelError(new Error('fetch failed', { cause: new Error('ECONNRESET') })).message, /连接中断/)
})

test('HTTP classifications and unknown responses remain safe', () => {
  for (const [status, payload, expected] of [
    [401, {}, /认证失败/], [403, {}, /访问被拒绝/], [429, {}, /过于频繁/],
    [429, { message: 'insufficient_quota' }, /额度不足/],
    [400, {}, /上游拒绝生成请求/], [404, {}, /不存在/],
    [500, {}, /服务异常/], [200, { message: 'Invalid JSON response' }, /响应格式异常/],
    [400, { message: 'forbidden field' }, /参数校验失败/],
    [503, { message: 'auth_unavailable' }, /没有可用认证资源/],
  ]) assert.match(imageResponseError(status, payload).message, expected)
  for (const payload of [null, [], '<html>PRIVATE_TOKEN</html>']) {
    const error = imageResponseError(400, payload, 'PRIVATE_TOKEN')
    assert.match(error.message, /上游拒绝生成请求/)
    assert.doesNotMatch(error.message, /PRIVATE_TOKEN/)
  }
})
