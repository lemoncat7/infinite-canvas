import type { RuntimeFoundation } from "../app/runtime-foundation";
import type { CanvasNodeRuntimeFeature } from "../nodes/canvas-node-runtime-feature";
import type { FlowNode } from "../nodes/node-types";
import { normalizePromptText } from "../nodes/prompt-text";
import type { WorkspaceAssetsRuntimeFeature } from "../ui/workspace-assets-runtime-feature";
import type { AuthUser } from "../ui/user-menu-controller";
import { CanvasGenerationRuntimeFeature } from "./canvas-generation-runtime-feature";
import type { TtsFeature } from "./tts-feature";

type Tone = "success" | "warning" | "error" | "info";

export function createCanvasGenerationRuntime(options: {
  foundation: RuntimeFoundation;
  nodeRuntime: CanvasNodeRuntimeFeature;
  tts: TtsFeature;
  assets: () => WorkspaceAssetsRuntimeFeature;
  imageCache: { delete: (key: string) => boolean };
  user: () => AuthUser | null;
  setUser: (user: AuthUser) => void;
  renderUser: () => void;
  updateEditor: () => void;
  draw: () => void;
  save: (recordHistory?: boolean) => void;
  refreshModelMenus: () => void;
  toast: (message: string, tone: Tone, detail?: string) => void;
}) {
  const { foundation, nodeRuntime } = options;
  const { nodes, links, selection, nodeIds } = foundation;
  const { jobLabel, promptInput } = foundation.dom;
  return new CanvasGenerationRuntimeFeature({
    generation: {
      nodes,
      links,
      imageCache: options.imageCache,
      jobLabel,
      getSelectedId: () => selection.selectedId,
      setSelectedId: (id) => { selection.selectedId = id; },
      selectedNode: () => nodeRuntime.editor.selected(),
      blockedReason: (node) => nodeRuntime.editor.blockedReason(node),
      normalizePrompt: normalizePromptText,
      getProjectId: () => foundation.projectId,
      allocateNodeId: () => nodeIds.allocate(),
      clearSelection: () => {
        selection.selectedId = 0;
        options.updateEditor();
        options.draw();
      },
      updateEditor: options.updateEditor,
      draw: options.draw,
      save: options.save,
      focusPrompt: () => promptInput.focus(),
      generateTts: (node) => options.tts.generate(node),
      getUser: options.user,
      setUser: options.setUser,
      renderUser: options.renderUser,
      refreshModelMenus: options.refreshModelMenus,
      loadAssets: () => options.assets().load(false),
      renderAssets: () => options.assets().render(),
      isAssetPanelOpen: () => Boolean(
        document.querySelector("#assets-panel")?.classList.contains("open"),
      ),
      toast: options.toast,
    },
    canGenerate: (node) => nodeRuntime.editor.canGenerate(node),
    onProgress: (node, _job, changed) => {
      if (changed) nodeRuntime.editor.updateProgress(node);
    },
    onRetry: () => options.toast("首次生成请求超时，正在自动重试一次", "warning"),
    onSyncFailure: (_failures, notify) => {
      jobLabel.textContent = "状态同步中断，正在重试…";
      if (notify)
        options.toast("任务状态暂时无法同步，服务恢复后将自动重试", "error");
    },
  });
}

export type CanvasGenerationRuntime = ReturnType<typeof createCanvasGenerationRuntime>;
