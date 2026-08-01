import Fastify from 'fastify'
import initSqlJs, { type Database } from 'sql.js'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createGenerationProvider, type GenerationUpdate } from './providers/index.js'
import { ProxyAgent, fetch as undiciFetch } from 'undici'

type CanvasPayload = { nodes: unknown[]; links: unknown[]; camera?: unknown }
type JobInput = { projectId?: string; nodeId: number; kind: 'image' | 'video'; prompt: string; model?: string; inputUrls?: string[]; parameters?: Record<string, unknown> }

const dataDirectory = process.env.DATA_DIR ?? './data'
const databasePath = `${dataDirectory}/flow-studio.sqlite`
const uploadDirectory = `${dataDirectory}/uploads`
mkdirSync(dataDirectory, { recursive: true })
mkdirSync(uploadDirectory, { recursive: true })
const SQL = await initSqlJs()
const database: Database = existsSync(databasePath) ? new SQL.Database(readFileSync(databasePath)) : new SQL.Database()
database.run(`
  CREATE TABLE IF NOT EXISTS canvases (id TEXT PRIMARY KEY, title TEXT NOT NULL, document TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, node_id INTEGER NOT NULL, kind TEXT NOT NULL, prompt TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 0, result_url TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS project_canvases (project_id TEXT PRIMARY KEY, document TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, user_id TEXT NOT NULL, name TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL, storage_name TEXT NOT NULL, created_at TEXT NOT NULL);
`)
ensureColumn('jobs', 'project_id', 'TEXT')
ensureColumn('jobs', 'user_id', 'TEXT')
const developmentUserId = 'dev-user'
const defaultProjectId = 'default'
const generationProvider = createGenerationProvider()
const bootTime = new Date().toISOString()
database.run('INSERT OR IGNORE INTO users (id, name, created_at) VALUES (?, ?, ?)', [developmentUserId, '开发用户', bootTime])
database.run('INSERT OR IGNORE INTO projects (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [defaultProjectId, developmentUserId, '未命名项目', bootTime, bootTime])
const legacyCanvas = getOne('SELECT document, updated_at FROM canvases WHERE id = ?', [defaultProjectId])
if (legacyCanvas) database.run('INSERT OR IGNORE INTO project_canvases (project_id, document, updated_at) VALUES (?, ?, ?)', [defaultProjectId, legacyCanvas.document, legacyCanvas.updated_at])
persist()

const app = Fastify({ logger: true, bodyLimit: 150 * 1024 * 1024 })
app.get('/health', async () => ({ ok: true, service: 'flow-studio-api', generationProvider: generationProvider.name }))
app.get('/generation/capabilities', async () => generationProvider.capabilities ?? {
  image: { provider: generationProvider.name, defaultModel: process.env.OPENAI_IMAGE_DEFAULT_MODEL || 'gpt-image-2' },
  video: { provider: generationProvider.name, defaultModel: process.env.AGNES_VIDEO_DEFAULT_MODEL || 'agnes-video-v2.0', seconds: { min: 1, max: 18, default: 5 }, resolutions: ['480p', '720p', '1080p'], aspectRatios: ['1:1', '4:3', '16:9'] },
})
app.post('/client-logs', async request => {
  const input = request.body as { event?: string; details?: unknown; userAgent?: string; path?: string; timestamp?: string }
  app.log.warn({ clientDiagnostic: { event: String(input.event ?? 'unknown').slice(0, 100), details: input.details, userAgent: String(input.userAgent ?? '').slice(0, 500), path: String(input.path ?? '').slice(0, 300), timestamp: input.timestamp } }, 'client diagnostic')
  return { ok: true }
})
app.get('/mock/:file', async (request, reply) => {
  const { file } = request.params as { file: string }
  const label = file.startsWith('video-') ? 'VIDEO PREVIEW' : 'IMAGE PREVIEW'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#172d30"/><stop offset=".5" stop-color="#315f69"/><stop offset="1" stop-color="#c5e969"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="960" cy="180" r="210" fill="#fff" opacity=".08"/><circle cx="210" cy="620" r="330" fill="#fff" opacity=".06"/><text x="72" y="570" fill="#fff" font-family="system-ui" font-size="54" font-weight="700">${label}</text><text x="76" y="625" fill="#fff" opacity=".7" font-family="system-ui" font-size="24">Custom provider result pipeline is ready</text></svg>`
  return reply.type('image/svg+xml').header('cache-control', 'no-store').send(svg)
})
app.get('/users/me', async () => getOne('SELECT id, name, created_at AS createdAt FROM users WHERE id = ?', [developmentUserId]))

app.get('/projects', async () => getAll('SELECT id, name, created_at AS createdAt, updated_at AS updatedAt FROM projects WHERE user_id = ? ORDER BY updated_at DESC', [developmentUserId]))
app.post('/projects', async (request, reply) => { const body = request.body as { name?: string }, id = randomUUID(), now = new Date().toISOString(); database.run('INSERT INTO projects (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [id, developmentUserId, body.name?.trim() || '未命名项目', now, now]); database.run('INSERT INTO project_canvases (project_id, document, updated_at) VALUES (?, ?, ?)', [id, JSON.stringify({ nodes: [], links: [], camera: { x: 0, y: 0, zoom: 1 } }), now]); persist(); return reply.code(201).send({ id, name: body.name?.trim() || '未命名项目', createdAt: now, updatedAt: now }) })
app.delete('/projects/:projectId', async (request, reply) => { const { projectId } = request.params as { projectId: string }; if (!ownsProject(projectId)) return reply.code(404).send({ error: 'Project not found' }); if (projectId === defaultProjectId) return reply.code(409).send({ error: 'Default project cannot be deleted' }); const files = getAll('SELECT storage_name FROM assets WHERE project_id = ? AND user_id = ?', [projectId, developmentUserId]); for (const file of files) { const path = `${uploadDirectory}/${file.storage_name}`; if (existsSync(path)) unlinkSync(path) } database.run('DELETE FROM assets WHERE project_id = ? AND user_id = ?', [projectId, developmentUserId]); database.run('DELETE FROM project_canvases WHERE project_id = ?', [projectId]); database.run('DELETE FROM jobs WHERE project_id = ? AND user_id = ?', [projectId, developmentUserId]); database.run('DELETE FROM projects WHERE id = ? AND user_id = ?', [projectId, developmentUserId]); persist(); return reply.code(204).send() })

app.get('/projects/:projectId/canvas', async (request, reply) => { const { projectId } = request.params as { projectId: string }; if (!ownsProject(projectId)) return reply.code(404).send({ error: 'Project not found' }); const row = getOne('SELECT document, updated_at FROM project_canvases WHERE project_id = ?', [projectId]); if (!row) return reply.code(404).send({ error: 'Canvas not found' }); return { projectId, ...JSON.parse(String(row.document)), updatedAt: row.updated_at } })
app.put('/projects/:projectId/canvas', async (request, reply) => { const { projectId } = request.params as { projectId: string }; if (!ownsProject(projectId)) return reply.code(404).send({ error: 'Project not found' }); const body = request.body as CanvasPayload, now = new Date().toISOString(); database.run('INSERT INTO project_canvases (project_id, document, updated_at) VALUES (?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET document=excluded.document, updated_at=excluded.updated_at', [projectId, JSON.stringify({ nodes: body.nodes, links: body.links, camera: body.camera }), now]); database.run('UPDATE projects SET updated_at = ? WHERE id = ?', [now, projectId]); persist(); return { projectId, updatedAt: now } })

app.get('/projects/:projectId/assets', async (request, reply) => { const { projectId } = request.params as { projectId: string }; if (!ownsProject(projectId)) return reply.code(404).send({ error: 'Project not found' }); return getAll('SELECT id, name, mime_type AS mimeType, size, created_at AS createdAt FROM assets WHERE project_id = ? AND user_id = ? ORDER BY created_at DESC', [projectId, developmentUserId]).map(asset => ({ ...asset, url: `/api/assets/${asset.id}/content` })) })
app.post('/projects/:projectId/assets', async (request, reply) => { const { projectId } = request.params as { projectId: string }; if (!ownsProject(projectId)) return reply.code(404).send({ error: 'Project not found' }); const body = request.body as { files?: Array<{ name: string; mimeType: string; data: string }> }, uploaded = []; for (const file of body.files ?? []) { const bytes = Buffer.from(file.data, 'base64'); if (bytes.length > 100 * 1024 * 1024) return reply.code(413).send({ error: 'Asset exceeds 100MB' }); const id = randomUUID(), storageName = `${id}.bin`, now = new Date().toISOString(); writeFileSync(`${uploadDirectory}/${storageName}`, bytes); database.run('INSERT INTO assets (id, project_id, user_id, name, mime_type, size, storage_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [id, projectId, developmentUserId, file.name, file.mimeType, bytes.length, storageName, now]); uploaded.push({ id, name: file.name, mimeType: file.mimeType, size: bytes.length, createdAt: now, url: `/api/assets/${id}/content` }) } persist(); return reply.code(201).send(uploaded) })
app.get('/assets/:assetId/content', async (request, reply) => { const { assetId } = request.params as { assetId: string }; const asset = getOne('SELECT mime_type, storage_name FROM assets WHERE id = ? AND user_id = ?', [assetId, developmentUserId]); if (!asset) return reply.code(404).send({ error: 'Asset not found' }); reply.type(String(asset.mime_type)).header('cache-control', 'private, max-age=3600'); return reply.send(readFileSync(`${uploadDirectory}/${asset.storage_name}`)) })
app.delete('/assets/:assetId', async (request, reply) => { const { assetId } = request.params as { assetId: string }; const asset = getOne('SELECT storage_name FROM assets WHERE id = ? AND user_id = ?', [assetId, developmentUserId]); if (!asset) return reply.code(404).send({ error: 'Asset not found' }); const path = `${uploadDirectory}/${asset.storage_name}`; if (existsSync(path)) unlinkSync(path); database.run('DELETE FROM assets WHERE id = ? AND user_id = ?', [assetId, developmentUserId]); persist(); return reply.code(204).send() })

app.get('/canvases/:id', async (request, reply) => {
  const { id } = request.params as { id: string }
  const row = getOne('SELECT id, title, document, updated_at FROM canvases WHERE id = ?', [id])
  if (!row) return reply.code(404).send({ error: 'Canvas not found' })
  return { id: row.id, title: row.title, ...JSON.parse(String(row.document)), updatedAt: row.updated_at }
})

app.put('/canvases/:id', async (request) => {
  const { id } = request.params as { id: string }
  const body = request.body as CanvasPayload & { title?: string }
  const now = new Date().toISOString()
  database.run(`INSERT INTO canvases (id, title, document, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET title = excluded.title, document = excluded.document, updated_at = excluded.updated_at`,
    [id, body.title ?? '未命名项目', JSON.stringify({ nodes: body.nodes, links: body.links, camera: body.camera }), now])
  persist()
  return { id, updatedAt: now }
})

app.post('/jobs', async (request, reply) => {
  const input = request.body as JobInput
  if (!input.prompt?.trim()) return reply.code(400).send({ error: 'Prompt is required' })
  const projectId = input.projectId ?? defaultProjectId
  if (!ownsProject(projectId)) return reply.code(404).send({ error: 'Project not found' })
  const id = randomUUID(), now = new Date().toISOString(), model = input.model ?? (input.kind === 'video' ? process.env.AGNES_VIDEO_DEFAULT_MODEL || 'agnes-video-v2.0' : process.env.OPENAI_IMAGE_DEFAULT_MODEL || 'gpt-image-2')
  database.run('INSERT INTO jobs (id, project_id, user_id, node_id, kind, prompt, model, status, progress, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, projectId, developmentUserId, input.nodeId, input.kind, input.prompt, model, 'queued', 0, now, now])
  persist()
  void generationProvider.run({ internalJobId: id, projectId, nodeId: input.nodeId, kind: input.kind, prompt: input.prompt, model, inputUrls: input.inputUrls ?? [], parameters: input.parameters ?? {} }, update => { void updateJob(id, update) }).catch(error => { void updateJob(id, { status: 'failed', progress: 0, error: error instanceof Error ? error.message : 'Generation failed' }) })
  return reply.code(202).send({ id, status: 'queued', progress: 0, model, provider: generationProvider.name })
})

app.get('/jobs/:id', async (request, reply) => {
  const { id } = request.params as { id: string }
  const row = getOne('SELECT * FROM jobs WHERE id = ? AND user_id = ?', [id, developmentUserId])
  return row ?? reply.code(404).send({ error: 'Job not found' })
})

function getOne(sql: string, values: Array<string | number>) {
  const statement = database.prepare(sql); statement.bind(values)
  const row = statement.step() ? statement.getAsObject() : undefined
  statement.free(); return row
}
function getAll(sql: string, values: Array<string | number>) { const statement = database.prepare(sql); statement.bind(values); const rows = []; while (statement.step()) rows.push(statement.getAsObject()); statement.free(); return rows }
function ownsProject(projectId: string) { return Boolean(getOne('SELECT id FROM projects WHERE id = ? AND user_id = ?', [projectId, developmentUserId])) }
function ensureColumn(table: string, column: string, definition: string) { const columns = getAll(`PRAGMA table_info(${table})`, []); if (!columns.some(item => item.name === column)) database.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`) }

function persist() { writeFileSync(databasePath, Buffer.from(database.export())) }

async function updateJob(id: string, update: GenerationUpdate) {
  let resultUrl = update.resultUrl
  try {
    if (update.status === 'succeeded' && resultUrl) resultUrl = await archiveJobResult(id, resultUrl)
    database.run('UPDATE jobs SET status = ?, progress = ?, result_url = COALESCE(?, result_url), error = ?, updated_at = ? WHERE id = ?', [update.status, update.progress, resultUrl ?? null, update.error ?? null, new Date().toISOString(), id])
  } catch (error) {
    database.run('UPDATE jobs SET status = ?, progress = ?, error = ?, updated_at = ? WHERE id = ?', ['failed', 0, `结果保存到资产库失败：${error instanceof Error ? error.message : 'unknown error'}`, new Date().toISOString(), id])
  }
  persist()
}

async function archiveJobResult(jobId: string, source: string) {
  const job = getOne('SELECT project_id, kind, prompt FROM jobs WHERE id = ? AND user_id = ?', [jobId, developmentUserId])
  if (!job) throw new Error('Job not found')
  let bytes: Buffer, mimeType: string
  if (source.startsWith('data:')) {
    const match = source.match(/^data:([^;,]+);base64,(.+)$/s)
    if (!match) throw new Error('Unsupported data URL')
    mimeType = match[1]; bytes = Buffer.from(match[2], 'base64')
  } else {
    const url = source.startsWith('/api/') ? `http://127.0.0.1:${process.env.PORT ?? 3000}/${source.slice(5)}` : source
    const proxyUrl = String(job.kind) === 'video' ? process.env.AGNES_VIDEO_HTTPS_PROXY : process.env.OPENAI_IMAGE_HTTPS_PROXY
    const response = proxyUrl ? await undiciFetch(url, { signal: AbortSignal.timeout(120000), dispatcher: new ProxyAgent(proxyUrl) }) : await fetch(url, { signal: AbortSignal.timeout(120000) })
    if (!response.ok) throw new Error(`下载生成结果失败（${response.status}）`)
    mimeType = response.headers.get('content-type')?.split(';')[0] || (String(job.kind) === 'video' ? 'video/mp4' : 'image/png')
    bytes = Buffer.from(await response.arrayBuffer())
  }
  if (!bytes.length || bytes.length > 100 * 1024 * 1024) throw new Error('生成结果为空或超过 100MB')
  const assetId = randomUUID(), storageName = `${assetId}.bin`, now = new Date().toISOString()
  const extension = mimeType.split('/')[1]?.replace('svg+xml', 'svg') || 'bin'
  const name = `AI 生成-${new Date().toLocaleString('zh-CN').replace(/[/:]/g, '-')}.${extension}`
  writeFileSync(`${uploadDirectory}/${storageName}`, bytes)
  database.run('INSERT INTO assets (id, project_id, user_id, name, mime_type, size, storage_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [assetId, String(job.project_id), developmentUserId, name, mimeType, bytes.length, storageName, now])
  return `/api/assets/${assetId}/content`
}

app.addHook('onClose', async () => { persist(); database.close() })
await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' })
