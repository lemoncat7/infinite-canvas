import { type FastifyInstance } from "fastify";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { requireAdmin } from "../auth/service.js";
import {
  getOne,
  uploadDirectory,
  videoExportRoot,
} from "../storage/database.js";

export function registerAssetsExportRoutes(app: FastifyInstance) {
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
      username = String(body.username || "")
        .trim()
        .toLowerCase(),
      projectName = String(body.projectName || "").trim(),
      requestedDirectory = String(body.directory || "")
        .trim()
        .replace(/\\/g, "/");
    if (
      !requestedDirectory ||
      isAbsolute(requestedDirectory) ||
      requestedDirectory
        .split("/")
        .some((part) => !part || part === "." || part === "..")
    )
      return reply
        .code(400)
        .send({ error: "directory 必须是导出根目录下的安全相对子目录" });
    const destination = resolve(videoExportRoot, requestedDirectory),
      relativeDestination = relative(videoExportRoot, destination);
    if (
      !relativeDestination ||
      relativeDestination.startsWith("..") ||
      isAbsolute(relativeDestination)
    )
      return reply.code(400).send({ error: "目标目录超出允许的导出范围" });
    let project: Record<string, unknown> | undefined;
    if (projectId)
      project = getOne(
        "SELECT projects.id,projects.name,projects.user_id AS userId,users.username,users.name AS userName FROM projects JOIN users ON users.id=projects.user_id WHERE projects.id=?",
        [projectId],
      );
    else if (username && projectName)
      project = getOne(
        "SELECT projects.id,projects.name,projects.user_id AS userId,users.username,users.name AS userName FROM projects JOIN users ON users.id=projects.user_id WHERE lower(users.username)=? AND projects.name=? ORDER BY projects.updated_at DESC LIMIT 1",
        [username, projectName],
      );
    else
      return reply
        .code(400)
        .send({
          error: "请提供 projectId，或同时提供 username 和 projectName",
        });
    if (!project) return reply.code(404).send({ error: "项目不存在" });
    const canvas = getOne(
      "SELECT document FROM project_canvases WHERE project_id=?",
      [String(project.id)],
    );
    if (!canvas) return reply.code(404).send({ error: "项目画布不存在" });
    let document: Record<string, unknown>;
    try {
      document = JSON.parse(String(canvas.document || "{}")) as Record<
        string,
        unknown
      >;
    } catch {
      return reply.code(409).send({ error: "项目画布数据损坏，无法导出" });
    }
    const nodes = (Array.isArray(document.nodes) ? document.nodes : []).filter(
        (value): value is Record<string, unknown> =>
          Boolean(value && typeof value === "object"),
      ),
      generators = nodes
        .filter((node) => node.kind === "video" && node.role !== "result")
        .sort(
          (left, right) =>
            Number(left.y || 0) - Number(right.y || 0) ||
            Number(left.x || 0) - Number(right.x || 0) ||
            Number(left.id || 0) - Number(right.id || 0),
        ),
      exported: Array<Record<string, unknown>> = [],
      skipped: Array<Record<string, unknown>> = [];
    mkdirSync(destination, { recursive: true });
    for (const generator of generators) {
      const results = nodes
          .filter(
            (node) =>
              node.kind === "video" &&
              node.role === "result" &&
              Number(node.sourceNodeId) === Number(generator.id) &&
              node.status === "succeeded" &&
              String(node.mediaUrl || ""),
          )
          .sort(
            (left, right) =>
              Number(right.x || 0) - Number(left.x || 0) ||
              Number(right.id || 0) - Number(left.id || 0),
          ),
        result = results[0];
      if (!result) {
        skipped.push({
          nodeId: generator.id,
          title: generator.title,
          reason: "没有成功的视频结果",
        });
        continue;
      }
      const match = String(result.mediaUrl).match(/\/api\/assets\/([^/]+)\//),
        assetId = match?.[1],
        asset = assetId
          ? getOne(
              "SELECT id,name,mime_type AS mimeType,size,storage_name AS storageName FROM assets WHERE id=? AND project_id=? AND user_id=?",
              [assetId, String(project.id), String(project.userId)],
            )
          : undefined;
      if (!asset || !String(asset.mimeType || "").startsWith("video/")) {
        skipped.push({
          nodeId: generator.id,
          title: generator.title,
          resultNodeId: result.id,
          reason: "视频资产不存在或不属于该项目",
        });
        continue;
      }
      const source = resolve(uploadDirectory, String(asset.storageName)),
        uploadRelative = relative(resolve(uploadDirectory), source);
      if (
        !uploadRelative ||
        uploadRelative.startsWith("..") ||
        isAbsolute(uploadRelative) ||
        !existsSync(source)
      ) {
        skipped.push({
          nodeId: generator.id,
          title: generator.title,
          resultNodeId: result.id,
          reason: "视频源文件不存在",
        });
        continue;
      }
      const number = exported.length + 1,
        fileName = `${number}.mp4`,
        target = resolve(destination, fileName);
      copyFileSync(source, target);
      exported.push({
        number,
        fileName,
        nodeId: generator.id,
        title: generator.title,
        resultNodeId: result.id,
        assetId,
        size: Number(asset.size || 0),
      });
    }
    request.log.info(
      {
        adminId: admin.id,
        projectId: project.id,
        directory: requestedDirectory,
        exported: exported.length,
        skipped: skipped.length,
      },
      "project videos exported",
    );
    return reply.send({
      project: {
        id: project.id,
        name: project.name,
        username: project.username,
        userName: project.userName,
      },
      directory: requestedDirectory,
      exportRoot: videoExportRoot,
      exported,
      skipped,
    });
  });
}
