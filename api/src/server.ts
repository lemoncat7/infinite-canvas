import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import initSqlJs, { type Database } from "sql.js";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import {
  createGenerationProvider,
  type GenerationUpdate,
} from "./providers/index.js";
import { OpenAiImageProvider } from "./providers/openai-image.js";
import { OpenAiVideoProvider } from "./providers/openai-video.js";
import { SdCppImageProvider } from "./providers/sdcpp-image.js";
import { getTtsProvider, listTtsProviders, resolveEasyVoiceId } from "./providers/tts.js";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import sharp from "sharp";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isAbsolute, relative, resolve } from "node:path";
import { Readable } from "node:stream";
import { gzipSync, gunzipSync } from "node:zlib";
import { comicAssetNameMentioned, comicCharacterStateTransitionIssues, comicPostureTransitionIssue, finalizeComicSceneDependencies, hasVisibleAnonymousCrowd, normalizeComicAssetIndexes, normalizeComicCharacterStates, normalizeComicSceneHierarchy, resolveVisibleAnonymousCrowd } from "./comic-validation.js";
import { COMIC_SHOT_BATCH_SIZE, comicBatchWindow, completedShotCount } from "./comic/pipeline-policy.js";
import { restoreComicCheckpoint, updateComicCheckpoint, type ComicGenerationCheckpoint } from "./comic/checkpoint-store.js";
import { comicGenerationErrorMessage, comicGenerationIssue } from "./comic/error-policy.js";
import { estimateComicSpeechDuration, normalizeComicDialogue, validateComicStage } from "./comic/validation.js";
import { repairComicStageUntilValid } from "./comic/stage-repair.js";
import { compactComicFoundation, comicShotPlanIssues, normalizeComicShotPlan } from "./comic/shot-plan.js";
import { parseFirstJsonObject } from "./comic/json.js";
import { ComicStreamState } from "./comic/stream-state.js";
import { createComicStageReader } from "./comic/stage-reader.js";
import { applyComicAuditRepairs, comicAuditSubset } from "./comic/audit.js";
import { comicAssetPrompt, comicAuditPrompt, comicScenePrompt, comicSceneViewPrompt, comicShotExpansionPrompt, comicShotPlanPrompt, comicStoryPrompt } from "./comic/prompts.js";

type CanvasPayload = {
  nodes: unknown[];
  links: unknown[];
  camera?: unknown;
  version?: number;
};
type CanvasOperation = {
  type: "node" | "link" | "camera";
  action: "upsert" | "delete";
  key: string;
  value?: unknown;
};
type JobInput = {
  projectId?: string;
  nodeId: number;
  kind: "image" | "video";
  prompt: string;
  promptProfile?: "character" | "prop" | "scene" | "storyboard" | "composite" | "manual";
  model?: string;
  inputUrls?: string[];
  parameters?: Record<string, unknown>;
};

const dataDirectory = process.env.DATA_DIR ?? "./data";
const databasePath = `${dataDirectory}/flow-studio.sqlite`;
const uploadDirectory = `${dataDirectory}/uploads`;
const thumbnailDirectory = `${dataDirectory}/thumbnails`;
const videoExportRoot = resolve(process.env.VIDEO_EXPORT_ROOT ?? `${dataDirectory}/exports`);
mkdirSync(dataDirectory, { recursive: true });
mkdirSync(uploadDirectory, { recursive: true });
mkdirSync(thumbnailDirectory, { recursive: true });
mkdirSync(videoExportRoot, { recursive: true });
const SQL = await initSqlJs();
const database: Database = existsSync(databasePath)
  ? new SQL.Database(readFileSync(databasePath))
  : new SQL.Database();
