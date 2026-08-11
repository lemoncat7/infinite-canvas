import type { LibraryAsset } from "../services/assets";

export type AssetFilter = {
  query: string;
  scope: string;
  type: string;
  sort: string;
  currentProjectId: string;
};

export function filterAssets(
  assets: readonly LibraryAsset[],
  filter: AssetFilter,
) {
  const query = filter.query.trim().toLocaleLowerCase();
  return [...assets]
    .filter(
      (asset) =>
        (filter.scope === "all" || asset.projectId === filter.currentProjectId) &&
        (filter.type === "all" || asset.mimeType.startsWith(`${filter.type}/`)) &&
        asset.name.toLocaleLowerCase().includes(query),
    )
    .sort((a, b) =>
      filter.sort === "name"
        ? a.name.localeCompare(b.name, "zh-CN")
        : filter.sort === "oldest"
          ? Date.parse(a.createdAt) - Date.parse(b.createdAt)
          : Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );
}

export function formatFileSize(size: number) {
  return size >= 1024 * 1024
    ? `${(size / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(size / 1024))} KB`;
}
