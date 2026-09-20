import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dataDirectory } from "../storage/database.js";

export const DOWNLOAD_TTL_SECONDS = 900;
const keyPath = `${dataDirectory}/asset-download.key`;
try {
  writeFileSync(keyPath, randomBytes(32), { flag: "wx", mode: 0o600 });
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
}
const key = readFileSync(keyPath);
if (key.length !== 32) throw new Error("Invalid asset download signing key");

type Claims = {
  assetId: string;
  userId: string;
  expires: number;
  nonce: string;
};
function signature(payload: string, credentialHash: string) {
  return createHmac("sha256", key)
    .update(`asset-download-v1:${payload}:${credentialHash}`)
    .digest();
}
export function issueDownloadTicket(
  assetId: string,
  userId: string,
  credentialHash: string,
) {
  const expires = Math.floor(Date.now() / 1000) + DOWNLOAD_TTL_SECONDS;
  const payload = Buffer.from(
    JSON.stringify({
      assetId,
      userId,
      expires,
      nonce: randomBytes(16).toString("hex"),
    }),
  ).toString("base64url");
  return {
    ticket: `${payload}.${signature(payload, credentialHash).toString("base64url")}`,
    expires,
  };
}
export function readDownloadClaims(ticket: string): Claims | undefined {
  if (ticket.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(ticket))
    return;
  try {
    const value = JSON.parse(
      Buffer.from(ticket.split(".")[0], "base64url").toString("utf8"),
    );
    const now = Math.floor(Date.now() / 1000);
    if (
      typeof value.assetId !== "string" ||
      typeof value.userId !== "string" ||
      typeof value.nonce !== "string" ||
      !Number.isSafeInteger(value.expires) ||
      value.expires <= now ||
      value.expires > now + DOWNLOAD_TTL_SECONDS
    )
      return;
    return value;
  } catch {
    return;
  }
}
export function verifyDownloadTicket(ticket: string, credentialHash: string) {
  const [payload, encoded] = ticket.split(".");
  const actual = Buffer.from(encoded || "", "base64url");
  const expected = signature(payload, credentialHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
