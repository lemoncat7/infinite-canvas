import { type FastifyInstance } from "fastify";
import { requireUser } from "../auth/service.js";
import { database, getAll, getOne, persist } from "../storage/database.js";
import {
  broadcastPresence,
  notificationStreams,
  sendNotificationSync,
  sendPresence,
} from "./service.js";

export function registerNotificationsRoutes(app: FastifyInstance) {
  app.get("/notifications", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    return getAll(
      "SELECT n.id,n.title,n.content,n.type,n.created_at AS createdAt,CASE WHEN r.read_at IS NULL THEN 0 ELSE 1 END AS isRead FROM notifications n LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.user_id=? ORDER BY n.created_at DESC LIMIT 100",
      [String(user.id)],
    ).map((item) => ({ ...item, isRead: Boolean(item.isRead) }));
  });

  app.get("/notifications/stream", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    notificationStreams.set(reply.raw, String(user.id));
    sendNotificationSync(reply.raw);
    broadcastPresence();
    const heartbeat = setInterval(() => {
      if (!reply.raw.destroyed) {
        reply.raw.write(`: keepalive ${Date.now()}\n\n`);
        sendPresence(reply.raw);
      }
    }, 25000);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      if (notificationStreams.delete(reply.raw)) broadcastPresence();
    };
    request.raw.once("close", close);
    reply.raw.once("close", close);
  });

  app.post("/notifications/claim-popup", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const localDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()),
      item = getOne(
        "SELECT n.id FROM notifications n LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.user_id=? LEFT JOIN notification_popups p ON p.notification_id=n.id AND p.user_id=? AND p.local_date=? WHERE n.auto_popup=1 AND n.priority='important' AND r.read_at IS NULL AND p.notification_id IS NULL ORDER BY n.created_at DESC LIMIT 1",
        [String(user.id), String(user.id), localDate],
      );
    if (!item) return { show: false };
    database.run(
      "INSERT OR IGNORE INTO notification_popups (notification_id,user_id,local_date,shown_at) VALUES (?,?,?,?)",
      [String(item.id), String(user.id), localDate, new Date().toISOString()],
    );
    persist();
    return { show: true, notificationId: String(item.id) };
  });

  app.post("/notifications/:id/read", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    if (!getOne("SELECT id FROM notifications WHERE id=?", [id]))
      return reply.code(404).send({ error: "通知不存在" });
    database.run(
      "INSERT OR REPLACE INTO notification_reads (notification_id,user_id,read_at) VALUES (?,?,?)",
      [id, String(user.id), new Date().toISOString()],
    );
    persist();
    return { ok: true };
  });

  app.post("/notifications/read-all", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const now = new Date().toISOString();
    for (const item of getAll("SELECT id FROM notifications", []))
      database.run(
        "INSERT OR REPLACE INTO notification_reads (notification_id,user_id,read_at) VALUES (?,?,?)",
        [String(item.id), String(user.id), now],
      );
    persist();
    return { ok: true };
  });
}
