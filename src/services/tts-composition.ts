import type { RuntimeFoundation } from "../app/runtime-foundation";
import type { CanvasNodePresentationRuntime } from "../nodes/canvas-node-presentation-runtime";
import type { CanvasWorkspaceContentRuntime } from "../ui/canvas-workspace-content-runtime";
import { TtsFeature } from "./tts-feature";

type Tone = "success" | "warning" | "error" | "info";

export function createTtsRuntime(options: {
  foundation: RuntimeFoundation;
  presentation: () => CanvasNodePresentationRuntime;
  content: () => CanvasWorkspaceContentRuntime;
  updateEditor: () => void;
  draw: () => void;
  save: (recordHistory?: boolean) => void;
  toast: (message: string, tone: Tone) => void;
}) {
  const { foundation } = options;
  const { nodes, links, nodeIds } = foundation;
  const invalidateVoiceNodes = (providerId?: string) => {
    nodes
      .filter((node) => node.kind === "voice" && (
        providerId === undefined || node.voiceSettings?.providerId === providerId
      ))
      .forEach((node) => options.presentation().views.invalidateState(node.id));
    options.draw();
  };
  return new TtsFeature({
    nodes,
    links,
    getProjectId: () => foundation.projectId,
    allocateNodeId: () => nodeIds.allocate(),
    invalidateProviders: () => invalidateVoiceNodes(),
    invalidateVoices: invalidateVoiceNodes,
    updateEditor: options.updateEditor,
    draw: options.draw,
    save: options.save,
    reloadAssets: () => options.content().assets.load(false),
    toast: options.toast,
  });
}

export type TtsRuntime = ReturnType<typeof createTtsRuntime>;
