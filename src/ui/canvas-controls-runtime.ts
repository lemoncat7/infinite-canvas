import type { RuntimeFoundation } from "../app/runtime-foundation";
import type { CanvasInputFeature } from "../canvas/canvas-input-feature";
import type { CanvasRenderingRuntimeFeature } from "../canvas/canvas-rendering-runtime-feature";
import type { CanvasNodePresentationRuntime } from "../nodes/canvas-node-presentation-runtime";
import type { CanvasNodeRuntimeFeature } from "../nodes/canvas-node-runtime-feature";
import type { CanvasGenerationRuntime } from "../services/canvas-generation-composition";
import type { CanvasWorkspaceContentRuntime } from "./canvas-workspace-content-runtime";
import { CanvasControlsFeature } from "./canvas-controls-feature";
import { themePreference } from "../services/theme-preference";
import { connectionCreationKinds } from "../nodes/connection-rules";
import type { FlowNode } from "../nodes/node-types";

type Tone = "success" | "warning" | "error" | "info";

export class CanvasControlsRuntime {
  readonly feature: CanvasControlsFeature;
  private readonly nodes: FlowNode[];

  constructor(options: {
    foundation: RuntimeFoundation;
    input: CanvasInputFeature;
    rendering: CanvasRenderingRuntimeFeature;
    nodeRuntime: CanvasNodeRuntimeFeature;
    presentation: CanvasNodePresentationRuntime;
    generation: CanvasGenerationRuntime;
    content: () => CanvasWorkspaceContentRuntime;
    updateEditor: () => void;
    draw: (syncDom?: boolean) => void;
    save: (recordHistory?: boolean) => void;
    toast: (message: string, tone: Tone, detail?: string) => void;
  }) {
    const { foundation } = options;
    this.nodes = foundation.nodes;
    const { canvas, zoomSlider, nodeLayer } = foundation.dom;
    const { links, connection, pointer, selection } = foundation;
    this.feature = new CanvasControlsFeature({
      link: {
        canvas,
        links,
        connection,
        pointerDown: () => pointer.down,
        multiSelect: () => selection.multiSelectMode,
        hitLink: (x, y, tolerance) => options.rendering.connection.hitLink(x, y, tolerance),
        generationActive: () => options.nodeRuntime.lifecycle.hasActiveGeneration(),
        contextSuppressed: options.input.marquee.isContextSuppressed,
        save: options.save,
        draw: options.draw,
        notify: options.toast,
      },
      toolbar: {
        zoomSlider,
        viewportCenter: () => ({ x: innerWidth / 2, y: innerHeight / 2 }),
        fit: options.input.cameraViewport.fit,
        setZoom: (zoom, anchor) => options.input.cameraViewport.setImmediate(zoom, anchor),
        zoomBy: options.input.cameraViewport.smoothBy,
        addNode: (kind) => options.nodeRuntime.add(kind),
        generate: () => { void options.generation.generate(); },
        deleteSelected: () => { void options.nodeRuntime.lifecycle.deleteSelected(); },
      },
      quickMenu: {
        canvas,
        connectionActive: () => Boolean(connection.active),
        hitNode: (x, y) => options.rendering.connection.hitNode(x, y),
        selectNode: (node) => {
          selection.selectedId = node.id;
          options.updateEditor();
          options.draw();
        },
        previewNode: (node) => options.content().assets.openPreview(
          node.mediaUrl!, node.title, node.kind as "image" | "video",
        ),
        editPromptNode: (node) => {
          const element = nodeLayer.querySelector<HTMLElement>(
            `.flow-node[data-id="${node.id}"]`,
          );
          if (element) options.nodeRuntime.beginTextEdit(node, element);
        },
        multiSelectActive: () => selection.multiSelectMode,
        exitMultiSelect: () => options.input.marquee.exit(),
        enterMultiSelect: () => options.input.marquee.enter(),
        toWorld: options.rendering.world,
        addNode: (kind, position, deferRender) => options.nodeRuntime.add(kind, position, deferRender),
        connectCreatedNode: (sourceId, node) => {
          const next = options.rendering.connection.directedLink(sourceId, "right", node.id, "left");
          if (!next) {
            const index = foundation.nodes.indexOf(node);
            if (index >= 0) foundation.nodes.splice(index, 1);
            return false;
          }
          links.push(next);
          selection.selectedId = 0;
          options.updateEditor();
          options.save();
          options.draw();
          return true;
        },
        uploadAt: (position) => options.content().assets.openUploadAt(position),
      },
      appearance: {
        pendingMedia: () => options.presentation.media.pendingLoads.size,
        currentTheme: () => foundation.colorTheme,
        currentPreference: () => themePreference.preference,
        cycleTheme: () => themePreference.cycle(),
        repaintMedia: options.presentation.media.repaintAll,
        paint: options.rendering.render.paint,
      },
    });
    themePreference.subscribe((theme) => {
      foundation.colorTheme = theme;
      options.presentation.media.repaintAll();
      options.rendering.render.paint();
      this.feature.refreshAppearance();
    });
  }

  get quickMenu() { return this.feature.quickMenu; }
  closeQuickMenu = () => this.feature.closeQuickMenu();
  openConnectionMenu = (input: {
    sourceId: number;
    position: import("../nodes/node-types").Point;
    clientX: number;
    clientY: number;
  }) => {
    const source = this.nodes.find((node) => node.id === input.sourceId);
    if (!source) return;
    this.feature.openConnectionMenu({ ...input, kinds: connectionCreationKinds(source) });
  };
  refreshAppearance = () => this.feature.refreshAppearance();
}
