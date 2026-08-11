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

export type SquareAsset = {
  id: string;
  name: string;
  mimeType: string;
  createdAt: string;
  author: string;
  url: string;
  thumbnailUrl?: string;
};

export type UploadedAsset = {
  name: string;
  mimeType: string;
  url: string;
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

export async function deleteAssets(ids: Iterable<string>) {
  const results = await Promise.all([...ids].map((id) => deleteAsset(id)));
  return results.filter((response) => !response.ok).length;
}

export async function updateAssetVisibility(id: string, isPublic: boolean) {
  const response = await apiFetch(
    `/api/assets/${encodeURIComponent(id)}/visibility`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isPublic }),
    },
  );
  if (!response.ok) throw new Error("主页展示状态更新失败");
}

export async function fetchShowcaseAssets() {
  const response = await apiFetch("/api/showcase");
  if (!response.ok) throw new Error("作品暂时无法加载");
  return (await response.json()) as SquareAsset[];
}

export async function uploadProjectImages(projectId: string, files: File[]) {
  const payload = await Promise.all(
    files.map(async (file) => ({
      name: file.name || `粘贴图片-${Date.now()}.png`,
      mimeType: file.type,
      data: await fileBase64(file),
    })),
  );
  const response = await apiFetch(`/api/projects/${projectId}/assets`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ files: payload }),
  });
  if (!response.ok)
    throw new Error(
      response.status === 413
        ? "图片过大，单张图片不能超过 100MB"
        : `上传失败（${response.status}）`,
    );
  return (await response.json()) as UploadedAsset[];
}

export async function fetchAssetBlob(url: string) {
  const response = await apiFetch(url);
  if (!response.ok) throw new Error(`资源读取失败（${response.status}）`);
  return response.blob();
}

function fileBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error || new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
}
