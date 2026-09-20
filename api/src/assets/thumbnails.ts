import { type FastifyReply } from "fastify";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { promisify } from "node:util";
import sharp from "sharp";
import { thumbnailDirectory, uploadDirectory } from "../storage/database.js";

export const execFileAsync = promisify(execFile);

export const pendingVideoThumbnails = new Map<string, Promise<void>>();

export async function sendAssetThumbnail(
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
