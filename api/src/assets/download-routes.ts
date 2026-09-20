import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { currentUser } from "../auth/service.js";
import { getOne, uploadDirectory } from "../storage/database.js";
import { assetDisposition } from "./urls.js";
import {
  issueDownloadTicket,
  readDownloadClaims,
  verifyDownloadTicket,
} from "./download-tickets.js";

export function registerAssetDownloadRoutes(app: FastifyInstance) {
  app.post("/assets/:assetId/download-ticket", async (request, reply) => {
    reply.header("cache-control", "no-store");
    // Only explicit personal-token authorization may mint a transferable download capability.
    if (!/^Bearer\s+viora_\S+$/i.test(request.headers.authorization || ""))
      return reply.code(401).send({ error: "Personal API token required" });
    const user = currentUser(request);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    const { assetId } = request.params as { assetId: string };
    const asset = getOne("SELECT id FROM assets WHERE id=? AND user_id=?", [
      assetId,
      String(user.id),
    ]);
    if (!asset) return reply.code(404).send({ error: "Asset not found" });
    const credentials = getOne("SELECT api_token_hash FROM users WHERE id=?", [
      String(user.id),
    ]);
    const { ticket, expires } = issueDownloadTicket(
      assetId,
      String(user.id),
      String(credentials!.api_token_hash),
    );
    return {
      path: `/api/asset-downloads/${encodeURIComponent(assetId)}?ticket=${ticket}`,
      expiresAt: new Date(expires * 1000).toISOString(),
    };
  });

  app.get(
    "/asset-downloads/:assetId",
    { logLevel: "silent" },
    async (request, reply) => {
      reply
        .header("cache-control", "private, no-store")
        .header("referrer-policy", "no-referrer")
        .header("x-content-type-options", "nosniff");
      const { assetId } = request.params as { assetId: string };
      const query = request.query as { ticket?: unknown };
      const ticket = typeof query.ticket === "string" ? query.ticket : "";
      const claims = readDownloadClaims(ticket);
      const deny = () =>
        reply
          .code(403)
          .send({
            error:
              "Download link is invalid or expired; request a new link using viora_asset_get",
          });
      if (!claims || claims.assetId !== assetId) return deny();
      const asset = getOne(
        "SELECT assets.name,assets.mime_type,assets.storage_name,users.api_token_hash FROM assets JOIN users ON users.id=assets.user_id WHERE assets.id=? AND assets.user_id=?",
        [assetId, claims.userId],
      );
      if (
        !asset ||
        !asset.api_token_hash ||
        !verifyDownloadTicket(ticket, String(asset.api_token_hash))
      )
        return deny();
      const file = `${uploadDirectory}/${asset.storage_name}`;
      let size: number;
      try {
        size = (await stat(file)).size;
      } catch {
        return reply.code(404).send({ error: "Asset file not found" });
      }
      reply
        .type(String(asset.mime_type))
        .header(
          "content-disposition",
          assetDisposition(String(asset.name)).replace(
            /^inline;/,
            "attachment;",
          ),
        )
        .header("accept-ranges", "bytes");
      const range = request.headers.range;
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        const start = match?.[1]
          ? Number(match[1])
          : Math.max(0, size - Number(match?.[2]));
        const end =
          match?.[1] && match[2]
            ? Math.min(size - 1, Number(match[2]))
            : size - 1;
        if (
          !match ||
          (!match[1] && !match[2]) ||
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start < 0 ||
          end < start ||
          start >= size
        )
          return reply
            .code(416)
            .header("content-range", `bytes */${size}`)
            .send();
        return reply
          .code(206)
          .header("content-range", `bytes ${start}-${end}/${size}`)
          .header("content-length", end - start + 1)
          .send(createReadStream(file, { start, end }));
      }
      return reply.header("content-length", size).send(createReadStream(file));
    },
  );
}
