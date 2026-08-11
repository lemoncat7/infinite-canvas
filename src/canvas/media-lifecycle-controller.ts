import { MediaLruCache } from "./media-cache";

export class MediaLifecycleController {
  readonly pendingLoads = new Set<string>();
  readonly retries = new Map<string, number>();
  readonly cache: MediaLruCache<HTMLImageElement>;

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
    document.addEventListener("visibilitychange", () => {
      const backgrounded = document.hidden;
      if (backgrounded) options.suspendRenderer();
      else options.resumeRenderer();
      document.body.classList.toggle("page-backgrounded", backgrounded);
      if (backgrounded) {
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
      } else {
        options.clearNodeStates();
        options.draw(true);
      }
    });
    window.addEventListener("pagehide", () => this.clear());
    window.addEventListener("pageshow", () => {
      document.body.classList.remove("page-backgrounded", "page-unfocused");
      options.clearNodeStates();
      requestAnimationFrame(() => {
        options.resize();
        options.draw(true);
      });
    });
    window.addEventListener("focus", () => {
      if (document.visibilityState !== "visible") return;
      document.body.classList.remove("page-backgrounded", "page-unfocused");
      requestAnimationFrame(() => options.draw(true));
    });
    window.addEventListener("blur", () =>
      document.body.classList.add("page-unfocused"),
    );
    window.addEventListener("focus", () => {
      document.body.classList.remove("page-unfocused");
      options.draw();
    });
  }
}
