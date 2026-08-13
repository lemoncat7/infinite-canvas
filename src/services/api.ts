let refreshPromise: Promise<boolean> | null = null;
let restorePromise: Promise<boolean> | null = null;
let recoveryHandler: (() => Promise<boolean>) | null = null;

export function setSessionRecoveryHandler(handler: (() => Promise<boolean>) | null) {
  recoveryHandler = handler;
}

export function refreshSession() {
  if (!refreshPromise)
    refreshPromise = fetch("/api/auth/refresh", { method: "POST" })
      .then((response) => response.ok)
      .catch(() => false)
      .finally(() => { refreshPromise = null; });
  return refreshPromise;
}

export function restoreSession() {
  if (!restorePromise)
    restorePromise = refreshSession()
      .then(async (refreshed) => refreshed && (recoveryHandler ? recoveryHandler() : true))
      .finally(() => { restorePromise = null; });
  return restorePromise;
}

export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  const response = await fetch(input, init);
  const method = String(init?.method ?? "GET").toUpperCase();
  if (response.status !== 401 || !["GET", "HEAD", "OPTIONS"].includes(method) || String(input).includes("/auth/refresh"))
    return response;
  return (await restoreSession()) ? fetch(input, init) : response;
}

export async function apiJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const response = await apiFetch(input, init);
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as T;
}
