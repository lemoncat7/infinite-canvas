import type { FastifyInstance } from "fastify";

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly details: unknown,
  ) {
    super(`Viora API returned HTTP ${status}`);
  }
}

/** In-process transport adapter, not another business implementation.
 * Every call re-enters the same authenticated API handlers as the web client.
 * No arbitrary URL, cookie, admin key or upstream credential is forwarded.
 */
export class VioraGateway {
  constructor(
    private readonly app: FastifyInstance,
    private readonly authorization: string,
    private readonly publicOrigin?: string,
  ) {}

  downloadUrl(path: string) {
    if (!this.publicOrigin)
      throw new ApiFailure(503, "MCP public origin is unavailable");
    return new URL(path, this.publicOrigin).href;
  }

  /** Only the authenticated thumbnail endpoint, never caller-controlled URLs. */
  async imagePreview(assetId: string) {
    const response = await this.app.inject({
      method: "GET",
      url: `/assets/${encodeURIComponent(assetId)}/thumbnail`,
      headers: { authorization: this.authorization },
    });
    if (response.statusCode !== 200)
      throw new ApiFailure(response.statusCode, "Image preview unavailable");
    const mimeType = String(response.headers["content-type"] || "").split(
      ";",
    )[0];
    if (
      !["image/webp", "image/png", "image/jpeg"].includes(mimeType) ||
      response.rawPayload.length > 1024 * 1024
    )
      throw new ApiFailure(422, "Preview format or size is not supported");
    return {
      type: "image" as const,
      mimeType,
      data: response.rawPayload.toString("base64"),
    };
  }

  async call<T = Record<string, unknown>>(
    method: "GET" | "POST",
    url: string,
    payload?: object,
    requestId?: string,
  ): Promise<T> {
    const response = await this.app.inject({
      method,
      url,
      payload,
      headers: {
        authorization: this.authorization,
        ...(requestId ? { "idempotency-key": requestId } : {}),
      },
    });
    const result: unknown = response.json();
    if (response.statusCode >= 400)
      throw new ApiFailure(response.statusCode, result);
    return result as T;
  }
}

export const projectPath = (id: string) =>
  `/projects/${encodeURIComponent(id)}`;

export function page<T>(items: T[], offset: number, limit: number) {
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    nextOffset: offset + limit < items.length ? offset + limit : null,
  };
}
