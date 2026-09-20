import { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { requireUser } from "../auth/service.js";
import { type CanvasPayload } from "../core/types.js";
import { ownsProject } from "../projects/ownership.js";
import { database, getAll, getOne, persist } from "../storage/database.js";

export function registerCanvasRoutes(app: FastifyInstance) {
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
        try {
          node.videoResult = JSON.parse(String(job.result_metadata));
        } catch {
          /* 保留旧任务兼容 */
        }
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
    if (!ownsProject(projectId, String(user.id)))
      return reply.code(404).send({ error: "Project not found" });
    const requested = Math.floor(
      Number((request.body as { count?: number })?.count || 10000),
    );
    const count = Math.max(100, Math.min(100000, requested));
    const row = getOne(
      "SELECT next_node_id AS nextNodeId FROM project_canvases WHERE project_id=?",
      [projectId],
    );
    if (!row) return reply.code(404).send({ error: "Canvas not found" });
    const start = Math.max(1, Number(row.nextNodeId) || 1),
      end = start + count - 1;
    if (!Number.isSafeInteger(end))
      return reply.code(507).send({ error: "canvas_id_space_exhausted" });
    database.run(
      "UPDATE project_canvases SET next_node_id=? WHERE project_id=?",
      [end + 1, projectId],
    );
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
      return reply.code(428).send({
        error: "canvas_version_required",
        message: "页面缺少画布版本，请重新同步",
        version: serverVersion,
        updatedAt: String(previous.updated_at),
      });
    if (requestedVersion !== serverVersion + 1)
      return reply.code(409).send({
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
          return (
            JSON.parse(String(previous.document || "{}")).nodes?.length || 0
          );
        } catch {
          return 0;
        }
      })(),
      nextNodes = Array.isArray(body.nodes) ? body.nodes.length : 0;
    if (previousNodes > 0 && nextNodes === 0)
      return reply.code(409).send({
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
}
