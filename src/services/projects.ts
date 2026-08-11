import { apiFetch } from "./api";

export type ProjectSummary = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
  assetCount: number;
  nodeCount: number;
  previewUrl?: string | null;
};

export async function fetchProjects() {
  const response = await apiFetch("/api/projects");
  if (!response.ok) throw new Error("项目加载失败");
  return (await response.json()) as ProjectSummary[];
}

export async function createProject(name: string) {
  const response = await apiFetch("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) throw new Error("项目创建失败");
  return (await response.json()) as ProjectSummary;
}

export function renameProject(id: string, name: string) {
  return apiFetch(`/api/projects/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export function duplicateProject(id: string) {
  return apiFetch(`/api/projects/${encodeURIComponent(id)}/duplicate`, {
    method: "POST",
  });
}

export function removeProject(id: string) {
  return apiFetch(`/api/projects/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
