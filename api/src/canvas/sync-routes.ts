import { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { requireUser } from "../auth/service.js";
import { type CanvasOperation } from "../core/types.js";
import { ownsProject } from "../projects/ownership.js";
import { database, getAll, getOne, persist } from "../storage/database.js";
import {
  compactCanvasSyncHistory,
  decodeCanvasBatchResponse,
  encodeCanvasBatchResponse,
} from "./history.js";

export function registerCanvasSyncRoutes(app: FastifyInstance) {
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
      return reply.code(400).send({
        error: "canvas_sync_identity_invalid",
        message: "同步客户端或批次标识无效",
      });
    const existingBatch = getOne(
      "SELECT response FROM canvas_operation_batches WHERE project_id=? AND batch_id=?",
      [projectId, batchId],
    );
    if (existingBatch) {
      const cached = decodeCanvasBatchResponse(String(existingBatch.response));
      if (cached?.expired)
        return reply
          .code(409)
          .send({
            error: "canvas_batch_expired",
            message: "同步批次已过期，请重新载入画布",
          });
      return cached;
    }
    if (!Number.isSafeInteger(baseVersion) || baseVersion < 1)
      return reply.code(428).send({
        error: "canvas_version_required",
        message: "页面缺少有效基线版本，请重新同步",
      });
    if (!operations.length || operations.length > 1000)
      return reply.code(400).send({
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
      return reply.code(409).send({
        error: "canvas_conflict",
        message: "客户端版本超前，请重新同步",
        version: serverVersion,
      });
    if (baseVersion < resetVersion)
      return reply.code(409).send({
        error: "canvas_reset_conflict",
        message: "画布在此设备离线期间被整体替换或清空，请重新同步",
        version: serverVersion,
      });
    let normalized: CanvasOperation[] = [];
    const touched = new Set<string>();
    for (const raw of operations) {
      if (
        !raw ||
        !["node", "link", "camera"].includes(raw.type) ||
        !["upsert", "delete"].includes(raw.action)
      )
        return reply.code(400).send({
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
        return reply.code(400).send({
          error: "canvas_operation_invalid",
          message: "同步记录标识无效",
        });
      if (
        raw.action === "upsert" &&
        (raw.value === null ||
          typeof raw.value !== "object" ||
          JSON.stringify(raw.value).length > 2_000_000)
      )
        return reply.code(400).send({
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
        return reply.code(409).send({
          error: "canvas_record_conflict",
          message: "同一节点或连线已在其他设备修改，请重新同步",
          version: serverVersion,
          conflicts: conflicts.slice(0, 30).map((item) => ({
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
      if (operation.type !== "node" || operation.action !== "upsert")
        return true;
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
            return reply.code(400).send({
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
            return reply.code(400).send({
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
        return reply.code(409).send({
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
}
