import type { AccountRuntimeComposition } from "../app/account-runtime-composition";
import type { RuntimeFoundation } from "../app/runtime-foundation";
import type { CanvasInteractionRuntime } from "../canvas/canvas-interaction-runtime";
import type { CanvasPersistenceRuntimeFeature } from "../canvas/canvas-persistence-runtime-feature";
import type { CanvasRenderingRuntimeFeature } from "../canvas/canvas-rendering-runtime-feature";
import type { TtsRuntime } from "../services/tts-composition";
import type { CanvasGuideMessage } from "../ui/canvas-guide-controller";
import type { CanvasWorkspaceContentRuntime } from "../ui/canvas-workspace-content-runtime";
import type { GenerationCapabilities } from "./node-types";
import { CanvasNodeRuntimeFeature } from "./canvas-node-runtime-feature";

type Tone = "success" | "warning" | "error" | "info";

export function createCanvasNodeComposition(options: {
  foundation: RuntimeFoundation;
  rendering: CanvasRenderingRuntimeFeature;
  interaction: CanvasInteractionRuntime;
  persistence: () => CanvasPersistenceRuntimeFeature;
  content: () => CanvasWorkspaceContentRuntime;
  account: AccountRuntimeComposition;
  tts: TtsRuntime;
  capabilities: () => GenerationCapabilities;
  updateEditor: () => void;
  draw: () => void;
  save: (recordHistory?: boolean) => void;
  showGuide: (message: CanvasGuideMessage) => void;
  hideGuide: (key?: string) => void;
  toast: (message: string, tone: Tone) => void;
}) {
  const { foundation, interaction } = options;
  const { nodes, links, selection, promptEditor, nodeIds } = foundation;
  const {
    titleInput, promptInput, modelInput, generateButton, jobLabel,
    jobProgress, nodeLayer,
  } = foundation.dom;
  return new CanvasNodeRuntimeFeature({
    nodes,
    links,
    promptEditor,
    titleInput,
    promptInput,
    modelInput,
    generateButton,
    jobLabel,
    jobProgress,
    nodeLayer,
    infoModal: document.querySelector<HTMLElement>("#node-info-modal")!,
    allocateId: () => nodeIds.allocate(),
    capabilities: options.capabilities,
    center: () => options.rendering.world({ x: innerWidth / 2, y: innerHeight / 2 }),
    selectedId: () => selection.selectedId,
    select: (id) => { selection.selectedId = id; },
    batchIds: selection.batchIds,
    availableCredits: () => Number(options.account.auth.user?.credits ?? 0) -
      Number(options.account.auth.user?.reservedCredits ?? 0),
    hasConnectedVoice: (node) => Boolean(options.tts.connectedVoice(node)),
    pixiActive: options.rendering.render.active,
    updateEditor: options.updateEditor,
    setEditingState: () => options.persistence().setEditing(),
    save: options.save,
    draw: options.draw,
    updateTasks: () => interaction.tasks.update(),
    cascadeIds: (seed) => interaction.batch.cascade(seed),
    confirmDelete: async (input) => Boolean(await options.content().assets.ask(input)),
    notify: options.toast,
    guide: options.showGuide,
    hideGuide: options.hideGuide,
    undo: () => interaction.history.undo(),
  });
}
