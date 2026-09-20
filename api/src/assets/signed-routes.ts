import { type FastifyInstance } from "fastify";
import { readFileSync } from "node:fs";
import { getOne, uploadDirectory } from "../storage/database.js";
import { validGenerationInputSignature } from "./generation-inputs.js";

export function registerAssetsSignedRoutes(app: FastifyInstance) {
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
}
