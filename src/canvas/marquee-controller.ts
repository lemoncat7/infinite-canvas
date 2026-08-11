import type { FlowNode, Point } from "../nodes/node-types";
import type { CanvasInteractionController } from "./interaction-controller";
import type { CanvasSelectionController } from "./selection-controller";

type Options = {
  canvas: HTMLElement; nodeLayer: HTMLElement; box: HTMLElement; nodes: FlowNode[];
  camera: { x: number; y: number; zoom: number }; interaction: CanvasInteractionController;
  selection: CanvasSelectionController; screen: (point: Point) => Point; world: (point: Point) => Point;
  updateEditor: () => void; refreshSelection: () => void; clearSelection: () => void;
  refreshHint: () => void; draw: () => void; notice: (title: string, detail: string) => void;
};

export class MarqueeController {
  private autoPanFrame = 0;
  private contextSuppressedUntil = 0;
  private holdTimer: number | undefined;
  private holdPointer: { id: number; start: Point; pointerType: string } | null = null;

  constructor(private readonly o: Options) {
    document.addEventListener("pointerdown", this.onDown, true);
    document.addEventListener("pointermove", this.onMove, true);
    document.addEventListener("pointerup", this.onUp, true);
    document.addEventListener("pointercancel", this.onCancel, true);
    document.addEventListener("contextmenu", this.onContextMenu, true);
    window.addEventListener("keydown", this.onKeyDown);
  }

  isContextSuppressed = () => performance.now() < this.contextSuppressedUntil;
  resetRightGesture = () => { this.clearHold(); this.contextSuppressedUntil = 0; };

  enter = () => {
    this.o.selection.enterMultiSelect(); this.o.interaction.marqueeMode = true;
    document.body.classList.add("marquee-mode"); this.o.refreshHint();
    this.o.notice("已进入多选", "点按卡片选择 · 长按空白框选 · 普通滑动移动画布");
  };
  exit = () => {
    this.clearHold(); this.stopAutoPan(); this.o.selection.exitMultiSelect();
    this.o.interaction.marqueeMode = false; this.o.interaction.clearMarquee();
    document.body.classList.remove("marquee-mode"); this.o.box.classList.remove("open");
    this.o.clearSelection(); this.o.refreshHint();
    this.o.notice("已退出多选", "已恢复画布移动与节点操作");
  };

