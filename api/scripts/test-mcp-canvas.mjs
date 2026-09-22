import test from 'node:test';
import assert from 'node:assert/strict';
import { syncGenerationCanvas } from '../dist/mcp/generation-canvas.js';
import { prepareMcpNodes } from '../dist/mcp/canvas-node-contract.js';
import { ApiFailure } from '../dist/mcp/gateway.js';
import { registerGenerationTools } from '../dist/mcp/generation-tools.js';

function fixture(kind = 'video') {
  const source = { id: 1, kind, x: 0, y: 0, width: 280, height: 220, title: 'Source', body: 'Keep my prompt', model: 'chosen-model', status: 'idle' };
  const job = { id: 'job-12345678', project_id: 'project', node_id: 1, kind, status: 'queued', progress: 0, model: 'test-model', prompt: 'generated prompt', parameters: '{"seconds":8,"aspect_ratio":"9:16"}' };
  const canvas = { projectId: 'project', version: 1, nodes: [source], links: [], camera: { x: 0, y: 0, zoom: 1 } };
  const batches = new Map(), calls = []; let nextId = 100, failSync = 0, beforeSync;
  const api = { async call(method, path, body) {
    calls.push({ method, path, body });
    if (path.startsWith('/jobs/')) return structuredClone(job);
    if (path.endsWith('/id-block')) return { start: nextId++ };
    if (method === 'GET') return structuredClone(canvas);
    if (path === '/jobs') return { id: job.id, status: job.status, progress: job.progress, replayed: true };
    assert.ok(path.endsWith('/sync'));
    if (batches.has(body.batchId)) return structuredClone(batches.get(body.batchId));
    if (beforeSync) { const callback = beforeSync; beforeSync = undefined; callback(); }
    if (failSync-- > 0 || body.baseVersion !== canvas.version) throw new ApiFailure(409, 'conflict');
    for (const op of body.operations) {
      if (op.type === 'node') { const i = canvas.nodes.findIndex(n => String(n.id) === op.key); if (i < 0) canvas.nodes.push(op.value); else canvas.nodes[i] = op.value; }
      else canvas.links.push(op.value);
    }
    canvas.version++;
    batches.set(body.batchId, structuredClone(canvas));
    return structuredClone(canvas);
  } };
  return { api, job, canvas, calls, source, conflict: (n = 1) => { failSync = n; }, before: cb => { beforeSync = cb; } };
}

test('video submission creates one distinct result, preserves source, links and reuses it under concurrency', async () => {
  const f = fixture(), original = structuredClone(f.source);
  const results = await Promise.all([1, 2].map(() => syncGenerationCanvas(f.api, f.job, { createMissing: true })));
  assert.ok(results.every(r => r.canvasLinked));
  assert.equal(results[0].resultNodeId, results[1].resultNodeId);
  assert.equal(f.canvas.nodes.length, 2); assert.equal(f.canvas.links.length, 1);
  assert.deepEqual(f.canvas.nodes[0], original);
  const result = f.canvas.nodes[1];
  assert.equal(result.role, 'result'); assert.equal(result.jobId, f.job.id);
  assert.equal(result.sourceNodeId, 1); assert.ok(result.x >= 390);
  assert.equal(result.videoSettings.seconds, '8'); assert.equal(result.videoSettings.aspectRatio, '9:16');
  assert.equal(f.calls.filter(c => c.path === '/jobs').length, 0);
});
test('actual input images link to their result, preserving user links and not recreating deletions on polling', async () => {
  const f = fixture();
  f.job.input_urls = JSON.stringify(['/api/assets/ref-a/content/a.png', '/api/assets/ref-b/content/b.png']);
  f.canvas.nodes.push({ id: 2, kind: 'image', mediaUrl: '/api/assets/ref-a/content/renamed.png' },
    { id: 3, kind: 'image', mediaUrl: '/api/assets/ref-b/content/b.png' });
  const synced = await syncGenerationCanvas(f.api, f.job, { createMissing: true });
  assert.equal(synced.referencesSync, 'synced');
  const links = f.canvas.links.filter(l => l.from === 2 || l.from === 3);
  assert.deepEqual(links.map(l => [l.from, l.to, l.inputOrder]), [[2, synced.resultNodeId, 0], [3, synced.resultNodeId, 1]]);
  const version = f.canvas.version;
  await syncGenerationCanvas(f.api, f.job, { repairReferences: true });
  assert.equal(f.canvas.version, version);
  f.canvas.links = f.canvas.links.filter(l => l.from !== 2);
  await syncGenerationCanvas(f.api, f.job);
  assert.equal(f.canvas.links.some(l => l.from === 2), false);
  await syncGenerationCanvas(f.api, f.job, { repairReferences: true });
  assert.equal(f.canvas.links.filter(l => l.from === 2).length, 1);
  assert.equal(f.calls.filter(c => c.path === '/jobs').length, 0);
});

