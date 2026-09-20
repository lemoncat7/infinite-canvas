import { type FastifyInstance } from "fastify";
import { requireUser } from "../auth/service.js";
import { type JobInput } from "../core/types.js";
import { ownsProject } from "../projects/ownership.js";
import { database, getAll, getOne, persist } from "../storage/database.js";
import { pumpGenerationQueue } from "./queue.js";
import { submitGeneration } from "./submit.js";
import { ApplicationError } from "../core/errors.js";

export function registerGenerationRoutes(app: FastifyInstance) {
  app.post("/jobs", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    try {
      return reply
        .code(202)
        .send(
          submitGeneration(
            user,
            request.body as JobInput,
            request.headers["idempotency-key"],
          ),
        );
    } catch (error) {
      if (error instanceof ApplicationError)
        return reply.code(error.statusCode).send({ error: error.message });
      throw error;
    }
  });

  app.get("/jobs/:id", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const row = getOne("SELECT * FROM jobs WHERE id = ? AND user_id = ?", [
      id,
      String(user.id),
    ]);
    if (!row) return reply.code(404).send({ error: "Job not found" });
    const { model_snapshot: _snapshot, ...publicJob } = row;
    return publicJob;
  });

  app.post(
    "/projects/:projectId/jobs/cancel-active",
    async (request, reply) => {
      const user = requireUser(request, reply);
      if (!user) return;
      const userId = String(user.id),
        { projectId } = request.params as { projectId: string };
      if (!ownsProject(projectId, userId))
        return reply.code(404).send({ error: "Project not found" });
      const active = getAll(
          "SELECT id,credit_cost,credit_settled FROM jobs WHERE project_id=? AND user_id=? AND status IN ('queued','running')",
          [projectId, userId],
        ),
        now = new Date().toISOString();
      if (!active.length) return { ok: true, canceled: 0 };
      database.run("BEGIN");
      try {
        for (const job of active) {
          const cost = Number(job.credit_cost ?? 0);
          if (cost && !Boolean(job.credit_settled)) {
            database.run(
              "UPDATE users SET reserved_credits=MAX(0,reserved_credits-?) WHERE id=?",
              [cost, userId],
            );
            database.run("UPDATE jobs SET credit_settled=1 WHERE id=?", [
              String(job.id),
            ]);
          }
        }
        database.run(
          "UPDATE jobs SET status='canceled',progress=0,error='用户已取消',updated_at=? WHERE project_id=? AND user_id=? AND status IN ('queued','running')",
          [now, projectId, userId],
        );
        database.run("COMMIT");
      } catch (error) {
        database.run("ROLLBACK");
        throw error;
      }
      persist();
      queueMicrotask(pumpGenerationQueue);
      request.log.info(
        { userId, projectId, canceled: active.length },
        "active project jobs canceled",
      );
      return { ok: true, canceled: active.length };
    },
  );

  app.post(
    "/projects/:projectId/jobs/cancel-pending",
    async (request, reply) => {
      const user = requireUser(request, reply);
      if (!user) return;
      const userId = String(user.id),
        { projectId } = request.params as { projectId: string };
      if (!ownsProject(projectId, userId))
        return reply.code(404).send({ error: "Project not found" });
      const pending = getAll(
          "SELECT id,credit_cost,credit_settled FROM jobs WHERE project_id=? AND user_id=? AND status='queued'",
          [projectId, userId],
        ),
        now = new Date().toISOString();
      if (!pending.length) return { ok: true, canceled: 0, ids: [] };
      database.run("BEGIN");
      try {
        for (const job of pending) {
          const cost = Number(job.credit_cost ?? 0);
          if (cost && !Boolean(job.credit_settled)) {
            database.run(
              "UPDATE users SET reserved_credits=MAX(0,reserved_credits-?) WHERE id=?",
              [cost, userId],
            );
            database.run("UPDATE jobs SET credit_settled=1 WHERE id=?", [
              String(job.id),
            ]);
          }
        }
        database.run(
          "UPDATE jobs SET status='canceled',progress=0,error='用户取消等待任务',updated_at=? WHERE project_id=? AND user_id=? AND status='queued'",
          [now, projectId, userId],
        );
        database.run("COMMIT");
      } catch (error) {
        database.run("ROLLBACK");
        throw error;
      }
      persist();
      queueMicrotask(pumpGenerationQueue);
      const ids = pending.map((job) => String(job.id));
      request.log.info(
        { userId, projectId, canceled: ids.length },
        "pending project jobs canceled",
      );
      return { ok: true, canceled: ids.length, ids };
    },
  );
}