  private clearHold() { window.clearTimeout(this.holdTimer); this.holdTimer = undefined; this.holdPointer = null; }
  private stopAutoPan() { if (this.autoPanFrame) cancelAnimationFrame(this.autoPanFrame); this.autoPanFrame = 0; }
  private updateSelection = () => {
    const marquee = this.o.interaction.marquee;
    if (!marquee?.active) return;
    const origin = this.o.screen(marquee.worldStart), currentWorld = this.o.world(marquee.current);
    const left = Math.min(origin.x, marquee.current.x), top = Math.min(origin.y, marquee.current.y);
    const right = Math.max(origin.x, marquee.current.x), bottom = Math.max(origin.y, marquee.current.y);
    Object.assign(this.o.box.style, { left: `${left}px`, top: `${top}px`, width: `${right-left}px`, height: `${bottom-top}px` });
    const worldLeft = Math.min(marquee.worldStart.x, currentWorld.x), worldTop = Math.min(marquee.worldStart.y, currentWorld.y);
    const worldRight = Math.max(marquee.worldStart.x, currentWorld.x), worldBottom = Math.max(marquee.worldStart.y, currentWorld.y);
    this.o.selection.batchIds.clear(); marquee.baseSelection.forEach((id) => this.o.selection.batchIds.add(id));
    for (const node of this.o.nodes) if (node.x < worldRight && node.x + node.width > worldLeft && node.y < worldBottom && node.y + node.height > worldTop) this.o.selection.batchIds.add(node.id);
    this.o.draw();
  };
  private startAutoPan() {
    if (this.autoPanFrame) return;
    let previous = performance.now();
    const tick = (now: number) => {
      const marquee = this.o.interaction.marquee;
      if (!marquee?.active) { this.autoPanFrame = 0; return; }
      const elapsed = Math.min(2, (now - previous) / 16.67), edge = 82, max = 13;
      const speed = (p: number, limit: number) => p < edge ? -Math.min(1, 1-p/edge)*max : p > limit-edge ? Math.min(1, 1-(limit-p)/edge)*max : 0;
      const vx = speed(marquee.current.x, innerWidth), vy = speed(marquee.current.y, innerHeight);
      if (vx || vy) { this.o.camera.x -= vx*elapsed; this.o.camera.y -= vy*elapsed; this.updateSelection(); }
      previous = now; this.autoPanFrame = requestAnimationFrame(tick);
    };
    this.autoPanFrame = requestAnimationFrame(tick);
  }
  private begin(event: PointerEvent, start: Point, quick: boolean) {
    this.o.interaction.pointer.down = false; this.o.interaction.pointer.draggingNode = null;
    this.o.canvas.classList.remove("dragging");
    this.o.interaction.beginMarquee({ pointerId: event.pointerId, start, worldStart: this.o.world(start), current: {...start}, active: true, baseSelection: new Set(this.o.selection.batchIds) }, quick);
    this.o.selection.selectedId = 0; this.o.updateEditor(); this.o.box.classList.add("open"); this.updateSelection(); this.startAutoPan();
  }
  private onDown = (event: PointerEvent) => {
    const target = event.target as HTMLElement | null;
    if (event.button !== 0 || (target !== this.o.canvas && target !== this.o.nodeLayer)) return;
    const start = { x: event.clientX, y: event.clientY };
    if (event.ctrlKey) { event.preventDefault(); event.stopImmediatePropagation(); this.clearHold(); this.o.selection.multiSelectMode = true; document.body.classList.add("marquee-mode"); this.begin(event, start, true); return; }
    if (!this.o.selection.multiSelectMode) return;
    this.clearHold(); this.holdPointer = { id: event.pointerId, start, pointerType: event.pointerType };
    this.holdTimer = window.setTimeout(() => {
      if (this.holdPointer?.id !== event.pointerId || !this.o.selection.multiSelectMode) return;
      const touch = this.holdPointer.pointerType === "touch"; this.begin(event, start, false);
      if (touch) { navigator.vibrate?.(18); this.o.notice("框选已开启", "保持按住并移动，可继续扩大选择范围"); }
      this.clearHold();
    }, 360);
  };
  private onMove = (event: PointerEvent) => {
    if (this.holdPointer?.id === event.pointerId && Math.hypot(event.clientX-this.holdPointer.start.x, event.clientY-this.holdPointer.start.y) > 8) this.clearHold();
    const marquee = this.o.interaction.marquee;
    if (!marquee || event.pointerId !== marquee.pointerId) return;
    marquee.current = { x: event.clientX, y: event.clientY };
    if (!marquee.active) return;
    event.preventDefault(); event.stopImmediatePropagation(); this.updateSelection();
  };
  private onUp = (event: PointerEvent) => {
    if (this.holdPointer?.id === event.pointerId) this.clearHold();
    const marquee = this.o.interaction.marquee;
    if (!marquee || event.pointerId !== marquee.pointerId) return;
    const active = marquee.active, quick = this.o.interaction.quickMarqueeMode;
    this.stopAutoPan(); this.o.interaction.clearMarquee(); this.o.box.classList.remove("open");
    if (quick) this.o.refreshHint();
    if (active) { event.preventDefault(); event.stopImmediatePropagation(); this.contextSuppressedUntil = performance.now()+650; this.o.selection.selectedId = 0; this.o.updateEditor(); this.o.refreshSelection(); }
  };
  private onCancel = (event: PointerEvent) => {
    if (this.holdPointer?.id === event.pointerId) this.clearHold();
    const marquee = this.o.interaction.marquee;
    if (!marquee || event.pointerId !== marquee.pointerId) return;
    this.stopAutoPan(); const quick = this.o.interaction.quickMarqueeMode; this.o.interaction.clearMarquee(); this.o.box.classList.remove("open");
    if (quick) { this.o.selection.multiSelectMode = false; this.o.interaction.marqueeMode = false; document.body.classList.remove("marquee-mode"); this.o.refreshHint(); }
  };
  private onContextMenu = (event: MouseEvent) => { if (this.o.selection.multiSelectMode || this.isContextSuppressed()) { event.preventDefault(); event.stopImmediatePropagation(); } };
  private onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && this.o.selection.multiSelectMode) this.exit(); };
}
