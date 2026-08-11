import "../style.css";
import { CanvasPersistenceRuntimeFeature } from "../canvas/canvas-persistence-runtime-feature";
import { CanvasRenderingRuntimeFeature } from "../canvas/canvas-rendering-runtime-feature";
import { CanvasInputFeature } from "../canvas/canvas-input-feature";
import { CanvasBatchFeature } from "../canvas/canvas-batch-feature";
import { CanvasHistoryFeature } from "../canvas/canvas-history-feature";
import { CanvasMediaFeature } from "../canvas/canvas-media-feature";
import type {
  FlowNode,
  GenerationCapabilities,
  NodeKind,
  Point,
} from "../nodes/node-types";
import { defaultNodeCopy } from "../nodes/node-lifecycle-controller";
import { decodePromptClipboardText, normalizePromptText } from "../nodes/prompt-text";
import { CanvasNodeRuntimeFeature } from "../nodes/canvas-node-runtime-feature";
import { TtsFeature } from "../services/tts-feature";
import { apiFetch } from "../services/api";
import { AppUpdateController } from "../services/app-update-controller";
import { CanvasGenerationRuntimeFeature } from "../services/canvas-generation-runtime-feature";
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
import { WorkspaceAssetsRuntimeFeature } from "../ui/workspace-assets-runtime-feature";
import { CanvasTaskFeature } from "../ui/canvas-task-feature";
import { TopbarMenuCoordinator } from "../ui/topbar-menu-coordinator";
import { CanvasControlsFeature } from "../ui/canvas-controls-feature";
import type { CanvasGuideMessage } from "../ui/canvas-guide-controller";
import type { ToastType } from "../ui/toast-controller";
import { CanvasFeedbackFeature } from "../ui/canvas-feedback-feature";
import type { AuthUser } from "../ui/user-menu-controller";
import { CanvasCreationSuiteFeature } from "../ui/canvas-creation-suite-feature";
import { CanvasNodeViewFeature } from "../nodes/canvas-node-view-feature";
import { createDefaultGenerationCapabilities } from "./state";
import { WorkspaceRuntimeFeature } from "./workspace-runtime-feature";
import { AccountSessionFeature } from "./account-session-feature";
import { escapeRuntimeHtml, RuntimeFoundation } from "./runtime-foundation";
import { screenToWorld, worldToScreen } from "../canvas/camera-controller";

let renderingRuntime: CanvasRenderingRuntimeFeature;

let generationCapabilities: GenerationCapabilities =
  createDefaultGenerationCapabilities();
