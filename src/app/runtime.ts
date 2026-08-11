import "../style.css";
import { CanvasPersistenceRuntimeFeature } from "../canvas/canvas-persistence-runtime-feature";
import { CanvasRenderingRuntimeFeature } from "../canvas/canvas-rendering-runtime-feature";
import { CanvasInteractionRuntime } from "../canvas/canvas-interaction-runtime";
import type { GenerationCapabilities, Point } from "../nodes/node-types";
import { normalizePromptText } from "../nodes/prompt-text";
import { CanvasNodeRuntimeFeature } from "../nodes/canvas-node-runtime-feature";
import { TtsFeature } from "../services/tts-feature";
import {
  createCanvasGenerationRuntime,
  type CanvasGenerationRuntime,
} from "../services/canvas-generation-composition";
import { RuntimeDiagnosticsFeature } from "./runtime-diagnostics-feature";
import {
  clipVideoPrompt,
  composeStoryboardPrompt,
  fitVideoDialogue,
  inferAnonymousCrowd,
  speechSegments,
} from "../nodes/video-node";
import { inferVoiceConfig } from "../nodes/voice-node";
import { bindNodeConfigPanel } from "../ui/node-editor";
import { CanvasControlsRuntime } from "../ui/canvas-controls-runtime";
import type { CanvasGuideMessage } from "../ui/canvas-guide-controller";
import type { ToastType } from "../ui/toast-controller";
import { CanvasWorkspaceContentRuntime } from "../ui/canvas-workspace-content-runtime";
import { CanvasNodePresentationRuntime } from "../nodes/canvas-node-presentation-runtime";
import { createDefaultGenerationCapabilities } from "./state";
import { RuntimeFoundation } from "./runtime-foundation";
import { AccountRuntimeComposition } from "./account-runtime-composition";
import { createWorkspaceShell, type WorkspaceShell } from "./workspace-shell-composition";

let renderingRuntime: CanvasRenderingRuntimeFeature;

let generationCapabilities: GenerationCapabilities =
  createDefaultGenerationCapabilities();
