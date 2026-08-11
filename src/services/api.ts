export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  return fetch(input, init);
}

export async function apiJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const response = await apiFetch(input, init);
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as T;
}
