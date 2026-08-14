import type { MediaLifecycleController } from "./media-lifecycle-controller";

export class ThumbnailSurfaceRenderer {
  constructor(
    private readonly lifecycle: MediaLifecycleController,
    private readonly nodeLayer: HTMLElement,
    private readonly refreshAppearance: () => void,
  ) {}

  paint(target: HTMLElement, url: string) {
    const displayUrl = mediaThumbnailUrl(url);
    target.dataset.thumbnailUrl = url;
    let image = this.lifecycle.cache.get(displayUrl);
    if (!image) {
      image = new Image();
      this.lifecycle.pendingLoads.add(displayUrl);
      this.lifecycle.remember(displayUrl, image);
      this.refreshAppearance();
      image.onload = () => {
        this.lifecycle.pendingLoads.delete(displayUrl);
        this.lifecycle.retries.delete(displayUrl);
        this.repaintUrl(url);
        this.lifecycle.trim();
        this.refreshAppearance();
      };
      image.onerror = () => {
        this.lifecycle.pendingLoads.delete(displayUrl);
        this.lifecycle.cache.delete(displayUrl);
        this.refreshAppearance();
        const retries = this.lifecycle.retries.get(displayUrl) ?? 0;
        if (retries >= 2) {
          this.lifecycle.retries.delete(displayUrl);
          this.render(target, image!);
          return;
        }
        this.lifecycle.retries.set(displayUrl, retries + 1);
        window.setTimeout(() => this.retry(url), 700 * (retries + 1));
      };
      image.src = displayUrl;
    } else this.lifecycle.remember(displayUrl, image);
    this.render(target, image);
  }

  repaintUrl(url: string) {
    const image = this.lifecycle.cache.get(mediaThumbnailUrl(url));
    if (!image) return;
    this.surfaces(url).forEach((surface) => this.render(surface, image));
  }

  repaintAll() {
    this.nodeLayer
      .querySelectorAll<HTMLElement>("[data-thumbnail-url]")
      .forEach((surface) => this.paint(surface, surface.dataset.thumbnailUrl!));
  }

  clear(target: HTMLElement) {
    delete target.dataset.thumbnailUrl;
    delete target.dataset.thumbnailState;
    target.style.removeProperty("background-image");
  }

  private retry(url: string) {
    if (document.hidden) return;
    this.surfaces(url).forEach((surface) => this.paint(surface, url));
  }

  private surfaces(url: string) {
    return this.nodeLayer.querySelectorAll<HTMLElement>(
      `[data-thumbnail-url="${CSS.escape(url)}"]`,
    );
  }

  private render(target: HTMLElement, image: HTMLImageElement) {
    if (image.complete && image.naturalWidth) {
      target.dataset.thumbnailState = "ready";
      target.style.backgroundImage = `url(${JSON.stringify(image.currentSrc || image.src)})`;
      return;
    }
    target.dataset.thumbnailState = image.complete ? "error" : "loading";
    target.style.removeProperty("background-image");
  }
}

export function mediaThumbnailUrl(url: string) {
  return url.replace(
    /^(\/api\/(?:public\/)?assets\/[^/]+)\/content(?:\/.*)?$/,
    "$1/thumbnail",
  );
}
