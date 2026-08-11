import "../style.css";
import { CanvasRenderFeature } from "../canvas/canvas-render-feature";
import { CanvasPersistenceFeature } from "../canvas/canvas-persistence-feature";
import { CanvasConnectionFeature } from "../canvas/canvas-connection-feature";
import { CanvasStore } from "../canvas/store";
import { CanvasSelectionController } from "../canvas/selection-controller";
import { CanvasConnectionController } from "../canvas/connection-controller";
import { CanvasInteractionController } from "../canvas/interaction-controller";
import { CanvasInputFeature } from "../canvas/canvas-input-feature";
import { CanvasBatchFeature } from "../canvas/canvas-batch-feature";
import { CanvasHistoryFeature } from "../canvas/canvas-history-feature";
import { CanvasNodeIdAllocator } from "../services/canvas-node-id-allocator";
import { CanvasMediaFeature } from "../canvas/canvas-media-feature";
import type {
  FlowLink,
  FlowNode,
  GenerationCapabilities,
  NodeKind,
  Point,
} from "../nodes/node-types";
import { NodeLifecycleController, defaultNodeCopy } from "../nodes/node-lifecycle-controller";
import { GenerationGraph } from "../nodes/generation-graph";
import { decodePromptClipboardText, normalizePromptText } from "../nodes/prompt-text";
import { downloadNodeImage as downloadNodeImageFile } from "../nodes/node-download";
import { PromptNodeController } from "../nodes/prompt-node";
import { CanvasNodeEditorFeature } from "../nodes/canvas-node-editor-feature";
import { TtsFeature } from "../services/tts-feature";
import { apiFetch } from "../services/api";
import { AppUpdateController } from "../services/app-update-controller";
import { GenerationCapabilitiesController } from "../services/generation-capabilities-controller";
import { CanvasGenerationRuntimeFeature } from "../services/canvas-generation-runtime-feature";
import { ClientDiagnostics } from "../services/client-diagnostics";
import {
  clipVideoPrompt,
  composeStoryboardPrompt,
  fitVideoDialogue,
  inferAnonymousCrowd,
  speechSegments,
} from "../nodes/video-node";
import { inferVoiceConfig } from "../nodes/voice-node";
import { bindNodeConfigPanel } from "../ui/node-editor";
import { WorkspaceAssetsFeature } from "../ui/workspace-assets-feature";
import { WorkspaceOverlayController } from "../ui/workspace-overlay-controller";
import { WorkspaceKeyboardController } from "../ui/workspace-keyboard-controller";
import { CanvasTaskFeature } from "../ui/canvas-task-feature";
import { TopbarMenuCoordinator } from "../ui/topbar-menu-coordinator";
import { CanvasControlsFeature } from "../ui/canvas-controls-feature";
import type { CanvasGuideMessage } from "../ui/canvas-guide-controller";
import type { ToastType } from "../ui/toast-controller";
import { CanvasFeedbackFeature } from "../ui/canvas-feedback-feature";
import {
  createProjectDialog,
} from "../ui/dialogs/project-dialog";
import type { AuthUser } from "../ui/user-menu-controller";
import { NotificationFeature } from "../ui/notification-feature";
import { AccountToolsFeature } from "../ui/account-tools-feature";
import { PromptAgentFeature } from "../ui/prompt-agent-feature";
import { ComicStudioFeature } from "../ui/comic-studio-feature";
import { CanvasNodeViewFeature } from "../nodes/canvas-node-view-feature";
import { createDefaultGenerationCapabilities } from "./state";
import { ApplicationBootstrapController } from "./application-bootstrap-controller";
import { AuthWorkspaceFeature } from "./auth-workspace-feature";
import {
  connectionControlPoint,
  nodePortPosition,
  screenToWorld,
  worldToScreen,
} from "../canvas/camera-controller";

let canvasRender: CanvasRenderFeature;

let generationCapabilities: GenerationCapabilities =
  createDefaultGenerationCapabilities();
let generationRuntime: CanvasGenerationRuntimeFeature;
let nodeEditorFeature: CanvasNodeEditorFeature;
function loadTtsProviders() {
  return ttsFeature.loadProviders();
}
function loadTtsVoices(providerId = "easyvoice-local") {
  return ttsFeature.loadVoices(providerId);
}
const canvas = document.querySelector<HTMLElement>("#canvas")!;
const nodeViewport = document.querySelector<HTMLElement>("#node-viewport")!;
const nodeLayer = document.querySelector<HTMLElement>("#node-layer")!;
const zoomSlider = document.querySelector<HTMLInputElement>("#zoom-slider")!;
const zoomPercent = document.querySelector<HTMLOutputElement>("#zoom-percent")!;
const nodeCount = document.querySelector<HTMLSpanElement>("#node-count")!;
const titleInput = document.querySelector<HTMLInputElement>("#node-title")!;
const promptInput =
  document.querySelector<HTMLTextAreaElement>("#node-prompt")!;
