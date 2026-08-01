import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import initSqlJs, { type Database } from 'sql.js'
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
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
  CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS project_canvases (project_id TEXT PRIMARY KEY, document TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, user_id TEXT NOT NULL, name TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL, storage_name TEXT NOT NULL, created_at TEXT NOT NULL);
`)
ensureColumn('jobs', 'project_id', 'TEXT')
ensureColumn('jobs', 'user_id', 'TEXT')
ensureColumn('assets', 'is_public', 'INTEGER NOT NULL DEFAULT 0')
ensureColumn('users', 'email', 'TEXT')
ensureColumn('users', 'password_hash', 'TEXT')
ensureColumn('projects', 'last_opened_at', 'TEXT')
const developmentUserId = 'dev-user'
const defaultProjectId = 'default'
const generationProvider = createGenerationProvider()
const bootTime = new Date().toISOString()
database.run("UPDATE jobs SET status = 'failed', progress = 0, error = ?, updated_at = ? WHERE status IN ('queued', 'running')", ['生成服务曾重启，任务已中断，请重新生成', bootTime])
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
app.post('/auth/register', async (request, reply) => {
  const body = request.body as { name?: string; email?: string; password?: string; inviteCode?: string }, name = String(body.name ?? '').trim(), email = normalizeEmail(body.email), password = String(body.password ?? ''), inviteCode = String(body.inviteCode ?? '').trim(), configuredInviteCode = String(process.env.REGISTRATION_INVITE_CODE ?? '').trim()
  if (!configuredInviteCode) return reply.code(503).send({ error: '注册暂未开放' })
  if (!secureTextEqual(inviteCode, configuredInviteCode)) return reply.code(403).send({ error: '邀请码无效' })
  if (name.length < 2 || name.length > 40) return reply.code(400).send({ error: '昵称长度需要在 2 到 40 个字符之间' })
  if (!validEmail(email)) return reply.code(400).send({ error: '请输入有效邮箱' })
  if (password.length < 8 || password.length > 128) return reply.code(400).send({ error: '密码至少需要 8 个字符' })
  if (getOne('SELECT id FROM users WHERE lower(email) = ?', [email])) return reply.code(409).send({ error: '该邮箱已注册' })
  const now = new Date().toISOString(), legacy = getOne('SELECT id FROM users WHERE id = ? AND (email IS NULL OR email = ?)', [developmentUserId, ''])
  let userId: string
  if (legacy) { userId = developmentUserId; database.run('UPDATE users SET name = ?, email = ?, password_hash = ? WHERE id = ?', [name, email, hashPassword(password), userId]) }
  else { userId = randomUUID(); database.run('INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)', [userId, name, email, hashPassword(password), now]); createDefaultProject(userId, now) }
  const token = createSession(userId, now); persist(); setSessionCookie(request, reply, token)
  return reply.code(201).send({ id: userId, name, email, createdAt: now })
})
app.post('/auth/login', async (request, reply) => {
  const body = request.body as { email?: string; password?: string }, email = normalizeEmail(body.email), password = String(body.password ?? ''), user = getOne('SELECT id, name, email, password_hash, created_at AS createdAt FROM users WHERE lower(email) = ?', [email])
  if (!user || !verifyPassword(password, String(user.password_hash ?? ''))) return reply.code(401).send({ error: '邮箱或密码错误' })
  const token = createSession(String(user.id)); persist(); setSessionCookie(request, reply, token)
  return { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt }
})
app.post('/auth/logout', async (request, reply) => { const token = sessionToken(request); if (token) database.run('DELETE FROM sessions WHERE id = ?', [sessionId(token)]); persist(); clearSessionCookie(request, reply); return { ok: true } })
app.get('/users/me', async (request, reply) => { const user = requireUser(request, reply); if (!user) return; return { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt } })
app.get('/showcase', async () => getAll(`SELECT assets.id, assets.name, assets.mime_type AS mimeType, assets.created_at AS createdAt, users.name AS author
  FROM assets JOIN users ON users.id = assets.user_id WHERE assets.is_public = 1 ORDER BY assets.created_at DESC LIMIT 30`, []).map(asset => ({ ...asset, url: namedAssetUrl(String(asset.id), String(asset.name), true) })))

app.get('/projects', async (request, reply) => { const user = requireUser(request, reply); if (!user) return; const userId = String(user.id); return getAll(`SELECT projects.id, projects.name, projects.created_at AS createdAt, projects.updated_at AS updatedAt, COALESCE(projects.last_opened_at, projects.updated_at) AS lastOpenedAt,
  (SELECT count(*) FROM assets WHERE assets.project_id = projects.id AND assets.user_id = projects.user_id) AS assetCount,
  (SELECT id FROM assets WHERE assets.project_id = projects.id AND assets.user_id = projects.user_id AND assets.mime_type LIKE 'image/%' ORDER BY assets.created_at DESC LIMIT 1) AS previewAssetId
  FROM projects WHERE projects.user_id = ? ORDER BY COALESCE(projects.last_opened_at, projects.updated_at) DESC`, [userId]).map(project => { const canvas = getOne('SELECT document FROM project_canvases WHERE project_id = ?', [String(project.id)]); let nodeCount = 0; try { nodeCount = JSON.parse(String(canvas?.document ?? '{}')).nodes?.length ?? 0 } catch { /* malformed legacy canvas */ } return { ...project, nodeCount, previewUrl: project.previewAssetId ? `/api/assets/${project.previewAssetId}/content` : null } }) })
app.post('/projects', async (request, reply) => { const user = requireUser(request, reply); if (!user) return; const body = request.body as { name?: string }, id = randomUUID(), now = new Date().toISOString(); database.run('INSERT INTO projects (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [id, String(user.id), body.name?.trim() || '未命名项目', now, now]); database.run('INSERT INTO project_canvases (project_id, document, updated_at) VALUES (?, ?, ?)', [id, emptyCanvas(), now]); persist(); return reply.code(201).send({ id, name: body.name?.trim() || '未命名项目', createdAt: now, updatedAt: now }) })
app.patch('/projects/:projectId', async (request, reply) => { const user = requireUser(request, reply); if (!user) return; const userId = String(user.id), { projectId } = request.params as { projectId: string }, name = String((request.body as { name?: string }).name ?? '').trim(); if (!ownsProject(projectId, userId)) return reply.code(404).send({ error: 'Project not found' }); if (!name || name.length > 60) return reply.code(400).send({ error: '项目名称需要在 1 到 60 个字符之间' }); const now = new Date().toISOString(); database.run('UPDATE projects SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?', [name, now, projectId, userId]); persist(); return { id: projectId, name, updatedAt: now } })
app.post('/projects/:projectId/duplicate', async (request, reply) => { const user = requireUser(request, reply); if (!user) return; const userId = String(user.id), { projectId } = request.params as { projectId: string }, source = getOne('SELECT name FROM projects WHERE id = ? AND user_id = ?', [projectId, userId]); if (!source) return reply.code(404).send({ error: 'Project not found' }); const id = randomUUID(), now = new Date().toISOString(), name = `${String(source.name)} 副本`, canvas = getOne('SELECT document FROM project_canvases WHERE project_id = ?', [projectId]); database.run('INSERT INTO projects (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [id, userId, name, now, now]); database.run('INSERT INTO project_canvases (project_id, document, updated_at) VALUES (?, ?, ?)', [id, String(canvas?.document ?? emptyCanvas()), now]); for (const asset of getAll('SELECT name, mime_type, size, storage_name, is_public FROM assets WHERE project_id = ? AND user_id = ?', [projectId, userId])) { const assetId = randomUUID(), storageName = `${assetId}.bin`; copyFileSync(`${uploadDirectory}/${asset.storage_name}`, `${uploadDirectory}/${storageName}`); database.run('INSERT INTO assets (id, project_id, user_id, name, mime_type, size, storage_name, is_public, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [assetId, id, userId, asset.name, asset.mime_type, asset.size, storageName, 0, now]) } persist(); return reply.code(201).send({ id, name, createdAt: now, updatedAt: now }) })
app.delete('/projects/:projectId', async (request, reply) => { const user = requireUser(request, reply); if (!user) return; const userId = String(user.id), { projectId } = request.params as { projectId: string }; if (!ownsProject(projectId, userId)) return reply.code(404).send({ error: 'Project not found' }); const projectCount = Number(getOne('SELECT count(*) AS count FROM projects WHERE user_id = ?', [userId])?.count ?? 0); if (projectCount <= 1) return reply.code(409).send({ error: '至少需要保留一个项目' }); const files = getAll('SELECT storage_name FROM assets WHERE project_id = ? AND user_id = ?', [projectId, userId]); for (const file of files) { const path = `${uploadDirectory}/${file.storage_name}`; if (existsSync(path)) unlinkSync(path) } database.run('DELETE FROM assets WHERE project_id = ? AND user_id = ?', [projectId, userId]); database.run('DELETE FROM project_canvases WHERE project_id = ?', [projectId]); database.run('DELETE FROM jobs WHERE project_id = ? AND user_id = ?', [projectId, userId]); database.run('DELETE FROM projects WHERE id = ? AND user_id = ?', [projectId, userId]); persist(); return reply.code(204).send() })

app.get('/projects/:projectId/canvas', async (request, reply) => { const user = requireUser(request, reply); if (!user) return; const { projectId } = request.params as { projectId: string }; if (!ownsProject(projectId, String(user.id))) return reply.code(404).send({ error: 'Project not found' }); const row = getOne('SELECT document, updated_at FROM project_canvases WHERE project_id = ?', [projectId]); if (!row) return reply.code(404).send({ error: 'Canvas not found' }); database.run('UPDATE projects SET last_opened_at = ? WHERE id = ?', [new Date().toISOString(), projectId]); persist(); return { projectId, ...JSON.parse(String(row.document)), updatedAt: row.updated_at } })
app.put('/projects/:projectId/canvas', async (request, reply) => { const user = requireUser(request, reply); if (!user) return; const { projectId } = request.params as { projectId: string }; if (!ownsProject(projectId, String(user.id))) return reply.code(404).send({ error: 'Project not found' }); const body = request.body as CanvasPayload, now = new Date().toISOString(); database.run('INSERT INTO project_canvases (project_id, document, updated_at) VALUES (?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET document=excluded.document, updated_at=excluded.updated_at', [projectId, JSON.stringify({ nodes: body.nodes, links: body.links, camera: body.camera }), now]); database.run('UPDATE projects SET updated_at = ? WHERE id = ?', [now, projectId]); persist(); return { projectId, updatedAt: now } })

app.get('/projects/:projectId/assets', async (request, reply) => { const user = requireUser(request, reply); if (!user) return; const userId = String(user.id), { projectId } = request.params as { projectId: string }; if (!ownsProject(projectId, userId)) return reply.code(404).send({ error: 'Project not found' }); return getAll('SELECT id, name, mime_type AS mimeType, size, is_public AS isPublic, created_at AS createdAt FROM assets WHERE project_id = ? AND user_id = ? ORDER BY created_at DESC', [projectId, userId]).map(asset => ({ ...asset, isPublic: Boolean(asset.isPublic), url: namedAssetUrl(String(asset.id), String(asset.name)) })) })
app.get('/assets', async (request, reply) => { const user = requireUser(request, reply); if (!user) return; const userId = String(user.id); return getAll(`SELECT assets.id, assets.project_id AS projectId, projects.name AS projectName, assets.name, assets.mime_type AS mimeType, assets.size, assets.is_public AS isPublic, assets.created_at AS createdAt FROM assets JOIN projects ON projects.id = assets.project_id WHERE assets.user_id = ? ORDER BY assets.created_at DESC`, [userId]).map(asset => ({ ...asset, isPublic: Boolean(asset.isPublic), url: namedAssetUrl(String(asset.id), String(asset.name)) })) })
app.post('/projects/:projectId/assets', async (request, reply) => { const user = requireUser(request, reply); if (!user) return; const userId = String(user.id), { projectId } = request.params as { projectId: string }; if (!ownsProject(projectId, userId)) return reply.code(404).send({ error: 'Project not found' }); const body = request.body as { files?: Array<{ name: string; mimeType: string; data: string }> }, uploaded = []; for (const file of body.files ?? []) { const bytes = Buffer.from(file.data, 'base64'); if (bytes.length > 100 * 1024 * 1024) return reply.code(413).send({ error: 'Asset exceeds 100MB' }); const id = randomUUID(), storageName = `${id}.bin`, now = new Date().toISOString(); writeFileSync(`${uploadDirectory}/${storageName}`, bytes); database.run('INSERT INTO assets (id, project_id, user_id, name, mime_type, size, storage_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [id, projectId, userId, file.name, file.mimeType, bytes.length, storageName, now]); uploaded.push({ id, name: file.name, mimeType: file.mimeType, size: bytes.length, createdAt: now, url: namedAssetUrl(id, file.name) }) } persist(); return reply.code(201).send(uploaded) })
app.get('/assets/:assetId/content', async (request, reply) => { const user = requireUser(request, reply); if (!user) return; const { assetId } = request.params as { assetId: string }; const asset = getOne('SELECT name FROM assets WHERE id = ? AND user_id = ?', [assetId, String(user.id)]); if (!asset) return reply.code(404).send({ error: 'Asset not found' }); return reply.code(302).header('location', namedAssetUrl(assetId, String(asset.name))).send() })
app.get('/assets/:assetId/content/:filename', async (request, reply) => { const user = requireUser(request, reply); if (!user) return; const { assetId } = request.params as { assetId: string }; const asset = getOne('SELECT name, mime_type, storage_name FROM assets WHERE id = ? AND user_id = ?', [assetId, String(user.id)]); if (!asset) return reply.code(404).send({ error: 'Asset not found' }); reply.type(String(asset.mime_type)).header('content-disposition', assetDisposition(String(asset.name))).header('cache-control', 'private, max-age=3600'); return reply.send(readFileSync(`${uploadDirectory}/${asset.storage_name}`)) })
app.get('/public/assets/:assetId/content', async (request, reply) => { const { assetId } = request.params as { assetId: string }; const asset = getOne('SELECT name FROM assets WHERE id = ? AND is_public = 1', [assetId]); if (!asset) return reply.code(404).send({ error: 'Asset not found' }); return reply.code(302).header('location', namedAssetUrl(assetId, String(asset.name), true)).send() })
app.get('/public/assets/:assetId/content/:filename', async (request, reply) => { const { assetId } = request.params as { assetId: string }; const asset = getOne('SELECT name, mime_type, storage_name FROM assets WHERE id = ? AND is_public = 1', [assetId]); if (!asset) return reply.code(404).send({ error: 'Asset not found' }); reply.type(String(asset.mime_type)).header('content-disposition', assetDisposition(String(asset.name))).header('cache-control', 'public, max-age=3600'); return reply.send(readFileSync(`${uploadDirectory}/${asset.storage_name}`)) })
app.patch('/assets/:assetId/visibility', async (request, reply) => { const user = requireUser(request, reply); if (!user) return; const userId = String(user.id), { assetId } = request.params as { assetId: string }; const asset = getOne('SELECT id FROM assets WHERE id = ? AND user_id = ?', [assetId, userId]); if (!asset) return reply.code(404).send({ error: 'Asset not found' }); const body = request.body as { isPublic?: boolean }; database.run('UPDATE assets SET is_public = ? WHERE id = ? AND user_id = ?', [body.isPublic ? 1 : 0, assetId, userId]); persist(); return { id: assetId, isPublic: Boolean(body.isPublic) } })
app.delete('/assets/:assetId', async (request, reply) => { const user = requireUser(request, reply); if (!user) return; const userId = String(user.id), { assetId } = request.params as { assetId: string }; const asset = getOne('SELECT storage_name FROM assets WHERE id = ? AND user_id = ?', [assetId, userId]); if (!asset) return reply.code(404).send({ error: 'Asset not found' }); const path = `${uploadDirectory}/${asset.storage_name}`; if (existsSync(path)) unlinkSync(path); database.run('DELETE FROM assets WHERE id = ? AND user_id = ?', [assetId, userId]); persist(); return reply.code(204).send() })

app.get('/canvases/:id', async (request, reply) => {
  const user = requireUser(request, reply); if (!user) return
  const { id } = request.params as { id: string }
  if (!ownsProject(id, String(user.id))) return reply.code(404).send({ error: 'Canvas not found' })
  const row = getOne('SELECT id, title, document, updated_at FROM canvases WHERE id = ?', [id])
  if (!row) return reply.code(404).send({ error: 'Canvas not found' })
  return { id: row.id, title: row.title, ...JSON.parse(String(row.document)), updatedAt: row.updated_at }
})

app.put('/canvases/:id', async (request, reply) => {
  const user = requireUser(request, reply); if (!user) return
  const { id } = request.params as { id: string }
  if (!ownsProject(id, String(user.id))) return reply.code(404).send({ error: 'Canvas not found' })
  const body = request.body as CanvasPayload & { title?: string }
  const now = new Date().toISOString()
  database.run(`INSERT INTO canvases (id, title, document, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET title = excluded.title, document = excluded.document, updated_at = excluded.updated_at`,
    [id, body.title ?? '未命名项目', JSON.stringify({ nodes: body.nodes, links: body.links, camera: body.camera }), now])
  persist()
  return { id, updatedAt: now }
})

app.post('/jobs', async (request, reply) => {
  const user = requireUser(request, reply); if (!user) return
  const userId = String(user.id)
  const input = request.body as JobInput
  if (!input.prompt?.trim()) return reply.code(400).send({ error: 'Prompt is required' })
  const projectId = input.projectId ?? defaultProjectId
  if (!ownsProject(projectId, userId)) return reply.code(404).send({ error: 'Project not found' })
  let inputUrls: string[]
  try { inputUrls = resolveOwnedInputUrls(input.inputUrls ?? [], userId, input.kind) }
  catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : '无法读取输入素材' }) }
  const id = randomUUID(), now = new Date().toISOString(), model = input.model ?? (input.kind === 'video' ? process.env.AGNES_VIDEO_DEFAULT_MODEL || 'agnes-video-v2.0' : process.env.OPENAI_IMAGE_DEFAULT_MODEL || 'gpt-image-2')
  database.run('INSERT INTO jobs (id, project_id, user_id, node_id, kind, prompt, model, status, progress, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, projectId, userId, input.nodeId, input.kind, input.prompt, model, 'queued', 0, now, now])
  persist()
  void generationProvider.run({ internalJobId: id, projectId, nodeId: input.nodeId, kind: input.kind, prompt: input.prompt, model, inputUrls, parameters: input.parameters ?? {} }, update => { void updateJob(id, update) }).catch(error => { void updateJob(id, { status: 'failed', progress: 0, error: error instanceof Error ? error.message : 'Generation failed' }) })
  return reply.code(202).send({ id, status: 'queued', progress: 0, model, provider: generationProvider.name })
})

app.get('/jobs/:id', async (request, reply) => {
  const user = requireUser(request, reply); if (!user) return
  const { id } = request.params as { id: string }
  const row = getOne('SELECT * FROM jobs WHERE id = ? AND user_id = ?', [id, String(user.id)])
  return row ?? reply.code(404).send({ error: 'Job not found' })
})

function getOne(sql: string, values: Array<string | number>) {
  const statement = database.prepare(sql); statement.bind(values)
  const row = statement.step() ? statement.getAsObject() : undefined
  statement.free(); return row
}
function getAll(sql: string, values: Array<string | number>) { const statement = database.prepare(sql); statement.bind(values); const rows = []; while (statement.step()) rows.push(statement.getAsObject()); statement.free(); return rows }
function ownsProject(projectId: string, userId: string) { return Boolean(getOne('SELECT id FROM projects WHERE id = ? AND user_id = ?', [projectId, userId])) }
function ensureColumn(table: string, column: string, definition: string) { const columns = getAll(`PRAGMA table_info(${table})`, []); if (!columns.some(item => item.name === column)) database.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`) }
function normalizeEmail(value: unknown) { return String(value ?? '').trim().toLowerCase() }
function validEmail(email: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 }
function assetDisposition(name: string) { const safe = name.replace(/[\r\n]/g, '').slice(0, 240) || 'asset'; return `inline; filename="asset"; filename*=UTF-8''${encodeURIComponent(safe)}` }
function namedAssetUrl(id: string, name: string, isPublic = false) { const safe = name.replace(/[\r\n/\\]/g, '').slice(0, 240) || 'asset'; return `/api/${isPublic ? 'public/' : ''}assets/${id}/content/${encodeURIComponent(safe)}` }
function resolveOwnedInputUrls(urls: string[], userId: string, kind: JobInput['kind']) { return urls.map(source => { const match = source.match(/^\/api\/assets\/([^/]+)\/content(?:\/|$)/); if (!match) return source; const asset = getOne('SELECT mime_type, size, storage_name FROM assets WHERE id = ? AND user_id = ?', [decodeURIComponent(match[1]), userId]); if (!asset) throw new Error('输入素材不存在或不属于当前用户'); const size = Number(asset.size ?? 0); if (kind === 'video' && size > 15 * 1024 * 1024) throw new Error('首帧图片超过 15MB'); const bytes = readFileSync(`${uploadDirectory}/${asset.storage_name}`); if (!bytes.length) throw new Error('输入素材为空'); return `data:${String(asset.mime_type || 'application/octet-stream')};base64,${bytes.toString('base64')}` }) }
function hashPassword(password: string) { const salt = randomBytes(16).toString('hex'), digest = scryptSync(password, salt, 64).toString('hex'); return `scrypt:${salt}:${digest}` }
function verifyPassword(password: string, stored: string) { const [, salt, expected] = stored.split(':'); if (!salt || !expected) return false; try { const actual = scryptSync(password, salt, 64), expectedBytes = Buffer.from(expected, 'hex'); return actual.length === expectedBytes.length && timingSafeEqual(actual, expectedBytes) } catch { return false } }
function secureTextEqual(actual: string, expected: string) { const left = createHash('sha256').update(actual).digest(), right = createHash('sha256').update(expected).digest(); return timingSafeEqual(left, right) }
function sessionId(token: string) { return createHash('sha256').update(token).digest('hex') }
function sessionToken(request: FastifyRequest) { const cookie = String(request.headers.cookie ?? '').split(';').map(part => part.trim()).find(part => part.startsWith('flow_session=')); return cookie ? decodeURIComponent(cookie.slice('flow_session='.length)) : '' }
function createSession(userId: string, createdAt = new Date().toISOString()) { const token = randomBytes(32).toString('base64url'), expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); database.run('DELETE FROM sessions WHERE expires_at <= ?', [createdAt]); database.run('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', [sessionId(token), userId, createdAt, expiresAt]); return token }
function currentUser(request: FastifyRequest) { const token = sessionToken(request); if (!token) return undefined; return getOne(`SELECT users.id, users.name, users.email, users.created_at AS createdAt FROM sessions JOIN users ON users.id = sessions.user_id
  WHERE sessions.id = ? AND sessions.expires_at > ?`, [sessionId(token), new Date().toISOString()]) }
