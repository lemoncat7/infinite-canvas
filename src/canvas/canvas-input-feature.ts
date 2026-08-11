import type { FlowNode, Point } from "../nodes/node-types";
import { CameraViewportController } from "./camera-viewport-controller";
import { CanvasInteractionController } from "./interaction-controller";
import { CanvasPointerLifecycle } from "./canvas-pointer-lifecycle";
import { CanvasSelectionController } from "./selection-controller";
import { DomPointerLifecycle } from "./dom-pointer-lifecycle";
import { MarqueeController } from "./marquee-controller";
import { TouchPinchController } from "./touch-pinch-controller";

export class CanvasInputFeature {
  readonly cameraViewport: CameraViewportController;
  readonly domPointer: DomPointerLifecycle;
  readonly touchPinch: TouchPinchController;
  readonly marquee: MarqueeController;

  constructor(options: {
    canvas: HTMLElement;
    nodeLayer: HTMLElement;
    nodes: FlowNode[];
    camera: { x: number; y: number; zoom: number };
    interaction: CanvasInteractionController;
    selection: CanvasSelectionController;
    marqueeBox: HTMLElement;
    batchToolbar: HTMLElement;
    draw: (syncDom?: boolean) => void;
    save: () => void;
    setEditing: () => void;
    updateEditor: () => void;
    syncDraggedElements: (ids: Iterable<number>) => void;
    refreshBatchSelection: () => void;
    clearBatchSelection: () => void;
    toggleBatchNode: (id: number) => void;
    refreshCanvasModeHint: () => void;
    showCanvasModeNotice: (title: string, detail: string) => void;
    getAgentIds: () => Set<number>;
    renderAgentSelection: () => void;
    warnAgentLimit: () => void;
    hasConnection: () => boolean;
    moveConnection: (event: PointerEvent, syncDom: boolean) => void;
    finishConnection: (event: PointerEvent) => void;
    cancelConnection: () => void;
    hitNode: (x: number, y: number) => FlowNode | undefined;
    moveNode: (id: number, dx: number, dy: number) => void;
    panCamera: (dx: number, dy: number) => void;
    closeQuickMenu: () => void;
    screen: (point: Point) => Point;
    world: (point: Point) => Point;
  }) {
    document.addEventListener("selectstart", (event) => {
      if (document.body.classList.contains("home-mode")) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(
        'input,textarea,[contenteditable="true"],.image-original-prompt p,.video-result-prompt p,[data-agent-prompt],.app-toast details em,code',
      )) return;
      event.preventDefault();
    });
    this.cameraViewport = new CameraViewportController({
      camera: options.camera,
      nodes: options.nodes,
      viewport: () => ({ width: innerWidth, height: innerHeight }),
      draw: options.draw,
      save: options.save,
    });
    this.domPointer = new DomPointerLifecycle({
      nodes: options.nodes,
      zoom: () => options.camera.zoom,
      groupMovingElement: options.batchToolbar,
      setEditing: options.setEditing,
      save: options.save,
      draw: options.draw,
      syncElements: options.syncDraggedElements,
      refreshBatchSelection: options.refreshBatchSelection,
      isMultiSelectMode: () => options.selection.multiSelectMode,
      toggleBatchNode: options.toggleBatchNode,
      selectNode: (id) => { options.selection.selectedId = id; options.updateEditor(); },
      clearSelection: () => {
        options.selection.selectedId = 0;
        options.updateEditor();
        options.draw();
      },
      selectedId: () => options.selection.selectedId,
      isAgentSelected: (id) => options.getAgentIds().has(id),
      agentSelectionSize: () => options.getAgentIds().size,
      toggleAgentSelection: (id) => {
        const ids = options.getAgentIds();
        if (ids.has(id)) ids.delete(id);
        else ids.add(id);
      },
      renderAgentSelection: options.renderAgentSelection,
      warnAgentLimit: options.warnAgentLimit,
      hasConnection: options.hasConnection,
      moveConnection: (event) => options.moveConnection(event, true),
      finishConnection: options.finishConnection,
    });
    this.touchPinch = new TouchPinchController({
      selector: "#canvas,.flow-node",
      zoom: () => options.camera.zoom,
      setZoom: (zoom, anchor) => this.cameraViewport.setZoom(zoom, anchor),
      pan: (dx, dy) => { options.camera.x += dx; options.camera.y += dy; },
      cancelSingleTouch: () => {
        options.interaction.pointer.down = false;
        options.interaction.pointer.draggingNode = null;
        options.canvas.classList.remove("dragging");
        options.cancelConnection();
        this.domPointer.cancel();
      },
      syncZoomTarget: this.cameraViewport.syncTarget,
      draw: options.draw,
    });
    this.marquee = new MarqueeController({
      canvas: options.canvas,
      nodeLayer: options.nodeLayer,
      box: options.marqueeBox,
      nodes: options.nodes,
      camera: options.camera,
      interaction: options.interaction,
      selection: options.selection,
      screen: options.screen,
      world: options.world,
      updateEditor: options.updateEditor,
      refreshSelection: options.refreshBatchSelection,
      clearSelection: options.clearBatchSelection,
      refreshHint: options.refreshCanvasModeHint,
      draw: options.draw,
      notice: options.showCanvasModeNotice,
    });
    new CanvasPointerLifecycle({
      canvas: options.canvas,
      nodeLayer: options.nodeLayer,
      interaction: options.interaction,
      selection: options.selection,
      zoom: () => options.camera.zoom,
      hitNode: options.hitNode,
      cancelCameraAnimation: this.cameraViewport.cancel,
      toggleBatchNode: options.toggleBatchNode,
      updateEditor: options.updateEditor,
      setEditing: options.setEditing,
      moveNode: options.moveNode,
      panCamera: options.panCamera,
      connectionActive: options.hasConnection,
      moveConnection: (event) => options.moveConnection(event, false),
      finishConnection: options.finishConnection,
      cancelConnection: options.cancelConnection,
      save: options.save,
      draw: options.draw,
      closeQuickMenu: options.closeQuickMenu,
      smoothZoom: this.cameraViewport.smoothBy,
    });
  }
}