const modelInput = document.querySelector<HTMLSelectElement>("#node-model")!;
const saveState = document.querySelector<HTMLSpanElement>("#save-state")!;
document.querySelector<HTMLElement>(".brand")!.append(saveState);
const resetButton = document.querySelector<HTMLElement>("#reset")!;
const jobLabel = document.querySelector<HTMLSpanElement>("#job-label")!;
const jobProgress = document.querySelector<HTMLElement>("#job-progress")!;
const generateButton = document.querySelector<HTMLButtonElement>("#generate")!;
const canvasStore = new CanvasStore<FlowNode, FlowLink>({
    x: 80,
    y: 10,
    zoom: 0.9,
  }),
  camera = canvasStore.camera;
const interaction = new CanvasInteractionController(),
  pointer = interaction.pointer;
const selection = new CanvasSelectionController();
let videoReferenceSwapSelection: { videoId: number; sourceId: number } | null =
  null;
const promptNodeEditor = new PromptNodeController();
let contextPosition: Point = { x: 0, y: 0 };
const connection = new CanvasConnectionController();
let connectionFeature: CanvasConnectionFeature;
let canvasPersistence: CanvasPersistenceFeature;
let currentProjectId = localStorage.getItem("flow-project-id") ?? "default";
const canvasNodeIds = new CanvasNodeIdAllocator({
  projectId: () => currentProjectId,
  notifyExhausted: () => showToast("正在扩展节点编号空间，请稍后重试", "warning"),
});
const canvasSyncClientId = (() => {
  const existing = sessionStorage.getItem("flow-canvas-client-id");
  if (existing) return existing;
  const id = `client_${crypto.randomUUID().replaceAll("-", "")}`;
  sessionStorage.setItem("flow-canvas-client-id", id);
  return id;
})();
async function reserveCanvasNodeIds(projectId = currentProjectId) {
  return canvasNodeIds.reserve(projectId);
}
function allocateCanvasNodeId() {
  return canvasNodeIds.allocate();
}
let backgroundMode: "dots" | "lines" | "blank" = "lines";
let colorTheme: "light" | "dark" =
  localStorage.getItem("flow-theme") === "light" ? "light" : "dark";
document.body.dataset.theme = colorTheme;
const clientDiagnostics = new ClientDiagnostics();
const clientLog = (event: string, details: unknown = {}) =>
  clientDiagnostics.log(event, details);