database.run(`
  CREATE TABLE IF NOT EXISTS canvases (id TEXT PRIMARY KEY, title TEXT NOT NULL, document TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, node_id INTEGER NOT NULL, kind TEXT NOT NULL, prompt TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 0, result_url TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS project_canvases (project_id TEXT PRIMARY KEY, document TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS canvas_versions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, document TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, user_id TEXT NOT NULL, name TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL, storage_name TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS user_api_models (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, model TEXT NOT NULL, base_url TEXT NOT NULL, api_key TEXT NOT NULL, proxy_url TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS recharge_codes (id TEXT PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE, credits INTEGER NOT NULL, redeemed_by TEXT, redeemed_at TEXT, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS credit_transactions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, amount INTEGER NOT NULL, type TEXT NOT NULL, reference_id TEXT, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS feedback (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, project_id TEXT, type TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, contact TEXT, page_url TEXT, user_agent TEXT, status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'update', created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS notification_reads (notification_id TEXT NOT NULL, user_id TEXT NOT NULL, read_at TEXT NOT NULL, PRIMARY KEY (notification_id,user_id));
  CREATE TABLE IF NOT EXISTS notification_popups (notification_id TEXT NOT NULL, user_id TEXT NOT NULL, local_date TEXT NOT NULL, shown_at TEXT NOT NULL, PRIMARY KEY (notification_id,user_id,local_date));
  CREATE TABLE IF NOT EXISTS comic_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, project_id TEXT NOT NULL, phase TEXT NOT NULL DEFAULT 'discussing', brief TEXT NOT NULL DEFAULT '{}', messages TEXT NOT NULL DEFAULT '[]', pending_revision TEXT NOT NULL DEFAULT '', plan TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS canvas_operation_batches (project_id TEXT NOT NULL, batch_id TEXT NOT NULL, client_id TEXT NOT NULL, base_version INTEGER NOT NULL, result_version INTEGER NOT NULL, response TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(project_id,batch_id));
  CREATE TABLE IF NOT EXISTS canvas_operations (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, batch_id TEXT NOT NULL, version INTEGER NOT NULL, record_type TEXT NOT NULL, record_key TEXT NOT NULL, action TEXT NOT NULL, payload TEXT, created_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_canvas_operations_project_version ON canvas_operations(project_id,version);
  CREATE INDEX IF NOT EXISTS idx_canvas_operations_record ON canvas_operations(project_id,record_type,record_key,version);
  CREATE TABLE IF NOT EXISTS app_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
`);
ensureColumn("jobs", "project_id", "TEXT");
ensureColumn("jobs", "user_id", "TEXT");
ensureColumn("jobs", "input_urls", "TEXT NOT NULL DEFAULT '[]'");
ensureColumn("jobs", "parameters", "TEXT NOT NULL DEFAULT '{}'");
ensureColumn("jobs", "result_metadata", "TEXT");
ensureColumn("jobs", "custom_model_id", "TEXT");
ensureColumn("assets", "is_public", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("users", "email", "TEXT");
ensureColumn("users", "password_hash", "TEXT");
ensureColumn("users", "username", "TEXT");
ensureColumn("users", "invite_code", "TEXT");
ensureColumn("users", "invited_by", "TEXT");
ensureColumn("users", "lab_enabled", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("users", "credits", "INTEGER NOT NULL DEFAULT 5");
ensureColumn("users", "reserved_credits", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("users", "is_admin", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("users", "api_token_hash", "TEXT");
ensureColumn("users", "api_token_hint", "TEXT");
ensureColumn("jobs", "credit_cost", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("jobs", "credit_settled", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("jobs", "retry_after", "TEXT");
ensureColumn("jobs", "retry_count", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("notifications", "priority", "TEXT NOT NULL DEFAULT 'normal'");
ensureColumn("notifications", "auto_popup", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("sessions", "last_activity_at", "TEXT");
ensureColumn("project_canvases", "version", "INTEGER NOT NULL DEFAULT 1");
ensureColumn("project_canvases", "reset_version", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("project_canvases", "next_node_id", "INTEGER NOT NULL DEFAULT 1");
ensureColumn("canvas_versions", "canvas_version", "INTEGER");
for (const row of getAll("SELECT project_id AS projectId,document,next_node_id AS nextNodeId FROM project_canvases", [])) {
  let maximum = 0;
  try {
    const parsed = JSON.parse(String(row.document || "{}"));
    for (const node of Array.isArray(parsed.nodes) ? parsed.nodes : [])
      if (Number.isSafeInteger(Number(node?.id))) maximum = Math.max(maximum, Number(node.id));
  } catch {
    /* 损坏画布由加载校验处理 */
  }
  if (Number(row.nextNodeId) <= maximum)
    database.run("UPDATE project_canvases SET next_node_id=? WHERE project_id=?", [maximum + 1, String(row.projectId)]);
}
ensureColumn(
  "comic_sessions",
  "generation_status",
  "TEXT NOT NULL DEFAULT 'idle'",
);
ensureColumn("comic_sessions", "generation_stage", "TEXT NOT NULL DEFAULT ''");
ensureColumn(
  "comic_sessions",
  "generation_progress",
  "INTEGER NOT NULL DEFAULT 0",
);
ensureColumn(
  "comic_sessions",
  "generation_received_bytes",
  "INTEGER NOT NULL DEFAULT 0",
);
ensureColumn("comic_sessions", "generation_error", "TEXT NOT NULL DEFAULT ''");
ensureColumn("comic_sessions", "generation_checkpoint", "TEXT NOT NULL DEFAULT '{}'");
ensureColumn("comic_sessions", "generation_issues", "TEXT NOT NULL DEFAULT '[]'");
database.run(
  "UPDATE sessions SET last_activity_at = COALESCE(last_activity_at, created_at)",
);
if (
  !getOne("SELECT id FROM app_migrations WHERE id = ?", [
    "reset-initial-credits-to-5",
  ])
) {
  const now = new Date().toISOString();
  database.run("UPDATE users SET credits = 5, reserved_credits = 0");
  database.run("INSERT INTO app_migrations (id,applied_at) VALUES (?,?)", [
    "reset-initial-credits-to-5",
    now,
  ]);
}
if (
  !getOne("SELECT id FROM notifications WHERE id = ?", [
    "comic-fixes-2026-08-03",
  ])
)
  database.run(
    "INSERT INTO notifications (id,title,content,type,created_at) VALUES (?,?,?,?,?)",
    [
      "comic-fixes-2026-08-03",
      "漫剧创作体验已更新",
      "已增加更细致的制作分镜与连续性检查，单镜头调整为 3–8 秒；修复流式连接中断、自动重试、铺到画布批量创建，以及分镜时长和画幅同步问题。",
      "fix",
      "2026-08-03T02:30:00.000Z",
    ],
  );
database.run(
  "UPDATE notifications SET priority='important',auto_popup=1 WHERE id=?",
  ["comic-fixes-2026-08-03"],
);
if (
  !getOne("SELECT id FROM notifications WHERE id = ?", [
    "comic-label-save-2026-08-03",
  ])
)
  database.run(
    "INSERT INTO notifications (id,title,content,type,created_at) VALUES (?,?,?,?,?)",
    [
      "comic-label-save-2026-08-03",
      "漫剧灵感，随时留在画布",
      "灵感漫剧创作现已支持一键保存为标签。完成剧情构思后，可将人物设定、剧情大纲与制作分镜完整收进画布，方便随时查看、整理和继续创作。",
      "update",
      "2026-08-03T10:00:00.000Z",
    ],
  );
if (
  !getOne("SELECT id FROM notifications WHERE id = ?", [
    "comic-continuity-workflow-2026-08-05",
  ])
)
  database.run(
    "INSERT INTO notifications (id,title,content,type,created_at) VALUES (?,?,?,?,?)",
    [
      "comic-continuity-workflow-2026-08-05",
      "漫剧工作流连续性全面升级",
      "人物现以 Base 基准图派生换装、受伤与变身等独立形态，分镜会连接剧情当下的正确形态；同场景相邻镜头自动承接上一镜头末帧，保持站位、动作、服饰、道具与光线连续。对白和旁白现会完整进入视频节点并指导口型与表演。画布同时新增项目任务监控、图片上传与资产复用，以及保留配置和提示词的清除重做能力。",
      "update",
      "2026-08-05T02:00:00.000Z",
    ],
  );
if (
  !getOne("SELECT id FROM notifications WHERE id = ?", [
    "project-task-queue-2026-08-05",
  ])
)
  database.run(
    "INSERT INTO notifications (id,title,content,type,created_at) VALUES (?,?,?,?,?)",
    [
      "project-task-queue-2026-08-05",
      "项目任务队列现在清晰可控",
      "画布顶栏新增项目任务入口，可实时查看生成中、排队中、等待上游和失败任务，并点击快速定位对应节点。任务列表已优化为稳定更新，滚动和点击不再随进度刷新漂移；现在还可一键取消全部排队与等待上游任务，同时保留已经生成中的任务继续执行，并自动释放相关预留点数。",
      "update",
      "2026-08-05T02:30:00.000Z",
    ],
  );
if (
  !getOne("SELECT id FROM notifications WHERE id = ?", [
    "comic-reference-voice-2026-08-05",
  ])
)
  database.run(
    "INSERT INTO notifications (id,title,content,type,created_at) VALUES (?,?,?,?,?)",
    [
      "comic-reference-voice-2026-08-05",
      "分镜参考与中文对白全面优化",
      "漫剧分镜现在会校验实际出镜角色，避免将配角 Base 复制成重复路人；单张分镜参考图限制为 4 张，同场景连续镜头优先沿用上一分镜，不再重复堆叠场景与旧道具。视频提示词同步加入稳定角色声线、自然中文普通话、准确口型、停顿、表情与旁白规则，让连续镜头的人物和声音更统一。",
      "update",
      "2026-08-04T19:20:00.000Z",
    ],
  );
database.run(
  "UPDATE notifications SET created_at = ? WHERE id = ? AND created_at = ?",
  [
    "2026-08-04T19:20:00.000Z",
    "comic-reference-voice-2026-08-05",
    "2026-08-05T15:00:00.000Z",
  ],
);
for (const [id, corrected, legacy] of [
  [
    "comic-fixes-2026-08-03",
    "2026-08-03T02:30:00.000Z",
    "2026-08-03T10:30:00.000Z",
  ],
  [
    "comic-label-save-2026-08-03",
    "2026-08-03T10:00:00.000Z",
    "2026-08-03T18:00:00.000Z",
  ],
  [
    "comic-continuity-workflow-2026-08-05",
    "2026-08-05T02:00:00.000Z",
    "2026-08-05T10:00:00.000Z",
  ],
  [
    "project-task-queue-2026-08-05",
    "2026-08-05T02:30:00.000Z",
    "2026-08-05T10:30:00.000Z",
  ],
])
  database.run(
    "UPDATE notifications SET created_at = ? WHERE id = ? AND created_at = ?",
    [corrected, id, legacy],
  );
ensureColumn("projects", "last_opened_at", "TEXT");
for (const user of getAll(
  "SELECT id FROM users WHERE invite_code IS NULL OR invite_code = ?",
  [""],
))
  database.run("UPDATE users SET invite_code = ? WHERE id = ?", [
    newInviteCode(),
    String(user.id),
  ]);
const developmentUserId = "dev-user";
const defaultProjectId = "default";
const generationProvider = createGenerationProvider();
const generationInputSigningSecret =
  process.env.GENERATION_INPUT_SIGNING_SECRET ||
  randomBytes(32).toString("hex");
const generationPublicBaseUrl = String(
  process.env.GENERATION_PUBLIC_BASE_URL || "",
).replace(/\/$/, "");
const bootTime = new Date().toISOString();
database.run(
  "UPDATE comic_sessions SET generation_status='interrupted', generation_stage='服务更新导致任务中断', generation_error='服务更新导致任务中断，请重新生成', updated_at=? WHERE generation_status='running'",
  [bootTime],
);
for (const job of getAll("SELECT id FROM jobs WHERE status = 'running'", []))
  settleJobCredits(String(job.id), false);
database.run(
  "UPDATE jobs SET status = 'failed', progress = 0, error = ?, updated_at = ? WHERE status = 'running'",
  ["生成服务曾重启，任务已中断，请重新生成", bootTime],
);
database.run(
  "INSERT OR IGNORE INTO users (id, name, created_at) VALUES (?, ?, ?)",
  [developmentUserId, "开发用户", bootTime],
);
database.run(
  "UPDATE users SET username = ? WHERE id = ? AND (username IS NULL OR username = '')",
  ["mochen", developmentUserId],
);
database.run("UPDATE users SET is_admin = 1 WHERE lower(username) = 'mochen'");
for (const user of getAll(
  "SELECT id, name FROM users WHERE username IS NULL OR username = ''",
  [],
))
  database.run("UPDATE users SET username = ? WHERE id = ?", [
    availableUsername(String(user.name || "user")),
    String(user.id),
  ]);
for (const user of getAll(
  "SELECT id FROM users WHERE invite_code IS NULL OR invite_code = ?",
  [""],
))
  database.run("UPDATE users SET invite_code = ? WHERE id = ?", [
    newInviteCode(),
    String(user.id),
  ]);
let compactedCanvasHistory=compactCanvasSyncHistory();
for(const row of getAll("SELECT rowid AS rowId,response FROM canvas_operation_batches WHERE length(response)>1024 AND response NOT LIKE 'gz:%'",[])){
  const encoded=encodeCanvasBatchResponse(String(row.response));
  if(encoded!==String(row.response)){database.run("UPDATE canvas_operation_batches SET response=? WHERE rowid=?",[encoded,Number(row.rowId)]);compactedCanvasHistory++}
}
if(compactedCanvasHistory>0)database.run("VACUUM");
persist();

const app = Fastify({ logger: true, bodyLimit: 150 * 1024 * 1024 });
const localImageFallback = process.env.SDCPP_IMAGE_BASE_URL
  ? new SdCppImageProvider()
  : null;
let localImageFallbackAvailable = false;
async function probeLocalImageFallback() {
  localImageFallbackAvailable = localImageFallback
    ? await localImageFallback.available()
    : false;
}
void probeLocalImageFallback();
setInterval(() => void probeLocalImageFallback(), 15000).unref();
const notificationStreams = new Map<FastifyReply["raw"], string>();
const activeComicPlans = new Set<string>();
const activeComicChats = new Set<string>();
const ttsPreviewRequests = new Map<
  string,
  Promise<{ bytes: Buffer; mimeType: string }>
>();
function sendNotificationSync(stream: FastifyReply["raw"]) {
  if (!stream.destroyed)
    stream.write(
      `event: notifications\ndata: ${JSON.stringify({ updatedAt: new Date().toISOString(), serverVersion: bootTime })}\n\n`,
    );
}
function broadcastNotificationSync() {
  for (const stream of notificationStreams.keys()) sendNotificationSync(stream);
}
function onlineUserCount() {
  return new Set(notificationStreams.values()).size;
}
function sendPresence(stream: FastifyReply["raw"]) {
  if (!stream.destroyed)
    stream.write(
      `event: presence\ndata: ${JSON.stringify({ online: onlineUserCount() })}\n\n`,
    );
}
function broadcastPresence() {
  for (const stream of notificationStreams.keys()) sendPresence(stream);
}
app.get("/health", async () => ({
  ok: true,
  service: "flow-studio-api",
  generationProvider: generationProvider.name,
}));
app.get("/generation/capabilities", async () => {
  const capabilities = generationProvider.capabilities ?? {
    image: {
      provider: generationProvider.name,
      defaultModel: process.env.OPENAI_IMAGE_DEFAULT_MODEL || "gpt-image-2",
    },
    video: {
      provider: generationProvider.name,
      defaultModel: process.env.AGNES_VIDEO_DEFAULT_MODEL || "agnes-video-v2.0",
      seconds: { min: 1, max: 18, default: 5 },
      resolutions: ["480p", "720p", "1080p"],
      aspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"],
    },
  };
  return {
    ...capabilities,
    image: {
      ...capabilities.image,
      localFallback: {
        model: "flux1-kontext-dev",
        available: localImageFallbackAvailable,
      },
    },
  };
});

app.get("/tts/providers", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  return Promise.all(listTtsProviders().map((provider) => provider.capabilities()));
});

app.get("/tts/providers/:providerId/voices", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const { providerId } = request.params as { providerId: string };
  const provider = getTtsProvider(providerId);
  if (!provider) return reply.code(404).send({ error: "语音服务不存在" });
  try {
    return {
      provider: provider.id,
      voices: (await provider.voices()).filter(
        (voice) => voice.language === "zh-CN",
      ),
    };
  } catch (error) {
    return reply.code(503).send({
      error: error instanceof Error ? error.message : "无法读取语音列表",
    });
  }
});

app.get("/tts/preview", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const query = request.query as {
    projectId?: string;
    providerId?: string;
    text?: string;
    voiceId?: string;
    speed?: string;
    pitch?: string;
    volume?: string;
  };
  const projectId = String(query.projectId || defaultProjectId);
  if (!ownsProject(projectId, String(user.id)))
    return reply.code(404).send({ error: "Project not found" });
  const text = String(query.text || "").trim().slice(0, 120);
  if (!text) return reply.code(400).send({ error: "试听文本不能为空" });
  const provider = getTtsProvider(String(query.providerId || "easyvoice-local"));
  if (!provider)
    return reply.code(400).send({ error: "当前语音服务不可用" });
  const voiceId = resolveEasyVoiceId(String(query.voiceId || "zh-CN-XiaoxiaoNeural"));
  try {
    const supportedVoice = (await provider.voices()).some(
      (voice) => voice.id === voiceId && voice.language === "zh-CN",
    );
    if (!supportedVoice)
      return reply.code(400).send({ error: "该服务不支持所选中文音色" });
    const speed = Math.max(0.5, Math.min(2, Number(query.speed) || 1));
    const pitch = Math.max(-50, Math.min(50, Number(query.pitch) || 0));
    const volume = Math.max(0, Math.min(2, Number(query.volume) || 1));
    const previewInput = {
        text,
        voiceId,
        speed,
        pitch,
        volume,
        format: "mp3" as const,
        language: "zh-CN",
        emotion: "中性",
      },
      previewKey = createHash("sha256")
        .update(JSON.stringify({ provider: provider.id, ...previewInput }))
        .digest("hex");
    let previewRequest = ttsPreviewRequests.get(previewKey);
    if (!previewRequest) {
      previewRequest = provider.synthesize(previewInput);
      ttsPreviewRequests.set(previewKey, previewRequest);
      // Media elements can request the same URL twice while probing metadata.
      // Keep the completed promise briefly so both requests share one TTS job.
      void previewRequest.finally(() =>
        setTimeout(() => ttsPreviewRequests.delete(previewKey), 10_000),
      );
    }
    const result = await previewRequest;
    return reply
      .type(result.mimeType)
      .header("cache-control", "no-store")
      .header("content-disposition", "inline")
      .header("content-length", String(result.bytes.length))
      .send(result.bytes);
  } catch (error) {
    request.log.error({ error, provider: provider.id }, "tts preview stream failed");
    return reply.code(502).send({
      error: error instanceof Error ? error.message : "流式试听失败",
    });
  }
});

app.post("/tts/synthesize", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const userId = String(user.id);
  const input = request.body as {
    projectId?: string;
    providerId?: string;
    text?: string;
    voiceId?: string;
    speed?: number;
    pitch?: number;
    volume?: number;
    format?: "wav" | "mp3" | "opus" | "flac" | "aac";
    language?: string;
    emotion?: string;
    preview?: boolean;
  };
  const projectId = String(input.projectId || defaultProjectId);
  if (!ownsProject(projectId, userId))
    return reply.code(404).send({ error: "Project not found" });
  const text = String(input.text || "").trim();
  if (!text) return reply.code(400).send({ error: "请先填写需要生成的文本" });
  if (text.length > 4000)
    return reply.code(400).send({ error: "单个语音文本不能超过 4000 字" });
  const provider = getTtsProvider(String(input.providerId || "easyvoice-local"));
  if (!provider) return reply.code(404).send({ error: "语音服务不存在" });
  const language = String(input.language || "zh-CN");
  if (language !== "zh-CN")
    return reply.code(400).send({ error: "当前仅开放中文语音生成" });
  const voiceId = resolveEasyVoiceId(String(input.voiceId || "zh-CN-XiaoxiaoNeural"));
  let supportedVoice;
  try {
    supportedVoice = (await provider.voices()).find(
      (voice) => voice.id === voiceId && voice.language === "zh-CN",
    );
  } catch (error) {
    return reply.code(503).send({
      error: error instanceof Error ? error.message : "无法读取中文音色列表",
    });
  }
  if (!supportedVoice)
    return reply.code(400).send({ error: "该服务不支持所选中文音色" });
  const speed = Number(input.speed ?? 1);
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 2)
    return reply.code(400).send({ error: "语速必须在 0.5 到 2.0 之间" });
  const pitch = Number(input.pitch ?? 0);
  if (!Number.isFinite(pitch) || pitch < -50 || pitch > 50)
    return reply.code(400).send({ error: "音调必须在 -50Hz 到 +50Hz 之间" });
  const volume = Number(input.volume ?? 1);
  if (!Number.isFinite(volume) || volume < 0 || volume > 2)
    return reply.code(400).send({ error: "音量必须在 0 到 2.0 之间" });
  const format = input.format || "mp3";
  try {
    const result = await provider.synthesize({
      text,
      voiceId,
      speed,
      pitch,
      volume,
      format,
      language,
      emotion: String(input.emotion || ""),
    });
    if (input.preview)
      return reply
        .type(result.mimeType)
        .header("cache-control", "no-store")
        .send(result.bytes);
    if (result.bytes.length > 100 * 1024 * 1024)
      return reply.code(413).send({ error: "生成音频超过 100MB" });
    const assetId = randomUUID(), storageName = `${assetId}.bin`, now = new Date().toISOString();
    const extension = result.mimeType === "audio/mpeg" ? "mp3" : format === "aac" ? "aac" : format;
    const name = `AI 语音-${new Date().toLocaleString("zh-CN").replace(/[/:]/g, "-")}.${extension}`;
    writeFileSync(`${uploadDirectory}/${storageName}`, result.bytes);
    database.run(
      "INSERT INTO assets (id, project_id, user_id, name, mime_type, size, storage_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [assetId, projectId, userId, name, result.mimeType, result.bytes.length, storageName, now],
    );
    persist();
    return {
      provider: provider.id,
      voiceId,
      duration: result.duration,
      mimeType: result.mimeType,
      assetId,
      assetUrl: namedAssetUrl(assetId, name),
    };
  } catch (error) {
    request.log.error({ error, provider: provider.id }, "tts synthesis failed");
    return reply.code(502).send({
      error: error instanceof Error ? error.message : "语音生成失败",
    });
  }
});
app.post("/agents/prompt", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const input = request.body as {
      idea?: string;
      kind?: string;
      promptMode?: string;
      complexity?: string;
      context?: string[];
      visuals?: string[];
      model?: string;
      target?: {
        id?: number;
        kind?: string;
        role?: string;
        hasMedia?: boolean;
        hasPrompt?: boolean;
      } | null;
    },
    idea = String(input.idea ?? "").trim(),
    kind = input.kind === "video" ? "video" : "image",
    promptMode = ["general", "agnes", "voice"].includes(String(input.promptMode))
      ? String(input.promptMode)
      : "create",
    complexity = input.complexity === "detailed" ? "detailed" : "simple",
    context = (input.context ?? [])
      .map((item) => String(item).trim())
      .filter(Boolean)
      .slice(0, 8);
  if (!idea || idea.length > 4000)
    return reply.code(400).send({ error: "请输入 1–4000 字的创作想法" });
  const baseUrl = String(
      process.env.PROMPT_AGENT_BASE_URL ||
        process.env.OPENAI_IMAGE_BASE_URL ||
        "",
    ).replace(/\/$/, ""),
    apiKey = String(
      process.env.PROMPT_AGENT_API_KEY ||
        process.env.OPENAI_IMAGE_API_KEY ||
        "",
    ),
    allowedModels = ["gpt-5.5", "kimi-k2.5", "gpt-5.4-mini"],
    requestedModel = String(
      input.model || process.env.PROMPT_AGENT_MODEL || "gpt-5.5",
    ),
    model = allowedModels.includes(requestedModel) ? requestedModel : "gpt-5.5";
  if (!baseUrl || !apiKey)
    return reply.code(503).send({ error: "提示词 Agent 接口尚未配置" });
  const detailRule =
    complexity === "simple"
      ? `finalPrompt 控制在${kind === "video" ? "180" : "120"}个中文字符以内，只保留主体、场景、关键动作或构图与一种主要风格，避免堆砌。`
      : `详细模式通过拆分更多必要步骤、分镜和依赖关系表达复杂度，不要增加单个图片步骤的提示词长度；另可返回 subject、scene、composition、lighting、style、motion、negativePrompt 字符串字段。`;
  const creativeSystem = `你是 Viora 无限画布中的创作 Agent。理解用户需求、当前节点和上游视觉素材，规划可实际执行的完整工作流并生成底层提示词。只返回合法完整 JSON，不要 Markdown或解释。必须包含 finalPrompt、action、targetType、summary、shouldGenerate、steps。steps 是按执行顺序排列的数组，每项必须为 {"title":"简短名称","kind":"image或video","prompt":"该节点独立使用的完整提示词","referenceIndexes":[1],"dependsOn":[1]}。所有 kind=image 的步骤默认使用 gpt-image-2，每条 prompt 必须控制在 140 个中文字符以内，只保留主体/参考素材对应关系、关键修改、场景构图和一种主要风格；禁止堆砌形容词、镜头参数、材质清单和重复约束。图片需求复杂时拆为多个具有明确职责的 image 步骤，不得写成一条超长提示词。referenceIndexes 使用用户附带视觉参考的 1 开始编号；dependsOn 使用 steps 的 1 开始编号，只能引用当前步骤之前的步骤。复杂视频必须采用分层生产链：先按需要生成可复用的人物、产品和环境设定图；再为每个镜头创建独立的最终分镜 image 步骤，通过 dependsOn 组合该镜头所需的设定素材；最后每个 video 步骤只依赖自己对应的最终分镜图，不要再次直接依赖已经被该分镜使用的人物或场景祖先素材。每个含人物或产品的 video 提示词都要明确要求严格保持输入分镜中的身份、脸型、发型、服装、产品外形和配色，禁止换脸、改变年龄性别、重设计服装或产品；只描述必要动作、环境运动和镜头运动。若最终视频需要先创造场景、人物或分镜参考图，必须先规划 image 步骤，再让 video 步骤通过 dependsOn 引用对应图片步骤。不同镜头需要不同场景时分别生成并正确复用；需要保持角色、产品或美术一致性时复用统一设定图。最终交付物必须出现在 steps 中：用户要视频时不能只返回准备图片，必须包含至少一个 video 步骤；用户明确不要视频时禁止添加 video。若用户已有合适图片，应优先直接引用素材，不重复生成。需要多个方案、场景或分镜时拆成多个步骤，每个视频镜头独立一个 video 步骤，最多 16 步。用户明确指定数量时必须准确提供相应数量的最终交付步骤；若还需要角色设定等中间步骤，应在 16 步内一并规划。禁止循环依赖，video 步骤通常作为末端。需求非常模糊且未指定媒体类型时，采用最小可行方案，只创建一个 image 步骤，不擅自扩展视频。action 只能是 update_current、create_child、create_new；targetType 只能是 image、video；summary 用一句简短中文说明完整执行链。没有当前节点时 create_new；有素材并继续创作时 create_child。用户点击开始创作即视为授权执行，shouldGenerate 默认 true，除非用户明确只要求规划或提示词。${detailRule} 当前节点信息：${JSON.stringify(input.target ?? null)}。不要声称媒体已经生成。`;
  const generalPromptSystem = `你是专业 AI 视觉提示词工程师。根据用户的中文画面需求、当前节点上下文和视觉参考，只生成一条可直接使用的${kind === "video" ? "视频" : "图片"}提示词，不创建工作流，不规划节点，不扩写用户未提供的剧情。保持已有角色、服装、道具、场景和风格一致。只返回合法 JSON：{"finalPrompt":"最终提示词","summary":"通用提示词已生成"}。finalPrompt 使用清晰自然的中文，控制在 ${kind === "video" ? 280 : 180} 字以内。`;
  const agnesPromptSystem = `你是专业动画导演和 Agnes Video v2.0 Prompt 工程师。把用户提供的中文剧情分镜转换成连续动漫视频的英文 Prompt，像动画分镜脚本而不是小说。不得扩写剧情、创造角色、改变设定、增加对白或把多个复杂事件塞入同一镜头。只返回合法 JSON：{"finalPrompt":"完整 Agnes Prompt","summary":"Agnes Video v2.0 提示词已生成"}，不要返回 steps 或解释。finalPrompt 必须严格按以下带英文冒号的标题顺序输出：Style:, Language:, Continuity:, Scene:, Camera:, Action:, Effects:, Audio:, Dialogue:, Voice:, Background:, Constraints:。每个一级标题必须独占一行、只出现一次，正文从下一行开始；多个动作放在同一个 Action: 区块中，每个动作单独一行，绝不能重复输出 Action: 标题。Style 固定为 Anime, cinematic.；Language 固定为 Chinese.。Continuity 说明 Continue seamlessly from the previous shot，并锁定人物身份、服装、发型、建筑、场景与光照，禁止重新设计；同一场景增加 Environment Lock: Keep the same background environment and spatial layout. Do not move, rebuild, or redesign architecture. Scene 只描述当前画面的环境与主体。Camera 只能使用 Wide shot, Medium shot, Medium close-up, Close-up, Slow dolly in, Slow dolly out, Slow pan, Tracking shot, Aerial shot, Reframe toward character 等明确电影语言，禁止抽象镜头描述。输入中的“顺视线切到”必须翻译成 Slow pan 或 Reframe toward character，绝不能在 Camera 或 Action 中出现 follows the line of sight、camera sees、feels closer 等抽象措辞。Action 一句话一个可见动作，不写心理，不增加输入中没有的动作。Effects 只写可见光效、能量、UI、天气或粒子。Audio 中旁白必须写 Narration: "中文旁白"，系统声音必须写 System Announcement: "中文系统声音"，不得放入 Dialogue。Dialogue 只放真实人物台词，格式 Character Name: "中文台词"；已有角色必须始终使用角色名，禁止用 boy、teenager、young man 等模糊称呼替代。一个镜头最多一个主要说话角色。人物讲话时加入 Only the speaking character moves their lips. Everyone else keeps their mouths closed.；无人镜头不得生成 lip sync。Voice 写年龄、性别、音色、情绪、语速和说话方式。Background 写环境声音。Constraints 每次原样包含：No subtitles. No captions. No dialogue text. No narration text. No automatic transcription. No speech bubbles. No text overlays. No logos. No watermarks. Only animate the specified actions. Do not redesign characters. Do not change clothing. Do not change hairstyle. Do not change environment. No extra movement. No idle animation. No unnecessary camera movement. 最终 Prompt 除中文台词、中文旁白和中文系统播报外，其余全部使用英文。`;
  const voicePromptSystem = `你是中文角色选角与声音设计助手。根据用户描述，从固定 EasyVoice 中文音色中选择最匹配的一项，并同时设计音量、音调和语速，尽可能还原用户要求。只返回合法 JSON，不要解释：{"finalPrompt":"一句简洁的中文声音说明，明确所选音色及参数为何符合需求","summary":"已为角色生成音色配置","voiceConfig":{"roleName":"角色名，未提供则写新角色","voiceId":"必须从允许值中选择","tone":"不超过20字的声音气质","speed":1.0,"pitch":0,"volume":1.0}}。允许的 voiceId：zh-CN-XiaoxiaoNeural（温暖女声）、zh-CN-XiaoyiNeural（活泼女声）、zh-CN-YunjianNeural（激昂男声）、zh-CN-YunxiNeural（阳光男声）、zh-CN-YunxiaNeural（少年男声）、zh-CN-YunyangNeural（稳重男声）、zh-CN-liaoning-XiaobeiNeural（辽宁女声）、zh-CN-shaanxi-XiaoniNeural（陕西女声）。必须综合判断年龄、性别、地域口音、音色明暗、厚薄、情绪强度和说话节奏，而非只匹配单个关键词。低沉、成熟、威严通常降低 pitch；清亮、稚嫩可提高 pitch；舒缓、沉稳降低 speed；急促、活泼提高 speed；轻声降低 volume；洪亮、有力提高 volume。speed 范围 0.5–2，通常保持 0.85–1.15；pitch 范围 -50–50，通常保持 -8–8；volume 范围 0–2，通常保持 0.8–1.2。用户明确给出参数时优先采用并限制在合法范围；要求超出可用音色能力时选择整体最接近的一项，不得虚构 voiceId 或角色背景。`;
  const system = promptMode === "agnes" ? agnesPromptSystem : promptMode === "general" ? generalPromptSystem : promptMode === "voice" ? voicePromptSystem : creativeSystem;
  const visualSources = (input.visuals ?? [])
    .map(String)
    .filter((source) => /^\/api\/assets\/[^/]+\/content(?:\/|$)/.test(source))
    .slice(0, 8);
  let visualInputs: string[] = [];
  try {
    validateOwnedInputUrls(visualSources, String(user.id), "image");
    visualInputs = resolveOwnedInputUrls(
      visualSources,
      String(user.id),
      "image",
      model,
    );
  } catch {
    return reply.code(400).send({ error: "Agent 无法读取所选参考图片" });
  }
  const textContent = [
    `用户想法：${idea}`,
    context.length
      ? `画布上下文：\n${context.map((item, index) => `${index + 1}. ${item}`).join("\n")}`
      : "画布上下文：无",
    visualInputs.length
      ? `附带 ${visualInputs.length} 张视觉参考，顺序与参考节点中的图片顺序一致。请理解图片内容后再生成提示词。`
      : "没有视觉参考。",
  ].join("\n\n");
  const content: unknown = visualInputs.length
    ? [
        { type: "text", text: textContent },
        ...visualInputs.map((url) => ({
          type: "image_url",
          image_url: { url },
        })),
      ]
    : textContent;
  const clientAbort = new AbortController();
  request.raw.once("aborted", () => clientAbort.abort());
  reply.raw.once("close", () => {
    if (!reply.raw.writableEnded) clientAbort.abort();
  });
  try {
    const url = `${baseUrl}/v1/chat/completions`;
    const proxyUrl = String(
      process.env.PROMPT_AGENT_HTTPS_PROXY ||
        process.env.OPENAI_IMAGE_HTTPS_PROXY ||
        "",
    );
    let result: Record<string, unknown> | undefined,
      raw = "",
      finishReason = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      const options = {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          stream: false,
          temperature: complexity === "simple" ? 0.35 : 0.65,
          max_tokens: complexity === "simple" ? 4800 : 7000,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content },
          ],
        }),
        signal: AbortSignal.any([
          clientAbort.signal,
          AbortSignal.timeout(
            Number(process.env.PROMPT_AGENT_TIMEOUT_MS || 90000),
          ),
        ]),
      };
      const response = proxyUrl
        ? await undiciFetch(url, {
            ...options,
            dispatcher: new ProxyAgent(proxyUrl),
          })
        : await fetch(url, options);
      const payload = (await response.json()) as {
        choices?: Array<{
          finish_reason?: string;
          message?: { content?: string };
        }>;
        error?: { message?: string };
      };
      if (!response.ok) {
        if (
          attempt < 2 &&
          (response.status === 429 || response.status >= 500)
        ) {
          request.log.warn(
            { attempt, status: response.status },
            "prompt agent upstream retry",
          );
          continue;
        }
        return reply
          .code(response.status)
          .send({
            error:
              payload.error?.message || `Agent 接口返回 ${response.status}`,
          });
      }
      raw = String(payload.choices?.[0]?.message?.content || "")
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();
      finishReason = String(payload.choices?.[0]?.finish_reason || "");
      try {
        const parsed = parsePromptAgentResult(raw);
        if (!String(parsed.finalPrompt ?? "").trim())
          throw new SyntaxError("Agent missing finalPrompt");
        if (promptMode === "agnes") {
          const normalized = normalizeAgnesPrompt(String(parsed.finalPrompt));
          const validationError = validateAgnesPrompt(normalized);
          if (validationError) throw new SyntaxError(validationError);
          parsed.finalPrompt = normalized;
        }
        result = parsed;
        break;
      } catch (error) {
        if (attempt >= 2) throw error;
        request.log.warn(
          { attempt, finishReason, responseLength: raw.length },
          "prompt agent malformed response retry",
        );
      }
    }
    if (!result) throw new SyntaxError("Agent returned no valid plan");
    request.log.info(
      { model, complexity, finishReason, responseLength: raw.length },
      "prompt agent response received",
    );
    const field = (name: string) => String(result[name] ?? "").trim();
    const rawFinalPrompt = field("finalPrompt");
    if (!rawFinalPrompt) throw new Error("Agent 未返回 finalPrompt");
    if (promptMode !== "create") {
      const voiceConfig=promptMode==="voice"&&result.voiceConfig&&typeof result.voiceConfig==="object"?result.voiceConfig as Record<string,unknown>:undefined;
      const allowedVoiceIds=new Set(["zh-CN-XiaoxiaoNeural","zh-CN-XiaoyiNeural","zh-CN-YunjianNeural","zh-CN-YunxiNeural","zh-CN-YunxiaNeural","zh-CN-YunyangNeural","zh-CN-liaoning-XiaobeiNeural","zh-CN-shaanxi-XiaoniNeural"]);
      return {
        model,
        kind,
        action: "create_new",
        targetType: kind,
        summary:
          field("summary") ||
          (promptMode === "agnes"
            ? "Agnes Video v2.0 提示词已生成"
            : "通用提示词已生成"),
        shouldGenerate: false,
        steps: [],
        finalPrompt: rawFinalPrompt,
        promptMode,
        ...(voiceConfig?{voiceConfig:{roleName:String(voiceConfig.roleName||"新角色").slice(0,40),voiceId:allowedVoiceIds.has(String(voiceConfig.voiceId))?String(voiceConfig.voiceId):"zh-CN-XiaoxiaoNeural",tone:String(voiceConfig.tone||"自然").slice(0,40),speed:Math.max(.5,Math.min(2,Number(voiceConfig.speed)||1)),pitch:Math.max(-50,Math.min(50,Number(voiceConfig.pitch)||0)),volume:Math.max(0,Math.min(2,Number(voiceConfig.volume)||1))}}:{}),
      };
    }
    const action = ["update_current", "create_child", "create_new"].includes(
        field("action"),
      )
        ? field("action")
        : "create_child",
      targetType =
        field("targetType") === "video"
          ? "video"
          : field("targetType") === "image"
            ? "image"
            : kind;
    const finalPrompt =
      targetType === "image"
        ? compactImagePrompt(rawFinalPrompt)
        : rawFinalPrompt;
    const rawSteps = Array.isArray(result.steps) ? result.steps : [];
    let steps = rawSteps
      .slice(0, 16)
      .map((item, index) => {
        const step =
          item && typeof item === "object"
            ? (item as Record<string, unknown>)
            : {};
        const stepKind = step.kind === "video" ? "video" : "image";
        const rawPrompt = String(step.prompt || "").trim();
        return {
          title: String(step.title || "").trim(),
          kind: stepKind,
          prompt:
            stepKind === "image" ? compactImagePrompt(rawPrompt) : rawPrompt,
          referenceIndexes: Array.isArray(step.referenceIndexes)
            ? [
                ...new Set(
                  step.referenceIndexes
                    .map(Number)
                    .filter(
                      (value) =>
                        Number.isInteger(value) &&
                        value >= 1 &&
                        value <= visualInputs.length,
                    ),
                ),
              ]
            : [],
          dependsOn: Array.isArray(step.dependsOn)
            ? [
                ...new Set(
                  step.dependsOn
                    .map(Number)
                    .filter(
                      (value) =>
                        Number.isInteger(value) && value >= 1 && value <= index,
                    ),
                ),
              ]
            : [],
        };
      })
      .filter((step) => step.prompt);
    const explicitlyNoVideo =
      /(?:不要|无需|不需要|禁止)(?:生成|制作)?视频|只(?:要|生成).{0,8}(?:图片|海报|封面)/.test(
        idea,
      );
    let forcedFinalVideo = false;
    if (
      kind === "video" &&
      !explicitlyNoVideo &&
      !steps.some((step) => step.kind === "video")
    ) {
      forcedFinalVideo = true;
      steps = steps.slice(0, 15);
      const imageDependencies = steps
        .map((step, index) => (step.kind === "image" ? index + 1 : 0))
        .filter(Boolean);
      steps.push({
        title: "最终视频",
        kind: "video",
        prompt: `根据前置关键视觉素材制作完整视频：${idea}`.slice(0, 500),
        referenceIndexes: visualInputs.map((_, index) => index + 1),
        dependsOn: imageDependencies,
      });
    }
    const isAncestor = (
      candidate: number,
      stepNumber: number,
      seen = new Set<number>(),
    ): boolean => {
      if (seen.has(stepNumber)) return false;
      seen.add(stepNumber);
      const parent = steps[stepNumber - 1];
      return Boolean(
        parent?.dependsOn.some(
          (dependency) =>
            dependency === candidate || isAncestor(candidate, dependency, seen),
        ),
      );
    };
    steps = steps.map((step) =>
      step.kind !== "video"
        ? step
        : {
            ...step,
            dependsOn: step.dependsOn.filter(
              (candidate) =>
                !step.dependsOn.some(
                  (other) =>
                    other !== candidate && isAncestor(candidate, other),
                ),
            ),
          },
    );
    return {
      model,
      kind: targetType,
      action,
      targetType,
      summary: forcedFinalVideo
        ? "先生成所需关键视觉图，再基于这些素材制作最终视频。"
        : field("summary") ||
          `已准备${targetType === "video" ? "视频" : "图像"}创作节点`,
      shouldGenerate: result.shouldGenerate !== false,
      steps: steps.length
        ? steps
        : [
            {
              title: "创作任务",
              kind: targetType,
              prompt: finalPrompt,
              referenceIndexes: visualInputs.map((_, index) => index + 1),
              dependsOn: [],
            },
          ],
      subject: field("subject"),
      scene: field("scene"),
      composition: field("composition"),
      lighting: field("lighting"),
      style: field("style"),
      motion: field("motion"),
      negativePrompt: field("negativePrompt"),
      finalPrompt,
    };
  } catch (error) {
    if (clientAbort.signal.aborted) return;
    request.log.error(
      { message: error instanceof Error ? error.message : String(error) },
      "prompt agent failed",
    );
    return reply
      .code(502)
      .send({
        error:
          error instanceof SyntaxError
            ? "Agent 返回内容不完整，请重新生成一次"
            : error instanceof Error
              ? error.message
              : "提示词生成失败",
      });
  }
});
app.post("/agents/comic/chat", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const input = request.body as {
      projectId?: string;
      sessionId?: string;
      message?: string;
      context?: string[];
      plan?: unknown;
      model?: string;
    },
    userId = String(user.id),
    projectId = String(input.projectId || ""),
    requestedSessionId = String(input.sessionId || ""),
    message = String(input.message || "").trim();
  if (!projectId || !ownsProject(projectId, userId))
    return reply.code(404).send({ error: "当前项目不存在" });
  if (activeComicPlans.has(`${userId}:${projectId}`))
    return reply
      .code(409)
      .send({ error: "完整剧本正在生成，请完成后再继续对话" });
  const chatLockKey = `${userId}:${projectId}`;
  if (activeComicChats.has(chatLockKey))
    return reply.code(409).send({ error: "另一台设备正在处理本项目的漫剧对话，请稍候" });
  if (message.length < 1 || message.length > 12000)
    return reply.code(400).send({ error: "每次对话需要 1–12000 个字符" });
  let session = requestedSessionId
    ? getOne(
        "SELECT id,phase,brief,messages,pending_revision AS pendingRevision,plan FROM comic_sessions WHERE id=? AND user_id=? AND project_id=?",
        [requestedSessionId, userId, projectId],
      )
    : undefined;
  if (requestedSessionId && !session)
    return reply.code(404).send({ error: "漫剧会话不存在或不属于当前项目" });
  const now = new Date().toISOString(),
    sessionId = session ? String(session.id) : randomUUID();
  if (!session) {
    const initialPlan =
      input.plan && typeof input.plan === "object"
        ? JSON.stringify(input.plan)
        : null;
    database.run(
      "INSERT INTO comic_sessions (id,user_id,project_id,phase,brief,messages,pending_revision,plan,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [
        sessionId,
        userId,
        projectId,
        initialPlan ? "generated" : "discussing",
        "{}",
        "[]",
        "",
        initialPlan,
        now,
        now,
      ],
    );
    session = {
      id: sessionId,
      phase: initialPlan ? "generated" : "discussing",
      brief: "{}",
      messages: "[]",
      pendingRevision: "",
      plan: initialPlan,
    };
  }
  const baseUrl = String(
      process.env.PROMPT_AGENT_BASE_URL ||
        process.env.OPENAI_IMAGE_BASE_URL ||
        "",
    ).replace(/\/$/, ""),
    apiKey = String(
      process.env.PROMPT_AGENT_API_KEY ||
        process.env.OPENAI_IMAGE_API_KEY ||
        "",
    ),
    model = String(input.model || process.env.PROMPT_AGENT_MODEL || "gpt-5.5");
  if (!baseUrl || !apiKey)
    return reply.code(503).send({ error: "灵感 Agent 接口尚未配置" });
  activeComicChats.add(chatLockKey);
  let history: Array<{ role: "user" | "assistant"; content: string }> = [];
  try {
    const parsed = JSON.parse(String(session.messages || "[]"));
    if (Array.isArray(parsed))
      history = parsed
        .filter(
          (item) =>
            item &&
            ["user", "assistant"].includes(item.role) &&
            typeof item.content === "string",
        )
        .slice(-16);
      // The brief is the durable source of truth. Keep recent conversational
      // wording for tone and local context, but cap its total size so several
      // pasted scripts cannot make every later turn progressively slower.
      while (
        history.length > 2 &&
        history.reduce((total, item) => total + item.content.length, 0) > 24000
      )
        history.shift();
  } catch {
    /* 从空历史继续 */
  }
  let brief: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(String(session.brief || "{}"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      brief = parsed;
  } catch {
    /* 由本轮重新整理 */
  }
  const hasPlan = Boolean(session.plan),
    context = (input.context ?? []).map(String).filter(Boolean).slice(0, 8),
    system = `你是 Viora 的漫剧创作导演，现在只与用户讨论、澄清和收敛需求，绝对不要生成完整剧本、人物设定、镜头表或分镜提示词。每轮自然回应，并且最多追问 1–2 个真正影响创作的问题；用户信息已经足够时，不必为了提问而提问。持续维护创作简报。${hasPlan ? "已有正式方案，本轮只整理用户希望修改的内容，未确认前不得改写正式方案。" : "尚未生成正式方案，帮助用户明确故事方向。"}只返回合法 JSON：{"reply":"给用户的简洁自然回复","ready":true,"brief":{"title":"不超过18字的作品暂定标题","premise":"核心创意与故事简介","genre":"类型与基调","audience":"受众","duration":"预计总时长，例如约60秒或约3分钟","aspectRatio":"画幅，默认16:9","visualStyle":"视觉风格","characters":"核心人物与关系","conflict":"核心冲突","ending":"结局方向","dialogue":"对白旁白偏好","constraints":["明确不要的作品内容"],"confirmed":["已确认要点"],"openQuestions":["最多两个待确认问题"]},"pendingRevision":"已有正式方案时，累计整理待应用的修改；没有正式方案时为空字符串"}。title 必须是简短作品名，premise 才是完整简介，禁止把整段简介放进 title。用户没有明确指定画幅时，aspectRatio 始终填写 16:9。故事梗概、人物和冲突已经足够判断制作规模后，必须按合理的镜头密度主动估算 duration；duration 仍为空时不得返回 ready=true。ready 表示信息已经足以让用户点击确认生成，不代表你可以自行生成。必须继承旧简报中未被本轮推翻的内容。“先讨论、暂不生成、确认后再生成”等只描述当前交互阶段，绝不能写进作品 constraints。`;
  const userContent = [
    `当前简报：${JSON.stringify(brief)}`,
    hasPlan
      ? `已有正式方案摘要：${String(session.plan).slice(0, 6000)}`
      : "尚无正式方案",
    String(session.pendingRevision || "").trim()
      ? `尚未应用的修改：${String(session.pendingRevision)}`
      : "",
    context.length ? `当前参考素材：${context.join("\n")}` : "",
    `用户本轮消息：${message}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const streamedReply = (raw: string) => {
    const marker = /"reply"\s*:\s*"/.exec(raw);
    if (!marker) return "";
    let output = "";
    for (
      let index = marker.index + marker[0].length;
      index < raw.length;
      index++
    ) {
      const char = raw[index];
      if (char === '"') break;
      if (char !== "\\") {
        output += char;
        continue;
      }
      const escaped = raw[++index];
      if (escaped === undefined) break;
      if (escaped === "u") {
        const code = raw.slice(index + 1, index + 5);
        if (!/^[0-9a-f]{4}$/i.test(code)) break;
        output += String.fromCharCode(Number.parseInt(code, 16));
        index += 4;
      } else
        output +=
          (
            {
              n: "\n",
              r: "\r",
              t: "\t",
              b: "\b",
              f: "\f",
              '"': '"',
              "\\": "\\",
              "/": "/",
            } as Record<string, string>
          )[escaped] ?? escaped;
    }
    return output.slice(0, 1200);
  };
  reply.hijack();
  reply.raw.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    "x-accel-buffering": "no",
    connection: "keep-alive",
  });
  const emit = (value: unknown) => {
    if (!reply.raw.destroyed) reply.raw.write(`${JSON.stringify(value)}\n`);
  };
  emit({
    type: "start",
    sessionId,
    phase: hasPlan ? "revising" : "discussing",
  });
  const heartbeat = setInterval(
    () => emit({ type: "heartbeat", at: Date.now() }),
    8000,
  );
  try {
    const proxyUrl = String(
        process.env.PROMPT_AGENT_HTTPS_PROXY ||
          process.env.OPENAI_IMAGE_HTTPS_PROXY ||
          "",
      ),
      candidateModels = [
        model,
        ...(model === "gpt-5.4-mini" ? [] : ["gpt-5.4-mini"]),
      ];
    let parsed:
        | {
            reply?: string;
            ready?: boolean;
            brief?: Record<string, unknown>;
            pendingRevision?: string;
          }
        | undefined,
      lastError = "";
    for (const [attempt, usedModel] of candidateModels.entries()) {
      if (attempt)
        emit({ type: "retry", message: "主模型响应较慢，正在切换备用线路…" });
      emit({ type: "model", model: usedModel });
      const controller = new AbortController(),
        timeoutMs = attempt ? 45000 : 65000,
        timer = setTimeout(
          () =>
            controller.abort(
              new DOMException("漫剧对话响应超时", "TimeoutError"),
            ),
          timeoutMs,
        ),
        options = {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: usedModel,
            stream: true,
            stream_options: { include_usage: false },
            temperature: 0.35,
            max_tokens: 1800,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: system },
              ...history,
              { role: "user", content: userContent },
            ],
          }),
          signal: controller.signal,
        };
      try {
        const response = proxyUrl
          ? await undiciFetch(`${baseUrl}/v1/chat/completions`, {
              ...options,
              dispatcher: new ProxyAgent(proxyUrl),
            })
          : await fetch(`${baseUrl}/v1/chat/completions`, options);
        if (!response.ok)
          throw new Error(
            `upstream ${response.status}: ${(await response.text()).slice(0, 180)}`,
          );
        if (!response.body) throw new Error("漫剧对话没有响应流");
        const reader = (
            response.body as ReadableStream<Uint8Array>
          ).getReader(),
          decoder = new TextDecoder();
        let buffer = "",
          raw = "",
          lastReply = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || "";
          for (const line of lines) {
            const data = line.startsWith("data:") ? line.slice(5).trim() : "";
            if (!data || data === "[DONE]") continue;
            const packet = JSON.parse(data) as {
                choices?: Array<{ delta?: { content?: string } }>;
              },
              delta = String(packet.choices?.[0]?.delta?.content || "");
            if (!delta) continue;
            raw += delta;
            const nextReply = streamedReply(raw);
            if (nextReply !== lastReply) {
              lastReply = nextReply;
              emit({ type: "delta", text: nextReply });
            }
          }
        }
        const extracted = parseFirstJsonObject(raw, "漫剧对话");
        if (extracted.trailingLength)
          request.log.warn(
            { projectId, sessionId, trailingLength: extracted.trailingLength },
            "comic dialogue ignored trailing model output",
          );
        parsed = extracted.value as typeof parsed;
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        request.log.warn(
          {
            userId,
            projectId,
            sessionId,
            attempt: attempt + 1,
            model: usedModel,
            message: lastError,
          },
          "comic dialogue upstream retry",
        );
        emit({ type: "reset" });
      } finally {
        clearTimeout(timer);
      }
    }
    if (!parsed) throw new Error(lastError || "漫剧对话未返回有效内容");
    const assistantReply = String(
        parsed.reply ||
          "我已经记下了。你可以继续补充，确认后我再生成完整方案。",
      ).slice(0, 1200),
      nextBrief =
        parsed.brief && typeof parsed.brief === "object" ? parsed.brief : brief,
      pendingRevision = hasPlan
        ? String(parsed.pendingRevision || session.pendingRevision || "").slice(
            0,
            5000,
          )
        : "";
    if (!String(nextBrief.aspectRatio || "").trim())
      nextBrief.aspectRatio = "16:9";
    const ready = Boolean(
      parsed.ready && String(nextBrief.duration || "").trim(),
    );
    history.push(
      { role: "user", content: message },
      { role: "assistant", content: assistantReply },
    );
    history = history.slice(-18);
    while (
      history.length > 2 &&
      history.reduce((total, item) => total + item.content.length, 0) > 24000
    )
      history.shift();
    const phase = hasPlan ? "revising" : ready ? "ready" : "discussing";
    database.run(
      "UPDATE comic_sessions SET phase=?,brief=?,messages=?,pending_revision=?,updated_at=? WHERE id=? AND user_id=? AND project_id=?",
      [
        phase,
        JSON.stringify(nextBrief),
        JSON.stringify(history),
        pendingRevision,
        new Date().toISOString(),
        sessionId,
        userId,
        projectId,
      ],
    );
    persist();
    emit({
      type: "result",
      sessionId,
      phase,
      reply: assistantReply,
      ready,
      brief: nextBrief,
      pendingRevision,
      hasPlan,
    });
    clearInterval(heartbeat);
    activeComicChats.delete(chatLockKey);
    reply.raw.end();
  } catch (error) {
    clearInterval(heartbeat);
    activeComicChats.delete(chatLockKey);
    request.log.error(
      {
        userId,
        projectId,
        sessionId,
        message: error instanceof Error ? error.message : String(error),
      },
      "comic dialogue failed",
    );
    emit({ type: "error", error: "漫剧对话暂时没有响应，请稍后重试" });
    reply.raw.end();
  }
});

app.post("/agents/comic", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const input = request.body as {
    projectId?: string;
    sessionId?: string;
    idea?: string;
    duration?: string;
    aspectRatio?: string;
    context?: string[];
    visuals?: string[];
    previousPlan?: unknown;
    revision?: string;
    model?: string;
  };
  const projectId = String(input.projectId || ""),
    sessionId = String(input.sessionId || ""),
    comicSession = sessionId
      ? getOne(
          "SELECT id,brief,pending_revision AS pendingRevision,plan,generation_checkpoint AS generationCheckpoint FROM comic_sessions WHERE id=? AND user_id=? AND project_id=?",
          [sessionId, String(user.id), projectId],
        )
      : undefined;
  if (!projectId || !ownsProject(projectId, String(user.id)))
    return reply.code(404).send({ error: "当前漫剧项目不存在" });
  if (!comicSession)
    return reply.code(404).send({ error: "漫剧会话已失效，请新建会话后重试" });
  const idea = String(input.idea ?? "").trim(),
    revision = String(input.revision ?? "").trim(),
    duration = String(input.duration || "由对话内容推断").slice(0, 30),
    aspectRatio = ["9:16", "16:9", "1:1"].includes(String(input.aspectRatio))
      ? String(input.aspectRatio)
      : "由对话内容推断";
  if (!idea && !input.previousPlan)
    return reply.code(400).send({ error: "请先描述你想创作的漫剧" });
  if (idea.length > 12000 || revision.length > 6000)
    return reply.code(400).send({ error: "本次提交内容异常过长，请重新打开漫剧窗口后重试" });
  const baseUrl = String(
      process.env.PROMPT_AGENT_BASE_URL ||
        process.env.OPENAI_IMAGE_BASE_URL ||
        "",
    ).replace(/\/$/, ""),
    apiKey = String(
      process.env.PROMPT_AGENT_API_KEY ||
        process.env.OPENAI_IMAGE_API_KEY ||
        "",
    ),
    model = String(input.model || process.env.PROMPT_AGENT_MODEL || "gpt-5.5");
  if (!baseUrl || !apiKey)
    return reply.code(503).send({ error: "灵感 Agent 接口尚未配置" });
  const visualSources = (input.visuals ?? [])
    .map(String)
    .filter((source) => /^\/api\/assets\/[^/]+\/content(?:\/|$)/.test(source))
    .slice(0, 8);
  let visualInputs: string[] = [];
  try {
    validateOwnedInputUrls(visualSources, String(user.id), "image");
    visualInputs = resolveOwnedInputUrls(
      visualSources,
      String(user.id),
      "image",
      model,
    );
  } catch {
    return reply.code(400).send({ error: "Agent 无法读取所选参考素材" });
  }
  let storedBrief = String(comicSession.brief || "{}"), confirmedBriefTitle = "";
  try {
    const value = JSON.parse(storedBrief) as { constraints?: unknown };
    confirmedBriefTitle = String((value as Record<string, unknown>).title || "").trim().slice(0, 100);
    if (Array.isArray(value.constraints))
      value.constraints = value.constraints.filter(
        (item) =>
          !/(?:暂不|不要|别|先不).{0,8}生成(?:完整)?(?:剧本|方案)/.test(
            String(item),
          ),
      );
    storedBrief = JSON.stringify(value);
  } catch {
    /* 沿用原始简报 */
  }
  const storedPlan = String(comicSession.plan || ""),
    previous = storedPlan || (input.previousPlan && typeof input.previousPlan === "object" ? JSON.stringify(input.previousPlan) : "");
  const context = (input.context ?? []).map(String).filter(Boolean).slice(0, 8);
  const effectiveRevision =
      String(comicSession.pendingRevision || "").trim() || revision,
    text = [
      `已确认创作简报：${storedBrief}`,
      `创作想法：${idea || "沿用创作简报"}`,
      `目标：${duration}，${aspectRatio}`,
      context.length
        ? `所选素材：\n${context.map((item, index) => `${index + 1}. ${item}`).join("\n")}`
        : "没有选择素材",
      previous ? `上一版方案：${previous}` : "",
      effectiveRevision
        ? `用户确认应用的修改：${effectiveRevision}`
        : "用户已确认，请生成第一版完整方案",
    ]
      .filter(Boolean)
      .join("\n\n");
  const content: unknown = visualInputs.length
    ? [
        { type: "text", text },
        ...visualInputs.map((url) => ({
          type: "image_url",
          image_url: { url },
        })),
      ]
    : text;
  const comicPipelineVersion = "compact-shot-plan-v4";
  const checkpointFingerprint = createHash("sha256")
    // Resolved visual inputs contain expiring signed URLs. Fingerprinting them
    // makes the same request look new on every retry and discards checkpoints.
    .update(
      JSON.stringify({ comicPipelineVersion, text, model, visualSources }),
    )
    .digest("hex");
  let checkpoint = restoreComicCheckpoint(comicSession.generationCheckpoint, checkpointFingerprint);
  const saveCheckpoint = (patch: Partial<ComicGenerationCheckpoint>) => {
    const checkpointUpdatedAt = new Date().toISOString();
    checkpoint = updateComicCheckpoint(checkpoint, patch, checkpointFingerprint, checkpointUpdatedAt);
    database.run(
      "UPDATE comic_sessions SET generation_checkpoint=?,updated_at=? WHERE id=? AND user_id=? AND project_id=?",
      [
        JSON.stringify(checkpoint),
        checkpointUpdatedAt,
        sessionId,
        String(user.id),
        projectId,
      ],
    );
    persist();
  };
  const comicLockKey = `${String(user.id)}:${projectId}`;
  if (activeComicPlans.has(comicLockKey))
    return reply
      .code(409)
      .send({ error: "当前项目已有完整剧本正在生成，请勿重复提交" });
  activeComicPlans.add(comicLockKey);
  database.run(
    "UPDATE comic_sessions SET generation_status='running',generation_stage=?,generation_progress=2,generation_received_bytes=0,generation_error='',generation_issues='[]',updated_at=? WHERE id=? AND user_id=? AND project_id=?",
    [
      revision ? "正在读取现有方案…" : "正在理解故事想法…",
      new Date().toISOString(),
      sessionId,
      String(user.id),
      projectId,
    ],
  );
  persist();
  const streamState = new ComicStreamState(model);
  let streamStarted = false,
    streamHeartbeat: ReturnType<typeof setInterval> | null = null,
    lastProgressPersistAt = 0,
    lastPersistedStage = "",
    lastPersistedProgress = -1;
  try {
    const proxyUrl = String(
      process.env.PROMPT_AGENT_HTTPS_PROXY ||
        process.env.OPENAI_IMAGE_HTTPS_PROXY ||
        "",
    );
    reply.hijack();
    streamStarted = true;
    streamState.touch();
    reply.raw.writeHead(200, {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    });
    const emit = (value: unknown) => {
      const event =
        value && typeof value === "object"
          ? (value as Record<string, unknown>)
          : {};
      if (event.type === "progress") {
        const stage = String(event.phase || ""),
          progress = Math.max(0, Math.min(99, Number(event.progress) || 0)),
          nowMs = Date.now(),
          shouldPersist =
            stage !== lastPersistedStage ||
            progress >= lastPersistedProgress + 2 ||
            nowMs - lastProgressPersistAt >= 2500;
        database.run(
          "UPDATE comic_sessions SET generation_status='running',generation_stage=?,generation_progress=?,generation_received_bytes=?,updated_at=? WHERE id=?",
          [
            stage,
            progress,
            Number(event.receivedBytes) || streamState.receivedBytes,
            new Date().toISOString(),
            sessionId,
          ],
        );
        if (shouldPersist) {
          persist();
          lastProgressPersistAt = nowMs;
          lastPersistedStage = stage;
          lastPersistedProgress = progress;
        }
      }
      if (!reply.raw.destroyed) reply.raw.write(`${JSON.stringify(value)}\n`);
    };
    emit({
      type: "start",
      message: revision ? "正在读取现有方案…" : "正在理解故事想法…",
    });
    streamHeartbeat = setInterval(() => {
      if (!reply.raw.destroyed)
        emit({
          type: "heartbeat",
          at: Date.now(),
          idleSeconds: streamState.idleSeconds(),
          receivedBytes: streamState.receivedBytes,
          progress: streamState.progress,
        });
    }, 10000);
    const candidateModels = [
        model,
        model,
        model,
        ...(model === "gpt-5.4-mini"
          ? []
          : ["gpt-5.4-mini", "gpt-5.4-mini"]),
      ],
      headerTimeout = Math.max(
        20000,
        Math.min(
          90000,
          Number(process.env.COMIC_AGENT_HEADER_TIMEOUT_MS || 45000),
        ),
      ),
      idleTimeout = Math.max(
        20000,
        Math.min(
          120000,
          Number(process.env.COMIC_AGENT_IDLE_TIMEOUT_MS || 60000),
        ),
      );
    const readStage = createComicStageReader({
      baseUrl, apiKey, model, proxyUrl, headerTimeout, idleTimeout,
      state: streamState, emit, log: request.log,
    });
    const rewriteUntilValid = async (
      stage: string,
      value: Record<string, unknown>,
      kind: "assets" | "scenes" | "shots",
      system: string,
      contextText: string,
      progress: number,
      maxTokens: number,
    ) => repairComicStageUntilValid({
      stage,
      value,
      kind,
      system,
      contextText,
      progress,
      maxTokens,
      readStage,
      emit: (update) => emit({ ...update, receivedBytes: streamState.receivedBytes }),
    });
    const storySystem = comicStoryPrompt();
    const story = checkpoint.story
      ? checkpoint.story
      : await readStage(
          "正在生成剧情大纲…",
          storySystem,
          content,
          2400,
          5,
          18,
        );
    if (
      !Array.isArray(story.outline) ||
      !story.outline.length ||
      !String(story.title || "").trim()
    )
      throw new SyntaxError("剧情大纲缺少标题或段落");
    if (!checkpoint.story) saveCheckpoint({ story });
    else
      emit({
        type: "progress",
        progress: 18,
        phase: "已恢复剧情大纲检查点",
        receivedBytes: streamState.receivedBytes,
        resumed: true,
      });
    emit({
      type: "progress",
      progress: 19,
      phase: "剧情大纲校验通过",
      receivedBytes: streamState.receivedBytes,
    });
    const assetSystem = comicAssetPrompt();
    const assetText = `已确认创作需求：\n${text}\n\n已校验剧情大纲：\n${JSON.stringify(story)}`;
    const sceneSystem = comicScenePrompt();
    const sceneViewSystem = comicSceneViewPrompt();
    let assets = checkpoint.assets
      ? checkpoint.assets
      : await readStage(
          "正在并行生成人物、道具与场景…",
          assetSystem,
          assetText,
          3800,
          20,
          34,
        );
    assets = await rewriteUntilValid(
      "人物与道具设定",
      assets,
      "assets",
      assetSystem,
      assetText,
      34,
      3800,
    );
    if (!Array.isArray(assets.characters) || !assets.characters.length)
      throw new SyntaxError("人物设定为空");
    if (!checkpoint.assets) saveCheckpoint({ assets });
    else
      emit({
        type: "progress",
        progress: 34,
        phase: "已恢复人物与道具检查点",
        receivedBytes: streamState.receivedBytes,
        resumed: true,
      });
    emit({
      type: "progress",
      progress: 35,
      phase: "人物与道具设定校验通过",
      receivedBytes: streamState.receivedBytes,
    });
    const sceneText = `已确认创作需求：\n${text}\n\n已校验剧情大纲：\n${JSON.stringify(story)}\n\n已校验关键道具索引（场景必须引用而不得重新设计）：\n${JSON.stringify((Array.isArray(assets.props) ? assets.props : []).map((raw, index) => { const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {}; return { index: index + 1, name: item.name, description: item.description }; }))}`;
    let sceneBible = checkpoint.sceneBible
      ? checkpoint.sceneBible
      : await readStage(
          "正在建立场景与固定道具依赖…",
          sceneViewSystem,
          sceneText,
          2600,
          36,
          48,
        );
    sceneBible = await rewriteUntilValid(
      "场景设定",
      sceneBible,
      "scenes",
      sceneViewSystem,
      sceneText,
      48,
      2600,
    );
    const availableProps = Array.isArray(assets.props) ? assets.props : [];
    sceneBible.scenes = (Array.isArray(sceneBible.scenes) ? sceneBible.scenes : []).map((raw, index) => {
      const scene = raw && typeof raw === "object" ? { ...(raw as Record<string, unknown>) } : {};
      const declared = Array.isArray(scene.propIndexes) ? scene.propIndexes.map(Number) : [];
      scene.propIndexes = [...new Set(declared.filter((value) => Number.isInteger(value) && value >= 1 && value <= availableProps.length))];
      scene.environmentAnchors = (Array.isArray(scene.environmentAnchors) ? scene.environmentAnchors : [])
        .map((value) => String(value || "").trim().slice(0, 80)).filter(Boolean).slice(0, 8);
      const rawViews = Array.isArray(scene.views) ? scene.views : [],
        viewMap = new Map(rawViews.map((raw) => {
          const view = raw && typeof raw === "object" ? raw as Record<string, unknown> : {},
            id = String(view.id || "").trim();
          return [id, view] as const;
        })),
        requiredViews = [
          { id: "main", name: "主视角", fallback: "保持场景完整空间结构的主建立机位" },
          { id: "reverse", name: "反向视角", fallback: "相对主视角旋转约180度，展示同一空间反向区域" },
          { id: "top", name: "俯视布局", fallback: "俯视展示建筑边界、通道与固定道具的准确方位关系" },
        ];
      scene.views = requiredViews.map((fallback) => {
        const view = viewMap.get(fallback.id) || {};
        return {
          id: fallback.id,
          name: String(view.name || fallback.name).trim().slice(0, 30),
          imagePrompt: String(view.imagePrompt || fallback.fallback).trim().slice(0, 120),
        };
      });
      for (const id of ["left", "right"]) {
        const view = viewMap.get(id);
        if (view) (scene.views as Array<Record<string, unknown>>).push({ id, name: String(view.name || (id === "left" ? "左侧视角" : "右侧视角")).slice(0, 30), imagePrompt: String(view.imagePrompt || "").slice(0, 120) });
      }
      scene.sceneId = String(scene.sceneId || scene.id || `scene-${index + 1}`).trim().slice(0, 80);
      scene.baseSceneId = String(scene.baseSceneId || "").trim().slice(0, 80) || undefined;
      scene.variantType = ["base", "area", "state", "time"].includes(String(scene.variantType)) ? String(scene.variantType) : scene.baseSceneId ? "area" : "base";
      return scene;
    });
    normalizeComicSceneHierarchy(sceneBible.scenes as Array<{ sceneId:string; baseSceneId?:string; variantType?:"base"|"area"|"state"|"time"; imagePrompt:string; propIndexes:number[]; environmentAnchors:string[] }>);
    if (!checkpoint.sceneBible) saveCheckpoint({ sceneBible });
    else
      emit({
        type: "progress",
        progress: 48,
        phase: "已恢复场景设定检查点",
        receivedBytes: streamState.receivedBytes,
        resumed: true,
      });
    emit({
      type: "progress",
      progress: 49,
      phase: "场景设定校验通过",
      receivedBytes: streamState.receivedBytes,
    });
    const foundation = {
        ...story,
        ...assets,
        scenes: Array.isArray(sceneBible.scenes) ? sceneBible.scenes : [],
      } as Record<string, unknown>,
      outlineParts = (Array.isArray(story.outline) ? story.outline : []).slice(
        0,
        8,
      ),
      allShots: unknown[] = checkpoint.shotPlan && Array.isArray(checkpoint.shots)
        ? [...checkpoint.shots]
        : [];
    const shotPlanSystem = comicShotPlanPrompt();
    const compactFoundation = compactComicFoundation(foundation);
    const shotPlanText = `创作需求：\n${text}\n\n已校验的紧凑剧情与资产索引：\n${JSON.stringify(compactFoundation)}`;
    let shotPlan = checkpoint.shotPlan
      ? checkpoint.shotPlan
      : await readStage(
          "正在规划完整镜头列表…",
          shotPlanSystem,
          shotPlanText,
          2800,
          50,
          57,
        );
    const normalizeShotPlan = (value: Record<string, unknown>) =>
      normalizeComicShotPlan(value, outlineParts);
    const shotPlanIssues = (value: Record<string, unknown>) =>
      comicShotPlanIssues(value, outlineParts.length, foundation.duration);
    shotPlan = normalizeShotPlan(shotPlan);
    for (let rewrite = 1; rewrite <= 2; rewrite++) {
      const issues = shotPlanIssues(shotPlan);
      if (!issues.length) break;
      request.log.warn({ issues, rewrite }, "comic shot plan validation issues");
      emit({
        type: "progress",
        progress: 57,
        phase: `镜头规划发现 ${issues.length} 项问题，正在第 ${rewrite} 次重写…`,
        receivedBytes: streamState.receivedBytes,
        rewrite,
      });
      const splitIssue = issues.map((issue) => issue.match(/^镜头(\d+)对白预计需\d+秒，必须拆镜$/)).find(Boolean),
        splitIndex = splitIssue ? Number(splitIssue[1]) - 1 : -1,
        currentPlanned = Array.isArray(shotPlan.plannedShots) ? [...shotPlan.plannedShots] : [];
      if (splitIndex >= 0 && currentPlanned[splitIndex]) {
        const neighbors = currentPlanned.slice(Math.max(0, splitIndex - 1), splitIndex + 2),
          localRepair = await readStage(
            `镜头 ${splitIndex + 1} 对白拆分中…`,
            `${shotPlanSystem} 本次只拆分指定的一个超时镜头，plannedShots 仅返回替换该镜头的连续子镜头，不得返回邻镜。完整保留原对白、剧情事实和因果，不得删词；每个子镜头对白均需在8秒内自然说完。`,
            `问题：${issues.filter((issue) => issue.startsWith(`镜头${splitIndex + 1}`)).join("\n")}\n\n需要拆分的镜头：\n${JSON.stringify(currentPlanned[splitIndex])}\n\n前后镜头仅供连续性参考：\n${JSON.stringify(neighbors)}\n\n视觉与剧情基座：\n${shotPlanText}`,
            1800,
            57,
            57,
            true,
          ), replacements = Array.isArray(localRepair.plannedShots) ? localRepair.plannedShots : [];
        if (!replacements.length) throw new SyntaxError("超时对白镜头拆分返回为空");
        currentPlanned.splice(splitIndex, 1, ...replacements);
        shotPlan = { ...shotPlan, plannedShots: currentPlanned };
      } else {
        shotPlan = await readStage(
          "镜头规划重写中…",
          shotPlanSystem,
          `保持故事事实不变，修复下列问题并返回完整 plannedShots。\n${issues.join("\n")}\n\n原规划：\n${JSON.stringify(shotPlan)}\n\n基座：\n${shotPlanText}`,
          3200,
          57,
          57,
          true,
        );
      }
      shotPlan = normalizeShotPlan(shotPlan);
    }
    const remainingPlanIssues = shotPlanIssues(shotPlan);
    if (remainingPlanIssues.length)
      throw new SyntaxError(
        `镜头规划复检仍有 ${remainingPlanIssues.length} 项不合格`,
      );
    if (!checkpoint.shotPlan)
      saveCheckpoint({ shotPlan, shots: [], completedBatches: 0 });
    else
      emit({
        type: "progress",
        progress: 57,
        phase: "已恢复镜头规划检查点",
        receivedBytes: streamState.receivedBytes,
        resumed: true,
      });
    const plannedShots = (
        Array.isArray(shotPlan.plannedShots) ? shotPlan.plannedShots : []
      )
        .map((raw, index) => ({
          ...((raw && typeof raw === "object" ? raw : {}) as Record<
            string,
            unknown
          >),
          number: index + 1,
        })),
      totalShots = plannedShots.length;
    emit({
      type: "progress",
      progress: 58,
      phase: `镜头规划校验通过 · 共 ${totalShots} 镜`,
      receivedBytes: streamState.receivedBytes,
      totalShots,
    });
    const shotViewSystem = comicShotExpansionPrompt();
    // Three shots keeps structured responses comfortably below the range in
    // which providers have repeatedly emitted truncated/invalid JSON. Each
    // successful batch is checkpointed, so a retry never discards prior work.
    const shotBatchSize = COMIC_SHOT_BATCH_SIZE,
      batchCount = Math.ceil(totalShots / shotBatchSize);
    let resumeBatch = Math.min(
      batchCount,
      Math.max(0, Number(checkpoint.completedBatches) || 0),
    );
    const expectedResumedShots = completedShotCount(resumeBatch, totalShots, shotBatchSize);
    if (allShots.length !== expectedResumedShots) {
      resumeBatch = 0;
      allShots.splice(0, allShots.length);
      saveCheckpoint({ shotPlan, shots: [], completedBatches: 0 });
    }
    if (resumeBatch > 0)
      emit({
        type: "progress",
        progress: 59 + Math.floor((resumeBatch * 34) / batchCount),
        phase: `已恢复 ${allShots.length}/${totalShots} 个已校验镜头`,
        receivedBytes: streamState.receivedBytes,
        resumed: true,
        totalShots,
        completedShots: allShots.length,
      });
    for (let batchIndex = resumeBatch; batchIndex < batchCount; batchIndex++) {
      const batchWindow = comicBatchWindow(plannedShots, batchIndex, shotBatchSize),
        expected = batchWindow.expected,
        firstNumber = Number(
          expected[0]?.number || batchIndex * shotBatchSize + 1,
        ),
        lastNumber = Number(expected.at(-1)?.number || firstNumber),
        batchStart = 59 + Math.floor((batchIndex * 34) / batchCount),
        batchEnd = 59 + Math.floor(((batchIndex + 1) * 34) / batchCount),
        previousTail = allShots.slice(-2),
        neighborPlan = batchWindow.neighbors,
        batchText = `本批及相邻镜头规划：\n${JSON.stringify(neighborPlan)}\n\n本批必须详细生成镜头 ${firstNumber}–${lastNumber}/${totalShots}：\n${JSON.stringify(expected)}\n\n上一批最后镜头状态：\n${JSON.stringify(previousTail)}\n\n已校验视觉基座：\n${JSON.stringify(foundation)}`,
        batchContent: unknown = visualInputs.length
          ? [
              { type: "text", text: batchText },
              ...visualInputs.map((url) => ({
                type: "image_url",
                image_url: { url },
              })),
            ]
          : batchText;
      let shotPart = await readStage(
        `正在生成镜头 ${firstNumber}–${lastNumber}/${totalShots}…`,
        shotViewSystem,
        batchContent,
        6200,
        batchStart,
        Math.max(batchStart + 1, batchEnd - 1),
      );
      emit({
        type: "progress",
        progress: Math.max(batchStart, batchEnd - 1),
        phase: `正在校验镜头 ${firstNumber}–${lastNumber}/${totalShots}…`,
        receivedBytes: streamState.receivedBytes,
        totalShots,
        completedShots: allShots.length,
      });
      const normalizeShotBatch = (value: Record<string, unknown>) => {
        const returned = Array.isArray(value.shots) ? value.shots : [],
          byNumber = new Map<number, Record<string, unknown>>();
        returned.forEach((raw) => {
          if (!raw || typeof raw !== "object") return;
          const item = raw as Record<string, unknown>;
          byNumber.set(Number(item.number), item);
        });
        value.shots = expected.map((planItem, index) => {
          const plan = planItem as Record<string, unknown>,
            generated =
              byNumber.get(Number(plan.number)) ||
              (returned[index] && typeof returned[index] === "object"
                ? (returned[index] as Record<string, unknown>)
                : {});
          return {
            ...plan,
            ...generated,
            number: Number(plan.number),
            title: String(generated.title || plan.title || "").trim(),
            duration: Number(plan.duration),
            storyBeat: String(plan.storyBeat || generated.storyBeat || "").trim(),
            sceneId: String(generated.sceneId || plan.sceneId || "").trim(),
            sceneView: ["main", "reverse", "left", "right", "top"].includes(String(plan.sceneView))
              ? String(plan.sceneView)
              : "main",
            characterIndexes: Array.isArray(plan.characterIndexes)
              ? plan.characterIndexes
              : [],
            propIndexes: Array.isArray(plan.propIndexes)
              ? plan.propIndexes
              : [],
            dialogue: String(plan.dialogue || generated.dialogue || "无对白").trim(),
            transition: String(plan.transition || generated.transition || "").trim(),
            continuity: String(plan.continuity || generated.continuity || "").trim(),
          };
        });
        return value;
      };
      const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        isCharacterVisible = (evidence: string, name: string) => {
          if (!name || !evidence.includes(name)) return false;
          const escaped = escapeRegExp(name),
            negative = new RegExp(
              `(?:不出现|禁止|不得|不可|没有|只有|不包含)[^\u3002；；,，]{0,16}${escaped}|${escaped}[^\u3002；；,，]{0,20}(?:不入画|不出现|不可见|尚未可见|尚未落地|留在画外|仅为画外|不在画面)`
            );
          return !negative.test(evidence);
        },
        normalizeFrameReferences = (value: Record<string, unknown>) => {
        const returned = Array.isArray(value.shots) ? value.shots : [],
          foundationCharacters = Array.isArray(foundation.characters)
            ? foundation.characters
            : [],
          foundationProps = Array.isArray(foundation.props)
            ? foundation.props
            : [];
        returned.forEach((rawShot) => {
          if (!rawShot || typeof rawShot !== "object") return;
          const shot = rawShot as Record<string, unknown>,
            frames = Array.isArray(shot.frames) ? shot.frames : [],
            plannedShot = expected.find(
              (item) => Number(item.number) === Number(shot.number),
            ) as Record<string, unknown> | undefined;
          frames.forEach((rawFrame) => {
            if (!rawFrame || typeof rawFrame !== "object") return;
            const frame = rawFrame as Record<string, unknown>,
              characterIndexes = normalizeComicAssetIndexes(
                frame.characterIndexes,
                foundationCharacters.length,
              ),
              propIndexes = normalizeComicAssetIndexes(
                frame.propIndexes,
                foundationProps.length,
              ),
              allowedCharacters = new Set(characterIndexes);
            frame.characterIndexes = characterIndexes;
            frame.propIndexes = propIndexes;
            frame.characterStates = normalizeComicCharacterStates(
              frame.characterStates,
              characterIndexes,
              propIndexes,
            );
            frame.characterForms = (Array.isArray(frame.characterForms)
              ? frame.characterForms
              : []
            ).filter((raw) => {
              if (!raw || typeof raw !== "object") return false;
              return allowedCharacters.has(
                Number((raw as Record<string, unknown>).characterIndex),
              );
            });
          });
          const visibleCharacterIndexes = new Set<number>(),
            visiblePropIndexes = new Set<number>();
          frames.forEach((rawFrame) => {
            if (!rawFrame || typeof rawFrame !== "object") return;
            const frame = rawFrame as Record<string, unknown>;
            (Array.isArray(frame.characterIndexes)
              ? frame.characterIndexes
              : []
            ).forEach((index) => visibleCharacterIndexes.add(Number(index)));
            (Array.isArray(frame.propIndexes) ? frame.propIndexes : []).forEach(
              (index) => visiblePropIndexes.add(Number(index)),
            );
          });
          // Shot-level dependencies are derived from what is actually visible in
          // its frames. This prevents off-screen dialogue and anonymous crowds
          // from accidentally attaching unrelated character bases.
          shot.characterIndexes = [...visibleCharacterIndexes].filter(
            (index) =>
              Number.isInteger(index) &&
              index >= 1 &&
              index <= foundationCharacters.length,
          );
          shot.propIndexes = [...visiblePropIndexes].filter(
            (index) =>
              Number.isInteger(index) &&
              index >= 1 &&
              index <= foundationProps.length,
          );
          const allowedShotCharacters = new Set(
            shot.characterIndexes as number[],
          );
          shot.characterForms = (Array.isArray(shot.characterForms)
            ? shot.characterForms
            : []
          ).filter(
            (raw) =>
              raw &&
              typeof raw === "object" &&
              allowedShotCharacters.has(
                Number((raw as Record<string, unknown>).characterIndex),
              ),
          );
          const crowdEvidence = frames
            .map((rawFrame) => {
              if (!rawFrame || typeof rawFrame !== "object") return "";
              const frame = rawFrame as Record<string, unknown>;
              return `${String(frame.title || "")} ${String(frame.imagePrompt || "")} ${String(frame.inherit || "")} ${String(frame.change || "")}`;
            })
            .join(" "),
            hasAnonymousCrowd = resolveVisibleAnonymousCrowd(
              plannedShot?.hasAnonymousCrowd,
              shot.hasAnonymousCrowd,
              shot.crowdPrompt,
              `${String(shot.storyBeat || "")} ${String(shot.action || "")} ${crowdEvidence}`,
            );
          // Anonymous crowd layers are production dependencies. Derive them
          // from visible frame evidence instead of trusting a stray model flag.
          shot.hasAnonymousCrowd = hasAnonymousCrowd;
          shot.crowdPrompt = hasAnonymousCrowd
            ? String(shot.crowdPrompt || "匿名背景人群，个体外观与动作不重复，禁止复制具名角色").trim()
            : "";
        });
        return value;
      };
      shotPart = normalizeFrameReferences(normalizeShotBatch(shotPart));
      const batchIssues = (value: Record<string, unknown>) => {
        const issues = validateComicStage(value, "shots"),
          returned = Array.isArray(value.shots) ? value.shots : [],
          foundationCharacters = Array.isArray(foundation.characters) ? foundation.characters : [],
          foundationProps = Array.isArray(foundation.props) ? foundation.props : [];
        if (returned.length !== expected.length)
          issues.push(`返回 ${returned.length} 镜，预期 ${expected.length} 镜`);
        expected.forEach((planItem, index) => {
          if (
            Number(
              returned[index] && typeof returned[index] === "object"
                ? (returned[index] as Record<string, unknown>).number
                : 0,
            ) !== Number(planItem.number)
          )
            issues.push(
              `第 ${index + 1} 项镜头编号不匹配，预期 ${planItem.number}`,
            );
          const plan = planItem as Record<string, unknown>,
            rawShot=returned[index]&&typeof returned[index]==="object"?returned[index] as Record<string,unknown>:null,
            frames=rawShot&&Array.isArray(rawShot.frames)?rawShot.frames:[],
            expectedFrameCount=Math.max(1,Math.min(4,Number(plan.frameCount)||1)),
            plannedStateChanges=(Array.isArray(plan.stateChanges)?plan.stateChanges:[]).map((change)=>String(change||"").trim()).filter(Boolean),
            claimedStateChanges:number[]=[];
          if(frames.length!==expectedFrameCount)issues.push(`镜头 ${planItem.number} 返回 ${frames.length} 张分镜，规划要求 ${expectedFrameCount} 张`);
          const plannedCharacterIndexes = new Set(
              (Array.isArray(plan.characterIndexes) ? plan.characterIndexes : []).map(Number),
            ),
            plannedPropIndexes = new Set(
              (Array.isArray(plan.propIndexes) ? plan.propIndexes : []).map(Number),
            ),
            claimedCharacterIndexes = new Set<number>(),
            claimedPropIndexes = new Set<number>();
          frames.forEach((rawFrame, frameIndex) => {
            const frame = rawFrame && typeof rawFrame === "object"
                ? rawFrame as Record<string, unknown>
                : null,
              label = `镜头 ${planItem.number} 分镜 ${frameIndex + 1}`;
            if (!frame) {
              issues.push(`${label} 数据无效`);
              return;
            }
            for (const field of ["stateChangeIndexes", "characterIndexes", "characterForms", "propIndexes", "characterStates"] as const)
              if (!Array.isArray(frame[field])) issues.push(`${label} 缺少 ${field}`);
            const stateChangeIndexes = Array.isArray(frame.stateChangeIndexes)
                ? frame.stateChangeIndexes.map(Number)
                : [],
              characterIndexes = Array.isArray(frame.characterIndexes)
                ? frame.characterIndexes.map(Number)
                : [],
              propIndexes = Array.isArray(frame.propIndexes)
                ? frame.propIndexes.map(Number)
                : [],
              characterStates = Array.isArray(frame.characterStates)
                ? frame.characterStates as Record<string, unknown>[]
                : [];
            stateChangeIndexes.forEach((changeIndex) => {
              if (!Number.isInteger(changeIndex) || changeIndex < 0 || changeIndex >= plannedStateChanges.length)
                issues.push(`${label} stateChangeIndexes 越界: ${changeIndex}`);
              else claimedStateChanges.push(changeIndex);
            });
            if (!String(frame.change || "").trim())
              issues.push(`${label}.change 为空，未落实可见变化`);
            characterIndexes.forEach((characterIndex) => {
              if (!Number.isInteger(characterIndex) || !plannedCharacterIndexes.has(characterIndex))
                issues.push(`${label} 使用了镜头规划外的角色 ID ${characterIndex}`);
              else claimedCharacterIndexes.add(characterIndex);
            });
            propIndexes.forEach((propIndex) => {
              if (!Number.isInteger(propIndex) || !plannedPropIndexes.has(propIndex))
                issues.push(`${label} 使用了镜头规划外的道具 ID ${propIndex}`);
              else claimedPropIndexes.add(propIndex);
            });
            const stateCharacters = new Set<number>();
            characterStates.forEach((state) => {
              const characterIndex = Number(state.characterIndex),
                posture = String(state.posture || ""),
                heldPropIndexes = Array.isArray(state.heldPropIndexes) ? state.heldPropIndexes.map(Number) : [];
              if (stateCharacters.has(characterIndex)) issues.push(`${label} 角色 ID ${characterIndex} 的 characterStates 重复`);
              stateCharacters.add(characterIndex);
              if (!characterIndexes.includes(characterIndex)) issues.push(`${label} characterStates 含不可见角色 ID ${characterIndex}`);
              if (!["standing", "walking", "crouching", "kneeling", "sitting", "lying", "airborne", "other"].includes(posture)) issues.push(`${label} 角色 ID ${characterIndex} posture 无效`);
              if (!String(state.positionAnchor || "").trim()) issues.push(`${label} 角色 ID ${characterIndex} positionAnchor 为空`);
              if (!String(state.facingTarget || "").trim()) issues.push(`${label} 角色 ID ${characterIndex} facingTarget 为空`);
              if (!Array.isArray(state.heldPropIndexes)) issues.push(`${label} 角色 ID ${characterIndex} heldPropIndexes 无效`);
              if (typeof state.transitionAction !== "string") issues.push(`${label} 角色 ID ${characterIndex} 缺少 transitionAction 字段`);
              heldPropIndexes.forEach((propIndex) => {
                if (!propIndexes.includes(propIndex)) issues.push(`${label} 角色 ID ${characterIndex} 持有未出镜道具 ID ${propIndex}`);
              });
            });
            characterIndexes.forEach((characterIndex) => {
              if (!stateCharacters.has(characterIndex)) issues.push(`${label} 可见角色 ID ${characterIndex} 缺少 characterStates`);
            });
            const priorShot = index > 0 ? returned[index - 1] : previousTail.at(-1),
              priorFrames = priorShot && typeof priorShot === "object" && Array.isArray((priorShot as Record<string, unknown>).frames)
                ? (priorShot as Record<string, unknown>).frames as unknown[]
                : [],
              previousFrame = frameIndex > 0 ? frames[frameIndex - 1] : priorFrames.at(-1);
            issues.push(...comicCharacterStateTransitionIssues(previousFrame, frame, Number(planItem.number), frameIndex + 1));
          });
          plannedCharacterIndexes.forEach((characterIndex) => {
            if (!claimedCharacterIndexes.has(characterIndex))
              issues.push(`镜头 ${planItem.number} 规划角色 ID ${characterIndex} 未分配到任何分镜`);
          });
          plannedPropIndexes.forEach((propIndex) => {
            if (!claimedPropIndexes.has(propIndex))
              issues.push(`镜头 ${planItem.number} 规划道具 ID ${propIndex} 未分配到任何分镜`);
          });
          plannedStateChanges.forEach((change,changeIndex)=>{const claims=claimedStateChanges.filter((index)=>index===changeIndex).length;if(claims===0)issues.push(`镜头 ${planItem.number} 遗漏状态变化 ${changeIndex+1}「${change}」`);else if(claims>1)issues.push(`镜头 ${planItem.number} 状态变化 ${changeIndex+1}「${change}」被重复认领 ${claims} 次`)});
          const previousShot = index > 0
              ? returned[index - 1]
              : previousTail.at(-1),
            postureIssue = comicPostureTransitionIssue(previousShot, rawShot);
          if (postureIssue) issues.push(postureIssue);
        });
        return issues;
      };
      for (let rewrite = 1; rewrite <= 2; rewrite++) {
        const issues = batchIssues(shotPart);
        if (!issues.length) break;
        request.log.warn(
          { issues, rewrite, firstNumber, lastNumber },
          "comic shot batch validation issues",
        );
        emit({
          type: "progress",
          progress: Math.max(batchStart, batchEnd - 1),
          phase: `镜头 ${firstNumber}–${lastNumber}/${totalShots} 发现 ${issues.length} 项问题，正在第 ${rewrite} 次重写…`,
          receivedBytes: streamState.receivedBytes,
          rewrite,
        });
        const invalidNumbers = new Set<number>();
        for (const issue of issues) {
          const matched = issue.match(/镜头\s*(\d+)/), rawNumber = Number(matched?.[1]);
          if (!Number.isInteger(rawNumber)) continue;
          const actual = expected.some((item) => Number(item.number) === rawNumber)
            ? rawNumber
            : rawNumber >= 1 && rawNumber <= expected.length
              ? Number(expected[rawNumber - 1]?.number)
              : 0;
          if (actual) invalidNumbers.add(actual);
        }
        const repairExpected = invalidNumbers.size
          ? expected.filter((item) => invalidNumbers.has(Number(item.number)))
          : expected;
        const repaired = await readStage(
          `镜头 ${[...invalidNumbers].join("、") || `${firstNumber}–${lastNumber}`} 定向重写中…`,
          `${shotViewSystem} 本次只返回指定问题镜头，shots 数组不得包含其他编号。`,
          `只修复下列问题，不得改变其他已通过镜头。\n${issues.join("\n")}\n\n只需返回的镜头规划：\n${JSON.stringify(repairExpected)}\n\n当前完整批次：\n${JSON.stringify(shotPart)}\n\n上一批末镜：\n${JSON.stringify(previousTail)}`,
          Math.min(6200, 1000 + repairExpected.length * 1100),
          Math.max(batchStart, batchEnd - 1),
          Math.max(batchStart, batchEnd - 1),
          true,
        );
        const currentShots = Array.isArray(shotPart.shots) ? [...shotPart.shots] : [],
          repairedShots = Array.isArray(repaired.shots) ? repaired.shots : [],
          repairedByNumber = new Map(repairedShots.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")).map((item) => [Number(item.number), item]));
        shotPart = {
          ...shotPart,
          shots: currentShots.map((item) => {
            const number = Number(item && typeof item === "object" ? (item as Record<string, unknown>).number : 0);
            return repairedByNumber.get(number) || item;
          }),
        };
        shotPart = normalizeFrameReferences(normalizeShotBatch(shotPart));
      }
      const remaining = batchIssues(shotPart);
      if (remaining.length)
        throw new SyntaxError(
          `镜头 ${firstNumber}–${lastNumber} 复检仍有 ${remaining.length} 项不合格`,
        );
      allShots.push(...(Array.isArray(shotPart.shots) ? shotPart.shots : []));
      saveCheckpoint({
        shotPlan,
        shots: allShots,
        completedBatches: batchIndex + 1,
      });
      emit({
        type: "progress",
        progress: batchEnd,
        phase: `镜头 ${firstNumber}–${lastNumber}/${totalShots} 校验通过`,
        receivedBytes: streamState.receivedBytes,
        totalShots,
        completedShots: allShots.length,
      });
    }
    emit({
      type: "progress",
      progress: 94,
      phase: `正在校验 ${Math.max(0, batchCount - 1)} 个批次边界…`,
      receivedBytes: streamState.receivedBytes,
    });
    const continuityAuditSubset = (shotNumbers: number[] = []) =>
      comicAuditSubset(allShots, shotBatchSize, shotNumbers);
    const auditSystem = comicAuditPrompt();
    let audit = await readStage(
      "正在审校跨段过渡…",
      auditSystem,
      JSON.stringify({
        outline: outlineParts.map((item) => ({
          act: item && typeof item === "object" ? (item as Record<string, unknown>).act : "",
          content: String(item && typeof item === "object" ? (item as Record<string, unknown>).content || "" : "").slice(0, 240),
        })),
        shots: continuityAuditSubset(),
      }),
      2200,
      94,
      97,
    );
    // Global issues are usually isolated to one boundary. Give targeted repair
    // enough room to converge instead of discarding an otherwise valid plan.
    for (let auditAttempt = 1; auditAttempt <= 6; auditAttempt++) {
      const repairs = Array.isArray(audit.repairs) ? audit.repairs : [],
        issues = Array.isArray(audit.issues) ? audit.issues : [];
      if (audit.valid === true && !issues.length) break;
      request.log.warn(
        { auditAttempt, issues, repairs },
        "comic continuity audit issues",
      );
      if (!repairs.length)
        throw new SyntaxError("跨段审校发现问题但未返回可执行修复");
      emit({
        type: "progress",
        progress: 97,
        phase: `镜头 ${repairs.map((repair) => Number(repair && typeof repair === "object" ? (repair as Record<string, unknown>).shotNumber : 0)).filter(Boolean).join("、") || "边界"} 未通过，正在第 ${auditAttempt} 次定向修复…`,
        receivedBytes: streamState.receivedBytes,
        repairAttempt: auditAttempt,
      });
      applyComicAuditRepairs(allShots, repairs);
      saveCheckpoint({
        shotPlan,
        shots: allShots,
        completedBatches: batchCount,
      });
      emit({
        type: "progress",
        progress: 97,
        phase: `正在复检第 ${auditAttempt} 次边界修复结果…`,
        receivedBytes: streamState.receivedBytes,
        repairAttempt: auditAttempt,
      });
      audit = await readStage(
        "跨段修复复检中…",
        `${auditSystem} 本次是定向复检：只验证上一轮明确列出的 issues 是否已经通过 repairs 修复。除非仍存在会导致剧情事实矛盾、人物或道具状态冲突的硬错误，否则必须返回 valid=true；不得在复检时新增审美偏好、措辞优化或非阻断性建议。`,
        JSON.stringify({
          previousAudit: audit,
          shots: continuityAuditSubset(
            repairs.map((repair) =>
              Number(
                repair && typeof repair === "object"
                  ? (repair as Record<string, unknown>).shotNumber
                  : 0,
              ),
            ),
          ),
        }),
        1800,
        97,
        97,
        true,
      );
    }
    if (
      audit.valid !== true ||
      (Array.isArray(audit.issues) && audit.issues.length)
    )
      throw new SyntaxError("跨段连续性复检未通过");
    emit({
      type: "progress",
      progress: 98,
      phase: "全局连续性校验通过",
      receivedBytes: streamState.receivedBytes,
    });
    if (streamHeartbeat) {
      clearInterval(streamHeartbeat);
      streamHeartbeat = null;
    }
    const plan = { ...foundation, shots: allShots } as Record<string, unknown>,
      rawShots = Array.isArray(plan.shots) ? plan.shots : [],
      rawCharacters = Array.isArray(plan.characters) ? plan.characters : [];
    request.log.info(
      {
        model: streamState.usedModel,
        requestedModel: model,
        elapsedMs: Date.now() - streamState.startedAt,
        responseLength: JSON.stringify(plan).length,
      },
      "comic agent response received",
    );
    const characters = rawCharacters.slice(0, 12).map((value) => {
      const character =
        value && typeof value === "object"
          ? (value as Record<string, unknown>)
          : {};
      const name = String(character.name || "未命名角色").slice(0, 50),
        description = String(character.description || "").slice(0, 800),
        voiceProfile = String(
          character.voiceProfile ||
            character.voice ||
            "自然中文普通话，声线与角色年龄和性格一致，跨镜头保持稳定",
        ).slice(0, 300),
        nonVisual =
          /无实体|没有实体|仅(?:以|通过).*(?:声音|文字|光阵)|旁白|系统之声/.test(
            `${name}${description}`,
          ),
        rawForms = Array.isArray(character.forms)
          ? character.forms
          : Array.isArray(character.variants)
            ? character.variants
            : [],
        forms = rawForms
          .slice(0, 6)
          .map((formValue) => {
            const form =
                formValue && typeof formValue === "object"
                  ? (formValue as Record<string, unknown>)
                  : {},
              formName = String(form.name || "特殊形态").slice(0, 50),
              formDescription = String(form.description || "").slice(0, 600);
            return {
              name: formName,
              description: formDescription,
              imagePrompt: compactImagePrompt(
                String(
                  form.imagePrompt ||
                    `严格参考${name} Base 人物基准图，保持面部、发型、体型和身份一致，只变更为${formName}：${formDescription}。16:9 横向角色设定板，正面、侧面、背面三视图，并展示变化服饰、伤势、装备和饰品局部细节。`,
                ),
                420,
              ),
            };
          })
          .filter(
            (form) =>
              form.name && !/^(?:base|基础|默认|常态)$/i.test(form.name),
          );
      return {
        name,
        description,
        voiceProfile,
        visualAsset: character.visualAsset !== false && !nonVisual,
        imagePrompt: compactImagePrompt(
          String(
            character.imagePrompt ||
              `${name} Base 角色设定板。${description}。16:9 横向排版，同一人物正面、严格侧面、背面三视图；附头部五官发型近景、服装分层、鞋靴、关键装备武器饰品与材质纹理局部放大，纯净中性背景，保持比例和身份完全一致。`,
          ),
          420,
        ),
        forms,
      };
    });
    const rawProps = Array.isArray(plan.props) ? plan.props : [],
      props = rawProps.slice(0, 16).map((value) => {
        const prop =
            value && typeof value === "object"
              ? (value as Record<string, unknown>)
              : {},
          name = String(prop.name || "未命名道具").slice(0, 60),
          description = String(prop.description || "").slice(0, 800);
        return {
          name,
          description,
          imagePrompt: compactImagePrompt(
            String(
              prop.imagePrompt ||
                `${name}道具设定图，${description}，纯背景，材质、尺寸和特征清楚`,
            ),
            160,
          ),
        };
      });
    const scenes = (Array.isArray(plan.scenes) ? plan.scenes : []).slice(0, 24).map((value, index) => {
      const scene = value && typeof value === "object" ? value as Record<string, unknown> : {};
      return {
        sceneId: String(scene.sceneId || scene.id || `scene-${index + 1}`).slice(0, 80),
        baseSceneId: String(scene.baseSceneId || "").trim().slice(0, 80) || undefined,
        variantType: ["base", "area", "state", "time"].includes(String(scene.variantType)) ? String(scene.variantType) as "base"|"area"|"state"|"time" : String(scene.baseSceneId || "").trim() ? "area" as const : "base" as const,
        name: String(scene.name || `场景 ${index + 1}`).slice(0, 60),
        description: String(scene.description || scene.scene || "").slice(0, 800),
        imagePrompt: compactImagePrompt(String(scene.imagePrompt || scene.scenePrompt || scene.description || ""), 160),
        propIndexes: [...new Set((Array.isArray(scene.propIndexes) ? scene.propIndexes : []).map(Number).filter((number) => Number.isInteger(number) && number >= 1 && number <= props.length))],
        environmentAnchors: (Array.isArray(scene.environmentAnchors) ? scene.environmentAnchors : []).map((item) => String(item || "").trim().slice(0, 80)).filter(Boolean).slice(0, 8),
        views: (() => {
          const allowed = new Set(["main", "reverse", "left", "right", "top"]),
            rawViews = (Array.isArray(scene.views) ? scene.views : []).filter((raw) => raw && typeof raw === "object") as Array<Record<string, unknown>>,
            byId = new Map(rawViews.filter((view) => allowed.has(String(view.id))).map((view) => [String(view.id), view])),
            fallbacks = [
              ["main", "主视角", "保持完整空间结构的主建立机位"],
              ["reverse", "反向视角", "相对主视角旋转约180度，展示同一空间反向区域"],
              ["top", "俯视布局", "俯视展示建筑边界、通道与固定道具的准确方位关系"],
            ];
          const result = fallbacks.map(([id, name, prompt]) => {
            const view = byId.get(id) || {};
            return { id, name: String(view.name || name).slice(0, 30), imagePrompt: compactImagePrompt(String(view.imagePrompt || prompt), 120) };
          });
          for (const id of ["left", "right"]) {
            const view = byId.get(id);
            if (view) result.push({ id, name: String(view.name || (id === "left" ? "左侧视角" : "右侧视角")).slice(0, 30), imagePrompt: compactImagePrompt(String(view.imagePrompt || "同一空间侧向机位"), 120) });
          }
          return result;
        })(),
      };
    });
    normalizeComicSceneHierarchy(scenes);
    const shots = rawShots.map((value, index) => {
        const shot =
            value && typeof value === "object"
              ? (value as Record<string, unknown>)
              : {},
          scene = String(shot.scene || "").slice(0, 800),
          storyBeat = String(shot.storyBeat || "").slice(0, 700),
          action = String(shot.action || scene || "").slice(0, 800),
          dialogue = normalizeComicDialogue(shot.dialogue).slice(0, 700),
          imagePrompt = compactImagePrompt(
            String(shot.imagePrompt || scene || ""),
          ),
          explicitCharacters = Array.isArray(shot.characterIndexes)
            ? shot.characterIndexes
                .map(Number)
                .filter(
                  (number) =>
                    Number.isInteger(number) &&
                    number >= 1 &&
                    number <= characters.length,
                )
            : [],
          characterEvidence = `${scene}${storyBeat}${action}${dialogue}${imagePrompt}${JSON.stringify(shot.frames || [])}`,
          inferredCharacters = characters
            .map((character, characterIndex) =>
              new RegExp(
                character.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
              ).test(characterEvidence)
                ? characterIndex + 1
                : 0,
            )
            .filter(Boolean),
          validatedCharacters =
            explicitCharacters.length ? explicitCharacters : inferredCharacters,
          declaredPropIndexes = Array.isArray(shot.propIndexes)
            ? [
                ...new Set(
                  shot.propIndexes
                    .map(Number)
                    .filter(
                      (number) =>
                        Number.isInteger(number) &&
                        number >= 1 &&
                        number <= props.length,
                    ),
                ),
              ]
            : [],
          inferredShotPropIndexes = props
            .map((prop, propIndex) => comicAssetNameMentioned(characterEvidence, prop.name) ? propIndex + 1 : 0)
            .filter(Boolean),
          propIndexes = declaredPropIndexes.length
            ? declaredPropIndexes
            : [...new Set(inferredShotPropIndexes)],
          rawFrames = Array.isArray(shot.frames) ? shot.frames : [],
          frames = (
            rawFrames.length ? rawFrames : [{ title: "主画面", imagePrompt }]
          )
            .slice(0, 4)
            .map((frameValue, frameIndex) => {
              const frame =
                frameValue && typeof frameValue === "object"
                  ? (frameValue as Record<string, unknown>)
                  : {};
              const frameEvidence = `${String(frame.title || "")}${String(frame.imagePrompt || "")}${String(frame.inherit || "")}${String(frame.change || "")}`,
                explicitFrameCharacters = Array.isArray(frame.characterIndexes)
                  ? frame.characterIndexes.map(Number).filter((number) => Number.isInteger(number) && validatedCharacters.includes(number))
                  : [],
                inferredFrameCharacters = validatedCharacters.filter((number) => frameEvidence.includes(characters[number - 1]?.name || "\u0000")),
                frameCharacterIndexes = [
                  ...new Set(
                    explicitFrameCharacters.length
                      ? explicitFrameCharacters
                      : rawFrames.length <= 1
                        ? inferredFrameCharacters
                        : [],
                  ),
                ],
                explicitFrameProps = Array.isArray(frame.propIndexes)
                  ? frame.propIndexes.map(Number).filter((number) => Number.isInteger(number) && number >= 1 && number <= props.length)
                  : [],
                inferredFrameProps = props.map((prop, propIndex) => comicAssetNameMentioned(frameEvidence, prop.name) ? propIndex + 1 : 0).filter(Boolean),
                framePropIndexes = [
                  ...new Set(
                    explicitFrameProps.length
                      ? explicitFrameProps
                      : rawFrames.length <= 1
                        ? inferredFrameProps
                        : [],
                  ),
                ],
                frameCharacterForms = (Array.isArray(frame.characterForms) ? frame.characterForms : []).map((value) => {
                  const selection = value && typeof value === "object" ? value as Record<string, unknown> : {}, characterIndex = Number(selection.characterIndex), requestedForm = String(selection.form || "").trim(), form = characters[characterIndex - 1]?.forms.find((item) => item.name === requestedForm);
                  return form && frameCharacterIndexes.includes(characterIndex) ? { characterIndex, form: form.name } : null;
                }).filter((value): value is { characterIndex:number; form:string } => Boolean(value));
              return {
                title: String(frame.title || `画面 ${frameIndex + 1}`).slice(
                  0,
                  60,
                ),
                imagePrompt: compactImagePrompt(
                  String(frame.imagePrompt || imagePrompt),
                ),
                keyframe: ["start", "middle", "end"].includes(String(frame.keyframe))
                  ? String(frame.keyframe)
                  : rawFrames.length === 1 || frameIndex === 0
                    ? "start"
                    : frameIndex === rawFrames.length - 1
                      ? "end"
                      : "middle",
                inherit: String(frame.inherit || shot.continuity || "").slice(0, 240),
                change: String(frame.change || frame.imagePrompt || action || "").slice(0, 240),
                lock: String(frame.lock || "人物身份、服饰形态、关键道具、空间方向与统一画风保持不变").slice(0, 240),
                characterIndexes: frameCharacterIndexes,
                characterForms: frameCharacterForms,
                propIndexes: framePropIndexes,
              };
            })
            .filter((frame) => frame.imagePrompt),
          // Re-evaluate the final packaged plan from visible frame evidence.
          // Never revive a stale model boolean, and never treat exclusions
          // such as `无群众` or `禁止路人` as positive crowd evidence.
          crowdEvidence = frames
            .map(
              (frame) =>
                `${frame.title} ${frame.imagePrompt} ${frame.inherit} ${frame.change}`,
            )
            .join(" "),
          hasAnonymousCrowd = resolveVisibleAnonymousCrowd(
            shot.hasAnonymousCrowd,
            shot.hasAnonymousCrowd,
            shot.crowdPrompt,
            `${String(shot.storyBeat || "")} ${String(shot.action || "")} ${String(shot.scene || "")} ${crowdEvidence}`,
          ),
          crowdPrompt = hasAnonymousCrowd
            ? compactImagePrompt(
                String(
                  shot.crowdPrompt ||
                    `匿名背景人群，个体脸型、发型、年龄、体型、服装与动作各不相同，自然分散，禁止复制任何具名角色`,
                ),
                160,
              )
            : "",
          visibleCharacterIndexes = [
            ...new Set(frames.flatMap((frame) => frame.characterIndexes)),
          ],
          visiblePropIndexes = [
            ...new Set(frames.flatMap((frame) => frame.propIndexes)),
          ];
        const requestedSceneId = String(shot.sceneId || `scene-${index + 1}`).slice(0, 80),
          sceneEvidence = `${scene} ${storyBeat} ${action} ${String(shot.scenePrompt || "")}`,
          canonicalScene = scenes.find((item) => item.sceneId === requestedSceneId) ||
            scenes.find((item) => item.name.length >= 2 && sceneEvidence.includes(item.name)),
          sceneId = canonicalScene?.sceneId || requestedSceneId;
        return {
          number: index + 1,
          title: String(shot.title || `镜头 ${index + 1}`).slice(0, 50),
          duration: Math.max(3, Math.min(8, Number(shot.duration) || 5)),
          storyBeat,
          action,
          scene,
          sceneId,
          sceneView: ["main", "reverse", "left", "right", "top"].includes(String(shot.sceneView))
            ? String(shot.sceneView)
            : "main",
          scenePrompt: compactImagePrompt(
            sanitizeCharacterNamesFromScenePrompt(
              String(canonicalScene?.imagePrompt || shot.scenePrompt || "环境空间结构、陈设、界面与光影，保持统一美术风格"),
              characters.map((character) => character.name),
            ),
            160,
          ),
          characterIndexes: visibleCharacterIndexes,
          propIndexes: visiblePropIndexes,
          hasAnonymousCrowd,
          crowdPrompt,
          dialogue,
          frames,
          imagePrompt: frames[0]?.imagePrompt || imagePrompt,
          videoPrompt: String(shot.videoPrompt || "").slice(0, 800),
          transition: String(shot.transition || "").slice(0, 300),
          continuity: String(shot.continuity || "").slice(0, 500),
          referenceIndexes: Array.isArray(shot.referenceIndexes)
            ? [
                ...new Set(
                  shot.referenceIndexes
                    .map(Number)
                    .filter(
                      (number) =>
                        Number.isInteger(number) &&
                        number >= 1 &&
                        number <= visualInputs.length,
                    ),
                ),
              ]
            : [],
        };
      })
      .filter((shot) => shot.frames.length && shot.videoPrompt);
    finalizeComicSceneDependencies(scenes, shots, props);
    shots.forEach((shot, index) => {
      const rawShot =
          rawShots[index] && typeof rawShots[index] === "object"
            ? (rawShots[index] as Record<string, unknown>)
            : {},
        rawForms = Array.isArray(rawShot.characterForms)
          ? rawShot.characterForms
          : [],
        characterForms = rawForms
          .slice(0, 12)
          .map((value) => {
            const selection =
                value && typeof value === "object"
                  ? (value as Record<string, unknown>)
                  : {},
              characterIndex = Number(selection.characterIndex),
              requestedForm = String(
                selection.form || selection.formName || "",
              ).trim(),
              character = characters[characterIndex - 1],
              form = character?.forms.find(
                (item) => item.name === requestedForm,
              );
            return form && shot.characterIndexes.includes(characterIndex)
              ? { characterIndex, form: form.name }
              : null;
          })
          .filter((value): value is { characterIndex: number; form: string } =>
            Boolean(value),
          );
      (
        shot as typeof shot & {
          characterForms: Array<{ characterIndex: number; form: string }>;
        }
      ).characterForms = characterForms;
    });
    if (!shots.length) throw new SyntaxError("missing shots");
    const outline = (Array.isArray(plan.outline) ? plan.outline : [])
      .slice(0, 8)
      .map((value, index) => {
        const item =
          value && typeof value === "object"
            ? (value as Record<string, unknown>)
            : {};
        return {
          act: String(item.act || `第 ${index + 1} 幕`).slice(0, 50),
          content: String(item.content || "").slice(0, 1200),
        };
      });
    const result = {
      title: String(confirmedBriefTitle || plan.title || "未命名漫剧").slice(0, 100),
      logline: String(plan.logline || "").slice(0, 600),
      tone: String(plan.tone || "").slice(0, 300),
      duration:
        duration === "由对话内容推断"
          ? String(
              plan.duration ||
                `${shots.reduce((sum, shot) => sum + shot.duration, 0)} 秒`,
            ).slice(0, 30)
          : duration,
      aspectRatio:
        aspectRatio === "由对话内容推断"
          ? ["9:16", "16:9", "1:1"].includes(String(plan.aspectRatio))
            ? String(plan.aspectRatio)
            : "9:16"
          : aspectRatio,
      characters,
      props,
      scenes,
      outline,
      shots,
      changeSummary: String(plan.changeSummary || "").slice(0, 300),
      model: streamState.usedModel,
    };
    database.run(
      "UPDATE comic_sessions SET phase=?,plan=?,pending_revision=?,generation_status='succeeded',generation_stage='完整剧本已完成',generation_progress=100,generation_error='',generation_checkpoint='{}',generation_issues='[]',updated_at=? WHERE id=? AND user_id=? AND project_id=?",
      [
        "generated",
        JSON.stringify(result),
        "",
        new Date().toISOString(),
        sessionId,
        String(user.id),
        projectId,
      ],
    );
    persist();
    emit({ type: "result", data: result });
    reply.raw.end();
    return;
  } catch (error) {
    if (streamHeartbeat) clearInterval(streamHeartbeat);
    request.log.error(
      {
        message: error instanceof Error ? error.message : String(error),
        elapsedMs: Date.now() - streamState.startedAt,
        receivedBytes: streamState.receivedBytes,
        progress: streamState.progress,
        idleSeconds: Math.floor((Date.now() - streamState.lastContentAt) / 1000),
      },
      "comic agent failed",
    );
    const issue = comicGenerationIssue(
        error,
        streamState.progress,
        Boolean(checkpoint.story || checkpoint.assets || checkpoint.shotPlan),
      ),
      message = comicGenerationErrorMessage(error, issue);
    database.run(
      "UPDATE comic_sessions SET generation_status='failed',generation_stage='生成失败',generation_error=?,generation_issues=?,updated_at=? WHERE id=?",
      [message, JSON.stringify([issue]), new Date().toISOString(), sessionId],
    );
    persist();
    if (streamStarted) {
      if (!reply.raw.destroyed)
        reply.raw.write(
          `${JSON.stringify({ type: "error", error: message, issues: [issue] })}\n`,
        );
      if (!reply.raw.destroyed) reply.raw.end();
      return;
    }
    return reply
      .code(
        error instanceof DOMException && error.name === "TimeoutError"
          ? 504
          : 502,
      )
      .send({ error: message });
  } finally {
    activeComicPlans.delete(comicLockKey);
  }
});
app.get("/agents/comic/session", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const query = request.query as { projectId?: string; sessionId?: string },
    projectId = String(query.projectId || ""),
    requestedSessionId = String(query.sessionId || "").trim();
  if (!projectId || !ownsProject(projectId, String(user.id)))
    return reply.code(404).send({ error: "当前项目不存在" });
  const fields = "id,phase,brief,messages,pending_revision AS pendingRevision,plan,generation_status AS generationStatus,generation_stage AS generationStage,generation_progress AS generationProgress,generation_received_bytes AS generationReceivedBytes,generation_error AS generationError,generation_issues AS generationIssues,generation_checkpoint AS generationCheckpoint,updated_at AS updatedAt",
    session = requestedSessionId
      ? getOne(
          `SELECT ${fields} FROM comic_sessions WHERE id=? AND user_id=? AND project_id=? LIMIT 1`,
          [requestedSessionId, String(user.id), projectId],
        )
      : getOne(
          `SELECT ${fields} FROM comic_sessions WHERE user_id=? AND project_id=? AND generation_status='running' ORDER BY updated_at DESC LIMIT 1`,
          [String(user.id), projectId],
        );
  if (!session) return reply.code(204).send();
  let checkpoint: Record<string, unknown> = {};
  try {
    checkpoint = JSON.parse(String(session.generationCheckpoint || "{}"));
  } catch {
    checkpoint = {};
  }
  return {
    ...session,
    brief: JSON.parse(String(session.brief || "{}")),
    messages: JSON.parse(String(session.messages || "[]")),
    plan: session.plan ? JSON.parse(String(session.plan)) : null,
    generationIssues: JSON.parse(String(session.generationIssues || "[]")),
    hasGenerationCheckpoint: Boolean(
      checkpoint.story || checkpoint.assets || checkpoint.shotPlan,
    ),
    generationCheckpoint: undefined,
  };
});
app.get("/user-api-models", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  return getAll(
    "SELECT id, kind, name, model, base_url AS baseUrl, CASE WHEN proxy_url IS NULL OR proxy_url = ? THEN 0 ELSE 1 END AS hasProxy, created_at AS createdAt, updated_at AS updatedAt FROM user_api_models WHERE user_id = ? ORDER BY created_at ASC",
    ["", String(user.id)],
  ).map((item) => ({
    ...item,
    hasProxy: Boolean(item.hasProxy),
    hasKey: true,
  }));
});
app.post("/feedback", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const body = request.body as {
      type?: string;
      title?: string;
      content?: string;
      contact?: string;
      projectId?: string;
      pageUrl?: string;
      userAgent?: string;
    },
    type = body.type === "bug" ? "bug" : "suggestion",
    title = String(body.title || "").trim(),
    content = String(body.content || "").trim(),
    contact = String(body.contact || "").trim(),
    projectId = String(body.projectId || "").trim();
  if (title.length < 2 || title.length > 100)
    return reply.code(400).send({ error: "标题需要 2–100 个字符" });
  if (content.length < 5 || content.length > 5000)
    return reply.code(400).send({ error: "请填写 5–5000 个字符的详细说明" });
  if (contact.length > 200)
    return reply.code(400).send({ error: "联系方式过长" });
  if (
    projectId &&
    !getOne("SELECT id FROM projects WHERE id = ? AND user_id = ?", [
      projectId,
      String(user.id),
    ])
  )
    return reply.code(400).send({ error: "项目信息无效" });
  const id = randomUUID(),
    now = new Date().toISOString();
  database.run(
    "INSERT INTO feedback (id,user_id,project_id,type,title,content,contact,page_url,user_agent,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [
      id,
      String(user.id),
      projectId || null,
      type,
      title,
      content,
      contact || null,
      String(body.pageUrl || "").slice(0, 500),
      String(body.userAgent || "").slice(0, 1000),
      "open",
      now,
    ],
  );
  persist();
  request.log.info(
    { feedbackId: id, userId: user.id, type, projectId: projectId || null },
    "user feedback submitted",
  );
  return reply.code(201).send({ id, status: "open", createdAt: now });
});
app.get("/notifications", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  return getAll(
    "SELECT n.id,n.title,n.content,n.type,n.created_at AS createdAt,CASE WHEN r.read_at IS NULL THEN 0 ELSE 1 END AS isRead FROM notifications n LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.user_id=? ORDER BY n.created_at DESC LIMIT 100",
    [String(user.id)],
  ).map((item) => ({ ...item, isRead: Boolean(item.isRead) }));
});
app.get("/notifications/stream", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  reply.hijack();
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  notificationStreams.set(reply.raw, String(user.id));
  sendNotificationSync(reply.raw);
  broadcastPresence();
  const heartbeat = setInterval(() => {
    if (!reply.raw.destroyed) {
      reply.raw.write(`: keepalive ${Date.now()}\n\n`);
      sendPresence(reply.raw);
    }
  }, 25000);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    if (notificationStreams.delete(reply.raw)) broadcastPresence();
  };
  request.raw.once("close", close);
  reply.raw.once("close", close);
});
app.post("/notifications/claim-popup", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const localDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
    item = getOne(
      "SELECT n.id FROM notifications n LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.user_id=? LEFT JOIN notification_popups p ON p.notification_id=n.id AND p.user_id=? AND p.local_date=? WHERE n.auto_popup=1 AND n.priority='important' AND r.read_at IS NULL AND p.notification_id IS NULL ORDER BY n.created_at DESC LIMIT 1",
      [String(user.id), String(user.id), localDate],
    );
  if (!item) return { show: false };
  database.run(
    "INSERT OR IGNORE INTO notification_popups (notification_id,user_id,local_date,shown_at) VALUES (?,?,?,?)",
    [String(item.id), String(user.id), localDate, new Date().toISOString()],
  );
  persist();
  return { show: true, notificationId: String(item.id) };
});
app.post("/notifications/:id/read", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const { id } = request.params as { id: string };
  if (!getOne("SELECT id FROM notifications WHERE id=?", [id]))
    return reply.code(404).send({ error: "通知不存在" });
  database.run(
    "INSERT OR REPLACE INTO notification_reads (notification_id,user_id,read_at) VALUES (?,?,?)",
    [id, String(user.id), new Date().toISOString()],
  );
  persist();
  return { ok: true };
});
app.post("/notifications/read-all", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const now = new Date().toISOString();
  for (const item of getAll("SELECT id FROM notifications", []))
    database.run(
      "INSERT OR REPLACE INTO notification_reads (notification_id,user_id,read_at) VALUES (?,?,?)",
      [String(item.id), String(user.id), now],
    );
  persist();
  return { ok: true };
});
app.post("/admin/projects/export-videos", async (request, reply) => {
  const admin = requireAdmin(request, reply);
  if (!admin) return;
  const body = (request.body ?? {}) as {
      projectId?: string;
      username?: string;
      projectName?: string;
      directory?: string;
    },
    projectId = String(body.projectId || "").trim(),
    username = String(body.username || "").trim().toLowerCase(),
    projectName = String(body.projectName || "").trim(),
    requestedDirectory = String(body.directory || "").trim().replace(/\\/g, "/");
  if (!requestedDirectory || isAbsolute(requestedDirectory) || requestedDirectory.split("/").some((part) => !part || part === "." || part === ".."))
    return reply.code(400).send({ error: "directory 必须是导出根目录下的安全相对子目录" });
  const destination = resolve(videoExportRoot, requestedDirectory),relativeDestination=relative(videoExportRoot,destination);
  if (!relativeDestination || relativeDestination.startsWith("..") || isAbsolute(relativeDestination))
    return reply.code(400).send({ error: "目标目录超出允许的导出范围" });
  let project: Record<string, unknown> | undefined;
  if (projectId)
    project = getOne("SELECT projects.id,projects.name,projects.user_id AS userId,users.username,users.name AS userName FROM projects JOIN users ON users.id=projects.user_id WHERE projects.id=?", [projectId]);
  else if (username && projectName)
    project = getOne("SELECT projects.id,projects.name,projects.user_id AS userId,users.username,users.name AS userName FROM projects JOIN users ON users.id=projects.user_id WHERE lower(users.username)=? AND projects.name=? ORDER BY projects.updated_at DESC LIMIT 1", [username, projectName]);
  else return reply.code(400).send({ error: "请提供 projectId，或同时提供 username 和 projectName" });
  if (!project) return reply.code(404).send({ error: "项目不存在" });
  const canvas = getOne("SELECT document FROM project_canvases WHERE project_id=?", [String(project.id)]);
  if (!canvas) return reply.code(404).send({ error: "项目画布不存在" });
  let document: Record<string, unknown>;
  try { document = JSON.parse(String(canvas.document || "{}")) as Record<string, unknown> }
  catch { return reply.code(409).send({ error: "项目画布数据损坏，无法导出" }) }
  const nodes = (Array.isArray(document.nodes) ? document.nodes : []).filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object")),
    generators = nodes.filter((node) => node.kind === "video" && node.role !== "result").sort((left, right) => Number(left.y || 0) - Number(right.y || 0) || Number(left.x || 0) - Number(right.x || 0) || Number(left.id || 0) - Number(right.id || 0)),
    exported: Array<Record<string, unknown>> = [], skipped: Array<Record<string, unknown>> = [];
  mkdirSync(destination, { recursive: true });
  for (const generator of generators) {
    const results = nodes.filter((node) => node.kind === "video" && node.role === "result" && Number(node.sourceNodeId) === Number(generator.id) && node.status === "succeeded" && String(node.mediaUrl || "")).sort((left, right) => Number(right.x || 0) - Number(left.x || 0) || Number(right.id || 0) - Number(left.id || 0)),
      result = results[0];
    if (!result) { skipped.push({ nodeId: generator.id, title: generator.title, reason: "没有成功的视频结果" }); continue }
    const match = String(result.mediaUrl).match(/\/api\/assets\/([^/]+)\//),assetId=match?.[1],asset=assetId?getOne("SELECT id,name,mime_type AS mimeType,size,storage_name AS storageName FROM assets WHERE id=? AND project_id=? AND user_id=?",[assetId,String(project.id),String(project.userId)]):undefined;
    if (!asset || !String(asset.mimeType || "").startsWith("video/")) { skipped.push({ nodeId: generator.id, title: generator.title, resultNodeId: result.id, reason: "视频资产不存在或不属于该项目" }); continue }
    const source=resolve(uploadDirectory,String(asset.storageName)),uploadRelative=relative(resolve(uploadDirectory),source);
    if (!uploadRelative || uploadRelative.startsWith("..") || isAbsolute(uploadRelative) || !existsSync(source)) { skipped.push({ nodeId: generator.id, title: generator.title, resultNodeId: result.id, reason: "视频源文件不存在" }); continue }
    const number=exported.length+1,fileName=`${number}.mp4`,target=resolve(destination,fileName);
    copyFileSync(source,target);
    exported.push({ number, fileName, nodeId: generator.id, title: generator.title, resultNodeId: result.id, assetId, size: Number(asset.size || 0) });
  }
  request.log.info({ adminId: admin.id, projectId: project.id, directory: requestedDirectory, exported: exported.length, skipped: skipped.length }, "project videos exported");
  return reply.send({ project: { id: project.id, name: project.name, username: project.username, userName: project.userName }, directory: requestedDirectory, exportRoot: videoExportRoot, exported, skipped });
});

app.get("/admin/feedback", async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  const query = request.query as {
      status?: string;
      type?: string;
      limit?: string;
    },
    status = String(query.status || "all"),
    type = String(query.type || "all"),
    limit = Math.min(
      500,
      Math.max(1, Number.parseInt(String(query.limit || "100"), 10) || 100),
    ),
    where: string[] = [],
    parameters: (string | number)[] = [];
  if (["open", "reviewing", "resolved", "closed"].includes(status)) {
    where.push("f.status=?");
    parameters.push(status);
  }
  if (["bug", "suggestion"].includes(type)) {
    where.push("f.type=?");
    parameters.push(type);
  }
  parameters.push(limit);
  return getAll(
    `SELECT f.id,f.type,f.title,f.content,f.contact,f.project_id AS projectId,p.name AS projectName,f.page_url AS pageUrl,f.user_agent AS userAgent,f.status,f.created_at AS createdAt,u.id AS userId,u.name AS userName,u.username,u.email FROM feedback f JOIN users u ON u.id=f.user_id LEFT JOIN projects p ON p.id=f.project_id ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY f.created_at DESC LIMIT ?`,
    parameters,
  );
});
app.patch("/admin/feedback/:id", async (request, reply) => {
  const admin = requireAdmin(request, reply);
  if (!admin) return;
  const { id } = request.params as { id: string },
    body = request.body as { status?: string },
    status = String(body.status || "").trim();
  if (!["open", "reviewing", "resolved", "closed"].includes(status))
    return reply
      .code(400)
      .send({ error: "反馈状态仅支持 open、reviewing、resolved、closed" });
  const feedback = getOne("SELECT id,title,status FROM feedback WHERE id=?", [
    id,
  ]);
  if (!feedback) return reply.code(404).send({ error: "反馈不存在" });
  database.run("UPDATE feedback SET status=? WHERE id=?", [status, id]);
  persist();
  request.log.info(
    { feedbackId: id, status, adminId: admin.id },
    "admin feedback status updated",
  );
  return {
    id: String(feedback.id),
    title: String(feedback.title),
    previousStatus: String(feedback.status),
    status,
  };
});
app.post("/admin/notifications", async (request, reply) => {
  const admin = requireAdmin(request, reply);
  if (!admin) return;
  const body = request.body as {
      title?: string;
      content?: string;
      type?: string;
      priority?: string;
      autoPopup?: boolean;
    },
    title = String(body.title || "").trim(),
    content = String(body.content || "").trim(),
    type = String(body.type || "update").trim(),
    priority = body.priority === "important" ? "important" : "normal",
    autoPopup = body.autoPopup === true;
  if (title.length < 2 || title.length > 100)
    return reply.code(400).send({ error: "通知标题需要 2–100 个字符" });
  if (content.length < 2 || content.length > 3000)
    return reply.code(400).send({ error: "通知内容需要 2–3000 个字符" });
  if (!["update", "fix", "notice", "maintenance"].includes(type))
    return reply
      .code(400)
      .send({ error: "通知类型仅支持 update、fix、notice、maintenance" });
  const id = randomUUID(),
    createdAt = new Date().toISOString();
  database.run(
    "INSERT INTO notifications (id,title,content,type,created_at,priority,auto_popup) VALUES (?,?,?,?,?,?,?)",
    [id, title, content, type, createdAt, priority, autoPopup ? 1 : 0],
  );
  persist();
  broadcastNotificationSync();
  request.log.info(
    { notificationId: id, adminId: admin.id, type, priority, autoPopup },
    "admin notification published",
  );
  return reply
    .code(201)
    .send({ id, title, content, type, priority, autoPopup, createdAt });
});
app.post("/user-api-models", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const body = request.body as {
      kind?: string;
      name?: string;
      model?: string;
      baseUrl?: string;
      apiKey?: string;
      proxyUrl?: string;
    },
    kind = String(body.kind ?? ""),
    name = String(body.name ?? "").trim(),
    model = String(body.model ?? "").trim(),
    baseUrl = normalizeHttpUrl(body.baseUrl),
    apiKey = String(body.apiKey ?? "").trim(),
    proxyUrl = String(body.proxyUrl ?? "").trim();
  if (!["image", "video"].includes(kind))
    return reply.code(400).send({ error: "请选择图像或视频类型" });
  if (
    !name ||
    name.length > 60 ||
    !model ||
    model.length > 120 ||
    !baseUrl ||
    !apiKey
  )
    return reply
      .code(400)
      .send({ error: "请完整填写名称、模型、接口地址和密钥" });
  if (proxyUrl && !normalizeHttpUrl(proxyUrl))
    return reply.code(400).send({ error: "代理地址无效" });
  const id = randomUUID(),
    now = new Date().toISOString();
  database.run(
    "INSERT INTO user_api_models (id,user_id,kind,name,model,base_url,api_key,proxy_url,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [
      id,
      String(user.id),
      kind,
      name,
      model,
      baseUrl,
      apiKey,
      proxyUrl,
      now,
      now,
    ],
  );
  persist();
  return reply
    .code(201)
    .send({
      id,
      kind,
      name,
      model,
      baseUrl,
      hasKey: true,
      hasProxy: Boolean(proxyUrl),
      createdAt: now,
      updatedAt: now,
    });
});
app.delete("/user-api-models/:id", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const { id } = request.params as { id: string };
  database.run("DELETE FROM user_api_models WHERE id = ? AND user_id = ?", [
    id,
    String(user.id),
  ]);
  persist();
  return reply.code(204).send();
});
app.post("/user-api-models/test", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const body = request.body as { baseUrl?: string; apiKey?: string };
  const baseUrl = normalizeHttpUrl(body.baseUrl),
    apiKey = String(body.apiKey ?? "").trim();
  if (!baseUrl || !apiKey)
    return reply.code(400).send({ error: "请填写接口地址和密钥" });
  try {
    const response = await fetch(`${baseUrl}/v1/models`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok)
      return reply.code(400).send({ error: `接口返回 ${response.status}` });
    return { ok: true };
  } catch (error) {
    return reply
      .code(400)
      .send({ error: error instanceof Error ? error.message : "连接失败" });
  }
});
app.get("/generation-inputs/:assetId", async (request, reply) => {
  const { assetId } = request.params as { assetId: string };
  const { expires, signature } = request.query as {
    expires?: string;
    signature?: string;
  };
  const expiry = Number(expires);
  if (
    !Number.isFinite(expiry) ||
    expiry < Math.floor(Date.now() / 1000) ||
    expiry > Math.floor(Date.now() / 1000) + 3600 ||
    !signature ||
    !validGenerationInputSignature(assetId, expiry, signature)
  )
    return reply
      .code(403)
      .send({ error: "Generation input URL is invalid or expired" });
  const asset = getOne(
    "SELECT mime_type, storage_name FROM assets WHERE id = ?",
    [assetId],
  );
  if (!asset) return reply.code(404).send({ error: "Asset not found" });
  return reply
    .type(String(asset.mime_type))
    .header("cache-control", "private, no-store")
    .send(readFileSync(`${uploadDirectory}/${asset.storage_name}`));
});
app.post("/client-logs", async (request) => {
  const input = request.body as {
    event?: string;
    details?: unknown;
    userAgent?: string;
    path?: string;
    timestamp?: string;
  };
  app.log.warn(
    {
      clientDiagnostic: {
        event: String(input.event ?? "unknown").slice(0, 100),
        details: input.details,
        userAgent: String(input.userAgent ?? "").slice(0, 500),
        path: String(input.path ?? "").slice(0, 300),
        timestamp: input.timestamp,
      },
    },
    "client diagnostic",
  );
  return { ok: true };
});
app.get("/mock/:file", async (request, reply) => {
  const { file } = request.params as { file: string };
  const label = file.startsWith("video-") ? "VIDEO PREVIEW" : "IMAGE PREVIEW";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#172d30"/><stop offset=".5" stop-color="#315f69"/><stop offset="1" stop-color="#c5e969"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="960" cy="180" r="210" fill="#fff" opacity=".08"/><circle cx="210" cy="620" r="330" fill="#fff" opacity=".06"/><text x="72" y="570" fill="#fff" font-family="system-ui" font-size="54" font-weight="700">${label}</text><text x="76" y="625" fill="#fff" opacity=".7" font-family="system-ui" font-size="24">Custom provider result pipeline is ready</text></svg>`;
  return reply
    .type("image/svg+xml")
    .header("cache-control", "no-store")
    .send(svg);
});
app.post("/auth/register", async (request, reply) => {
  const body = request.body as {
      name?: string;
      email?: string;
      password?: string;
      inviteCode?: string;
    },
    name = String(body.name ?? "").trim(),
    email = normalizeEmail(body.email),
    password = String(body.password ?? ""),
    inviteCode = String(body.inviteCode ?? "").trim(),
    configuredInviteCode = String(
      process.env.REGISTRATION_INVITE_CODE ?? "",
    ).trim();
  const inviter = inviteCode
    ? getOne("SELECT id FROM users WHERE upper(invite_code) = ?", [
        inviteCode.toUpperCase(),
      ])
    : undefined;
  if (!configuredInviteCode && !inviter)
    return reply.code(503).send({ error: "注册暂未开放" });
  if (
    !inviter &&
    (!configuredInviteCode ||
      !secureTextEqual(inviteCode, configuredInviteCode))
  )
    return reply.code(403).send({ error: "邀请码无效" });
  if (name.length < 2 || name.length > 40)
    return reply.code(400).send({ error: "昵称长度需要在 2 到 40 个字符之间" });
  if (!validEmail(email))
    return reply.code(400).send({ error: "请输入有效邮箱" });
  if (password.length < 8 || password.length > 128)
    return reply.code(400).send({ error: "密码至少需要 8 个字符" });
  if (getOne("SELECT id FROM users WHERE lower(email) = ?", [email]))
    return reply.code(409).send({ error: "该邮箱已注册" });
  if (
    getOne("SELECT id FROM users WHERE lower(username) = ?", [
      name.toLowerCase(),
    ])
  )
    return reply.code(409).send({ error: "该用户名已被使用" });
  const now = new Date().toISOString(),
    legacy = getOne(
      "SELECT id FROM users WHERE id = ? AND (email IS NULL OR email = ?)",
      [developmentUserId, ""],
    );
  let userId: string;
  if (legacy) {
    userId = developmentUserId;
    database.run(
      "UPDATE users SET name = ?, email = ?, password_hash = ?, username = COALESCE(NULLIF(username, ?), ?), invited_by = COALESCE(invited_by, ?) WHERE id = ?",
      [
        name,
        email,
        hashPassword(password),
        "",
        name,
        inviter?.id ?? null,
        userId,
      ],
    );
  } else {
    userId = randomUUID();
    database.run(
      "INSERT INTO users (id, name, email, password_hash, username, invite_code, invited_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        userId,
        name,
        email,
        hashPassword(password),
        name,
        newInviteCode(),
        inviter?.id ?? null,
        now,
      ],
    );
    createDefaultProject(userId, now);
  }
  const token = createSession(userId, now);
  persist();
  setSessionCookie(request, reply, token);
  if (!legacy)
    database.run("UPDATE users SET credits = 5 WHERE id = ?", [userId]);
  const createdUser = getOne(
    "SELECT username, invite_code AS inviteCode, credits, reserved_credits AS reservedCredits, is_admin AS isAdmin FROM users WHERE id = ?",
    [userId],
  );
  return reply
    .code(201)
    .send({
      id: userId,
      name,
      username: createdUser?.username,
      email,
      inviteCode: createdUser?.inviteCode,
      createdAt: now,
      credits: Number(createdUser?.credits ?? 0),
      reservedCredits: Number(createdUser?.reservedCredits ?? 0),
      isAdmin: Boolean(createdUser?.isAdmin),
    });
});
app.post("/auth/login", async (request, reply) => {
  const body = request.body as {
      email?: string;
      account?: string;
      password?: string;
    },
    account = String(body.account ?? body.email ?? "")
      .trim()
      .toLowerCase(),
    password = String(body.password ?? ""),
    user = getOne(
      "SELECT id, name, username, email, password_hash, invite_code AS inviteCode, created_at AS createdAt, credits, reserved_credits AS reservedCredits, is_admin AS isAdmin FROM users WHERE lower(email) = ? OR lower(username) = ? ORDER BY CASE WHEN lower(email) = ? THEN 0 ELSE 1 END LIMIT 1",
      [account, account, account],
    );
  if (!user || !verifyPassword(password, String(user.password_hash ?? "")))
    return reply.code(401).send({ error: "用户名、邮箱或密码错误" });
  const token = createSession(String(user.id));
  persist();
  setSessionCookie(request, reply, token);
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    inviteCode: user.inviteCode,
    createdAt: user.createdAt,
    credits: Number(user.credits ?? 0),
    reservedCredits: Number(user.reservedCredits ?? 0),
    isAdmin: Boolean(user.isAdmin),
  };
});
app.post("/auth/logout", async (request, reply) => {
  const token = sessionToken(request);
  if (token)
    database.run("DELETE FROM sessions WHERE id = ?", [sessionId(token)]);
  persist();
  clearSessionCookie(request, reply);
  return { ok: true };
});
app.post("/auth/activity", async (request, reply) => {
  const token = sessionToken(request);
  if (!token) return reply.code(401).send({ error: "Unauthorized" });
  const id = sessionId(token),
    now = new Date(),
    cutoff = new Date(now.getTime() - sessionIdleTimeoutMs).toISOString(),
    session = getOne(
      "SELECT id FROM sessions WHERE id=? AND expires_at>? AND COALESCE(last_activity_at,created_at)>?",
      [id, now.toISOString(), cutoff],
    );
  if (!session) {
    database.run("DELETE FROM sessions WHERE id=?", [id]);
    persist();
    clearSessionCookie(request, reply);
    return reply.code(401).send({ error: "Session expired" });
  }
  database.run("UPDATE sessions SET last_activity_at=? WHERE id=?", [
    now.toISOString(),
    id,
  ]);
  persist();
  return { ok: true };
});
app.get("/users/me", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    inviteCode: user.inviteCode,
    createdAt: user.createdAt,
    credits: Number(user.credits ?? 0),
    reservedCredits: Number(user.reservedCredits ?? 0),
    isAdmin: Boolean(user.isAdmin),
  };
});
app.post("/users/me/api-token", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const token = `viora_${randomBytes(30).toString("base64url")}`,
    hint = `${token.slice(0, 10)}…${token.slice(-6)}`;
  database.run(
    "UPDATE users SET api_token_hash=?,api_token_hint=? WHERE id=?",
    [hashApiToken(token), hint, String(user.id)],
  );
  persist();
  return { token, hint, createdAt: new Date().toISOString() };
});
app.get("/users/me/api-token", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const row = getOne("SELECT api_token_hint AS hint FROM users WHERE id=?", [
    String(user.id),
  ]);
  return { exists: Boolean(row?.hint), hint: String(row?.hint || "") };
});
app.patch("/users/me", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const name = String((request.body as { name?: string }).name ?? "").trim();
  if (name.length < 2 || name.length > 40)
    return reply.code(400).send({ error: "昵称长度需要在 2 到 40 个字符之间" });
  database.run("UPDATE users SET name = ? WHERE id = ?", [
    name,
    String(user.id),
  ]);
  persist();
  return { ...user, name };
});
app.post("/users/me/credits/redeem", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const code = normalizeRechargeCode((request.body as { code?: string }).code),
    codeHash = hashRechargeCode(code);
  if (!code) return reply.code(400).send({ error: "请输入充值码" });
  const voucher = getOne(
    "SELECT id,credits,redeemed_by AS redeemedBy FROM recharge_codes WHERE code_hash = ?",
    [codeHash],
  );
  if (!voucher) return reply.code(404).send({ error: "充值码无效" });
  if (voucher.redeemedBy)
    return reply.code(409).send({ error: "该充值码已经使用" });
  const now = new Date().toISOString(),
    amount = Number(voucher.credits);
  database.run("BEGIN");
  try {
    database.run(
      "UPDATE recharge_codes SET redeemed_by = ?, redeemed_at = ? WHERE id = ? AND redeemed_by IS NULL",
      [String(user.id), now, String(voucher.id)],
    );
    database.run("UPDATE users SET credits = credits + ? WHERE id = ?", [
      amount,
      String(user.id),
    ]);
    database.run(
      "INSERT INTO credit_transactions (id,user_id,amount,type,reference_id,created_at) VALUES (?,?,?,?,?,?)",
      [
        randomUUID(),
        String(user.id),
        amount,
        "recharge",
        String(voucher.id),
        now,
      ],
    );
    database.run("COMMIT");
  } catch (error) {
    database.run("ROLLBACK");
    throw error;
  }
  persist();
  const updated = getOne(
    "SELECT credits,reserved_credits AS reservedCredits FROM users WHERE id = ?",
    [String(user.id)],
  );
  return {
    ok: true,
    added: amount,
    credits: Number(updated?.credits ?? 0),
    reservedCredits: Number(updated?.reservedCredits ?? 0),
  };
});
app.post("/admin/recharge-codes", async (request, reply) => {
  const user = currentUser(request),
    expected = String(process.env.CREDIT_ADMIN_KEY || ""),
    actual = String(request.headers["x-admin-key"] || ""),
    authorized =
      Boolean(user?.isAdmin) ||
      (Boolean(expected && actual) && secureTextEqual(actual, expected));
  if (!authorized)
    return reply.code(403).send({ error: "仅管理员可以生成充值码" });
  const body = request.body as { credits?: number; count?: number },
    credits = Math.floor(Number(body.credits)),
    count = Math.min(100, Math.max(1, Math.floor(Number(body.count || 1))));
  if (!Number.isFinite(credits) || credits < 1 || credits > 100000)
    return reply.code(400).send({ error: "点数需要在 1 到 100000 之间" });
  const now = new Date().toISOString(),
    codes: string[] = [];
  for (let index = 0; index < count; index++) {
    const code = `VIO-${credits}-${randomBytes(5).toString("hex").toUpperCase()}`;
    database.run(
      "INSERT INTO recharge_codes (id,code_hash,credits,created_at) VALUES (?,?,?,?)",
      [randomUUID(), hashRechargeCode(code), credits, now],
    );
    codes.push(code);
  }
  persist();
  return { credits, count, codes };
});
app.get("/showcase", async () =>
  getAll(
    `SELECT assets.id, assets.name, assets.mime_type AS mimeType, assets.created_at AS createdAt, users.name AS author
  FROM assets JOIN users ON users.id = assets.user_id WHERE assets.is_public = 1 ORDER BY assets.created_at DESC LIMIT 30`,
    [],
  ).map((asset) => ({
    ...asset,
    url: namedAssetUrl(String(asset.id), String(asset.name), true),
    thumbnailUrl: assetThumbnailUrl(
      String(asset.id),
      String(asset.mimeType),
      true,
    ),
  })),
);

