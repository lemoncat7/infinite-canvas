import { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { requireAdmin } from "../auth/service.js";
import { database, getAll, getOne, persist } from "../storage/database.js";
import { broadcastNotificationSync } from "./service.js";

export function registerNotificationsAdminRoutes(app: FastifyInstance) {
  app.get("/admin/feedback", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const query = request.query as {
        status?: string;
        type?: string;
        limit?: string;
      },
      status = String(query.status || "all"),
      type = String(query.type || "all"),
      limit = Math.min(
        500,
        Math.max(1, Number.parseInt(String(query.limit || "100"), 10) || 100),
      ),
      where: string[] = [],
      parameters: (string | number)[] = [];
    if (["open", "reviewing", "resolved", "closed"].includes(status)) {
      where.push("f.status=?");
      parameters.push(status);
    }
    if (["bug", "suggestion"].includes(type)) {
      where.push("f.type=?");
      parameters.push(type);
    }
    parameters.push(limit);
    return getAll(
      `SELECT f.id,f.type,f.title,f.content,f.contact,f.project_id AS projectId,p.name AS projectName,f.page_url AS pageUrl,f.user_agent AS userAgent,f.status,f.created_at AS createdAt,u.id AS userId,u.name AS userName,u.username,u.email FROM feedback f JOIN users u ON u.id=f.user_id LEFT JOIN projects p ON p.id=f.project_id ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY f.created_at DESC LIMIT ?`,
      parameters,
    );
  });

  app.patch("/admin/feedback/:id", async (request, reply) => {
    const admin = requireAdmin(request, reply);
    if (!admin) return;
    const { id } = request.params as { id: string },
      body = request.body as { status?: string },
      status = String(body.status || "").trim();
    if (!["open", "reviewing", "resolved", "closed"].includes(status))
      return reply
        .code(400)
        .send({ error: "反馈状态仅支持 open、reviewing、resolved、closed" });
    const feedback = getOne("SELECT id,title,status FROM feedback WHERE id=?", [
      id,
    ]);
    if (!feedback) return reply.code(404).send({ error: "反馈不存在" });
    database.run("UPDATE feedback SET status=? WHERE id=?", [status, id]);
    persist();
    request.log.info(
      { feedbackId: id, status, adminId: admin.id },
      "admin feedback status updated",
    );
    return {
      id: String(feedback.id),
      title: String(feedback.title),
      previousStatus: String(feedback.status),
      status,
    };
  });

  app.post("/admin/notifications", async (request, reply) => {
    const admin = requireAdmin(request, reply);
    if (!admin) return;
    const body = request.body as {
        title?: string;
        content?: string;
        type?: string;
        priority?: string;
        autoPopup?: boolean;
      },
      title = String(body.title || "").trim(),
      content = String(body.content || "").trim(),
      type = String(body.type || "update").trim(),
      priority = body.priority === "important" ? "important" : "normal",
      autoPopup = body.autoPopup === true;
    if (title.length < 2 || title.length > 100)
      return reply.code(400).send({ error: "通知标题需要 2–100 个字符" });
    if (content.length < 2 || content.length > 3000)
      return reply.code(400).send({ error: "通知内容需要 2–3000 个字符" });
    if (!["update", "fix", "notice", "maintenance"].includes(type))
      return reply
        .code(400)
        .send({ error: "通知类型仅支持 update、fix、notice、maintenance" });
    const id = randomUUID(),
      createdAt = new Date().toISOString();
    database.run(
      "INSERT INTO notifications (id,title,content,type,created_at,priority,auto_popup) VALUES (?,?,?,?,?,?,?)",
      [id, title, content, type, createdAt, priority, autoPopup ? 1 : 0],
    );
    persist();
    broadcastNotificationSync();
    request.log.info(
      { notificationId: id, adminId: admin.id, type, priority, autoPopup },
      "admin notification published",
    );
    return reply
      .code(201)
      .send({ id, title, content, type, priority, autoPopup, createdAt });
  });
}
