import { type FastifyInstance } from "fastify";
import { readFileSync } from "node:fs";
import { getOne, uploadDirectory } from "../storage/database.js";
import { validGenerationInputSignature } from "./generation-inputs.js";
import { observeAssetDownload } from './download-logging.js';

export function registerAssetsSignedRoutes(app: FastifyInstance) {
  app.get("/generation-inputs/:assetId", async (request, reply) => {
    const { assetId } = request.params as { assetId: string };
    const download = observeAssetDownload(reply.raw, request.log, { requestId: request.id, assetId, method: request.method });
    reply.header('x-download-request-id', request.id);
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
    ) {
      download.rejected('invalid_signature');
      return reply
        .code(403)
        .send({ error: "Generation input URL is invalid or expired" });
    }
    const asset = getOne(
      "SELECT mime_type, storage_name FROM assets WHERE id = ?",
      [assetId],
    );
    if (!asset) { download.rejected('missing_asset'); return reply.code(404).send({ error: "Asset not found" }); }
    let bytes: Buffer;
    try { bytes = readFileSync(`${uploadDirectory}/${asset.storage_name}`); }
    catch { download.rejected('file_read_failed'); return reply.code(500).send({ error: 'Asset file could not be read' }); }
    download.ready(bytes.length);
    return reply
      .type(String(asset.mime_type))
      .header("cache-control", "private, no-store")
      .send(bytes);
  });
}