app.get("/projects", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const userId = String(user.id);
  return getAll(
    `SELECT projects.id, projects.name, projects.created_at AS createdAt, projects.updated_at AS updatedAt, COALESCE(projects.last_opened_at, projects.updated_at) AS lastOpenedAt,
  (SELECT count(*) FROM assets WHERE assets.project_id = projects.id AND assets.user_id = projects.user_id) AS assetCount,
  (SELECT id FROM assets WHERE assets.project_id = projects.id AND assets.user_id = projects.user_id AND assets.mime_type LIKE 'image/%' ORDER BY assets.created_at DESC LIMIT 1) AS previewAssetId
  FROM projects WHERE projects.user_id = ? ORDER BY COALESCE(projects.last_opened_at, projects.updated_at) DESC`,
    [userId],
  ).map((project) => {
    const canvas = getOne(
      "SELECT document FROM project_canvases WHERE project_id = ?",
      [String(project.id)],
    );
    let nodeCount = 0;
    try {
      nodeCount =
        JSON.parse(String(canvas?.document ?? "{}")).nodes?.length ?? 0;
    } catch {
      /* malformed legacy canvas */
    }
    return {
      ...project,
      nodeCount,
      previewUrl: project.previewAssetId
        ? `/api/assets/${project.previewAssetId}/thumbnail`
        : null,
    };
  });
});
app.post("/projects", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const body = request.body as { name?: string },
    id = randomUUID(),
    now = new Date().toISOString();
  database.run(
    "INSERT INTO projects (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    [id, String(user.id), body.name?.trim() || "未命名项目", now, now],
  );
  database.run(
    "INSERT INTO project_canvases (project_id, document, updated_at) VALUES (?, ?, ?)",
    [id, emptyCanvas(), now],
  );
  persist();
  return reply
    .code(201)
    .send({
      id,
      name: body.name?.trim() || "未命名项目",
      createdAt: now,
      updatedAt: now,
    });
});
app.patch("/projects/:projectId", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const userId = String(user.id),
    { projectId } = request.params as { projectId: string },
    name = String((request.body as { name?: string }).name ?? "").trim();
  if (!ownsProject(projectId, userId))
    return reply.code(404).send({ error: "Project not found" });
  if (!name || name.length > 60)
    return reply.code(400).send({ error: "项目名称需要在 1 到 60 个字符之间" });
  const now = new Date().toISOString();
  database.run(
    "UPDATE projects SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?",
    [name, now, projectId, userId],
  );
  persist();
  return { id: projectId, name, updatedAt: now };
});
app.post("/projects/:projectId/duplicate", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const userId = String(user.id),
    { projectId } = request.params as { projectId: string },
    source = getOne("SELECT name FROM projects WHERE id = ? AND user_id = ?", [
      projectId,
      userId,
    ]);
  if (!source) return reply.code(404).send({ error: "Project not found" });
  const id = randomUUID(),
    now = new Date().toISOString(),
    name = `${String(source.name)} 副本`,
    canvas = getOne(
      "SELECT document FROM project_canvases WHERE project_id = ?",
      [projectId],
    );
  database.run(
    "INSERT INTO projects (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    [id, userId, name, now, now],
  );
  database.run(
    "INSERT INTO project_canvases (project_id, document, updated_at) VALUES (?, ?, ?)",
    [id, String(canvas?.document ?? emptyCanvas()), now],
  );
  for (const asset of getAll(
    "SELECT name, mime_type, size, storage_name, is_public FROM assets WHERE project_id = ? AND user_id = ?",
    [projectId, userId],
  )) {
    const assetId = randomUUID(),
      storageName = `${assetId}.bin`;
    copyFileSync(
      `${uploadDirectory}/${asset.storage_name}`,
      `${uploadDirectory}/${storageName}`,
    );
    database.run(
      "INSERT INTO assets (id, project_id, user_id, name, mime_type, size, storage_name, is_public, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        assetId,
        id,
        userId,
        asset.name,
        asset.mime_type,
        asset.size,
        storageName,
        0,
        now,
      ],
    );
  }
  persist();
  return reply.code(201).send({ id, name, createdAt: now, updatedAt: now });
});
app.delete("/projects/:projectId", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const userId = String(user.id),
    { projectId } = request.params as { projectId: string };
  if (!ownsProject(projectId, userId))
    return reply.code(404).send({ error: "Project not found" });
  const projectCount = Number(
    getOne("SELECT count(*) AS count FROM projects WHERE user_id = ?", [userId])
      ?.count ?? 0,
  );
  if (projectCount <= 1)
    return reply.code(409).send({ error: "至少需要保留一个项目" });
  const files = getAll(
    "SELECT storage_name FROM assets WHERE project_id = ? AND user_id = ?",
    [projectId, userId],
  );
  for (const file of files) {
    const path = `${uploadDirectory}/${file.storage_name}`;
    if (existsSync(path)) unlinkSync(path);
  }
  database.run("DELETE FROM assets WHERE project_id = ? AND user_id = ?", [
    projectId,
    userId,
  ]);
  database.run("DELETE FROM project_canvases WHERE project_id = ?", [
    projectId,
  ]);
  database.run("DELETE FROM canvas_versions WHERE project_id = ?", [projectId]);
  database.run("DELETE FROM canvas_operations WHERE project_id = ?", [projectId]);
  database.run("DELETE FROM canvas_operation_batches WHERE project_id = ?", [projectId]);
  database.run("DELETE FROM jobs WHERE project_id = ? AND user_id = ?", [
    projectId,
    userId,
  ]);
  database.run(
    "DELETE FROM comic_sessions WHERE project_id = ? AND user_id = ?",
    [projectId, userId],
  );
  database.run("DELETE FROM projects WHERE id = ? AND user_id = ?", [
    projectId,
    userId,
  ]);
  persist();
  return reply.code(204).send();
});

