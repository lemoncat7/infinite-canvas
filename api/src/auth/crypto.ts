import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex"),
    digest = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${digest}`;
}

export function verifyPassword(password: string, stored: string) {
  const [, salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  try {
    const actual = scryptSync(password, salt, 64),
      expectedBytes = Buffer.from(expected, "hex");
    return (
      actual.length === expectedBytes.length &&
      timingSafeEqual(actual, expectedBytes)
    );
  } catch {
    return false;
  }
}

export function secureTextEqual(actual: string, expected: string) {
  const left = createHash("sha256").update(actual).digest(),
    right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

export function normalizeRechargeCode(value: unknown) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

export function hashRechargeCode(code: string) {
  return createHash("sha256").update(code).digest("hex");
}

export function hashApiToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
