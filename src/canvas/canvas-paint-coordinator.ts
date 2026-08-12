import type { CanvasPerformanceMonitor } from "./performance-monitor";
import type { CanvasRenderer, CanvasRenderSnapshot } from "./renderer";

type PaintState = Omit<CanvasRenderSnapshot, "pendingConnection"> & {
  nodeCount: number;
  indexedNodeCount: number;
  pendingConnection?: CanvasRenderSnapshot["pendingConnection"];
};

export class CanvasPaintCoordinator {
  private frame: number | null = null;
  private needsDomSync = true;
  private businessRenderPending = false;

  constructor(private readonly options: {
    performance: CanvasPerformanceMonitor;
    viewport: HTMLElement;
    zoomSlider: HTMLInputElement;
    zoomPercent: HTMLOutputElement;
    nodeCount: HTMLElement;
    viewportSize: () => { width: number; height: number };
    camera: () => { x: number; y: number; zoom: number };
    interacting: () => boolean;
    state: () => PaintState;
    renderer: () => CanvasRenderer | undefined;
    rebuildIndexes: () => void;
    syncDom: () => void;
    warmEditors: () => void;
    updateTasks: () => void;
    updateHistory: () => void;
  }) {}

  draw = (syncDom = true) => {
    this.businessRenderPending = true;
    if (syncDom) this.needsDomSync = true;
    if (this.frame === null) this.frame = requestAnimationFrame(this.paint);
  };

  pan = () => {
    if (this.frame === null) this.frame = requestAnimationFrame(this.paint);
  };

  paint = () => {
    const startedAt = this.options.performance.beginFrame();
    this.frame = null;
    if (this.options.interacting()) {
      // DOM owns the cards, so its single viewport transform must advance in
      // the same animation frame as the Pixi camera and links.
      this.positionCardLayer();
      const state = this.options.state();
      const { nodeCount: _nodeCount, indexedNodeCount: _indexed, ...snapshot } = state;
      this.options.renderer()?.updateInteraction(snapshot);
      this.options.performance.endFrame(startedAt);
      return;
    }
    this.businessRenderPending = false;
    const syncUi = this.needsDomSync && !this.options.interacting();
    if (syncUi) this.needsDomSync = false;
    const state = this.options.state();
    if (syncUi || state.indexedNodeCount !== state.nodeCount)
      this.options.rebuildIndexes();
    this.positionCardLayer();
    if (syncUi) this.syncUi(state);
    const { nodeCount: _nodeCount, indexedNodeCount: _indexed, ...snapshot } = state;
    this.options.renderer()?.render(snapshot);
    this.options.performance.endFrame(startedAt);
  };

  private positionCardLayer() {
    const camera = this.options.camera();
    const viewport = this.options.viewportSize();
    this.options.viewport.style.transform =
      `translate3d(${viewport.width / 2 + camera.x}px, ${viewport.height / 2 + camera.y}px,0) scale(${camera.zoom})`;
  }

  private syncUi(state: PaintState) {
    this.options.syncDom();
    this.options.warmEditors();
    this.options.updateTasks();
    this.options.updateHistory();
    const zoom = Math.round(state.camera.zoom * 100);
    this.options.zoomSlider.value = String(zoom);
    this.options.zoomSlider.title = `${zoom}%`;
    this.options.zoomPercent.value = `${zoom}%`;
    this.options.nodeCount.textContent = String(state.nodeCount);
  }
}
