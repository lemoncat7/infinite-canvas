import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { logger } from "../core/logging.js";
import { database, getOne, uploadDirectory } from "../storage/database.js";
import { namedAssetUrl } from "./urls.js";

export async function archiveJobResult(jobId: string, source: string) {
  const job = getOne(
    "SELECT project_id, user_id, kind, prompt, model FROM jobs WHERE id = ?",
    [jobId],
  );
  if (!job) throw new Error("Job not found");
  let bytes: Buffer, mimeType: string;
  if (source.startsWith("data:")) {
    const match = source.match(/^data:([^;,]+);base64,(.+)$/s);
    if (!match) throw new Error("Unsupported data URL");
    mimeType = match[1];
    bytes = Buffer.from(match[2], "base64");
  } else {
    const url = source.startsWith("/api/")
      ? `http://127.0.0.1:${process.env.PORT ?? 3000}/${source.slice(5)}`
      : source;
    const proxyUrl =
      String(job.kind) === "video"
        ? process.env.AGNES_VIDEO_HTTPS_PROXY
        : process.env.OPENAI_IMAGE_HTTPS_PROXY;
    const preferProxy =
        String(job.model).startsWith("agnes-") && Boolean(proxyUrl),
      strategies: Array<{ name: string; proxy?: string }> = preferProxy
        ? [{ name: "proxy", proxy: proxyUrl }, { name: "direct" }]
        : [
            { name: "direct" },
            ...(proxyUrl ? [{ name: "proxy", proxy: proxyUrl }] : []),
          ],
      failures: string[] = [];
    let downloaded: { bytes: Buffer; mimeType: string } | undefined;
    for (let round = 0; round < 2 && !downloaded; round++) {
      for (const strategy of strategies) {
        try {
          const response = strategy.proxy
            ? await undiciFetch(url, {
                signal: AbortSignal.timeout(90000),
                dispatcher: new ProxyAgent(strategy.proxy),
              })
            : await fetch(url, { signal: AbortSignal.timeout(90000) });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const payload = Buffer.from(await response.arrayBuffer());
          if (!payload.length) throw new Error("empty response");
          downloaded = {
            bytes: payload,
            mimeType:
              response.headers.get("content-type")?.split(";")[0] ||
              (String(job.kind) === "video" ? "video/mp4" : "image/png"),
          };
          break;
        } catch (error) {
          const cause =
            error instanceof Error &&
            error.cause &&
            typeof error.cause === "object"
              ? String((error.cause as { code?: unknown }).code || "")
              : "";
          failures.push(
            `${strategy.name}: ${error instanceof Error ? error.message : String(error)}${cause ? ` (${cause})` : ""}`,
          );
        }
      }
      if (!downloaded && round === 0)
        await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    if (!downloaded) {
      let sourceHost = "unknown";
      try {
        sourceHost = new URL(url).host;
      } catch {
        /* 保持 unknown */
      }
      logger.error(
        { jobId, model: String(job.model), sourceHost, failures },
        "generated result archive download failed",
      );
      throw new Error(`下载生成结果失败：${failures.join("；")}`);
    }
    bytes = downloaded.bytes;
    mimeType = downloaded.mimeType;
  }
  if (!bytes.length || bytes.length > 100 * 1024 * 1024)
    throw new Error("生成结果为空或超过 100MB");
  const assetId = randomUUID(),
    storageName = `${assetId}.bin`,
    now = new Date().toISOString();
  const extension = mimeType.split("/")[1]?.replace("svg+xml", "svg") || "bin";
  const name = `AI 生成-${new Date().toLocaleString("zh-CN").replace(/[/:]/g, "-")}.${extension}`;
  writeFileSync(`${uploadDirectory}/${storageName}`, bytes);
  database.run(
    "INSERT INTO assets (id, project_id, user_id, name, mime_type, size, storage_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [
      assetId,
      String(job.project_id),
      String(job.user_id),
      name,
      mimeType,
      bytes.length,
      storageName,
      now,
    ],
  );
  return namedAssetUrl(assetId, name);
}