let generationRuntime: CanvasGenerationRuntimeFeature;
let nodeRuntime: CanvasNodeRuntimeFeature;
let assetRuntime: WorkspaceAssetsRuntimeFeature;
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
let backgroundMode = foundation.backgroundMode;
let colorTheme = foundation.colorTheme;
const clientLog = new RuntimeDiagnosticsFeature().log;
const canvasTasks = new CanvasTaskFeature<AuthUser>({
  nodes,
  links,
  resetButton,
  canGenerate: (node) => nodeRuntime.editor.canGenerate(node),
  modelName: modelDisplayName,
  projectId: () => foundation.projectId,
  cancelPoll: (jobId) => generationRuntime.cancel(jobId),
  getUser: () => authWorkspace.user,
  setUser: (user) => authWorkspace.setUser(user),
  renderUser: () => authWorkspace.renderUser(),
  refreshModels: refreshNodeModelMenus,
  closeOtherMenus: (opening) =>
    closeTopbarMenus(opening ? "task" : undefined),
  focusNode: (node) => {
    selection.selectedId = node.id;
    camera.x = -(node.x + node.width / 2) * camera.zoom;
    camera.y = -(node.y + node.height / 2) * camera.zoom;
  },
  runWorkflow: () => generationRuntime.run(),
  ask: async (options) => (await assetRuntime.ask(options)) === true,
  save: scheduleSave,
  updateEditor,
  draw,
  showGuide: showCanvasGuide,
  toast: (message, tone, detail) => showToast(message, tone, detail),
});
const topbarMenus = new TopbarMenuCoordinator();
topbarMenus.register("task", () => canvasTasks.close());
topbarMenus.register("presence", () =>
  document.querySelector("#online-status-panel")?.classList.remove("open"),
);
const canvasHistory = new CanvasHistoryFeature({
  nodes,
  links,
  getProjectId: () => foundation.projectId,
  getNextId: () => canvasNodeIds.nextId,
  setNextId: (value) => { canvasNodeIds.nextId = value; },
  getSelectedId: () => selection.selectedId,
  setSelectedId: (value) => { selection.selectedId = value; },
  clearBatch: () => selection.batchIds.clear(),
  clearPromptEditing: () => { promptNodeEditor.editingId = 0; },
  generationActive: () => nodeRuntime.lifecycle.hasActiveGeneration(),
  updateEditor,
  draw,
  save: saveCanvas,
  toast: (message) => showToast(message, "warning"),
  showGuide: showCanvasGuide,
});
function closeTopbarMenus(
  except?: "workspace" | "task" | "user" | "notifications" | "presence",
) {
  topbarMenus.closeAll(except);
}
document.addEventListener("click", () => {
  canvasTasks.close();
  topbarMenus.closeAll();
});
const canvasBatch = new CanvasBatchFeature({
  nodes,
  links,
  batchIds: selection.batchIds,
  getSelectedId: () => selection.selectedId,
  clearSelectedId: () => { selection.selectedId = 0; },
  isMultiSelectMode: () => selection.multiSelectMode,
  screen: (point) => screen(point),
  viewportWidth: () => innerWidth,
  generationActive: () => nodeRuntime.lifecycle.hasActiveGeneration(),
  enqueue: (ids) => generationRuntime.enqueue(ids),
  exitMode: () => marqueeController.exit(),
  updateEditor,
  draw,
  save: scheduleSave,
  toast: (message, tone, detail) => showToast(message, tone, detail),
  confirm: (message) => window.confirm(message),
});
let creationSuite: CanvasCreationSuiteFeature;
const ttsFeature = new TtsFeature({
  nodes,
  links,
  getProjectId: () => foundation.projectId,
  allocateNodeId: () => canvasNodeIds.allocate(),
  invalidateProviders: () => {
    nodes
      .filter((node) => node.kind === "voice")
      .forEach((node) => nodeViews.invalidateState(node.id));
    draw();
  },
  invalidateVoices: (providerId) => {
    nodes
      .filter((node) => node.kind === "voice" && node.voiceSettings?.providerId === providerId)
      .forEach((node) => nodeViews.invalidateState(node.id));
    draw();
  },
  updateEditor,
  draw,
  save: scheduleSave,
  reloadAssets: () => assetRuntime.load(false),
  toast: (message, tone) => showToast(message, tone),
});
const canvasInput = new CanvasInputFeature({
  canvas,
  nodeLayer,
  nodes,
  camera,
  interaction,
  selection,
  marqueeBox: canvasBatch.marqueeBox,
  batchToolbar: canvasBatch.toolbar,
  draw,
  save: scheduleSave,
  setEditing: () => canvasPersistence.setEditing(),
  updateEditor,
  syncDraggedElements: (ids) => nodeViews.syncDraggedElements(ids, nodes),
  refreshBatchSelection: () => canvasBatch.refresh(),
  clearBatchSelection: () => canvasBatch.clear(),
  toggleBatchNode: (id) => canvasBatch.toggle(id),
  refreshCanvasModeHint: () => canvasBatch.refreshModeHint(),
  showCanvasModeNotice,
  getAgentIds: () => creationSuite.prompt.selectedIds,
  renderAgentSelection: () => creationSuite.prompt.renderContext(false),
  warnAgentLimit: () => showToast("参考素材最多选择 8 个", "warning"),
  hasConnection: () => Boolean(connection.active),
  moveConnection: (event, syncDom) => {
    updateConnectionPointer(event.clientX, event.clientY);
    startConnectionAutoPan(event.clientX, event.clientY);
    draw(syncDom);
  },
  finishConnection: (event) => renderingRuntime.connection.finish(event),
  cancelConnection: () => {
    connection.cancel();
    stopConnectionAutoPan();
  },
  hitNode,
  moveNode: (id, dx, dy) => canvasStore.moveNodeById(id, dx, dy),
  panCamera: (dx, dy) => canvasStore.panCamera(dx, dy),
  closeQuickMenu: () => canvasControls.closeQuickMenu(),
  screen: (point) => worldToScreen(point, camera, { width: innerWidth, height: innerHeight }),
  world: (point) => screenToWorld(point, camera, { width: innerWidth, height: innerHeight }),
});
const cameraViewport = canvasInput.cameraViewport;
const domPointer = canvasInput.domPointer;
const touchPinch = canvasInput.touchPinch;
const marqueeController = canvasInput.marquee;
const nodeViews = new CanvasNodeViewFeature({
  viewport: nodeViewport,
  layer: nodeLayer,
  nodes,
  links,
  camera,
  world: (point) => world(point),
  getSelectedId: () => selection.selectedId,
  setSelectedId: (id) => { selection.selectedId = id; },
  getBatchIds: () => selection.batchIds,
  getEditingId: () => promptNodeEditor.editingId,
  getDraggingId: () => domPointer.drag?.id ?? 0,
  isMultiSelectMode: () => selection.multiSelectMode,
  getDrag: () => domPointer.drag,
  setDrag: (drag) => { domPointer.drag = drag; },
  beginResize: (value) => domPointer.beginResize(value),
  isReleaseSuppressed: domPointer.isReleaseSuppressed,
  isAgentSelecting: () => creationSuite.prompt.selecting,
  isAgentCreateMode: () => creationSuite.prompt.controls.mode === "create",
  getAgentIds: () => creationSuite.prompt.selectedIds,
  getColorTheme: () => colorTheme,
  getSwap: () => foundation.videoReferenceSwapSelection,
  setSwap: (value) => { foundation.videoReferenceSwapSelection = value; },
  getAuthUser: () => authWorkspace.user,
  getCustomModels: () => accountTools.models,
  getCapabilities: () => generationCapabilities,
  isGenerating: (node) => nodeRuntime.lifecycle.isActive(node),
  defaultCopy: defaultNodeCopy,
  getProviders: () => ttsFeature.catalog.providers,
  getVoices: () => ttsFeature.catalog.voicesByProvider,
  ensureProviders: () => ttsFeature.loadProviders(),
  ensureVoices: (providerId) => ttsFeature.loadVoices(providerId),
  escapeHtml: escapeRuntimeHtml,
  normalizePrompt: normalizePromptText,
  displayModelName: modelDisplayName,
  decodePrompt: (value = "") => decodePromptClipboardText(value),
  canGenerate: (node) => nodeRuntime.editor.canGenerate(node),
  updateEditor,
  draw,
  scheduleSave,
  commitHistory: () => canvasHistory.queue(),
  setEditingState: () => canvasPersistence.setEditing(),
  editPrompt: enterTextEdit,
  previewMedia: (node) =>
    assetRuntime.openPreview(node.mediaUrl!, node.title, node.kind as "image" | "video"),
  beginConnection: (nodeId, point) => connection.begin(nodeId, "right", point),
  showInfo: openNodeInfo,
  focusEditor: () => promptInput.focus(),
  generate,
  downloadImage: (node) => assetRuntime.downloadNodeImage(node),
  deleteNode: () => { void nodeRuntime.lifecycle.deleteSelected(); },
  confirmClearImage: async () => Boolean(await assetRuntime.ask({
    title: "清除当前卡片的图片？",
    description: "资产库中的原图不会删除。原提示词、当前描述、模型、图像设置和参考连线都会保留。",
    confirm: "清除图片",
  })),
  removeCachedImage: (url) => imageCache.delete(url),
  notifyImageCleared: (message) => showToast(message, "success"),
  beginImageUpload: (nodeId) => assetRuntime.beginNodeUpload(nodeId),
  beginImageLibrary: (nodeId) => assetRuntime.beginNodeLibrary(nodeId),
  previewVoice: (node) => ttsFeature.preview(node),
  generateTts: (node) => ttsFeature.generate(node),
  copyPrompt: copyOriginalPrompt,
  paintImage: (target, url) => canvasMedia.paint(target, url),
  paintVideo: (target, url) => canvasMedia.paint(target, url),
  notify: (message, type, detail) => showToast(message, type, detail),
});
const canvasMedia = new CanvasMediaFeature({
  mobile: innerWidth <= 780,
  nodes,
  nodeLayer,
  theme: () => colorTheme,
  suspendRenderer: () => renderingRuntime.render.suspend(),
  resumeRenderer: () => renderingRuntime.render.resume(),
  clearNodeStates: () => nodeViews.clearStates(),
  invalidateNode: (id) => nodeViews.invalidateState(id),
  resize,
  draw,
  refreshAppearance: () => canvasControls.refreshAppearance(),
});
const pendingMediaLoads = canvasMedia.pendingLoads;
const imageCache = canvasMedia.cache;
function modelDisplayName(value?: string) {
  if (!value?.startsWith("custom:")) return value || "";
  return (
    accountTools.models.find((item) => `custom:${item.id}` === value)?.name ||
    "自定义模型"
  );
}
const canvasFeedback = new CanvasFeedbackFeature({
  escapeHtml: escapeRuntimeHtml,
  normalizePrompt: normalizePromptText,
  decodePrompt: decodePromptClipboardText,
});
function showToast(
  message: string,
  type: ToastType = "error",
  detail = "",
) {
  canvasFeedback.showToast(message, type, detail);
}