let generationRuntime: CanvasGenerationRuntime;
let nodeRuntime: CanvasNodeRuntimeFeature;
const foundation = new RuntimeFoundation(() =>
  showToast("正在扩展节点编号空间，请稍后重试", "warning"),
);
const {
  canvas, nodeViewport, nodeLayer, zoomSlider, zoomPercent, nodeCount,
  titleInput, promptInput, modelInput, saveState, resetButton, jobLabel,
  jobProgress, generateButton,
} = foundation.dom;
const {
  store: canvasStore, camera, nodes, links, interaction, pointer, selection,
  promptEditor: promptNodeEditor, connection,
} = foundation;
let canvasPersistence: CanvasPersistenceRuntimeFeature;
const canvasNodeIds = foundation.nodeIds;
let controlsRuntime: CanvasControlsRuntime;
let workspaceRuntime: WorkspaceShell;
let contentRuntime: CanvasWorkspaceContentRuntime;
const clientLog = new RuntimeDiagnosticsFeature().log;
const interactionRuntime: CanvasInteractionRuntime = new CanvasInteractionRuntime({
  foundation,
  nodeRuntime: () => nodeRuntime,
  generation: () => generationRuntime,
  rendering: () => renderingRuntime,
  presentation: () => nodePresentation,
  persistence: () => canvasPersistence,
  controls: () => controlsRuntime,
  content: () => contentRuntime,
  user: () => authWorkspace.user,
  setUser: (user) => authWorkspace.setUser(user),
  renderUser: () => authWorkspace.renderUser(),
  refreshModels: refreshNodeModelMenus,
  modelName: modelDisplayName,
  updateEditor,
  draw,
  save: scheduleSave,
  showGuide: showCanvasGuide,
  showModeNotice: showCanvasModeNotice,
  toast: (message, tone, detail) => showToast(message, tone, detail),
});
function closeTopbarMenus(
  except?: "workspace" | "task" | "user" | "notifications" | "presence",
) {
  interactionRuntime.closeMenus(except);
}
const canvasTasks = interactionRuntime.tasks;
const canvasHistory = interactionRuntime.history;
const canvasBatch = interactionRuntime.batch;
const canvasInput = interactionRuntime.input;
const ttsFeature = new TtsFeature({
  nodes,
  links,
  getProjectId: () => foundation.projectId,
  allocateNodeId: () => canvasNodeIds.allocate(),
  invalidateProviders: () => {
    nodes
      .filter((node) => node.kind === "voice")
      .forEach((node) => nodePresentation.views.invalidateState(node.id));
    draw();
  },
  invalidateVoices: (providerId) => {
    nodes
      .filter((node) => node.kind === "voice" && node.voiceSettings?.providerId === providerId)
      .forEach((node) => nodePresentation.views.invalidateState(node.id));
    draw();
  },
  updateEditor,
  draw,
  save: scheduleSave,
  reloadAssets: () => contentRuntime.assets.load(false),
  toast: (message, tone) => showToast(message, tone),
});
const cameraViewport = canvasInput.cameraViewport;
const domPointer = canvasInput.domPointer;
const touchPinch = canvasInput.touchPinch;
const marqueeController = canvasInput.marquee;
const nodePresentation: CanvasNodePresentationRuntime = new CanvasNodePresentationRuntime({
  foundation,
  input: canvasInput,
  nodeRuntime: () => nodeRuntime,
  rendering: () => renderingRuntime,
  generation: () => generationRuntime,
  assets: () => contentRuntime.assets,
  tts: ttsFeature,
  agent: () => contentRuntime.creation.prompt,
  getAuthUser: () => authWorkspace.user,
  getCustomModels: () => accountTools.models,
  getCapabilities: () => generationCapabilities,
  getColorTheme: () => foundation.colorTheme,
  displayModelName: modelDisplayName,
  updateEditor,
  draw,
  resize,
  save: scheduleSave,
  commitHistory: () => canvasHistory.queue(),
  setEditing: () => canvasPersistence.setEditing(),
  copyPrompt: copyOriginalPrompt,
  refreshAppearance: () => controlsRuntime.refreshAppearance(),
  toast: (message, type, detail) => showToast(message, type, detail),
});
const nodeViews = nodePresentation.views;
const imageCache = nodePresentation.media.cache;
function modelDisplayName(value?: string) {
  if (!value?.startsWith("custom:")) return value || "";
  return (
    accountTools.models.find((item) => `custom:${item.id}` === value)?.name ||
    "自定义模型"
  );
}
function showToast(
  message: string,
  type: ToastType = "error",
  detail = "",
) {
  accountRuntime.showToast(message, type, detail);
}

function copyOriginalPrompt(prompt?: string) {
  return accountRuntime.copyPrompt(prompt);
}

function hideCanvasGuide(key?: string) {
  accountRuntime.hideGuide(key);
}
function showCanvasGuide(message: CanvasGuideMessage) {
  return accountRuntime.showGuide(message);
}
const accountRuntime: AccountRuntimeComposition = new AccountRuntimeComposition({
  foundation,
  persistence: () => canvasPersistence,
  rendering: () => renderingRuntime,
  content: () => contentRuntime,
  resize,
  loadCapabilities: (redraw) => loadGenerationCapabilities(redraw),
  registerMenu: (menu, close) => interactionRuntime.menus.register(menu, close),
  closeMenus: (except) => closeTopbarMenus(except),
});
const authWorkspace = accountRuntime.auth;
const accountTools = accountRuntime.account;
function showCanvasModeNotice(title: string, detail: string) {
  accountRuntime.showModeNotice(title, detail);
}
function refreshNodeModelMenus() {
  accountRuntime.refreshNodeModels();
}
authWorkspace.applyRoute();

