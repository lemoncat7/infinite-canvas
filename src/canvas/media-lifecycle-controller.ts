import { MediaLruCache } from "./media-cache";

export class MediaLifecycleController {
  readonly pendingLoads = new Set<string>();
  readonly retries = new Map<string, number>();
  readonly cache: MediaLruCache<HTMLImageElement>;
  private restoreFrame = 0;

  constructor(
    options: {
      mobile: boolean;
      nodeLayer: HTMLElement;
      suspendRenderer: () => void;
      resumeRenderer: () => void;
      clearNodeStates: () => void;
      resize: () => void;
      draw: (syncDom?: boolean) => void;
    },
  ) {
    this.cache = new MediaLruCache<HTMLImageElement>(
      options.mobile ? 24 : 48,
      (url, image) => this.releaseImage(url, image),
      (url) => this.pendingLoads.has(url),
    );
    this.bind(options);
  }

  clear() {
    this.cache.clear();
    this.pendingLoads.clear();
    this.retries.clear();
  }

  trim() {
    this.cache.trim();
  }

  remember(url: string, image: HTMLImageElement) {
    this.cache.set(url, image);
  }

  private releaseImage(url: string, image: HTMLImageElement) {
    this.pendingLoads.delete(url);
    image.onload = null;
    image.onerror = null;
    image.removeAttribute("src");
  }

  private releasePreviews() {
    document
      .querySelectorAll<HTMLVideoElement>("#home-preview video,#preview-video")
      .forEach((video) => {
        video.pause();
        video.removeAttribute("src");
        video.load();
      });
    document
      .querySelectorAll<HTMLImageElement>("#home-preview img,#preview-image")
      .forEach((image) => image.removeAttribute("src"));
    document
      .querySelectorAll<HTMLElement>("#home-preview,#asset-preview")
      .forEach((preview) => preview.classList.remove("open"));
  }

  private bind(options: {
    nodeLayer: HTMLElement;
    suspendRenderer: () => void;
    resumeRenderer: () => void;
    clearNodeStates: () => void;
    resize: () => void;
    draw: (syncDom?: boolean) => void;
  }) {
    const cancelRestore = () => {
      if (this.restoreFrame) cancelAnimationFrame(this.restoreFrame);
      this.restoreFrame = 0;
    };
    const restore = () => {
      if (document.visibilityState !== "visible") return;
      cancelRestore();
      this.restoreFrame = requestAnimationFrame(() => {
        this.restoreFrame = 0;
        options.resize();
        options.draw(false);
      });
    };
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) cancelRestore();
      else restore();
    });
    window.addEventListener("pagehide", cancelRestore);
    window.addEventListener("pageshow", restore);
    window.addEventListener("focus", restore);
  }
}