function copyOriginalPrompt(prompt?: string) {
  return canvasFeedback.copyOriginalPrompt(prompt);
}

function hideCanvasGuide(key?: string) {
  canvasFeedback.hideGuide(key);
}
function showCanvasGuide(message: CanvasGuideMessage) {
  return canvasFeedback.showGuide(message);
}
const appUpdateController = new AppUpdateController({
  authenticated: () => Boolean(authWorkspace.user),
  refreshCapabilities: () => loadGenerationCapabilities(true),
  showNotice: ({ dismiss, reload }) => showCanvasGuide({
    key: "app-update",
    title: "检测到服务器版本更新",
    detail: "刷新页面后即可使用最新版本。",
    priority: 80,
    actions: [
      { label: "稍后", run: dismiss },
      { label: "刷新生效", primary: true, run: reload },
    ],
  }),
  hideNotice: () => hideCanvasGuide("app-update"),
});
appUpdateController.start();

const accountSession = new AccountSessionFeature({
  auth: {
    nodes,
    links,
    getProjectId: () => foundation.projectId,
    setProjectId: (id) => { foundation.projectId = id; },
    getLoadedProjectId: () => canvasPersistence.loadedProjectId,
    isSaveBlocked: () => canvasPersistence.blocked,
    getServerVersion: () => canvasPersistence.serverVersion,
    ensureRenderer: () => renderingRuntime.render.ensure(),
    stopSave: (logout) => canvasPersistence.stopAndReset(logout),
    resetNodeLease: () => canvasNodeIds.reset(),
    loadCanvas: (keepStatus) => loadCanvas(keepStatus),
    loadAssets: () => assetRuntime.load(false),
    apiFetch,
    resize,
    clearSelection: () => { selection.selectedId = 0; },
    registerUserMenu: (close) => topbarMenus.register("user", close),
    closeTopbarMenus: (opening) => closeTopbarMenus(opening ? "user" : undefined),
    notify: (message, type, detail) => showToast(message, type, detail),
  },
  notifications: {
    registerTopbarMenu: (close) => topbarMenus.register("notifications", close),
    closeNotificationMenus: (opening) =>
      closeTopbarMenus(opening ? "notifications" : undefined),
    closePresenceMenus: (opening) =>
      closeTopbarMenus(opening ? "presence" : undefined),
    showGuide: showCanvasGuide,
    hideGuide: hideCanvasGuide,
    isGuideVisible: (key) => canvasFeedback.isGuideVisible(key),
    checkAppUpdate: () => void appUpdateController.checkNow(),
    restoreAfterReconnect: () => void creationSuite.comic.restoreAfterReconnect(),
    toast: (message, type) => showToast(message, type),
  },
  account: {
    getProjectId: () => foundation.projectId,
    refreshNodeModels: refreshNodeModelMenus,
    toast: (message, type) => showToast(message, type),
  },
});
const authWorkspace = accountSession.auth;
const accountTools = accountSession.account;
function showCanvasModeNotice(title: string, detail: string) {
  canvasFeedback.showModeNotice(title, detail);
}
function refreshNodeModelMenus() {
  nodeLayer
    .querySelectorAll(".flow-node")
    .forEach((element) => element.remove());
  draw();
}
authWorkspace.applyRoute();

