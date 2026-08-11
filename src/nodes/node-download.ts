import type { FlowNode } from "./node-types";
import { fetchAssetBlob } from "../services/assets";

const imageExtensions: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/svg+xml": "svg",
};

export async function downloadNodeImage(node: FlowNode) {
  if (!node.mediaUrl) return;
  const blob = await fetchAssetBlob(node.mediaUrl);
  const extension = imageExtensions[blob.type.split(";")[0].toLowerCase()] ?? "png";
  const title = (node.title || "图片").trim().replace(/[\\/:*?"<>|]/g, "-") || "图片";
  const filename = /\.[a-z0-9]{2,5}$/i.test(title) ? title : `${title}.${extension}`;
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
