import type { RuntimeFoundation } from "../app/runtime-foundation";
import type { CanvasNodePresentationRuntime } from "../nodes/canvas-node-presentation-runtime";
import type { CanvasWorkspaceContentRuntime } from "../ui/canvas-workspace-content-runtime";
import type { CanvasInteractionRuntime } from "./canvas-interaction-runtime";
import { CanvasRenderingRuntimeFeature } from "./canvas-rendering-runtime-feature";

export function createCanvasRenderingComposition(options: {
  foundation: RuntimeFoundation;
  interaction: CanvasInteractionRuntime;
  presentation: CanvasNodePresentationRuntime;
  content: () => CanvasWorkspaceContentRuntime;
  save: (recordHistory?: boolean) => void;
  notify: (message: string) => void;
  createFromConnectionDrop: (input: {
    sourceId: number;
    position: import("../nodes/node-types").Point;
    clientX: number;
    clientY: number;
  }) => void;
  log: (event: string, details?: unknown) => void;
}) {
  const { foundation, interaction } = options;
  const { nodes, links, camera, store, connection, selection } = foundation;
  const { nodeViewport, zoomSlider, zoomPercent, nodeCount } = foundation.dom;
  return new CanvasRenderingRuntimeFeature({
    nodes,
    links,
    camera,
    store,
    connectionController: connection,
    selection,
    interaction: foundation.interaction,
    nodeViews: options.presentation.views,
    viewport: nodeViewport,
    zoomSlider,
    zoomPercent,
    nodeCount,
    interacting: () => Boolean(
      foundation.pointer.down ||
      interaction.input.domPointer.drag ||
      foundation.interaction.marquee?.active ||
      interaction.input.touchPinch.active
    ),
    agentIds: () => options.content().creation.prompt.selectedIds,
    dark: () => foundation.colorTheme === "dark",
    backgroundMode: () => foundation.backgroundMode,
    save: options.save,
    updateTasks: () => interaction.tasks.update(),
    updateHistory: () => interaction.history.refreshControls(),
    notify: options.notify,
    createFromConnectionDrop: options.createFromConnectionDrop,
    log: options.log,
  });
}