app.get("/projects/:projectId/canvas", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const { projectId } = request.params as { projectId: string };
  if (!ownsProject(projectId, String(user.id)))
    return reply.code(404).send({ error: "Project not found" });
  const row = getOne(
    "SELECT document, updated_at, version FROM project_canvases WHERE project_id = ?",
    [projectId],
  );
  if (!row) return reply.code(404).send({ error: "Canvas not found" });
  database.run("UPDATE projects SET last_opened_at = ? WHERE id = ?", [
    new Date().toISOString(),
    projectId,
  ]);
  persist();
  const document = reconcileCanvasJobs(
    JSON.parse(String(row.document)),
    projectId,
    String(user.id),
  );
  return {
    projectId,
    ...document,
    version: Number(row.version) || 1,
    updatedAt: row.updated_at,
  };
});

function reconcileCanvasJobs(
  document: Record<string, unknown>,
  projectId: string,
  userId: string,
) {
  const nodes = Array.isArray(document.nodes) ? document.nodes : [];
  const pending = nodes.filter((value) => {
    if (!value || typeof value !== "object") return false;
    const node = value as Record<string, unknown>;
    return (
      (node.kind === "image" || node.kind === "video") &&
      ["queued", "running", "waiting"].includes(String(node.status || ""))
    );
  }) as Record<string, unknown>[];
  if (!pending.length) return document;

  const jobs = getAll(
    "SELECT id,node_id,kind,status,progress,result_url,result_metadata,error,updated_at FROM jobs WHERE project_id=? AND user_id=? ORDER BY updated_at DESC,rowid DESC",
    [projectId, userId],
  );
  const byId = new Map(jobs.map((job) => [String(job.id), job]));
  const latestByNode = new Map<number, Record<string, unknown>>();
  for (const job of jobs) {
    const nodeId = Number(job.node_id);
    if (Number.isSafeInteger(nodeId) && !latestByNode.has(nodeId))
      latestByNode.set(nodeId, job);
  }

  for (const node of pending) {
    const explicit = node.jobId ? byId.get(String(node.jobId)) : undefined;
    const fallback = latestByNode.get(Number(node.id));
    const job = explicit || fallback;
    if (!job || String(job.kind) !== String(node.kind)) continue;
    node.jobId = String(job.id);
    node.status = String(job.status);
    node.progress = Number(job.progress) || 0;
    if (job.result_url) node.mediaUrl = String(job.result_url);
    if (job.result_metadata) {
      try { node.videoResult = JSON.parse(String(job.result_metadata)); }
      catch { /* 保留旧任务兼容 */ }
    }
    if (job.error) node.error = String(job.error);
    else delete node.error;
  }
  return document;
}
app.post("/projects/:projectId/canvas/id-block", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const { projectId } = request.params as { projectId: string };
  if (!ownsProject(projectId, String(user.id))) return reply.code(404).send({ error: "Project not found" });
  const requested = Math.floor(Number((request.body as { count?: number })?.count || 10000));
  const count = Math.max(100, Math.min(100000, requested));
  const row = getOne("SELECT next_node_id AS nextNodeId FROM project_canvases WHERE project_id=?", [projectId]);
  if (!row) return reply.code(404).send({ error: "Canvas not found" });
  const start = Math.max(1, Number(row.nextNodeId) || 1), end = start + count - 1;
  if (!Number.isSafeInteger(end)) return reply.code(507).send({ error: "canvas_id_space_exhausted" });
  database.run("UPDATE project_canvases SET next_node_id=? WHERE project_id=?", [end + 1, projectId]);
  persist();
  return { projectId, start, end };
});
app.put("/projects/:projectId/canvas", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const { projectId } = request.params as { projectId: string };
  if (!ownsProject(projectId, String(user.id)))
    return reply.code(404).send({ error: "Project not found" });
  const body = request.body as CanvasPayload,
    now = new Date().toISOString(),
    document = JSON.stringify({
      nodes: body.nodes,
      links: body.links,
      camera: body.camera,
    }),
    previous = getOne(
      "SELECT document,updated_at,version FROM project_canvases WHERE project_id=?",
      [projectId],
    );
  if (!previous) return reply.code(404).send({ error: "Canvas not found" });
  const serverVersion = Math.max(1, Number(previous.version) || 1),
    requestedVersion = Number(body.version);
  if (!Number.isSafeInteger(requestedVersion))
    return reply
      .code(428)
      .send({
        error: "canvas_version_required",
        message: "页面缺少画布版本，请重新同步",
        version: serverVersion,
        updatedAt: String(previous.updated_at),
      });
  if (requestedVersion !== serverVersion + 1)
    return reply
      .code(409)
      .send({
        error: "canvas_conflict",
        message:
          requestedVersion <= serverVersion
            ? "当前页面版本已落后，请重新同步"
            : "画布版本不连续，请重新同步",
        version: serverVersion,
        updatedAt: String(previous.updated_at),
      });
  const previousNodes = (() => {
      try {
        return JSON.parse(String(previous.document || "{}")).nodes?.length || 0;
      } catch {
        return 0;
      }
    })(),
    nextNodes = Array.isArray(body.nodes) ? body.nodes.length : 0;
  if (previousNodes > 0 && nextNodes === 0)
    return reply
      .code(409)
      .send({
        error: "canvas_empty_guard",
        message: "自动保存不允许清空非空画布，请使用清除画布操作",
        version: serverVersion,
        updatedAt: String(previous.updated_at),
      });
  if (String(previous.document) !== document) {
    const lastVersion = getOne(
        "SELECT created_at FROM canvas_versions WHERE project_id=? ORDER BY created_at DESC LIMIT 1",
        [projectId],
      ),
      shouldSnapshot =
        !lastVersion ||
        Date.now() - Date.parse(String(lastVersion.created_at)) >= 60_000;
    if (shouldSnapshot)
      database.run(
        "INSERT INTO canvas_versions (id,project_id,document,canvas_version,created_at) VALUES (?,?,?,?,?)",
        [
          randomUUID(),
          projectId,
          String(previous.document),
          serverVersion,
          now,
        ],
      );
    database.run(
      "DELETE FROM canvas_versions WHERE project_id=? AND id NOT IN (SELECT id FROM canvas_versions WHERE project_id=? ORDER BY created_at DESC LIMIT 50)",
      [projectId, projectId],
    );
  }
  database.run(
    "UPDATE project_canvases SET document=?,updated_at=?,version=?,reset_version=? WHERE project_id=?",
    [document, now, requestedVersion, requestedVersion, projectId],
  );
  database.run(
    "INSERT INTO canvas_operations (id,project_id,batch_id,version,record_type,record_key,action,payload,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    [
      randomUUID(),
      projectId,
      `legacy-${randomUUID()}`,
      requestedVersion,
      "canvas",
      "*",
      "replace",
      null,
      now,
    ],
  );
  database.run("UPDATE projects SET updated_at = ? WHERE id = ?", [
    now,
    projectId,
  ]);
  persist();
  return { projectId, version: requestedVersion, updatedAt: now };
});
app.post("/projects/:projectId/canvas/clear", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const { projectId } = request.params as { projectId: string };
  if (!ownsProject(projectId, String(user.id)))
    return reply.code(404).send({ error: "Project not found" });
  const body = request.body as { version?: number; preserveLabels?: boolean },
    previous = getOne(
      "SELECT document,updated_at,version FROM project_canvases WHERE project_id=?",
      [projectId],
    );
  if (!previous) return reply.code(404).send({ error: "Canvas not found" });
  const serverVersion = Math.max(1, Number(previous.version) || 1),
    requestedVersion = Number(body.version);
  if (
    !Number.isSafeInteger(requestedVersion) ||
    requestedVersion !== serverVersion + 1
  )
    return reply
      .code(409)
      .send({
        error: "canvas_conflict",
        message: "画布版本已变化，请重新载入后再清除",
        version: serverVersion,
        updatedAt: String(previous.updated_at),
      });
  let nextDocument = emptyCanvas();
  if (body.preserveLabels) {
    try {
      const current = JSON.parse(String(previous.document || "{}")) as { nodes?: Array<{ id?: number; kind?: string }>; links?: Array<{ from?: number; to?: number } | [number, number]>; camera?: unknown };
      const retainedNodes = (Array.isArray(current.nodes) ? current.nodes : []).filter((node) => node?.kind === "prompt"), retainedIds = new Set(retainedNodes.map((node) => Number(node.id))), retainedLinks = (Array.isArray(current.links) ? current.links : []).filter((link) => { const from = Array.isArray(link) ? link[0] : link?.from, to = Array.isArray(link) ? link[1] : link?.to; return retainedIds.has(Number(from)) && retainedIds.has(Number(to)); });
      nextDocument = JSON.stringify({ nodes: retainedNodes, links: retainedLinks, camera: current.camera || { x: 80, y: 10, zoom: 0.9 } });
    } catch {
      return reply.code(500).send({ error: "canvas_document_invalid", message: "服务器画布结构异常，已停止清除" });
    }
  }
  const now = new Date().toISOString(),
    batchId = `clear-${randomUUID()}`;
  database.run("BEGIN");
  try {
    database.run(
      "INSERT INTO canvas_versions (id,project_id,document,canvas_version,created_at) VALUES (?,?,?,?,?)",
      [randomUUID(), projectId, String(previous.document), serverVersion, now],
    );
    database.run(
      "UPDATE project_canvases SET document=?,updated_at=?,version=?,reset_version=? WHERE project_id=?",
      [nextDocument, now, requestedVersion, requestedVersion, projectId],
    );
    database.run(
      "INSERT INTO canvas_operations (id,project_id,batch_id,version,record_type,record_key,action,payload,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [
        randomUUID(),
        projectId,
        batchId,
        requestedVersion,
        "canvas",
        "*",
        "clear",
        null,
        now,
      ],
    );
    database.run("UPDATE projects SET updated_at=? WHERE id=?", [
      now,
      projectId,
    ]);
    database.run(
      "DELETE FROM canvas_versions WHERE project_id=? AND id NOT IN (SELECT id FROM canvas_versions WHERE project_id=? ORDER BY created_at DESC LIMIT 50)",
      [projectId, projectId],
    );
    database.run("COMMIT");
  } catch (error) {
    database.run("ROLLBACK");
    throw error;
  }
  persist();
  return { projectId, version: requestedVersion, updatedAt: now, ...JSON.parse(nextDocument) };
});
app.post("/projects/:projectId/canvas/sync", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const { projectId } = request.params as { projectId: string },
    userId = String(user.id);
  if (!ownsProject(projectId, userId))
    return reply.code(404).send({ error: "Project not found" });
  const body = request.body as {
      clientId?: string;
      batchId?: string;
      baseVersion?: number;
      operations?: CanvasOperation[];
    },
    clientId = String(body.clientId || ""),
    batchId = String(body.batchId || ""),
    baseVersion = Number(body.baseVersion),
    operations = Array.isArray(body.operations) ? body.operations : [];
  if (
    !/^[a-zA-Z0-9_-]{8,100}$/.test(clientId) ||
    !/^[a-zA-Z0-9_-]{8,100}$/.test(batchId)
  )
    return reply
      .code(400)
      .send({
        error: "canvas_sync_identity_invalid",
        message: "同步客户端或批次标识无效",
      });
  const existingBatch = getOne(
    "SELECT response FROM canvas_operation_batches WHERE project_id=? AND batch_id=?",
    [projectId, batchId],
  );
  if (existingBatch) {
    const cached=decodeCanvasBatchResponse(String(existingBatch.response));
    if(cached?.expired)return reply.code(409).send({error:"canvas_batch_expired",message:"同步批次已过期，请重新载入画布"});
    return cached;
  }
  if (!Number.isSafeInteger(baseVersion) || baseVersion < 1)
    return reply
      .code(428)
      .send({
        error: "canvas_version_required",
        message: "页面缺少有效基线版本，请重新同步",
      });
  if (!operations.length || operations.length > 1000)
    return reply
      .code(400)
      .send({
        error: "canvas_operations_invalid",
        message: "同步操作数量需要在 1–1000 之间",
      });
  const previous = getOne(
    "SELECT document,updated_at,version,reset_version AS resetVersion FROM project_canvases WHERE project_id=?",
    [projectId],
  );
  if (!previous) return reply.code(404).send({ error: "Canvas not found" });
  const serverVersion = Math.max(1, Number(previous.version) || 1),
    resetVersion = Math.max(0, Number(previous.resetVersion) || 0);
  if (baseVersion > serverVersion)
    return reply
      .code(409)
      .send({
        error: "canvas_conflict",
        message: "客户端版本超前，请重新同步",
        version: serverVersion,
      });
  if (baseVersion < resetVersion)
    return reply
      .code(409)
      .send({
        error: "canvas_reset_conflict",
        message: "画布在此设备离线期间被整体替换或清空，请重新同步",
        version: serverVersion,
      });
  let normalized: CanvasOperation[] = [];
  const
    touched = new Set<string>();
  for (const raw of operations) {
    if (
      !raw ||
      !["node", "link", "camera"].includes(raw.type) ||
      !["upsert", "delete"].includes(raw.action)
    )
      return reply
        .code(400)
        .send({
          error: "canvas_operation_invalid",
          message: "存在无法识别的同步操作",
        });
    const key = String(raw.key || "");
    if (
      !key ||
      key.length > 240 ||
      (raw.type === "camera" && key !== "camera") ||
      (raw.type === "camera" && raw.action === "delete")
    )
      return reply
        .code(400)
        .send({
          error: "canvas_operation_invalid",
          message: "同步记录标识无效",
        });
    if (
      raw.action === "upsert" &&
      (raw.value === null ||
        typeof raw.value !== "object" ||
        JSON.stringify(raw.value).length > 2_000_000)
    )
      return reply
        .code(400)
        .send({
          error: "canvas_operation_invalid",
          message: "同步记录内容无效或过大",
        });
    const operation = {
      type: raw.type,
      action: raw.action,
      key,
      ...(raw.action === "upsert" ? { value: raw.value } : {}),
    } as CanvasOperation;
    normalized.push(operation);
    touched.add(`${raw.type}:${key}`);
  }
  if (baseVersion < serverVersion) {
    const remote = getAll(
        "SELECT record_type AS type,record_key AS key,version FROM canvas_operations WHERE project_id=? AND version>? ORDER BY version ASC",
        [projectId, baseVersion],
      ),
      conflicts = remote.filter(
        (item) =>
          String(item.type) === "canvas" ||
          touched.has(`${String(item.type)}:${String(item.key)}`),
      );
    if (conflicts.length)
      return reply
        .code(409)
        .send({
          error: "canvas_record_conflict",
          message: "同一节点或连线已在其他设备修改，请重新同步",
          version: serverVersion,
          conflicts: conflicts
            .slice(0, 30)
            .map((item) => ({
              type: item.type,
              key: item.key,
              version: item.version,
            })),
        });
  }
  let source: { nodes?: unknown[]; links?: unknown[]; camera?: unknown };
  try {
    source = JSON.parse(String(previous.document));
  } catch {
    return reply
      .code(500)
      .send({ error: "canvas_corrupt", message: "服务器画布数据无法解析" });
  }
  const nodeMap = new Map<string, Record<string, unknown>>();
  for (const value of Array.isArray(source.nodes) ? source.nodes : []) {
    if (!value || typeof value !== "object") continue;
    const node = value as Record<string, unknown>;
    nodeMap.set(String(node.id), structuredClone(node));
  }
  const linkKey = (value: Record<string, unknown>) =>
      `${String(value.from)}:${String(value.to)}:${String(value.fromSide || "right")}:${String(value.toSide || "left")}`,
    linkMap = new Map<string, Record<string, unknown>>();
  for (const value of Array.isArray(source.links) ? source.links : []) {
    const link = Array.isArray(value)
      ? { from: value[0], to: value[1], fromSide: "right", toSide: "left" }
      : value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : null;
    if (link) linkMap.set(linkKey(link), structuredClone(link));
  }
  let nextCamera: unknown =
    source.camera && typeof source.camera === "object"
      ? structuredClone(source.camera)
      : { x: 0, y: 0, zoom: 1 };
  // Older/open clients may still submit a node on every job-progress poll.
  // Progress and the queued/running transition are transient job state, so
  // discard an operation when those are the only differences. This server
  // guard prevents stale tabs from forcing a full SQL.js export every 1.5s.
  const stableActiveJobNode = (value: Record<string, unknown>) => {
    const copy = structuredClone(value);
    if (["queued", "running"].includes(String(copy.status))) {
      copy.status = "active";
      copy.progress = 0;
    }
    return copy;
  };
  normalized = normalized.filter((operation) => {
    if (operation.type !== "node" || operation.action !== "upsert") return true;
    const current = nodeMap.get(operation.key),
      incoming = operation.value as Record<string, unknown>;
    if (
      !current ||
      !current.jobId ||
      String(current.jobId) !== String(incoming.jobId) ||
      !["queued", "running"].includes(String(current.status)) ||
      !["queued", "running"].includes(String(incoming.status))
    )
      return true;
    return (
      JSON.stringify(stableActiveJobNode(current)) !==
      JSON.stringify(stableActiveJobNode(incoming))
    );
  });
  if (normalized.length === 0)
    return {
      projectId,
      version: serverVersion,
      updatedAt: String(previous.updatedAt),
      nodes: [...nodeMap.values()],
      links: [...linkMap.values()],
      camera: nextCamera,
      mergedFromVersion: baseVersion,
    };
  for (const operation of normalized) {
    if (operation.type === "node") {
      if (operation.action === "delete") nodeMap.delete(operation.key);
      else {
        const node = operation.value as Record<string, unknown>;
        if (String(node.id) !== operation.key)
          return reply
            .code(400)
            .send({
              error: "canvas_operation_invalid",
              message: "节点 ID 与操作标识不一致",
            });
        nodeMap.set(operation.key, structuredClone(node));
      }
    } else if (operation.type === "link") {
      if (operation.action === "delete") linkMap.delete(operation.key);
      else {
        const link = operation.value as Record<string, unknown>;
        if (linkKey(link) !== operation.key)
          return reply
            .code(400)
            .send({
              error: "canvas_operation_invalid",
              message: "连线内容与操作标识不一致",
            });
        linkMap.set(operation.key, structuredClone(link));
      }
    } else nextCamera = structuredClone(operation.value);
  }
  const nodeIds = new Set(nodeMap.keys());
  for (const link of linkMap.values())
    if (!nodeIds.has(String(link.from)) || !nodeIds.has(String(link.to)))
      return reply
        .code(409)
        .send({
          error: "canvas_reference_conflict",
          message: "合并后存在悬空连线，请重新同步",
          version: serverVersion,
        });
  const resultVersion = serverVersion + 1,
    now = new Date().toISOString(),
    documentObject = {
      nodes: [...nodeMap.values()],
      links: [...linkMap.values()],
      camera: nextCamera,
    },
    document = JSON.stringify(documentObject),
    response = {
      projectId,
      version: resultVersion,
      updatedAt: now,
      ...documentObject,
      mergedFromVersion: baseVersion,
    };
  database.run("BEGIN");
  try {
    for (const operation of normalized)
      database.run(
        "INSERT INTO canvas_operations (id,project_id,batch_id,version,record_type,record_key,action,payload,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        [
          randomUUID(),
          projectId,
          batchId,
          resultVersion,
          operation.type,
          operation.key,
          operation.action,
          operation.action === "upsert"
            ? JSON.stringify(operation.value)
            : null,
          now,
        ],
      );
    database.run(
      "UPDATE project_canvases SET document=?,updated_at=?,version=? WHERE project_id=?",
      [document, now, resultVersion, projectId],
    );
    database.run("UPDATE projects SET updated_at=? WHERE id=?", [
      now,
      projectId,
    ]);
    database.run(
      "INSERT INTO canvas_operation_batches (project_id,batch_id,client_id,base_version,result_version,response,created_at) VALUES (?,?,?,?,?,?,?)",
      [
        projectId,
        batchId,
        clientId,
        baseVersion,
        resultVersion,
        encodeCanvasBatchResponse(response),
        now,
      ],
    );
    compactCanvasSyncHistory(projectId);
    database.run("COMMIT");
  } catch (error) {
    database.run("ROLLBACK");
    throw error;
  }
  persist();
  return response;
});