clientDiagnostics.bindGlobalErrors();
const interruptedThemeTransition = sessionStorage.getItem(
  "flow-theme-transition-inflight",
);
if (interruptedThemeTransition) {
  sessionStorage.removeItem("flow-theme-transition-inflight");
  try {
    clientLog(
      "theme-transition-interrupted",
      JSON.parse(interruptedThemeTransition),
    );
  } catch {
    clientLog("theme-transition-interrupted", {
      raw: interruptedThemeTransition,
    });
  }
}
function syncDraggedNodeElements(ids: Iterable<number>) {
  for (const id of ids) {
    const node = nodes.find((item) => item.id === id),
      element = nodeLayer.querySelector<HTMLElement>(`.flow-node[data-id="${id}"]`);
    if (node && element) element.style.transform = `translate(${node.x}px, ${node.y}px)`;
  }
}
const nodes = canvasStore.nodes;
const links = canvasStore.links;
const canvasTasks = new CanvasTaskFeature<AuthUser>({
  nodes,
  links,
  resetButton,
  canGenerate: canGenerateNode,
  modelName: modelDisplayName,
  projectId: () => currentProjectId,
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
  ask: async (options) => (await askProjectDialog(options)) === true,
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
  getProjectId: () => currentProjectId,
  getNextId: () => canvasNodeIds.nextId,
  setNextId: (value) => { canvasNodeIds.nextId = value; },
  getSelectedId: () => selection.selectedId,
  setSelectedId: (value) => { selection.selectedId = value; },
  clearBatch: () => selection.batchIds.clear(),
  clearPromptEditing: () => { promptNodeEditor.editingId = 0; },
  generationActive: canvasHasActiveGeneration,
  updateEditor,
  draw,
  save: saveCanvas,
  toast: (message) => showToast(message, "warning"),
  showGuide: showCanvasGuide,
});
function resetCanvasHistory(restore = true) { canvasHistory.reset(restore); }
function queueCanvasHistory() { canvasHistory.queue(); }
function updateHistoryControls() { canvasHistory.refreshControls(); }
function undoCanvas() { return canvasHistory.undo(); }
function redoCanvas() { return canvasHistory.redo(); }
function startAllEmptyImages() {
  canvasTasks.startAllEmpty();
}
function updateTaskMonitor() {
  canvasTasks.update();
}
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
  generationActive: canvasHasActiveGeneration,
  enqueue: (ids) => generationRuntime.enqueue(ids),
  exitMode: exitMultiSelectMode,
  updateEditor,
  draw,
  save: scheduleSave,
  toast: (message, tone, detail) => showToast(message, tone, detail),
  confirm: (message) => window.confirm(message),
});
let promptAgentFeature: PromptAgentFeature;
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
  setEditing: () => setSaveState("editing", "编辑中…"),
  updateEditor,
  syncDraggedElements: syncDraggedNodeElements,
  refreshBatchSelection,
  clearBatchSelection,
  toggleBatchNode,
  refreshCanvasModeHint,
  showCanvasModeNotice,
  getAgentIds: () => promptAgentFeature.selectedIds,
  renderAgentSelection: () => promptAgentFeature.renderContext(false),
  warnAgentLimit: () => showToast("参考素材最多选择 8 个", "warning"),
  hasConnection: () => Boolean(connection.active),
  moveConnection: (event, syncDom) => {
    updateConnectionPointer(event.clientX, event.clientY);
    startConnectionAutoPan(event.clientX, event.clientY);
    draw(syncDom);
  },
  finishConnection: finishDomConnection,
  cancelConnection: () => {
    connection.cancel();
    stopConnectionAutoPan();
  },
  hitNode,
  moveNode: (id, dx, dy) => canvasStore.moveNodeById(id, dx, dy),
  panCamera: (dx, dy) => canvasStore.panCamera(dx, dy),
  closeQuickMenu: closeQuickNodeMenu,
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
  isAgentSelecting: () => promptAgentFeature.selecting,
  isAgentCreateMode: () => promptAgentFeature.controls.mode === "create",
  getAgentIds: () => promptAgentFeature.selectedIds,
  getColorTheme: () => colorTheme,
  getSwap: () => videoReferenceSwapSelection,
  setSwap: (value) => { videoReferenceSwapSelection = value; },
  getAuthUser: () => authWorkspace.user,
  getCustomModels: () => accountTools.models,
  getCapabilities: () => generationCapabilities,
  isGenerating: nodeIsActivelyGenerating,
  defaultCopy: defaultNodeCopy,
  getProviders: () => ttsFeature.catalog.providers,
  getVoices: () => ttsFeature.catalog.voicesByProvider,
  ensureProviders: loadTtsProviders,
  ensureVoices: loadTtsVoices,
  escapeHtml,
  normalizePrompt: normalizePromptText,
  displayModelName: modelDisplayName,
  decodePrompt: (value = "") => decodePromptClipboardText(value),
  canGenerate: canGenerateNode,
  updateEditor,
  draw,
  scheduleSave,
  commitHistory: queueCanvasHistory,
  setEditingState: () => setSaveState("editing", "编辑中…"),
  editPrompt: enterTextEdit,
  previewMedia: (node) =>
    openAssetPreview(node.mediaUrl!, node.title, node.kind as "image" | "video"),
  beginConnection: (nodeId, point) => connection.begin(nodeId, "right", point),
  showInfo: openNodeInfo,
  focusEditor: () => promptInput.focus(),
  generate,
  downloadImage: downloadNodeImage,
  deleteNode: () => { void deleteSelectedNode(); },
  confirmClearImage: async () => Boolean(await askProjectDialog({
    title: "清除当前卡片的图片？",
    description: "资产库中的原图不会删除。原提示词、当前描述、模型、图像设置和参考连线都会保留。",
    confirm: "清除图片",
  })),
  removeCachedImage: (url) => imageCache.delete(url),
  notifyImageCleared: (message) => showToast(message, "success"),
  beginImageUpload: beginImageNodeUpload,
  beginImageLibrary: beginImageNodeLibrary,
  previewVoice,
  generateTts,
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
  suspendRenderer: () => canvasRender.suspend(),
  resumeRenderer: () => canvasRender.resume(),
  clearNodeStates: () => nodeViews.clearStates(),
  invalidateNode: (id) => nodeViews.invalidateState(id),
  resize,
  draw,
  refreshAppearance: refreshAppearanceButton,
});
const pendingMediaLoads = canvasMedia.pendingLoads;
const imageCache = canvasMedia.cache;
document.addEventListener("selectstart", (event) => {
  if (document.body.classList.contains("home-mode")) return;
  const target = event.target instanceof Element ? event.target : null;
  if (
    target?.closest(
      'input,textarea,[contenteditable="true"],.image-original-prompt p,.video-result-prompt p,[data-agent-prompt],.app-toast details em,code',
    )
  )
    return;
  event.preventDefault();
});
function modelDisplayName(value?: string) {
  if (!value?.startsWith("custom:")) return value || "";
  return (
    accountTools.models.find((item) => `custom:${item.id}` === value)?.name ||
    "自定义模型"
  );
}
const canvasFeedback = new CanvasFeedbackFeature({
  escapeHtml,
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

let notificationFeature: NotificationFeature;
let accountTools: AccountToolsFeature;
let comicStudioFeature: ComicStudioFeature;
const authWorkspace: AuthWorkspaceFeature = new AuthWorkspaceFeature({
  nodes,
  links,
  getProjectId: () => currentProjectId,
  setProjectId: (id) => { currentProjectId = id; },
  getLoadedProjectId: () => canvasPersistence.loadedProjectId,
  isSaveBlocked: () => canvasPersistence.blocked,
  getServerVersion: () => canvasPersistence.serverVersion,
  ensureRenderer: () => canvasRender.ensure(),
  stopSave: (logout) => canvasPersistence.stopAndReset(logout),
  resetNodeLease: () => canvasNodeIds.reset(),
  loadCanvas: (keepStatus) => loadCanvas(keepStatus),
  loadAssets: () => loadAssets(false),
  loadModels: () => accountTools.loadModels(),
  apiFetch,
  resize,
  clearSelection: () => { selection.selectedId = 0; },
  registerUserMenu: (close) => topbarMenus.register("user", close),
  closeTopbarMenus: (opening) => closeTopbarMenus(opening ? "user" : undefined),
  onUserRendered: (user) => {
    if (user) {
      void notificationFeature.load();
      notificationFeature.connect();
    } else notificationFeature.disconnect();
  },
  notify: (message, type, detail) => showToast(message, type, detail),
});
notificationFeature = new NotificationFeature({
  getUserId: () => authWorkspace.user?.id,
  registerTopbarMenu: (close) => topbarMenus.register("notifications", close),
  closeNotificationMenus: (opening) =>
    closeTopbarMenus(opening ? "notifications" : undefined),
  closePresenceMenus: (opening) =>
    closeTopbarMenus(opening ? "presence" : undefined),
  showGuide: showCanvasGuide,
  hideGuide: hideCanvasGuide,
  isGuideVisible: (key) => canvasFeedback.isGuideVisible(key),
  checkAppUpdate: () => void appUpdateController.checkNow(),
  restoreAfterReconnect: () => void comicStudioFeature.restoreAfterReconnect(),
  toast: (message, type) => showToast(message, type),
});
function showCanvasModeNotice(title: string, detail: string) {
  canvasFeedback.showModeNotice(title, detail);
}
accountTools = new AccountToolsFeature({
  getUser: () => authWorkspace.user,
  setUser: (user) => authWorkspace.setUser(user),
  getProjectId: () => currentProjectId,
  closeUserMenu: () => authWorkspace.userMenu.close(),
  onCreditsChanged: () => {
    authWorkspace.renderUser();
    refreshNodeModelMenus();
  },
  refreshNodeModels: refreshNodeModelMenus,
  toast: (message, type) => showToast(message, type),
});
function refreshNodeModelMenus() {
  nodeLayer
    .querySelectorAll(".flow-node")
    .forEach((element) => element.remove());
  draw();
}
authWorkspace.applyRoute();

const viewportSize = () => ({ width: innerWidth, height: innerHeight });
const screen = (point: Point) =>
  worldToScreen(point, camera, viewportSize());
const world = (point: Point) =>
  screenToWorld(point, camera, viewportSize());
const portWorld = nodePortPosition;
const controlPoint = connectionControlPoint;
const generationGraph = new GenerationGraph(nodes, links);
function nodeIsActivelyGenerating(node: FlowNode | undefined) {
  return generationGraph.isActive(node);
}
function canvasHasActiveGeneration() {
  return generationGraph.hasActiveGeneration();
}
function orderedImageInputs(targetId: number) {
  return generationGraph.orderedImageInputs(targetId);
}
function imageInputOrder(link: FlowLink) {
  return generationGraph.imageInputOrder(link);
}
function orderedTargetLinks(targetId: number) {
  return generationGraph.orderedTargetLinks(targetId);
}
connectionFeature = new CanvasConnectionFeature({
  nodes,
  links,
  camera,
  spatialIndex: nodeViews.spatialIndex,
  connection,
  world,
  screen,
  portWorld,
  save: scheduleSave,
  draw,
  notify: (message) => showToast(message, "warning"),
});
canvasStore.subscribe((change) => {
  if (change.type === "node-position")
    change.nodeIds.forEach((id) => {
      const node = nodes.find((candidate) => candidate.id === id);
      if (node) nodeViews.spatialIndex.update(node);
    });
  else if (change.type === "structure") nodeViews.spatialIndex.rebuild(nodes);
});
function rebuildPaintIndexes() {
  connectionFeature.rebuild();
}
function canvasInteractionActive() {
  return Boolean(pointer.down || domPointer.drag || interaction.marquee?.active || touchPinch.active);
}
function hitNode(sx: number, sy: number) {
  return connectionFeature.hitNode(sx, sy);
}
function hitPort(sx: number, sy: number, radius = 12, excludeNodeId?: number) {
  return connectionFeature.hitPort(sx, sy, radius, excludeNodeId);
}
function updateConnectionPointer(sx: number, sy: number) {
  connectionFeature.updatePointer(sx, sy);
}
function stopConnectionAutoPan() { connectionFeature.stopAutoPan(); }
function startConnectionAutoPan(sx: number, sy: number) { connectionFeature.startAutoPan(sx, sy); }
function hitLink(sx: number, sy: number, tolerance = 9) {
  return connectionFeature.hitLink(sx, sy, tolerance);
}
canvasRender = new CanvasRenderFeature({
  viewport: nodeViewport,
  zoomSlider,
  zoomPercent,
  nodeCount,
  viewportSize: () => ({ width: innerWidth, height: innerHeight }),
  camera: () => camera,
  interacting: canvasInteractionActive,
  state: () => {
  const pendingNode = connection.active
    ? connectionFeature.geometry.nodeIndex.get(connection.active.nodeId) ??
      nodes.find((node) => node.id === connection.active!.nodeId)
    : undefined;
    return {
    nodes,
    links,
    nodeCount: nodes.length,
    indexedNodeCount: connectionFeature.geometry.nodeIndex.size,
    domNodeIds: [...nodeViews.mountedIds],
    camera,
    selectedId: selection.selectedId,
    selectedIds: [
      ...new Set([...selection.batchIds, ...promptAgentFeature.selectedIds]),
    ],
    dark: colorTheme === "dark",
    backgroundMode,
    hoveredLinkIndex: connection.hoveredLinkIndex,
    touchSelectedLinkIndex: connection.touchSelectedLinkIndex,
    pendingConnection: connection.active && pendingNode
      ? {
          from: screen(portWorld(pendingNode, connection.active.side)),
          to: connection.active.pointer,
          fromSide: connection.active.side,
          snapped: Boolean(connection.snap),
        }
      : undefined,
    };
  },
  rebuildIndexes: rebuildPaintIndexes,
  syncDom: () => nodeViews.sync(),
  warmEditors: () => nodeViews.scheduleWarmup(),
  updateTasks: updateTaskMonitor,
  updateHistory: updateHistoryControls,
  log: clientLog,
});
function paint() { canvasRender.paint(); }
function draw(syncDom = true) { canvasRender.draw(syncDom); }
function resize() {
  draw();
}
const nodeLifecycle = new NodeLifecycleController({
  nodes,
  links,
  allocateId: allocateCanvasNodeId,
  capabilities: () => generationCapabilities,
  center: () => world({ x: innerWidth / 2, y: innerHeight / 2 }),
  selectedId: () => selection.selectedId,
  select: (id) => { selection.selectedId = id; },
  batchIds: selection.batchIds,
  updateEditor,
  save: scheduleSave,
  draw,
  hasActiveGeneration: canvasHasActiveGeneration,
  cascadeIds: cascadeSelectionIds,
  confirmDelete: async (input) => Boolean(await askProjectDialog(input)),
  notify: (message, tone) => showToast(message, tone),
  guide: showCanvasGuide,
  hideGuide: hideCanvasGuide,
  undo: undoCanvas,
});
function addNode(
  kind: NodeKind = "image",
  position?: Point,
  deferRender = false,
) {
  nodeLifecycle.add(kind, position, deferRender);
}
function addMediaNode(
  url: string,
  title: string,
  position = contextPosition,
  kind: "image" | "video" = "image",
) {
  nodeLifecycle.addMedia(url, title, position, kind);
}

function enterTextEdit(node: FlowNode, element: HTMLElement) {
  nodeEditorFeature.beginTextEdit(node, element);
}

function openNodeInfo(node: FlowNode) {
  nodeEditorFeature.openInfo(node);
}
function closeNodeInfo() {
  nodeEditorFeature.closeInfo();
}

function finishDomConnection(event: PointerEvent) {
  connectionFeature.finish(event);
}
async function deleteSelectedNode() {
  await nodeLifecycle.deleteSelected();
}

function selectedNode() {
  return nodeEditorFeature.selected();
}
function canGenerateNode(node: FlowNode) {
  return nodeEditorFeature.canGenerate(node);
}
function generationBlockedReason(node: FlowNode) {
  return nodeEditorFeature.blockedReason(node);
}
nodeEditorFeature = new CanvasNodeEditorFeature({
  nodes,
  promptEditor: promptNodeEditor,
  titleInput,
  promptInput,
  modelInput,
  generateButton,
  jobLabel,
  jobProgress,
  nodeLayer,
  infoModal: document.querySelector<HTMLElement>("#node-info-modal")!,
  getSelectedId: () => selection.selectedId,
  getAvailableCredits: () =>
    Number(authWorkspace.user?.credits ?? 0) - Number(authWorkspace.user?.reservedCredits ?? 0),
  hasConnectedVoice: (node) => Boolean(connectedVoiceNode(node)),
  activelyGenerating: nodeIsActivelyGenerating,
  pixiActive: canvasRender.active,
  setEditingState: () => setSaveState("editing", "编辑中…"),
  draw,
  save: scheduleSave,
  updateTasks: updateTaskMonitor,
});
function updateEditor() {
  nodeEditorFeature.update();
}

function updateNodeJobProgressUi(node: FlowNode) {
  nodeEditorFeature.updateProgress(node);
}

function scheduleSave(recordHistory = true) {
  canvasPersistence.schedule(queueCanvasHistory, recordHistory);
}

function saveCanvas() { return canvasPersistence.save(); }
function setSaveState(
  state: "editing" | "saving" | "saved" | "error",
  label: string,
) {
  saveState.dataset.state = state;
  saveState.textContent = label;
}

canvasPersistence = new CanvasPersistenceFeature({
  clientId: canvasSyncClientId,
  nodes,
  links,
  camera,
  authenticated: () => Boolean(authWorkspace.user),
  getProjectId: () => currentProjectId,
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
  reserveIds: (projectId) => reserveCanvasNodeIds(projectId),
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
  setState: setSaveState,
  updateEditor,
  draw,
  resetHistory: resetCanvasHistory,
  queueHistory: queueCanvasHistory,
  pollJob,
  runWorkflow: runAgentWorkflow,
  clearButton: document.querySelector<HTMLElement>("#dock-clear")!,
  notifyClear: (count) => showToast(`已清除画布内容，保留 ${count} 个标签`, "success"),
  toast: (message, tone, detail) => showToast(message, tone, detail),
});
function loadCanvas(keepLoadingStatus = false) {
  return canvasPersistence.load(keepLoadingStatus);
}

const ttsFeature = new TtsFeature({
  nodes,
  links,
  getProjectId: () => currentProjectId,
  allocateNodeId: allocateCanvasNodeId,
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
  reloadAssets: () => loadAssets(false),
  toast: (message, tone) => showToast(message, tone),
});
function connectedVoiceNode(source: FlowNode) {
  return ttsFeature.connectedVoice(source);
}
function previewVoice(voice: FlowNode) {
  return ttsFeature.preview(voice);
}
function generateTts(source: FlowNode) {
  return ttsFeature.generate(source);
}
generationRuntime = new CanvasGenerationRuntimeFeature({
  generation: {
    nodes,
    links,
    imageCache,
    jobLabel,
    getSelectedId: () => selection.selectedId,
    setSelectedId: (id) => { selection.selectedId = id; },
    selectedNode,
    blockedReason: generationBlockedReason,
    normalizePrompt: normalizePromptText,
    getProjectId: () => currentProjectId,
    allocateNodeId: allocateCanvasNodeId,
    clearSelection: () => {
      selection.selectedId = 0;
      updateEditor();
      draw();
    },
    updateEditor,
    draw,
    save: scheduleSave,
    focusPrompt: () => promptInput.focus(),
    generateTts,
    getUser: () => authWorkspace.user,
    setUser: (user) => authWorkspace.setUser(user),
    renderUser: () => authWorkspace.renderUser(),
    refreshModelMenus: refreshNodeModelMenus,
    loadAssets: () => loadAssets(false),
    renderAssets,
    isAssetPanelOpen: () => Boolean(
      document.querySelector("#assets-panel")?.classList.contains("open"),
    ),
    toast: (message, tone, detail) => showToast(message, tone, detail),
  },
  canGenerate: canGenerateNode,
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
function runAgentWorkflow() { generationRuntime.run(); }
function pollJob(node: FlowNode) { generationRuntime.poll(node); }
function refreshBatchSelection() {
  canvasBatch.refresh();
}
function clearBatchSelection() {
  canvasBatch.clear();
}
function toggleBatchNode(id: number) {
  canvasBatch.toggle(id);
}
function refreshCanvasModeHint() {
  canvasBatch.refreshModeHint();
}
function enterMultiSelectMode() { marqueeController.enter(); }
function exitMultiSelectMode() { marqueeController.exit(); }
function resetMarqueeRightGesture() { marqueeController.resetRightGesture(); }
function cascadeSelectionIds(seed: Set<number>) {
  return canvasBatch.cascade(seed);
}

const canvasControls: CanvasControlsFeature = new CanvasControlsFeature({
  link: {
    canvas, links, connection,
    pointerDown: () => pointer.down,
    multiSelect: () => selection.multiSelectMode,
    hitLink,
    generationActive: canvasHasActiveGeneration,
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
    deleteSelected: () => { void deleteSelectedNode(); },
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
      openAssetPreview(node.mediaUrl!, node.title, node.kind as "image" | "video"),
    editPromptNode: (node) => {
      const element = nodeLayer.querySelector<HTMLElement>(`.flow-node[data-id="${node.id}"]`);
      if (element) enterTextEdit(node, element);
    },
    multiSelectActive: () => selection.multiSelectMode,
    exitMultiSelect: exitMultiSelectMode,
    enterMultiSelect: enterMultiSelectMode,
    toWorld: world,
    addNode: (kind, position) => addNode(kind, position),
    uploadAt: openAssetUploadAt,
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
function closeQuickNodeMenu() { canvasControls.closeQuickMenu(); }
function refreshAppearanceButton() { canvasControls.refreshAppearance(); }
promptAgentFeature = new PromptAgentFeature({
  nodes,
  links,
  nodeLayer,
  camera,
  getSelectedId: () => selection.selectedId,
  setSelectedId: (id) => { selection.selectedId = id; },
  worldCenter: () => world({ x: innerWidth / 2, y: innerHeight / 2 }),
  addNode,
  onComic: () => comicStudioFeature.open(),
  updateEditor,
  persist: scheduleSave,
  draw,
  runWorkflow: runAgentWorkflow,
  loadVoices: (providerId) => { void loadTtsVoices(providerId); },
  decodePrompt: decodePromptClipboardText,
  toast: (message, tone) => showToast(message, tone),
});
comicStudioFeature = new ComicStudioFeature({
  nodes,
  promptPanel: promptAgentFeature.panel,
  getProjectId: () => currentProjectId,
  getUserId: () => authWorkspace.user?.id,
  hasAuthenticatedContext: () => Boolean(authWorkspace.user && currentProjectId),
  ensureProject: () => authWorkspace.ensureCurrentProject(),
  getSelectedContexts: () => promptAgentFeature.selectedNodes(),
  isMultiSelect: () => selection.multiSelectMode,
  exitMultiSelect: exitMultiSelectMode,
  resetMarqueeGesture: resetMarqueeRightGesture,
  closePromptAgent: () => promptAgentFeature.close(),
  applyPlan: (result) => promptAgentFeature.application.applyPlan(result),
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
  startEmptyImages: startAllEmptyImages,
  showGuide: showCanvasGuide,
  hideGuide: (key) => hideCanvasGuide(key),
  clientLog,
  toast: (message, tone, detail) => showToast(message, tone, detail),
});
const projectDialog = document.querySelector<HTMLElement>("#project-dialog")!;
const askProjectDialog = createProjectDialog(projectDialog);
const workspaceAssets = new WorkspaceAssetsFeature({
  nodes,
  getProjectId: () => currentProjectId,
  setProjectId: (id) => { currentProjectId = id; },
  getLoadedProjectId: () => canvasPersistence.loadedProjectId,
  center: () => world({ x: innerWidth / 2, y: innerHeight / 2 }),
  addMedia: addMediaNode,
  selectNode: (id) => { selection.selectedId = id; },
  saveCanvas,
  scheduleSave,
  stopSave: () => canvasPersistence.stopAndReset(),
  resetNodeLease: () => canvasNodeIds.reset(),
  loadCanvas: () => loadCanvas(),
  closeComic: () => comicStudioFeature.close(),
  resetComic: () => comicStudioFeature.reset(true),
  unlinkComicLabel: () => comicStudioFeature.unlinkLabel(),
  invalidateShowcase: () => authWorkspace.invalidateShowcase(),
  deleteCachedImage: (url) => { imageCache.delete(url); },
  updateEditor,
  draw,
  closeTopbarMenus: (opening) => closeTopbarMenus(opening ? "workspace" : undefined),
  registerWorkspaceMenu: (close) => topbarMenus.register("workspace", close),
  ask: askProjectDialog,
  toast: (message, tone, detail) => showToast(message, tone, detail),
});
function openAssetUploadAt(position: Point | null = null) {
  workspaceAssets.openUploadAt(position);
}
function beginImageNodeUpload(nodeId: number) {
  workspaceAssets.beginNodeUpload(nodeId);
}
async function beginImageNodeLibrary(nodeId: number) {
  await workspaceAssets.beginNodeLibrary(nodeId);
}
async function loadAssets(render = true) {
  await workspaceAssets.loadAssets(render);
}
function renderAssets() {
  workspaceAssets.renderAssets();
}
function openAssetPreview(
  url: string,
  name: string,
  kind: "image" | "video" = "image",
) {
  workspaceAssets.openPreview(url, name, kind);
}
async function downloadNodeImage(node: FlowNode) {
  try {
    await downloadNodeImageFile(node);
  } catch (error) {
    showToast(
      "图片下载失败",
      "error",
      error instanceof Error ? error.message : "请稍后重试",
    );
  }
}
function escapeHtml(value: string) {
  const element = document.createElement("span");
  element.textContent = value;
  return element.innerHTML;
}
new WorkspaceOverlayController({
  quickMenu: quickNodeMenu,
  closeQuickMenu: closeQuickNodeMenu,
  closeAssetContextIfOutside: (target) =>
    workspaceAssets.closeContextIfOutside(target),
}).bind();
new WorkspaceKeyboardController({
  closeQuickMenu: () => {
    if (!quickNodeMenu.classList.contains("open")) return false;
    closeQuickNodeMenu();
    return true;
  },
  closeNodeInfo: () => {
    if (!document.querySelector<HTMLElement>("#node-info-modal")!.classList.contains("open")) return false;
    closeNodeInfo();
    return true;
  },
  closeAssetPreview: () => {
    if (!workspaceAssets.isPreviewOpen) return false;
    workspaceAssets.closePreview();
    return true;
  },
  undo: () => { void undoCanvas(); },
  redo: () => { void redoCanvas(); },
  deleteSelected: () => { void deleteSelectedNode(); },
});
function refreshLocalImageAvailabilityUI() {
  /* 本地 Provider 暂不在模型列表展示 */
}
const generationCapabilitiesController = new GenerationCapabilitiesController({
  current: () => generationCapabilities,
  apply: (capabilities) => { generationCapabilities = capabilities; },
  availabilityChanged: () => {
    refreshLocalImageAvailabilityUI();
    draw();
  },
});
function loadGenerationCapabilities(redraw = false) {
  return generationCapabilitiesController.load(redraw);
}
const applicationBootstrap = new ApplicationBootstrapController<AuthUser>({
  apiFetch,
  setUser: (user) => authWorkspace.setUser(user),
  user: () => authWorkspace.user,
  setReady: () => authWorkspace.markReady(),
  renderUser: () => authWorkspace.renderUser(),
  touchSession: () => authWorkspace.touch(),
  loadCapabilities: () => loadGenerationCapabilities(),
  synchronizeCanvas: () => authWorkspace.synchronize(true),
  loadAssets: () => loadAssets(false),
  status: (message, visible) => authWorkspace.status(message, visible),
  randomizeTheme: authWorkspace.randomizeTheme,
  applyRoute: () => authWorkspace.applyRoute(),
  notifyError: (message) => showToast(message, "error"),
});
window.addEventListener("resize", resize);
resize();
updateEditor();
void applicationBootstrap.run();
