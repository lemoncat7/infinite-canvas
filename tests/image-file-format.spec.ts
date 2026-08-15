import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  IMAGE_FILE_ACCEPT,
  isSupportedImageFile,
  SUPPORTED_IMAGE_MIME_TYPES,
} from "../src/services/image-file-format";

test("upload and clipboard inputs use the explicit supported image formats", () => {
  expect(SUPPORTED_IMAGE_MIME_TYPES).toEqual([
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "image/avif",
  ]);
  expect(IMAGE_FILE_ACCEPT).toBe(SUPPORTED_IMAGE_MIME_TYPES.join(","));
  expect(isSupportedImageFile({ type: "image/png" })).toBe(true);
  expect(isSupportedImageFile({ type: "image/svg+xml" })).toBe(false);
  expect(isSupportedImageFile({ type: "image/tiff" })).toBe(false);
  expect(isSupportedImageFile({ type: "application/octet-stream" })).toBe(false);
});

test("server validates decoded image content before writing any upload", () => {
  const validator = readFileSync("api/src/image-upload-validation.ts", "utf8");
  const route = readFileSync("api/src/server.ts", "utf8");
  const uploadRoute = route.slice(
    route.indexOf('app.post("/projects/:projectId/assets"'),
    route.indexOf('app.get("/assets/:assetId/content"'),
  );
  expect(validator).toContain("sharp(bytes, { animated: true }).metadata()");
  expect(validator).toContain("declaredMimeType !== actualMimeType");
  expect(uploadRoute).toContain("await Promise.all((body.files ?? []).map(validateImageUpload))");
  expect(uploadRoute.indexOf("await Promise.all((body.files ?? []).map(validateImageUpload))"))
    .toBeLessThan(uploadRoute.indexOf('writeFileSync(`${uploadDirectory}/${storageName}`, bytes)'));
});
