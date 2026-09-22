import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { observeAssetDownload } from '../dist/assets/download-logging.js'

function fixture() {
  const events = [], response = new EventEmitter()
  Object.assign(response, { socket: { bytesWritten: 100 }, statusCode: 200, writableFinished: false })
  const log = { info: (fields) => events.push(fields), warn: (fields) => events.push(fields) }
  const observer = observeAssetDownload(response, log, { requestId: 'r1', assetId: 'a1', method: 'GET' })
  return { events, response, observer }
}
test('finished download reports timing, expected bytes and socket delta only once', () => {
  const { events, response, observer } = fixture()
  observer.ready(2000)
  response.socket.bytesWritten = 2300
  response.writableFinished = true
  response.emit('finish'); response.emit('close')
  assert.equal(events.length, 2)
  assert.equal(events[1].event, 'reference_download_finished')
  assert.equal(events[1].expectedBytes, 2000)
  assert.equal(events[1].socketBytesWritten, 2200)
  assert.equal(response.listenerCount('close'), 0)
})
test('premature close is interrupted, not successful', () => {
  const { events, response, observer } = fixture()
  observer.ready(2000)
  response.emit('close'); response.emit('finish')
  assert.equal(events.length, 2)
  assert.equal(events[1].event, 'reference_download_interrupted')
  assert.equal(events[1].writableFinished, false)
})
test('signature rejection logs a reason and no secret or URL', () => {
  const { events, response, observer } = fixture()
  observer.rejected('invalid_signature')
  response.statusCode = 403
  response.writableFinished = true
  response.emit('finish')
  assert.equal(events[1].outcome, 'invalid_signature')
  assert.equal(events[1].status, 403)
  assert.equal('url' in events[1], false)
  assert.equal('signature' in events[1], false)
})