const world = (point: Point) => renderingRuntime.world(point);
function canvasInteractionActive() {
  return Boolean(pointer.down || domPointer.drag || interaction.marquee?.active || touchPinch.active);
}
renderingRuntime = new CanvasRenderingRuntimeFeature({
  nodes,
  links,
  camera,
  store: canvasStore,
  connectionController: connection,
  selection,
  interaction,
  nodeViews,
  viewport: nodeViewport,
  zoomSlider,
  zoomPercent,
  nodeCount,
  interacting: canvasInteractionActive,
  agentIds: () => contentRuntime.creation.prompt.selectedIds,
  dark: () => foundation.colorTheme === "dark",
  backgroundMode: () => foundation.backgroundMode,
  save: scheduleSave,
  updateTasks: () => canvasTasks.update(),
  updateHistory: () => canvasHistory.refreshControls(),
  notify: (message) => showToast(message, "warning"),
  log: clientLog,
});
function paint() { renderingRuntime.render.paint(); }
function draw(syncDom = true) { renderingRuntime.render.draw(syncDom); }
function resize() {
  draw();
}
nodeRuntime = new CanvasNodeRuntimeFeature({
  nodes,
  links,
  promptEditor: promptNodeEditor,
  titleInput,
  promptInput,
  modelInput,
  generateButton,
  jobLabel,
  jobProgress,
  nodeLayer,
  infoModal: document.querySelector<HTMLElement>("#node-info-modal")!,
  allocateId: () => canvasNodeIds.allocate(),
  capabilities: () => generationCapabilities,
  center: () => world({ x: innerWidth / 2, y: innerHeight / 2 }),
  selectedId: () => selection.selectedId,
  select: (id) => { selection.selectedId = id; },
  batchIds: selection.batchIds,
  availableCredits: () =>
    Number(authWorkspace.user?.credits ?? 0) - Number(authWorkspace.user?.reservedCredits ?? 0),
  hasConnectedVoice: (node) => Boolean(ttsFeature.connectedVoice(node)),
  pixiActive: renderingRuntime.render.active,
  updateEditor,
  setEditingState: () => canvasPersistence.setEditing(),
  save: scheduleSave,
  draw,
  updateTasks: () => canvasTasks.update(),
  cascadeIds: (seed) => canvasBatch.cascade(seed),
  confirmDelete: async (input) => Boolean(await contentRuntime.assets.ask(input)),
  notify: (message, tone) => showToast(message, tone),
  guide: showCanvasGuide,
  hideGuide: hideCanvasGuide,
  undo: () => canvasHistory.undo(),
});
function updateEditor() {
  nodeRuntime.editor.update();
}

function scheduleSave(recordHistory = true) {
  canvasPersistence.schedule(recordHistory);
}

