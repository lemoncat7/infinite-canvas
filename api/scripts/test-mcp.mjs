import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

test('MCP and existing HTTP routes share authorization, canvas conflicts, jobs and billing', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'viora-mcp-test-'));
  process.env.DATA_DIR = directory;
  process.env.GENERATION_PROVIDER = 'mock';
  delete process.env.SDCPP_IMAGE_BASE_URL;
  delete process.env.MCP_ALLOWED_HOSTS;
  delete process.env.MCP_ALLOWED_ORIGINS;
  delete process.env.MCP_PUBLIC_BASE_URL;
  delete process.env.GENERATION_PUBLIC_BASE_URL;
  let providerCalls = 0;
  const upstream = createServer(async (req, res) => {
    providerCalls++;
    for await (const chunk of req) { /* drain request */ }
    await new Promise(resolve => setTimeout(resolve, 80));
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' }] }));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const { app } = await import('../dist/application.js');
  const { database, getOne, persist, sessionStore } = await import('../dist/storage/database.js');
  const { hashApiToken } = await import('../dist/auth/crypto.js');
  const { modelStore } = await import('../dist/generation/config.js');
  let closed = false;
  t.after(async () => {
    if (!closed) await app.close();
    await new Promise(resolve => upstream.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  });
  const alice = 'viora_alice-test-personal-token', bob = 'viora_bob-test-personal-token';
  for (const [id, token] of [['alice', alice], ['bob', bob]]) {
    database.run('INSERT INTO users (id,name,created_at,api_token_hash,credits) VALUES (?,?,?,?,?)', [id, id, new Date().toISOString(), hashApiToken(token), 30]);
  }
  let config = modelStore.saveProvider({ revision: modelStore.admin().revision, name: 'Local test only', baseUrl: `http://127.0.0.1:${upstream.address().port}`, apiKey: 'never-expose-upstream-secret' });
  config = modelStore.saveModel({ revision: config.revision, name: 'Test image', model: 'test-image', adapter: 'openai-image', providerId: config.providers.at(-1).id, creditCost: 3 });
  const model = config.models.find(item => item.name === 'Test image').id;
  persist();
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  const api = (method, url, payload, token = alice, extra = {}) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${token}`, ...extra } });
  const client = new Client({ name: 'integration-test', version: '1' });
  const other = new Client({ name: 'isolation-test', version: '1' });
  t.after(async () => { await client.close(); await other.close(); });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${alice}` } } }));
  await other.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${bob}` } } }));
  const call = async (name, args = {}, who = client) => {
    const response = await who.callTool({ name, arguments: args });
    assert.ok(!response.isError, JSON.stringify(response));
    return response.structuredContent.data;
  };

  await t.test('SDK initialization, tools, bearer-only authentication and Origin protection', async () => {
    for (const route of JSON.parse(readFileSync(new URL('./fixtures/http-routes.json', import.meta.url), 'utf8'))) {
      const [method, url] = route.split(' ');
      assert.ok(app.hasRoute({ method, url }), `Original HTTP route was not registered: ${route}`);
    }
    const { tools } = await client.listTools();
    assert.equal(tools.length, 10);
    assert.ok(tools.every(tool => !/delete|admin|clear/.test(tool.name)));
    assert.equal((await app.inject({ method: 'POST', url: '/mcp', payload: {} })).statusCode, 401);
    const cookie = `flow_session=${sessionStore.createSession('alice')}`;
    assert.equal((await app.inject({ method: 'GET', url: '/projects', headers: { cookie } })).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: '/mcp', payload: {}, headers: { cookie } })).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url: '/mcp', payload: {}, headers: { 'x-admin-key': 'test' } })).statusCode, 401);
    assert.equal((await api('POST', '/mcp', {}, 'bad-token')).statusCode, 401);
    assert.equal((await api('POST', '/mcp', {}, alice, { origin: 'https://attacker.invalid' })).statusCode, 403);
    assert.equal((await api('GET', '/mcp')).statusCode, 405);
    const invalid = await client.callTool({ name: 'not-a-real-tool', arguments: {} });
    assert.equal(invalid.isError, true);
    assert.ok(!JSON.stringify(await call('viora_models_list')).includes('never-expose-upstream-secret'));
    assert.equal((await api('GET', '/health')).statusCode, 200);
    assert.equal((await api('GET', '/admin/models')).statusCode, 403);
  });

  const project = await call('viora_project_create', { name: 'MCP test project' });
  const projectId = project.id;
  let nodeId;
  await t.test('HTTP and MCP share projects, unique IDs, canvas versioning and batch retry', async () => {
    assert.ok((await api('GET', '/projects')).json().some(p => p.id === projectId));
    assert.equal((await call('viora_projects_list', {}, other)).total, 0);
    const denied = await other.callTool({ name: 'viora_canvas_read', arguments: { projectId } });
    assert.equal(denied.isError, true);
    const ids = await call('viora_canvas_allocate_ids', { projectId, count: 100 });
    nodeId = ids.start;
    const canvas = await call('viora_canvas_read', { projectId });
    const node = { id: nodeId, kind: 'image', title: 'Test', body: 'one pixel', accent: '#888', x: 0, y: 0, width: 280, height: 280 };
    const batch = { projectId, baseVersion: canvas.version, batchId: 'test-batch-create', nodes: [node] };
    const first = await call('viora_canvas_apply', batch);
    assert.equal((await call('viora_canvas_apply', batch)).version, first.version);
    const conflict = await client.callTool({ name: 'viora_canvas_apply', arguments: { ...batch, batchId: 'test-batch-conflict', nodes: [{ ...node, title: 'conflict' }] } });
    assert.equal(conflict.isError, true);
    assert.equal(JSON.parse(conflict.content[0].text).status, 409);
    const fresh = await call('viora_canvas_read', { projectId });
    assert.equal(fresh.nodes.items[0].title, 'Test');
    const link = await call('viora_canvas_apply', { projectId, baseVersion: fresh.version, batchId: 'test-batch-linking', nodes: [{ ...node, id: nodeId + 1 }], links: [{ from: nodeId, to: nodeId + 1, fromSide: 'right', toSide: 'left' }] });
    assert.equal(link.linkCount, 1);
  });

  const input = { projectId, nodeId, kind: 'image', prompt: 'one pixel', model, requestId: 'test-generation-once' };
  let job, restartDownloadPath;
  await t.test('concurrent submissions create one billable job and a downloadable result', async () => {
    const [first, retry] = await Promise.all([call('viora_generation_submit', input), call('viora_generation_submit', input)]);
    assert.equal(first.id, retry.id);
    job = first;
    assert.equal(Number(getOne('SELECT count(*) AS count FROM jobs WHERE user_id=?', ['alice']).count), 1);
    for (let i = 0; i < 100; i++) {
      job = await call('viora_generation_get', { jobId: first.id });
      if (['failed', 'succeeded'].includes(job.status)) break;
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    assert.equal(job.status, 'succeeded', JSON.stringify(job));
    assert.equal(providerCalls, 1);
    assert.equal(getOne('SELECT credits FROM users WHERE id=?', ['alice']).credits, 27);
    assert.equal(getOne('SELECT reserved_credits FROM users WHERE id=?', ['alice']).reserved_credits, 0);
    assert.ok(!JSON.stringify(job).includes('model_snapshot'));
    assert.ok(job.result_url.startsWith('/api/assets/'));
    assert.equal((await api('GET', job.result_url.slice(4))).statusCode, 200);
    assert.equal((await api('GET', job.result_url.slice(4), undefined, bob)).statusCode, 404);
    assert.equal((await other.callTool({ name: 'viora_generation_get', arguments: { jobId: job.id } })).isError, true);
    assert.equal((await call('viora_assets_list', { projectId })).total, 1);
    const changed = await client.callTool({ name: 'viora_generation_submit', arguments: { ...input, prompt: 'different' } });
    assert.equal(changed.isError, true);
    assert.equal(JSON.parse(changed.content[0].text).status, 409);
    const { requestId, ...payload } = input;
    const httpRetry = await api('POST', '/jobs', payload, alice, { 'idempotency-key': requestId });
    assert.equal(httpRetry.json().id, job.id);
    assert.equal(httpRetry.json().replayed, true);
  });

  await t.test('asset retrieval includes image content, original download instructions and ownership checks', async () => {
    const response = await client.callTool({ name: 'viora_asset_get', arguments: { jobId: job.id } });
    assert.ok(!response.isError, JSON.stringify(response));
    const data = response.structuredContent.data;
    assert.equal(data.kind, 'image');
    assert.equal(data.download.path, job.result_url);
    assert.ok(data.download.url.startsWith(base + '/api/asset-downloads/'));
    const signedUrl = new URL(data.download.url);
    const route = signedUrl.pathname.slice(4) + signedUrl.search;
    const original = await app.inject({ method: 'GET', url: route });
    assert.equal(original.statusCode, 200);
    assert.ok(original.rawPayload.length > 0);
    assert.ok(original.headers['content-disposition'].startsWith('attachment;'));
    const partial = await app.inject({ method: 'GET', url: route, headers: { range: 'bytes=0-7' } });
    assert.equal(partial.statusCode, 206);
    assert.deepEqual(partial.rawPayload, original.rawPayload.subarray(0, 8));
    assert.equal((await app.inject({ method: 'GET', url: route, headers: { range: 'bytes=999999999-' } })).statusCode, 416);
    const tampered = new URL(data.download.url);
    tampered.searchParams.set('ticket', tampered.searchParams.get('ticket') + 'x');
    assert.equal((await app.inject({ method: 'GET', url: tampered.pathname.slice(4) + tampered.search })).statusCode, 403);
    assert.equal((await app.inject({ method: 'GET', url: '/asset-downloads/another-asset' + signedUrl.search })).statusCode, 403);
    assert.ok(response.content.some(item => item.type === 'resource_link' && item.uri === data.download.url));
    assert.equal(data.preview.status, 'included');
    const image = response.content.find(item => item.type === 'image');
    assert.equal(image.mimeType, 'image/webp');
    assert.ok(Buffer.from(image.data, 'base64').length > 0);
    assert.ok(!JSON.stringify(response).includes(alice));
    assert.ok(!JSON.stringify(response).includes('storage_name'));
    const metadata = await client.callTool({ name: 'viora_asset_get', arguments: { assetId: data.id, preview: false } });
    assert.equal(metadata.structuredContent.data.preview.status, 'disabled');
    assert.equal(metadata.content.filter(item => item.type === 'image').length, 0);
    for (const args of [{ assetId: data.id }, { jobId: job.id }]) {
      const denied = await other.callTool({ name: 'viora_asset_get', arguments: args });
      assert.equal(denied.isError, true);
      assert.equal(JSON.parse(denied.content[0].text).status, 404);
    }
    for (const args of [{}, { assetId: data.id, jobId: job.id }]) {
      const invalid = await client.callTool({ name: 'viora_asset_get', arguments: args });
      assert.equal(invalid.isError, true);
      assert.equal(JSON.parse(invalid.content[0].text).status, 400);
    }
    assert.equal((await api('GET', `/assets/${data.id}`, undefined, bob)).statusCode, 404);
  });

  await t.test('video stays downloadable and a broken thumbnail does not hide its original asset', async () => {
    for (const [id, mime, name] of [['test-video', 'video/mp4', '测试 video.mp4'], ['test-broken-image', 'image/png', 'broken.png']]) {
      const bytes = Buffer.from('isolated metadata/download test fixture, not real media');
      writeFileSync(join(directory, 'uploads', `${id}.bin`), bytes);
      database.run('INSERT INTO assets (id, project_id, user_id, name, mime_type, size, storage_name, created_at) VALUES (?,?,?,?,?,?,?,?)', [id, projectId, 'alice', name, mime, bytes.length, `${id}.bin`, new Date().toISOString()]);
      const response = await client.callTool({ name: 'viora_asset_get', arguments: { assetId: id } });
      assert.ok(!response.isError, JSON.stringify(response));
      const data = response.structuredContent.data;
      assert.equal(data.name, name);
      assert.equal(data.size, bytes.length);
      assert.equal(data.preview.status, mime === 'video/mp4' ? 'not_applicable' : 'unavailable');
      assert.equal(response.content.filter(item => item.type === 'image').length, 0);
      const downloaded = await api('GET', data.download.path.slice(4));
      assert.equal(downloaded.statusCode, 200);
      assert.deepEqual(downloaded.rawPayload, bytes);
      const signed = new URL(data.download.url);
      const anonymous = await app.inject({ method: 'GET', url: signed.pathname.slice(4) + signed.search });
      assert.equal(anonymous.statusCode, 200);
      assert.deepEqual(anonymous.rawPayload, bytes);
      if (mime === 'video/mp4') {
        const response = await fetch(base + signed.pathname.slice(4) + signed.search);
        assert.equal(response.status, 200);
        const localPath = join(directory, 'client-session-downloaded.mp4');
        writeFileSync(localPath, Buffer.from(await response.arrayBuffer()));
        assert.deepEqual(readFileSync(localPath), bytes);
        restartDownloadPath = signed.pathname.slice(4) + signed.search;
      }
    }
    const missing = await client.callTool({ name: 'viora_asset_get', arguments: { assetId: 'missing' } });
    assert.equal(missing.isError, true);
    assert.equal(JSON.parse(missing.content[0].text).status, 404);
  });

  await t.test('rotated tokens take effect on the next MCP request', async () => {
    database.run('UPDATE users SET api_token_hash=? WHERE id=?', [hashApiToken('viora_replaced'), 'bob']);
    assert.equal((await api('POST', '/mcp', {}, bob)).statusCode, 401);
  });
  await t.test('download tickets expire and credential rotation revokes old links', async () => {
    const { issueDownloadTicket } = await import('../dist/assets/download-tickets.js');
    const hash = String(getOne('SELECT api_token_hash FROM users WHERE id=?', ['alice']).api_token_hash);
    const { ticket } = issueDownloadTicket('test-video', 'alice', hash);
    const path = `/asset-downloads/test-video?ticket=${ticket}`;
    const now = Date.now;
    let expired;
    try {
      Date.now = () => now() - 901000;
      expired = issueDownloadTicket('test-video', 'alice', hash).ticket;
    } finally { Date.now = now; }
    assert.equal((await app.inject({ method: 'GET', url: `/asset-downloads/test-video?ticket=${expired}` })).statusCode, 403);
    database.run('UPDATE users SET api_token_hash=? WHERE id=?', [hashApiToken('viora_rotated-test'), 'alice']);
    assert.equal((await app.inject({ method: 'GET', url: path })).statusCode, 403);
    database.run('UPDATE users SET api_token_hash=? WHERE id=?', [hash, 'alice']);
    assert.equal((await app.inject({ method: 'GET', url: path })).statusCode, 200);
  });
  await client.close(); await other.close();
  await app.close(); closed = true;
  await t.test('a fresh process replays the durable request without spending credits again', async () => {
    const { requestId, ...payload } = input;
    const script = `
      const { app } = await import('./dist/application.js');
      const response = await app.inject({method:'POST',url:'/jobs',payload:${JSON.stringify(payload)},headers:{authorization:${JSON.stringify(`Bearer ${alice}`)},'idempotency-key':${JSON.stringify(requestId)}}});
      if(response.statusCode!==202 || response.json().id!==${JSON.stringify(job.id)} || !response.json().replayed) throw new Error(response.body);
      const download = await app.inject({method:'GET',url:${JSON.stringify(restartDownloadPath)}});
      if(download.statusCode!==200) throw new Error('Download ticket did not survive restart');
      await app.close();
    `;
    await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], { cwd: new URL('..', import.meta.url), env: process.env, timeout: 15000 });
    assert.equal(providerCalls, 1);
  });
});