function requireUser(request: FastifyRequest, reply: FastifyReply) { const user = currentUser(request); if (!user) { void reply.code(401).send({ error: 'Unauthorized' }); return undefined } return user }
function secureRequest(request: FastifyRequest) { const proto = request.headers['x-forwarded-proto']; return (Array.isArray(proto) ? proto[0] : proto) === 'https' }
function setSessionCookie(request: FastifyRequest, reply: FastifyReply, token: string) { reply.header('set-cookie', `flow_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}${secureRequest(request) ? '; Secure' : ''}`) }
function clearSessionCookie(request: FastifyRequest, reply: FastifyReply) { reply.header('set-cookie', `flow_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureRequest(request) ? '; Secure' : ''}`) }
function emptyCanvas() { return JSON.stringify({ nodes: [], links: [], camera: { x: 0, y: 0, zoom: 1 } }) }
function createDefaultProject(userId: string, now = new Date().toISOString()) { const id = randomUUID(); database.run('INSERT INTO projects (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [id, userId, '未命名项目', now, now]); database.run('INSERT INTO project_canvases (project_id, document, updated_at) VALUES (?, ?, ?)', [id, emptyCanvas(), now]); return id }

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
  const job = getOne('SELECT project_id, user_id, kind, prompt FROM jobs WHERE id = ?', [jobId])
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
  database.run('INSERT INTO assets (id, project_id, user_id, name, mime_type, size, storage_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [assetId, String(job.project_id), String(job.user_id), name, mimeType, bytes.length, storageName, now])
  return namedAssetUrl(assetId, name)
}

app.addHook('onClose', async () => { persist(); database.close() })
await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' })
