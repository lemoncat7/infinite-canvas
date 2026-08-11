import { apiFetch } from "./api";

export type NodeIdLease = { projectId: string; start: number; end: number };

export async function requestNodeIdLease(projectId: string, count = 10000): Promise<NodeIdLease> {
  const response = await apiFetch(`/api/projects/${projectId}/canvas/id-block`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ count }),
  });
  const result = (await response.json().catch(() => ({}))) as Partial<NodeIdLease>;
  if (!response.ok || result.projectId !== projectId || !Number.isSafeInteger(result.start)
    || !Number.isSafeInteger(result.end) || Number(result.start) < 1 || Number(result.end) < Number(result.start))
    throw new Error("invalid canvas id lease");
  return { projectId, start: Number(result.start), end: Number(result.end) };
}
