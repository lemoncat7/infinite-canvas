import { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { requireUser } from "../auth/service.js";
import { database, getOne, persist } from "../storage/database.js";

export function registerNotificationsFeedbackRoutes(app: FastifyInstance) {
  app.post("/feedback", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const body = request.body as {
        type?: string;
        title?: string;
        content?: string;
        contact?: string;
        projectId?: string;
        pageUrl?: string;
        userAgent?: string;
      },
      type = body.type === "bug" ? "bug" : "suggestion",
      title = String(body.title || "").trim(),
      content = String(body.content || "").trim(),
      contact = String(body.contact || "").trim(),
      projectId = String(body.projectId || "").trim();
    if (title.length < 2 || title.length > 100)
      return reply.code(400).send({ error: "标题需要 2–100 个字符" });
    if (content.length < 5 || content.length > 5000)
      return reply.code(400).send({ error: "请填写 5–5000 个字符的详细说明" });
    if (contact.length > 200)
      return reply.code(400).send({ error: "联系方式过长" });
    if (
      projectId &&
      !getOne("SELECT id FROM projects WHERE id = ? AND user_id = ?", [
        projectId,
        String(user.id),
      ])
    )
      return reply.code(400).send({ error: "项目信息无效" });
    const id = randomUUID(),
      now = new Date().toISOString();
    database.run(
      "INSERT INTO feedback (id,user_id,project_id,type,title,content,contact,page_url,user_agent,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [
        id,
        String(user.id),
        projectId || null,
        type,
        title,
        content,
        contact || null,
        String(body.pageUrl || "").slice(0, 500),
        String(body.userAgent || "").slice(0, 1000),
        "open",
        now,
      ],
    );
    persist();
    request.log.info(
      { feedbackId: id, userId: user.id, type, projectId: projectId || null },
      "user feedback submitted",
    );
    return reply.code(201).send({ id, status: "open", createdAt: now });
  });
}
