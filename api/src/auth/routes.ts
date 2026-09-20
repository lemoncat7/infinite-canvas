import { type FastifyInstance } from "fastify";
import { randomBytes, randomUUID } from "node:crypto";
import { developmentUserId } from "../core/config.js";
import { createDefaultProject } from "../projects/defaults.js";
import {
  database,
  getOne,
  newInviteCode,
  normalizeEmail,
  persist,
  sessionStore,
} from "../storage/database.js";
import {
  hashApiToken,
  hashPassword,
  secureTextEqual,
  verifyPassword,
} from "./crypto.js";
import {
  browserDeviceIdentity,
  clearAuthCookies,
  clearSessionCookie,
  requireUser,
  sessionToken,
  setAuthCookies,
  trustedDeviceToken,
} from "./service.js";
import { validEmail } from "./validation.js";

export function registerAuthRoutes(app: FastifyInstance) {
  app.post("/auth/register", async (request, reply) => {
    const body = request.body as {
        name?: string;
        email?: string;
        password?: string;
        inviteCode?: string;
      },
      name = String(body.name ?? "").trim(),
      email = normalizeEmail(body.email),
      password = String(body.password ?? ""),
      inviteCode = String(body.inviteCode ?? "").trim(),
      configuredInviteCode = String(
        process.env.REGISTRATION_INVITE_CODE ?? "",
      ).trim();
    const inviter = inviteCode
      ? getOne("SELECT id FROM users WHERE upper(invite_code) = ?", [
          inviteCode.toUpperCase(),
        ])
      : undefined;
    if (!configuredInviteCode && !inviter)
      return reply.code(503).send({ error: "注册暂未开放" });
    if (
      !inviter &&
      (!configuredInviteCode ||
        !secureTextEqual(inviteCode, configuredInviteCode))
    )
      return reply.code(403).send({ error: "邀请码无效" });
    if (name.length < 2 || name.length > 40)
      return reply
        .code(400)
        .send({ error: "昵称长度需要在 2 到 40 个字符之间" });
    if (!validEmail(email))
      return reply.code(400).send({ error: "请输入有效邮箱" });
    if (password.length < 8 || password.length > 128)
      return reply.code(400).send({ error: "密码至少需要 8 个字符" });
    if (getOne("SELECT id FROM users WHERE lower(email) = ?", [email]))
      return reply.code(409).send({ error: "该邮箱已注册" });
    if (
      getOne("SELECT id FROM users WHERE lower(username) = ?", [
        name.toLowerCase(),
      ])
    )
      return reply.code(409).send({ error: "该用户名已被使用" });
    const now = new Date().toISOString(),
      legacy = getOne(
        "SELECT id FROM users WHERE id = ? AND (email IS NULL OR email = ?)",
        [developmentUserId, ""],
      );
    let userId: string;
    if (legacy) {
      userId = developmentUserId;
      database.run(
        "UPDATE users SET name = ?, email = ?, password_hash = ?, username = COALESCE(NULLIF(username, ?), ?), invited_by = COALESCE(invited_by, ?) WHERE id = ?",
        [
          name,
          email,
          hashPassword(password),
          "",
          name,
          inviter?.id ?? null,
          userId,
        ],
      );
    } else {
      userId = randomUUID();
      database.run(
        "INSERT INTO users (id, name, email, password_hash, username, invite_code, invited_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
          userId,
          name,
          email,
          hashPassword(password),
          name,
          newInviteCode(),
          inviter?.id ?? null,
          now,
        ],
      );
      createDefaultProject(userId, now);
    }
    const deviceIdentity = browserDeviceIdentity(request);
    const trustedToken = sessionStore.createTrustedDevice(
      userId,
      String(request.headers["user-agent"] ?? ""),
      deviceIdentity,
      trustedDeviceToken(request),
    );
    const token = sessionStore.createSession(
      userId,
      now,
      sessionStore.trustedFamilyId(trustedToken),
    );
    persist();
    setAuthCookies(request, reply, token, trustedToken, deviceIdentity);
    if (!legacy)
      database.run("UPDATE users SET credits = 5 WHERE id = ?", [userId]);
    const createdUser = getOne(
      "SELECT username, invite_code AS inviteCode, credits, reserved_credits AS reservedCredits, is_admin AS isAdmin FROM users WHERE id = ?",
      [userId],
    );
    return reply.code(201).send({
      id: userId,
      name,
      username: createdUser?.username,
      email,
      inviteCode: createdUser?.inviteCode,
      createdAt: now,
      credits: Number(createdUser?.credits ?? 0),
      reservedCredits: Number(createdUser?.reservedCredits ?? 0),
      isAdmin: Boolean(createdUser?.isAdmin),
    });
  });

  app.post("/auth/login", async (request, reply) => {
    const body = request.body as {
        email?: string;
        account?: string;
        password?: string;
      },
      account = String(body.account ?? body.email ?? "")
        .trim()
        .toLowerCase(),
      password = String(body.password ?? ""),
      user = getOne(
        "SELECT id, name, username, email, password_hash, invite_code AS inviteCode, created_at AS createdAt, credits, reserved_credits AS reservedCredits, is_admin AS isAdmin FROM users WHERE lower(email) = ? OR lower(username) = ? ORDER BY CASE WHEN lower(email) = ? THEN 0 ELSE 1 END LIMIT 1",
        [account, account, account],
      );
    if (!user || !verifyPassword(password, String(user.password_hash ?? "")))
      return reply.code(401).send({ error: "用户名、邮箱或密码错误" });
    const deviceIdentity = browserDeviceIdentity(request);
    const trustedToken = sessionStore.createTrustedDevice(
      String(user.id),
      String(request.headers["user-agent"] ?? ""),
      deviceIdentity,
      trustedDeviceToken(request),
    );
    const token = sessionStore.createSession(
      String(user.id),
      new Date().toISOString(),
      sessionStore.trustedFamilyId(trustedToken),
    );
    persist();
    setAuthCookies(request, reply, token, trustedToken, deviceIdentity);
    return {
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      inviteCode: user.inviteCode,
      createdAt: user.createdAt,
      credits: Number(user.credits ?? 0),
      reservedCredits: Number(user.reservedCredits ?? 0),
      isAdmin: Boolean(user.isAdmin),
    };
  });

  app.post("/auth/logout", async (request, reply) => {
    const token = sessionToken(request);
    sessionStore.revokeSession(token);
    sessionStore.revokeTrustedDevice(trustedDeviceToken(request));
    persist();
    clearAuthCookies(request, reply);
    return { ok: true };
  });

  app.post("/auth/refresh", async (request, reply) => {
    const result = sessionStore.rotateTrustedDevice(
      trustedDeviceToken(request),
      String(request.headers["user-agent"] ?? ""),
    );
    if (result.status !== "ok") {
      persist();
      clearAuthCookies(request, reply);
      return reply
        .code(401)
        .send({ error: "Trusted device expired", reason: result.status });
    }
    persist();
    setAuthCookies(request, reply, result.sessionToken, result.trustedToken);
    return { ok: true };
  });

  app.get("/auth/devices", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    return sessionStore.listTrustedDevices(
      String(user.id),
      trustedDeviceToken(request),
    );
  });

  app.delete("/auth/devices/:deviceId", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { deviceId } = request.params as { deviceId: string };
    if (!sessionStore.revokeDeviceById(String(user.id), deviceId))
      return reply.code(404).send({ error: "设备不存在" });
    persist();
    return { ok: true };
  });

  app.post("/auth/devices/revoke-others", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    if (
      !sessionStore.revokeOtherDevices(
        String(user.id),
        trustedDeviceToken(request),
      )
    )
      return reply.code(409).send({ error: "当前设备凭证不可用" });
    persist();
    return { ok: true };
  });

  app.post("/auth/activity", async (request, reply) => {
    const token = sessionToken(request);
    if (!sessionStore.touchSession(token)) {
      persist();
      clearSessionCookie(request, reply);
      return reply.code(401).send({ error: "Session expired" });
    }
    persist();
    return { ok: true };
  });

  app.get("/users/me", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    return {
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      inviteCode: user.inviteCode,
      createdAt: user.createdAt,
      credits: Number(user.credits ?? 0),
      reservedCredits: Number(user.reservedCredits ?? 0),
      isAdmin: Boolean(user.isAdmin),
    };
  });

  app.post("/users/me/api-token", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const token = `viora_${randomBytes(30).toString("base64url")}`,
      hint = `${token.slice(0, 10)}…${token.slice(-6)}`;
    database.run(
      "UPDATE users SET api_token_hash=?,api_token_hint=? WHERE id=?",
      [hashApiToken(token), hint, String(user.id)],
    );
    persist();
    return { token, hint, createdAt: new Date().toISOString() };
  });

  app.get("/users/me/api-token", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const row = getOne("SELECT api_token_hint AS hint FROM users WHERE id=?", [
      String(user.id),
    ]);
    return { exists: Boolean(row?.hint), hint: String(row?.hint || "") };
  });

  app.patch("/users/me", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const name = String((request.body as { name?: string }).name ?? "").trim();
    if (name.length < 2 || name.length > 40)
      return reply
        .code(400)
        .send({ error: "昵称长度需要在 2 到 40 个字符之间" });
    database.run("UPDATE users SET name = ? WHERE id = ?", [
      name,
      String(user.id),
    ]);
    persist();
    return { ...user, name };
  });
}
