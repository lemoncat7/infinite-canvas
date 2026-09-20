import { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, unlinkSync } from "node:fs";
import { requireUser } from "../auth/service.js";
import {
  database,
  getAll,
  getOne,
  persist,
  uploadDirectory,
} from "../storage/database.js";
import { emptyCanvas } from "./defaults.js";
import { ownsProject } from "./ownership.js";

export function registerProjectsRoutes(app: FastifyInstance) {
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
    return reply.code(201).send({
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
      return reply
        .code(400)
        .send({ error: "项目名称需要在 1 到 60 个字符之间" });
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
      source = getOne(
        "SELECT name FROM projects WHERE id = ? AND user_id = ?",
        [projectId, userId],
      );
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
      getOne("SELECT count(*) AS count FROM projects WHERE user_id = ?", [
        userId,
      ])?.count ?? 0,
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
    database.run("DELETE FROM canvas_versions WHERE project_id = ?", [
      projectId,
    ]);
    database.run("DELETE FROM canvas_operations WHERE project_id = ?", [
      projectId,
    ]);
    database.run("DELETE FROM canvas_operation_batches WHERE project_id = ?", [
      projectId,
    ]);
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
}
