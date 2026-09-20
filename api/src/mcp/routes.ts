import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { FastifyInstance } from "fastify";
import { currentUser } from "../auth/service.js";
import { VioraGateway } from "./gateway.js";
import { createVioraMcp } from "./tools.js";

/** Stateless MCP: each request has its own server/transport and authenticated user.
 * No in-memory session can leak between tokens or become stale after a restart.
 */
export function registerMcpRoutes(app: FastifyInstance) {
  const origins = new Set(
    (process.env.MCP_ALLOWED_ORIGINS || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  );
  const hosts = new Set(
    (process.env.MCP_ALLOWED_HOSTS || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  );
  app.route({
    method: ["POST", "GET", "DELETE"],
    url: "/mcp",
    bodyLimit: 2 * 1024 * 1024,
    handler: async (request, reply) => {
      reply.header("cache-control", "no-store");
      if (
        (request.headers.origin && !origins.has(request.headers.origin)) ||
        (hosts.size && !hosts.has(request.headers.host || ""))
      )
        return reply
          .code(403)
          .send({ error: "MCP origin or host is not allowed" });
      const authorization = request.headers.authorization || "";
      if (!/^Bearer\s+viora_\S+$/i.test(authorization) || !currentUser(request))
        return reply
          .code(401)
          .header("www-authenticate", 'Bearer realm="Viora MCP"')
          .send({ error: "A valid personal Viora API token is required" });
      if (request.method !== "POST")
        return reply
          .code(405)
          .header("allow", "POST")
          .send({ error: "Stateless MCP supports POST only" });
      const configuredOrigin =
        process.env.MCP_PUBLIC_BASE_URL ||
        process.env.GENERATION_PUBLIC_BASE_URL;
      const forwarded = request.headers["x-forwarded-proto"];
      const protocol = forwarded === "https" ? "https" : request.protocol;
      const origin = new URL(
        configuredOrigin || `${protocol}://${request.headers.host}`,
      );
      if (
        !["http:", "https:"].includes(origin.protocol) ||
        origin.username ||
        origin.password
      )
        return reply
          .code(503)
          .send({ error: "Invalid MCP public URL configuration" });
      const server = createVioraMcp(
        new VioraGateway(app, authorization, origin.origin),
      );
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      try {
        await server.connect(transport);
        reply.hijack();
        reply.raw.setHeader("cache-control", "no-store");
        await transport.handleRequest(request.raw, reply.raw, request.body);
      } catch (error) {
        request.log.error(
          { error: error instanceof Error ? error.name : "unknown" },
          "MCP transport failed",
        );
        if (!reply.raw.headersSent)
          reply.raw.writeHead(500, { "content-type": "application/json" });
        if (!reply.raw.writableEnded)
          reply.raw.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: null,
              error: { code: -32603, message: "MCP transport failed" },
            }),
          );
      } finally {
        await server.close();
      }
    },
  });
}
