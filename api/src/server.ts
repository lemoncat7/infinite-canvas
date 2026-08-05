import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import initSqlJs, { type Database } from 'sql.js'
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { createGenerationProvider, type GenerationUpdate } from './providers/index.js'
import { OpenAiImageProvider } from './providers/openai-image.js'
import { OpenAiVideoProvider } from './providers/openai-video.js'
import { SdCppImageProvider } from './providers/sdcpp-image.js'
import { ProxyAgent, fetch as undiciFetch } from 'undici'
import sharp from 'sharp'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

type CanvasPayload = { nodes: unknown[]; links: unknown[]; camera?: unknown }
type JobInput = { projectId?: string; nodeId: number; kind: 'image' | 'video'; prompt: string; promptProfile?:'character'|'prop'|'scene'|'storyboard'|'manual'; model?: string; inputUrls?: string[]; parameters?: Record<string, unknown> }

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
  CREATE TABLE IF NOT EXISTS feedback (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, project_id TEXT, type TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, contact TEXT, page_url TEXT, user_agent TEXT, status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'update', created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS notification_reads (notification_id TEXT NOT NULL, user_id TEXT NOT NULL, read_at TEXT NOT NULL, PRIMARY KEY (notification_id,user_id));
  CREATE TABLE IF NOT EXISTS notification_popups (notification_id TEXT NOT NULL, user_id TEXT NOT NULL, local_date TEXT NOT NULL, shown_at TEXT NOT NULL, PRIMARY KEY (notification_id,user_id,local_date));
  CREATE TABLE IF NOT EXISTS comic_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, project_id TEXT NOT NULL, phase TEXT NOT NULL DEFAULT 'discussing', brief TEXT NOT NULL DEFAULT '{}', messages TEXT NOT NULL DEFAULT '[]', pending_revision TEXT NOT NULL DEFAULT '', plan TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
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
ensureColumn('users', 'api_token_hash', 'TEXT')
ensureColumn('users', 'api_token_hint', 'TEXT')
ensureColumn('jobs', 'credit_cost', 'INTEGER NOT NULL DEFAULT 0')
ensureColumn('jobs', 'credit_settled', 'INTEGER NOT NULL DEFAULT 0')
ensureColumn('notifications', 'priority', "TEXT NOT NULL DEFAULT 'normal'")
ensureColumn('notifications', 'auto_popup', 'INTEGER NOT NULL DEFAULT 0')
ensureColumn('sessions', 'last_activity_at', 'TEXT')
database.run('UPDATE sessions SET last_activity_at = COALESCE(last_activity_at, created_at)')
if (!getOne('SELECT id FROM app_migrations WHERE id = ?', ['reset-initial-credits-to-5'])) {
  const now = new Date().toISOString()
  database.run('UPDATE users SET credits = 5, reserved_credits = 0')
  database.run('INSERT INTO app_migrations (id,applied_at) VALUES (?,?)', ['reset-initial-credits-to-5',now])
}
if(!getOne('SELECT id FROM notifications WHERE id = ?',['comic-fixes-2026-08-03']))database.run('INSERT INTO notifications (id,title,content,type,created_at) VALUES (?,?,?,?,?)',['comic-fixes-2026-08-03','漫剧创作体验已更新','已增加更细致的制作分镜与连续性检查，单镜头调整为 3–8 秒；修复流式连接中断、自动重试、铺到画布批量创建，以及分镜时长和画幅同步问题。','fix','2026-08-03T02:30:00.000Z'])
database.run("UPDATE notifications SET priority='important',auto_popup=1 WHERE id=?",['comic-fixes-2026-08-03'])
if(!getOne('SELECT id FROM notifications WHERE id = ?',['comic-label-save-2026-08-03']))database.run('INSERT INTO notifications (id,title,content,type,created_at) VALUES (?,?,?,?,?)',['comic-label-save-2026-08-03','漫剧灵感，随时留在画布','灵感漫剧创作现已支持一键保存为标签。完成剧情构思后，可将人物设定、剧情大纲与制作分镜完整收进画布，方便随时查看、整理和继续创作。','update','2026-08-03T10:00:00.000Z'])
if(!getOne('SELECT id FROM notifications WHERE id = ?',['comic-continuity-workflow-2026-08-05']))database.run('INSERT INTO notifications (id,title,content,type,created_at) VALUES (?,?,?,?,?)',['comic-continuity-workflow-2026-08-05','漫剧工作流连续性全面升级','人物现以 Base 基准图派生换装、受伤与变身等独立形态，分镜会连接剧情当下的正确形态；同场景相邻镜头自动承接上一镜头末帧，保持站位、动作、服饰、道具与光线连续。对白和旁白现会完整进入视频节点并指导口型与表演。画布同时新增项目任务监控、图片上传与资产复用，以及保留配置和提示词的清除重做能力。','update','2026-08-05T02:00:00.000Z'])
if(!getOne('SELECT id FROM notifications WHERE id = ?',['project-task-queue-2026-08-05']))database.run('INSERT INTO notifications (id,title,content,type,created_at) VALUES (?,?,?,?,?)',['project-task-queue-2026-08-05','项目任务队列现在清晰可控','画布顶栏新增项目任务入口，可实时查看生成中、排队中、等待上游和失败任务，并点击快速定位对应节点。任务列表已优化为稳定更新，滚动和点击不再随进度刷新漂移；现在还可一键取消全部排队与等待上游任务，同时保留已经生成中的任务继续执行，并自动释放相关预留点数。','update','2026-08-05T02:30:00.000Z'])
if(!getOne('SELECT id FROM notifications WHERE id = ?',['comic-reference-voice-2026-08-05']))database.run('INSERT INTO notifications (id,title,content,type,created_at) VALUES (?,?,?,?,?)',['comic-reference-voice-2026-08-05','分镜参考与中文对白全面优化','漫剧分镜现在会校验实际出镜角色，避免将配角 Base 复制成重复路人；单张分镜参考图限制为 4 张，同场景连续镜头优先沿用上一分镜，不再重复堆叠场景与旧道具。视频提示词同步加入稳定角色声线、自然中文普通话、准确口型、停顿、表情与旁白规则，让连续镜头的人物和声音更统一。','update','2026-08-04T19:20:00.000Z'])
database.run('UPDATE notifications SET created_at = ? WHERE id = ? AND created_at = ?',['2026-08-04T19:20:00.000Z','comic-reference-voice-2026-08-05','2026-08-05T15:00:00.000Z'])
for(const [id,corrected,legacy] of [
  ['comic-fixes-2026-08-03','2026-08-03T02:30:00.000Z','2026-08-03T10:30:00.000Z'],
  ['comic-label-save-2026-08-03','2026-08-03T10:00:00.000Z','2026-08-03T18:00:00.000Z'],
  ['comic-continuity-workflow-2026-08-05','2026-08-05T02:00:00.000Z','2026-08-05T10:00:00.000Z'],
  ['project-task-queue-2026-08-05','2026-08-05T02:30:00.000Z','2026-08-05T10:30:00.000Z'],
])database.run('UPDATE notifications SET created_at = ? WHERE id = ? AND created_at = ?',[corrected,id,legacy])
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
const localImageFallback = process.env.SDCPP_IMAGE_BASE_URL ? new SdCppImageProvider() : null
let localImageFallbackAvailable = false
async function probeLocalImageFallback(){localImageFallbackAvailable=localImageFallback ? await localImageFallback.available() : false}
void probeLocalImageFallback()
setInterval(()=>void probeLocalImageFallback(),15000).unref()
const notificationStreams = new Set<FastifyReply['raw']>()
const activeComicPlans = new Set<string>()
function sendNotificationSync(stream: FastifyReply['raw']) {
  if (!stream.destroyed) stream.write(`event: notifications\ndata: ${JSON.stringify({ updatedAt:new Date().toISOString(), serverVersion:bootTime })}\n\n`)
}
function broadcastNotificationSync(){for(const stream of notificationStreams)sendNotificationSync(stream)}
app.get('/health', async () => ({ ok: true, service: 'flow-studio-api', generationProvider: generationProvider.name }))
app.get('/generation/capabilities', async () => {
  const capabilities = generationProvider.capabilities ?? {
  image: { provider: generationProvider.name, defaultModel: process.env.OPENAI_IMAGE_DEFAULT_MODEL || 'gpt-image-2' },
  video: { provider: generationProvider.name, defaultModel: process.env.AGNES_VIDEO_DEFAULT_MODEL || 'agnes-video-v2.0', seconds: { min: 1, max: 18, default: 5 }, resolutions: ['480p', '720p', '1080p'], aspectRatios: ['1:1', '4:3', '16:9'] },
  }
  return { ...capabilities, image:{ ...capabilities.image, localFallback:{ model:'flux1-kontext-dev', available:localImageFallbackAvailable } } }
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
app.post('/agents/comic/chat',async(request,reply)=>{
  const user=requireUser(request,reply);if(!user)return
  const input=request.body as {projectId?:string;sessionId?:string;message?:string;context?:string[];plan?:unknown;model?:string},userId=String(user.id),projectId=String(input.projectId||''),requestedSessionId=String(input.sessionId||''),message=String(input.message||'').trim()
  if(!projectId||!ownsProject(projectId,userId))return reply.code(404).send({error:'当前项目不存在'})
  if(activeComicPlans.has(`${userId}:${projectId}`))return reply.code(409).send({error:'完整剧本正在生成，请完成后再继续对话'})
  if(message.length<1||message.length>3000)return reply.code(400).send({error:'每次对话需要 1–3000 个字符'})
  let session=requestedSessionId?getOne('SELECT id,phase,brief,messages,pending_revision AS pendingRevision,plan FROM comic_sessions WHERE id=? AND user_id=? AND project_id=?',[requestedSessionId,userId,projectId]):undefined
  if(requestedSessionId&&!session)return reply.code(404).send({error:'漫剧会话不存在或不属于当前项目'})
  const now=new Date().toISOString(),sessionId=session?String(session.id):randomUUID();if(!session){const initialPlan=input.plan&&typeof input.plan==='object'?JSON.stringify(input.plan):null;database.run('INSERT INTO comic_sessions (id,user_id,project_id,phase,brief,messages,pending_revision,plan,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',[sessionId,userId,projectId,initialPlan?'generated':'discussing','{}','[]','',initialPlan,now,now]);session={id:sessionId,phase:initialPlan?'generated':'discussing',brief:'{}',messages:'[]',pendingRevision:'',plan:initialPlan}}
  const baseUrl=String(process.env.PROMPT_AGENT_BASE_URL||process.env.OPENAI_IMAGE_BASE_URL||'').replace(/\/$/,''),apiKey=String(process.env.PROMPT_AGENT_API_KEY||process.env.OPENAI_IMAGE_API_KEY||''),model=String(input.model||process.env.PROMPT_AGENT_MODEL||'gpt-5.5')
  if(!baseUrl||!apiKey)return reply.code(503).send({error:'灵感 Agent 接口尚未配置'})
  let history:Array<{role:'user'|'assistant';content:string}>=[];try{const parsed=JSON.parse(String(session.messages||'[]'));if(Array.isArray(parsed))history=parsed.filter(item=>item&&['user','assistant'].includes(item.role)&&typeof item.content==='string').slice(-16)}catch{/* 从空历史继续 */}
  let brief:Record<string,unknown>={};try{const parsed=JSON.parse(String(session.brief||'{}'));if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))brief=parsed}catch{/* 由本轮重新整理 */}
  const hasPlan=Boolean(session.plan),context=(input.context??[]).map(String).filter(Boolean).slice(0,8),system=`你是 Viora 的漫剧创作导演，现在只与用户讨论、澄清和收敛需求，绝对不要生成完整剧本、人物设定、镜头表或分镜提示词。每轮自然回应，并且最多追问 1–2 个真正影响创作的问题；用户信息已经足够时，不必为了提问而提问。持续维护创作简报。${hasPlan?'已有正式方案，本轮只整理用户希望修改的内容，未确认前不得改写正式方案。':'尚未生成正式方案，帮助用户明确故事方向。'}只返回合法 JSON：{"reply":"给用户的简洁自然回复","ready":true,"brief":{"title":"不超过18字的作品暂定标题","premise":"核心创意与故事简介","genre":"类型与基调","audience":"受众","duration":"预计总时长，例如约60秒或约3分钟","aspectRatio":"画幅，默认16:9","visualStyle":"视觉风格","characters":"核心人物与关系","conflict":"核心冲突","ending":"结局方向","dialogue":"对白旁白偏好","constraints":["明确不要的作品内容"],"confirmed":["已确认要点"],"openQuestions":["最多两个待确认问题"]},"pendingRevision":"已有正式方案时，累计整理待应用的修改；没有正式方案时为空字符串"}。title 必须是简短作品名，premise 才是完整简介，禁止把整段简介放进 title。用户没有明确指定画幅时，aspectRatio 始终填写 16:9。故事梗概、人物和冲突已经足够判断制作规模后，必须按合理的镜头密度主动估算 duration；duration 仍为空时不得返回 ready=true。ready 表示信息已经足以让用户点击确认生成，不代表你可以自行生成。必须继承旧简报中未被本轮推翻的内容。“先讨论、暂不生成、确认后再生成”等只描述当前交互阶段，绝不能写进作品 constraints。`
  const userContent=[`当前简报：${JSON.stringify(brief)}`,hasPlan?`已有正式方案摘要：${String(session.plan).slice(0,6000)}`:'尚无正式方案',String(session.pendingRevision||'').trim()?`尚未应用的修改：${String(session.pendingRevision)}`:'',context.length?`当前参考素材：${context.join('\n')}`:'',`用户本轮消息：${message}`].filter(Boolean).join('\n\n')
  const streamedReply=(raw:string)=>{const marker=/"reply"\s*:\s*"/.exec(raw);if(!marker)return '';let output='';for(let index=(marker.index+marker[0].length);index<raw.length;index++){const char=raw[index];if(char==='"')break;if(char!=='\\'){output+=char;continue}const escaped=raw[++index];if(escaped===undefined)break;if(escaped==='u'){const code=raw.slice(index+1,index+5);if(!/^[0-9a-f]{4}$/i.test(code))break;output+=String.fromCharCode(Number.parseInt(code,16));index+=4}else output+=({n:'\n',r:'\r',t:'\t',b:'\b',f:'\f','"':'"','\\':'\\','/':'/'} as Record<string,string>)[escaped]??escaped}return output.slice(0,1200)}
  reply.hijack();reply.raw.writeHead(200,{'content-type':'application/x-ndjson; charset=utf-8','cache-control':'no-cache, no-transform','x-accel-buffering':'no','connection':'keep-alive'});const emit=(value:unknown)=>{if(!reply.raw.destroyed)reply.raw.write(`${JSON.stringify(value)}\n`)};emit({type:'start',sessionId,phase:hasPlan?'revising':'discussing'});const heartbeat=setInterval(()=>emit({type:'heartbeat',at:Date.now()}),8000)
  try{
    const proxyUrl=String(process.env.PROMPT_AGENT_HTTPS_PROXY||process.env.OPENAI_IMAGE_HTTPS_PROXY||''),candidateModels=[model,...(model==='gpt-5.4-mini'?[]:['gpt-5.4-mini'])];let parsed:{reply?:string;ready?:boolean;brief?:Record<string,unknown>;pendingRevision?:string}|undefined,lastError=''
    for(const [attempt,usedModel] of candidateModels.entries()){
      if(attempt)emit({type:'retry',message:'主模型响应较慢，正在切换备用线路…'});emit({type:'model',model:usedModel});const controller=new AbortController(),timeoutMs=attempt?45000:65000,timer=setTimeout(()=>controller.abort(new DOMException('漫剧对话响应超时','TimeoutError')),timeoutMs),options={method:'POST',headers:{authorization:`Bearer ${apiKey}`,'content-type':'application/json'},body:JSON.stringify({model:usedModel,stream:true,stream_options:{include_usage:false},temperature:.35,max_tokens:1800,response_format:{type:'json_object'},messages:[{role:'system',content:system},...history,{role:'user',content:userContent}]}),signal:controller.signal}
      try{const response=proxyUrl?await undiciFetch(`${baseUrl}/v1/chat/completions`,{...options,dispatcher:new ProxyAgent(proxyUrl)}):await fetch(`${baseUrl}/v1/chat/completions`,options);if(!response.ok)throw new Error(`upstream ${response.status}: ${(await response.text()).slice(0,180)}`);if(!response.body)throw new Error('漫剧对话没有响应流');const reader=(response.body as ReadableStream<Uint8Array>).getReader(),decoder=new TextDecoder();let buffer='',raw='',lastReply='';while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});const lines=buffer.split(/\r?\n/);buffer=lines.pop()||'';for(const line of lines){const data=line.startsWith('data:')?line.slice(5).trim():'';if(!data||data==='[DONE]')continue;const packet=JSON.parse(data) as {choices?:Array<{delta?:{content?:string}}>},delta=String(packet.choices?.[0]?.delta?.content||'');if(!delta)continue;raw+=delta;const nextReply=streamedReply(raw);if(nextReply!==lastReply){lastReply=nextReply;emit({type:'delta',text:nextReply})}}}const jsonText=raw.trim().startsWith('{')?raw.trim():raw.slice(raw.indexOf('{'),raw.lastIndexOf('}')+1);parsed=JSON.parse(jsonText) as typeof parsed;break}catch(error){lastError=error instanceof Error?error.message:String(error);request.log.warn({userId,projectId,sessionId,attempt:attempt+1,model:usedModel,message:lastError},'comic dialogue upstream retry');emit({type:'reset'})}finally{clearTimeout(timer)}
    }
    if(!parsed)throw new Error(lastError||'漫剧对话未返回有效内容')
    const assistantReply=String(parsed.reply||'我已经记下了。你可以继续补充，确认后我再生成完整方案。').slice(0,1200),nextBrief=parsed.brief&&typeof parsed.brief==='object'?parsed.brief:brief,pendingRevision=hasPlan?String(parsed.pendingRevision||session.pendingRevision||'').slice(0,5000):'';if(!String(nextBrief.aspectRatio||'').trim())nextBrief.aspectRatio='16:9';const ready=Boolean(parsed.ready&&String(nextBrief.duration||'').trim())
    history.push({role:'user',content:message},{role:'assistant',content:assistantReply});history=history.slice(-18);const phase=hasPlan?'revising':ready?'ready':'discussing';database.run('UPDATE comic_sessions SET phase=?,brief=?,messages=?,pending_revision=?,updated_at=? WHERE id=? AND user_id=? AND project_id=?',[phase,JSON.stringify(nextBrief),JSON.stringify(history),pendingRevision,new Date().toISOString(),sessionId,userId,projectId]);persist();emit({type:'result',sessionId,phase,reply:assistantReply,ready,brief:nextBrief,pendingRevision,hasPlan});clearInterval(heartbeat);reply.raw.end()
  }catch(error){clearInterval(heartbeat);request.log.error({userId,projectId,sessionId,message:error instanceof Error?error.message:String(error)},'comic dialogue failed');emit({type:'error',error:'漫剧对话暂时没有响应，请稍后重试'});reply.raw.end()}
})