const screen = (point: Point) => renderingRuntime.screen(point);
const world = (point: Point) => renderingRuntime.world(point);
function canvasInteractionActive() {
  return Boolean(pointer.down || domPointer.drag || interaction.marquee?.active || touchPinch.active);
}
function hitNode(sx: number, sy: number) {
  return renderingRuntime.connection.hitNode(sx, sy);
}
function updateConnectionPointer(sx: number, sy: number) {
  renderingRuntime.connection.updatePointer(sx, sy);
}
function stopConnectionAutoPan() { renderingRuntime.connection.stopAutoPan(); }
function startConnectionAutoPan(sx: number, sy: number) { renderingRuntime.connection.startAutoPan(sx, sy); }
function hitLink(sx: number, sy: number, tolerance = 9) {
  return renderingRuntime.connection.hitLink(sx, sy, tolerance);
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
  agentIds: () => creationSuite.prompt.selectedIds,
  dark: () => colorTheme === "dark",
  backgroundMode: () => backgroundMode,
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
  confirmDelete: async (input) => Boolean(await assetRuntime.ask(input)),
  notify: (message, tone) => showToast(message, tone),
  guide: showCanvasGuide,
  hideGuide: hideCanvasGuide,
  undo: () => canvasHistory.undo(),
});
function addNode(
  kind: NodeKind = "image",
  position?: Point,
  deferRender = false,
) {
  nodeRuntime.add(kind, position, deferRender);
}
function addMediaNode(
  url: string,
  title: string,
  position = foundation.contextPosition,
  kind: "image" | "video" = "image",
) {
  nodeRuntime.addMedia(url, title, position, kind);
}

