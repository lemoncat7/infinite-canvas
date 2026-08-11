import type { FlowLink, Point } from "../nodes/node-types";
import type { CanvasConnectionController } from "./connection-controller";

type Options = {
  canvas: HTMLElement; hint: HTMLElement; touchAction: HTMLButtonElement;
  links: FlowLink[]; connection: CanvasConnectionController;
  pointerDown: () => boolean; multiSelect: () => boolean;
  hitLink: (x: number, y: number, tolerance?: number) => number;
  generationActive: () => boolean; contextSuppressed: () => boolean;
  save: () => void; draw: () => void;
  notify: (message: string, type: "success" | "warning") => void;
};

export class LinkInteractionView {
  private touch: { pointerId: number; start: Point; index: number; moved: boolean } | null = null;
  constructor(private readonly o: Options) {
    document.addEventListener("pointerdown", this.onDocumentDown, true);
    o.canvas.addEventListener("pointerdown", this.onTouchDown, true);
    o.canvas.addEventListener("pointermove", this.onTouchMove, true);
    o.canvas.addEventListener("pointerup", this.onTouchUp, true);
    o.canvas.addEventListener("pointercancel", this.onTouchCancel, true);
    o.touchAction.addEventListener("click", this.deleteTouchLink);
    o.canvas.addEventListener("pointermove", this.onHover);
    o.canvas.addEventListener("pointerleave", this.onLeave);
    o.canvas.addEventListener("contextmenu", this.onContextMenu);
  }
  close = () => {
    this.o.connection.touchSelectedLinkIndex = -1; this.touch = null;
    this.o.touchAction.classList.remove("open", "locked"); this.o.draw();
  };
  private open(index: number, x: number, y: number) {
    if (index < 0 || !this.o.links[index]) return this.close();
    this.o.connection.touchSelectedLinkIndex = index;
    const locked = this.o.generationActive();
    this.o.touchAction.classList.toggle("locked", locked); this.o.touchAction.disabled = locked;
    this.o.touchAction.querySelector("span")!.textContent = locked ? "生成中不可删除" : "删除连线";
    this.o.touchAction.querySelector("small")!.textContent = locked ? "任务完成后即可操作" : "";
    this.o.touchAction.classList.add("open");
    this.o.touchAction.style.left = `${Math.max(10, Math.min(innerWidth-this.o.touchAction.offsetWidth-10, x+12))}px`;
    this.o.touchAction.style.top = `${Math.max(68, Math.min(innerHeight-this.o.touchAction.offsetHeight-12, y-18))}px`;
    this.o.draw();
  }
  private onDocumentDown = (event: PointerEvent) => {
    if (this.o.connection.touchSelectedLinkIndex >= 0 && !this.o.touchAction.contains(event.target as Node)) this.close();
  };
  private onTouchDown = (event: PointerEvent) => {
    if (event.pointerType !== "touch" || event.button !== 0 || this.o.multiSelect()) return;
    this.touch = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, index: this.o.hitLink(event.clientX, event.clientY, 18), moved: false };
  };
  private onTouchMove = (event: PointerEvent) => {
    if (this.touch?.pointerId === event.pointerId && Math.hypot(event.clientX-this.touch.start.x, event.clientY-this.touch.start.y) > 9) this.touch.moved = true;
  };
  private onTouchUp = (event: PointerEvent) => {
    if (this.touch?.pointerId !== event.pointerId) return;
    const gesture = this.touch; this.touch = null;
    if (gesture.moved) return;
    if (gesture.index >= 0) { this.open(gesture.index, event.clientX, event.clientY); navigator.vibrate?.(10); }
    else this.close();
  };
  private onTouchCancel = () => { this.touch = null; };
  private deleteTouchLink = () => {
    const index = this.o.connection.touchSelectedLinkIndex;
    if (index < 0 || !this.o.links[index]) return this.close();
    if (this.o.generationActive()) return this.o.notify("画布正在生成，任务完成后即可删除连线", "warning");
    this.o.links.splice(index, 1); navigator.vibrate?.(18); this.close(); this.o.save(); this.o.notify("连线已删除", "success");
  };
  private onHover = (event: PointerEvent) => {
    if (this.o.pointerDown() || this.o.connection.active) return;
    const index = this.o.hitLink(event.clientX, event.clientY);
    if (index !== this.o.connection.hoveredLinkIndex) { this.o.connection.hoveredLinkIndex = index; this.o.draw(); }
    this.o.hint.classList.toggle("open", index >= 0);
    if (index >= 0) {
      const locked = this.o.generationActive(); this.o.hint.classList.toggle("locked", locked);
      this.o.hint.textContent = locked ? "画布生成中 · 连线已锁定" : "右键 · 删除连线";
      this.o.hint.style.left = `${event.clientX+14}px`; this.o.hint.style.top = `${event.clientY+14}px`; this.o.canvas.style.cursor = "pointer";
    } else this.o.canvas.style.removeProperty("cursor");
  };
  private onLeave = () => {
    if (this.o.connection.hoveredLinkIndex >= 0) { this.o.connection.hoveredLinkIndex = -1; this.o.draw(); }
    this.o.hint.classList.remove("open"); this.o.canvas.style.removeProperty("cursor");
  };
  private onContextMenu = (event: MouseEvent) => {
    event.preventDefault(); if (this.o.contextSuppressed()) return;
    const index = this.o.hitLink(event.clientX, event.clientY); if (index < 0) return;
    if (this.o.generationActive()) return this.o.notify("画布正在生成，任务完成后即可删除连线", "warning");
    this.o.links.splice(index, 1); this.o.connection.hoveredLinkIndex = -1; this.o.hint.classList.remove("open"); this.o.save(); this.o.draw();
  };
}
