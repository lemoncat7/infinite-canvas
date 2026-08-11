import { apiFetch } from "./api";

export type LibraryAsset = {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
  url: string;
  thumbnailUrl?: string;
  isPublic: boolean;
};

export async function fetchAssets(projectId?: string) {
  const response = await apiFetch(
    projectId ? `/api/projects/${projectId}/assets` : "/api/assets",
  );
  if (!response.ok) throw new Error("资产加载失败");
  return (await response.json()) as LibraryAsset[];
}

export async function deleteAsset(id: string) {
  return apiFetch(`/api/assets/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
