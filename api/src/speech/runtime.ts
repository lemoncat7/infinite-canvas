export const ttsPreviewRequests = new Map<
  string,
  Promise<{ bytes: Buffer; mimeType: string }>
>();
