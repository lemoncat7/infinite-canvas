import { MediaLifecycleController } from "./media-lifecycle-controller";
import { ThumbnailSurfaceRenderer } from "./thumbnail-surface-renderer";

export class CanvasMediaFeature {
  private readonly lifecycle: MediaLifecycleController;
  private readonly renderer: ThumbnailSurfaceRenderer;

  constructor(options: {
    mobile: boolean;
    nodeLayer: HTMLElement;
    suspendRenderer: () => void;
    resumeRenderer: () => void;
    clearNodeStates: () => void;
    resize: () => void;
    draw: (syncDom?: boolean) => void;
    refreshAppearance: () => void;
  }) {
    this.lifecycle = new MediaLifecycleController({
      mobile: options.mobile,
      nodeLayer: options.nodeLayer,
      suspendRenderer: options.suspendRenderer,
      resumeRenderer: options.resumeRenderer,
      clearNodeStates: options.clearNodeStates,
      resize: options.resize,
      draw: options.draw,
    });
    this.renderer = new ThumbnailSurfaceRenderer(
      this.lifecycle,
      options.nodeLayer,
      options.refreshAppearance,
    );
  }

  get pendingLoads() { return this.lifecycle.pendingLoads; }
  get cache() { return this.lifecycle.cache; }
  paint = (target: HTMLElement, url: string) => this.renderer.paint(target, url);
  clear = (target: HTMLElement) => this.renderer.clear(target);
  repaintUrl = (url: string) => this.renderer.repaintUrl(url);
  repaintAll = () => this.renderer.repaintAll();
}