app.get("/projects/:projectId/assets", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const userId = String(user.id),
    { projectId } = request.params as { projectId: string };
  if (!ownsProject(projectId, userId))
    return reply.code(404).send({ error: "Project not found" });
  return getAll(
    "SELECT id, name, mime_type AS mimeType, size, is_public AS isPublic, created_at AS createdAt FROM assets WHERE project_id = ? AND user_id = ? ORDER BY created_at DESC",
    [projectId, userId],
  ).map((asset) => ({
    ...asset,
    isPublic: Boolean(asset.isPublic),
    url: namedAssetUrl(String(asset.id), String(asset.name)),
    thumbnailUrl: assetThumbnailUrl(String(asset.id), String(asset.mimeType)),
  }));
});
app.get("/assets", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const userId = String(user.id);
  return getAll(
    `SELECT assets.id, assets.project_id AS projectId, projects.name AS projectName, assets.name, assets.mime_type AS mimeType, assets.size, assets.is_public AS isPublic, assets.created_at AS createdAt FROM assets JOIN projects ON projects.id = assets.project_id WHERE assets.user_id = ? ORDER BY assets.created_at DESC`,
    [userId],
  ).map((asset) => ({
    ...asset,
    isPublic: Boolean(asset.isPublic),
    url: namedAssetUrl(String(asset.id), String(asset.name)),
    thumbnailUrl: assetThumbnailUrl(String(asset.id), String(asset.mimeType)),
  }));
});
app.post("/projects/:projectId/assets", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const userId = String(user.id),
    { projectId } = request.params as { projectId: string };
  if (!ownsProject(projectId, userId))
    return reply.code(404).send({ error: "Project not found" });
  const body = request.body as {
      files?: Array<{ name: string; mimeType: string; data: string }>;
    },
    uploaded = [];
  for (const file of body.files ?? []) {
    const bytes = Buffer.from(file.data, "base64");
    if (bytes.length > 100 * 1024 * 1024)
      return reply.code(413).send({ error: "Asset exceeds 100MB" });
    const id = randomUUID(),
      storageName = `${id}.bin`,
      now = new Date().toISOString();
    writeFileSync(`${uploadDirectory}/${storageName}`, bytes);
    database.run(
      "INSERT INTO assets (id, project_id, user_id, name, mime_type, size, storage_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        projectId,
        userId,
        file.name,
        file.mimeType,
        bytes.length,
        storageName,
        now,
      ],
    );
    uploaded.push({
      id,
      name: file.name,
      mimeType: file.mimeType,
      size: bytes.length,
      createdAt: now,
      url: namedAssetUrl(id, file.name),
    });
  }
  persist();
  return reply.code(201).send(uploaded);
});
app.get("/assets/:assetId/content", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const { assetId } = request.params as { assetId: string };
  const asset = getOne("SELECT name FROM assets WHERE id = ? AND user_id = ?", [
    assetId,
    String(user.id),
  ]);
  if (!asset) return reply.code(404).send({ error: "Asset not found" });
  return reply
    .code(302)
    .header("location", namedAssetUrl(assetId, String(asset.name)))
    .send();
});
app.get("/assets/:assetId/content/:filename", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const { assetId } = request.params as { assetId: string };
  const asset = getOne(
    "SELECT name, mime_type, storage_name FROM assets WHERE id = ? AND user_id = ?",
    [assetId, String(user.id)],
  );
  if (!asset) return reply.code(404).send({ error: "Asset not found" });
  reply
    .type(String(asset.mime_type))
    .header("content-disposition", assetDisposition(String(asset.name)))
    .header("cache-control", "private, max-age=3600");
  return reply.send(readFileSync(`${uploadDirectory}/${asset.storage_name}`));
});
app.get("/assets/:assetId/thumbnail", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const { assetId } = request.params as { assetId: string };
  const asset = getOne(
    "SELECT mime_type, storage_name FROM assets WHERE id = ? AND user_id = ?",
    [assetId, String(user.id)],
  );
  if (!asset) return reply.code(404).send({ error: "Asset not found" });
  return sendAssetThumbnail(reply, assetId, asset);
});
app.get("/public/assets/:assetId/content", async (request, reply) => {
  const { assetId } = request.params as { assetId: string };
  const asset = getOne(
    "SELECT name FROM assets WHERE id = ? AND is_public = 1",
    [assetId],
  );
  if (!asset) return reply.code(404).send({ error: "Asset not found" });
  return reply
    .code(302)
    .header("location", namedAssetUrl(assetId, String(asset.name), true))
    .send();
});
app.get("/public/assets/:assetId/content/:filename", async (request, reply) => {
  const { assetId } = request.params as { assetId: string };
  const asset = getOne(
    "SELECT name, mime_type, storage_name FROM assets WHERE id = ? AND is_public = 1",
    [assetId],
  );
  if (!asset) return reply.code(404).send({ error: "Asset not found" });
  reply
    .type(String(asset.mime_type))
    .header("content-disposition", assetDisposition(String(asset.name)))
    .header("cache-control", "public, max-age=3600");
  return reply.send(readFileSync(`${uploadDirectory}/${asset.storage_name}`));
});
app.get("/public/assets/:assetId/thumbnail", async (request, reply) => {
  const { assetId } = request.params as { assetId: string };
  const asset = getOne(
    "SELECT mime_type, storage_name FROM assets WHERE id = ? AND is_public = 1",
    [assetId],
  );
  if (!asset) return reply.code(404).send({ error: "Asset not found" });
  return sendAssetThumbnail(reply, assetId, asset, true);
});
app.patch("/assets/:assetId/visibility", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const userId = String(user.id),
    { assetId } = request.params as { assetId: string };
  const asset = getOne("SELECT id FROM assets WHERE id = ? AND user_id = ?", [
    assetId,
    userId,
  ]);
  if (!asset) return reply.code(404).send({ error: "Asset not found" });
  const body = request.body as { isPublic?: boolean };
  database.run("UPDATE assets SET is_public = ? WHERE id = ? AND user_id = ?", [
    body.isPublic ? 1 : 0,
    assetId,
    userId,
  ]);
  persist();
  return { id: assetId, isPublic: Boolean(body.isPublic) };
});
app.delete("/assets/:assetId", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const userId = String(user.id),
    { assetId } = request.params as { assetId: string };
  const asset = getOne(
    "SELECT storage_name FROM assets WHERE id = ? AND user_id = ?",
    [assetId, userId],
  );
  if (!asset) return reply.code(404).send({ error: "Asset not found" });
  const path = `${uploadDirectory}/${asset.storage_name}`;
  if (existsSync(path)) unlinkSync(path);
  database.run("DELETE FROM assets WHERE id = ? AND user_id = ?", [
    assetId,
    userId,
  ]);
  persist();
  return reply.code(204).send();
});