function saveCanvas() { return canvasPersistence.save(); }
canvasPersistence = new CanvasPersistenceRuntimeFeature(saveState, {
  reset: (restore) => canvasHistory.reset(restore),
  queue: () => canvasHistory.queue(),
}, {
  clientId: foundation.syncClientId,
  nodes,
  links,
  camera,
  authenticated: () => Boolean(authWorkspace.user),
  getProjectId: () => foundation.projectId,
  getSelectedId: () => selection.selectedId,
  setSelectedId: (id) => { selection.selectedId = id; },
  normalizePrompt: normalizePromptText,
  syncCamera: () => cameraViewport.syncTarget(),
  ensureNodeIdAtLeast: (value) => canvasNodeIds.ensureAtLeast(value),
  clearViews: () => {
    nodeLayer.replaceChildren();
    nodeViews.clearEditors();
  },
  cancelPolling: () => generationRuntime.cancelAll(),
  getLease: () => ({ nextId: canvasNodeIds.nextId, end: canvasNodeIds.end }),
  restoreLease: (nextId, end) => canvasNodeIds.restore(nextId, end),
  resetLease: (value) => canvasNodeIds.reset(value),
  needsLease: () => canvasNodeIds.needsLease(),
  reserveIds: (projectId) => canvasNodeIds.reserve(projectId),
  setBootStatus: (message) => authWorkspace.status(message),
  hideBootStatus: (version, delay) => authWorkspace.hideStatus(version, delay),
  hideConflictGuide: () => hideCanvasGuide("canvas-save-conflict"),
  showConflict: (emptyGuard) => showCanvasGuide({
    key: "canvas-save-conflict",
    title: emptyGuard ? "已保护服务器画布" : "服务器画布已有新版本",
    detail: "正在停止本地保存并强制载入服务器上的完整版本。",
    tone: "offline",
    priority: 110,
  }),
  updateEditor,
  draw,
  pollJob: (node) => generationRuntime.poll(node),
  runWorkflow: () => generationRuntime.run(),
  clearButton: document.querySelector<HTMLElement>("#dock-clear")!,
  notifyClear: (count) => showToast(`已清除画布内容，保留 ${count} 个标签`, "success"),
  toast: (message, tone, detail) => showToast(message, tone, detail),
});
function loadCanvas(keepLoadingStatus = false) {
  return canvasPersistence.load(keepLoadingStatus);
}

generationRuntime = createCanvasGenerationRuntime({
  foundation,
  nodeRuntime,
  tts: ttsFeature,
  assets: () => contentRuntime.assets,
  imageCache,
  user: () => authWorkspace.user,
  setUser: (user) => authWorkspace.setUser(user),
  renderUser: () => authWorkspace.renderUser(),
  updateEditor,
  draw,
  save: scheduleSave,
  refreshModelMenus: refreshNodeModelMenus,
  toast: (message, tone, detail) => showToast(message, tone, detail),
});
controlsRuntime = new CanvasControlsRuntime({
  foundation,
  input: canvasInput,
  rendering: renderingRuntime,
  nodeRuntime,
  presentation: nodePresentation,
  generation: generationRuntime,
  content: () => contentRuntime,
  updateEditor,
  draw,
  save: scheduleSave,
  toast: (message, tone, detail) => showToast(message, tone, detail),
});
contentRuntime = new CanvasWorkspaceContentRuntime({
  foundation,
  rendering: renderingRuntime,
  nodeRuntime,
  persistence: canvasPersistence,
  generation: generationRuntime,
  tts: ttsFeature,
  tasks: canvasTasks,
  user: () => authWorkspace.user,
  ensureProject: () => authWorkspace.ensureCurrentProject(),
  invalidateShowcase: () => authWorkspace.invalidateShowcase(),
  isMultiSelect: () => selection.multiSelectMode,
  exitMultiSelect: () => marqueeController.exit(),
  resetMarqueeGesture: () => marqueeController.resetRightGesture(),
  imageCache,
  updateEditor,
  draw,
  save: scheduleSave,
  showGuide: showCanvasGuide,
  hideGuide: hideCanvasGuide,
  clientLog,
  closeTopbarMenus: (opening) => closeTopbarMenus(opening ? "workspace" : undefined),
  registerWorkspaceMenu: (close) => interactionRuntime.menus.register("workspace", close),
  toast: (message, tone, detail) => showToast(message, tone, detail),
});
function loadGenerationCapabilities(redraw = false): Promise<void> {
  return workspaceRuntime.loadCapabilities(redraw);
}
workspaceRuntime = createWorkspaceShell({
  account: accountRuntime,
  content: contentRuntime,
  controls: controlsRuntime,
  nodeRuntime,
  rendering: renderingRuntime,
  history: canvasHistory,
  capabilities: () => generationCapabilities,
  applyCapabilities: (capabilities) => { generationCapabilities = capabilities; },
});
workspaceRuntime.start(resize, updateEditor);
