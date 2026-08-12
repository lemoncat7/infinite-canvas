import type { RuntimeFoundation } from "../app/runtime-foundation";
import type { CanvasInputFeature } from "../canvas/canvas-input-feature";
import type { CanvasRenderingRuntimeFeature } from "../canvas/canvas-rendering-runtime-feature";
import type { CanvasNodePresentationRuntime } from "../nodes/canvas-node-presentation-runtime";
import type { CanvasNodeRuntimeFeature } from "../nodes/canvas-node-runtime-feature";
import type { CanvasGenerationRuntime } from "../services/canvas-generation-composition";
import type { CanvasWorkspaceContentRuntime } from "./canvas-workspace-content-runtime";
import { CanvasControlsFeature } from "./canvas-controls-feature";
import { themePreference } from "../services/theme-preference";

type Tone = "success" | "warning" | "error" | "info";

export class CanvasControlsRuntime {
  readonly feature: CanvasControlsFeature;

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
        addNode: (kind, position) => options.nodeRuntime.add(kind, position),
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
  refreshAppearance = () => this.feature.refreshAppearance();
}