app.get("/canvases/:id", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const { id } = request.params as { id: string };
  if (!ownsProject(id, String(user.id)))
    return reply.code(404).send({ error: "Canvas not found" });
  const row = getOne(
    "SELECT id, title, document, updated_at FROM canvases WHERE id = ?",
    [id],
  );
  if (!row) return reply.code(404).send({ error: "Canvas not found" });
  return {
    id: row.id,
    title: row.title,
    ...JSON.parse(String(row.document)),
    updatedAt: row.updated_at,
  };
});

app.put("/canvases/:id", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const { id } = request.params as { id: string };
  if (!ownsProject(id, String(user.id)))
    return reply.code(404).send({ error: "Canvas not found" });
  const body = request.body as CanvasPayload & { title?: string };
  const now = new Date().toISOString();
  database.run(
    `INSERT INTO canvases (id, title, document, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET title = excluded.title, document = excluded.document, updated_at = excluded.updated_at`,
    [
      id,
      body.title ?? "未命名项目",
      JSON.stringify({
        nodes: body.nodes,
        links: body.links,
        camera: body.camera,
      }),
      now,
    ],
  );
  persist();
  return { id, updatedAt: now };
});

app.post("/jobs", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const userId = String(user.id);
  const input = request.body as JobInput;
  if (!input.prompt?.trim())
    return reply.code(400).send({ error: "Prompt is required" });
  const projectId = input.projectId ?? defaultProjectId;
  if (!ownsProject(projectId, userId))
    return reply.code(404).send({ error: "Project not found" });
  let model =
    input.model ??
    (input.kind === "video"
      ? process.env.AGNES_VIDEO_DEFAULT_MODEL || "agnes-video-v2.0"
      : process.env.OPENAI_IMAGE_DEFAULT_MODEL || "gpt-image-2");
  if (model === "gemini-3.1-flash-image")
    return reply
      .code(503)
      .send({ error: "Gemini 图片模型仍处于实验性适配阶段，暂未开放生成" });
  const creditCost =
    model === "grok-imagine-video-1.5-preview"
      ? 2
      : model === "grok-imagine-image"
        ? 1
        : 0;
  if (
    creditCost &&
    Number(user.credits ?? 0) - Number(user.reservedCredits ?? 0) < creditCost
  )
    return reply
      .code(402)
      .send({ error: `创作点数不足，当前模型每次生成需要 ${creditCost} 点` });
  const customId = model.startsWith("custom:") ? model.slice(7) : "",
    custom = customId
      ? getOne("SELECT * FROM user_api_models WHERE id = ? AND user_id = ?", [
          customId,
          userId,
        ])
      : undefined;
  if (customId && (!custom || String(custom.kind) !== input.kind))
    return reply.code(400).send({ error: "自定义模型不存在或类型不匹配" });
  if (custom) model = String(custom.model);
  const inputUrls = input.inputUrls ?? [];
  if (input.kind === "video" && model.startsWith("agnes-")) {
    const referenceMode = input.parameters?.reference_mode === "keyframes" ? "keyframes" : "references";
    if (referenceMode === "keyframes" && inputUrls.length < 2)
      return reply.code(400).send({ error: "Agnes 关键帧动画至少需要 2 张按顺序连接的图片" });
    if (referenceMode !== "keyframes" && inputUrls.length > 1)
      return reply.code(400).send({ error: "Agnes 官方接口不支持多图自由参考，请改用关键帧动画" });
    const ratio = String(input.parameters?.aspect_ratio || "16:9");
    if (!["1:1", "4:3", "3:4", "16:9", "9:16"].includes(ratio))
      return reply.code(400).send({ error: "Agnes 不支持当前视频画幅" });
  }
  try {
    validateOwnedInputUrls(inputUrls, userId, input.kind);
  } catch (error) {
    return reply
      .code(400)
      .send({
        error: error instanceof Error ? error.message : "无法读取输入素材",
      });
  }
  const finalPrompt = input.prompt.trim(),
    promptLimit =
      input.kind === "video"
        ? 4000
        : input.promptProfile === "character"
          ? 600
          : input.promptProfile === "storyboard" ||
              input.promptProfile === "composite"
            ? 400
          : 320;
  if (finalPrompt.length > promptLimit)
    return reply
      .code(400)
      .send({
        error: `最终提示词长度 ${finalPrompt.length} 超过当前类型上限 ${promptLimit}，请精简当前描述`,
      });
  const id = randomUUID(),
    now = new Date().toISOString();
  if (creditCost)
    database.run(
      "UPDATE users SET reserved_credits = reserved_credits + ? WHERE id = ?",
      [creditCost, userId],
    );
  database.run(
    "INSERT INTO jobs (id, project_id, user_id, node_id, kind, prompt, model, status, progress, input_urls, parameters, custom_model_id, credit_cost, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      projectId,
      userId,
      input.nodeId,
      input.kind,
      finalPrompt,
      model,
      "queued",
      0,
      JSON.stringify(inputUrls),
      JSON.stringify(input.parameters ?? {}),
      customId || null,
      creditCost,
      now,
      now,
    ],
  );
  persist();
  queueMicrotask(pumpGenerationQueue);
  return reply
    .code(202)
    .send({
      id,
      status: "queued",
      progress: 0,
      model,
      provider: generationProvider.name,
      creditCost,
      creditsAvailable:
        Number(user.credits ?? 0) -
        Number(user.reservedCredits ?? 0) -
        creditCost,
    });
});

