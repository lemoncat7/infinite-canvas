import type { Point } from "../nodes/node-types";

type Pinch = { distance: number; center: Point };
type Options = {
  selector: string;
  zoom: () => number;
  setZoom: (zoom: number, anchor: Point) => void;
  pan: (dx: number, dy: number) => void;
  cancelSingleTouch: () => void;
  syncZoomTarget: () => void;
  draw: (syncDom?: boolean) => void;
};

export class TouchPinchController {
  private readonly touches = new Map<number, Point>();
  private pinch: Pinch | null = null;

  constructor(private readonly options: Options) {
    document.addEventListener("pointerdown", this.onDown, { capture: true, passive: false });
    document.addEventListener("pointermove", this.onMove, { capture: true, passive: false });
    document.addEventListener("pointerup", this.onEnd, { capture: true, passive: false });
    document.addEventListener("pointercancel", this.onEnd, { capture: true, passive: false });
  }

  get active() { return Boolean(this.pinch); }

  private current(): Pinch | null {
    const points = [...this.touches.values()].slice(0, 2);
    if (points.length < 2) return null;
    const [a, b] = points;
    return {
      distance: Math.max(1, Math.hypot(b.x-a.x, b.y-a.y)),
      center: { x: (a.x+b.x)/2, y: (a.y+b.y)/2 },
    };
  }

  private onDown = (event: PointerEvent) => {
    if (event.pointerType !== "touch" || !(event.target as HTMLElement | null)?.closest(this.options.selector)) return;
    this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.touches.size < 2) return;
    event.preventDefault(); event.stopImmediatePropagation();
    this.options.cancelSingleTouch();
    this.pinch = this.current();
    this.options.syncZoomTarget();
  };

  private onMove = (event: PointerEvent) => {
    if (!this.touches.has(event.pointerId)) return;
    this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!this.pinch || this.touches.size < 2) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const next = this.current();
    if (!next) return;
    const previous = this.pinch;
    this.options.setZoom(this.options.zoom() * next.distance / previous.distance, next.center);
    this.options.pan(next.center.x-previous.center.x, next.center.y-previous.center.y);
    this.options.syncZoomTarget();
    this.pinch = next;
    this.options.draw(false);
  };

  private onEnd = (event: PointerEvent) => {
    if (!this.touches.has(event.pointerId)) return;
    const wasPinching = Boolean(this.pinch);
    this.touches.delete(event.pointerId);
    if (!wasPinching) return;
    event.preventDefault(); event.stopImmediatePropagation();
    this.pinch = this.touches.size >= 2 ? this.current() : null;
    this.options.cancelSingleTouch();
    this.options.draw();
  };
}