app.post('/agents/comic', async (request, reply) => {
  const user = requireUser(request, reply); if (!user) return
  const input = request.body as { projectId?:string; sessionId?:string; idea?:string; duration?:string; aspectRatio?:string; context?:string[]; visuals?:string[]; previousPlan?:unknown; revision?:string; model?:string }
  const projectId=String(input.projectId||''),sessionId=String(input.sessionId||''),comicSession=sessionId?getOne('SELECT id,brief,pending_revision AS pendingRevision,plan FROM comic_sessions WHERE id=? AND user_id=? AND project_id=?',[sessionId,String(user.id),projectId]):undefined
  if(!projectId||!ownsProject(projectId,String(user.id)))return reply.code(404).send({error:'当前漫剧项目不存在'})
  if(!comicSession)return reply.code(404).send({error:'漫剧会话已失效，请新建会话后重试'})
  const idea=String(input.idea??'').trim(),revision=String(input.revision??'').trim(),duration=String(input.duration||'由对话内容推断').slice(0,30),aspectRatio=['9:16','16:9','1:1'].includes(String(input.aspectRatio))?String(input.aspectRatio):'由对话内容推断'
  if(!idea&&!input.previousPlan)return reply.code(400).send({error:'请先描述你想创作的漫剧'})
  if(idea.length>4000||revision.length>2000)return reply.code(400).send({error:'创作描述过长，请精简后重试'})
  const baseUrl=String(process.env.PROMPT_AGENT_BASE_URL||process.env.OPENAI_IMAGE_BASE_URL||'').replace(/\/$/,''),apiKey=String(process.env.PROMPT_AGENT_API_KEY||process.env.OPENAI_IMAGE_API_KEY||''),model=String(input.model||process.env.PROMPT_AGENT_MODEL||'gpt-5.5')
  if(!baseUrl||!apiKey)return reply.code(503).send({error:'灵感 Agent 接口尚未配置'})
  const visualSources=(input.visuals??[]).map(String).filter(source=>/^\/api\/assets\/[^/]+\/content(?:\/|$)/.test(source)).slice(0,8)
  let visualInputs:string[]=[]
  try{validateOwnedInputUrls(visualSources,String(user.id),'image');visualInputs=resolveOwnedInputUrls(visualSources,String(user.id),'image',model)}catch{return reply.code(400).send({error:'Agent 无法读取所选参考素材'})}
  const system=`你是 Viora 的漫剧导演、编剧和分镜师。把用户创意规划成一份先讲得通、再能生产的短篇漫剧剧本，此阶段只做策划，不声称已生成图片或视频。用户没有说明时长或画幅时，根据内容规模主动选择合适的总时长和 9:16、16:9 或 1:1，不要反问。只返回合法 JSON，不要 Markdown。结构必须为：{"title":"片名","logline":"一句话梗概","tone":"统一的美术、时代、环境与情绪基调","duration":"总时长","aspectRatio":"画幅","characters":[{"name":"角色名","description":"稳定角色设定","voiceProfile":"中文声线：年龄感、音色、音高、语速、情绪与说话习惯","imagePrompt":"统一角色定妆图提示词"}],"props":[{"name":"关键物品名","description":"形状、材质、颜色、尺寸、磨损和剧情用途的固定设定","imagePrompt":"纯背景道具设定图提示词"}],"outline":[{"act":"剧情段落","content":"包含人物目标、阻碍、因果、冲突、转折和状态变化的详细剧情"}],"shots":[{"number":1,"title":"制作镜头标题","duration":5,"storyBeat":"本镜头在剧情中的目的、承接的原因和产生的结果","action":"角色可见动作、反应、走位以及动作结束后的状态","sceneId":"可复用场景标识","scene":"场景、景别、走位、动作与画面结果","scenePrompt":"无人物环境基准图提示词","characterIndexes":[1],"propIndexes":[1],"dialogue":"按 角色名：台词 格式书写的中文对白或旁白","frames":[{"title":"起始画面","imagePrompt":"结合所连接角色、道具与场景基准图的连续分镜图提示词"},{"title":"关键变化","imagePrompt":"同一镜头中下一个时序画面提示词"}],"imagePrompt":"本镜头主静帧提示词，用于兼容","videoPrompt":"按 frames 顺序演进的动作、运镜、环境变化与结束状态","transition":"与下一镜头的剪辑方式","continuity":"从上一镜头继承的人物、道具、动作、视线、信息和情绪状态","referenceIndexes":[1]}],"changeSummary":"本轮修改摘要"}。先在内部完成故事因果链，再拆成镜头，禁止把互不相干的漂亮画面当成剧情。每个镜头的 storyBeat 必须说明“因为什么发生什么，导致什么”；action 必须有可见的开始、变化和结果；下一个镜头必须承接上一个镜头已经发生的结果或明确交代时间/地点转换。只要角色开口、交流、争执、解释或作出关键决定，dialogue 必须提供可直接配音的具体中文台词，并使用“角色名：台词”；不能用“二人交谈”“简单对话”等占位描述。没有角色对白的镜头也必须填写“旁白：具体内容”或“无对白，以某个明确动作推进”，不得留空。对白应自然、简短、有信息增量和人物语气，不能重复画面说明。所有 imagePrompt 和 scenePrompt 必须控制在 100 个中文字符以内，只写当前图片新增的主体关系、动作、构图和关键状态，不重复上游角色、道具、场景设定。characters 和 props 只收录需要跨镜头保持一致的视觉资产；普通背景小物件不要单独建档。镜头数量不得套用固定值，应由总时长、剧情节拍、必要反应和转场共同决定；不得为凑数量拆镜或删减因果。每个制作镜头 3–8 秒。frames 是同一段视频的连续参考画面：静态或简单动作用 1 张，明显走位、物品状态变化、镜头转折用 2–4 张；各帧必须是同一场景和时间轴上的先后状态，视频将按 frames 顺序连接生成。相同地点与时段使用相同 sceneId 和 scenePrompt，场景图禁止出现人物。characterIndexes 和 propIndexes 分别是本镜所需角色和道具的 1 起始编号。分镜提示词不重新捏造外观，必须明确沿用连接的设定图。输出前逐镜审查：人物目标是否清楚、冲突是否升级、信息是否被下一镜承接、动作和道具状态是否连续、对白是否推动剧情；发现断层时主动补充必要镜头，但不固定总数。referenceIndexes 是用户所选素材的编号。首次生成要有完整起承转合和可配音对白；修改时保留未被要求改变的内容。`
  const comicProductionRules='补充硬性规则：characters 中必须返回 visualAsset 布尔值。只有具有稳定可见外形、需要跨镜头保持一致的实体人物才是 true；系统声音、旁白、意识、文字提示、无实体光效必须为 false，且不得为它们生成定妆图。角色存在换装、战斗服、受伤、变身、年龄阶段等明显视觉状态时，在对应 character 中返回 forms 数组，格式为 [{"name":"形态名","description":"相对 Base 基准形态发生的外观变化","imagePrompt":"严格基于 Base 人物基准图，只改变该形态服饰或状态的设定图提示词"}]；Base 形态仍由 character 本身表示，不得在 forms 重复创建。每个镜头必须返回 characterForms 数组，格式为 [{"characterIndex":1,"form":"形态名"}]，只在该镜头确实使用非 Base 形态时填写；未列出的角色默认使用 Base。不得在同一分镜混用同一角色的 Base 与其他形态。characterIndexes 只能列出该镜头画面中明确出镜的具名角色；仅在对白、前后剧情或场外存在但画面不可见的角色不得加入。路人、群众、行人、围观者等匿名背景人物绝不能借用任何具名配角的 characterIndexes 或 Base 设定，必须作为无需资产连线的差异化背景角色；每个具名角色在单帧中默认只出现一个实例，禁止把角色 Base 复制成多个群众。sceneId 表示地点与时段的稳定身份，不是镜头编号；同一地点即使出现变暗、破坏、天气、光效或剧情状态变化，也必须沿用相同 sceneId 和同一张无人物场景基准图，把变化写入 frames.imagePrompt。只有真正切换到不同地点或时段才创建新 sceneId。'
  const comicContinuityRules='跨镜头连续性规则：相邻制作镜头若 sceneId 相同且时间连续，后一镜头第一张 frame 必须明确承接前一镜头最后一张 frame 的人物站位、动作结束姿态、视线方向、服饰形态、道具状态、环境光线和左右空间关系；continuity 必须写清继承项与本镜头新增变化。只有明确切换地点、时段或蒙太奇段落时才允许重置构图。不要让每个镜头都从人物正面站立的初始状态重新开始。每张最终分镜最多使用 4 张参考图，优先级是上一连续分镜、当前具名出镜角色、当前首次出现的关键道具、场景基准。若已连接同场景的上一分镜，不要再重复依赖场景基准，也不要重复依赖已在上一分镜出现且外观未变化的道具；上一分镜应作为场景、站位、光线与既有道具的合成状态参考。'
  const comicTransitionRules='剧情过渡硬规则：每个镜头必须在 storyBeat 中说明它承接上一镜的原因和为下一镜提供的信息、动作或情绪结果，禁止彼此独立的画面堆砌。transition 不得为空，必须明确使用动作承接、视线匹配、声音先行、反应镜头、环境空镜、道具特写、时间提示或建立镜头中的一种自然过渡。地点、时段、人物状态或剧情目标发生变化时，必须增加必要的建立镜头或过渡镜头，不能直接跳切；但不得为了凑数量生成无剧情作用的重复镜头。相邻镜头的对白必须问答、反应或信息递进，上一镜提出的信息必须在后续镜头得到承接。分段生成时，下一段第一镜必须继承上一段末镜的地点时段、角色形态、道具状态、未完成动作、情绪和悬念，除非先用明确过渡完成转换。'
  const comicDialogueRules='视频对白与声线规则：characters.voiceProfile 必须为每个可说话角色提供稳定中文声线，写清年龄感、音色、音高、语速、情绪底色和说话习惯，同一角色跨镜头不得换声。每个镜头的 videoPrompt 必须结合 dialogue 安排说话顺序、自然中文普通话发音、口型、呼吸、停顿、表情、动作反应和未说话者的倾听反应；不得翻译成英语或生成无意义拟声。旁白使用独立、稳定的中文旁白声线，且不得让画面人物无故张嘴。dialogue 的具体台词不得只存在于剧本文本而从视频制作提示中丢失。若镜头无对白，要明确通过何种动作和环境变化推进。'
  const comicCharacterSheetRules='人物资产规则：characters.imagePrompt 与 forms.imagePrompt 不受分镜 100 字限制，应提供 180–350 个中文字符的专业角色设定板说明。Base 人物必须是 16:9 横向 Character Design Sheet，同一人物同一比例排列正面、严格侧面、背面三视图，并包含头部/五官/发型近景、服装内外层结构、鞋靴、关键装备、武器、饰品、徽记和材质纹理的独立局部放大；写清年龄感、身高体型、肤色、发色瞳色、轮廓、主辅色和不可变化的身份锚点。不要生成三种不同人物、动作海报或复杂场景。特殊形态也使用三视图设定板，严格继承 Base 的脸、发型、体型和身份锚点，只展示该形态发生变化的服饰、伤势、装备或身体状态。'
  const comicStyleRules='全局视觉风格规则：tone 必须以“风格类型：动漫风 / 拟人风 / 写实风 / 三维卡通风 / 插画风”中的一个明确类别开头，再给出可直接用于生成的统一规范，包括线条、上色、材质、光影、色彩与镜头质感。根据用户需求选择类别，不得擅自把一种风格转换成另一种。characters、forms、props、scenePrompt、frames.imagePrompt 与 videoPrompt 必须全部继承该风格类型和 tone；每一个提示词都必须明确写出同一个“风格类型：××风”，场景、人物、分镜与视频不得依靠模型自行猜测风格。'
  let storedBrief=String(comicSession.brief||'{}');try{const value=JSON.parse(storedBrief) as {constraints?:unknown};if(Array.isArray(value.constraints))value.constraints=value.constraints.filter(item=>!/(?:暂不|不要|别|先不).{0,8}生成(?:完整)?(?:剧本|方案)/.test(String(item)));storedBrief=JSON.stringify(value)}catch{/* 沿用原始简报 */}const storedPlan=String(comicSession.plan||''),previous=input.previousPlan&&typeof input.previousPlan==='object'?JSON.stringify(input.previousPlan):storedPlan
  const context=(input.context??[]).map(String).filter(Boolean).slice(0,8)
  const effectiveRevision=revision||String(comicSession.pendingRevision||'').trim(),text=[`已确认创作简报：${storedBrief}`,`创作想法：${idea||'沿用创作简报'}`,`目标：${duration}，${aspectRatio}`,context.length?`所选素材：\n${context.map((item,index)=>`${index+1}. ${item}`).join('\n')}`:'没有选择素材',previous?`上一版方案：${previous}`:'',effectiveRevision?`用户确认应用的修改：${effectiveRevision}`:'用户已确认，请生成第一版完整方案'].filter(Boolean).join('\n\n')
  const content:unknown=visualInputs.length?[{type:'text',text},...visualInputs.map(url=>({type:'image_url',image_url:{url}}))]:text
  const comicLockKey=`${String(user.id)}:${projectId}`
  if(activeComicPlans.has(comicLockKey))return reply.code(409).send({error:'当前项目已有完整剧本正在生成，请勿重复提交'})
  activeComicPlans.add(comicLockKey)
  let streamStarted=false,streamHeartbeat:ReturnType<typeof setInterval>|null=null,streamReceivedBytes=0,streamProgress=0,lastStreamContentAt=Date.now(),startedAt=Date.now()
  try{
    const proxyUrl=String(process.env.PROMPT_AGENT_HTTPS_PROXY||process.env.OPENAI_IMAGE_HTTPS_PROXY||'');startedAt=Date.now()
    reply.hijack();streamStarted=true;lastStreamContentAt=Date.now();reply.raw.writeHead(200,{'content-type':'application/x-ndjson; charset=utf-8','cache-control':'no-cache, no-transform','x-accel-buffering':'no','connection':'keep-alive'});const emit=(value:unknown)=>reply.raw.write(`${JSON.stringify(value)}\n`);emit({type:'start',message:revision?'正在读取现有方案…':'正在理解故事想法…'});streamHeartbeat=setInterval(()=>{if(!reply.raw.destroyed)emit({type:'heartbeat',at:Date.now(),idleSeconds:Math.floor((Date.now()-lastStreamContentAt)/1000),receivedBytes:streamReceivedBytes,progress:streamProgress})},10000)
    const candidateModels=[model,...(model==='gpt-5.4-mini'?[]:['gpt-5.4-mini'])],headerTimeout=Math.max(20000,Math.min(90000,Number(process.env.COMIC_AGENT_HEADER_TIMEOUT_MS||45000))),idleTimeout=Math.max(20000,Math.min(120000,Number(process.env.COMIC_AGENT_IDLE_TIMEOUT_MS||60000)));let usedModel=model
    const readStage=async(stage:string,stageSystem:string,stageContent:unknown,maxTokens:number,progressStart:number,progressEnd:number,holdProgress=false)=>{let responseBody:ReadableStream<Uint8Array>|undefined,upstreamController:AbortController|undefined,lastUpstreamError='';lastStreamContentAt=Date.now();for(let attempt=0;attempt<candidateModels.length;attempt++){usedModel=candidateModels[attempt];if(attempt>0)emit({type:'progress',progress:progressStart,phase:`${stage}响应较慢，正在切换备用线路…`});const controller=new AbortController(),headerTimer=setTimeout(()=>controller.abort(new DOMException('漫剧上游连接超时','TimeoutError')),headerTimeout),options={method:'POST',headers:{authorization:`Bearer ${apiKey}`,'content-type':'application/json'},body:JSON.stringify({model:usedModel,stream:true,stream_options:{include_usage:true},reasoning_effort:'low',temperature:.38,max_tokens:maxTokens,response_format:{type:'json_object'},messages:[{role:'system',content:stageSystem},{role:'user',content:stageContent}]}),signal:controller.signal};try{const candidate=proxyUrl?await undiciFetch(`${baseUrl}/v1/chat/completions`,{...options,dispatcher:new ProxyAgent(proxyUrl)}):await fetch(`${baseUrl}/v1/chat/completions`,options);clearTimeout(headerTimer);if(candidate.ok&&candidate.body){responseBody=candidate.body as ReadableStream<Uint8Array>;upstreamController=controller;lastStreamContentAt=Date.now();break}const failure=await candidate.text();lastUpstreamError=`${candidate.status} ${failure.slice(0,300)}`;request.log.warn({stage,attempt:attempt+1,model:usedModel,status:candidate.status},'comic stage upstream unavailable')}catch(error){clearTimeout(headerTimer);lastUpstreamError=error instanceof Error?error.message:String(error);request.log.warn({stage,attempt:attempt+1,model:usedModel,message:lastUpstreamError},'comic stage upstream retry')}}if(!responseBody)throw new Error(lastUpstreamError||`${stage}未返回响应流`);const reader=responseBody.getReader(),decoder=new TextDecoder();let buffer='',raw='',lastStageProgress=progressStart;while(true){const idleRemaining=Math.max(1000,idleTimeout-(Date.now()-lastStreamContentAt));let idleTimer:ReturnType<typeof setTimeout>|undefined;const chunk=await Promise.race([reader.read(),new Promise<never>((_,reject)=>{idleTimer=setTimeout(()=>{upstreamController?.abort();reject(new DOMException(`${stage}连续无正文数据`,'TimeoutError'))},idleRemaining)})]).finally(()=>{if(idleTimer)clearTimeout(idleTimer)});const{done,value}=chunk;if(done)break;buffer+=decoder.decode(value,{stream:true});const lines=buffer.split(/\r?\n/);buffer=lines.pop()||'';for(const line of lines){const data=line.startsWith('data:')?line.slice(5).trim():'';if(!data||data==='[DONE]')continue;try{const packet=JSON.parse(data) as {choices?:Array<{delta?:{content?:string}}>},delta=String(packet.choices?.[0]?.delta?.content||'');if(!delta)continue;raw+=delta;lastStreamContentAt=Date.now();streamReceivedBytes+=Buffer.byteLength(delta,'utf8');const progress=holdProgress?progressStart:Math.min(progressEnd-1,progressStart+Math.floor(raw.length/Math.max(90,maxTokens/18)));streamProgress=Math.max(streamProgress,progress);if(progress>lastStageProgress){lastStageProgress=progress;emit({type:'progress',progress,phase:stage,receivedBytes:streamReceivedBytes})}}catch{/* 忽略上游 keepalive */}}}const normalized=raw.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();if(!normalized)throw new SyntaxError(`${stage}返回为空`);request.log.info({stage,model:usedModel,elapsedMs:Date.now()-startedAt,responseLength:normalized.length,holdProgress},'comic stage received');const completedProgress=holdProgress?progressStart:progressEnd;streamProgress=Math.max(streamProgress,completedProgress);emit({type:'progress',progress:completedProgress,phase:`${stage}已完成`,receivedBytes:streamReceivedBytes});return JSON.parse(normalized) as Record<string,unknown>}
    const validatePromptLengths=(value:Record<string,unknown>,kind:'assets'|'scenes'|'shots')=>{const issues:string[]=[];if(kind==='assets'){const characters=Array.isArray(value.characters)?value.characters:[],props=Array.isArray(value.props)?value.props:[];characters.forEach((raw,index)=>{const item=raw&&typeof raw==='object'?raw as Record<string,unknown>:{},prompt=String(item.imagePrompt||'');if(item.visualAsset!==false&&!prompt)issues.push(`角色${index+1}.imagePrompt 为空`);if(prompt.length>420)issues.push(`角色${index+1}.imagePrompt ${prompt.length}>420`);const forms=Array.isArray(item.forms)?item.forms:[];forms.forEach((formRaw,formIndex)=>{const form=formRaw&&typeof formRaw==='object'?formRaw as Record<string,unknown>:{},formPrompt=String(form.imagePrompt||'');if(!formPrompt)issues.push(`角色${index+1}.forms[${formIndex}].imagePrompt 为空`);if(formPrompt.length>420)issues.push(`角色${index+1}.forms[${formIndex}].imagePrompt ${formPrompt.length}>420`)})});props.forEach((raw,index)=>{const item=raw&&typeof raw==='object'?raw as Record<string,unknown>:{},prompt=String(item.imagePrompt||'');if(!prompt)issues.push(`道具${index+1}.imagePrompt 为空`);if(prompt.length>160)issues.push(`道具${index+1}.imagePrompt ${prompt.length}>160`)})}if(kind==='scenes'){const scenes=Array.isArray(value.scenes)?value.scenes:[];if(!scenes.length)issues.push('scenes 为空');scenes.forEach((raw,index)=>{const item=raw&&typeof raw==='object'?raw as Record<string,unknown>:{},prompt=String(item.imagePrompt||item.scenePrompt||'');if(!prompt)issues.push(`场景${index+1}.imagePrompt 为空`);if(prompt.length>160)issues.push(`场景${index+1}.imagePrompt ${prompt.length}>160`)})}if(kind==='shots'){const shots=Array.isArray(value.shots)?value.shots:[];if(!shots.length)issues.push('shots 为空');shots.forEach((raw,index)=>{const item=raw&&typeof raw==='object'?raw as Record<string,unknown>:{},prompt=String(item.imagePrompt||'');if(!prompt)issues.push(`镜头${index+1}.imagePrompt 为空`);if(prompt.length>100)issues.push(`镜头${index+1}.imagePrompt ${prompt.length}>100`);const scenePrompt=String(item.scenePrompt||'');if(!scenePrompt)issues.push(`镜头${index+1}.scenePrompt 为空`);if(scenePrompt.length>160)issues.push(`镜头${index+1}.scenePrompt ${scenePrompt.length}>160`);if(!normalizeComicDialogue(item.dialogue))issues.push(`镜头${index+1}.dialogue 无法识别`);if(!String(item.videoPrompt||'').trim())issues.push(`镜头${index+1}.videoPrompt 为空`);if(!String(item.transition||'').trim())issues.push(`镜头${index+1}.transition 为空`);if(!String(item.continuity||'').trim())issues.push(`镜头${index+1}.continuity 为空`);if(!String(item.storyBeat||'').trim())issues.push(`镜头${index+1}.storyBeat 为空`);const frames=Array.isArray(item.frames)?item.frames:[];if(!frames.length)issues.push(`镜头${index+1}.frames 为空`);frames.forEach((frameRaw,frameIndex)=>{const frame=frameRaw&&typeof frameRaw==='object'?frameRaw as Record<string,unknown>:{},framePrompt=String(frame.imagePrompt||'');if(!framePrompt)issues.push(`镜头${index+1}.frames[${frameIndex}].imagePrompt 为空`);if(framePrompt.length>100)issues.push(`镜头${index+1}.frames[${frameIndex}].imagePrompt ${framePrompt.length}>100`)})})}return issues}
    const rewriteUntilValid=async(stage:string,value:Record<string,unknown>,kind:'assets'|'scenes'|'shots',system:string,contextText:string,progress:number,maxTokens:number)=>{let current=value;for(let rewrite=1;rewrite<=2;rewrite++){const issues=validatePromptLengths(current,kind);if(!issues.length)return current;emit({type:'progress',progress,phase:`${stage}校验发现 ${issues.length} 项问题，正在第 ${rewrite} 次重写…`,receivedBytes:streamReceivedBytes,rewrite});const rewriteText=`保持原 JSON 的事实、编号、剧情和引用关系不变，只修复下列校验问题。不得删减必要剧情，不得新增无关内容。\n问题：\n${issues.join('\n')}\n\n上下文：\n${contextText}\n\n待重写 JSON：\n${JSON.stringify(current)}`;current=await readStage(`${stage}重写中…`,system,rewriteText,maxTokens,progress,progress,true)}const remaining=validatePromptLengths(current,kind);if(remaining.length)throw new SyntaxError(`${stage}复检仍有 ${remaining.length} 项不合格`);return current}
    const storySystem=`你是漫剧总策划。本阶段只生成剧情基座，禁止返回人物、道具、场景和 shots。只返回合法 JSON：{"title":"片名","logline":"梗概","tone":"统一视觉风格","duration":"预计总时长","aspectRatio":"16:9或9:16或1:1","outline":[{"act":"剧情段落","content":"完整因果、冲突和转折"}]}。大纲段数由剧情自然结构决定，必须有完整起承转合、因果和结局。${comicStyleRules}`
    const story=await readStage('正在生成剧情大纲…',storySystem,content,2400,5,18)
    if(!Array.isArray(story.outline)||!story.outline.length||!String(story.title||'').trim())throw new SyntaxError('剧情大纲缺少标题或段落')
    emit({type:'progress',progress:19,phase:'剧情大纲校验通过',receivedBytes:streamReceivedBytes})
    const assetSystem=`你是漫剧视觉设定师。只返回合法 JSON：{"characters":[{"name":"角色名","description":"稳定设定","voiceProfile":"中文声线","visualAsset":true,"imagePrompt":"180–420字角色设定板提示词","forms":[]}],"props":[{"name":"道具名","description":"固定设定","imagePrompt":"不超过160字的道具图提示词"}]}。只建立跨镜头需要保持一致的具名人物和关键道具，普通路人不建档。人物提示词的生成目标只能是单一角色设定板，展示固定外观、服饰、三视图与细节，禁止剧情场景、表演动作、多人互动、海报构图和复制角色。道具提示词的生成目标只能是单一道具设定素材，展示结构、材质、颜色与细节，禁止人物、人体、手持动作、剧情表演和复杂背景。角色 imagePrompt 与形态 imagePrompt 均不得超过420字，道具 imagePrompt 不得超过160字。${comicCharacterSheetRules}\n${comicStyleRules}`
    const assetText=`已确认创作需求：\n${text}\n\n已校验剧情大纲：\n${JSON.stringify(story)}`
    let assets=await readStage('正在生成人物与道具设定…',assetSystem,assetText,3800,20,34)
    assets=await rewriteUntilValid('人物与道具设定',assets,'assets',assetSystem,assetText,34,3800)
    if(!Array.isArray(assets.characters)||!assets.characters.length)throw new SyntaxError('人物设定为空')
    emit({type:'progress',progress:35,phase:'人物与道具设定校验通过',receivedBytes:streamReceivedBytes})
    const sceneSystem=`你是漫剧场景美术。只返回合法 JSON：{"scenes":[{"sceneId":"稳定地点与时段ID","name":"场景名","description":"空间结构与剧情用途","imagePrompt":"不超过160字的无人物场景设定图提示词"}]}。合并同一地点与时段，状态变化不得重复创建场景。每条 imagePrompt 必须明确写出“无人物场景基准图，禁止出现任何人物、人体、手部、角色剪影或人形主体”，只生成可供后续分镜合成使用的空环境、空间结构、UI界面、道具陈列与光影素材。即使剧情中该场景原本有人，场景基准图也必须保持无人；人物只能在后续 frames 分镜合成阶段加入。每条 imagePrompt 不得超过160字，并继承统一风格。`
    const sceneText=`剧情与视觉基座：\n${JSON.stringify({...story,...assets})}`
    let sceneBible=await readStage('正在生成场景设定…',sceneSystem,sceneText,2600,36,48)
    sceneBible=await rewriteUntilValid('场景设定',sceneBible,'scenes',sceneSystem,sceneText,48,2600)
    emit({type:'progress',progress:49,phase:'场景设定校验通过',receivedBytes:streamReceivedBytes})
    const foundation={...story,...assets,scenes:Array.isArray(sceneBible.scenes)?sceneBible.scenes:[]} as Record<string,unknown>,outlineParts=(Array.isArray(story.outline)?story.outline:[]).slice(0,8),allShots:unknown[]=[]
    const shotPlanSystem='你是漫剧镜头规划师。本阶段只确定镜头总数和轻量结构，禁止生成图片提示词、视频提示词和 frames。只返回合法 JSON：{"plannedShots":[{"number":1,"outlineIndex":1,"title":"镜头名","duration":5,"storyBeat":"承接上一镜并推动下一镜的剧情节拍","sceneId":"场景ID","characterIndexes":[1],"propIndexes":[1],"dialogueSummary":"对白用途","transition":"与上一镜的过渡方式","continuity":"需要继承的状态"}]}。镜头数由预计时长和必要剧情节拍决定，每镜3–8秒；必须覆盖全部大纲段落，形成完整起承转合，地点、时间、目标或情绪变化处安排必要过渡镜头，不得固定镜头数量。'
    const shotPlanText=`创作需求：\n${text}\n\n已校验剧情、人物、道具和场景基座：\n${JSON.stringify(foundation)}`
    let shotPlan=await readStage('正在规划完整镜头列表…',shotPlanSystem,shotPlanText,3200,50,57)
    const shotPlanIssues=(value:Record<string,unknown>)=>{const planned=Array.isArray(value.plannedShots)?value.plannedShots:[],issues:string[]=[];if(!planned.length)issues.push('plannedShots 为空');if(planned.length>48)issues.push(`镜头数量 ${planned.length}>48`);planned.forEach((raw,index)=>{const item=raw&&typeof raw==='object'?raw as Record<string,unknown>:{},outlineIndex=Number(item.outlineIndex);if(!String(item.title||'').trim())issues.push(`镜头${index+1}.title 为空`);if(!String(item.storyBeat||'').trim())issues.push(`镜头${index+1}.storyBeat 为空`);if(!String(item.transition||'').trim())issues.push(`镜头${index+1}.transition 为空`);if(!Number.isInteger(outlineIndex)||outlineIndex<1||outlineIndex>outlineParts.length)issues.push(`镜头${index+1}.outlineIndex 无效`)});for(let index=1;index<=outlineParts.length;index++)if(!planned.some(raw=>Number(raw&&typeof raw==='object'?(raw as Record<string,unknown>).outlineIndex:0)===index))issues.push(`剧情段落 ${index}/${outlineParts.length} 未被镜头覆盖`);return issues}
    for(let rewrite=1;rewrite<=2;rewrite++){const issues=shotPlanIssues(shotPlan);if(!issues.length)break;emit({type:'progress',progress:57,phase:`镜头规划发现 ${issues.length} 项问题，正在第 ${rewrite} 次重写…`,receivedBytes:streamReceivedBytes,rewrite});shotPlan=await readStage('镜头规划重写中…',shotPlanSystem,`保持故事事实不变，修复下列问题并返回完整 plannedShots。\n${issues.join('\n')}\n\n原规划：\n${JSON.stringify(shotPlan)}\n\n基座：\n${shotPlanText}`,3200,57,57,true)}
    const remainingPlanIssues=shotPlanIssues(shotPlan);if(remainingPlanIssues.length)throw new SyntaxError(`镜头规划复检仍有 ${remainingPlanIssues.length} 项不合格`)
    const plannedShots=(Array.isArray(shotPlan.plannedShots)?shotPlan.plannedShots:[]).slice(0,48).map((raw,index)=>({...((raw&&typeof raw==='object'?raw:{}) as Record<string,unknown>),number:index+1})),totalShots=plannedShots.length
    emit({type:'progress',progress:58,phase:`镜头规划校验通过 · 共 ${totalShots} 镜`,receivedBytes:streamReceivedBytes,totalShots})
    const shotsSystem=`你是漫剧分镜导演。严格按照本批轻量镜头规划逐镜扩写，只返回合法 JSON：{"shots":[完整镜头数组]}，返回数量和 number 必须与本批规划完全一致，不得合并、删除或新增镜头。每项必须包含 number、title、duration、storyBeat、action、sceneId、scene、scenePrompt、characterIndexes、characterForms、propIndexes、dialogue、frames、imagePrompt、videoPrompt、transition、continuity、referenceIndexes。imagePrompt 与每个 frame.imagePrompt 不得超过100字，scenePrompt 不得超过160字；角色和道具索引严格引用视觉基座。scenePrompt 只能描述无人物环境、空间、UI界面和光影素材，禁止人物、人体、手部和角色剪影。frame.imagePrompt 才是完整剧情分镜：必须明确当前出镜人物、动作、景别、构图、场景状态和必要道具，禁止三视图、设定板、素材拼贴、重复人物和无关元素。videoPrompt 只能让连接分镜按既定人物身份、场景、动作、运镜和对白演进，禁止重新设计人物、换装、换场景或切换画风。${comicProductionRules}\n${comicContinuityRules}\n${comicTransitionRules}\n${comicDialogueRules}\n${comicStyleRules}`
    const shotBatchSize=4,batchCount=Math.ceil(totalShots/shotBatchSize)
    for(let batchIndex=0;batchIndex<batchCount;batchIndex++){const expected=plannedShots.slice(batchIndex*shotBatchSize,(batchIndex+1)*shotBatchSize),firstNumber=Number(expected[0]?.number||batchIndex*shotBatchSize+1),lastNumber=Number(expected.at(-1)?.number||firstNumber),batchStart=59+Math.floor(batchIndex*34/batchCount),batchEnd=59+Math.floor((batchIndex+1)*34/batchCount),previousTail=allShots.slice(-2),batchText=`完整镜头规划：\n${JSON.stringify(plannedShots)}\n\n本批必须详细生成镜头 ${firstNumber}–${lastNumber}/${totalShots}：\n${JSON.stringify(expected)}\n\n上一批最后镜头状态：\n${JSON.stringify(previousTail)}\n\n已校验视觉基座：\n${JSON.stringify(foundation)}`,batchContent:unknown=visualInputs.length?[{type:'text',text:batchText},...visualInputs.map(url=>({type:'image_url',image_url:{url}}))]:batchText;let shotPart=await readStage(`正在生成镜头 ${firstNumber}–${lastNumber}/${totalShots}…`,shotsSystem,batchContent,4200,batchStart,Math.max(batchStart+1,batchEnd-1));const batchIssues=(value:Record<string,unknown>)=>{const issues=validatePromptLengths(value,'shots'),returned=Array.isArray(value.shots)?value.shots:[];if(returned.length!==expected.length)issues.push(`返回 ${returned.length} 镜，预期 ${expected.length} 镜`);expected.forEach((planItem,index)=>{if(Number(returned[index]&&typeof returned[index]==='object'?(returned[index] as Record<string,unknown>).number:0)!==Number(planItem.number))issues.push(`第 ${index+1} 项镜头编号不匹配，预期 ${planItem.number}`)});return issues};for(let rewrite=1;rewrite<=2;rewrite++){const issues=batchIssues(shotPart);if(!issues.length)break;emit({type:'progress',progress:Math.max(batchStart,batchEnd-1),phase:`镜头 ${firstNumber}–${lastNumber}/${totalShots} 发现 ${issues.length} 项问题，正在第 ${rewrite} 次重写…`,receivedBytes:streamReceivedBytes,rewrite});shotPart=await readStage(`镜头 ${firstNumber}–${lastNumber}/${totalShots} 重写中…`,shotsSystem,`严格保持本批镜头规划、编号和剧情事实，修复下列问题。\n${issues.join('\n')}\n\n本批规划：\n${JSON.stringify(expected)}\n\n待重写 JSON：\n${JSON.stringify(shotPart)}\n\n上一批末镜：\n${JSON.stringify(previousTail)}`,4200,Math.max(batchStart,batchEnd-1),Math.max(batchStart,batchEnd-1),true)}const remaining=batchIssues(shotPart);if(remaining.length)throw new SyntaxError(`镜头 ${firstNumber}–${lastNumber} 复检仍有 ${remaining.length} 项不合格`);allShots.push(...(Array.isArray(shotPart.shots)?shotPart.shots:[]));emit({type:'progress',progress:batchEnd,phase:`镜头 ${firstNumber}–${lastNumber}/${totalShots} 校验通过`,receivedBytes:streamReceivedBytes,totalShots,completedShots:allShots.length})}
    emit({type:'progress',progress:94,phase:'正在执行全局连续性校验…',receivedBytes:streamReceivedBytes})
    const auditSystem='你是漫剧连续性审校。只返回合法 JSON：{"valid":true,"issues":[],"repairs":[{"shotNumber":1,"storyBeat":"修正后剧情承接","transition":"修正后过渡","continuity":"修正后连续性"}]}。检查相邻镜头和分段边界的因果、人物形态、道具状态、地点时段、动作、情绪、对白与悬念是否承接。只给确有问题的镜头 repairs，不修改图片提示词，不重写整个方案。'
    let audit=await readStage('正在审校跨段过渡…',auditSystem,JSON.stringify({outline:outlineParts,shots:allShots}),2200,94,97)
    for(let auditAttempt=1;auditAttempt<=2;auditAttempt++){const repairs=Array.isArray(audit.repairs)?audit.repairs:[],issues=Array.isArray(audit.issues)?audit.issues:[];if(audit.valid===true&&!issues.length)break;if(!repairs.length)throw new SyntaxError('跨段审校发现问题但未返回可执行修复');emit({type:'progress',progress:97,phase:`发现 ${repairs.length} 处跨段问题，正在修复…`,receivedBytes:streamReceivedBytes,repairAttempt:auditAttempt});for(const raw of repairs){const repair=raw&&typeof raw==='object'?raw as Record<string,unknown>:{},shot=allShots[Math.max(0,Number(repair.shotNumber)-1)];if(!shot||typeof shot!=='object')continue;const target=shot as Record<string,unknown>;for(const field of ['storyBeat','transition','continuity'])if(String(repair[field]||'').trim())target[field]=String(repair[field])}emit({type:'progress',progress:97,phase:'正在复检跨段修复结果…',receivedBytes:streamReceivedBytes,repairAttempt:auditAttempt});audit=await readStage('跨段修复复检中…',auditSystem,JSON.stringify({outline:outlineParts,shots:allShots}),1800,97,97,true)}
    if(audit.valid!==true||(Array.isArray(audit.issues)&&audit.issues.length))throw new SyntaxError('跨段连续性复检未通过')
    emit({type:'progress',progress:98,phase:'全局连续性校验通过',receivedBytes:streamReceivedBytes})
    if(streamHeartbeat){clearInterval(streamHeartbeat);streamHeartbeat=null}const plan={...foundation,shots:allShots} as Record<string,unknown>,rawShots=Array.isArray(plan.shots)?plan.shots:[],rawCharacters=Array.isArray(plan.characters)?plan.characters:[]
    request.log.info({model:usedModel,requestedModel:model,elapsedMs:Date.now()-startedAt,responseLength:JSON.stringify(plan).length},'comic agent response received')
    const characters=rawCharacters.slice(0,12).map(value=>{const character=value&&typeof value==='object'?value as Record<string,unknown>:{};const name=String(character.name||'未命名角色').slice(0,50),description=String(character.description||'').slice(0,800),voiceProfile=String(character.voiceProfile||character.voice||'自然中文普通话，声线与角色年龄和性格一致，跨镜头保持稳定').slice(0,300),nonVisual=/无实体|没有实体|仅(?:以|通过).*(?:声音|文字|光阵)|旁白|系统之声/.test(`${name}${description}`),rawForms=Array.isArray(character.forms)?character.forms:Array.isArray(character.variants)?character.variants:[],forms=rawForms.slice(0,6).map(formValue=>{const form=formValue&&typeof formValue==='object'?formValue as Record<string,unknown>:{},formName=String(form.name||'特殊形态').slice(0,50),formDescription=String(form.description||'').slice(0,600);return{name:formName,description:formDescription,imagePrompt:compactImagePrompt(String(form.imagePrompt||`严格参考${name} Base 人物基准图，保持面部、发型、体型和身份一致，只变更为${formName}：${formDescription}。16:9 横向角色设定板，正面、侧面、背面三视图，并展示变化服饰、伤势、装备和饰品局部细节。`),420)}}).filter(form=>form.name&&!/^(?:base|基础|默认|常态)$/i.test(form.name));return {name,description,voiceProfile,visualAsset:character.visualAsset!==false&&!nonVisual,imagePrompt:compactImagePrompt(String(character.imagePrompt||`${name} Base 角色设定板。${description}。16:9 横向排版，同一人物正面、严格侧面、背面三视图；附头部五官发型近景、服装分层、鞋靴、关键装备武器饰品与材质纹理局部放大，纯净中性背景，保持比例和身份完全一致。`),420),forms}})
    const rawProps=Array.isArray(plan.props)?plan.props:[],props=rawProps.slice(0,16).map(value=>{const prop=value&&typeof value==='object'?value as Record<string,unknown>:{},name=String(prop.name||'未命名道具').slice(0,60),description=String(prop.description||'').slice(0,800);return {name,description,imagePrompt:compactImagePrompt(String(prop.imagePrompt||`${name}道具设定图，${description}，纯背景，材质、尺寸和特征清楚`),160)}})
    const shots=rawShots.slice(0,48).map((value,index)=>{const shot=value&&typeof value==='object'?value as Record<string,unknown>:{},scene=String(shot.scene||'').slice(0,800),storyBeat=String(shot.storyBeat||'').slice(0,700),action=String(shot.action||scene||'').slice(0,800),dialogue=normalizeComicDialogue(shot.dialogue).slice(0,700),imagePrompt=compactImagePrompt(String(shot.imagePrompt||scene||'')),explicitCharacters=Array.isArray(shot.characterIndexes)?shot.characterIndexes.map(Number).filter(number=>Number.isInteger(number)&&number>=1&&number<=characters.length):[],characterEvidence=`${scene}${storyBeat}${action}${dialogue}${imagePrompt}${JSON.stringify(shot.frames||[])}`,inferredCharacters=characters.map((character,characterIndex)=>new RegExp(character.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).test(characterEvidence)?characterIndex+1:0).filter(Boolean),validatedCharacters=explicitCharacters.length&&inferredCharacters.length?explicitCharacters.filter(number=>inferredCharacters.includes(number)):explicitCharacters.length?explicitCharacters:inferredCharacters,propIndexes=Array.isArray(shot.propIndexes)?[...new Set(shot.propIndexes.map(Number).filter(number=>Number.isInteger(number)&&number>=1&&number<=props.length))]:[],rawFrames=Array.isArray(shot.frames)?shot.frames:[],frames=(rawFrames.length?rawFrames:[{title:'主画面',imagePrompt}]).slice(0,4).map((frameValue,frameIndex)=>{const frame=frameValue&&typeof frameValue==='object'?frameValue as Record<string,unknown>:{};return {title:String(frame.title||`画面 ${frameIndex+1}`).slice(0,60),imagePrompt:compactImagePrompt(String(frame.imagePrompt||imagePrompt))}}).filter(frame=>frame.imagePrompt);return {number:index+1,title:String(shot.title||`镜头 ${index+1}`).slice(0,50),duration:Math.max(3,Math.min(8,Number(shot.duration)||5)),storyBeat,action,scene,sceneId:String(shot.sceneId||`scene-${index+1}`).slice(0,80),scenePrompt:compactImagePrompt(String(shot.scenePrompt||`无人物环境基准图，${scene}，保持《${String(plan.title||'漫剧')}》统一美术风格`),160),characterIndexes:[...new Set(validatedCharacters)],propIndexes,dialogue,frames,imagePrompt:frames[0]?.imagePrompt||imagePrompt,videoPrompt:String(shot.videoPrompt||'').slice(0,800),transition:String(shot.transition||'').slice(0,300),continuity:String(shot.continuity||'').slice(0,500),referenceIndexes:Array.isArray(shot.referenceIndexes)?[...new Set(shot.referenceIndexes.map(Number).filter(number=>Number.isInteger(number)&&number>=1&&number<=visualInputs.length))]:[]}}).filter(shot=>shot.frames.length&&shot.videoPrompt)
    shots.forEach((shot,index)=>{const rawShot=rawShots[index]&&typeof rawShots[index]==='object'?rawShots[index] as Record<string,unknown>:{},rawForms=Array.isArray(rawShot.characterForms)?rawShot.characterForms:[],characterForms=rawForms.slice(0,12).map(value=>{const selection=value&&typeof value==='object'?value as Record<string,unknown>:{},characterIndex=Number(selection.characterIndex),requestedForm=String(selection.form||selection.formName||'').trim(),character=characters[characterIndex-1],form=character?.forms.find(item=>item.name===requestedForm);return form?{characterIndex,form:form.name}:null}).filter((value):value is {characterIndex:number;form:string}=>Boolean(value));for(const selection of characterForms)if(!shot.characterIndexes.includes(selection.characterIndex))shot.characterIndexes.push(selection.characterIndex);(shot as typeof shot&{characterForms:Array<{characterIndex:number;form:string}>}).characterForms=characterForms})
    if(!shots.length)throw new SyntaxError('missing shots')
    const outline=(Array.isArray(plan.outline)?plan.outline:[]).slice(0,8).map((value,index)=>{const item=value&&typeof value==='object'?value as Record<string,unknown>:{};return {act:String(item.act||`第 ${index+1} 幕`).slice(0,50),content:String(item.content||'').slice(0,1200)}})
    const result={title:String(plan.title||'未命名漫剧').slice(0,100),logline:String(plan.logline||'').slice(0,600),tone:String(plan.tone||'').slice(0,300),duration:duration==='由对话内容推断'?String(plan.duration||`${shots.reduce((sum,shot)=>sum+shot.duration,0)} 秒`).slice(0,30):duration,aspectRatio:aspectRatio==='由对话内容推断'?(['9:16','16:9','1:1'].includes(String(plan.aspectRatio))?String(plan.aspectRatio):'9:16'):aspectRatio,characters,props,outline,shots,changeSummary:String(plan.changeSummary||'').slice(0,300),model:usedModel};database.run('UPDATE comic_sessions SET phase=?,plan=?,pending_revision=?,updated_at=? WHERE id=? AND user_id=? AND project_id=?',['generated',JSON.stringify(result),'',new Date().toISOString(),sessionId,String(user.id),projectId]);persist();emit({type:'result',data:result});reply.raw.end();return
  }catch(error){if(streamHeartbeat)clearInterval(streamHeartbeat);request.log.error({message:error instanceof Error?error.message:String(error),elapsedMs:Date.now()-startedAt,streamReceivedBytes,streamProgress,idleSeconds:Math.floor((Date.now()-lastStreamContentAt)/1000)},'comic agent failed');const message=error instanceof SyntaxError?'漫剧方案返回不完整，请重试':error instanceof DOMException&&error.name==='TimeoutError'?'漫剧构思连续 60 秒没有新内容，请重试':'漫剧策划暂时失败，请稍后重试';if(streamStarted){reply.raw.write(`${JSON.stringify({type:'error',error:message})}\n`);reply.raw.end();return}return reply.code(error instanceof DOMException&&error.name==='TimeoutError'?504:502).send({error:message})}finally{activeComicPlans.delete(comicLockKey)}
})
app.get('/user-api-models', async (request, reply) => { const user = requireUser(request, reply); if (!user) return; return getAll('SELECT id, kind, name, model, base_url AS baseUrl, CASE WHEN proxy_url IS NULL OR proxy_url = ? THEN 0 ELSE 1 END AS hasProxy, created_at AS createdAt, updated_at AS updatedAt FROM user_api_models WHERE user_id = ? ORDER BY created_at ASC', ['', String(user.id)]).map(item => ({ ...item, hasProxy: Boolean(item.hasProxy), hasKey: true })) })
app.post('/feedback', async (request, reply) => { const user=requireUser(request,reply);if(!user)return;const body=request.body as {type?:string;title?:string;content?:string;contact?:string;projectId?:string;pageUrl?:string;userAgent?:string},type=body.type==='bug'?'bug':'suggestion',title=String(body.title||'').trim(),content=String(body.content||'').trim(),contact=String(body.contact||'').trim(),projectId=String(body.projectId||'').trim();if(title.length<2||title.length>100)return reply.code(400).send({error:'标题需要 2–100 个字符'});if(content.length<5||content.length>5000)return reply.code(400).send({error:'请填写 5–5000 个字符的详细说明'});if(contact.length>200)return reply.code(400).send({error:'联系方式过长'});if(projectId&&!getOne('SELECT id FROM projects WHERE id = ? AND user_id = ?',[projectId,String(user.id)]))return reply.code(400).send({error:'项目信息无效'});const id=randomUUID(),now=new Date().toISOString();database.run('INSERT INTO feedback (id,user_id,project_id,type,title,content,contact,page_url,user_agent,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[id,String(user.id),projectId||null,type,title,content,contact||null,String(body.pageUrl||'').slice(0,500),String(body.userAgent||'').slice(0,1000),'open',now]);persist();request.log.info({feedbackId:id,userId:user.id,type,projectId:projectId||null},'user feedback submitted');return reply.code(201).send({id,status:'open',createdAt:now}) })
app.get('/notifications',async(request,reply)=>{const user=requireUser(request,reply);if(!user)return;return getAll('SELECT n.id,n.title,n.content,n.type,n.created_at AS createdAt,CASE WHEN r.read_at IS NULL THEN 0 ELSE 1 END AS isRead FROM notifications n LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.user_id=? ORDER BY n.created_at DESC LIMIT 100',[String(user.id)]).map(item=>({...item,isRead:Boolean(item.isRead)}))})
app.get('/notifications/stream',async(request,reply)=>{const user=requireUser(request,reply);if(!user)return;reply.hijack();reply.raw.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache, no-transform','connection':'keep-alive','x-accel-buffering':'no'});notificationStreams.add(reply.raw);sendNotificationSync(reply.raw);const heartbeat=setInterval(()=>{if(!reply.raw.destroyed)reply.raw.write(`: keepalive ${Date.now()}\n\n`)},25000),close=()=>{clearInterval(heartbeat);notificationStreams.delete(reply.raw)};request.raw.once('close',close);reply.raw.once('close',close)})
app.post('/notifications/claim-popup',async(request,reply)=>{const user=requireUser(request,reply);if(!user)return;const localDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),item=getOne("SELECT n.id FROM notifications n LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.user_id=? LEFT JOIN notification_popups p ON p.notification_id=n.id AND p.user_id=? AND p.local_date=? WHERE n.auto_popup=1 AND n.priority='important' AND r.read_at IS NULL AND p.notification_id IS NULL ORDER BY n.created_at DESC LIMIT 1",[String(user.id),String(user.id),localDate]);if(!item)return {show:false};database.run('INSERT OR IGNORE INTO notification_popups (notification_id,user_id,local_date,shown_at) VALUES (?,?,?,?)',[String(item.id),String(user.id),localDate,new Date().toISOString()]);persist();return {show:true,notificationId:String(item.id)}})
app.post('/notifications/:id/read',async(request,reply)=>{const user=requireUser(request,reply);if(!user)return;const {id}=request.params as {id:string};if(!getOne('SELECT id FROM notifications WHERE id=?',[id]))return reply.code(404).send({error:'通知不存在'});database.run('INSERT OR REPLACE INTO notification_reads (notification_id,user_id,read_at) VALUES (?,?,?)',[id,String(user.id),new Date().toISOString()]);persist();return {ok:true}})
app.post('/notifications/read-all',async(request,reply)=>{const user=requireUser(request,reply);if(!user)return;const now=new Date().toISOString();for(const item of getAll('SELECT id FROM notifications',[]))database.run('INSERT OR REPLACE INTO notification_reads (notification_id,user_id,read_at) VALUES (?,?,?)',[String(item.id),String(user.id),now]);persist();return {ok:true}})
app.get('/admin/feedback', async (request, reply) => { if(!requireAdmin(request,reply))return;const query=request.query as {status?:string;type?:string;limit?:string},status=String(query.status||'all'),type=String(query.type||'all'),limit=Math.min(500,Math.max(1,Number.parseInt(String(query.limit||'100'),10)||100)),where:string[]=[],parameters:(string|number)[]=[];if(['open','reviewing','resolved','closed'].includes(status)){where.push('f.status=?');parameters.push(status)}if(['bug','suggestion'].includes(type)){where.push('f.type=?');parameters.push(type)}parameters.push(limit);return getAll(`SELECT f.id,f.type,f.title,f.content,f.contact,f.project_id AS projectId,p.name AS projectName,f.page_url AS pageUrl,f.user_agent AS userAgent,f.status,f.created_at AS createdAt,u.id AS userId,u.name AS userName,u.username,u.email FROM feedback f JOIN users u ON u.id=f.user_id LEFT JOIN projects p ON p.id=f.project_id ${where.length?`WHERE ${where.join(' AND ')}`:''} ORDER BY f.created_at DESC LIMIT ?`,parameters) })
app.patch('/admin/feedback/:id',async(request,reply)=>{const admin=requireAdmin(request,reply);if(!admin)return;const {id}=request.params as {id:string},body=request.body as {status?:string},status=String(body.status||'').trim();if(!['open','reviewing','resolved','closed'].includes(status))return reply.code(400).send({error:'反馈状态仅支持 open、reviewing、resolved、closed'});const feedback=getOne('SELECT id,title,status FROM feedback WHERE id=?',[id]);if(!feedback)return reply.code(404).send({error:'反馈不存在'});database.run('UPDATE feedback SET status=? WHERE id=?',[status,id]);persist();request.log.info({feedbackId:id,status,adminId:admin.id},'admin feedback status updated');return{id:String(feedback.id),title:String(feedback.title),previousStatus:String(feedback.status),status}})
app.post('/admin/notifications',async(request,reply)=>{const admin=requireAdmin(request,reply);if(!admin)return;const body=request.body as {title?:string;content?:string;type?:string;priority?:string;autoPopup?:boolean},title=String(body.title||'').trim(),content=String(body.content||'').trim(),type=String(body.type||'update').trim(),priority=body.priority==='important'?'important':'normal',autoPopup=body.autoPopup===true;if(title.length<2||title.length>100)return reply.code(400).send({error:'通知标题需要 2–100 个字符'});if(content.length<2||content.length>3000)return reply.code(400).send({error:'通知内容需要 2–3000 个字符'});if(!['update','fix','notice','maintenance'].includes(type))return reply.code(400).send({error:'通知类型仅支持 update、fix、notice、maintenance'});const id=randomUUID(),createdAt=new Date().toISOString();database.run('INSERT INTO notifications (id,title,content,type,created_at,priority,auto_popup) VALUES (?,?,?,?,?,?,?)',[id,title,content,type,createdAt,priority,autoPopup?1:0]);persist();broadcastNotificationSync();request.log.info({notificationId:id,adminId:admin.id,type,priority,autoPopup},'admin notification published');return reply.code(201).send({id,title,content,type,priority,autoPopup,createdAt})})
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
app.post('/auth/activity', async (request, reply) => { const token=sessionToken(request);if(!token)return reply.code(401).send({error:'Unauthorized'});const id=sessionId(token),now=new Date(),cutoff=new Date(now.getTime()-sessionIdleTimeoutMs).toISOString(),session=getOne('SELECT id FROM sessions WHERE id=? AND expires_at>? AND COALESCE(last_activity_at,created_at)>?',[id,now.toISOString(),cutoff]);if(!session){database.run('DELETE FROM sessions WHERE id=?',[id]);persist();clearSessionCookie(request,reply);return reply.code(401).send({error:'Session expired'})}database.run('UPDATE sessions SET last_activity_at=? WHERE id=?',[now.toISOString(),id]);persist();return {ok:true} })
app.get('/users/me', async (request, reply) => { const user = requireUser(request, reply); if (!user) return; return { id: user.id, name: user.name, username: user.username, email: user.email, inviteCode: user.inviteCode, createdAt: user.createdAt, credits:Number(user.credits ?? 0), reservedCredits:Number(user.reservedCredits ?? 0), isAdmin:Boolean(user.isAdmin) } })
app.post('/users/me/api-token',async(request,reply)=>{const user=requireUser(request,reply);if(!user)return;const token=`viora_${randomBytes(30).toString('base64url')}`,hint=`${token.slice(0,10)}…${token.slice(-6)}`;database.run('UPDATE users SET api_token_hash=?,api_token_hint=? WHERE id=?',[hashApiToken(token),hint,String(user.id)]);persist();return {token,hint,createdAt:new Date().toISOString()}})
app.get('/users/me/api-token',async(request,reply)=>{const user=requireUser(request,reply);if(!user)return;const row=getOne('SELECT api_token_hint AS hint FROM users WHERE id=?',[String(user.id)]);return {exists:Boolean(row?.hint),hint:String(row?.hint||'')}})
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
app.delete('/projects/:projectId', async (request, reply) => { const user = requireUser(request, reply); if (!user) return; const userId = String(user.id), { projectId } = request.params as { projectId: string }; if (!ownsProject(projectId, userId)) return reply.code(404).send({ error: 'Project not found' }); const projectCount = Number(getOne('SELECT count(*) AS count FROM projects WHERE user_id = ?', [userId])?.count ?? 0); if (projectCount <= 1) return reply.code(409).send({ error: '至少需要保留一个项目' }); const files = getAll('SELECT storage_name FROM assets WHERE project_id = ? AND user_id = ?', [projectId, userId]); for (const file of files) { const path = `${uploadDirectory}/${file.storage_name}`; if (existsSync(path)) unlinkSync(path) } database.run('DELETE FROM assets WHERE project_id = ? AND user_id = ?', [projectId, userId]); database.run('DELETE FROM project_canvases WHERE project_id = ?', [projectId]); database.run('DELETE FROM jobs WHERE project_id = ? AND user_id = ?', [projectId, userId]); database.run('DELETE FROM comic_sessions WHERE project_id = ? AND user_id = ?', [projectId, userId]); database.run('DELETE FROM projects WHERE id = ? AND user_id = ?', [projectId, userId]); persist(); return reply.code(204).send() })

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
  const finalPrompt=input.prompt.trim(),promptLimit=input.kind==='video'?4000:input.promptProfile==='character'?600:320
  if(finalPrompt.length>promptLimit)return reply.code(400).send({error:`最终提示词长度 ${finalPrompt.length} 超过当前类型上限 ${promptLimit}，请精简当前描述`})
  const id = randomUUID(), now = new Date().toISOString()
  if (creditCost) database.run('UPDATE users SET reserved_credits = reserved_credits + ? WHERE id = ?', [creditCost,userId])
  database.run('INSERT INTO jobs (id, project_id, user_id, node_id, kind, prompt, model, status, progress, input_urls, parameters, custom_model_id, credit_cost, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, projectId, userId, input.nodeId, input.kind, finalPrompt, model, 'queued', 0, JSON.stringify(inputUrls), JSON.stringify(input.parameters ?? {}), customId || null, creditCost, now, now])
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

app.post('/projects/:projectId/jobs/cancel-active', async (request, reply) => {
  const user = requireUser(request, reply); if (!user) return
  const userId=String(user.id),{projectId}=request.params as {projectId:string}
  if(!ownsProject(projectId,userId))return reply.code(404).send({error:'Project not found'})
  const active=getAll("SELECT id,credit_cost,credit_settled FROM jobs WHERE project_id=? AND user_id=? AND status IN ('queued','running')",[projectId,userId]),now=new Date().toISOString()
  if(!active.length)return {ok:true,canceled:0}
  database.run('BEGIN')
  try{
    for(const job of active){const cost=Number(job.credit_cost??0);if(cost&&!Boolean(job.credit_settled)){database.run('UPDATE users SET reserved_credits=MAX(0,reserved_credits-?) WHERE id=?',[cost,userId]);database.run('UPDATE jobs SET credit_settled=1 WHERE id=?',[String(job.id)])}}
    database.run("UPDATE jobs SET status='canceled',progress=0,error='用户已取消',updated_at=? WHERE project_id=? AND user_id=? AND status IN ('queued','running')",[now,projectId,userId])
    database.run('COMMIT')
  }catch(error){database.run('ROLLBACK');throw error}
  persist();queueMicrotask(pumpGenerationQueue)
  request.log.info({userId,projectId,canceled:active.length},'active project jobs canceled')
  return {ok:true,canceled:active.length}
})

app.post('/projects/:projectId/jobs/cancel-pending', async (request, reply) => {
  const user=requireUser(request,reply);if(!user)return
  const userId=String(user.id),{projectId}=request.params as {projectId:string}
  if(!ownsProject(projectId,userId))return reply.code(404).send({error:'Project not found'})
  const pending=getAll("SELECT id,credit_cost,credit_settled FROM jobs WHERE project_id=? AND user_id=? AND status='queued'",[projectId,userId]),now=new Date().toISOString()
  if(!pending.length)return {ok:true,canceled:0,ids:[]}
  database.run('BEGIN')
  try{
    for(const job of pending){const cost=Number(job.credit_cost??0);if(cost&&!Boolean(job.credit_settled)){database.run('UPDATE users SET reserved_credits=MAX(0,reserved_credits-?) WHERE id=?',[cost,userId]);database.run('UPDATE jobs SET credit_settled=1 WHERE id=?',[String(job.id)])}}
    database.run("UPDATE jobs SET status='canceled',progress=0,error='用户取消等待任务',updated_at=? WHERE project_id=? AND user_id=? AND status='queued'",[now,projectId,userId])
    database.run('COMMIT')
  }catch(error){database.run('ROLLBACK');throw error}
  persist();queueMicrotask(pumpGenerationQueue)
  const ids=pending.map(job=>String(job.id));request.log.info({userId,projectId,canceled:ids.length},'pending project jobs canceled')
  return {ok:true,canceled:ids.length,ids}
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

function compactImagePrompt(value: string, limit = 100) {
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
function normalizeComicDialogue(value:unknown):string{
  if(typeof value==='string')return value.trim()
  const entries=Array.isArray(value)?value:[value]
  return entries.map(entry=>{if(typeof entry==='string')return entry.trim();if(!entry||typeof entry!=='object')return'';const item=entry as Record<string,unknown>,speaker=String(item.speaker||item.character||item.name||item.role||item.type||'').trim(),text=String(item.text||item.line||item.content||item.dialogue||item.words||'').trim();if(!text)return'';const normalizedSpeaker=/旁白|narrat/i.test(speaker)?'旁白':speaker;return normalizedSpeaker?`${normalizedSpeaker}：${text}`:text}).filter(Boolean).join('\n')
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
function assetThumbnailUrl(id: string, mimeType: string, isPublic = false) { return /^(image|video)\//.test(mimeType) ? `/api/${isPublic ? 'public/' : ''}assets/${id}/thumbnail` : undefined }
const execFileAsync = promisify(execFile)
const pendingVideoThumbnails = new Map<string, Promise<void>>()
async function sendAssetThumbnail(reply: FastifyReply, assetId: string, asset: Record<string, unknown>, isPublic = false) {
  const mimeType = String(asset.mime_type ?? '')
  if (!/^(image|video)\//.test(mimeType)) return reply.code(415).send({ error: 'Asset does not support thumbnails' })
  const video = mimeType.startsWith('video/'), thumbnailPath = `${thumbnailDirectory}/${assetId}.${video ? 'jpg' : 'webp'}`
  if (!existsSync(thumbnailPath) && video) {
    let task = pendingVideoThumbnails.get(assetId)
    if (!task) {
      task = execFileAsync('ffmpeg', ['-hide_banner','-loglevel','error','-ss','0.15','-i',`${uploadDirectory}/${String(asset.storage_name)}`,'-frames:v','1','-vf',"scale='min(640,iw)':-2",'-q:v','5','-y',thumbnailPath], { timeout: 20_000, maxBuffer: 1024 * 1024 }).then(() => undefined).finally(() => pendingVideoThumbnails.delete(assetId))
      pendingVideoThumbnails.set(assetId, task)
    }
    try { await task } catch { return reply.code(422).send({ error: 'Video thumbnail generation failed' }) }
  } else if (!existsSync(thumbnailPath)) await sharp(`${uploadDirectory}/${String(asset.storage_name)}`).rotate().resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true }).webp({ quality: 72, effort: 3 }).toFile(thumbnailPath)
  reply.type(video ? 'image/jpeg' : 'image/webp').header('cache-control', `${isPublic ? 'public' : 'private'}, max-age=86400, immutable`)
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
function hashApiToken(token:string){return createHash('sha256').update(token).digest('hex')}
function sessionId(token: string) { return createHash('sha256').update(token).digest('hex') }
function sessionToken(request: FastifyRequest) { const cookie = String(request.headers.cookie ?? '').split(';').map(part => part.trim()).find(part => part.startsWith('flow_session=')); return cookie ? decodeURIComponent(cookie.slice('flow_session='.length)) : '' }
const sessionIdleTimeoutMs = Math.max(60_000, Number(process.env.SESSION_IDLE_TIMEOUT_MS || 30 * 60 * 1000))
function createSession(userId: string, createdAt = new Date().toISOString()) { const token = randomBytes(32).toString('base64url'), expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); database.run('DELETE FROM sessions WHERE expires_at <= ?', [createdAt]); database.run('INSERT INTO sessions (id, user_id, created_at, expires_at, last_activity_at) VALUES (?, ?, ?, ?, ?)', [sessionId(token), userId, createdAt, expiresAt, createdAt]); return token }
function currentUser(request: FastifyRequest) { const authorization=String(request.headers.authorization||''),bearer=authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();if(bearer?.startsWith('viora_'))return getOne('SELECT id,name,username,email,invite_code AS inviteCode,created_at AS createdAt,credits,reserved_credits AS reservedCredits,is_admin AS isAdmin FROM users WHERE api_token_hash=?',[hashApiToken(bearer)]);const token = sessionToken(request); if (!token) return undefined; const now=new Date(),idleCutoff=new Date(now.getTime()-sessionIdleTimeoutMs).toISOString();return getOne(`SELECT users.id, users.name, users.username, users.email, users.invite_code AS inviteCode, users.created_at AS createdAt, users.credits, users.reserved_credits AS reservedCredits, users.is_admin AS isAdmin FROM sessions JOIN users ON users.id = sessions.user_id
  WHERE sessions.id = ? AND sessions.expires_at > ? AND COALESCE(sessions.last_activity_at,sessions.created_at) > ?`, [sessionId(token),now.toISOString(),idleCutoff]) }
function requireAdmin(request:FastifyRequest,reply:FastifyReply){const user=currentUser(request),configured=String(process.env.ADMIN_API_KEY||''),provided=String(request.headers['x-admin-key']||''),keyAuthorized=Boolean(configured&&provided&&secureTextEqual(provided,configured));if(user?.isAdmin)return user;if(keyAuthorized)return {id:'admin-api-key',isAdmin:true};void reply.code(user?403:401).send({error:user?'仅管理员可以执行此操作':'Unauthorized'});return undefined}
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
    if (!custom && kind === 'image' && process.env.SDCPP_IMAGE_FALLBACK_ENABLED === 'true' && !['flux1-kontext-dev','z-image-turbo'].includes(model) && isLocalImageFallbackError(lastError) && localImageFallback) {
      if (await localImageFallback.available()) {
        app.log.warn({ jobId:id, model, error:lastError instanceof Error?lastError.message:String(lastError) }, 'primary image provider failed, using local fallback')
        await updateJob(id,{ status:'running', progress:3, error:undefined })
        await localImageFallback.run({ internalJobId:id, projectId:String(job.project_id), nodeId:Number(job.node_id), kind, prompt:String(job.prompt), model:'flux1-kontext-dev', inputUrls, parameters }, update => { updates = updates.then(() => updateJob(id, update.status === 'queued' ? { ...update, status:'running' } : update)) })
        await updates
        return
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

function isLocalImageFallbackError(error:unknown) {
  const message=error instanceof Error?error.message:String(error)
  if (/safety|rejected|content policy|auth_unavailable|no auth available|unauthori[sz]ed|forbidden|\b400\b|\b401\b|\b403\b/i.test(message)) return false
  return /unexpected EOF|ETIMEDOUT|timeout|timed out|aborted|ECONNRESET|ECONNREFUSED|fetch failed|socket|network|temporar|\b429\b|\b5\d\d\b|backend-api\/codex\/images/i.test(message)
}

function parseJsonArray(value: unknown) { try { const parsed = JSON.parse(String(value || '[]')); return Array.isArray(parsed) ? parsed.map(String) : [] } catch { return [] } }
function parseJsonObject(value: unknown) { try { const parsed = JSON.parse(String(value || '{}')); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {} } catch { return {} } }

async function updateJob(id: string, update: GenerationUpdate) {
  if(String(getOne('SELECT status FROM jobs WHERE id = ?',[id])?.status)==='canceled')return
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
