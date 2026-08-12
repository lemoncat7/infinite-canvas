import type { FlowNode } from "../nodes/node-types";
import type { DomNodeDrag } from "../nodes/node-interaction-view";

export type DomNodeResize = { id: number; startX: number; startY: number; width: number; height: number };

type Options = {
  nodes: FlowNode[]; zoom: () => number; groupMovingElement: HTMLElement;
  setEditing: () => void; save: () => void; draw: (syncDom?: boolean) => void;
  syncElements: (ids: Iterable<number>) => void; refreshBatchSelection: () => void;
  isMultiSelectMode: () => boolean; toggleBatchNode: (id: number) => void;
  selectNode: (id: number) => void; clearSelection: () => void; selectedId: () => number;
  hideSelectedDom: () => void;
  isAgentSelected: (id: number) => boolean; agentSelectionSize: () => number;
  toggleAgentSelection: (id: number) => void; renderAgentSelection: () => void; warnAgentLimit: () => void;
  moveConnection: (event: PointerEvent) => void; finishConnection: (event: PointerEvent) => void;
  hasConnection: () => boolean;
};

export class DomPointerLifecycle {
  private dragState: DomNodeDrag | null = null;
  private resizeState: DomNodeResize | null = null;
  private dragFrame: number | null = null;
  private suppressUntil = 0;

  constructor(private readonly options: Options) {
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onCancel);
    window.addEventListener("blur", this.cancel);
    for (const type of ["dragstart", "dragend", "dragover", "drop"] as const) window.addEventListener(type, this.onNativeDrag, true);
    for (const type of ["click", "auxclick", "dblclick"] as const) window.addEventListener(type, this.suppressRelease, true);
  }
  get drag() { return this.dragState; }
  set drag(value: DomNodeDrag | null) { this.dragState = value; }
  beginResize(value: DomNodeResize) { this.resizeState = value; }
  isReleaseSuppressed = () => performance.now() < this.suppressUntil;
  cancel = () => {
    this.dragState?.element.classList.remove("dragging");
    this.options.groupMovingElement.classList.remove("group-moving");
    this.dragState = null; this.resizeState = null; this.cancelFrame();
  };
  private cancelFrame() { if (this.dragFrame !== null) cancelAnimationFrame(this.dragFrame); this.dragFrame = null; }
  private finishDrag(event: PointerEvent, edgeRelease = false) {
    const drag = this.dragState;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.cancelFrame();
    const dx = (event.clientX - drag.startX) / this.options.zoom(), dy = (event.clientY - drag.startY) / this.options.zoom();
    if (drag.moved && drag.groupInitial?.size) for (const [id, origin] of drag.groupInitial) {
      const item = this.options.nodes.find((candidate) => candidate.id === id);
      if (item) Object.assign(item, { x: origin.x + dx, y: origin.y + dy });
    }
    else if (drag.moved) {
      const item = this.options.nodes.find((candidate) => candidate.id === drag.id);
      if (item) Object.assign(item, { x: drag.initialX + dx, y: drag.initialY + dy });
    }
    if (!drag.moved && drag.agentSelect && !edgeRelease) {
      if (this.options.isAgentSelected(drag.id) || this.options.agentSelectionSize() < 8) this.options.toggleAgentSelection(drag.id);
      else this.options.warnAgentLimit();
      this.options.renderAgentSelection();
    } else if (!drag.moved && !drag.agentSelect) {
      if (this.options.isMultiSelectMode()) this.options.toggleBatchNode(drag.id); else this.options.selectNode(drag.id);
    }
    if (drag.moved) this.suppressUntil = performance.now() + 700;
    drag.element.classList.remove("dragging"); this.options.groupMovingElement.classList.remove("group-moving"); this.dragState = null;
    if (drag.moved && drag.groupInitial?.size) this.options.refreshBatchSelection();
    this.options.save(); this.options.draw();
  }
  private onMove = (event: PointerEvent) => {
    const resize = this.resizeState;
    if (resize) {
      const node = this.options.nodes.find((item) => item.id === resize.id);
      if (node) {
        const width = Math.max(220, resize.width + (event.clientX - resize.startX) / this.options.zoom());
        let height = Math.max(160, resize.height + (event.clientY - resize.startY) / this.options.zoom());
        if (node.mediaUrl && !event.shiftKey) height = Math.max(180, resize.height * width / resize.width);
        Object.assign(node, { width, height }); this.options.setEditing(); this.options.draw();
      }
    }
    if (this.options.hasConnection()) this.options.moveConnection(event);
    const drag = this.dragState;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (event.buttons === 0) return this.finishDrag(event, true);
    const dx = (event.clientX - drag.startX) / this.options.zoom(), dy = (event.clientY - drag.startY) / this.options.zoom();
    if (!drag.moved && (Math.abs(event.clientX - drag.startX) > 3 || Math.abs(event.clientY - drag.startY) > 3)) {
      drag.moved = true;
      if (drag.nativeControl) { drag.element.setPointerCapture(event.pointerId); event.preventDefault(); }
      drag.element.classList.add("dragging");
      if (drag.groupInitial?.size) this.options.groupMovingElement.classList.add("group-moving");
      if (!drag.agentSelect && this.options.selectedId() === drag.id)
        this.options.hideSelectedDom();
    }
    this.cancelFrame();
    this.dragFrame = requestAnimationFrame(() => {
      if (drag.groupInitial?.size) for (const [id, origin] of drag.groupInitial) {
        const item = this.options.nodes.find((candidate) => candidate.id === id);
        if (item) Object.assign(item, { x: origin.x + dx, y: origin.y + dy });
      } else {
        const item = this.options.nodes.find((candidate) => candidate.id === drag.id);
        if (item) {
          Object.assign(item, { x: drag.initialX + dx, y: drag.initialY + dy });
          // The element that owns the pointer is the authoritative DOM card
          // during this drag. Move it in this frame instead of waiting for a
          // DOM reconciliation after pointerup.
          drag.element.style.transform = `translate(${item.x}px, ${item.y}px)`;
        }
      }
      this.options.syncElements(drag.groupInitial?.size ? drag.groupInitial.keys() : [drag.id]);
      this.options.setEditing(); this.options.draw(false); this.dragFrame = null;
    });
  };
  private onUp = (event: PointerEvent) => {
    if (this.resizeState) { this.resizeState = null; this.options.save(); }
    if (this.options.hasConnection()) this.options.finishConnection(event);
    if (event.button === 0) this.finishDrag(event);
  };
  private onCancel = (event: PointerEvent) => { if (this.dragState?.pointerId === event.pointerId) { this.cancel(); this.options.draw(); } };
  private onNativeDrag = (event: DragEvent) => {
    const target = (event.target as HTMLElement | null)?.closest(".flow-node,.asset-item");
    if (event.type === "drop") { event.preventDefault(); if (this.isReleaseSuppressed() || target) event.stopImmediatePropagation(); return; }
    if (!target) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.type === "dragstart") event.dataTransfer?.clearData();
    if (event.type === "dragover" && event.dataTransfer) event.dataTransfer.dropEffect = "none";
  };
  private suppressRelease = (event: MouseEvent) => { if (this.isReleaseSuppressed()) { event.preventDefault(); event.stopImmediatePropagation(); } };
}
