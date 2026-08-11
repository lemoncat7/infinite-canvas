import type { FlowNode, Point } from "../nodes/node-types";
import type { CanvasInteractionController } from "./interaction-controller";
import type { CanvasSelectionController } from "./selection-controller";

type Options = {
  canvas: HTMLElement;
  nodeLayer: HTMLElement;
  interaction: CanvasInteractionController;
  selection: CanvasSelectionController;
  zoom: () => number;
  hitNode: (x: number, y: number) => FlowNode | undefined;
  cancelCameraAnimation: () => void;
  toggleBatchNode: (id: number) => void;
  updateEditor: () => void;
  setEditing: () => void;
  moveNode: (id: number, dx: number, dy: number) => void;
  panCamera: (dx: number, dy: number) => void;
  connectionActive: () => boolean;
  moveConnection: (event: PointerEvent) => void;
  finishConnection: (event: PointerEvent) => void;
  cancelConnection: () => void;
  save: () => void;
  draw: (syncDom?: boolean) => void;
  closeQuickMenu: () => void;
  smoothZoom: (factor: number, anchor: Point) => void;
};

export class CanvasPointerLifecycle {
  private panSelectedElement: HTMLElement | null = null;

  constructor(private readonly o: Options) {
    o.canvas.addEventListener("pointerdown", this.onDown);
    o.canvas.addEventListener("pointermove", this.onMove);
    o.canvas.addEventListener("pointerup", this.onUp);
    o.canvas.addEventListener("pointercancel", this.onCancel);
    window.addEventListener("blur", this.onPageInterruption);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    o.canvas.addEventListener("wheel", this.onCanvasWheel, { passive: false });
    o.nodeLayer.addEventListener("wheel", this.onNodeWheel, { passive: false });
  }

  private clearPanVisual() {
    this.panSelectedElement?.classList.remove("canvas-pan-selected");
    this.panSelectedElement = null;
  }

  private onDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    this.o.cancelCameraAnimation();
    const pointer = this.o.interaction.pointer;
    this.o.interaction.beginPointer({ x: event.clientX, y: event.clientY });
    const hit = this.o.hitNode(event.clientX, event.clientY);
    if (hit) {
      if (this.o.selection.multiSelectMode) {
        if (!this.o.selection.batchIds.has(hit.id)) {
          pointer.down = false; pointer.blankCanvas = false; this.o.toggleBatchNode(hit.id); return;
        }
        pointer.draggingNode = hit.id;
        pointer.draggingGroup = new Set(this.o.selection.batchIds);
        pointer.toggleBatchOnRelease = hit.id;
      } else {
        this.o.selection.selectedId = hit.id;
        pointer.draggingNode = hit.id;
        this.o.updateEditor();
      }
      pointer.blankCanvas = false;
    }
    this.o.canvas.setPointerCapture(event.pointerId);
    this.o.canvas.classList.add("dragging");
    this.o.draw(false);
  };

  private onMove = (event: PointerEvent) => {
    const pointer = this.o.interaction.pointer;
    if (!pointer.down) return;
    if (!pointer.moved && Math.hypot(event.clientX-pointer.startX, event.clientY-pointer.startY) > 4) {
      pointer.moved = true;
      if (pointer.draggingNode === this.o.selection.selectedId) {
        this.o.nodeLayer.querySelector<HTMLElement>(`.flow-node[data-id="${pointer.draggingNode}"]`)?.classList.remove("selected");
        this.o.selection.selectedId = 0; this.o.updateEditor();
      }
      if (!pointer.blankCanvas) this.o.setEditing();
      if (pointer.blankCanvas && this.o.selection.selectedId) {
        this.panSelectedElement = this.o.nodeLayer.querySelector<HTMLElement>(`.flow-node[data-id="${this.o.selection.selectedId}"]`);
        this.panSelectedElement?.classList.add("canvas-pan-selected");
      }
    }
    if (this.o.connectionActive()) { this.o.moveConnection(event); return; }
    const dx = event.clientX-pointer.x, dy = event.clientY-pointer.y;
    if (pointer.draggingNode) for (const id of pointer.draggingGroup ?? [pointer.draggingNode]) this.o.moveNode(id, dx/this.o.zoom(), dy/this.o.zoom());
    else this.o.panCamera(dx, dy);
    pointer.x = event.clientX; pointer.y = event.clientY;
    this.o.draw(Boolean(pointer.draggingNode));
  };

  private onUp = (event: PointerEvent) => {
    const pointer = this.o.interaction.pointer;
    if (this.o.connectionActive()) this.o.finishConnection(event);
    else if (pointer.blankCanvas && !pointer.moved) { this.o.selection.selectedId = 0; this.o.updateEditor(); }
    if (pointer.toggleBatchOnRelease && !pointer.moved) this.o.toggleBatchNode(pointer.toggleBatchOnRelease);
    this.o.save(); this.o.interaction.resetPointer(); this.clearPanVisual();
    this.o.canvas.classList.remove("dragging"); this.o.draw();
  };

  private onCancel = () => {
    this.clearPanVisual(); this.o.interaction.resetPointer();
    if (this.o.connectionActive()) this.o.cancelConnection();
    this.o.draw();
  };
  private onPageInterruption = () => {
    if (!this.o.interaction.pointer.down) return;
    this.o.interaction.resetPointer(); this.clearPanVisual();
    this.o.canvas.classList.remove("dragging"); this.o.draw(true);
  };
  private onVisibilityChange = () => { if (document.hidden) this.onPageInterruption(); };
  private zoom(event: WheelEvent) {
    event.preventDefault(); this.o.closeQuickMenu();
    this.o.smoothZoom(Math.exp(-event.deltaY*0.001), { x: event.clientX, y: event.clientY });
  }
  private onCanvasWheel = (event: WheelEvent) => this.zoom(event);
  private onNodeWheel = (event: WheelEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest(".video-model-popover,.video-settings-popover,.voice-model-menu")) { event.stopPropagation(); return; }
    if (target?.closest('textarea,input,select,[contenteditable="true"],.node-copy,.image-original-prompt p,.video-result-prompt')) return;
    event.stopPropagation(); this.zoom(event);
  };
}
