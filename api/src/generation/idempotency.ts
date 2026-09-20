import { createHash } from "node:crypto";
import { ApplicationError } from "../core/errors.js";
import { database, getOne } from "../storage/database.js";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** User-scoped durable keys. Never expire a key into a new billable submission. */
export function generationRequest(
  userId: string,
  input: unknown,
  rawKey: unknown,
) {
  if (rawKey === undefined) return undefined;
  if (typeof rawKey !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(rawKey))
    throw new ApplicationError(
      400,
      "Idempotency-Key must contain 8–128 letters, digits, underscores or dashes",
    );
  const fingerprint = createHash("sha256")
    .update(canonical(input))
    .digest("hex");
  const existing = getOne(
    "SELECT request_hash, job_id FROM generation_requests WHERE user_id=? AND request_key=?",
    [userId, rawKey],
  );
  if (existing && existing.request_hash !== fingerprint)
    throw new ApplicationError(
      409,
      "This request ID was already used with different generation parameters",
    );
  return {
    key: rawKey,
    fingerprint,
    jobId: existing ? String(existing.job_id) : undefined,
  };
}

export function recordGenerationRequest(
  userId: string,
  request: ReturnType<typeof generationRequest>,
  jobId: string,
) {
  if (request)
    database.run(
      "INSERT INTO generation_requests (user_id, request_key, request_hash, job_id) VALUES (?, ?, ?, ?)",
      [userId, request.key, request.fingerprint, jobId],
    );
}