app.get("/jobs/:id", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const { id } = request.params as { id: string };
  const row = getOne("SELECT * FROM jobs WHERE id = ? AND user_id = ?", [
    id,
    String(user.id),
  ]);
  return row ?? reply.code(404).send({ error: "Job not found" });
});

app.post("/projects/:projectId/jobs/cancel-active", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const userId = String(user.id),
    { projectId } = request.params as { projectId: string };
  if (!ownsProject(projectId, userId))
    return reply.code(404).send({ error: "Project not found" });
  const active = getAll(
      "SELECT id,credit_cost,credit_settled FROM jobs WHERE project_id=? AND user_id=? AND status IN ('queued','running')",
      [projectId, userId],
    ),
    now = new Date().toISOString();
  if (!active.length) return { ok: true, canceled: 0 };
  database.run("BEGIN");
  try {
    for (const job of active) {
      const cost = Number(job.credit_cost ?? 0);
      if (cost && !Boolean(job.credit_settled)) {
        database.run(
          "UPDATE users SET reserved_credits=MAX(0,reserved_credits-?) WHERE id=?",
          [cost, userId],
        );
        database.run("UPDATE jobs SET credit_settled=1 WHERE id=?", [
          String(job.id),
        ]);
      }
    }
    database.run(
      "UPDATE jobs SET status='canceled',progress=0,error='用户已取消',updated_at=? WHERE project_id=? AND user_id=? AND status IN ('queued','running')",
      [now, projectId, userId],
    );
    database.run("COMMIT");
  } catch (error) {
    database.run("ROLLBACK");
    throw error;
  }
  persist();
  queueMicrotask(pumpGenerationQueue);
  request.log.info(
    { userId, projectId, canceled: active.length },
    "active project jobs canceled",
  );
  return { ok: true, canceled: active.length };
});

app.post("/projects/:projectId/jobs/cancel-pending", async (request, reply) => {
  const user = requireUser(request, reply);
  if (!user) return;
  const userId = String(user.id),
    { projectId } = request.params as { projectId: string };
  if (!ownsProject(projectId, userId))
    return reply.code(404).send({ error: "Project not found" });
  const pending = getAll(
      "SELECT id,credit_cost,credit_settled FROM jobs WHERE project_id=? AND user_id=? AND status='queued'",
      [projectId, userId],
    ),
    now = new Date().toISOString();
  if (!pending.length) return { ok: true, canceled: 0, ids: [] };
  database.run("BEGIN");
  try {
    for (const job of pending) {
      const cost = Number(job.credit_cost ?? 0);
      if (cost && !Boolean(job.credit_settled)) {
        database.run(
          "UPDATE users SET reserved_credits=MAX(0,reserved_credits-?) WHERE id=?",
          [cost, userId],
        );
        database.run("UPDATE jobs SET credit_settled=1 WHERE id=?", [
          String(job.id),
        ]);
      }
    }
    database.run(
      "UPDATE jobs SET status='canceled',progress=0,error='用户取消等待任务',updated_at=? WHERE project_id=? AND user_id=? AND status='queued'",
      [now, projectId, userId],
    );
    database.run("COMMIT");
  } catch (error) {
    database.run("ROLLBACK");
    throw error;
  }
  persist();
  queueMicrotask(pumpGenerationQueue);
  const ids = pending.map((job) => String(job.id));
  request.log.info(
    { userId, projectId, canceled: ids.length },
    "pending project jobs canceled",
  );
  return { ok: true, canceled: ids.length, ids };
});

function parsePromptAgentResult(raw: string): Record<string, unknown> {
  if (!raw) throw new SyntaxError("Agent returned an empty response");
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const start = raw.indexOf("{"),
      end = raw.lastIndexOf("}");
    if (start >= 0 && end > start)
      return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    throw new SyntaxError("Agent returned truncated JSON");
  }
}

const agnesPromptSections = [
  "Style",
  "Language",
  "Continuity",
  "Scene",
  "Camera",
  "Action",
  "Effects",
  "Audio",
  "Dialogue",
  "Voice",
  "Background",
  "Constraints",
] as const;
function normalizeAgnesPrompt(value: string) {
  let normalized = value.replace(/\r\n?/g, "\n").trim();
  for (const section of agnesPromptSections)
    normalized = normalized.replace(
      new RegExp(`^${section}\\s*:?[ \\t]*$`, "gim"),
      `${section}:`,
    );
  for (const section of agnesPromptSections)
    normalized = normalized.replace(
      new RegExp(`^${section}:[ \\t]*\\n*`, "gim"),
      `${section}:\n`,
    );
  return normalized.replace(/\n{3,}/g, "\n\n");
}
function validateAgnesPrompt(value: string) {
  let previous = -1;
  for (const section of agnesPromptSections) {
    const matches = value.match(new RegExp(`^${section}:$`, "gm")) || [];
    if (matches.length !== 1) return `Agnes prompt requires exactly one ${section}: section`;
    const index = value.indexOf(`${section}:`);
    if (index < 0) return `Agnes prompt missing ${section}:`;
    if (index <= previous) return "Agnes prompt section order is invalid";
    previous = index;
  }
  if (/follows? (?:the )?.{0,24}line of sight|camera sees|feels? closer|follows? the feeling/i.test(value))
    return "Agnes prompt contains abstract camera language";
  const required = [
    "No subtitles.",
    "No captions.",
    "No dialogue text.",
    "No narration text.",
    "No automatic transcription.",
    "No speech bubbles.",
    "No text overlays.",
    "No logos.",
    "No watermarks.",
    "Only animate the specified actions.",
    "Do not redesign characters.",
    "Do not change clothing.",
    "Do not change hairstyle.",
    "Do not change environment.",
    "No extra movement.",
    "No idle animation.",
    "No unnecessary camera movement.",
  ];
  return required.find((rule) => !value.includes(rule))
    ? "Agnes prompt is missing required constraints"
    : "";
}