test('asset-only inputs can create reference cards but external lookalike URLs are not trusted', async () => {
  const f = fixture();
  f.job.input_urls = ['/api/assets/ref-a/content/a.png', 'https://untrusted.invalid/api/assets/ref-a/content/a.png'];
  const original = f.api.call.bind(f.api);
  f.api.call = async (method, path, body) => path === '/assets/ref-a'
    ? { id: 'ref-a', projectId: 'project', name: 'a.png', mimeType: 'image/png', url: '/api/assets/ref-a/content/a.png' }
    : original(method, path, body);
  const result = await syncGenerationCanvas(f.api, f.job, { createMissing: true });
  assert.equal(result.referencesSync, 'pending');
  assert.deepEqual(result.unresolvedReferenceIndices, [1]);
  const refs = f.canvas.nodes.filter(n => n.kind === 'image');
  assert.equal(refs.length, 1);
  assert.ok(f.canvas.links.some(l => l.from === refs[0].id && l.to === result.resultNodeId));
  await syncGenerationCanvas(f.api, f.job, { createMissing: true, repairReferences: true });
  assert.equal(f.canvas.nodes.filter(n => n.kind === 'image').length, 1);
});

test('terminal polling persists video without a browser; repeated polls do not keep writing', async () => {
  const f = fixture(); await syncGenerationCanvas(f.api, f.job, { createMissing: true });
  f.job.status = 'running'; f.job.progress = 35;
  await syncGenerationCanvas(f.api, f.job);
  const runningVersion = f.canvas.version;
  f.job.progress = 65; await syncGenerationCanvas(f.api, f.job);
  assert.equal(f.canvas.version, runningVersion);
  Object.assign(f.job, { status: 'succeeded', progress: 100, result_url: '/api/assets/video/content/result.mp4', result_metadata: '{"seconds":8}' });
  await syncGenerationCanvas(f.api, f.job);
  assert.equal(f.canvas.nodes[1].mediaUrl, f.job.result_url);
  assert.equal(f.canvas.nodes[1].videoResult.seconds, 8);
  const finalVersion = f.canvas.version;
  await syncGenerationCanvas(f.api, f.job);
  assert.equal(f.canvas.version, finalVersion);
});
test('conflict retries preserve edits and exhausted retries return pending, not a new generation', async () => {
  const f = fixture(); await syncGenerationCanvas(f.api, f.job, { createMissing: true });
  f.job.status = 'succeeded'; f.job.result_url = '/api/assets/video';
  f.before(() => { f.canvas.nodes[1].title = 'User renamed'; f.canvas.nodes[1].x = 999; f.canvas.version++; });
  assert.equal((await syncGenerationCanvas(f.api, f.job)).canvasLinked, true);
  assert.equal(f.canvas.nodes[1].title, 'User renamed'); assert.equal(f.canvas.nodes[1].x, 999);
  f.job.result_metadata = '{"seconds":9}'; f.conflict(3);
  const pending = await syncGenerationCanvas(f.api, f.job);
  assert.equal(pending.canvasSync, 'pending'); assert.match(pending.warning, /Do not generate again/);
  assert.equal(f.calls.filter(c => c.path === '/jobs').length, 0);
});
test('ordinary polling does not resurrect deleted results or source nodes', async () => {
  const f = fixture(); await syncGenerationCanvas(f.api, f.job, { createMissing: true });
  f.canvas.nodes.splice(1); f.canvas.links = []; f.canvas.version++;
  assert.equal((await syncGenerationCanvas(f.api, f.job)).canvasLinked, false);
  assert.equal(f.canvas.nodes.length, 1);
  // Even a retry of the original submit uses the cached creation batch, not a new card.
  assert.equal((await syncGenerationCanvas(f.api, f.job, { createMissing: true })).canvasLinked, false);
  assert.equal(f.canvas.nodes.length, 1);
  f.canvas.nodes = [];
  assert.equal((await syncGenerationCanvas(f.api, f.job, { createMissing: true })).canvasLinked, false);
  assert.equal(f.canvas.nodes.length, 0);
});
test('legacy result repair uses exact association and never overwrites a different task', async () => {
  const f = fixture(); Object.assign(f.job, { status: 'succeeded', result_url: '/api/assets/old-video' });
  f.source.mediaUrl = f.job.result_url;
  assert.equal((await syncGenerationCanvas(f.api, f.job)).resultNodeId, 1);
  assert.equal(f.canvas.nodes[0].role, 'result'); assert.equal(f.canvas.nodes[0].jobId, f.job.id);
  assert.equal(f.canvas.nodes.length, 1);
  f.canvas.nodes[0].jobId = 'newer-job';
  assert.equal((await syncGenerationCanvas(f.api, f.job)).canvasLinked, false);
  assert.equal(f.canvas.nodes[0].jobId, 'newer-job');
});
test('MCP canvas writes fill the UI contract and reject cross-project tasks before mutation', async () => {
  const f = fixture();
  const [node] = await prepareMcpNodes(f.api, 'project', [{ ...f.source, jobId: f.job.id }]);
  assert.equal(node.role, 'result'); assert.equal(node.status, 'queued');
  const [imported] = await prepareMcpNodes(f.api, 'project', [{ ...f.source, mediaUrl: '/api/assets/video' }]);
  assert.equal(imported.role, 'result');
  await assert.rejects(prepareMcpNodes(f.api, 'another-project', [{ ...f.source, jobId: f.job.id }]), /400/);
  assert.equal(f.calls.filter(c => c.path.endsWith('/sync')).length, 0);
});
test('upload preserves the asset on canvas failure and bounds conflict retries', async () => {
  const { registerUploadTools } = await import('../dist/mcp/upload-tools.js');
  for (const status of [409, 503]) {
    let handler, uploads = 0, writes = 0;
    registerUploadTools({ registerTool(name, config, action) {
      assert.equal(config.annotations.idempotentHint, false);
      handler = action;
    } }, { async call(method, path) {
      if (path.endsWith('/assets')) { uploads++; return [{ id: 'existing-asset', name: 'x.png', url: '/api/assets/existing-asset', size: 1, mimeType: 'image/png' }]; }
      if (path.endsWith('/id-block')) return { start: 42 };
      if (path.endsWith('/sync')) { writes++; throw new ApiFailure(status, 'test'); }
      return { version: 1, nodes: [], links: [] };
    } });
    const response = await handler({ projectId: 'project', name: 'x.png', mimeType: 'image/png', data: 'eA==', placement: { x: 0, y: 0, width: 280, height: 280 } });
    assert.equal(response.isError, undefined);
    assert.equal(response.structuredContent.data.asset.id, 'existing-asset');
    assert.equal(response.structuredContent.data.canvasSync, 'pending');
    assert.equal(uploads, 1);
    assert.equal(writes, status === 409 ? 3 : 1);
  }
});

test('get read-only opt-out, sync tool annotations, and accepted-job recovery', async () => {
  const f = fixture(), tools = new Map();
  registerGenerationTools({ registerTool(name, config, handler) { tools.set(name, { config, handler }); } }, f.api);
  const get = tools.get('viora_generation_get');
  assert.equal(get.config.annotations.readOnlyHint, false);
  await get.handler({ jobId: f.job.id, syncCanvas: false });
  assert.equal(f.calls.length, 1);
  f.conflict(3);
  const submit = await tools.get('viora_generation_submit').handler({ projectId: 'project', nodeId: 1, kind: 'video', prompt: 'test', requestId: 'retry-the-same-id' });
  assert.equal(submit.structuredContent.data.id, f.job.id);
  assert.equal(submit.structuredContent.data.canvasSync, 'pending');
  const sync = await tools.get('viora_generation_sync').handler({ jobId: f.job.id, createMissing: true });
  assert.equal(sync.structuredContent.data.canvasLinked, true);
  assert.equal(f.calls.filter(c => c.path === '/jobs').length, 1);
});
