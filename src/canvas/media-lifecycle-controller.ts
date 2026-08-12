import { MediaLruCache } from "./media-cache";

export class MediaLifecycleController {
  readonly pendingLoads = new Set<string>();
  readonly retries = new Map<string, number>();
  readonly cache: MediaLruCache<HTMLImageElement>;
  private restoreFrame = 0;
  private restoreTimer = 0;

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
      if (this.restoreTimer) clearTimeout(this.restoreTimer);
      this.restoreFrame = 0;
      this.restoreTimer = 0;
    };
    const restore = () => {
      if (document.visibilityState !== "visible") return;
      cancelRestore();
      document.body.classList.remove("page-backgrounded", "page-unfocused");
      options.resumeRenderer();
      this.restoreFrame = requestAnimationFrame(() => {
        this.restoreFrame = 0;
        options.resize();
        // Restore the GPU scene first. DOM media repainting is deliberately
        // deferred so the first pointer interaction after tab focus stays hot.
        options.draw(false);
        this.restoreTimer = window.setTimeout(() => {
          this.restoreTimer = 0;
          if (document.visibilityState !== "visible") return;
          options.clearNodeStates();
          options.draw(true);
        }, 180);
      });
    };
    document.addEventListener("visibilitychange", () => {
      const backgrounded = document.hidden;
      document.body.classList.toggle("page-backgrounded", backgrounded);
      if (backgrounded) {
        cancelRestore();
        options.suspendRenderer();
        this.clear();
        this.releasePreviews();
        options.clearNodeStates();
        options.nodeLayer
          .querySelectorAll<HTMLElement>(".node-media")
          .forEach((media) => delete media.dataset.sourceKey);
        options.nodeLayer
          .querySelectorAll<HTMLCanvasElement>("[data-reference-url]")
          .forEach((media) => delete media.dataset.paintedUrl);
        options.nodeLayer
          .querySelectorAll<HTMLCanvasElement>(".node-media-canvas")
          .forEach((media) => {
            media.width = 2;
            media.height = 2;
          });
      } else restore();
    });
    window.addEventListener("pagehide", () => { cancelRestore(); this.clear(); });
    window.addEventListener("pageshow", restore);
    window.addEventListener("focus", restore);
    window.addEventListener("blur", () =>
      document.body.classList.add("page-unfocused"),
    );
  }
}