function compactImagePrompt(value: string, limit = 100) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  const sentences = normalized.match(/[^。！？；.!?;]+[。！？；.!?;]?/g) ?? [
    normalized,
  ];
  let compact = "";
  for (const sentence of sentences) {
    const next = `${compact}${sentence.trim()}`;
    if (next.length > limit) break;
    compact = next;
  }
  return (compact || normalized.slice(0, limit)).replace(/[，、：:\s]+$/, "");
}
function sanitizeCharacterNamesFromScenePrompt(value: string, characterNames: string[]) {
  let sanitized = value;
  for (const name of characterNames.map((item) => item.trim()).filter((item) => item.length >= 2).sort((left, right) => right.length - left.length))
    sanitized = sanitized.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "");
  sanitized = sanitized
    .replace(/(?:主角|男主|女主|角色|人物)[^，。；]{0,16}(?:站在|坐在|位于|走进|出现于)[^，。；]*/g, "")
    .replace(/[，、；：]{2,}/g, "，")
    .replace(/^[，、；：\s]+|[，、；：\s]+$/g, "");
  return `纯场景环境基准图，禁止出现任何人物、人体、手部、角色剪影或人形主体；${sanitized}`;
}
function getOne(sql: string, values: Array<string | number>) {
  const statement = database.prepare(sql);
  statement.bind(values);
  const row = statement.step() ? statement.getAsObject() : undefined;
  statement.free();
  return row;
}
function getAll(sql: string, values: Array<string | number>) {
  const statement = database.prepare(sql);
  statement.bind(values);
  const rows = [];
  while (statement.step()) rows.push(statement.getAsObject());
  statement.free();
  return rows;
}
function ownsProject(projectId: string, userId: string) {
  return Boolean(
    getOne("SELECT id FROM projects WHERE id = ? AND user_id = ?", [
      projectId,
      userId,
    ]),
  );
}
function ensureColumn(table: string, column: string, definition: string) {
  const columns = getAll(`PRAGMA table_info(${table})`, []);
  if (!columns.some((item) => item.name === column))
    database.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
function normalizeEmail(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}
function newInviteCode() {
  let code = "";
  do code = `VIO-${randomBytes(4).toString("hex").toUpperCase()}`;
  while (getOne("SELECT id FROM users WHERE invite_code = ?", [code]));
  return code;
}
function availableUsername(preferred: string) {
  const base = preferred.trim() || "user";
  let username = base,
    suffix = 1;
  while (
    getOne("SELECT id FROM users WHERE lower(username) = ?", [
      username.toLowerCase(),
    ])
  )
    username = `${base}${suffix++}`;
  return username;
}
function normalizeHttpUrl(value: unknown) {
  try {
    const url = new URL(String(value ?? "").trim());
    return ["http:", "https:"].includes(url.protocol)
      ? url.toString().replace(/\/$/, "")
      : "";
  } catch {
    return "";
  }
}
function validEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}
function assetDisposition(name: string) {
  const safe = name.replace(/[\r\n]/g, "").slice(0, 240) || "asset";
  return `inline; filename="asset"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}
function namedAssetUrl(id: string, name: string, isPublic = false) {
  const safe = name.replace(/[\r\n/\\]/g, "").slice(0, 240) || "asset";
  return `/api/${isPublic ? "public/" : ""}assets/${id}/content/${encodeURIComponent(safe)}`;
}
function assetThumbnailUrl(id: string, mimeType: string, isPublic = false) {
  return /^(image|video)\//.test(mimeType)
    ? `/api/${isPublic ? "public/" : ""}assets/${id}/thumbnail`
    : undefined;
}
const execFileAsync = promisify(execFile);
const pendingVideoThumbnails = new Map<string, Promise<void>>();
async function sendAssetThumbnail(
  reply: FastifyReply,
  assetId: string,
  asset: Record<string, unknown>,
  isPublic = false,
) {
  const mimeType = String(asset.mime_type ?? "");
  if (!/^(image|video)\//.test(mimeType))
    return reply.code(415).send({ error: "Asset does not support thumbnails" });
  const video = mimeType.startsWith("video/"),
    thumbnailPath = `${thumbnailDirectory}/${assetId}.${video ? "jpg" : "webp"}`;
  if (!existsSync(thumbnailPath) && video) {
    let task = pendingVideoThumbnails.get(assetId);
    if (!task) {
      task = execFileAsync(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-ss",
          "0.15",
          "-i",
          `${uploadDirectory}/${String(asset.storage_name)}`,
          "-frames:v",
          "1",
          "-vf",
          "scale='min(640,iw)':-2",
          "-q:v",
          "5",
          "-y",
          thumbnailPath,
        ],
        { timeout: 20_000, maxBuffer: 1024 * 1024 },
      )
        .then(() => undefined)
        .finally(() => pendingVideoThumbnails.delete(assetId));
      pendingVideoThumbnails.set(assetId, task);
    }
    try {
      await task;
    } catch {
      return reply
        .code(422)
        .send({ error: "Video thumbnail generation failed" });
    }
  } else if (!existsSync(thumbnailPath))
    await sharp(`${uploadDirectory}/${String(asset.storage_name)}`)
      .rotate()
      .resize({
        width: 640,
        height: 640,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 72, effort: 3 })
      .toFile(thumbnailPath);
  reply
    .type(video ? "image/jpeg" : "image/webp")
    .header(
      "cache-control",
      `${isPublic ? "public" : "private"}, max-age=86400, immutable`,
    );
  return reply.send(readFileSync(thumbnailPath));
}
function validateOwnedInputUrls(
  urls: string[],
  userId: string,
  kind: JobInput["kind"],
) {
  for (const source of urls) {
    const match = source.match(/^\/api\/assets\/([^/]+)\/content(?:\/|$)/);
    if (!match) continue;
    const asset = getOne(
      "SELECT size FROM assets WHERE id = ? AND user_id = ?",
      [decodeURIComponent(match[1]), userId],
    );
    if (!asset) throw new Error("输入素材不存在或不属于当前用户");
    if (kind === "video" && Number(asset.size ?? 0) > 15 * 1024 * 1024)
      throw new Error("参考图片超过 15MB");
  }
}
function resolveOwnedInputUrls(
  urls: string[],
  userId: string,
  kind: JobInput["kind"],
  model: string,
) {
  return urls.map((source) => {
    const match = source.match(/^\/api\/assets\/([^/]+)\/content(?:\/|$)/);
    if (!match) return source;
    const assetId = decodeURIComponent(match[1]),
      asset = getOne(
        "SELECT mime_type, size, storage_name FROM assets WHERE id = ? AND user_id = ?",
        [assetId, userId],
      );
    if (!asset) throw new Error("输入素材不存在或不属于当前用户");
    const size = Number(asset.size ?? 0);
    if (kind === "video" && size > 15 * 1024 * 1024)
      throw new Error("参考图片超过 15MB");
    if (kind === "video" && model.startsWith("agnes-")) {
      if (!generationPublicBaseUrl)
        throw new Error("Agnes 视频生成需要配置公网素材地址");
      return signedGenerationInputUrl(assetId);
    }
    const bytes = readFileSync(`${uploadDirectory}/${asset.storage_name}`);
    if (!bytes.length) throw new Error("输入素材为空");
    return `data:${String(asset.mime_type || "application/octet-stream")};base64,${bytes.toString("base64")}`;
  });
}
function signedGenerationInputUrl(assetId: string) {
  const expires = Math.floor(Date.now() / 1000) + 1800,
    signature = createHmac("sha256", generationInputSigningSecret)
      .update(`${assetId}:${expires}`)
      .digest("base64url");
  return `${generationPublicBaseUrl}/api/generation-inputs/${encodeURIComponent(assetId)}?expires=${expires}&signature=${signature}`;
}
function validGenerationInputSignature(
  assetId: string,
  expires: number,
  signature: string,
) {
  const expected = createHmac("sha256", generationInputSigningSecret)
    .update(`${assetId}:${expires}`)
    .digest("base64url");
  return secureTextEqual(signature, expected);
}
function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex"),
    digest = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${digest}`;
}
function verifyPassword(password: string, stored: string) {
  const [, salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  try {
    const actual = scryptSync(password, salt, 64),
      expectedBytes = Buffer.from(expected, "hex");
    return (
      actual.length === expectedBytes.length &&
      timingSafeEqual(actual, expectedBytes)
    );
  } catch {
    return false;
  }
}
function secureTextEqual(actual: string, expected: string) {
  const left = createHash("sha256").update(actual).digest(),
    right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}
function normalizeRechargeCode(value: unknown) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}
function hashRechargeCode(code: string) {
  return createHash("sha256").update(code).digest("hex");
}
function hashApiToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
function sessionId(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
function sessionToken(request: FastifyRequest) {
  const cookie = String(request.headers.cookie ?? "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("flow_session="));
  return cookie ? decodeURIComponent(cookie.slice("flow_session=".length)) : "";
}
const sessionIdleTimeoutMs = Math.max(
  60_000,
  Number(process.env.SESSION_IDLE_TIMEOUT_MS || 30 * 60 * 1000),
);
function createSession(userId: string, createdAt = new Date().toISOString()) {
  const token = randomBytes(32).toString("base64url"),
    expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  database.run("DELETE FROM sessions WHERE expires_at <= ?", [createdAt]);
  database.run(
    "INSERT INTO sessions (id, user_id, created_at, expires_at, last_activity_at) VALUES (?, ?, ?, ?, ?)",
    [sessionId(token), userId, createdAt, expiresAt, createdAt],
  );
  return token;
}
function currentUser(request: FastifyRequest) {
  const authorization = String(request.headers.authorization || ""),
    bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer?.startsWith("viora_"))
    return getOne(
      "SELECT id,name,username,email,invite_code AS inviteCode,created_at AS createdAt,credits,reserved_credits AS reservedCredits,is_admin AS isAdmin FROM users WHERE api_token_hash=?",
      [hashApiToken(bearer)],
    );
  const token = sessionToken(request);
  if (!token) return undefined;
  const now = new Date(),
    idleCutoff = new Date(now.getTime() - sessionIdleTimeoutMs).toISOString();
  return getOne(
    `SELECT users.id, users.name, users.username, users.email, users.invite_code AS inviteCode, users.created_at AS createdAt, users.credits, users.reserved_credits AS reservedCredits, users.is_admin AS isAdmin FROM sessions JOIN users ON users.id = sessions.user_id
  WHERE sessions.id = ? AND sessions.expires_at > ? AND COALESCE(sessions.last_activity_at,sessions.created_at) > ?`,
    [sessionId(token), now.toISOString(), idleCutoff],
  );
}
function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const user = currentUser(request),
    configured = String(process.env.ADMIN_API_KEY || ""),
    provided = String(request.headers["x-admin-key"] || ""),
    keyAuthorized = Boolean(
      configured && provided && secureTextEqual(provided, configured),
    );
  if (user?.isAdmin) return user;
  if (keyAuthorized) return { id: "admin-api-key", isAdmin: true };
  void reply
    .code(user ? 403 : 401)
    .send({ error: user ? "仅管理员可以执行此操作" : "Unauthorized" });
  return undefined;
}
function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const user = currentUser(request);
  if (!user) {
    void reply.code(401).send({ error: "Unauthorized" });
    return undefined;
  }
  return user;
}
function secureRequest(request: FastifyRequest) {
  const proto = request.headers["x-forwarded-proto"];
  return (Array.isArray(proto) ? proto[0] : proto) === "https";
}
function setSessionCookie(
  request: FastifyRequest,
  reply: FastifyReply,
  token: string,
) {
  reply.header(
    "set-cookie",
    `flow_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}${secureRequest(request) ? "; Secure" : ""}`,
  );
}
function clearSessionCookie(request: FastifyRequest, reply: FastifyReply) {
  reply.header(
    "set-cookie",
    `flow_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureRequest(request) ? "; Secure" : ""}`,
  );
}
function emptyCanvas() {
  return JSON.stringify({
    nodes: [],
    links: [],
    camera: { x: 0, y: 0, zoom: 1 },
  });
}
function createDefaultProject(userId: string, now = new Date().toISOString()) {
  const id = randomUUID();
  database.run(
    "INSERT INTO projects (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    [id, userId, "未命名项目", now, now],
  );
  database.run(
    "INSERT INTO project_canvases (project_id, document, updated_at) VALUES (?, ?, ?)",
    [id, emptyCanvas(), now],
  );
  return id;
}

function persist() {
  const temporaryPath = `${databasePath}.tmp`;
  writeFileSync(temporaryPath, Buffer.from(database.export()));
  renameSync(temporaryPath, databasePath);
}

function encodeCanvasBatchResponse(value: unknown) {
  const json=typeof value==="string"?value:JSON.stringify(value);
  if(json.length<1024||json.startsWith("gz:"))return json;
  return `gz:${gzipSync(Buffer.from(json),{level:6}).toString("base64")}`;
}

function decodeCanvasBatchResponse(value: string) {
  const json=value.startsWith("gz:")?gunzipSync(Buffer.from(value.slice(3),"base64")).toString("utf8"):value;
  return JSON.parse(json);
}

function compactCanvasSyncHistory(onlyProjectId?: string) {
  let changed=0;
  const projects=onlyProjectId
    ? getAll("SELECT project_id AS projectId,version FROM project_canvases WHERE project_id=?",[onlyProjectId])
    : getAll("SELECT project_id AS projectId,version FROM project_canvases",[]);
  for(const row of projects){
    const projectId=String(row.projectId),cutoff=Math.max(1,(Number(row.version)||1)-200);
    database.run("UPDATE project_canvases SET reset_version=MAX(reset_version,?) WHERE project_id=? AND reset_version<?",[cutoff,projectId,cutoff]);
    changed+=database.getRowsModified();
    database.run("DELETE FROM canvas_operations WHERE project_id=? AND version<?",[projectId,cutoff]);
    changed+=database.getRowsModified();
    database.run(`DELETE FROM canvas_operation_batches WHERE rowid IN (
      SELECT rowid FROM (
        SELECT rowid,ROW_NUMBER() OVER(PARTITION BY project_id ORDER BY created_at DESC,rowid DESC) AS position
        FROM canvas_operation_batches WHERE project_id=?
      ) WHERE position>12
    )`,[projectId]);
    changed+=database.getRowsModified();
  }
  return changed;
}

const configuredImageConcurrency = Number(
  process.env.IMAGE_GENERATION_CONCURRENCY || 3,
);
const configuredVideoConcurrency = Number(
  process.env.VIDEO_GENERATION_CONCURRENCY || 2,
);
const configuredImageEditConcurrency = Number(
  process.env.IMAGE_EDIT_CONCURRENCY || 3,
);
const generationConcurrency: Record<JobInput["kind"], number> = {
  image: Number.isFinite(configuredImageConcurrency)
    ? Math.max(1, Math.floor(configuredImageConcurrency))
    : 3,
  video: Number.isFinite(configuredVideoConcurrency)
    ? Math.max(1, Math.floor(configuredVideoConcurrency))
    : 2,
};
const activeGenerationJobs: Record<JobInput["kind"], Set<string>> = {
  image: new Set(),
  video: new Set(),
};
let queuePumpRunning = false;
let generationQueueWakeTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleGenerationQueueWake() {
  if (generationQueueWakeTimer) clearTimeout(generationQueueWakeTimer);
  generationQueueWakeTimer = null;
  const next = getOne(
    "SELECT MIN(retry_after) AS retryAfter FROM jobs WHERE status='queued' AND retry_after IS NOT NULL",
    [],
  ),
    retryAt = Date.parse(String(next?.retryAfter || ""));
  if (!Number.isFinite(retryAt)) return;
  generationQueueWakeTimer = setTimeout(
    () => {
      generationQueueWakeTimer = null;
      pumpGenerationQueue();
    },
    Math.max(100, retryAt - Date.now() + 100),
  );
  generationQueueWakeTimer.unref();
}

function pumpGenerationQueue() {
  if (queuePumpRunning) return;
  queuePumpRunning = true;
  try {
    for (const kind of ["video", "image"] as const)
      while (activeGenerationJobs[kind].size < generationConcurrency[kind]) {
        const job = nextQueuedGenerationJob(kind);
        if (!job) break;
        const id = String(job.id);
        activeGenerationJobs[kind].add(id);
        database.run(
          "UPDATE jobs SET status = 'running', progress = 0, error = NULL, retry_after = NULL, updated_at = ? WHERE id = ? AND status = 'queued'",
          [new Date().toISOString(), id],
        );
        persist();
        app.log.info(
          {
            jobId: id,
            kind,
            active: activeGenerationJobs[kind].size,
            concurrency: generationConcurrency[kind],
          },
          "generation queue started job",
        );
        void executeQueuedJob(job).finally(() => {
          activeGenerationJobs[kind].delete(id);
          queueMicrotask(pumpGenerationQueue);
        });
      }
  } finally {
    queuePumpRunning = false;
    scheduleGenerationQueueWake();
  }
}

function isImageEditJob(job: Record<string, unknown>) {
  return parseJsonArray(job.input_urls).length > 0;
}
function activeImageEditCount() {
  let count = 0;
  for (const id of activeGenerationJobs.image) {
    const job = getOne("SELECT input_urls FROM jobs WHERE id = ?", [id]);
    if (job && isImageEditJob(job)) count++;
  }
  return count;
}
function nextQueuedGenerationJob(kind: JobInput["kind"]) {
  if (kind !== "image")
    return getOne(
      "SELECT * FROM jobs WHERE status = 'queued' AND kind = ? AND (retry_after IS NULL OR retry_after <= ?) ORDER BY created_at ASC, rowid ASC LIMIT 1",
      [kind, new Date().toISOString()],
    );
  const imageEditConcurrency = Number.isFinite(configuredImageEditConcurrency)
    ? Math.max(1, Math.min(generationConcurrency.image, Math.floor(configuredImageEditConcurrency)))
    : 3;
  const editSlotAvailable = activeImageEditCount() < imageEditConcurrency;
  return getAll(
    "SELECT * FROM jobs WHERE status = 'queued' AND kind = 'image' ORDER BY created_at ASC, rowid ASC",
    [],
  ).find((job) => !isImageEditJob(job) || editSlotAvailable);
}

async function executeQueuedJob(job: Record<string, unknown>) {
  const id = String(job.id),
    kind = String(job.kind) as JobInput["kind"],
    userId = String(job.user_id),
    model = String(job.model);
  try {
    const customId = String(job.custom_model_id || ""),
      custom = customId
        ? getOne("SELECT * FROM user_api_models WHERE id = ? AND user_id = ?", [
            customId,
            userId,
          ])
        : undefined;
    if (customId && (!custom || String(custom.kind) !== kind))
      throw new Error("自定义模型已被删除或类型不匹配");
    const provider = custom
      ? kind === "image"
        ? new OpenAiImageProvider({
            baseUrl: String(custom.base_url),
            apiKey: String(custom.api_key),
          })
        : new OpenAiVideoProvider({
            baseUrl: String(custom.base_url),
            apiKey: String(custom.api_key),
          })
      : generationProvider;
    const rawInputUrls = parseJsonArray(job.input_urls),
      inputUrls = resolveOwnedInputUrls(rawInputUrls, userId, kind, model);
    const parameters = parseJsonObject(job.parameters);
    let updates = Promise.resolve(),
      lastError: unknown;
    // Both image and video providers may lose a response stream after the
    // request has been accepted. Retry bounded transient transport failures;
    // validation/authentication errors still fail immediately.
    const attempts = kind === "image" ? 3 : kind === "video" ? 3 : 1;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        await provider.run(
          {
            internalJobId: id,
            projectId: String(job.project_id),
            nodeId: Number(job.node_id),
            kind,
            prompt: String(job.prompt),
            model,
            inputUrls,
            parameters,
          },
          (update) => {
            updates = updates.then(() =>
              updateJob(
                id,
                update.status === "queued"
                  ? { ...update, status: "running" }
                  : update,
              ),
            );
          },
        );
        await updates;
        return;
      } catch (error) {
        lastError = error;
        if (attempt >= attempts || !isTransientGenerationError(error))
          throw error;
        app.log.warn(
          {
            jobId: id,
            kind,
            attempt,
            error: error instanceof Error ? error.message : String(error),
          },
          "transient generation failure, retrying",
        );
        await updateJob(id, {
          status: "running",
          progress: Math.max(5, Math.min(20, attempt * 8)),
          error: undefined,
        });
        await new Promise((resolve) => setTimeout(resolve, attempt * 2500));
      }
    }
    if (
      !custom &&
      kind === "image" &&
      process.env.SDCPP_IMAGE_FALLBACK_ENABLED === "true" &&
      !["flux1-kontext-dev", "z-image-turbo"].includes(model) &&
      isLocalImageFallbackError(lastError) &&
      localImageFallback
    ) {
      if (await localImageFallback.available()) {
        app.log.warn(
          {
            jobId: id,
            model,
            error:
              lastError instanceof Error
                ? lastError.message
                : String(lastError),
          },
          "primary image provider failed, using local fallback",
        );
        await updateJob(id, {
          status: "running",
          progress: 3,
          error: undefined,
        });
        await localImageFallback.run(
          {
            internalJobId: id,
            projectId: String(job.project_id),
            nodeId: Number(job.node_id),
            kind,
            prompt: String(job.prompt),
            model: "flux1-kontext-dev",
            inputUrls,
            parameters,
          },
          (update) => {
            updates = updates.then(() =>
              updateJob(
                id,
                update.status === "queued"
                  ? { ...update, status: "running" }
                  : update,
              ),
            );
          },
        );
        await updates;
        return;
      }
    }
    throw lastError;
  } catch (error) {
    if (kind === "video" && isProviderQueueCapacityError(error)) {
      const retryCount = Number(job.retry_count || 0) + 1,
        retryDelayMs = Math.min(
          300_000,
          20_000 * 2 ** Math.min(4, retryCount - 1),
        ) + Math.floor(Math.random() * 5000),
        retryAfter = new Date(Date.now() + retryDelayMs).toISOString(),
        now = new Date().toISOString();
      database.run(
        "UPDATE jobs SET status='queued',progress=0,error=?,retry_after=?,retry_count=?,updated_at=? WHERE id=? AND status!='canceled'",
        [
          "Agnes 云端队列繁忙，正在等待自动重试",
          retryAfter,
          retryCount,
          now,
          id,
        ],
      );
      persist();
      app.log.warn(
        { jobId: id, retryCount, retryAfter, retryDelayMs },
        "video provider queue full, job requeued",
      );
      return;
    }
    await updateJob(id, {
      status: "failed",
      progress: 0,
      error: error instanceof Error ? error.message : "Generation failed",
    });
  }
}

function isProviderQueueCapacityError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /video queue is full|queue full|queue is full|server queue.*full|队列.*(?:已满|繁忙)/i.test(
    message,
  );
}

function isTransientGenerationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /auth_unavailable|no auth available|unexpected EOF|ETIMEDOUT|timeout|timed out|aborted due to timeout|backend-api\/codex\/images/i.test(
      message,
    )
  )
    return false;
  return /ECONNRESET|ECONNREFUSED|fetch failed|socket|network|temporar|HTTP\/2 stream.*not closed cleanly|curl:\s*\(18\)|502|503|504/i.test(
    message,
  );
}

function isLocalImageFallbackError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /safety|rejected|content policy|auth_unavailable|no auth available|unauthori[sz]ed|forbidden|\b400\b|\b401\b|\b403\b/i.test(
      message,
    )
  )
    return false;
  return /unexpected EOF|ETIMEDOUT|timeout|timed out|aborted|ECONNRESET|ECONNREFUSED|fetch failed|socket|network|temporar|\b429\b|\b5\d\d\b|backend-api\/codex\/images/i.test(
    message,
  );
}

function parseJsonArray(value: unknown) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
function parseJsonObject(value: unknown) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function updateJob(id: string, update: GenerationUpdate) {
  if (
    String(getOne("SELECT status FROM jobs WHERE id = ?", [id])?.status) ===
    "canceled"
  )
    return;
  let resultUrl = update.resultUrl;
  let succeeded = update.status === "succeeded";
  try {
    if (update.status === "succeeded" && resultUrl)
      resultUrl = await archiveJobResult(id, resultUrl);
    database.run(
      "UPDATE jobs SET status = ?, progress = ?, result_url = COALESCE(?, result_url), result_metadata = COALESCE(?, result_metadata), error = ?, updated_at = ? WHERE id = ?",
      [
        update.status,
        update.progress,
        resultUrl ?? null,
        update.resultMetadata ? JSON.stringify(update.resultMetadata) : null,
        update.error ?? null,
        new Date().toISOString(),
        id,
      ],
    );
  } catch (error) {
    succeeded = false;
    app.log.error({jobId:id,resultSource:resultUrl?(()=>{try{return new URL(resultUrl).host}catch{return "inline-or-local"}})():"missing",error:error instanceof Error?{message:error.message,cause:error.cause}:String(error)},"job result archive failed");
    database.run(
      "UPDATE jobs SET status = ?, progress = ?, error = ?, updated_at = ? WHERE id = ?",
      [
        "failed",
        0,
        `结果保存到资产库失败：${error instanceof Error ? error.message : "unknown error"}`,
        new Date().toISOString(),
        id,
      ],
    );
  }
  if (update.status === "succeeded" || update.status === "failed")
    settleJobCredits(id, succeeded);
  persist();
}

function settleJobCredits(jobId: string, succeeded: boolean) {
  const job = getOne(
      "SELECT user_id, credit_cost, credit_settled FROM jobs WHERE id = ?",
      [jobId],
    ),
    cost = Number(job?.credit_cost ?? 0);
  if (!job || !cost || Boolean(job.credit_settled)) return;
  database.run(
    "UPDATE users SET reserved_credits = MAX(0,reserved_credits - ?), credits = MAX(0,credits - ?) WHERE id = ?",
    [cost, succeeded ? cost : 0, String(job.user_id)],
  );
  database.run("UPDATE jobs SET credit_settled = 1 WHERE id = ?", [jobId]);
}

async function archiveJobResult(jobId: string, source: string) {
  const job = getOne(
    "SELECT project_id, user_id, kind, prompt, model FROM jobs WHERE id = ?",
    [jobId],
  );
  if (!job) throw new Error("Job not found");
  let bytes: Buffer, mimeType: string;
  if (source.startsWith("data:")) {
    const match = source.match(/^data:([^;,]+);base64,(.+)$/s);
    if (!match) throw new Error("Unsupported data URL");
    mimeType = match[1];
    bytes = Buffer.from(match[2], "base64");
  } else {
    const url = source.startsWith("/api/")
      ? `http://127.0.0.1:${process.env.PORT ?? 3000}/${source.slice(5)}`
      : source;
    const proxyUrl =
      String(job.kind) === "video"
        ? process.env.AGNES_VIDEO_HTTPS_PROXY
        : process.env.OPENAI_IMAGE_HTTPS_PROXY;
    const preferProxy=String(job.model).startsWith("agnes-")&&Boolean(proxyUrl),strategies:Array<{name:string;proxy?:string}> = preferProxy?[{name:"proxy",proxy:proxyUrl},{name:"direct"}]:[{name:"direct"},...(proxyUrl?[{name:"proxy",proxy:proxyUrl}]:[])],failures:string[]=[];
    let downloaded:{bytes:Buffer;mimeType:string}|undefined;
    for(let round=0;round<2&&!downloaded;round++){
      for(const strategy of strategies){
        try{
          const response=strategy.proxy?await undiciFetch(url,{signal:AbortSignal.timeout(90000),dispatcher:new ProxyAgent(strategy.proxy)}):await fetch(url,{signal:AbortSignal.timeout(90000)});
          if(!response.ok)throw new Error(`HTTP ${response.status}`);
          const payload=Buffer.from(await response.arrayBuffer());
          if(!payload.length)throw new Error("empty response");
          downloaded={bytes:payload,mimeType:response.headers.get("content-type")?.split(";")[0]||(String(job.kind)==="video"?"video/mp4":"image/png")};
          break;
        }catch(error){const cause=error instanceof Error&&error.cause&&typeof error.cause==="object"?String((error.cause as {code?:unknown}).code||""):"";failures.push(`${strategy.name}: ${error instanceof Error?error.message:String(error)}${cause?` (${cause})`:""}`)}
      }
      if(!downloaded&&round===0)await new Promise(resolve=>setTimeout(resolve,1500));
    }
    if(!downloaded){let sourceHost="unknown";try{sourceHost=new URL(url).host}catch{/* 保持 unknown */}app.log.error({jobId,model:String(job.model),sourceHost,failures},"generated result archive download failed");throw new Error(`下载生成结果失败：${failures.join("；")}`)}
    bytes=downloaded.bytes;mimeType=downloaded.mimeType;
  }
  if (!bytes.length || bytes.length > 100 * 1024 * 1024)
    throw new Error("生成结果为空或超过 100MB");
  const assetId = randomUUID(),
    storageName = `${assetId}.bin`,
    now = new Date().toISOString();
  const extension = mimeType.split("/")[1]?.replace("svg+xml", "svg") || "bin";
  const name = `AI 生成-${new Date().toLocaleString("zh-CN").replace(/[/:]/g, "-")}.${extension}`;
  writeFileSync(`${uploadDirectory}/${storageName}`, bytes);
  database.run(
    "INSERT INTO assets (id, project_id, user_id, name, mime_type, size, storage_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [
      assetId,
      String(job.project_id),
      String(job.user_id),
      name,
      mimeType,
      bytes.length,
      storageName,
      now,
    ],
  );
  return namedAssetUrl(assetId, name);
}

app.addHook("onClose", async () => {
  persist();
  database.close();
});
await app.listen({ port: Number(process.env.PORT ?? 3000), host: "0.0.0.0" });
pumpGenerationQueue();
