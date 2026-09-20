import { type FastifyReply, type FastifyRequest } from "fastify";
import { createHash, randomBytes } from "node:crypto";
import { getOne } from "../storage/database.js";
import { hashApiToken, secureTextEqual } from "./crypto.js";
import { SESSION_IDLE_MS, TRUSTED_DEVICE_MS } from "./session-store.js";

export function sessionId(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function sessionToken(request: FastifyRequest) {
  return cookieToken(request, "flow_session");
}

export function trustedDeviceToken(request: FastifyRequest) {
  return cookieToken(request, "flow_trusted_device");
}

export function browserDeviceIdentity(request: FastifyRequest) {
  const value = cookieToken(request, "flow_browser_device");
  return /^[A-Za-z0-9_-]{43}$/.test(value)
    ? value
    : randomBytes(32).toString("base64url");
}

export function cookieToken(request: FastifyRequest, name: string) {
  const cookie = String(request.headers.cookie ?? "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : "";
}

export function currentUser(request: FastifyRequest) {
  const authorization = String(request.headers.authorization || ""),
    bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer?.startsWith("viora_"))
    return getOne(
      "SELECT id,name,username,email,invite_code AS inviteCode,created_at AS createdAt,credits,reserved_credits AS reservedCredits,is_admin AS isAdmin FROM users WHERE api_token_hash=?",
      [hashApiToken(bearer)],
    );
  const token = sessionToken(request);
  if (!token) return undefined;
  const now = new Date(),
    idleCutoff = new Date(now.getTime() - SESSION_IDLE_MS).toISOString();
  return getOne(
    `SELECT users.id, users.name, users.username, users.email, users.invite_code AS inviteCode, users.created_at AS createdAt, users.credits, users.reserved_credits AS reservedCredits, users.is_admin AS isAdmin FROM sessions JOIN users ON users.id = sessions.user_id
  WHERE sessions.id = ? AND sessions.expires_at > ? AND COALESCE(sessions.last_activity_at,sessions.created_at) > ?`,
    [sessionId(token), now.toISOString(), idleCutoff],
  );
}

export function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const user = currentUser(request),
    configured = String(process.env.ADMIN_API_KEY || ""),
    provided = String(request.headers["x-admin-key"] || ""),
    keyAuthorized = Boolean(
      configured && provided && secureTextEqual(provided, configured),
    );
  if (user?.isAdmin) return user;
  if (keyAuthorized) return { id: "admin-api-key", isAdmin: true };
  void reply
    .code(user ? 403 : 401)
    .send({ error: user ? "仅管理员可以执行此操作" : "Unauthorized" });
  return undefined;
}

export function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const user = currentUser(request);
  if (!user) {
    void reply.code(401).send({ error: "Unauthorized" });
    return undefined;
  }
  return user;
}

export function secureRequest(request: FastifyRequest) {
  const proto = request.headers["x-forwarded-proto"];
  return (Array.isArray(proto) ? proto[0] : proto) === "https";
}

export function setSessionCookie(
  request: FastifyRequest,
  reply: FastifyReply,
  token: string,
) {
  reply.header(
    "set-cookie",
    `flow_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.ceil(SESSION_IDLE_MS / 1000)}${secureRequest(request) ? "; Secure" : ""}`,
  );
}

export function setAuthCookies(
  request: FastifyRequest,
  reply: FastifyReply,
  session: string,
  trusted: string,
  deviceIdentity = browserDeviceIdentity(request),
) {
  const secure = secureRequest(request) ? "; Secure" : "";
  reply.header("set-cookie", [
    `flow_session=${encodeURIComponent(session)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.ceil(SESSION_IDLE_MS / 1000)}${secure}`,
    `flow_trusted_device=${encodeURIComponent(trusted)}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=${Math.ceil(TRUSTED_DEVICE_MS / 1000)}${secure}`,
    `flow_browser_device=${encodeURIComponent(deviceIdentity)}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`,
  ]);
}

export function clearSessionCookie(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  reply.header(
    "set-cookie",
    `flow_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureRequest(request) ? "; Secure" : ""}`,
  );
}

export function clearAuthCookies(request: FastifyRequest, reply: FastifyReply) {
  const secure = secureRequest(request) ? "; Secure" : "";
  reply.header("set-cookie", [
    `flow_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
    `flow_trusted_device=; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
  ]);
}
