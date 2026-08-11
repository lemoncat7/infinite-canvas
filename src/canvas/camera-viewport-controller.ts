import type { FlowNode, Point } from "../nodes/node-types";

type Camera = { x: number; y: number; zoom: number };
type Options = {
  camera: Camera;
  nodes: FlowNode[];
  viewport: () => { width: number; height: number };
  draw: (syncDom?: boolean) => void;
  save: () => void;
};

export class CameraViewportController {
  private frame: number | null = null;
  private target: number;
  private anchor: Point;

  constructor(private readonly o: Options) {
    this.target = o.camera.zoom;
    const viewport = o.viewport();
    this.anchor = { x: viewport.width / 2, y: viewport.height / 2 };
  }

  get targetZoom() { return this.target; }
  get animating() { return this.frame !== null; }
  syncTarget = () => { this.target = this.o.camera.zoom; };
  cancel = () => {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.syncTarget();
  };

  setZoom = (next: number, anchor?: Point) => {
    const viewport = this.o.viewport(), camera = this.o.camera, old = camera.zoom;
    next = Math.min(2.5, Math.max(0.3, next));
    const point = anchor ?? { x: viewport.width / 2, y: viewport.height / 2 };
    const cx = viewport.width / 2 + camera.x, cy = viewport.height / 2 + camera.y;
    camera.x += (point.x-cx) * (1-next/old);
    camera.y += (point.y-cy) * (1-next/old);
    camera.zoom = next;
    this.o.draw(false);
  };

  setImmediate = (next: number, anchor?: Point) => {
    this.target = Math.min(2.5, Math.max(0.3, next));
    this.setZoom(this.target, anchor);
  };

  smoothTo = (next: number, anchor: Point) => {
    this.target = Math.min(2.5, Math.max(0.3, next));
    this.anchor = anchor;
    if (this.frame !== null) return;
    const tick = () => {
      const difference = this.target-this.o.camera.zoom;
      if (Math.abs(difference) < 0.001) {
        this.setZoom(this.target, this.anchor); this.frame = null; this.o.save(); this.o.draw(); return;
      }
      this.setZoom(this.o.camera.zoom+difference*0.24, this.anchor);
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  };

  smoothBy = (factor: number, anchor: Point) => this.smoothTo(this.target*factor, anchor);

  fit = () => {
    const viewportSize = this.o.viewport(), start = { ...this.o.camera };
    let target: Camera = { x: 0, y: 0, zoom: 1 };
    if (this.o.nodes.length) {
      const compact = viewportSize.width <= 780;
      const viewport = { left: compact ? 68 : 82, top: 86, right: viewportSize.width-16, bottom: viewportSize.height-118 };
      const padding = 44, minX = Math.min(...this.o.nodes.map((node) => node.x)), minY = Math.min(...this.o.nodes.map((node) => node.y));
      const maxX = Math.max(...this.o.nodes.map((node) => node.x+node.width)), maxY = Math.max(...this.o.nodes.map((node) => node.y+node.height));
      const zoom = Math.min(1.15, Math.max(0.3, Math.min(
        Math.max(1, viewport.right-viewport.left-padding*2)/Math.max(1, maxX-minX),
        Math.max(1, viewport.bottom-viewport.top-padding*2)/Math.max(1, maxY-minY),
      )));
      const center = { x: (minX+maxX)/2, y: (minY+maxY)/2 };
      const viewCenter = { x: (viewport.left+viewport.right)/2, y: (viewport.top+viewport.bottom)/2 };
      target = { x: viewCenter.x-viewportSize.width/2-center.x*zoom, y: viewCenter.y-viewportSize.height/2-center.y*zoom, zoom };
    }
    this.cancel(); this.target = target.zoom;
    const started = performance.now(), duration = 420;
    const tick = (now: number) => {
      const progress = Math.min(1, (now-started)/duration), eased = 1-Math.pow(1-progress, 3);
      Object.assign(this.o.camera, {
        x: start.x+(target.x-start.x)*eased,
        y: start.y+(target.y-start.y)*eased,
        zoom: start.zoom+(target.zoom-start.zoom)*eased,
      });
      this.o.draw(false);
      if (progress < 1) this.frame = requestAnimationFrame(tick);
      else { this.frame = null; this.o.save(); this.o.draw(); }
    };
    this.frame = requestAnimationFrame(tick);
  };
}
