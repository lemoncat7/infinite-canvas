import type { FlowNode } from "./node-types";

interface NodeMediaViewOptions {
  element: HTMLElement;
  node: FlowNode;
  onscreen: boolean;
  locked: boolean;
  workflowWaiting: boolean;
  paintImage: (canvas: HTMLCanvasElement, url: string) => void;
  paintVideo: (canvas: HTMLCanvasElement, url: string) => void;
}

export function syncNodeMediaView(options: NodeMediaViewOptions) {
  const {
    element,
    node,
    onscreen,
    locked,
    workflowWaiting,
    paintImage,
    paintVideo,
  } = options;
  const media = element.querySelector<HTMLElement>(".node-media")!,
    mediaCanvas =
      element.querySelector<HTMLCanvasElement>(".node-media-canvas")!;
  if (node.kind === "audio") {
    media.dataset.hasMedia = "true";
    mediaCanvas.width = 2;
    mediaCanvas.height = 2;
    const video =
      element.querySelector<HTMLVideoElement>(".node-media-video")!;
    video.hidden = true;
    video.removeAttribute("src");
  } else if (node.mediaUrl && onscreen) {
    media.dataset.hasMedia = "true";
    const desiredWidth = Math.max(
        180,
        Math.min(480, Math.round(node.width * 1.35)),
      ),
      desiredHeight = Math.max(
        140,
        Math.min(420, Math.round(node.height * 1.35)),
      ),
      canvasResized =
        mediaCanvas.width !== desiredWidth ||
        mediaCanvas.height !== desiredHeight;
    if (canvasResized) {
      mediaCanvas.width = desiredWidth;
      mediaCanvas.height = desiredHeight;
    }
    if (media.dataset.sourceKey !== node.mediaUrl || canvasResized) {
      media.dataset.sourceKey = node.mediaUrl;
      const video =
        element.querySelector<HTMLVideoElement>(".node-media-video")!;
      if (node.kind === "video") {
        media.style.removeProperty("background-image");
        video.hidden = true;
        video.removeAttribute("src");
        paintVideo(mediaCanvas, node.mediaUrl);
      } else {
        media.style.removeProperty("background-image");
        video.hidden = true;
        video.removeAttribute("src");
        paintImage(mediaCanvas, node.mediaUrl);
      }
    }
  } else {
    delete media.dataset.hasMedia;
    delete media.dataset.sourceKey;
    media.style.removeProperty("background-image");
    const video =
      element.querySelector<HTMLVideoElement>(".node-media-video")!;
    video.hidden = true;
    video.removeAttribute("src");
    if (mediaCanvas.width !== 2 || mediaCanvas.height !== 2) {
      mediaCanvas.width = 2;
      mediaCanvas.height = 2;
    }
  }
  const progress = element.querySelector<HTMLElement>(".node-progress i")!,
    progressTrack = element.querySelector<HTMLElement>(".node-progress")!,
    waitingWithoutProgress =
      locked &&
      (workflowWaiting ||
        node.status === "queued" ||
        Number(node.progress ?? 0) <= 0);
  progress.style.width = waitingWithoutProgress
    ? "100%"
    : `${node.progress ?? 0}%`;
  progressTrack.classList.toggle("visible", locked);
  progressTrack.classList.toggle("indeterminate", waitingWithoutProgress);
}
