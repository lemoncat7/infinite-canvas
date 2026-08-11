import type { Point } from "../nodes/node-types";

type AssetTouchControllerOptions<Asset> = {
  grid: HTMLElement;
  resolveAsset: (item: HTMLElement) => Asset | undefined;
  onContext: (asset: Asset, x: number, y: number) => void;
  holdMs?: number;
  moveThreshold?: number;
  clickBlockMs?: number;
};

export class AssetTouchController<Asset> {
  private hold: {
    pointerId: number;
    start: Point;
    timer: number;
  } | null = null;
  private contextUntil = 0;
  private readonly holdMs: number;
  private readonly moveThreshold: number;
  private readonly clickBlockMs: number;

  constructor(private readonly options: AssetTouchControllerOptions<Asset>) {
    this.holdMs = options.holdMs ?? 450;
    this.moveThreshold = options.moveThreshold ?? 9;
    this.clickBlockMs = options.clickBlockMs ?? 900;
    options.grid.addEventListener("pointerdown", this.onPointerDown, true);
    options.grid.addEventListener("pointermove", this.onPointerMove, true);
    options.grid.addEventListener("click", this.onClick, true);
    window.addEventListener("pointerup", this.onPointerEnd, true);
    window.addEventListener("pointercancel", this.onPointerEnd, true);
  }

  isContextBlocked() {
    return performance.now() < this.contextUntil;
  }

  private clearHold() {
    if (!this.hold) return;
    window.clearTimeout(this.hold.timer);
    this.hold = null;
  }

  private readonly onPointerDown = (event: PointerEvent) => {
    if (event.pointerType !== "touch") return;
    const item = (event.target as HTMLElement | null)?.closest<HTMLElement>(
      ".asset-item",
    );
    if (!item) return;
    this.clearHold();
    const start = { x: event.clientX, y: event.clientY };
    const pointerId = event.pointerId;
    const asset = this.options.resolveAsset(item);
    if (!asset) return;
    const timer = window.setTimeout(() => {
      if (!this.hold || this.hold.pointerId !== pointerId) return;
      this.contextUntil = performance.now() + this.clickBlockMs;
      this.options.onContext(asset, start.x, start.y);
      navigator.vibrate?.(16);
      this.clearHold();
    }, this.holdMs);
    this.hold = { pointerId, start, timer };
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    if (
      this.hold?.pointerId === event.pointerId &&
      Math.hypot(
        event.clientX - this.hold.start.x,
        event.clientY - this.hold.start.y,
      ) > this.moveThreshold
    )
      this.clearHold();
  };

  private readonly onPointerEnd = (event: PointerEvent) => {
    if (this.hold?.pointerId === event.pointerId) this.clearHold();
  };

  private readonly onClick = (event: MouseEvent) => {
    if (!this.isContextBlocked()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
}
