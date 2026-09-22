import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { secureTextEqual } from "../auth/crypto.js";
import { type JobInput } from "../core/types.js";
import {
  generationInputSigningSecret,
  generationPublicBaseUrl,
} from "../generation/config.js";
import { getOne, uploadDirectory } from "../storage/database.js";
import type { GenerationInput, ReferencePolicy } from "../providers/types.js";
import { referenceDataUrl } from "../providers/reference-transport.js";

export function validateOwnedInputUrls(
  urls: string[],
  userId: string,
  kind: JobInput["kind"],
) {
  for (const source of urls) {
    const match = source.match(/^\/api\/assets\/([^/]+)\/content(?:\/|$)/);
    if (!match) continue;
    const asset = getOne(
      "SELECT size FROM assets WHERE id = ? AND user_id = ?",
      [decodeURIComponent(match[1]), userId],
    );
    if (!asset) throw new Error("输入素材不存在或不属于当前用户");
    if (kind === "video" && Number(asset.size ?? 0) > 15 * 1024 * 1024)
      throw new Error("参考图片超过 15MB");
  }
}

export function resolveOwnedInputUrls(
  urls: string[],
  userId: string,
  kind: JobInput["kind"],
  _model: string,
) {
  return urls.map((source) => {
    const match = source.match(/^\/api\/assets\/([^/]+)\/content(?:\/|$)/);
    if (!match) return source;
    const assetId = decodeURIComponent(match[1]),
      asset = getOne(
        "SELECT mime_type, size, storage_name FROM assets WHERE id = ? AND user_id = ?",
        [assetId, userId],
      );
    if (!asset) throw new Error("输入素材不存在或不属于当前用户");
    const size = Number(asset.size ?? 0);
    if (kind === "video" && size > 15 * 1024 * 1024)
      throw new Error("参考图片超过 15MB");
    const bytes = readFileSync(`${uploadDirectory}/${asset.storage_name}`);
    if (!bytes.length) throw new Error("输入素材为空");
    return `data:${String(asset.mime_type || "application/octet-stream")};base64,${bytes.toString("base64")}`;
  });
}

/** Provider-neutral ownership boundary. URL-capable adapters keep a lazy original reader. */
export function prepareOwnedGenerationInputs(urls: string[], userId: string, kind: JobInput['kind'], policy: ReferencePolicy): Pick<GenerationInput, 'inputUrls' | 'readInputAsDataUrl'> {
  validateOwnedInputUrls(urls, userId, kind);
  const readers: Array<(proxyUrl?: string) => Promise<string>> = [];
  const inputUrls = urls.map(source => {
    const match = source.match(/^\/api\/assets\/([^/]+)\/content(?:\/|$)/);
    if (!match) {
      readers.push(proxyUrl => referenceDataUrl({ inputUrls: [source] } as GenerationInput, 0, proxyUrl));
      return source;
    }
    const assetId = decodeURIComponent(match[1]);
    const asset = getOne('SELECT mime_type, storage_name FROM assets WHERE id = ? AND user_id = ?', [assetId, userId]);
    if (!asset) throw new Error('输入素材不存在或不属于当前用户');
    const read = () => {
      const bytes = readFileSync(`${uploadDirectory}/${asset.storage_name}`);
      if (!bytes.length) throw new Error('输入素材为空');
      return `data:${String(asset.mime_type || 'application/octet-stream')};base64,${bytes.toString('base64')}`;
    };
    readers.push(async () => read());
    return policy.preferred === 'url' && generationPublicBaseUrl ? signedGenerationInputUrl(assetId) : read();
  });
  return { inputUrls, readInputAsDataUrl: (index, proxyUrl) => {
    if (!readers[index]) throw new Error('参考图索引无效');
    return readers[index](proxyUrl);
  } };
}

export function signedGenerationInputUrl(assetId: string) {
  const expires = Math.floor(Date.now() / 1000) + 1800,
    signature = createHmac("sha256", generationInputSigningSecret)
      .update(`${assetId}:${expires}`)
      .digest("base64url");
  return `${generationPublicBaseUrl}/api/generation-inputs/${encodeURIComponent(assetId)}?expires=${expires}&signature=${signature}`;
}

export function validGenerationInputSignature(
  assetId: string,
  expires: number,
  signature: string,
) {
  const expected = createHmac("sha256", generationInputSigningSecret)
    .update(`${assetId}:${expires}`)
    .digest("base64url");
  return secureTextEqual(signature, expected);
}
