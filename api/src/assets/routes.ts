import { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { requireUser } from "../auth/service.js";
import {
  ImageUploadValidationError,
  validateImageUpload,
} from "../image-upload-validation.js";
import { ownsProject } from "../projects/ownership.js";
import {
  database,
  getAll,
  getOne,
  persist,
  uploadDirectory,
} from "../storage/database.js";
import { sendAssetThumbnail } from "./thumbnails.js";
import { assetDisposition, assetThumbnailUrl, namedAssetUrl } from "./urls.js";

export function registerAssetsRoutes(app: FastifyInstance) {
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
    let files: Awaited<ReturnType<typeof validateImageUpload>>[];
    try {
      files = await Promise.all((body.files ?? []).map(validateImageUpload));
    } catch (error) {
      if (error instanceof ImageUploadValidationError)
        return reply.code(error.statusCode).send({ error: error.message });
      throw error;
    }
    for (const file of files) {
      const { bytes } = file;
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

  app.get("/assets/:assetId", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { assetId } = request.params as { assetId: string };
    const asset = getOne(
      "SELECT id, project_id AS projectId, name, mime_type AS mimeType, size, created_at AS createdAt FROM assets WHERE id = ? AND user_id = ?",
      [assetId, String(user.id)],
    );
    if (!asset) return reply.code(404).send({ error: "Asset not found" });
    reply.header("cache-control", "no-store");
    return {
      ...asset,
      url: namedAssetUrl(String(asset.id), String(asset.name)),
      thumbnailUrl: assetThumbnailUrl(String(asset.id), String(asset.mimeType)),
    };
  });

  app.get("/assets/:assetId/content", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { assetId } = request.params as { assetId: string };
    const asset = getOne(
      "SELECT name FROM assets WHERE id = ? AND user_id = ?",
      [assetId, String(user.id)],
    );
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

  app.get(
    "/public/assets/:assetId/content/:filename",
    async (request, reply) => {
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
      return reply.send(
        readFileSync(`${uploadDirectory}/${asset.storage_name}`),
      );
    },
  );

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
    database.run(
      "UPDATE assets SET is_public = ? WHERE id = ? AND user_id = ?",
      [body.isPublic ? 1 : 0, assetId, userId],
    );
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
}
