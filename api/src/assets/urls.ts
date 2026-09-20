export function assetDisposition(name: string) {
  const safe = name.replace(/[\r\n]/g, "").slice(0, 240) || "asset";
  return `inline; filename="asset"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

export function namedAssetUrl(id: string, name: string, isPublic = false) {
  const safe = name.replace(/[\r\n/\\]/g, "").slice(0, 240) || "asset";
  return `/api/${isPublic ? "public/" : ""}assets/${id}/content/${encodeURIComponent(safe)}`;
}

export function assetThumbnailUrl(
  id: string,
  mimeType: string,
  isPublic = false,
) {
  return /^(image|video)\//.test(mimeType)
    ? `/api/${isPublic ? "public/" : ""}assets/${id}/thumbnail`
    : undefined;
}
