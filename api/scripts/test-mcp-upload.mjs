import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { UploadSessions, CHUNK_BYTES, MAX_UPLOAD_BYTES } from '../dist/mcp/upload-sessions.js';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = bytes => ({ projectId: 'project', name: 'x.png', mimeType: 'image/png', size: bytes.length, sha256: sha(bytes) });

test('chunk sessions support out-of-order writes, exact retries and concurrent completion without duplicate commits', async t => {
  const store = new UploadSessions(); t.after(() => store.close());
  const bytes = Buffer.alloc(CHUNK_BYTES + 17, 42), meta = manifest(bytes);
  const { uploadId } = store.begin('alice', 'request-0001', meta);
  assert.equal(store.begin('alice', 'request-0001', meta).uploadId, uploadId);
  assert.throws(() => store.begin('alice', 'request-0001', { ...meta, name: 'other.png' }), /409/);
  assert.throws(() => store.status('bob', uploadId), /404/);
  assert.throws(() => store.write('bob', uploadId, 0, 'eA=='), /404/);
  assert.throws(() => store.cancel('bob', uploadId), /404/);
  await assert.rejects(store.complete('bob', uploadId, async () => {}), /404/);
  store.write('alice', uploadId, 1, bytes.subarray(CHUNK_BYTES).toString('base64'));
  await assert.rejects(store.complete('alice', uploadId, async () => assert.fail()), /409/);
  const first = bytes.subarray(0, CHUNK_BYTES).toString('base64');
  store.write('alice', uploadId, 0, first);
  store.write('alice', uploadId, 0, first);
  assert.throws(() => store.write('alice', uploadId, 0, Buffer.alloc(CHUNK_BYTES, 43).toString('base64')), /409/);
  assert.deepEqual(store.status('alice', uploadId).receivedChunks, [0, 1]);
  let calls = 0, release;
  const commit = async input => { calls++; assert.deepEqual(Buffer.from(input.data, 'base64'), bytes); await new Promise(resolve => { release = resolve; }); return { asset: { id: 'asset-1' } }; };
  const one = store.complete('alice', uploadId, commit), two = store.complete('alice', uploadId, commit);
  assert.throws(() => store.cancel('alice', uploadId), /409/);
  release();
  assert.deepEqual(await one, await two);
  assert.deepEqual(await store.complete('alice', uploadId, commit), { asset: { id: 'asset-1' } });
  assert.equal(calls, 1);
  assert.equal(store.status('alice', uploadId).state, 'complete');
});

test('expiry, quotas, chunk validation, checksum failure and cancellation do not commit assets', async t => {
  let now = Date.now();
  const store = new UploadSessions(() => now); t.after(() => store.close());
  const bytes = Buffer.from('abc');
  const { uploadId } = store.begin('alice', 'request-0001', manifest(bytes));
  assert.throws(() => store.write('alice', uploadId, 0, 'YQ=='), /400/);
  assert.throws(() => store.write('alice', uploadId, 1, 'YWJj'), /400/);
  store.write('alice', uploadId, 0, 'YWJk');
  await assert.rejects(store.complete('alice', uploadId, async () => assert.fail()), /422/);
  assert.equal(store.cancel('alice', uploadId).state, 'canceled');
  assert.equal(store.cancel('alice', uploadId).state, 'canceled');
  await assert.rejects(store.complete('alice', uploadId, async () => assert.fail()), /409/);
  const large = store.begin('alice', 'request-large', { ...manifest(bytes), size: MAX_UPLOAD_BYTES });
  assert.equal(large.chunkCount, 100);
  assert.throws(() => store.begin('bob', 'request-large', { ...manifest(bytes), size: MAX_UPLOAD_BYTES }), /429/);
  now += 31 * 60 * 1000;
  assert.throws(() => store.status('alice', large.uploadId), /404/);
  assert.equal(store.begin('bob', 'request-large', { ...manifest(bytes), size: MAX_UPLOAD_BYTES }).chunkCount, 100);
});

test('ambiguous commit errors cannot trigger duplicate asset writes', async t => {
  const store = new UploadSessions(); t.after(() => store.close());
  const bytes = Buffer.from('abc');
  const { uploadId } = store.begin('alice', 'request-0001', manifest(bytes));
  store.write('alice', uploadId, 0, bytes.toString('base64'));
  let calls = 0;
  const commit = async () => { calls++; throw new Error('lost response'); };
  await assert.rejects(store.complete('alice', uploadId, commit), /409/);
  await assert.rejects(store.complete('alice', uploadId, commit), /409/);
  assert.equal(calls, 1);
  assert.equal(store.status('alice', uploadId).state, 'uncertain');
});
