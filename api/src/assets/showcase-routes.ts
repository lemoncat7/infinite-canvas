import { type FastifyInstance } from "fastify";
import { getAll } from "../storage/database.js";
import { assetThumbnailUrl, namedAssetUrl } from "./urls.js";

export function registerAssetsShowcaseRoutes(app: FastifyInstance) {
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
}
