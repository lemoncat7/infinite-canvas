import "../style.css";
import { CanvasPerformanceMonitor } from "../canvas/performance-monitor";
import { CanvasPaintCoordinator } from "../canvas/canvas-paint-coordinator";
import { CanvasPersistenceFeature } from "../canvas/canvas-persistence-feature";
import { CanvasConnectionFeature } from "../canvas/canvas-connection-feature";
import { CanvasStore } from "../canvas/store";
import { CanvasSelectionController } from "../canvas/selection-controller";
import { CanvasConnectionController } from "../canvas/connection-controller";
import { CanvasInteractionController } from "../canvas/interaction-controller";
import { CanvasInputFeature } from "../canvas/canvas-input-feature";
import { CanvasBatchFeature } from "../canvas/canvas-batch-feature";
import { CanvasHistoryFeature } from "../canvas/canvas-history-feature";
import { LinkInteractionView } from "../canvas/link-interaction-view";
import { GenerationPoller } from "../services/generation-poller";
import { GenerationWorkflow } from "../services/generation-workflow";
import { CanvasNodeIdAllocator } from "../services/canvas-node-id-allocator";
import { CanvasMediaFeature } from "../canvas/canvas-media-feature";
import type {
  FlowLink,
  FlowNode,
  GenerationCapabilities,
  NodeKind,
  Point,
} from "../nodes/node-types";
import { NodeLifecycleController } from "../nodes/node-lifecycle-controller";
import { GenerationGraph } from "../nodes/generation-graph";
import { decodePromptClipboardText, normalizePromptText } from "../nodes/prompt-text";
import { downloadNodeImage as downloadNodeImageFile } from "../nodes/node-download";
import { PromptNodeController } from "../nodes/prompt-node";
import { TtsFeature } from "../services/tts-feature";
import {
  canGenerateNode as evaluateCanGenerateNode,
  generationBlockedReason as evaluateGenerationBlockedReason,
} from "../nodes/generation-eligibility";
import { PendingTaskCancellationController } from "../nodes/pending-task-cancellation-controller";
import { apiFetch } from "../services/api";
import { AppUpdateController } from "../services/app-update-controller";
import { GenerationCapabilitiesController } from "../services/generation-capabilities-controller";
import { CanvasGenerationFeature } from "../services/canvas-generation-feature";
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
import { CanvasToolbarController } from "../ui/canvas-toolbar-controller";
import { NodeInfoController } from "../ui/node-info-controller";
import { WorkspaceOverlayController } from "../ui/workspace-overlay-controller";
import { WorkspaceKeyboardController } from "../ui/workspace-keyboard-controller";
import { TaskMonitorController } from "../ui/task-monitor-controller";
import { TopbarMenuCoordinator } from "../ui/topbar-menu-coordinator";
import { QuickNodeMenuController } from "../ui/quick-node-menu-controller";
import { AppearanceController } from "../ui/appearance-controller";
import { NodeEditorStateController } from "../ui/node-editor-state-controller";
import { CanvasGuideController, type CanvasGuideMessage } from "../ui/canvas-guide-controller";
import { ToastController, type ToastType } from "../ui/toast-controller";
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

const canvasPerformance = new CanvasPerformanceMonitor(
  new URLSearchParams(location.search).has("canvasPerf"),
);
if (canvasPerformance.enabled)
  Object.assign(window, { __canvasPerformance: canvasPerformance });
let pixiRenderer:
  | import("../canvas/pixi-renderer").PixiCanvasRenderer
  | undefined;
let pixiRendererPromise: Promise<void> | null = null;

