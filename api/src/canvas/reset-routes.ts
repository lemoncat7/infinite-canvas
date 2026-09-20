import { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { requireUser } from "../auth/service.js";
import { emptyCanvas } from "../projects/defaults.js";
import { ownsProject } from "../projects/ownership.js";
import { database, getOne, persist } from "../storage/database.js";

export function registerCanvasResetRoutes(app: FastifyInstance) {
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
      return reply.code(409).send({
        error: "canvas_conflict",
        message: "画布版本已变化，请重新载入后再清除",
        version: serverVersion,
        updatedAt: String(previous.updated_at),
      });
    let nextDocument = emptyCanvas();
    if (body.preserveLabels) {
      try {
        const current = JSON.parse(String(previous.document || "{}")) as {
          nodes?: Array<{ id?: number; kind?: string }>;
          links?: Array<{ from?: number; to?: number } | [number, number]>;
          camera?: unknown;
        };
        const retainedNodes = (
            Array.isArray(current.nodes) ? current.nodes : []
          ).filter((node) => node?.kind === "prompt"),
          retainedIds = new Set(retainedNodes.map((node) => Number(node.id))),
          retainedLinks = (
            Array.isArray(current.links) ? current.links : []
          ).filter((link) => {
            const from = Array.isArray(link) ? link[0] : link?.from,
              to = Array.isArray(link) ? link[1] : link?.to;
            return retainedIds.has(Number(from)) && retainedIds.has(Number(to));
          });
        nextDocument = JSON.stringify({
          nodes: retainedNodes,
          links: retainedLinks,
          camera: current.camera || { x: 80, y: 10, zoom: 0.9 },
        });
      } catch {
        return reply
          .code(500)
          .send({
            error: "canvas_document_invalid",
            message: "服务器画布结构异常，已停止清除",
          });
      }
    }
    const now = new Date().toISOString(),
      batchId = `clear-${randomUUID()}`;
    database.run("BEGIN");
    try {
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
    return {
      projectId,
      version: requestedVersion,
      updatedAt: now,
      ...JSON.parse(nextDocument),
    };
  });
}
