export function normalizeHttpUrl(value: unknown) {
  try {
    const url = new URL(String(value ?? "").trim());
    return ["http:", "https:"].includes(url.protocol)
      ? url.toString().replace(/\/$/, "")
      : "";
  } catch {
    return "";
  }
}

export function validEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}
