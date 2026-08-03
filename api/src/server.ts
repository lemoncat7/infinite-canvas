import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import initSqlJs, { type Database } from 'sql.js'
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { createGenerationProvider, type GenerationUpdate } from './providers/index.js'
import { OpenAiImageProvider } from './providers/openai-image.js'
import { OpenAiVideoProvider } from './providers/openai-video.js'
import { ProxyAgent, fetch as undiciFetch } from 'undici'
import sharp from 'sharp'

type CanvasPayload = { nodes: unknown[]; links: unknown[]; camera?: unknown }
type JobInput = { projectId?: string; nodeId: number; kind: 'image' | 'video'; prompt: string; model?: string; inputUrls?: string[]; parameters?: Record<string, unknown> }

const dataDirectory = process.env.DATA_DIR ?? './data'
const databasePath = `${dataDirectory}/flow-studio.sqlite`
const uploadDirectory = `${dataDirectory}/uploads`
const thumbnailDirectory = `${dataDirectory}/thumbnails`
mkdirSync(dataDirectory, { recursive: true })
mkdirSync(uploadDirectory, { recursive: true })
mkdirSync(thumbnailDirectory, { recursive: true })
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
  CREATE TABLE IF NOT EXISTS user_api_models (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, model TEXT NOT NULL, base_url TEXT NOT NULL, api_key TEXT NOT NULL, proxy_url TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS recharge_codes (id TEXT PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE, credits INTEGER NOT NULL, redeemed_by TEXT, redeemed_at TEXT, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS credit_transactions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, amount INTEGER NOT NULL, type TEXT NOT NULL, reference_id TEXT, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS app_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
`)
ensureColumn('jobs', 'project_id', 'TEXT')
ensureColumn('jobs', 'user_id', 'TEXT')
ensureColumn('jobs', 'input_urls', "TEXT NOT NULL DEFAULT '[]'")
ensureColumn('jobs', 'parameters', "TEXT NOT NULL DEFAULT '{}'")
ensureColumn('jobs', 'custom_model_id', 'TEXT')
ensureColumn('assets', 'is_public', 'INTEGER NOT NULL DEFAULT 0')
ensureColumn('users', 'email', 'TEXT')
ensureColumn('users', 'password_hash', 'TEXT')
ensureColumn('users', 'username', 'TEXT')
ensureColumn('users', 'invite_code', 'TEXT')
ensureColumn('users', 'invited_by', 'TEXT')
ensureColumn('users', 'lab_enabled', 'INTEGER NOT NULL DEFAULT 0')
ensureColumn('users', 'credits', 'INTEGER NOT NULL DEFAULT 5')
ensureColumn('users', 'reserved_credits', 'INTEGER NOT NULL DEFAULT 0')
ensureColumn('users', 'is_admin', 'INTEGER NOT NULL DEFAULT 0')
ensureColumn('jobs', 'credit_cost', 'INTEGER NOT NULL DEFAULT 0')
ensureColumn('jobs', 'credit_settled', 'INTEGER NOT NULL DEFAULT 0')
if (!getOne('SELECT id FROM app_migrations WHERE id = ?', ['reset-initial-credits-to-5'])) {
  const now = new Date().toISOString()
  database.run('UPDATE users SET credits = 5, reserved_credits = 0')
  database.run('INSERT INTO app_migrations (id,applied_at) VALUES (?,?)', ['reset-initial-credits-to-5',now])
}
ensureColumn('projects', 'last_opened_at', 'TEXT')
for (const user of getAll('SELECT id FROM users WHERE invite_code IS NULL OR invite_code = ?', [''])) database.run('UPDATE users SET invite_code = ? WHERE id = ?', [newInviteCode(), String(user.id)])
const developmentUserId = 'dev-user'
const defaultProjectId = 'default'
const generationProvider = createGenerationProvider()
const generationInputSigningSecret = process.env.GENERATION_INPUT_SIGNING_SECRET || randomBytes(32).toString('hex')
const generationPublicBaseUrl = String(process.env.GENERATION_PUBLIC_BASE_URL || '').replace(/\/$/, '')
const bootTime = new Date().toISOString()
for (const job of getAll("SELECT id FROM jobs WHERE status = 'running'", [])) settleJobCredits(String(job.id), false)
database.run("UPDATE jobs SET status = 'failed', progress = 0, error = ?, updated_at = ? WHERE status = 'running'", ['生成服务曾重启，任务已中断，请重新生成', bootTime])
database.run('INSERT OR IGNORE INTO users (id, name, created_at) VALUES (?, ?, ?)', [developmentUserId, '开发用户', bootTime])
database.run("UPDATE users SET username = ? WHERE id = ? AND (username IS NULL OR username = '')", ['mochen', developmentUserId])
database.run("UPDATE users SET is_admin = 1 WHERE lower(username) = 'mochen'")
for (const user of getAll("SELECT id, name FROM users WHERE username IS NULL OR username = ''", [])) database.run('UPDATE users SET username = ? WHERE id = ?', [availableUsername(String(user.name || 'user')), String(user.id)])
for (const user of getAll('SELECT id FROM users WHERE invite_code IS NULL OR invite_code = ?', [''])) database.run('UPDATE users SET invite_code = ? WHERE id = ?', [newInviteCode(), String(user.id)])
persist()

const app = Fastify({ logger: true, bodyLimit: 150 * 1024 * 1024 })
app.get('/health', async () => ({ ok: true, service: 'flow-studio-api', generationProvider: generationProvider.name }))
app.get('/generation/capabilities', async () => generationProvider.capabilities ?? {
  image: { provider: generationProvider.name, defaultModel: process.env.OPENAI_IMAGE_DEFAULT_MODEL || 'gpt-image-2' },
  video: { provider: generationProvider.name, defaultModel: process.env.AGNES_VIDEO_DEFAULT_MODEL || 'agnes-video-v2.0', seconds: { min: 1, max: 18, default: 5 }, resolutions: ['480p', '720p', '1080p'], aspectRatios: ['1:1', '4:3', '16:9'] },
})
app.post('/agents/prompt', async (request, reply) => {
  const user = requireUser(request, reply); if (!user) return
  const input = request.body as { idea?:string; kind?:string; complexity?:string; context?:string[]; visuals?:string[]; model?:string; target?:{id?:number;kind?:string;role?:string;hasMedia?:boolean;hasPrompt?:boolean}|null }, idea = String(input.idea ?? '').trim(), kind = input.kind === 'video' ? 'video' : 'image', complexity = input.complexity === 'detailed' ? 'detailed' : 'simple', context = (input.context ?? []).map(item => String(item).trim()).filter(Boolean).slice(0, 8)
  if (!idea || idea.length > 4000) return reply.code(400).send({ error:'请输入 1–4000 字的创作想法' })
  const baseUrl = String(process.env.PROMPT_AGENT_BASE_URL || process.env.OPENAI_IMAGE_BASE_URL || '').replace(/\/$/, ''), apiKey = String(process.env.PROMPT_AGENT_API_KEY || process.env.OPENAI_IMAGE_API_KEY || ''), allowedModels = ['gpt-5.5','kimi-k2.5','gpt-5.4-mini'], requestedModel = String(input.model || process.env.PROMPT_AGENT_MODEL || 'gpt-5.5'), model = allowedModels.includes(requestedModel) ? requestedModel : 'gpt-5.5'
  if (!baseUrl || !apiKey) return reply.code(503).send({ error:'提示词 Agent 接口尚未配置' })
  const detailRule = complexity === 'simple' ? `finalPrompt 控制在${kind === 'video' ? '180' : '120'}个中文字符以内，只保留主体、场景、关键动作或构图与一种主要风格，避免堆砌。` : `详细模式通过拆分更多必要步骤、分镜和依赖关系表达复杂度，不要增加单个图片步骤的提示词长度；另可返回 subject、scene、composition、lighting、style、motion、negativePrompt 字符串字段。`
  const system = `你是 Viora 无限画布中的创作 Agent。理解用户需求、当前节点和上游视觉素材，规划可实际执行的完整工作流并生成底层提示词。只返回合法完整 JSON，不要 Markdown或解释。必须包含 finalPrompt、action、targetType、summary、shouldGenerate、steps。steps 是按执行顺序排列的数组，每项必须为 {"title":"简短名称","kind":"image或video","prompt":"该节点独立使用的完整提示词","referenceIndexes":[1],"dependsOn":[1]}。所有 kind=image 的步骤默认使用 gpt-image-2，每条 prompt 必须控制在 140 个中文字符以内，只保留主体/参考素材对应关系、关键修改、场景构图和一种主要风格；禁止堆砌形容词、镜头参数、材质清单和重复约束。图片需求复杂时拆为多个具有明确职责的 image 步骤，不得写成一条超长提示词。referenceIndexes 使用用户附带视觉参考的 1 开始编号；dependsOn 使用 steps 的 1 开始编号，只能引用当前步骤之前的步骤。复杂视频必须采用分层生产链：先按需要生成可复用的人物、产品和环境设定图；再为每个镜头创建独立的最终分镜 image 步骤，通过 dependsOn 组合该镜头所需的设定素材；最后每个 video 步骤只依赖自己对应的最终分镜图，不要再次直接依赖已经被该分镜使用的人物或场景祖先素材。每个含人物或产品的 video 提示词都要明确要求严格保持输入分镜中的身份、脸型、发型、服装、产品外形和配色，禁止换脸、改变年龄性别、重设计服装或产品；只描述必要动作、环境运动和镜头运动。若最终视频需要先创造场景、人物或分镜参考图，必须先规划 image 步骤，再让 video 步骤通过 dependsOn 引用对应图片步骤。不同镜头需要不同场景时分别生成并正确复用；需要保持角色、产品或美术一致性时复用统一设定图。最终交付物必须出现在 steps 中：用户要视频时不能只返回准备图片，必须包含至少一个 video 步骤；用户明确不要视频时禁止添加 video。若用户已有合适图片，应优先直接引用素材，不重复生成。需要多个方案、场景或分镜时拆成多个步骤，每个视频镜头独立一个 video 步骤，最多 16 步。用户明确指定数量时必须准确提供相应数量的最终交付步骤；若还需要角色设定等中间步骤，应在 16 步内一并规划。禁止循环依赖，video 步骤通常作为末端。需求非常模糊且未指定媒体类型时，采用最小可行方案，只创建一个 image 步骤，不擅自扩展视频。action 只能是 update_current、create_child、create_new；targetType 只能是 image、video；summary 用一句简短中文说明完整执行链。没有当前节点时 create_new；有素材并继续创作时 create_child。用户点击开始创作即视为授权执行，shouldGenerate 默认 true，除非用户明确只要求规划或提示词。${detailRule} 当前节点信息：${JSON.stringify(input.target ?? null)}。不要声称媒体已经生成。`
  const visualSources = (input.visuals ?? []).map(String).filter(source=>/^\/api\/assets\/[^/]+\/content(?:\/|$)/.test(source)).slice(0,8)
  let visualInputs:string[]=[]
  try { validateOwnedInputUrls(visualSources,String(user.id),'image'); visualInputs=resolveOwnedInputUrls(visualSources,String(user.id),'image',model) } catch { return reply.code(400).send({error:'Agent 无法读取所选参考图片'}) }
  const textContent = [`用户想法：${idea}`, context.length ? `画布上下文：\n${context.map((item,index)=>`${index+1}. ${item}`).join('\n')}` : '画布上下文：无', visualInputs.length ? `附带 ${visualInputs.length} 张视觉参考，顺序与参考节点中的图片顺序一致。请理解图片内容后再生成提示词。` : '没有视觉参考。'].join('\n\n')
  const content:unknown = visualInputs.length ? [{type:'text',text:textContent},...visualInputs.map(url=>({type:'image_url',image_url:{url}}))] : textContent
  const clientAbort=new AbortController();request.raw.once('aborted',()=>clientAbort.abort());reply.raw.once('close',()=>{if(!reply.raw.writableEnded)clientAbort.abort()})
  try {
    const url = `${baseUrl}/v1/chat/completions`
    const proxyUrl = String(process.env.PROMPT_AGENT_HTTPS_PROXY || process.env.OPENAI_IMAGE_HTTPS_PROXY || '')
    let result:Record<string,unknown>|undefined,raw='',finishReason=''
    for(let attempt=1;attempt<=2;attempt++){
      const options = { method:'POST', headers:{ authorization:`Bearer ${apiKey}`, 'content-type':'application/json' }, body:JSON.stringify({ model, stream:false, temperature:complexity === 'simple' ? .35 : .65, max_tokens:complexity === 'simple' ? 4800 : 7000, response_format:{ type:'json_object' }, messages:[{role:'system',content:system},{role:'user',content}] }), signal:AbortSignal.any([clientAbort.signal,AbortSignal.timeout(Number(process.env.PROMPT_AGENT_TIMEOUT_MS || 90000))]) }
      const response = proxyUrl ? await undiciFetch(url, { ...options, dispatcher:new ProxyAgent(proxyUrl) }) : await fetch(url, options)
      const payload = await response.json() as { choices?:Array<{finish_reason?:string;message?:{content?:string}}>; error?:{message?:string} }
      if(!response.ok){if(attempt<2&&(response.status===429||response.status>=500)){request.log.warn({attempt,status:response.status},'prompt agent upstream retry');continue}return reply.code(response.status).send({ error:payload.error?.message || `Agent 接口返回 ${response.status}` })}
      raw=String(payload.choices?.[0]?.message?.content||'').replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();finishReason=String(payload.choices?.[0]?.finish_reason||'')
      try{const parsed=parsePromptAgentResult(raw);if(!String(parsed.finalPrompt??'').trim())throw new SyntaxError('Agent missing finalPrompt');result=parsed;break}catch(error){if(attempt>=2)throw error;request.log.warn({attempt,finishReason,responseLength:raw.length},'prompt agent malformed response retry')}
    }
    if(!result)throw new SyntaxError('Agent returned no valid plan')
    request.log.info({ model, complexity, finishReason, responseLength:raw.length }, 'prompt agent response received')
    const field = (name:string) => String(result[name] ?? '').trim()
    const rawFinalPrompt = field('finalPrompt'); if (!rawFinalPrompt) throw new Error('Agent 未返回 finalPrompt')
    const action=['update_current','create_child','create_new'].includes(field('action'))?field('action'):'create_child', targetType=field('targetType')==='video'?'video':field('targetType')==='image'?'image':kind
    const finalPrompt = targetType === 'image' ? compactImagePrompt(rawFinalPrompt) : rawFinalPrompt
    const rawSteps=Array.isArray(result.steps)?result.steps:[];let steps=rawSteps.slice(0,16).map((item,index)=>{const step=item&&typeof item==='object'?item as Record<string,unknown>:{};const stepKind=step.kind==='video'?'video':'image';const rawPrompt=String(step.prompt||'').trim();return {title:String(step.title||'').trim(),kind:stepKind,prompt:stepKind==='image'?compactImagePrompt(rawPrompt):rawPrompt,referenceIndexes:Array.isArray(step.referenceIndexes)?[...new Set(step.referenceIndexes.map(Number).filter(value=>Number.isInteger(value)&&value>=1&&value<=visualInputs.length))]:[],dependsOn:Array.isArray(step.dependsOn)?[...new Set(step.dependsOn.map(Number).filter(value=>Number.isInteger(value)&&value>=1&&value<=index))]:[]}}).filter(step=>step.prompt)
    const explicitlyNoVideo=/(?:不要|无需|不需要|禁止)(?:生成|制作)?视频|只(?:要|生成).{0,8}(?:图片|海报|封面)/.test(idea);let forcedFinalVideo=false
    if(kind==='video'&&!explicitlyNoVideo&&!steps.some(step=>step.kind==='video')){forcedFinalVideo=true;steps=steps.slice(0,15);const imageDependencies=steps.map((step,index)=>step.kind==='image'?index+1:0).filter(Boolean);steps.push({title:'最终视频',kind:'video',prompt:`根据前置关键视觉素材制作完整视频：${idea}`.slice(0,500),referenceIndexes:visualInputs.map((_,index)=>index+1),dependsOn:imageDependencies})}
    const isAncestor=(candidate:number,stepNumber:number,seen=new Set<number>()):boolean=>{if(seen.has(stepNumber))return false;seen.add(stepNumber);const parent=steps[stepNumber-1];return Boolean(parent?.dependsOn.some(dependency=>dependency===candidate||isAncestor(candidate,dependency,seen)))}
    steps=steps.map(step=>step.kind!=='video'?step:{...step,dependsOn:step.dependsOn.filter(candidate=>!step.dependsOn.some(other=>other!==candidate&&isAncestor(candidate,other)))})
    return { model, kind:targetType, action, targetType, summary:forcedFinalVideo?'先生成所需关键视觉图，再基于这些素材制作最终视频。':field('summary')||`已准备${targetType==='video'?'视频':'图像'}创作节点`, shouldGenerate:result.shouldGenerate!==false, steps:steps.length?steps:[{title:'创作任务',kind:targetType,prompt:finalPrompt,referenceIndexes:visualInputs.map((_,index)=>index+1),dependsOn:[]}], subject:field('subject'), scene:field('scene'), composition:field('composition'), lighting:field('lighting'), style:field('style'), motion:field('motion'), negativePrompt:field('negativePrompt'), finalPrompt }
  } catch (error) { if(clientAbort.signal.aborted)return;request.log.error({ message:error instanceof Error ? error.message : String(error) }, 'prompt agent failed'); return reply.code(502).send({ error:error instanceof SyntaxError ? 'Agent 返回内容不完整，请重新生成一次' : error instanceof Error ? error.message : '提示词生成失败' }) }
})
app.get('/user-api-models', async (request, reply) => { const user = requireUser(request, reply); if (!user) return; return getAll('SELECT id, kind, name, model, base_url AS baseUrl, CASE WHEN proxy_url IS NULL OR proxy_url = ? THEN 0 ELSE 1 END AS hasProxy, created_at AS createdAt, updated_at AS updatedAt FROM user_api_models WHERE user_id = ? ORDER BY created_at ASC', ['', String(user.id)]).map(item => ({ ...item, hasProxy: Boolean(item.hasProxy), hasKey: true })) })
app.post('/user-api-models', async (request, reply) => { const user = requireUser(request, reply); if (!user) return; const body = request.body as { kind?: string; name?: string; model?: string; baseUrl?: string; apiKey?: string; proxyUrl?: string }, kind = String(body.kind ?? ''), name = String(body.name ?? '').trim(), model = String(body.model ?? '').trim(), baseUrl = normalizeHttpUrl(body.baseUrl), apiKey = String(body.apiKey ?? '').trim(), proxyUrl = String(body.proxyUrl ?? '').trim(); if (!['image', 'video'].includes(kind)) return reply.code(400).send({ error: '请选择图像或视频类型' }); if (!name || name.length > 60 || !model || model.length > 120 || !baseUrl || !apiKey) return reply.code(400).send({ error: '请完整填写名称、模型、接口地址和密钥' }); if (proxyUrl && !normalizeHttpUrl(proxyUrl)) return reply.code(400).send({ error: '代理地址无效' }); const id = randomUUID(), now = new Date().toISOString(); database.run('INSERT INTO user_api_models (id,user_id,kind,name,model,base_url,api_key,proxy_url,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [id,String(user.id),kind,name,model,baseUrl,apiKey,proxyUrl,now,now]); persist(); return reply.code(201).send({ id,kind,name,model,baseUrl,hasKey:true,hasProxy:Boolean(proxyUrl),createdAt:now,updatedAt:now }) })
app.delete('/user-api-models/:id', async (request, reply) => { const user = requireUser(request, reply); if (!user) return; const { id } = request.params as { id:string }; database.run('DELETE FROM user_api_models WHERE id = ? AND user_id = ?', [id,String(user.id)]); persist(); return reply.code(204).send() })
app.post('/user-api-models/test', async (request, reply) => { const user = requireUser(request, reply); if (!user) return; const body = request.body as { baseUrl?:string; apiKey?:string }; const baseUrl = normalizeHttpUrl(body.baseUrl), apiKey = String(body.apiKey ?? '').trim(); if (!baseUrl || !apiKey) return reply.code(400).send({ error:'请填写接口地址和密钥' }); try { const response = await fetch(`${baseUrl}/v1/models`, { headers:{ authorization:`Bearer ${apiKey}` }, signal:AbortSignal.timeout(12000) }); if (!response.ok) return reply.code(400).send({ error:`接口返回 ${response.status}` }); return { ok:true } } catch (error) { return reply.code(400).send({ error:error instanceof Error ? error.message : '连接失败' }) } })
app.get('/generation-inputs/:assetId', async (request, reply) => {
  const { assetId } = request.params as { assetId: string }
  const { expires, signature } = request.query as { expires?: string; signature?: string }
  const expiry = Number(expires)
  if (!Number.isFinite(expiry) || expiry < Math.floor(Date.now() / 1000) || expiry > Math.floor(Date.now() / 1000) + 3600 || !signature || !validGenerationInputSignature(assetId, expiry, signature)) return reply.code(403).send({ error: 'Generation input URL is invalid or expired' })
  const asset = getOne('SELECT mime_type, storage_name FROM assets WHERE id = ?', [assetId])
  if (!asset) return reply.code(404).send({ error: 'Asset not found' })
  return reply.type(String(asset.mime_type)).header('cache-control', 'private, no-store').send(readFileSync(`${uploadDirectory}/${asset.storage_name}`))
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
  const inviter = inviteCode ? getOne('SELECT id FROM users WHERE upper(invite_code) = ?', [inviteCode.toUpperCase()]) : undefined
  if (!configuredInviteCode && !inviter) return reply.code(503).send({ error: '注册暂未开放' })
  if (!inviter && (!configuredInviteCode || !secureTextEqual(inviteCode, configuredInviteCode))) return reply.code(403).send({ error: '邀请码无效' })
  if (name.length < 2 || name.length > 40) return reply.code(400).send({ error: '昵称长度需要在 2 到 40 个字符之间' })
  if (!validEmail(email)) return reply.code(400).send({ error: '请输入有效邮箱' })
  if (password.length < 8 || password.length > 128) return reply.code(400).send({ error: '密码至少需要 8 个字符' })
  if (getOne('SELECT id FROM users WHERE lower(email) = ?', [email])) return reply.code(409).send({ error: '该邮箱已注册' })
  if (getOne('SELECT id FROM users WHERE lower(username) = ?', [name.toLowerCase()])) return reply.code(409).send({ error: '该用户名已被使用' })
  const now = new Date().toISOString(), legacy = getOne('SELECT id FROM users WHERE id = ? AND (email IS NULL OR email = ?)', [developmentUserId, ''])
  let userId: string
  if (legacy) { userId = developmentUserId; database.run('UPDATE users SET name = ?, email = ?, password_hash = ?, username = COALESCE(NULLIF(username, ?), ?), invited_by = COALESCE(invited_by, ?) WHERE id = ?', [name, email, hashPassword(password), '', name, inviter?.id ?? null, userId]) }
  else { userId = randomUUID(); database.run('INSERT INTO users (id, name, email, password_hash, username, invite_code, invited_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [userId, name, email, hashPassword(password), name, newInviteCode(), inviter?.id ?? null, now]); createDefaultProject(userId, now) }
  const token = createSession(userId, now); persist(); setSessionCookie(request, reply, token)
  if (!legacy) database.run('UPDATE users SET credits = 5 WHERE id = ?', [userId])
  const createdUser = getOne('SELECT username, invite_code AS inviteCode, credits, reserved_credits AS reservedCredits, is_admin AS isAdmin FROM users WHERE id = ?', [userId])
  return reply.code(201).send({ id: userId, name, username: createdUser?.username, email, inviteCode: createdUser?.inviteCode, createdAt: now, credits:Number(createdUser?.credits ?? 0), reservedCredits:Number(createdUser?.reservedCredits ?? 0), isAdmin:Boolean(createdUser?.isAdmin) })
})
app.post('/auth/login', async (request, reply) => {
  const body = request.body as { email?: string; account?: string; password?: string }, account = String(body.account ?? body.email ?? '').trim().toLowerCase(), password = String(body.password ?? ''), user = getOne('SELECT id, name, username, email, password_hash, invite_code AS inviteCode, created_at AS createdAt, credits, reserved_credits AS reservedCredits, is_admin AS isAdmin FROM users WHERE lower(email) = ? OR lower(username) = ? ORDER BY CASE WHEN lower(email) = ? THEN 0 ELSE 1 END LIMIT 1', [account, account, account])
  if (!user || !verifyPassword(password, String(user.password_hash ?? ''))) return reply.code(401).send({ error: '用户名、邮箱或密码错误' })
  const token = createSession(String(user.id)); persist(); setSessionCookie(request, reply, token)
  return { id: user.id, name: user.name, username: user.username, email: user.email, inviteCode: user.inviteCode, createdAt: user.createdAt, credits:Number(user.credits ?? 0), reservedCredits:Number(user.reservedCredits ?? 0), isAdmin:Boolean(user.isAdmin) }
})
app.post('/auth/logout', async (request, reply) => { const token = sessionToken(request); if (token) database.run('DELETE FROM sessions WHERE id = ?', [sessionId(token)]); persist(); clearSessionCookie(request, reply); return { ok: true } })
app.get('/users/me', async (request, reply) => { const user = requireUser(request, reply); if (!user) return; return { id: user.id, name: user.name, username: user.username, email: user.email, inviteCode: user.inviteCode, createdAt: user.createdAt, credits:Number(user.credits ?? 0), reservedCredits:Number(user.reservedCredits ?? 0), isAdmin:Boolean(user.isAdmin) } })
app.patch('/users/me', async (request, reply) => { const user = requireUser(request, reply); if (!user) return; const name = String((request.body as { name?: string }).name ?? '').trim(); if (name.length < 2 || name.length > 40) return reply.code(400).send({ error: '昵称长度需要在 2 到 40 个字符之间' }); database.run('UPDATE users SET name = ? WHERE id = ?', [name, String(user.id)]); persist(); return { ...user, name } })
app.post('/users/me/credits/redeem', async (request, reply) => { const user=requireUser(request,reply); if(!user)return; const code=normalizeRechargeCode((request.body as {code?:string}).code), codeHash=hashRechargeCode(code); if(!code)return reply.code(400).send({error:'请输入充值码'}); const voucher=getOne('SELECT id,credits,redeemed_by AS redeemedBy FROM recharge_codes WHERE code_hash = ?', [codeHash]); if(!voucher)return reply.code(404).send({error:'充值码无效'}); if(voucher.redeemedBy)return reply.code(409).send({error:'该充值码已经使用'}); const now=new Date().toISOString(),amount=Number(voucher.credits); database.run('BEGIN'); try{database.run('UPDATE recharge_codes SET redeemed_by = ?, redeemed_at = ? WHERE id = ? AND redeemed_by IS NULL',[String(user.id),now,String(voucher.id)]); database.run('UPDATE users SET credits = credits + ? WHERE id = ?',[amount,String(user.id)]); database.run('INSERT INTO credit_transactions (id,user_id,amount,type,reference_id,created_at) VALUES (?,?,?,?,?,?)',[randomUUID(),String(user.id),amount,'recharge',String(voucher.id),now]); database.run('COMMIT')}catch(error){database.run('ROLLBACK');throw error} persist(); const updated=getOne('SELECT credits,reserved_credits AS reservedCredits FROM users WHERE id = ?',[String(user.id)]); return {ok:true,added:amount,credits:Number(updated?.credits??0),reservedCredits:Number(updated?.reservedCredits??0)} })
app.post('/admin/recharge-codes', async (request,reply) => { const user=currentUser(request),expected=String(process.env.CREDIT_ADMIN_KEY||''),actual=String(request.headers['x-admin-key']||''),authorized=Boolean(user?.isAdmin)||(Boolean(expected&&actual)&&secureTextEqual(actual,expected)); if(!authorized)return reply.code(403).send({error:'仅管理员可以生成充值码'}); const body=request.body as {credits?:number;count?:number},credits=Math.floor(Number(body.credits)),count=Math.min(100,Math.max(1,Math.floor(Number(body.count||1)))); if(!Number.isFinite(credits)||credits<1||credits>100000)return reply.code(400).send({error:'点数需要在 1 到 100000 之间'}); const now=new Date().toISOString(),codes:string[]=[]; for(let index=0;index<count;index++){const code=`VIO-${credits}-${randomBytes(5).toString('hex').toUpperCase()}`;database.run('INSERT INTO recharge_codes (id,code_hash,credits,created_at) VALUES (?,?,?,?)',[randomUUID(),hashRechargeCode(code),credits,now]);codes.push(code)} persist(); return {credits,count,codes} })
app.get('/showcase', async () => getAll(`SELECT assets.id, assets.name, assets.mime_type AS mimeType, assets.created_at AS createdAt, users.name AS author
  FROM assets JOIN users ON users.id = assets.user_id WHERE assets.is_public = 1 ORDER BY assets.created_at DESC LIMIT 30`, []).map(asset => ({ ...asset, url: namedAssetUrl(String(asset.id), String(asset.name), true), thumbnailUrl: assetThumbnailUrl(String(asset.id), String(asset.mimeType), true) })))

app.get('/projects', async (request, reply) => { const user = requireUser(request, reply); if (!user) return; const userId = String(user.id); return getAll(`SELECT projects.id, projects.name, projects.created_at AS createdAt, projects.updated_at AS updatedAt, COALESCE(projects.last_opened_at, projects.updated_at) AS lastOpenedAt,
  (SELECT count(*) FROM assets WHERE assets.project_id = projects.id AND assets.user_id = projects.user_id) AS assetCount,
  (SELECT id FROM assets WHERE assets.project_id = projects.id AND assets.user_id = projects.user_id AND assets.mime_type LIKE 'image/%' ORDER BY assets.created_at DESC LIMIT 1) AS previewAssetId
  FROM projects WHERE projects.user_id = ? ORDER BY COALESCE(projects.last_opened_at, projects.updated_at) DESC`, [userId]).map(project => { const canvas = getOne('SELECT document FROM project_canvases WHERE project_id = ?', [String(project.id)]); let nodeCount = 0; try { nodeCount = JSON.parse(String(canvas?.document ?? '{}')).nodes?.length ?? 0 } catch { /* malformed legacy canvas */ } return { ...project, nodeCount, previewUrl: project.previewAssetId ? `/api/assets/${project.previewAssetId}/thumbnail` : null } }) })
app.post('/projects', async (request, reply) => { const user = requireUser(request, reply); if (!user) return; const body = request.body as { name?: string }, id = randomUUID(), now = new Date().toISOString(); database.run('INSERT INTO projects (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [id, String(user.id), body.name?.trim() || '未命名项目', now, now]); database.run('INSERT INTO project_canvases (project_id, document, updated_at) VALUES (?, ?, ?)', [id, emptyCanvas(), now]); persist(); return reply.code(201).send({ id, name: body.name?.trim() || '未命名项目', createdAt: now, updatedAt: now }) })
app.patch('/projects/:projectId', async (request, reply) => { const user = requireUser(request, reply); if (!user) return; const userId = String(user.id), { projectId } = request.params as { projectId: string }, name = String((request.body as { name?: string }).name ?? '').trim(); if (!ownsProject(projectId, userId)) return reply.code(404).send({ error: 'Project not found' }); if (!name || name.length > 60) return reply.code(400).send({ error: '项目名称需要在 1 到 60 个字符之间' }); const now = new Date().toISOString(); database.run('UPDATE projects SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?', [name, now, projectId, userId]); persist(); return { id: projectId, name, updatedAt: now } })
app.post('/projects/:projectId/duplicate', async (request, reply) => { const user = requireUser(request, reply); if (!user) return; const userId = String(user.id), { projectId } = request.params as { projectId: string }, source = getOne('SELECT name FROM projects WHERE id = ? AND user_id = ?', [projectId, userId]); if (!source) return reply.code(404).send({ error: 'Project not found' }); const id = randomUUID(), now = new Date().toISOString(), name = `${String(source.name)} 副本`, canvas = getOne('SELECT document FROM project_canvases WHERE project_id = ?', [projectId]); database.run('INSERT INTO projects (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [id, userId, name, now, now]); database.run('INSERT INTO project_canvases (project_id, document, updated_at) VALUES (?, ?, ?)', [id, String(canvas?.document ?? emptyCanvas()), now]); for (const asset of getAll('SELECT name, mime_type, size, storage_name, is_public FROM assets WHERE project_id = ? AND user_id = ?', [projectId, userId])) { const assetId = randomUUID(), storageName = `${assetId}.bin`; copyFileSync(`${uploadDirectory}/${asset.storage_name}`, `${uploadDirectory}/${storageName}`); database.run('INSERT INTO assets (id, project_id, user_id, name, mime_type, size, storage_name, is_public, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [assetId, id, userId, asset.name, asset.mime_type, asset.size, storageName, 0, now]) } persist(); return reply.code(201).send({ id, name, createdAt: now, updatedAt: now }) })
app.delete('/projects/:projectId', async (request, reply) => { const user = requireUser(request, reply); if (!user) return; const userId = String(user.id), { projectId } = request.params as { projectId: string }; if (!ownsProject(projectId, userId)) return reply.code(404).send({ error: 'Project not found' }); const projectCount = Number(getOne('SELECT count(*) AS count FROM projects WHERE user_id = ?', [userId])?.count ?? 0); if (projectCount <= 1) return reply.code(409).send({ error: '至少需要保留一个项目' }); const files = getAll('SELECT storage_name FROM assets WHERE project_id = ? AND user_id = ?', [projectId, userId]); for (const file of files) { const path = `${uploadDirectory}/${file.storage_name}`; if (existsSync(path)) unlinkSync(path) } database.run('DELETE FROM assets WHERE project_id = ? AND user_id = ?', [projectId, userId]); database.run('DELETE FROM project_canvases WHERE project_id = ?', [projectId]); database.run('DELETE FROM jobs WHERE project_id = ? AND user_id = ?', [projectId, userId]); database.run('DELETE FROM projects WHERE id = ? AND user_id = ?', [projectId, userId]); persist(); return reply.code(204).send() })

app.get('/projects/:projectId/canvas', async (request, reply) => { const user = requireUser(request, reply); if (!user) return; const { projectId } = request.params as { projectId: string }; if (!ownsProject(projectId, String(user.id))) return reply.code(404).send({ error: 'Project not found' }); const row = getOne('SELECT document, updated_at FROM project_canvases WHERE project_id = ?', [projectId]); if (!row) return reply.code(404).send({ error: 'Canvas not found' }); database.run('UPDATE projects SET last_opened_at = ? WHERE id = ?', [new Date().toISOString(), projectId]); persist(); return { projectId, ...JSON.parse(String(row.document)), updatedAt: row.updated_at } })
app.put('/projects/:projectId/canvas', async (request, reply) => { const user = requireUser(request, reply); if (!user) return; const { projectId } = request.params as { projectId: string }; if (!ownsProject(projectId, String(user.id))) return reply.code(404).send({ error: 'Project not found' }); const body = request.body as CanvasPayload, now = new Date().toISOString(); database.run('INSERT INTO project_canvases (project_id, document, updated_at) VALUES (?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET document=excluded.document, updated_at=excluded.updated_at', [projectId, JSON.stringify({ nodes: body.nodes, links: body.links, camera: body.camera }), now]); database.run('UPDATE projects SET updated_at = ? WHERE id = ?', [now, projectId]); persist(); return { projectId, updatedAt: now } })

app.get('/projects/:projectId/assets', async (request, reply) => { const user = requireUser(request, reply); if (!user) return; const userId = String(user.id), { projectId } = request.params as { projectId: string }; if (!ownsProject(projectId, userId)) return reply.code(404).send({ error: 'Project not found' }); return getAll('SELECT id, name, mime_type AS mimeType, size, is_public AS isPublic, created_at AS createdAt FROM assets WHERE project_id = ? AND user_id = ? ORDER BY created_at DESC', [projectId, userId]).map(asset => ({ ...asset, isPublic: Boolean(asset.isPublic), url: namedAssetUrl(String(asset.id), String(asset.name)), thumbnailUrl: assetThumbnailUrl(String(asset.id), String(asset.mimeType)) })) })
app.get('/assets', async (request, reply) => { const user = requireUser(request, reply); if (!user) return; const userId = String(user.id); return getAll(`SELECT assets.id, assets.project_id AS projectId, projects.name AS projectName, assets.name, assets.mime_type AS mimeType, assets.size, assets.is_public AS isPublic, assets.created_at AS createdAt FROM assets JOIN projects ON projects.id = assets.project_id WHERE assets.user_id = ? ORDER BY assets.created_at DESC`, [userId]).map(asset => ({ ...asset, isPublic: Boolean(asset.isPublic), url: namedAssetUrl(String(asset.id), String(asset.name)), thumbnailUrl: assetThumbnailUrl(String(asset.id), String(asset.mimeType)) })) })
app.post('/projects/:projectId/assets', async (request, reply) => { const user = requireUser(request, reply); if (!user) return; const userId = String(user.id), { projectId } = request.params as { projectId: string }; if (!ownsProject(projectId, userId)) return reply.code(404).send({ error: 'Project not found' }); const body = request.body as { files?: Array<{ name: string; mimeType: string; data: string }> }, uploaded = []; for (const file of body.files ?? []) { const bytes = Buffer.from(file.data, 'base64'); if (bytes.length > 100 * 1024 * 1024) return reply.code(413).send({ error: 'Asset exceeds 100MB' }); const id = randomUUID(), storageName = `${id}.bin`, now = new Date().toISOString(); writeFileSync(`${uploadDirectory}/${storageName}`, bytes); database.run('INSERT INTO assets (id, project_id, user_id, name, mime_type, size, storage_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [id, projectId, userId, file.name, file.mimeType, bytes.length, storageName, now]); uploaded.push({ id, name: file.name, mimeType: file.mimeType, size: bytes.length, createdAt: now, url: namedAssetUrl(id, file.name) }) } persist(); return reply.code(201).send(uploaded) })
app.get('/assets/:assetId/content', async (request, reply) => { const user = requireUser(request, reply); if (!user) return; const { assetId } = request.params as { assetId: string }; const asset = getOne('SELECT name FROM assets WHERE id = ? AND user_id = ?', [assetId, String(user.id)]); if (!asset) return reply.code(404).send({ error: 'Asset not found' }); return reply.code(302).header('location', namedAssetUrl(assetId, String(asset.name))).send() })
app.get('/assets/:assetId/content/:filename', async (request, reply) => { const user = requireUser(request, reply); if (!user) return; const { assetId } = request.params as { assetId: string }; const asset = getOne('SELECT name, mime_type, storage_name FROM assets WHERE id = ? AND user_id = ?', [assetId, String(user.id)]); if (!asset) return reply.code(404).send({ error: 'Asset not found' }); reply.type(String(asset.mime_type)).header('content-disposition', assetDisposition(String(asset.name))).header('cache-control', 'private, max-age=3600'); return reply.send(readFileSync(`${uploadDirectory}/${asset.storage_name}`)) })
app.get('/assets/:assetId/thumbnail', async (request, reply) => { const user = requireUser(request, reply); if (!user) return; const { assetId } = request.params as { assetId: string }; const asset = getOne('SELECT mime_type, storage_name FROM assets WHERE id = ? AND user_id = ?', [assetId, String(user.id)]); if (!asset) return reply.code(404).send({ error: 'Asset not found' }); return sendAssetThumbnail(reply, assetId, asset) })
app.get('/public/assets/:assetId/content', async (request, reply) => { const { assetId } = request.params as { assetId: string }; const asset = getOne('SELECT name FROM assets WHERE id = ? AND is_public = 1', [assetId]); if (!asset) return reply.code(404).send({ error: 'Asset not found' }); return reply.code(302).header('location', namedAssetUrl(assetId, String(asset.name), true)).send() })
app.get('/public/assets/:assetId/content/:filename', async (request, reply) => { const { assetId } = request.params as { assetId: string }; const asset = getOne('SELECT name, mime_type, storage_name FROM assets WHERE id = ? AND is_public = 1', [assetId]); if (!asset) return reply.code(404).send({ error: 'Asset not found' }); reply.type(String(asset.mime_type)).header('content-disposition', assetDisposition(String(asset.name))).header('cache-control', 'public, max-age=3600'); return reply.send(readFileSync(`${uploadDirectory}/${asset.storage_name}`)) })
app.get('/public/assets/:assetId/thumbnail', async (request, reply) => { const { assetId } = request.params as { assetId: string }; const asset = getOne('SELECT mime_type, storage_name FROM assets WHERE id = ? AND is_public = 1', [assetId]); if (!asset) return reply.code(404).send({ error: 'Asset not found' }); return sendAssetThumbnail(reply, assetId, asset, true) })
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
  let model = input.model ?? (input.kind === 'video' ? process.env.AGNES_VIDEO_DEFAULT_MODEL || 'agnes-video-v2.0' : process.env.OPENAI_IMAGE_DEFAULT_MODEL || 'gpt-image-2')
  if (model === 'gemini-3.1-flash-image') return reply.code(503).send({ error:'Gemini 图片模型仍处于实验性适配阶段，暂未开放生成' })
  const creditCost = model === 'grok-imagine-video-1.5-preview' ? 2 : model === 'grok-imagine-image' ? 1 : 0
  if (creditCost && Number(user.credits ?? 0) - Number(user.reservedCredits ?? 0) < creditCost) return reply.code(402).send({ error:`创作点数不足，当前模型每次生成需要 ${creditCost} 点` })
  const customId = model.startsWith('custom:') ? model.slice(7) : '', custom = customId ? getOne('SELECT * FROM user_api_models WHERE id = ? AND user_id = ?', [customId,userId]) : undefined
  if (customId && (!custom || String(custom.kind) !== input.kind)) return reply.code(400).send({ error:'自定义模型不存在或类型不匹配' })
  if (custom) model = String(custom.model)
  const inputUrls = input.inputUrls ?? []
  try { validateOwnedInputUrls(inputUrls, userId, input.kind) }
  catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : '无法读取输入素材' }) }
  const id = randomUUID(), now = new Date().toISOString()
  if (creditCost) database.run('UPDATE users SET reserved_credits = reserved_credits + ? WHERE id = ?', [creditCost,userId])
  database.run('INSERT INTO jobs (id, project_id, user_id, node_id, kind, prompt, model, status, progress, input_urls, parameters, custom_model_id, credit_cost, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, projectId, userId, input.nodeId, input.kind, input.prompt, model, 'queued', 0, JSON.stringify(inputUrls), JSON.stringify(input.parameters ?? {}), customId || null, creditCost, now, now])
  persist()
  queueMicrotask(pumpGenerationQueue)
  return reply.code(202).send({ id, status: 'queued', progress: 0, model, provider: generationProvider.name, creditCost, creditsAvailable:Number(user.credits ?? 0) - Number(user.reservedCredits ?? 0) - creditCost })
})

app.get('/jobs/:id', async (request, reply) => {
  const user = requireUser(request, reply); if (!user) return
  const { id } = request.params as { id: string }
  const row = getOne('SELECT * FROM jobs WHERE id = ? AND user_id = ?', [id, String(user.id)])
  return row ?? reply.code(404).send({ error: 'Job not found' })
})

function parsePromptAgentResult(raw: string): Record<string, unknown> {
  if (!raw) throw new SyntaxError('Agent returned an empty response')
  try { return JSON.parse(raw) as Record<string, unknown> }
  catch {
    const start = raw.indexOf('{'), end = raw.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>
    throw new SyntaxError('Agent returned truncated JSON')
  }
}

function compactImagePrompt(value: string, limit = 140) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= limit) return normalized
  const sentences = normalized.match(/[^。！？；.!?;]+[。！？；.!?;]?/g) ?? [normalized]
  let compact = ''
  for (const sentence of sentences) {
    const next = `${compact}${sentence.trim()}`
    if (next.length > limit) break
    compact = next
  }
  return (compact || normalized.slice(0, limit)).replace(/[，、：:\s]+$/, '')
}

function getOne(sql: string, values: Array<string | number>) {
  const statement = database.prepare(sql); statement.bind(values)
  const row = statement.step() ? statement.getAsObject() : undefined
  statement.free(); return row
}
function getAll(sql: string, values: Array<string | number>) { const statement = database.prepare(sql); statement.bind(values); const rows = []; while (statement.step()) rows.push(statement.getAsObject()); statement.free(); return rows }
function ownsProject(projectId: string, userId: string) { return Boolean(getOne('SELECT id FROM projects WHERE id = ? AND user_id = ?', [projectId, userId])) }
function ensureColumn(table: string, column: string, definition: string) { const columns = getAll(`PRAGMA table_info(${table})`, []); if (!columns.some(item => item.name === column)) database.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`) }
function normalizeEmail(value: unknown) { return String(value ?? '').trim().toLowerCase() }
function newInviteCode() { let code = ''; do code = `VIO-${randomBytes(4).toString('hex').toUpperCase()}`; while (getOne('SELECT id FROM users WHERE invite_code = ?', [code])); return code }
function availableUsername(preferred: string) { const base = preferred.trim() || 'user'; let username = base, suffix = 1; while (getOne('SELECT id FROM users WHERE lower(username) = ?', [username.toLowerCase()])) username = `${base}${suffix++}`; return username }
function normalizeHttpUrl(value: unknown) { try { const url = new URL(String(value ?? '').trim()); return ['http:','https:'].includes(url.protocol) ? url.toString().replace(/\/$/,'') : '' } catch { return '' } }
function validEmail(email: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 }
function assetDisposition(name: string) { const safe = name.replace(/[\r\n]/g, '').slice(0, 240) || 'asset'; return `inline; filename="asset"; filename*=UTF-8''${encodeURIComponent(safe)}` }
function namedAssetUrl(id: string, name: string, isPublic = false) { const safe = name.replace(/[\r\n/\\]/g, '').slice(0, 240) || 'asset'; return `/api/${isPublic ? 'public/' : ''}assets/${id}/content/${encodeURIComponent(safe)}` }
function assetThumbnailUrl(id: string, mimeType: string, isPublic = false) { return mimeType.startsWith('image/') ? `/api/${isPublic ? 'public/' : ''}assets/${id}/thumbnail` : undefined }
async function sendAssetThumbnail(reply: FastifyReply, assetId: string, asset: Record<string, unknown>, isPublic = false) {
  const mimeType = String(asset.mime_type ?? '')
  if (!mimeType.startsWith('image/')) return reply.code(415).send({ error: 'Asset is not an image' })
  const thumbnailPath = `${thumbnailDirectory}/${assetId}.webp`
  if (!existsSync(thumbnailPath)) await sharp(`${uploadDirectory}/${String(asset.storage_name)}`).rotate().resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true }).webp({ quality: 72, effort: 3 }).toFile(thumbnailPath)
  reply.type('image/webp').header('cache-control', `${isPublic ? 'public' : 'private'}, max-age=86400, immutable`)
  return reply.send(readFileSync(thumbnailPath))
}
function validateOwnedInputUrls(urls: string[], userId: string, kind: JobInput['kind']) { for (const source of urls) { const match = source.match(/^\/api\/assets\/([^/]+)\/content(?:\/|$)/); if (!match) continue; const asset = getOne('SELECT size FROM assets WHERE id = ? AND user_id = ?', [decodeURIComponent(match[1]), userId]); if (!asset) throw new Error('输入素材不存在或不属于当前用户'); if (kind === 'video' && Number(asset.size ?? 0) > 15 * 1024 * 1024) throw new Error('参考图片超过 15MB') } }
function resolveOwnedInputUrls(urls: string[], userId: string, kind: JobInput['kind'], _model: string) { return urls.map(source => { const match = source.match(/^\/api\/assets\/([^/]+)\/content(?:\/|$)/); if (!match) return source; const assetId = decodeURIComponent(match[1]), asset = getOne('SELECT mime_type, size, storage_name FROM assets WHERE id = ? AND user_id = ?', [assetId, userId]); if (!asset) throw new Error('输入素材不存在或不属于当前用户'); const size = Number(asset.size ?? 0); if (kind === 'video' && size > 15 * 1024 * 1024) throw new Error('参考图片超过 15MB'); const bytes = readFileSync(`${uploadDirectory}/${asset.storage_name}`); if (!bytes.length) throw new Error('输入素材为空'); return `data:${String(asset.mime_type || 'application/octet-stream')};base64,${bytes.toString('base64')}` }) }
function signedGenerationInputUrl(assetId: string) { const expires = Math.floor(Date.now() / 1000) + 1800, signature = createHmac('sha256', generationInputSigningSecret).update(`${assetId}:${expires}`).digest('base64url'); return `${generationPublicBaseUrl}/api/generation-inputs/${encodeURIComponent(assetId)}?expires=${expires}&signature=${signature}` }
function validGenerationInputSignature(assetId: string, expires: number, signature: string) { const expected = createHmac('sha256', generationInputSigningSecret).update(`${assetId}:${expires}`).digest('base64url'); return secureTextEqual(signature, expected) }
function hashPassword(password: string) { const salt = randomBytes(16).toString('hex'), digest = scryptSync(password, salt, 64).toString('hex'); return `scrypt:${salt}:${digest}` }
function verifyPassword(password: string, stored: string) { const [, salt, expected] = stored.split(':'); if (!salt || !expected) return false; try { const actual = scryptSync(password, salt, 64), expectedBytes = Buffer.from(expected, 'hex'); return actual.length === expectedBytes.length && timingSafeEqual(actual, expectedBytes) } catch { return false } }
function secureTextEqual(actual: string, expected: string) { const left = createHash('sha256').update(actual).digest(), right = createHash('sha256').update(expected).digest(); return timingSafeEqual(left, right) }
function normalizeRechargeCode(value:unknown){return String(value??'').trim().toUpperCase().replace(/\s+/g,'')}
function hashRechargeCode(code:string){return createHash('sha256').update(code).digest('hex')}
function sessionId(token: string) { return createHash('sha256').update(token).digest('hex') }
function sessionToken(request: FastifyRequest) { const cookie = String(request.headers.cookie ?? '').split(';').map(part => part.trim()).find(part => part.startsWith('flow_session=')); return cookie ? decodeURIComponent(cookie.slice('flow_session='.length)) : '' }
function createSession(userId: string, createdAt = new Date().toISOString()) { const token = randomBytes(32).toString('base64url'), expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); database.run('DELETE FROM sessions WHERE expires_at <= ?', [createdAt]); database.run('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', [sessionId(token), userId, createdAt, expiresAt]); return token }
function currentUser(request: FastifyRequest) { const token = sessionToken(request); if (!token) return undefined; return getOne(`SELECT users.id, users.name, users.username, users.email, users.invite_code AS inviteCode, users.created_at AS createdAt, users.credits, users.reserved_credits AS reservedCredits, users.is_admin AS isAdmin FROM sessions JOIN users ON users.id = sessions.user_id
  WHERE sessions.id = ? AND sessions.expires_at > ?`, [sessionId(token), new Date().toISOString()]) }
