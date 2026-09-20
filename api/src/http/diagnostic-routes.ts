import { type FastifyInstance } from "fastify";

export function registerHttpDiagnosticRoutes(app: FastifyInstance) {
  app.post("/client-logs", async (request) => {
    const input = request.body as {
      event?: string;
      details?: unknown;
      userAgent?: string;
      path?: string;
      timestamp?: string;
    };
    app.log.warn(
      {
        clientDiagnostic: {
          event: String(input.event ?? "unknown").slice(0, 100),
          details: input.details,
          userAgent: String(input.userAgent ?? "").slice(0, 500),
          path: String(input.path ?? "").slice(0, 300),
          timestamp: input.timestamp,
        },
      },
      "client diagnostic",
    );
    return { ok: true };
  });

  app.get("/mock/:file", async (request, reply) => {
    const { file } = request.params as { file: string };
    const label = file.startsWith("video-") ? "VIDEO PREVIEW" : "IMAGE PREVIEW";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#172d30"/><stop offset=".5" stop-color="#315f69"/><stop offset="1" stop-color="#c5e969"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="960" cy="180" r="210" fill="#fff" opacity=".08"/><circle cx="210" cy="620" r="330" fill="#fff" opacity=".06"/><text x="72" y="570" fill="#fff" font-family="system-ui" font-size="54" font-weight="700">${label}</text><text x="76" y="625" fill="#fff" opacity=".7" font-family="system-ui" font-size="24">Custom provider result pipeline is ready</text></svg>`;
    return reply
      .type("image/svg+xml")
      .header("cache-control", "no-store")
      .send(svg);
  });
}