function enterTextEdit(node: FlowNode, element: HTMLElement) {
  nodeRuntime.beginTextEdit(node, element);
}

function openNodeInfo(node: FlowNode) {
  nodeRuntime.editor.openInfo(node);
}
function closeNodeInfo() {
  nodeRuntime.editor.closeInfo();
}

function updateEditor() {
  nodeRuntime.editor.update();
}

function updateNodeJobProgressUi(node: FlowNode) {
  nodeRuntime.editor.updateProgress(node);
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

generationRuntime = new CanvasGenerationRuntimeFeature({
  generation: {
    nodes,
    links,
    imageCache,
    jobLabel,
    getSelectedId: () => selection.selectedId,
    setSelectedId: (id) => { selection.selectedId = id; },
    selectedNode: () => nodeRuntime.editor.selected(),
    blockedReason: (node) => nodeRuntime.editor.blockedReason(node),
    normalizePrompt: normalizePromptText,
    getProjectId: () => foundation.projectId,
    allocateNodeId: () => canvasNodeIds.allocate(),
    clearSelection: () => {
      selection.selectedId = 0;
      updateEditor();
      draw();
    },
    updateEditor,
    draw,
    save: scheduleSave,
    focusPrompt: () => promptInput.focus(),
    generateTts: (node) => ttsFeature.generate(node),
    getUser: () => authWorkspace.user,
    setUser: (user) => authWorkspace.setUser(user),
    renderUser: () => authWorkspace.renderUser(),
    refreshModelMenus: refreshNodeModelMenus,
    loadAssets: () => assetRuntime.load(false),
    renderAssets: () => assetRuntime.render(),
    isAssetPanelOpen: () => Boolean(
      document.querySelector("#assets-panel")?.classList.contains("open"),
    ),
    toast: (message, tone, detail) => showToast(message, tone, detail),
  },
  canGenerate: (node) => nodeRuntime.editor.canGenerate(node),
  onProgress: (node, _job, changed) => {
    if (changed) updateNodeJobProgressUi(node);
  },
  onRetry: () => showToast("首次生成请求超时，正在自动重试一次", "warning"),
  onSyncFailure: (_failures, notify) => {
    jobLabel.textContent = "状态同步中断，正在重试…";
    if (notify) showToast("任务状态暂时无法同步，服务恢复后将自动重试", "error");
  },
});
function generate(sourceOverride?: FlowNode) {
  return generationRuntime.generate(sourceOverride);
}

const canvasControls: CanvasControlsFeature = new CanvasControlsFeature({
  link: {
    canvas, links, connection,
    pointerDown: () => pointer.down,
    multiSelect: () => selection.multiSelectMode,
    hitLink,
    generationActive: () => nodeRuntime.lifecycle.hasActiveGeneration(),
    contextSuppressed: marqueeController.isContextSuppressed,
    save: scheduleSave,
    draw,
    notify: (message, type) => showToast(message, type),
  },
  toolbar: {
    zoomSlider,
    viewportCenter: () => ({ x: innerWidth / 2, y: innerHeight / 2 }),
    fit: cameraViewport.fit,
    setZoom: (zoom, anchor) => cameraViewport.setImmediate(zoom, anchor),
    zoomBy: cameraViewport.smoothBy,
    addNode: (kind) => addNode(kind),
    generate: () => { void generate(); },
    deleteSelected: () => { void nodeRuntime.lifecycle.deleteSelected(); },
  },
  quickMenu: {
    canvas,
    connectionActive: () => Boolean(connection.active),
    hitNode,
    selectNode: (node) => {
      selection.selectedId = node.id;
      updateEditor();
      draw();
    },
    previewNode: (node) =>
      assetRuntime.openPreview(node.mediaUrl!, node.title, node.kind as "image" | "video"),
    editPromptNode: (node) => {
      const element = nodeLayer.querySelector<HTMLElement>(`.flow-node[data-id="${node.id}"]`);
      if (element) enterTextEdit(node, element);
    },
    multiSelectActive: () => selection.multiSelectMode,
    exitMultiSelect: () => marqueeController.exit(),
    enterMultiSelect: () => marqueeController.enter(),
    toWorld: world,
    addNode: (kind, position) => addNode(kind, position),
    uploadAt: (position) => assetRuntime.openUploadAt(position),
  },
  appearance: {
    pendingMedia: () => pendingMediaLoads.size,
    currentTheme: () => colorTheme,
    applyTheme: (theme) => {
      colorTheme = theme;
      document.body.dataset.theme = colorTheme;
      localStorage.setItem("flow-theme", colorTheme);
    },
    repaintMedia: canvasMedia.repaintAll,
    paint,
  },
});
const quickNodeMenu = canvasControls.quickMenu;
creationSuite = new CanvasCreationSuiteFeature({
  prompt: {
    nodes,
    links,
    nodeLayer,
    camera,
    getSelectedId: () => selection.selectedId,
    setSelectedId: (id) => { selection.selectedId = id; },
    worldCenter: () => world({ x: innerWidth / 2, y: innerHeight / 2 }),
    addNode,
    updateEditor,
    persist: scheduleSave,
    draw,
    runWorkflow: () => generationRuntime.run(),
    loadVoices: (providerId) => { void ttsFeature.loadVoices(providerId); },
    decodePrompt: decodePromptClipboardText,
    toast: (message, tone) => showToast(message, tone),
  },
  comic: {
    nodes,
    getProjectId: () => foundation.projectId,
    getUserId: () => authWorkspace.user?.id,
    hasAuthenticatedContext: () => Boolean(authWorkspace.user && foundation.projectId),
    ensureProject: () => authWorkspace.ensureCurrentProject(),
    isMultiSelect: () => selection.multiSelectMode,
    exitMultiSelect: () => marqueeController.exit(),
    resetMarqueeGesture: () => marqueeController.resetRightGesture(),
    createLabel: () => {
      const center = world({ x: innerWidth / 2, y: innerHeight / 2 });
      const rightEdge = nodes.length
        ? Math.max(...nodes.map((node) => node.x + node.width))
        : center.x - 220;
      addNode("prompt", { x: rightEdge + 180, y: center.y - 280 });
      return nodes.find((node) => node.id === selection.selectedId);
    },
    persistCanvas: scheduleSave,
    draw,
    startEmptyImages: () => canvasTasks.startAllEmpty(),
    showGuide: showCanvasGuide,
    hideGuide: (key) => hideCanvasGuide(key),
    clientLog,
    toast: (message, tone, detail) => showToast(message, tone, detail),
  },
});
assetRuntime = new WorkspaceAssetsRuntimeFeature({
  nodes,
  getProjectId: () => foundation.projectId,
  setProjectId: (id) => { foundation.projectId = id; },
  getLoadedProjectId: () => canvasPersistence.loadedProjectId,
  center: () => world({ x: innerWidth / 2, y: innerHeight / 2 }),
  addMedia: addMediaNode,
  selectNode: (id) => { selection.selectedId = id; },
  saveCanvas,
  scheduleSave,
  stopSave: () => canvasPersistence.stopAndReset(),
  resetNodeLease: () => canvasNodeIds.reset(),
  loadCanvas: () => loadCanvas(),
  closeComic: () => creationSuite.comic.close(),
  resetComic: () => creationSuite.comic.reset(true),
  unlinkComicLabel: () => creationSuite.comic.unlinkLabel(),
  invalidateShowcase: () => authWorkspace.invalidateShowcase(),
  deleteCachedImage: (url) => { imageCache.delete(url); },
  updateEditor,
  draw,
  closeTopbarMenus: (opening) => closeTopbarMenus(opening ? "workspace" : undefined),
  registerWorkspaceMenu: (close) => topbarMenus.register("workspace", close),
  toast: (message, tone, detail) => showToast(message, tone, detail),
});
function refreshLocalImageAvailabilityUI() {
  /* 本地 Provider 暂不在模型列表展示 */
}
function loadGenerationCapabilities(redraw = false) {
  return workspaceRuntime.loadCapabilities(redraw);
}
const workspaceRuntime = new WorkspaceRuntimeFeature<AuthUser>({
  capabilities: {
    current: () => generationCapabilities,
    apply: (capabilities) => { generationCapabilities = capabilities; },
    availabilityChanged: () => {
      refreshLocalImageAvailabilityUI();
      draw();
    },
  },
  bootstrap: {
    apiFetch,
    setUser: (user) => authWorkspace.setUser(user),
    user: () => authWorkspace.user,
    setReady: () => authWorkspace.markReady(),
    renderUser: () => authWorkspace.renderUser(),
    touchSession: () => authWorkspace.touch(),
    loadCapabilities: () => Promise.resolve(),
    synchronizeCanvas: () => authWorkspace.synchronize(true),
    loadAssets: () => assetRuntime.load(false),
    status: (message, visible) => authWorkspace.status(message, visible),
    randomizeTheme: authWorkspace.randomizeTheme,
    applyRoute: () => authWorkspace.applyRoute(),
    notifyError: (message) => showToast(message, "error"),
  },
  overlay: {
    quickMenu: quickNodeMenu,
    closeQuickMenu: () => canvasControls.closeQuickMenu(),
    closeAssetContextIfOutside: (target) => assetRuntime.closeContextIfOutside(target),
  },
  keyboard: {
    closeQuickMenu: () => {
      if (!quickNodeMenu.classList.contains("open")) return false;
      canvasControls.closeQuickMenu();
      return true;
    },
    closeNodeInfo: () => {
      if (!document.querySelector<HTMLElement>("#node-info-modal")!.classList.contains("open")) return false;
      closeNodeInfo();
      return true;
    },
    closeAssetPreview: () => {
      if (!assetRuntime.isPreviewOpen) return false;
      assetRuntime.closePreview();
      return true;
    },
    undo: () => { void canvasHistory.undo(); },
    redo: () => { void canvasHistory.redo(); },
    deleteSelected: () => { void nodeRuntime.lifecycle.deleteSelected(); },
  },
});
workspaceRuntime.start(resize, updateEditor);
