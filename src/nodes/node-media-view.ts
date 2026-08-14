import type { FlowNode } from "./node-types";

interface NodeMediaViewOptions {
  element: HTMLElement;
  node: FlowNode;
  onscreen: boolean;
  locked: boolean;
  workflowWaiting: boolean;
  paintThumbnail: (surface: HTMLElement, url: string) => void;
  clearThumbnail: (surface: HTMLElement) => void;
}

export function syncNodeMediaView(options: NodeMediaViewOptions) {
  const {
    element,
    node,
    onscreen,
    locked,
    workflowWaiting,
    paintThumbnail,
    clearThumbnail,
  } = options;
  const media = element.querySelector<HTMLElement>(".node-media")!,
    mediaSurface =
      element.querySelector<HTMLElement>(".node-media-surface")!;
  if (node.kind === "audio") {
    media.dataset.hasMedia = "true";
    clearThumbnail(mediaSurface);
    const video =
      element.querySelector<HTMLVideoElement>(".node-media-video")!;
    video.hidden = true;
    video.removeAttribute("src");
  } else if (node.mediaUrl && onscreen) {
    media.dataset.hasMedia = "true";
    if (media.dataset.sourceKey !== node.mediaUrl) {
      media.dataset.sourceKey = node.mediaUrl;
      const video =
        element.querySelector<HTMLVideoElement>(".node-media-video")!;
      video.hidden = true;
      video.removeAttribute("src");
      paintThumbnail(mediaSurface, node.mediaUrl);
    }
  } else {
    delete media.dataset.hasMedia;
    delete media.dataset.sourceKey;
    clearThumbnail(mediaSurface);
    const video =
      element.querySelector<HTMLVideoElement>(".node-media-video")!;
    video.hidden = true;
    video.removeAttribute("src");
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
