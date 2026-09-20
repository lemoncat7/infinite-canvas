import { type FastifyInstance } from "fastify";
import { requireUser } from "../auth/service.js";
import { ownsProject } from "../projects/ownership.js";
import { getOne } from "../storage/database.js";

export function registerComicSessionRoutes(app: FastifyInstance) {
  app.get("/agents/comic/session", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const query = request.query as { projectId?: string; sessionId?: string },
      projectId = String(query.projectId || ""),
      requestedSessionId = String(query.sessionId || "").trim();
    if (!projectId || !ownsProject(projectId, String(user.id)))
      return reply.code(404).send({ error: "当前项目不存在" });
    const fields =
        "id,phase,brief,messages,pending_revision AS pendingRevision,plan,generation_status AS generationStatus,generation_stage AS generationStage,generation_progress AS generationProgress,generation_received_bytes AS generationReceivedBytes,generation_error AS generationError,generation_issues AS generationIssues,generation_checkpoint AS generationCheckpoint,updated_at AS updatedAt",
      session = requestedSessionId
        ? getOne(
            `SELECT ${fields} FROM comic_sessions WHERE id=? AND user_id=? AND project_id=? LIMIT 1`,
            [requestedSessionId, String(user.id), projectId],
          )
        : getOne(
            `SELECT ${fields} FROM comic_sessions WHERE user_id=? AND project_id=? AND generation_status='running' ORDER BY updated_at DESC LIMIT 1`,
            [String(user.id), projectId],
          );
    if (!session) return reply.code(204).send();
    let checkpoint: Record<string, unknown> = {};
    try {
      checkpoint = JSON.parse(String(session.generationCheckpoint || "{}"));
    } catch {
      checkpoint = {};
    }
    return {
      ...session,
      brief: JSON.parse(String(session.brief || "{}")),
      messages: JSON.parse(String(session.messages || "[]")),
      plan: session.plan ? JSON.parse(String(session.plan)) : null,
      generationIssues: JSON.parse(String(session.generationIssues || "[]")),
      hasGenerationCheckpoint: Boolean(
        checkpoint.story || checkpoint.assets || checkpoint.shotPlan,
      ),
      generationCheckpoint: undefined,
    };
  });
}