function ensurePixiRenderer() {
  if (pixiRenderer) return Promise.resolve();
  if (pixiRendererPromise) return pixiRendererPromise;
  pixiRendererPromise = import("../canvas/pixi-renderer")
    .then(async ({ PixiCanvasRenderer }) => {
      const renderer = new PixiCanvasRenderer();
      await renderer.mount(document.body);
      pixiRenderer = renderer;
      document.body.classList.add("renderer-pixi");
      document.body.classList.remove("canvas-context-lost");
      draw(false);
    })
    .catch((error) => {
      pixiRendererPromise = null;
      document.body.classList.remove("renderer-pixi");
      document.body.classList.add("canvas-context-lost");
      clientLog("pixi-renderer-init-failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    });
  return pixiRendererPromise;
}

let generationCapabilities: GenerationCapabilities =
  createDefaultGenerationCapabilities();
let canvasGeneration: CanvasGenerationFeature;
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
const taskMonitorController = new TaskMonitorController({
  nodes,
  resetButton,
  canGenerate: canGenerateNode,
  modelName: modelDisplayName,
  focusNode: focusTaskNode,
  startAllEmpty: startAllEmptyImages,
  cancelPending: () => void cancelPendingProjectTasks(),
  closeOtherMenus: (opening) =>
    closeTopbarMenus(opening ? "task" : undefined),
});
const taskMonitorButton = taskMonitorController.button;
const taskMonitorPanel = taskMonitorController.panel;
const topbarMenus = new TopbarMenuCoordinator();
topbarMenus.register("task", () => taskMonitorController.close());
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
function emptyImageCandidates() {
  return taskMonitorController.emptyImageCandidates();
}
function startAllEmptyImages() {
  const candidates = emptyImageCandidates();
  if (!candidates.length) {
    showCanvasGuide({
      key: "empty-images-none",
      title: "没有可启动的空图",
      detail: "已有图片、提示词为空或已经进入任务的节点会被自动跳过。",
      tone: "online",
      duration: 2800,
    });
    return;
  }
  candidates.forEach((node) => {
    node.agentAuto = true;
    node.status = "waiting";
  });
  const ready = candidates.filter(
      (node) =>
        !links
          .filter((link) => link.to === node.id)
          .map((link) => nodes.find((item) => item.id === link.from))
          .some((upstream) => upstream?.kind === "image" && !upstream.mediaUrl),
    ).length,
    waiting = candidates.length - ready;
  scheduleSave();
  draw();
  runAgentWorkflow();
  showCanvasGuide({
    key: "empty-images-started",
    title: `已启动 ${candidates.length} 个空图任务`,
    detail: `${ready} 个立即进入队列${waiting ? `，${waiting} 个将在上游图片完成后自动继续` : ""}。可在旁边的“任务”中查看进度。`,
    tone: "online",
    duration: 5200,
  });
}
const pendingTaskCancellation = new PendingTaskCancellationController<AuthUser>({
  nodes,
  links,
  projectId: () => currentProjectId,
  ask: async (options) => (await askProjectDialog(options)) === true,
  cancelPoll: (jobId) => generationPoller.cancel(jobId),
  getUser: () => authWorkspace.user,
  setUser: (user) => authWorkspace.setUser(user),
  renderUser: () => authWorkspace.renderUser(),
  refreshModels: refreshNodeModelMenus,
  save: scheduleSave,
  update: updateEditor,
  draw,
  toast: (message, tone, detail) => showToast(message, tone, detail),
});
function cancelPendingProjectTasks() {
  return pendingTaskCancellation.cancel();
}
function focusTaskNode(nodeId: number) {
  const node = nodes.find((item) => item.id === nodeId);
  if (!node) return;
  selection.selectedId = node.id;
  camera.x = -(node.x + node.width / 2) * camera.zoom;
  camera.y = -(node.y + node.height / 2) * camera.zoom;
  taskMonitorController.close();
  updateEditor();
  draw();
}
function updateTaskMonitor() {
  taskMonitorController.update();
}
function closeTopbarMenus(
  except?: "workspace" | "task" | "user" | "notifications" | "presence",
) {
  topbarMenus.closeAll(except);
}
document.addEventListener("click", () => {
  taskMonitorController.close();
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
  enqueue: (ids) => generationWorkflow.enqueue(ids),
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
  paintImage: paintNodeMedia,
  paintVideo: paintNodeVideo,
  notify: (message, type, detail) => showToast(message, type, detail),
});
const canvasMedia = new CanvasMediaFeature({
  mobile: innerWidth <= 780,
  nodes,
  nodeLayer,
  theme: () => colorTheme,
  suspendRenderer: () => pixiRenderer?.suspend(),
  resumeRenderer: () => pixiRenderer?.resume(),
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
const generationPoller = new GenerationPoller({
  nodes,
  onProgress: (node, _job, changed) => { if (changed) updateNodeJobProgressUi(node); },
  onRetry: () => showToast("首次生成请求超时，正在自动重试一次", "warning"),
  onTerminal: finalizeGenerationJob,
  onSyncFailure: (_failures, notify) => {
    jobLabel.textContent = "状态同步中断，正在重试…";
    if (notify) showToast("任务状态暂时无法同步，服务恢复后将自动重试", "error");
  },
});
const generationWorkflow = new GenerationWorkflow({
  nodes,
  links,
  generate,
  save: scheduleSave,
  draw,
  canGenerate: canGenerateNode,
});
const toastStack = document.querySelector<HTMLElement>("#toast-stack")!;
const canvasGuideController = new CanvasGuideController(escapeHtml);
const toastController = new ToastController(
  toastStack,
  escapeHtml,
  (message) => canvasGuideController.show(message),
);
function showToast(
  message: string,
  type: ToastType = "error",
  detail = "",
) {
  toastController.show(message, type, detail);
}

async function copyOriginalPrompt(prompt?: string) {
  const value = normalizePromptText(prompt);
  if (!value) {
    showToast("暂无可复制的原提示词", "warning");
    return;
  }
  try {
    await navigator.clipboard.writeText(decodePromptClipboardText(value));
    showToast("原提示词已复制", "success");
  } catch {
    showToast("复制失败，请手动选择提示词", "error");
  }
}

function hideCanvasGuide(key?: string) {
  canvasGuideController.hide(key);
}
function showCanvasGuide(message: CanvasGuideMessage) {
  return canvasGuideController.show(message);
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
  ensureRenderer: ensurePixiRenderer,
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
  isGuideVisible: (key) => canvasGuideController.isVisible(key),
  checkAppUpdate: () => void appUpdateController.checkNow(),
  restoreAfterReconnect: () => void comicStudioFeature.restoreAfterReconnect(),
  toast: (message, type) => showToast(message, type),
});
function showCanvasModeNotice(title: string, detail: string) {
  showCanvasGuide({
    key: "canvas-mode",
    title,
    detail,
    tone: "online",
    priority: 20,
    duration: 2100,
  });
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
const canvasPaint = new CanvasPaintCoordinator({
  performance: canvasPerformance,
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
  renderer: () => pixiRenderer,
  rebuildIndexes: rebuildPaintIndexes,
  syncDom: () => nodeViews.sync(),
  warmEditors: () => nodeViews.scheduleWarmup(),
  updateTasks: updateTaskMonitor,
  updateHistory: updateHistoryControls,
});
function paint() { canvasPaint.paint(); }
function draw(syncDom = true) { canvasPaint.draw(syncDom); }
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
  promptNodeEditor.beginEdit(node, element, {
    onInput: () => setSaveState("editing", "编辑中…"),
    onFinish: () => {
      scheduleSave();
      updateEditor();
      draw();
    },
  });
}

const nodeInfoModal = document.querySelector<HTMLElement>("#node-info-modal")!;
const nodeInfoController = new NodeInfoController(nodeInfoModal, scheduleSave);
function openNodeInfo(node: FlowNode) {
  nodeInfoController.open(node);
}
function closeNodeInfo() {
  nodeInfoController.close();
}

function defaultNodeCopy(kind: NodeKind) {
  return kind === "prompt"
    ? "双击记录标签或说明"
    : kind === "image"
      ? "空图节点"
      : kind === "video"
        ? "连接图片并填写描述，生成视频"
        : kind === "voice"
          ? "为 Base 角色固定音色"
          : kind === "tts"
            ? "连接语音配置并填写台词"
            : kind === "audio"
              ? "生成后的音频结果"
              : "双击添加说明文字";
}

function paintNodeMedia(target: HTMLCanvasElement, url: string) {
  canvasMedia.paint(target, url);
}
function paintNodeVideo(target: HTMLCanvasElement, url: string) {
  paintNodeMedia(target, url);
}
function repaintAllMedia() {
  canvasMedia.repaintAll();
}

function finishDomConnection(event: PointerEvent) {
  if (!connection.active) return;
  const snappedNode = connection.snap
    ? nodes.find((node) => node.id === connection.snap!.nodeId)
    : undefined;
  const target = snappedNode
    ? { node: snappedNode, side: connection.snap!.side }
    : hitPort(
        event.clientX,
        event.clientY,
        connection.snapRadius,
        connection.active.nodeId,
      );
  if (target) {
    const next = connectionFeature.directedLink(
      connection.active.nodeId,
      connection.active.side,
      target.node.id,
      target.side,
    );
    if (
      next &&
      !links.some((link) => link.from === next.from && link.to === next.to)
    ) {
      links.push(next);
      scheduleSave();
    }
  }
  connection.cancel();
  stopConnectionAutoPan();
  draw();
}
async function deleteSelectedNode() {
  await nodeLifecycle.deleteSelected();
}

function selectedNode() {
  return nodes.find((node) => node.id === selection.selectedId);
}
function canGenerateNode(node: FlowNode) {
  return evaluateCanGenerateNode(node, {
    availableCredits:
      Number(authWorkspace.user?.credits ?? 0) - Number(authWorkspace.user?.reservedCredits ?? 0),
    hasConnectedVoice: Boolean(connectedVoiceNode(node)),
  });
}
function generationBlockedReason(node: FlowNode) {
  return evaluateGenerationBlockedReason(node, {
    availableCredits:
      Number(authWorkspace.user?.credits ?? 0) - Number(authWorkspace.user?.reservedCredits ?? 0),
    hasConnectedVoice: Boolean(connectedVoiceNode(node)),
  });
}
const nodeEditorState = new NodeEditorStateController({
  titleInput,
  promptInput,
  modelInput,
  generateButton,
  jobLabel,
  jobProgress,
  nodeLayer,
  selectedNode,
  selectedId: () => selection.selectedId,
  activelyGenerating: nodeIsActivelyGenerating,
  canGenerate: canGenerateNode,
  pixiActive: () => Boolean(pixiRenderer),
  draw,
  save: scheduleSave,
  updateTasks: updateTaskMonitor,
});
function updateEditor() {
  nodeEditorState.update();
}

function updateNodeJobProgressUi(node: FlowNode) {
  nodeEditorState.updateProgress(node);
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
  cancelPolling: () => generationPoller.cancelAll(),
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
canvasGeneration = new CanvasGenerationFeature({
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
  pollJob,
  getUser: () => authWorkspace.user,
  setUser: (user) => authWorkspace.setUser(user),
  renderUser: () => authWorkspace.renderUser(),
  refreshModelMenus: refreshNodeModelMenus,
  loadAssets: () => loadAssets(false),
  renderAssets,
  isAssetPanelOpen: () => Boolean(
    document.querySelector("#assets-panel")?.classList.contains("open"),
  ),
  runWorkflow: () => generationWorkflow.run(),
  toast: (message, tone, detail) => showToast(message, tone, detail),
});
function generate(sourceOverride?: FlowNode) {
  return canvasGeneration.generate(sourceOverride);
}
function runAgentWorkflow() { generationWorkflow.run(); }
function finalizeGenerationJob(currentNode: FlowNode, job: import("../services/generation").GenerationJob) {
  return canvasGeneration.finalize(currentNode, job);
}
function pollJob(node: FlowNode) { generationPoller.poll(node); }
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

const linkHoverHint = document.querySelector<HTMLElement>("#link-hover-hint")!;
const touchLinkAction = document.querySelector<HTMLButtonElement>("#touch-link-action")!;
new LinkInteractionView({
  canvas, hint: linkHoverHint, touchAction: touchLinkAction, links, connection,
  pointerDown: () => pointer.down, multiSelect: () => selection.multiSelectMode,
  hitLink, generationActive: canvasHasActiveGeneration,
  contextSuppressed: marqueeController.isContextSuppressed,
  save: scheduleSave, draw,
  notify: (message, type) => showToast(message, type),
});
new CanvasToolbarController({
  zoomSlider,
  viewportCenter: () => ({ x: innerWidth / 2, y: innerHeight / 2 }),
  fit: cameraViewport.fit,
  setZoom: (zoom, anchor) => cameraViewport.setImmediate(zoom, anchor),
  zoomBy: cameraViewport.smoothBy,
  addNode: (kind) => addNode(kind),
  generate: () => { void generate(); },
  deleteSelected: () => { void deleteSelectedNode(); },
}).bind();
const quickNodeMenu = document.querySelector<HTMLElement>("#quick-node-menu")!;
function closeQuickNodeMenu() {
  quickNodeMenuController.close();
}
const quickNodeMenuController = new QuickNodeMenuController({
  canvas,
  menu: quickNodeMenu,
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
    const element = nodeLayer.querySelector<HTMLElement>(
      `.flow-node[data-id="${node.id}"]`,
    );
    if (element) enterTextEdit(node, element);
  },
  multiSelectActive: () => selection.multiSelectMode,
  exitMultiSelect: exitMultiSelectMode,
  enterMultiSelect: enterMultiSelectMode,
  toWorld: world,
  addNode: (kind, position) => addNode(kind, position),
  uploadAt: openAssetUploadAt,
});
const appearanceButton =
  document.querySelector<HTMLButtonElement>("#dock-appearance")!;
const appearanceController = new AppearanceController({
  button: appearanceButton,
  pendingMedia: () => pendingMediaLoads.size,
  currentTheme: () => colorTheme,
  applyTheme: (theme) => {
    colorTheme = theme;
    document.body.dataset.theme = colorTheme;
    localStorage.setItem("flow-theme", colorTheme);
  },
  repaintMedia: repaintAllMedia,
  paint,
});
function refreshAppearanceButton() {
  appearanceController.refresh();
}
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
    if (!nodeInfoModal.classList.contains("open")) return false;
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
