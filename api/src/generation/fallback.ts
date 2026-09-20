import { SdCppImageProvider } from "../providers/sdcpp-image.js";

export const localImageFallback = process.env.SDCPP_IMAGE_BASE_URL
  ? new SdCppImageProvider()
  : null;

export let localImageFallbackAvailable = false;

export async function probeLocalImageFallback() {
  localImageFallbackAvailable = localImageFallback
    ? await localImageFallback.available()
    : false;
}

let timer: ReturnType<typeof setInterval> | undefined;
export function startFallbackProbe() {
  if (timer || !localImageFallback) return;
  void probeLocalImageFallback();
  timer = setInterval(() => void probeLocalImageFallback(), 15000);
  timer.unref();
}
export function stopFallbackProbe() {
  if (timer) clearInterval(timer);
  timer = undefined;
}
