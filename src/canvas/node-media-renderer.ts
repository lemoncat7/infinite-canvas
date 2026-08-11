import type { FlowNode } from "../nodes/node-types";
import type { MediaLifecycleController } from "./media-lifecycle-controller";

export class NodeMediaRenderer {
  constructor(
    private readonly deps: {
      lifecycle: MediaLifecycleController;
      nodes: FlowNode[];
      nodeLayer: HTMLElement;
      theme: () => "dark" | "light";
      invalidateNode: (id: number) => void;
      draw: (syncDom?: boolean) => void;
      refreshAppearance: () => void;
    },
  ) {}

  paint(target: HTMLCanvasElement, url: string) {
    const displayUrl = mediaThumbnailUrl(url);
    let image = this.deps.lifecycle.cache.get(displayUrl);
    if (!image) {
      image = new Image();
      this.deps.lifecycle.pendingLoads.add(displayUrl);
      this.deps.lifecycle.remember(displayUrl, image);
      this.deps.refreshAppearance();
      image.onload = () => {
        this.deps.lifecycle.pendingLoads.delete(displayUrl);
        this.deps.lifecycle.retries.delete(displayUrl);
        this.repaintUrl(url);
        this.deps.lifecycle.trim();
        this.deps.refreshAppearance();
      };
      image.onerror = () => {
        this.deps.lifecycle.pendingLoads.delete(displayUrl);
        this.deps.lifecycle.cache.delete(displayUrl);
        this.deps.refreshAppearance();
        const retries = this.deps.lifecycle.retries.get(displayUrl) ?? 0;
        if (retries >= 2) {
          this.deps.lifecycle.retries.delete(displayUrl);
          this.drawImage(target, image!);
          return;
        }
        this.deps.lifecycle.retries.set(displayUrl, retries + 1);
        window.setTimeout(() => this.retry(url), 700 * (retries + 1));
      };
      image.src = displayUrl;
    } else this.deps.lifecycle.remember(displayUrl, image);
    this.drawImage(target, image);
  }

  repaintUrl(url: string) {
    const image = this.deps.lifecycle.cache.get(mediaThumbnailUrl(url));
    if (!image) return;
    this.deps.nodes
      .filter((node) => node.mediaUrl === url)
      .forEach((node) => {
        const target = this.deps.nodeLayer.querySelector<HTMLCanvasElement>(
          `.flow-node[data-id="${node.id}"] .node-media-canvas`,
        );
        if (target) this.drawImage(target, image);
      });
  }

  repaintAll() {
    this.deps.nodes
      .filter((node) => node.mediaUrl)
      .forEach((node) => this.repaintUrl(node.mediaUrl!));
  }

  private retry(url: string) {
    if (document.hidden) return;
    this.deps.nodes
      .filter((node) => node.mediaUrl === url)
      .forEach((node) => this.deps.invalidateNode(node.id));
    this.deps.nodeLayer
      .querySelectorAll<HTMLElement>(
        `.flow-node .node-media[data-source-key="${CSS.escape(url)}"]`,
      )
      .forEach((media) => delete media.dataset.sourceKey);
    this.deps.nodeLayer
      .querySelectorAll<HTMLCanvasElement>(
        `[data-reference-url="${CSS.escape(url)}"]`,
      )
      .forEach((canvas) => delete canvas.dataset.paintedUrl);
    this.deps.draw(true);
  }

  private drawImage(target: HTMLCanvasElement, image: HTMLImageElement) {
    const context = target.getContext("2d")!;
    const dark = this.deps.theme() === "dark";
    context.fillStyle = dark ? "#111a1c" : "#e7efeb";
    context.fillRect(0, 0, target.width, target.height);
    if (image.complete && image.naturalWidth) {
      const scale = Math.min(
        target.width / image.naturalWidth,
        target.height / image.naturalHeight,
      );
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      context.drawImage(
        image,
        (target.width - width) / 2,
        (target.height - height) / 2,
        width,
        height,
      );
      return;
    }
    const centerX = target.width / 2;
    const centerY = target.height / 2;
    const size = Math.max(24, Math.min(42, target.width * 0.11));
    context.strokeStyle = dark ? "#607579" : "#8ba19a";
    context.lineWidth = Math.max(2, target.width / 180);
    context.strokeRect(centerX - size / 2, centerY - size, size, size);
    context.beginPath();
    context.moveTo(centerX - size * 0.34, centerY - size * 0.18);
    context.lineTo(centerX - size * 0.08, centerY - size * 0.48);
    context.lineTo(centerX + size * 0.34, centerY - size * 0.08);
    context.stroke();
    context.fillStyle = dark ? "#8fa4a7" : "#60736d";
    context.font = `${Math.max(12, Math.min(18, target.width / 22))}px system-ui`;
    context.textAlign = "center";
    context.fillText(
      image.complete ? "缩略图加载失败" : "缩略图加载中",
      centerX,
      centerY + Math.max(18, size * 0.45),
    );
  }
}

export function mediaThumbnailUrl(url: string) {
  return url.replace(
    /^(\/api\/(?:public\/)?assets\/[^/]+)\/content(?:\/.*)?$/,
    "$1/thumbnail",
  );
}
