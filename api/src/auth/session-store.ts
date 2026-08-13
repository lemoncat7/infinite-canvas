import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Database } from "sql.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const SESSION_IDLE_MS = Math.max(60_000, Number(process.env.SESSION_IDLE_TIMEOUT_MS || 2 * HOUR));
export const TRUSTED_DEVICE_MS = Math.max(HOUR, Number(process.env.TRUSTED_DEVICE_TIMEOUT_MS || 30 * DAY));

export type TrustedDeviceRotation =
  | { status: "ok"; userId: string; sessionToken: string; trustedToken: string }
  | { status: "missing" | "expired" | "revoked" | "replayed" };

export type TrustedDevice = {
  id: string;
  name: string;
  current: boolean;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
};

export class SessionStore {
  constructor(private readonly database: Database) {}

  initialize() {
    this.database.run(`
      CREATE TABLE IF NOT EXISTS trusted_devices (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        family_id TEXT NOT NULL,
        device_name TEXT,
        user_agent TEXT,
        created_at TEXT NOT NULL,
        last_used_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        replaced_by TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_trusted_devices_user ON trusted_devices(user_id);
      CREATE INDEX IF NOT EXISTS idx_trusted_devices_family ON trusted_devices(family_id);
    `);
    this.cleanup();
  }

  createSession(userId: string, createdAt = new Date().toISOString(), trustedFamilyId = "") {
    const token = randomBytes(32).toString("base64url");
    this.database.run(
      "INSERT INTO sessions (id,user_id,created_at,expires_at,last_activity_at,trusted_family_id) VALUES (?,?,?,?,?,?)",
      [this.hash(token), userId, createdAt, new Date(Date.now() + SESSION_IDLE_MS).toISOString(), createdAt, trustedFamilyId || null],
    );
    return token;
  }

  createTrustedDevice(userId: string, userAgent = "") {
    const token = randomBytes(48).toString("base64url");
    const now = new Date().toISOString();
    this.database.run(
      "INSERT INTO trusted_devices (id,user_id,token_hash,family_id,device_name,user_agent,created_at,last_used_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [randomUUID(), userId, this.hash(token), randomUUID(), this.deviceName(userAgent), userAgent.slice(0, 500), now, now, new Date(Date.now() + TRUSTED_DEVICE_MS).toISOString()],
    );
    return token;
  }

  trustedFamilyId(token: string) {
    if (!token) return "";
    const row = this.one("SELECT family_id FROM trusted_devices WHERE token_hash=?", [this.hash(token)]);
    return row ? String(row.family_id) : "";
  }

  rotateTrustedDevice(token: string, userAgent = ""): TrustedDeviceRotation {
    if (!token) return { status: "missing" };
    const row = this.one("SELECT * FROM trusted_devices WHERE token_hash=?", [this.hash(token)]);
    if (!row) return { status: "missing" };
    const now = new Date().toISOString();
    if (row.replaced_by) {
      this.revokeFamily(String(row.family_id), now);
      return { status: "replayed" };
    }
    if (row.revoked_at) return { status: "revoked" };
    if (String(row.expires_at) <= now) {
      this.database.run("UPDATE trusted_devices SET revoked_at=? WHERE id=?", [now, row.id]);
      return { status: "expired" };
    }
    const nextToken = randomBytes(48).toString("base64url");
    const nextId = randomUUID();
    this.database.run(
      "INSERT INTO trusted_devices (id,user_id,token_hash,family_id,device_name,user_agent,created_at,last_used_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [nextId, row.user_id, this.hash(nextToken), row.family_id, this.deviceName(userAgent), userAgent.slice(0, 500), now, now, new Date(Date.now() + TRUSTED_DEVICE_MS).toISOString()],
    );
    this.database.run("UPDATE trusted_devices SET replaced_by=?,last_used_at=? WHERE id=?", [nextId, now, row.id]);
    return { status: "ok", userId: String(row.user_id), sessionToken: this.createSession(String(row.user_id), now, String(row.family_id)), trustedToken: nextToken };
  }

  revokeSession(token: string) {
    if (token) this.database.run("DELETE FROM sessions WHERE id=?", [this.hash(token)]);
  }

  revokeTrustedDevice(token: string) {
    if (!token) return;
    const row = this.one("SELECT family_id FROM trusted_devices WHERE token_hash=?", [this.hash(token)]);
    if (row) this.revokeFamily(String(row.family_id), new Date().toISOString());
  }

