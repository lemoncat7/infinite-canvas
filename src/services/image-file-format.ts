export const SUPPORTED_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
] as const;

const supported = new Set<string>(SUPPORTED_IMAGE_MIME_TYPES);

export const IMAGE_FILE_ACCEPT = SUPPORTED_IMAGE_MIME_TYPES.join(",");
export const SUPPORTED_IMAGE_FORMAT_LABEL = "PNG、JPEG、WebP、GIF、AVIF";

export function isSupportedImageFile(file: Pick<File, "type">) {
  return supported.has(file.type.toLowerCase().split(";")[0]);
}
