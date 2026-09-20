import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import initSqlJs, { type Database } from "sql.js";
import { SessionStore } from "../auth/session-store.js";

export const dataDirectory = process.env.DATA_DIR ?? "./data";

export const databasePath = `${dataDirectory}/flow-studio.sqlite`;

export const uploadDirectory = `${dataDirectory}/uploads`;

export const thumbnailDirectory = `${dataDirectory}/thumbnails`;

export const videoExportRoot = resolve(
  process.env.VIDEO_EXPORT_ROOT ?? `${dataDirectory}/exports`,
);

mkdirSync(dataDirectory, { recursive: true });

mkdirSync(uploadDirectory, { recursive: true });

mkdirSync(thumbnailDirectory, { recursive: true });

mkdirSync(videoExportRoot, { recursive: true });

export const SQL = await initSqlJs();

export const database: Database = existsSync(databasePath)
  ? new SQL.Database(readFileSync(databasePath))
  : new SQL.Database();

export const sessionStore = new SessionStore(database);

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

ensureColumn("jobs", "model_snapshot", "TEXT");

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

ensureColumn("sessions", "trusted_family_id", "TEXT");

sessionStore.initialize();

ensureColumn("project_canvases", "version", "INTEGER NOT NULL DEFAULT 1");

ensureColumn("project_canvases", "reset_version", "INTEGER NOT NULL DEFAULT 0");

ensureColumn("project_canvases", "next_node_id", "INTEGER NOT NULL DEFAULT 1");

ensureColumn("canvas_versions", "canvas_version", "INTEGER");

for (const row of getAll(
  "SELECT project_id AS projectId,document,next_node_id AS nextNodeId FROM project_canvases",
  [],
)) {
  let maximum = 0;
  try {
    const parsed = JSON.parse(String(row.document || "{}"));
    for (const node of Array.isArray(parsed.nodes) ? parsed.nodes : [])
      if (Number.isSafeInteger(Number(node?.id)))
        maximum = Math.max(maximum, Number(node.id));
  } catch {
    /* 损坏画布由加载校验处理 */
  }
  if (Number(row.nextNodeId) <= maximum)
    database.run(
      "UPDATE project_canvases SET next_node_id=? WHERE project_id=?",
      [maximum + 1, String(row.projectId)],
    );
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

ensureColumn(
  "comic_sessions",
  "generation_checkpoint",
  "TEXT NOT NULL DEFAULT '{}'",
);

ensureColumn(
  "comic_sessions",
  "generation_issues",
  "TEXT NOT NULL DEFAULT '[]'",
);

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
    "image-reference-order-2026-08-14",
  ])
)
  database.run(
    "INSERT INTO notifications (id,title,content,type,created_at,priority,auto_popup) VALUES (?,?,?,?,?,?,?)",
    [
      "image-reference-order-2026-08-14",
      "图片参考素材现在清晰可控",
      "图片生成卡片现已支持查看和交换参考素材顺序；在提示词中输入 @ 即可选择已连接素材，并自动插入对应的图号与素材名。交换素材后，提示词图号会同步更新，并与生成接口实际使用的图片顺序保持一致。",
      "update",
      "2026-08-14T12:00:00.000Z",
      "important",
      1,
    ],
  );

if (
  !getOne("SELECT id FROM app_migrations WHERE id = ?", [
    "reissue-image-reference-order-popup-2026-08-14",
  ])
) {
  database.run("DELETE FROM notification_popups WHERE notification_id = ?", [
    "image-reference-order-2026-08-14",
  ]);
  database.run("DELETE FROM notification_reads WHERE notification_id = ?", [
    "image-reference-order-2026-08-14",
  ]);
  database.run("INSERT INTO app_migrations (id,applied_at) VALUES (?,?)", [
    "reissue-image-reference-order-popup-2026-08-14",
    new Date().toISOString(),
  ]);
}

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

export function getOne(sql: string, values: Array<string | number>) {
  const statement = database.prepare(sql);
  statement.bind(values);
  const row = statement.step() ? statement.getAsObject() : undefined;
  statement.free();
  return row;
}

export function getAll(sql: string, values: Array<string | number>) {
  const statement = database.prepare(sql);
  statement.bind(values);
  const rows = [];
  while (statement.step()) rows.push(statement.getAsObject());
  statement.free();
  return rows;
}

export function ensureColumn(
  table: string,
  column: string,
  definition: string,
) {
  const columns = getAll(`PRAGMA table_info(${table})`, []);
  if (!columns.some((item) => item.name === column))
    database.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export function normalizeEmail(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

export function newInviteCode() {
  let code = "";
  do code = `VIO-${randomBytes(4).toString("hex").toUpperCase()}`;
  while (getOne("SELECT id FROM users WHERE invite_code = ?", [code]));
  return code;
}

export function availableUsername(preferred: string) {
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

export function persist() {
  const temporaryPath = `${databasePath}.tmp`;
  writeFileSync(temporaryPath, Buffer.from(database.export()));
  renameSync(temporaryPath, databasePath);
}

database.run(`CREATE TABLE IF NOT EXISTS generation_requests (
  user_id TEXT NOT NULL, request_key TEXT NOT NULL, request_hash TEXT NOT NULL,
  job_id TEXT NOT NULL, PRIMARY KEY (user_id, request_key)
)`);
