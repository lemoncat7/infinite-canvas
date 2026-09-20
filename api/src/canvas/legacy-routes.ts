import { type FastifyInstance } from "fastify";
import { requireUser } from "../auth/service.js";
import { type CanvasPayload } from "../core/types.js";
import { ownsProject } from "../projects/ownership.js";
import { database, getOne, persist } from "../storage/database.js";

export function registerCanvasLegacyRoutes(app: FastifyInstance) {
  app.get("/canvases/:id", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    if (!ownsProject(id, String(user.id)))
      return reply.code(404).send({ error: "Canvas not found" });
    const row = getOne(
      "SELECT id, title, document, updated_at FROM canvases WHERE id = ?",
      [id],
    );
    if (!row) return reply.code(404).send({ error: "Canvas not found" });
    return {
      id: row.id,
      title: row.title,
      ...JSON.parse(String(row.document)),
      updatedAt: row.updated_at,
    };
  });

  app.put("/canvases/:id", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    if (!ownsProject(id, String(user.id)))
      return reply.code(404).send({ error: "Canvas not found" });
    const body = request.body as CanvasPayload & { title?: string };
    const now = new Date().toISOString();
    database.run(
      `INSERT INTO canvases (id, title, document, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET title = excluded.title, document = excluded.document, updated_at = excluded.updated_at`,
      [
        id,
        body.title ?? "未命名项目",
        JSON.stringify({
          nodes: body.nodes,
          links: body.links,
          camera: body.camera,
        }),
        now,
      ],
    );
    persist();
    return { id, updatedAt: now };
  });
}
