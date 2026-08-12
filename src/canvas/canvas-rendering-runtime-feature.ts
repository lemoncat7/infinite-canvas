import type { CanvasNodeViewFeature } from "../nodes/canvas-node-view-feature";
import type { FlowLink, FlowNode, Point } from "../nodes/node-types";
import { nodePortPosition, screenToWorld, worldToScreen } from "./camera-controller";
import { CanvasConnectionFeature } from "./canvas-connection-feature";
import { CanvasRenderFeature } from "./canvas-render-feature";
import { CanvasRenderState } from "./canvas-render-state";
import type { CanvasConnectionController } from "./connection-controller";
import type { CanvasInteractionController } from "./interaction-controller";
import type { CanvasSelectionController } from "./selection-controller";
import type { CanvasStore } from "./store";

export class CanvasRenderingRuntimeFeature {
  readonly connection: CanvasConnectionFeature;
  readonly render: CanvasRenderFeature;
  private readonly camera: { x: number; y: number; zoom: number };

  constructor(options: {
    nodes: FlowNode[];
    links: FlowLink[];
    camera: { x: number; y: number; zoom: number };
    store: CanvasStore<FlowNode, FlowLink>;
    connectionController: CanvasConnectionController;
    selection: CanvasSelectionController;
    interaction: CanvasInteractionController;
    nodeViews: CanvasNodeViewFeature;
    viewport: HTMLElement;
    zoomSlider: HTMLInputElement;
    zoomPercent: HTMLOutputElement;
    nodeCount: HTMLElement;
    interacting: () => boolean;
    agentIds: () => Set<number>;
    dark: () => boolean;
    backgroundMode: () => "dots" | "lines" | "blank";
    save: () => void;
    updateTasks: () => void;
    updateHistory: () => void;
    notify: (message: string) => void;
    log: (event: string, details: unknown) => void;
  }) {
    this.camera = options.camera;
    const viewportSize = () => ({ width: innerWidth, height: innerHeight });
    const screen = (point: Point) => worldToScreen(point, options.camera, viewportSize());
    const world = (point: Point) => screenToWorld(point, options.camera, viewportSize());
    this.connection = new CanvasConnectionFeature({
      nodes: options.nodes,
      links: options.links,
      camera: options.camera,
      spatialIndex: options.nodeViews.spatialIndex,
      connection: options.connectionController,
      world,
      screen,
      portWorld: nodePortPosition,
      save: options.save,
      draw: (syncDom) => this.render.draw(syncDom),
      notify: options.notify,
    });
    options.store.subscribe((change) => {
      if (change.type === "node-position")
        change.nodeIds.forEach((id) => {
          const node = options.nodes.find((candidate) => candidate.id === id);
          if (node) options.nodeViews.spatialIndex.update(node);
        });
      else if (change.type === "structure")
        options.nodeViews.spatialIndex.rebuild(options.nodes);
    });
    const state = new CanvasRenderState({
      nodes: options.nodes,
      links: options.links,
      camera: options.camera,
      connectionFeature: this.connection,
      connection: options.connectionController,
      domNodeIds: () => [...options.nodeViews.mountedIds],
      selectedId: () => options.selection.selectedId,
      batchIds: options.selection.batchIds,
      agentIds: options.agentIds,
      dark: options.dark,
      backgroundMode: options.backgroundMode,
      screen,
      portWorld: nodePortPosition,
    });
    this.render = new CanvasRenderFeature({
      viewport: options.viewport,
      zoomSlider: options.zoomSlider,
      zoomPercent: options.zoomPercent,
      nodeCount: options.nodeCount,
      viewportSize,
      camera: () => options.camera,
      interacting: options.interacting,
      state: state.snapshot,
      rebuildIndexes: () => this.connection.rebuild(),
      syncDom: () => options.nodeViews.sync(),
      warmEditors: () => options.nodeViews.scheduleWarmup(),
      updateTasks: options.updateTasks,
      updateHistory: options.updateHistory,
      log: options.log,
    });
  }

  screen = (point: Point) =>
    worldToScreen(point, this.camera, { width: innerWidth, height: innerHeight });
  world = (point: Point) =>
    screenToWorld(point, this.camera, { width: innerWidth, height: innerHeight });
  pan = () => this.render.pan();

}
