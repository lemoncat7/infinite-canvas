import type { AccountRuntimeComposition } from "../app/account-runtime-composition";
import type { RuntimeFoundation } from "../app/runtime-foundation";
import type { CanvasNodePresentationRuntime } from "../nodes/canvas-node-presentation-runtime";
import { normalizePromptText } from "../nodes/prompt-text";
import type { CanvasGenerationRuntime } from "../services/canvas-generation-composition";
import type { CanvasGuideMessage } from "../ui/canvas-guide-controller";
import type { CanvasInteractionRuntime } from "./canvas-interaction-runtime";
import { CanvasPersistenceRuntimeFeature } from "./canvas-persistence-runtime-feature";

type Tone = "success" | "warning" | "error" | "info";

export function createCanvasPersistenceComposition(options: {
  foundation: RuntimeFoundation;
  interaction: CanvasInteractionRuntime;
  presentation: CanvasNodePresentationRuntime;
  generation: () => CanvasGenerationRuntime;
  account: AccountRuntimeComposition;
  updateEditor: () => void;
  draw: () => void;
  showGuide: (message: CanvasGuideMessage) => void;
  hideGuide: (key?: string) => void;
  toast: (message: string, tone: Tone, detail?: string) => void;
}) {
  const { foundation, interaction } = options;
  const { nodes, links, camera, selection, nodeIds } = foundation;
  return new CanvasPersistenceRuntimeFeature(foundation.dom.saveState, {
    reset: (restore) => interaction.history.reset(restore),
    queue: () => interaction.history.queue(),
  }, {
    clientId: foundation.syncClientId,
    nodes,
    links,
    camera,
    authenticated: () => Boolean(options.account.auth.user),
    getProjectId: () => foundation.projectId,
    getSelectedId: () => selection.selectedId,
    setSelectedId: (id) => { selection.selectedId = id; },
    normalizePrompt: normalizePromptText,
    syncCamera: () => interaction.input.cameraViewport.syncTarget(),
    ensureNodeIdAtLeast: (value) => nodeIds.ensureAtLeast(value),
    clearViews: () => {
      foundation.dom.nodeLayer.replaceChildren();
      options.presentation.views.clearEditors();
    },
    cancelPolling: () => options.generation().cancelAll(),
    getLease: () => ({ nextId: nodeIds.nextId, end: nodeIds.end }),
    restoreLease: (nextId, end) => nodeIds.restore(nextId, end),
    resetLease: (value) => nodeIds.reset(value),
    needsLease: () => nodeIds.needsLease(),
    reserveIds: (projectId) => nodeIds.reserve(projectId),
    setBootStatus: (message) => options.account.auth.status(message),
    hideBootStatus: (version, delay) => options.account.auth.hideStatus(version, delay),
    hideConflictGuide: () => options.hideGuide("canvas-save-conflict"),
    showConflict: (emptyGuard) => options.showGuide({
      key: "canvas-save-conflict",
      title: emptyGuard ? "已保护服务器画布" : "服务器画布已有新版本",
      detail: "正在停止本地保存并强制载入服务器上的完整版本。",
      tone: "offline",
      priority: 110,
    }),
    updateEditor: options.updateEditor,
    draw: options.draw,
    pollJob: (node) => options.generation().poll(node),
    runWorkflow: () => options.generation().run(),
    clearButton: document.querySelector<HTMLElement>("#dock-clear")!,
    notifyClear: (count) => options.toast(
      `已清除画布内容，保留 ${count} 个标签`, "success",
    ),
    toast: options.toast,
  });
}
