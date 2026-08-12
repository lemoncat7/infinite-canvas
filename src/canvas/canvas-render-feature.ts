import { CanvasPaintCoordinator } from "./canvas-paint-coordinator";
import { CanvasPerformanceMonitor } from "./performance-monitor";
import type { CanvasRenderSnapshot } from "./renderer";

type PaintState = Omit<CanvasRenderSnapshot, "pendingConnection"> & {
  nodeCount: number;
  indexedNodeCount: number;
  pendingConnection?: CanvasRenderSnapshot["pendingConnection"];
};

export class CanvasRenderFeature {
  private readonly performance: CanvasPerformanceMonitor;
  private readonly paintCoordinator: CanvasPaintCoordinator;
  private renderer?: import("./pixi-renderer").PixiCanvasRenderer;
  private rendererPromise: Promise<void> | null = null;

  constructor(options: {
    viewport: HTMLElement;
    zoomSlider: HTMLInputElement;
    zoomPercent: HTMLOutputElement;
    nodeCount: HTMLElement;
    viewportSize: () => { width: number; height: number };
    camera: () => { x: number; y: number; zoom: number };
    interacting: () => boolean;
    state: () => PaintState;
    rebuildIndexes: () => void;
    syncDom: () => void;
    warmEditors: () => void;
    updateTasks: () => void;
    updateHistory: () => void;
    log: (event: string, details: unknown) => void;
  }) {
    this.performance = new CanvasPerformanceMonitor(
      new URLSearchParams(location.search).has("canvasPerf"),
    );
    if (this.performance.enabled)
      Object.assign(window, { __canvasPerformance: this.performance });
    this.paintCoordinator = new CanvasPaintCoordinator({
      performance: this.performance,
      viewport: options.viewport,
      zoomSlider: options.zoomSlider,
      zoomPercent: options.zoomPercent,
      nodeCount: options.nodeCount,
      viewportSize: options.viewportSize,
      camera: options.camera,
      interacting: options.interacting,
      state: options.state,
      renderer: () => this.renderer,
      rebuildIndexes: options.rebuildIndexes,
      syncDom: options.syncDom,
      warmEditors: options.warmEditors,
      updateTasks: options.updateTasks,
      updateHistory: options.updateHistory,
    });
    this.log = options.log;
  }

  private readonly log: (event: string, details: unknown) => void;

  draw = (syncDom = true) => this.paintCoordinator.draw(syncDom);
  pan = () => this.paintCoordinator.pan();
  paint = () => this.paintCoordinator.paint();
  active = () => Boolean(this.renderer);
  suspend = () => this.renderer?.suspend();
  resume = () => this.renderer?.resume();

  ensure = () => {
    if (this.renderer) return Promise.resolve();
    if (this.rendererPromise) return this.rendererPromise;
    this.rendererPromise = import("./pixi-renderer")
      .then(async ({ PixiCanvasRenderer }) => {
        const renderer = new PixiCanvasRenderer();
        await renderer.mount(document.body);
        this.renderer = renderer;
        document.body.classList.add("renderer-pixi");
        document.body.classList.remove("canvas-context-lost");
        this.draw(false);
      })
      .catch((error) => {
        this.rendererPromise = null;
        document.body.classList.remove("renderer-pixi");
        document.body.classList.add("canvas-context-lost");
        this.log("pixi-renderer-init-failed", {
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      });
    return this.rendererPromise;
  };
}