  listTrustedDevices(userId: string, currentToken: string): TrustedDevice[] {
    const currentHash = currentToken ? this.hash(currentToken) : "";
    return this.all(
      `SELECT id,device_name,user_agent,created_at,last_used_at,expires_at,token_hash
       FROM trusted_devices
       WHERE user_id=? AND revoked_at IS NULL AND replaced_by IS NULL AND expires_at>?
       ORDER BY last_used_at DESC`,
      [userId, new Date().toISOString()],
    ).map((row) => ({
      id: String(row.id),
      name: String(row.device_name || this.deviceName(String(row.user_agent || ""))),
      current: String(row.token_hash) === currentHash,
      createdAt: String(row.created_at),
      lastUsedAt: String(row.last_used_at),
      expiresAt: String(row.expires_at),
    }));
  }

  revokeDeviceById(userId: string, deviceId: string) {
    const row = this.one("SELECT family_id FROM trusted_devices WHERE id=? AND user_id=?", [deviceId, userId]);
    if (!row) return false;
    this.revokeFamily(String(row.family_id), new Date().toISOString());
    return true;
  }

  revokeOtherDevices(userId: string, currentToken: string) {
    const current = this.one("SELECT family_id FROM trusted_devices WHERE token_hash=? AND user_id=?", [this.hash(currentToken), userId]);
    if (!current) return false;
    this.database.run("UPDATE trusted_devices SET revoked_at=COALESCE(revoked_at,?) WHERE user_id=? AND family_id<>?", [new Date().toISOString(), userId, current.family_id]);
    return true;
  }

  touchSession(token: string) {
    if (!token) return false;
    const now = new Date();
    const row = this.one(
      `SELECT sessions.id FROM sessions
       WHERE sessions.id=? AND sessions.expires_at>? AND COALESCE(sessions.last_activity_at,sessions.created_at)>?
       AND (sessions.trusted_family_id IS NULL OR EXISTS (
         SELECT 1 FROM trusted_devices
         WHERE trusted_devices.family_id=sessions.trusted_family_id
           AND trusted_devices.revoked_at IS NULL AND trusted_devices.expires_at>?
       ))`,
      [this.hash(token), now.toISOString(), new Date(now.getTime() - SESSION_IDLE_MS).toISOString(), now.toISOString()],
    );
    if (!row) { this.revokeSession(token); return false; }
    this.database.run("UPDATE sessions SET last_activity_at=?,expires_at=? WHERE id=?", [now.toISOString(), new Date(now.getTime() + SESSION_IDLE_MS).toISOString(), row.id]);
    return true;
  }

  cleanup() {
    const now = new Date().toISOString();
    this.database.run("DELETE FROM sessions WHERE expires_at<=?", [now]);
    this.database.run("DELETE FROM trusted_devices WHERE expires_at<=? OR (revoked_at IS NOT NULL AND revoked_at<=?)", [now, new Date(Date.now() - 7 * DAY).toISOString()]);
  }

  private revokeFamily(familyId: string, now: string) {
    this.database.run("UPDATE trusted_devices SET revoked_at=COALESCE(revoked_at,?) WHERE family_id=?", [now, familyId]);
    this.database.run("DELETE FROM sessions WHERE trusted_family_id=?", [familyId]);
  }
  private hash(token: string) { return createHash("sha256").update(token).digest("hex"); }
  private deviceName(userAgent: string) {
    if (/iphone|ipad/i.test(userAgent)) return "iPhone / iPad";
    if (/android/i.test(userAgent)) return "Android";
    if (/macintosh/i.test(userAgent)) return "Mac";
    if (/windows/i.test(userAgent)) return "Windows";
    return "浏览器设备";
  }
  private one(sql: string, params: unknown[]) {
    const statement = this.database.prepare(sql);
    try { statement.bind(params as never[]); return statement.step() ? statement.getAsObject() : undefined; }
    finally { statement.free(); }
  }
  private all(sql: string, params: unknown[]) {
    const statement = this.database.prepare(sql);
    const rows: Record<string, unknown>[] = [];
    try {
      statement.bind(params as never[]);
      while (statement.step()) rows.push(statement.getAsObject());
      return rows;
    } finally { statement.free(); }
  }
}
