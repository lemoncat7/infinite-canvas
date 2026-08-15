import sharp from "sharp";

const mimeByFormat: Record<string, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

export const SUPPORTED_IMAGE_FORMATS = "PNG、JPEG、WebP、GIF、AVIF";

export class ImageUploadValidationError extends Error {
  constructor(message: string, readonly statusCode: 413 | 415) {
    super(message);
  }
}

export async function validateImageUpload(file: {
  name: string;
  mimeType: string;
  data: string;
}) {
  const bytes = Buffer.from(file.data, "base64");
  if (bytes.length > 100 * 1024 * 1024)
    throw new ImageUploadValidationError("图片过大，单张图片不能超过 100MB", 413);
  if (!bytes.length)
    throw new ImageUploadValidationError(`${file.name || "图片"} 内容为空`, 415);
  let format = "";
  try {
    format = String((await sharp(bytes, { animated: true }).metadata()).format || "");
  } catch {
    throw new ImageUploadValidationError(`${file.name || "图片"} 不是有效图片`, 415);
  }
  const actualMimeType = mimeByFormat[format];
  if (!actualMimeType)
    throw new ImageUploadValidationError(
      `${file.name || "图片"} 格式不支持；支持 ${SUPPORTED_IMAGE_FORMATS}`,
      415,
    );
  const declaredMimeType = file.mimeType.toLowerCase().split(";")[0];
  if (declaredMimeType !== actualMimeType)
    throw new ImageUploadValidationError(
      `${file.name || "图片"} 的文件内容与声明格式不一致`,
      415,
    );
  return { ...file, bytes, mimeType: actualMimeType };
}