function requireUser(request: FastifyRequest, reply: FastifyReply) { const user = currentUser(request); if (!user) { void reply.code(401).send({ error: 'Unauthorized' }); return undefined } return user }
function secureRequest(request: FastifyRequest) { const proto = request.headers['x-forwarded-proto']; return (Array.isArray(proto) ? proto[0] : proto) === 'https' }
function setSessionCookie(request: FastifyRequest, reply: FastifyReply, token: string) { reply.header('set-cookie', `flow_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}${secureRequest(request) ? '; Secure' : ''}`) }
function clearSessionCookie(request: FastifyRequest, reply: FastifyReply) { reply.header('set-cookie', `flow_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureRequest(request) ? '; Secure' : ''}`) }
function emptyCanvas() { return JSON.stringify({ nodes: [], links: [], camera: { x: 0, y: 0, zoom: 1 } }) }
function createDefaultProject(userId: string, now = new Date().toISOString()) { const id = randomUUID(); database.run('INSERT INTO projects (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [id, userId, '未命名项目', now, now]); database.run('INSERT INTO project_canvases (project_id, document, updated_at) VALUES (?, ?, ?)', [id, emptyCanvas(), now]); return id }

function persist() { writeFileSync(databasePath, Buffer.from(database.export())) }

const configuredImageConcurrency = Number(process.env.IMAGE_GENERATION_CONCURRENCY || 3)
const configuredVideoConcurrency = Number(process.env.VIDEO_GENERATION_CONCURRENCY || 2)
const generationConcurrency: Record<JobInput['kind'], number> = {
  image: Number.isFinite(configuredImageConcurrency) ? Math.max(1, Math.floor(configuredImageConcurrency)) : 3,
  video: Number.isFinite(configuredVideoConcurrency) ? Math.max(1, Math.floor(configuredVideoConcurrency)) : 2,
}
const activeGenerationJobs: Record<JobInput['kind'], Set<string>> = { image:new Set(), video:new Set() }
let queuePumpRunning = false

function pumpGenerationQueue() {
  if (queuePumpRunning) return
  queuePumpRunning = true
  try {
    for (const kind of ['video','image'] as const) while (activeGenerationJobs[kind].size < generationConcurrency[kind]) {
      const job = nextQueuedGenerationJob(kind)
      if (!job) break
      const id = String(job.id)
      activeGenerationJobs[kind].add(id)
      database.run("UPDATE jobs SET status = 'running', progress = 0, updated_at = ? WHERE id = ? AND status = 'queued'", [new Date().toISOString(), id])
      persist()
      app.log.info({ jobId:id, kind, active:activeGenerationJobs[kind].size, concurrency:generationConcurrency[kind] }, 'generation queue started job')
      void executeQueuedJob(job).finally(() => { activeGenerationJobs[kind].delete(id); queueMicrotask(pumpGenerationQueue) })
    }
  } finally { queuePumpRunning = false }
}

function isImageEditJob(job: Record<string, unknown>) { return parseJsonArray(job.input_urls).length > 0 }
function activeImageEditCount() {
  let count = 0
  for (const id of activeGenerationJobs.image) {
    const job = getOne('SELECT input_urls FROM jobs WHERE id = ?', [id])
    if (job && isImageEditJob(job)) count++
  }
  return count
}
function nextQueuedGenerationJob(kind: JobInput['kind']) {
  if (kind !== 'image') return getOne("SELECT * FROM jobs WHERE status = 'queued' AND kind = ? ORDER BY created_at ASC, rowid ASC LIMIT 1", [kind])
  const editSlotAvailable = activeImageEditCount() < 1
  return getAll("SELECT * FROM jobs WHERE status = 'queued' AND kind = 'image' ORDER BY created_at ASC, rowid ASC", [])
    .find(job => !isImageEditJob(job) || editSlotAvailable)
}

async function executeQueuedJob(job: Record<string, unknown>) {
  const id = String(job.id), kind = String(job.kind) as JobInput['kind'], userId = String(job.user_id), model = String(job.model)
  try {
    const customId = String(job.custom_model_id || ''), custom = customId ? getOne('SELECT * FROM user_api_models WHERE id = ? AND user_id = ?', [customId, userId]) : undefined
    if (customId && (!custom || String(custom.kind) !== kind)) throw new Error('自定义模型已被删除或类型不匹配')
    const provider = custom ? (kind === 'image' ? new OpenAiImageProvider({ baseUrl:String(custom.base_url), apiKey:String(custom.api_key) }) : new OpenAiVideoProvider({ baseUrl:String(custom.base_url), apiKey:String(custom.api_key) })) : generationProvider
    const rawInputUrls = parseJsonArray(job.input_urls), inputUrls = resolveOwnedInputUrls(rawInputUrls, userId, kind, model)
    const parameters = parseJsonObject(job.parameters)
    let updates = Promise.resolve(), lastError:unknown
    const attempts = kind === 'image' ? 3 : 1
    for (let attempt=1;attempt<=attempts;attempt++) {
      try {
        await provider.run({ internalJobId:id, projectId:String(job.project_id), nodeId:Number(job.node_id), kind, prompt:String(job.prompt), model, inputUrls, parameters }, update => { updates = updates.then(() => updateJob(id, update.status === 'queued' ? { ...update, status:'running' } : update)) })
        await updates
        return
      } catch (error) {
        lastError=error
        if (attempt>=attempts || !isTransientGenerationError(error)) throw error
        app.log.warn({ jobId:id, kind, attempt, error:error instanceof Error?error.message:String(error) }, 'transient generation failure, retrying')
        await updateJob(id,{ status:'running', progress:Math.max(5,Math.min(20,attempt*8)), error:undefined })
        await new Promise(resolve=>setTimeout(resolve,attempt*2500))
      }
    }
    throw lastError
  } catch (error) {
    await updateJob(id, { status:'failed', progress:0, error:error instanceof Error ? error.message : 'Generation failed' })
  }
}

function isTransientGenerationError(error:unknown) {
  const message=error instanceof Error?error.message:String(error)
  if (/auth_unavailable|no auth available|unexpected EOF|ETIMEDOUT|timeout|timed out|aborted due to timeout|backend-api\/codex\/images/i.test(message)) return false
  return /ECONNRESET|ECONNREFUSED|fetch failed|socket|network|temporar|502|503|504/i.test(message)
}

function parseJsonArray(value: unknown) { try { const parsed = JSON.parse(String(value || '[]')); return Array.isArray(parsed) ? parsed.map(String) : [] } catch { return [] } }
function parseJsonObject(value: unknown) { try { const parsed = JSON.parse(String(value || '{}')); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {} } catch { return {} } }

async function updateJob(id: string, update: GenerationUpdate) {
  let resultUrl = update.resultUrl
  let succeeded = update.status === 'succeeded'
  try {
    if (update.status === 'succeeded' && resultUrl) resultUrl = await archiveJobResult(id, resultUrl)
    database.run('UPDATE jobs SET status = ?, progress = ?, result_url = COALESCE(?, result_url), error = ?, updated_at = ? WHERE id = ?', [update.status, update.progress, resultUrl ?? null, update.error ?? null, new Date().toISOString(), id])
  } catch (error) {
    succeeded = false
    database.run('UPDATE jobs SET status = ?, progress = ?, error = ?, updated_at = ? WHERE id = ?', ['failed', 0, `结果保存到资产库失败：${error instanceof Error ? error.message : 'unknown error'}`, new Date().toISOString(), id])
  }
  if (update.status === 'succeeded' || update.status === 'failed') settleJobCredits(id, succeeded)
  persist()
}

function settleJobCredits(jobId:string, succeeded:boolean) { const job = getOne('SELECT user_id, credit_cost, credit_settled FROM jobs WHERE id = ?', [jobId]), cost = Number(job?.credit_cost ?? 0); if (!job || !cost || Boolean(job.credit_settled)) return; database.run('UPDATE users SET reserved_credits = MAX(0,reserved_credits - ?), credits = MAX(0,credits - ?) WHERE id = ?', [cost,succeeded ? cost : 0,String(job.user_id)]); database.run('UPDATE jobs SET credit_settled = 1 WHERE id = ?', [jobId]) }

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
pumpGenerationQueue()
