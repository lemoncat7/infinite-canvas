import "../style.css";
import { CanvasPerformanceMonitor } from "../canvas/performance-monitor";
import { CanvasPaintCoordinator } from "../canvas/canvas-paint-coordinator";
import { CanvasSnapshotController } from "../canvas/canvas-snapshot-controller";
import { CanvasSpatialIndex } from "../canvas/spatial-index";
import { CanvasGeometryController } from "../canvas/canvas-geometry-controller";
import { ConnectionAutoPanController } from "../canvas/connection-auto-pan-controller";
import { PixiEditorCache } from "../canvas/pixi-editor-cache";
import { CanvasStore } from "../canvas/store";
import {
  applyCanvasOperations,
  normalizeCanvasLinks,
  type CanvasSyncOperation,
  type CanvasSyncSnapshot,
} from "../canvas/sync";
import { CanvasSelectionController } from "../canvas/selection-controller";
import { CanvasConnectionController } from "../canvas/connection-controller";
import { CanvasInteractionController } from "../canvas/interaction-controller";
import { DomPointerLifecycle } from "../canvas/dom-pointer-lifecycle";
import { MarqueeController } from "../canvas/marquee-controller";
import { CanvasPointerLifecycle } from "../canvas/canvas-pointer-lifecycle";
import { TouchPinchController } from "../canvas/touch-pinch-controller";
import { CameraViewportController } from "../canvas/camera-viewport-controller";
import { CanvasClearController } from "../canvas/clear-controller";
import { CanvasClearResultApplier } from "../canvas/clear-result-applier";
import { CanvasSaveCoordinator } from "../canvas/save-coordinator";
import { CanvasLoadCoordinator } from "../canvas/load-coordinator";
import { BatchSelectionController } from "../canvas/batch-selection-controller";
import { CanvasHistoryController } from "../canvas/history-controller";
import { LinkInteractionView } from "../canvas/link-interaction-view";
import { GenerationPoller } from "../services/generation-poller";
import { GenerationWorkflow } from "../services/generation-workflow";
import { CanvasNodeIdAllocator } from "../services/canvas-node-id-allocator";
import {
  appendRevisionNode,
  findOutputPosition,
  removeResultNode,
} from "../nodes/generation-node-lifecycle";
import { CanvasMediaFeature } from "../canvas/canvas-media-feature";
import type {
  FlowLink,
  FlowNode,
  GenerationCapabilities,
  NodeKind,
  Point,
  PortSide,
} from "../nodes/node-types";
import { NodeLifecycleController } from "../nodes/node-lifecycle-controller";
import { GenerationGraph } from "../nodes/generation-graph";
import { ConnectionRules } from "../nodes/connection-rules";
import { decodePromptClipboardText, normalizePromptText } from "../nodes/prompt-text";
import { downloadNodeImage as downloadNodeImageFile } from "../nodes/node-download";
import { PromptNodeController } from "../nodes/prompt-node";
import { TtsFeature } from "../services/tts-feature";
import {
  canGenerateNode as evaluateCanGenerateNode,
  generationBlockedReason as evaluateGenerationBlockedReason,
} from "../nodes/generation-eligibility";
import { GenerationSubmitController } from "../nodes/generation-submit-controller";
import { PendingTaskCancellationController } from "../nodes/pending-task-cancellation-controller";
import { apiFetch } from "../services/api";
import { AppUpdateController } from "../services/app-update-controller";
import { GenerationCapabilitiesController } from "../services/generation-capabilities-controller";
import { GenerationFinalizer } from "../services/generation-finalizer";
import type { GenerationJob } from "../services/generation";
import { ClientDiagnostics } from "../services/client-diagnostics";
import { ComicSessionController } from "../services/comic-session";
import { ComicSessionState } from "../services/comic-session-state";
import {
  clipVideoPrompt,
  composeStoryboardPrompt,
  fitVideoDialogue,
  inferAnonymousCrowd,
  speechSegments,
} from "../nodes/video-node";
import { inferVoiceConfig } from "../nodes/voice-node";
import type { ComicPlan, ComicShot } from "../nodes/comic-types";
import { bindNodeConfigPanel } from "../ui/node-editor";
import { AssetPreviewController } from "../ui/asset-preview";
import { AssetLibraryFeature } from "../ui/asset-library-feature";
import { CanvasToolbarController } from "../ui/canvas-toolbar-controller";
import { NodeInfoController } from "../ui/node-info-controller";
import { WorkspaceOverlayController } from "../ui/workspace-overlay-controller";
import { SquarePanelView } from "../ui/square-panel";
import { WorkspacePanelController } from "../ui/toolbar";
import { WorkspaceNavigationCoordinator } from "../ui/workspace-navigation-coordinator";
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
import { ProjectController } from "../ui/project-controller";
import type { AuthUser } from "../ui/user-menu-controller";
import { NotificationFeature } from "../ui/notification-feature";
import { AccountToolsFeature } from "../ui/account-tools-feature";
import { PromptAgentFeature } from "../ui/prompt-agent-feature";
import { createComicStudioShell } from "../ui/comic-studio-shell";
import { ComicSidePanelController } from "../ui/comic-side-panel";
import { ComicStudioView } from "../ui/comic-studio";
import { ComicSessionRecoveryView } from "../ui/comic-session-recovery";
import { ComicDialogueController } from "../ui/comic-dialogue-controller";
import { ComicNewSessionController } from "../ui/comic-new-session-controller";
import { ComicStudioInteractionController } from "../ui/comic-studio-interaction-controller";
import { ComicStudioLifecycleController } from "../ui/comic-studio-lifecycle-controller";
import { ComicPlanController } from "../ui/comic-plan-controller";
import { ComicOutputController } from "../ui/comic-output-controller";
import { ComicLabelController } from "../ui/comic-labels";
import { BoundNodeViewFactory } from "../nodes/bound-node-view-factory";
import { BoundNodeDomSynchronizer } from "../nodes/bound-node-dom-synchronizer";
import { createDefaultGenerationCapabilities } from "./state";
import { ProjectSwitchController } from "./project-switch-controller";
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
function captureCanvasSnapshot(
  version?: number,
  updatedAt?: string,
): CanvasSyncSnapshot {
  return canvasSnapshots.capture(version, updatedAt);
}
function applySynchronizedCanvas(
  snapshot: CanvasSyncSnapshot,
  preserveSelection = true,
) {
  canvasSnapshots.apply(snapshot, preserveSelection);
}
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
const undoButton = document.querySelector<HTMLButtonElement>("#dock-history")!,
  redoButton = document.createElement("button");
function showHistoryShortcutGuide(kind: "undo" | "redo") {
  const storageKey = `flow-history-guide:${kind}`;
  if (sessionStorage.getItem(storageKey)) return;
  sessionStorage.setItem(storageKey, "1");
  showCanvasGuide(
    kind === "undo"
      ? {
          key: "history-undo-guide",
          title: "画布回溯",
          detail: "可以按 Ctrl/⌘ + Z 快速撤销上一步。",
          tone: "online",
          priority: 28,
          duration: 4200,
        }
      : {
          key: "history-redo-guide",
          title: "已重做上一步",
          detail: "可以按 Ctrl/⌘ + Shift + Z 恢复刚才撤销的操作。",
          tone: "online",
          priority: 28,
          duration: 4600,
        },
  );
}
const canvasHistory = new CanvasHistoryController({
  nodes,
  links,
  undoButton,
  redoButton,
  projectId: () => currentProjectId,
  nextId: () => canvasNodeIds.nextId,
  setNextId: (value) => { canvasNodeIds.nextId = value; },
  selectedId: () => selection.selectedId,
  setSelectedId: (value) => { selection.selectedId = value; },
  clearBatch: () => selection.batchIds.clear(),
  clearPromptEditing: () => { promptNodeEditor.editingId = 0; },
  generationActive: canvasHasActiveGeneration,
  update: updateEditor,
  draw,
  save: saveCanvas,
  toast: (message) => showToast(message, "warning"),
  guide: showHistoryShortcutGuide,
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
const marqueeBox = document.createElement("div"),
  batchToolbar = document.createElement("div");
marqueeBox.className = "canvas-marquee";
batchToolbar.className = "canvas-batch-toolbar";
batchToolbar.innerHTML =
  '<span data-batch-count>已选 0 项</span><button type="button" data-batch-generate aria-label="生成所选卡片" title="生成">生成</button><button type="button" data-batch-delete aria-label="删除所选卡片" title="删除">删除</button><button type="button" data-batch-clear aria-label="退出多选模式" title="退出">退出</button>';
document.body.append(marqueeBox, batchToolbar);
let promptAgentFeature: PromptAgentFeature;
const cameraViewport = new CameraViewportController({
  camera,
  nodes,
  viewport: () => ({ width: innerWidth, height: innerHeight }),
  draw,
  save: scheduleSave,
});
const domPointer = new DomPointerLifecycle({
  nodes,
  zoom: () => camera.zoom,
  groupMovingElement: batchToolbar,
  setEditing: () => setSaveState("editing", "编辑中…"),
  save: scheduleSave,
  draw,
  syncElements: syncDraggedNodeElements,
  refreshBatchSelection,
  isMultiSelectMode: () => selection.multiSelectMode,
  toggleBatchNode,
  selectNode: (id) => { selection.selectedId = id; updateEditor(); },
  clearSelection: () => { selection.selectedId = 0; updateEditor(); draw(); },
  selectedId: () => selection.selectedId,
  isAgentSelected: (id) => promptAgentFeature.selectedIds.has(id),
  agentSelectionSize: () => promptAgentFeature.selectedIds.size,
  toggleAgentSelection: (id) => {
    if (promptAgentFeature.selectedIds.has(id)) promptAgentFeature.selectedIds.delete(id);
    else promptAgentFeature.selectedIds.add(id);
  },
  renderAgentSelection: () => promptAgentFeature.renderContext(false),
  warnAgentLimit: () => showToast("参考素材最多选择 8 个", "warning"),
  hasConnection: () => Boolean(connection.active),
  moveConnection: (event) => {
    updateConnectionPointer(event.clientX, event.clientY);
    startConnectionAutoPan(event.clientX, event.clientY);
    draw();
  },
  finishConnection: finishDomConnection,
});
const touchPinch = new TouchPinchController({
  selector: "#canvas,.flow-node",
  zoom: () => camera.zoom,
  setZoom: (zoom, anchor) => cameraViewport.setZoom(zoom, anchor),
  pan: (dx, dy) => { camera.x += dx; camera.y += dy; },
  cancelSingleTouch: () => {
    pointer.down = false;
    pointer.draggingNode = null;
    canvas.classList.remove("dragging");
    connection.cancel();
    stopConnectionAutoPan();
    domPointer.cancel();
  },
  syncZoomTarget: cameraViewport.syncTarget,
  draw,
});
const marqueeController = new MarqueeController({
  canvas,
  nodeLayer,
  box: marqueeBox,
  nodes,
  camera,
  interaction,
  selection,
  screen: (point) => worldToScreen(point, camera, { width: innerWidth, height: innerHeight }),
  world: (point) => screenToWorld(point, camera, { width: innerWidth, height: innerHeight }),
  updateEditor,
  refreshSelection: refreshBatchSelection,
  clearSelection: clearBatchSelection,
  refreshHint: refreshCanvasModeHint,
  draw,
  notice: showCanvasModeNotice,
});
new CanvasPointerLifecycle({
  canvas,
  nodeLayer,
  interaction,
  selection,
  zoom: () => camera.zoom,
  hitNode,
  cancelCameraAnimation: cameraViewport.cancel,
  toggleBatchNode,
  updateEditor,
  setEditing: () => setSaveState("editing", "编辑中…"),
  moveNode: (id, dx, dy) => canvasStore.moveNodeById(id, dx, dy),
  panCamera: (dx, dy) => canvasStore.panCamera(dx, dy),
  connectionActive: () => Boolean(connection.active),
  moveConnection: (event) => {
    updateConnectionPointer(event.clientX, event.clientY);
    startConnectionAutoPan(event.clientX, event.clientY);
    draw(false);
  },
  finishConnection: finishDomConnection,
  cancelConnection: () => { connection.cancel(); stopConnectionAutoPan(); },
  save: scheduleSave,
  draw,
  closeQuickMenu: closeQuickNodeMenu,
  smoothZoom: cameraViewport.smoothBy,
});
const nodeDomStates = new Map<number, unknown[]>();
const canvasSpatialIndex = new CanvasSpatialIndex();
const pixiEditorCache = new PixiEditorCache(
  nodes,
  camera,
  canvasSpatialIndex,
  (point) => world(point),
  () => selection.selectedId,
  createDomNode,
  (id) => nodeDomStates.delete(id),
);
const pixiDetachedNodeCache = pixiEditorCache.elements;
function cacheDetachedPixiNode(id: number, element: HTMLElement) {
  pixiEditorCache.detach(id, element);
}
function schedulePixiEditorWarmup() {
  pixiEditorCache.scheduleWarmup();
}
const canvasMedia = new CanvasMediaFeature({
  mobile: innerWidth <= 780,
  nodes,
  nodeLayer,
  theme: () => colorTheme,
  suspendRenderer: () => pixiRenderer?.suspend(),
  resumeRenderer: () => pixiRenderer?.resume(),
  clearNodeStates: () => nodeDomStates.clear(),
  invalidateNode: (id) => { nodeDomStates.delete(id); },
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
const authWorkspace: AuthWorkspaceFeature = new AuthWorkspaceFeature({
  nodes,
  links,
  getProjectId: () => currentProjectId,
  setProjectId: (id) => { currentProjectId = id; },
  getLoadedProjectId: () => canvasSaveCoordinator.loadedProjectId,
  isSaveBlocked: () => canvasSaveCoordinator.blocked,
  getServerVersion: () => canvasSaveCoordinator.serverVersion,
  ensureRenderer: ensurePixiRenderer,
  stopSave: (logout) => canvasSaveCoordinator.stopAndReset(logout),
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
  restoreAfterReconnect: () => void restoreComicAfterReconnect(),
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
const connectionRules = new ConnectionRules({
  nodes,
  links,
  notify: (message) => showToast(message, "warning"),
});

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
const canvasGeometry = new CanvasGeometryController(
  nodes,
  links,
  camera,
  canvasSpatialIndex,
  world,
  screen,
  portWorld,
);
canvasStore.subscribe((change) => {
  if (change.type === "node-position")
    change.nodeIds.forEach((id) => {
      const node = nodes.find((candidate) => candidate.id === id);
      if (node) canvasSpatialIndex.update(node);
    });
  else if (change.type === "structure") canvasSpatialIndex.rebuild(nodes);
});
function rebuildPaintIndexes() {
  canvasGeometry.rebuild();
}
function canvasInteractionActive() {
  return Boolean(pointer.down || domPointer.drag || interaction.marquee?.active || touchPinch.active);
}
function hitNode(sx: number, sy: number) {
  return canvasGeometry.hitNode(sx, sy);
}
function hitPort(sx: number, sy: number, radius = 12, excludeNodeId?: number) {
  return canvasGeometry.hitPort(sx, sy, radius, excludeNodeId);
}
function directedLink(
  firstId: number,
  firstSide: PortSide,
  secondId: number,
  secondSide: PortSide,
): FlowLink | null {
  return connectionRules.create(firstId, firstSide, secondId, secondSide);
}
function updateConnectionPointer(sx: number, sy: number) {
  if (!connection.active) return;
  const candidate = hitPort(sx, sy, connection.snapRadius, connection.active.nodeId),
    target = candidate && candidate.side === "left" ? candidate : null;
  connection.update(
    target
      ? screen(portWorld(target.node, target.side))
      : { x: sx, y: sy },
    target ? { nodeId: target.node.id, side: target.side } : null,
  );
}
const connectionAutoPan = new ConnectionAutoPanController({
  camera,
  active: () => Boolean(connection.active),
  updatePointer: updateConnectionPointer,
  draw: () => draw(false),
});
function stopConnectionAutoPan() {
  connectionAutoPan.stop();
}
function startConnectionAutoPan(sx: number, sy: number) {
  connectionAutoPan.start(sx, sy);
}
function hitLink(sx: number, sy: number, tolerance = 9) {
  return canvasGeometry.hitLink(sx, sy, tolerance);
}
const mountedDomNodeIds = new Set<number>();
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
    ? canvasGeometry.nodeIndex.get(connection.active.nodeId) ??
      nodes.find((node) => node.id === connection.active!.nodeId)
    : undefined;
    return {
    nodes,
    links,
    nodeCount: nodes.length,
    indexedNodeCount: canvasGeometry.nodeIndex.size,
    domNodeIds: [...mountedDomNodeIds],
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
  syncDom: syncDomNodes,
  warmEditors: schedulePixiEditorWarmup,
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

const boundNodeDomSynchronizer = new BoundNodeDomSynchronizer({
  viewport: nodeViewport,
  layer: nodeLayer,
  nodes,
  links,
  camera,
  getSelectedId: () => selection.selectedId,
  getBatchIds: () => selection.batchIds,
  getEditingId: () => promptNodeEditor.editingId,
  getDraggingId: () => domPointer.drag?.id ?? 0,
  isAgentSelecting: () => promptAgentFeature.selecting,
  getAgentIds: () => promptAgentFeature.selectedIds,
  getColorTheme: () => colorTheme,
  getSwap: () => videoReferenceSwapSelection,
  setSwap: (value) => { videoReferenceSwapSelection = value; },
  mountedIds: mountedDomNodeIds,
  detached: pixiDetachedNodeCache,
  states: nodeDomStates,
  cacheDetached: cacheDetachedPixiNode,
  createElement: createDomNode,
  isGenerating: nodeIsActivelyGenerating,
  defaultNodeCopy,
  getProviders: () => ttsFeature.catalog.providers,
  getVoices: () => ttsFeature.catalog.voicesByProvider,
  ensureProviders: loadTtsProviders,
  ensureVoices: loadTtsVoices,
  escapeHtml,
  scheduleSave,
  commitHistory: queueCanvasHistory,
  draw,
  paintImage: paintNodeMedia,
  paintVideo: paintNodeVideo,
  normalizePrompt: normalizePromptText,
  displayModelName: modelDisplayName,
  decodePrompt: (value = "") => decodePromptClipboardText(value),
  canGenerate: canGenerateNode,
  notify: (message, type, detail) => showToast(message, type, detail),
});
function syncDomNodes() {
  boundNodeDomSynchronizer.sync();
}
const boundNodeViewFactory = new BoundNodeViewFactory({
  nodes,
  batchIds: selection.batchIds,
  authUser: () => authWorkspace.user,
  customApiModels: () => accountTools.models,
  generationCapabilities: () => generationCapabilities,
  getSelectedId: () => selection.selectedId,
  setSelectedId: (id) => { selection.selectedId = id; },
  isMultiSelectMode: () => selection.multiSelectMode,
  getDrag: () => domPointer.drag,
  setDrag: (drag) => { domPointer.drag = drag; },
  beginResize: (value) => domPointer.beginResize(value),
  isReleaseSuppressed: domPointer.isReleaseSuppressed,
  isAgentSelecting: () => promptAgentFeature.selecting,
  isAgentCreateMode: () => promptAgentFeature.controls.mode === "create",
  updateEditor,
  draw,
  scheduleSave,
  setEditingState: () => setSaveState("editing", "编辑中…"),
  editPrompt: enterTextEdit,
  previewMedia: (current) =>
    openAssetPreview(current.mediaUrl!, current.title, current.kind as "image" | "video"),
  beginConnection: (nodeId, point) => connection.begin(nodeId, "right", point),
  showInfo: openNodeInfo,
  focusEditor: () => promptInput.focus(),
  generate,
  downloadImage: downloadNodeImage,
  deleteNode: () => { void deleteSelectedNode(); },
  confirmClearImage: async () =>
    Boolean(await askProjectDialog({
      title: "清除当前卡片的图片？",
      description:
        "资产库中的原图不会删除。原提示词、当前描述、模型、图像设置和参考连线都会保留。",
      confirm: "清除图片",
    })),
  removeCachedImage: (url) => imageCache.delete(url),
  normalizePrompt: normalizePromptText,
  notifyImageCleared: (message) => showToast(message, "success"),
  beginImageUpload: beginImageNodeUpload,
  beginImageLibrary: beginImageNodeLibrary,
  decodePrompt: decodePromptClipboardText,
  previewVoice,
  generateTts,
  escapeHtml,
  copyPrompt: copyOriginalPrompt,
});
function createDomNode(node: FlowNode) {
  return boundNodeViewFactory.create(node);
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
    const next = directedLink(
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
  canvasSaveCoordinator.schedule(queueCanvasHistory, recordHistory);
}

function saveCanvas() { return canvasSaveCoordinator.save(); }
function setSaveState(
  state: "editing" | "saving" | "saved" | "error",
  label: string,
) {
  saveState.dataset.state = state;
  saveState.textContent = label;
}

const canvasSnapshots = new CanvasSnapshotController({
  nodes,
  links,
  camera,
  selectedId: () => selection.selectedId,
  setSelectedId: (id) => { selection.selectedId = id; },
  serverVersion: () => canvasSaveCoordinator.serverVersion,
  serverUpdatedAt: () => canvasSaveCoordinator.serverUpdatedAt,
  syncCameraTarget: () => cameraViewport.syncTarget(),
  ensureNodeIdAtLeast: (value) => canvasNodeIds.ensureAtLeast(value),
  updateEditor,
  draw,
});

const canvasSaveCoordinator: CanvasSaveCoordinator = new CanvasSaveCoordinator({
  clientId: canvasSyncClientId,
  authenticated: () => Boolean(authWorkspace.user),
  projectId: () => currentProjectId,
  capture: captureCanvasSnapshot,
  applyMerged: applySynchronizedCanvas,
  setState: setSaveState,
  showConflict: (emptyGuard) => showCanvasGuide({
    key: "canvas-save-conflict",
    title: emptyGuard ? "已保护服务器画布" : "服务器画布已有新版本",
    detail: "正在停止本地保存并强制载入服务器上的完整版本。",
    tone: "offline",
    priority: 110,
  }),
  reload: () => loadCanvas(),
});

const canvasLoadCoordinator = new CanvasLoadCoordinator({
  save: canvasSaveCoordinator,
  nodes,
  links,
  camera,
  projectId: () => currentProjectId,
  normalizePrompt: normalizePromptText,
  clearViews: () => {
    nodeLayer.replaceChildren();
    pixiEditorCache.clear();
  },
  cancelPolling: () => generationPoller.cancelAll(),
  getLease: () => ({ nextId: canvasNodeIds.nextId, end: canvasNodeIds.end }),
  restoreLease: (leasedNextId, leasedEnd) => {
    canvasNodeIds.restore(leasedNextId, leasedEnd);
  },
  resetLease: (value) => {
    canvasNodeIds.reset(value);
  },
  needsLease: () => canvasNodeIds.needsLease(),
  reserveIds: reserveCanvasNodeIds,
  syncCamera: () => cameraViewport.syncTarget(),
  setBootStatus: (message) => authWorkspace.status(message),
  hideBootStatus: (version, delay) => authWorkspace.hideStatus(version, delay),
  hideConflictGuide: () => hideCanvasGuide("canvas-save-conflict"),
  clearSelection: () => { selection.selectedId = 0; },
  setSavedState: () => setSaveState("saved", "已自动保存"),
  setOfflineState: () => setSaveState("error", "离线模式"),
  update: updateEditor,
  draw,
  resetHistory: resetCanvasHistory,
  capture: captureCanvasSnapshot,
  scheduleSave,
  pollJob,
  runAgentWorkflow,
});
function loadCanvas(keepLoadingStatus = false) {
  return canvasLoadCoordinator.load(keepLoadingStatus);
}

const ttsFeature = new TtsFeature({
  nodes,
  links,
  getProjectId: () => currentProjectId,
  allocateNodeId: allocateCanvasNodeId,
  invalidateProviders: () => {
    nodes
      .filter((node) => node.kind === "voice")
      .forEach((node) => nodeDomStates.delete(node.id));
    draw();
  },
  invalidateVoices: (providerId) => {
    nodes
      .filter((node) => node.kind === "voice" && node.voiceSettings?.providerId === providerId)
      .forEach((node) => nodeDomStates.delete(node.id));
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
const generationSubmitController = new GenerationSubmitController({
  nodes,
  links,
  selectedNode,
  blockedReason: generationBlockedReason,
  normalizePrompt: normalizePromptText,
  projectId: () => currentProjectId,
  clearSelection: () => {
    selection.selectedId = 0;
    updateEditor();
    draw();
  },
  update: updateEditor,
  draw,
  save: scheduleSave,
  focusPrompt: () => promptInput.focus(),
  setJobLabel: (value) => { jobLabel.textContent = value; },
  createRevision: createRevisionNode,
  removeFailedResult,
  generateTts,
  pollJob,
  hasAuthenticatedUser: () => Boolean(authWorkspace.user),
  applyCredits: (creditsAvailable) => {
    const user = authWorkspace.user;
    if (!user) return;
    authWorkspace.setUser({
      ...user,
      reservedCredits: Math.max(
        0,
        Number(user.credits ?? 0) - creditsAvailable,
      ),
    });
    authWorkspace.renderUser();
    refreshNodeModelMenus();
  },
  toast: (message, tone, detail) => showToast(message, tone, detail),
});
function generate(sourceOverride?: FlowNode) {
  return generationSubmitController.generate(sourceOverride);
}
function createRevisionNode(source: FlowNode) {
  const id = allocateCanvasNodeId();
  if (id === null) return null;
  const revision = appendRevisionNode(id, source, nodes, links);
  scheduleSave(); draw();
  return revision;
}
function removeFailedResult(node: FlowNode, sourceId = node.sourceNodeId) {
  removeResultNode(node, nodes, links);
  if (selection.selectedId === node.id) selection.selectedId = sourceId ?? 0;
}
function runAgentWorkflow() { generationWorkflow.run(); }
const generationFinalizer = new GenerationFinalizer({
  imageCache,
  jobLabel,
  getUser: () => authWorkspace.user,
  setUser: (user) => authWorkspace.setUser(user),
  normalizePrompt: normalizePromptText,
  removeFailedResult,
  loadAssets: () => loadAssets(false),
  isAssetPanelOpen: () => Boolean(
    document.querySelector("#assets-panel")?.classList.contains("open"),
  ),
  renderAssets,
  renderUser: () => authWorkspace.renderUser(),
  refreshModelMenus: refreshNodeModelMenus,
  updateEditor,
  draw,
  save: scheduleSave,
  runWorkflow: runAgentWorkflow,
  toast: (message, tone, detail) => showToast(message, tone, detail),
});
async function finalizeGenerationJob(currentNode: FlowNode, job: GenerationJob) {
  await generationFinalizer.finalize(currentNode, job);
}
function pollJob(node: FlowNode) { generationPoller.poll(node); }
function refreshBatchSelection() {
  batchSelectionController.refresh();
}
function clearBatchSelection() {
  batchSelectionController.clear();
}
function toggleBatchNode(id: number) {
  batchSelectionController.toggle(id);
}
function refreshCanvasModeHint() {
  batchSelectionController.refreshModeHint();
}
function enterMultiSelectMode() { marqueeController.enter(); }
function exitMultiSelectMode() { marqueeController.exit(); }
function resetMarqueeRightGesture() { marqueeController.resetRightGesture(); }
const batchSelectionController = new BatchSelectionController({
  toolbar: batchToolbar,
  nodes,
  links,
  batchIds: selection.batchIds,
  selectedId: () => selection.selectedId,
  clearSelectedId: () => { selection.selectedId = 0; },
  multiSelectMode: () => selection.multiSelectMode,
  screen,
  viewportWidth: () => innerWidth,
  generationActive: canvasHasActiveGeneration,
  enqueue: (ids) => generationWorkflow.enqueue(ids),
  clearSelection: clearBatchSelection,
  exitMode: exitMultiSelectMode,
  update: updateEditor,
  draw,
  save: scheduleSave,
  toast: (message, tone, detail) => showToast(message, tone, detail),
  confirm: (message) => window.confirm(message),
});
function cascadeSelectionIds(seed: Set<number>) {
  return batchSelectionController.cascade(seed);
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
  onComic: openComicStudio,
  updateEditor,
  persist: scheduleSave,
  draw,
  runWorkflow: runAgentWorkflow,
  loadVoices: (providerId) => { void loadTtsVoices(providerId); },
  decodePrompt: decodePromptClipboardText,
  toast: (message, tone) => showToast(message, tone),
});
const comicShell = createComicStudioShell();
const comicStudio = comicShell.studio,
  comicConversationElement = comicShell.conversation,
  comicPlanElement = comicShell.sourcePlan,
  comicPlanSidePanel = comicShell.sidePlan,
  comicHeaderNav = comicShell.headerNav,
  comicThinkingStatus = comicShell.thinkingStatus,
  comicComposer = comicShell.composer,
  comicMessageField = comicShell.messageField,
  comicBriefPanel = comicShell.briefPanel;
const comicSidePanel = new ComicSidePanelController({
  studio: comicStudio,
  briefPanel: comicBriefPanel,
  sourcePlan: comicPlanElement,
  planPanel: comicPlanSidePanel,
  headerNav: comicHeaderNav,
  getState: () => ({
    linkedLabelId: comicState.linkedLabelId,
    sessionId: comicState.sessionId,
    hasPlan: Boolean(comicState.plan),
    pendingRevision: comicState.pendingRevision,
    ready: comicState.ready,
    submitting: comicState.submitting,
  }),
  showWarning: (message) => showToast(message, "warning"),
});
function showComicMobilePanel(kind: "brief" | "plan" | null) {
  comicSidePanel.showMobile(kind);
}
function positionComicBriefPanel() {
  comicSidePanel.position();
}
const comicStudioView = new ComicStudioView(
  comicStudio,
  comicBriefPanel,
  positionComicBriefPanel,
);
function selectedPromptAgentNodes() {
  return promptAgentFeature.selectedNodes();
}
const comicState = new ComicSessionState();
function setComicInteractionLocked(locked: boolean) {
  comicStudioView.setInteractionLocked(locked);
}
function currentComicOwnerKey() {
  return `${authWorkspace.user?.id || "anonymous"}:${currentProjectId}`;
}
function resetComicConversationState(clearPlan = true) {
  comicState.reset(currentComicOwnerKey(), clearPlan);
  renderComicBrief();
}
async function ensureComicProjectContext() {
  return comicStudioLifecycle.ensureProjectContext();
}
function renderComicBrief() {
  const linkedTitle = nodes
    .find((node) => node.id === comicState.linkedLabelId)
    ?.title.replace(/^漫剧方案\s*·\s*/, "");
  comicStudioView.renderBrief({
    brief: comicState.brief,
    plan: comicState.plan,
    sessionId: comicState.sessionId,
    pendingRevision: comicState.pendingRevision,
    ready: comicState.ready,
    linkedTitle,
  });
}
function comicLabels() {
  return nodes
    .filter((node) => node.kind === "prompt" && node.body.trim())
    .sort((a, b) => b.id - a.id);
}
const comicLabelController = new ComicLabelController({
  studio: comicStudio,
  state: comicState,
  getLabels: comicLabels,
  resetConversation: resetComicConversationState,
  renderPlan: (plan) => renderComicPlan(plan),
  renderBrief: renderComicBrief,
});
function renderComicLabelState() {
  comicLabelController.renderState();
}
function renderComicLabelMenu() {
  comicLabelController.renderMenu();
}
const comicSessionRecovery = new ComicSessionRecoveryView({
  studio: comicStudio,
  state: comicState,
  ownerKey: currentComicOwnerKey,
  setInteractionLocked: setComicInteractionLocked,
  renderBrief: renderComicBrief,
  renderPlan: (plan) => { if (plan) renderComicPlan(plan); },
  renderLabelState: renderComicLabelState,
  showWarning: (message) => showToast(message, "warning"),
});
const comicSessionController = new ComicSessionController({
  getProjectId: () => currentProjectId,
  getOwnerKey: currentComicOwnerKey,
  getTrackedSessionId: () => (comicState.submitting ? comicState.sessionId : ""),
  onEmpty: () => comicSessionRecovery.clear(),
  onSnapshot: (snapshot) => comicSessionRecovery.apply(snapshot),
});
const comicStudioLifecycle = new ComicStudioLifecycleController({
  studio: comicStudio,
  briefPanel: comicBriefPanel,
  planPanel: comicPlanSidePanel,
  promptPanel: promptAgentFeature.panel,
  getOwnerKey: currentComicOwnerKey,
  getStoredOwnerKey: () => comicState.ownerKey,
  setStoredOwnerKey: (owner) => { comicState.ownerKey = owner; },
  hasProject: () => Boolean(currentProjectId),
  hasAuthenticatedContext: () => Boolean(authWorkspace.user && currentProjectId),
  ensureProject: () => authWorkspace.ensureCurrentProject(),
  resetConversation: resetComicConversationState,
  invalidateSession: () => comicSessionController.invalidate(),
  restoreSession: (force) => restoreComicSession(force),
  resetMarqueeGesture: resetMarqueeRightGesture,
  isMultiSelect: () => selection.multiSelectMode,
  exitMultiSelect: exitMultiSelectMode,
  closePromptAgent: () => promptAgentFeature.close(),
  renderLabelState: renderComicLabelState,
  renderBrief: renderComicBrief,
});
function restoreComicSession(force = false) {
  return comicSessionController.restore(force);
}
async function restoreComicAfterReconnect() {
  await comicStudioLifecycle.restoreAfterReconnect();
}
function openComicStudio() {
  comicStudioLifecycle.open();
}
function closeComicStudio() {
  comicStudioLifecycle.close();
}
function renderComicPlan(plan: ComicPlan) {
  comicStudioView.renderPlan(plan);
}
const comicDialogueController = new ComicDialogueController({
  studio: comicStudio,
  briefPanel: comicBriefPanel,
  state: comicState,
  getProjectId: () => currentProjectId,
  ensureProjectContext: ensureComicProjectContext,
  getContext: () => {
    const selectedContexts = selectedPromptAgentNodes();
    const linkedLabel = nodes.find((node) => node.id === comicState.linkedLabelId);
    return [
      ...(linkedLabel
        ? [`关联标签「${linkedLabel.title}」：${linkedLabel.body.slice(0, 5000)}`]
        : []),
      ...selectedContexts.map(
        (node, index) =>
          `素材 ${index + 1}「${node.title}」：${node.generationPrompt || node.body || "视觉参考"}`,
      ),
    ];
  },
  renderBrief: renderComicBrief,
  showError: (message) => showToast(message, "error"),
});
function requestComicDialogue(message: string) {
  return comicDialogueController.submit(message);
}
const comicPlanController = new ComicPlanController({
  studio: comicStudio,
  briefPanel: comicBriefPanel,
  state: comicState,
  getProjectId: () => currentProjectId,
  ensureProjectContext: ensureComicProjectContext,
  getInputs: () => {
    const selectedContexts = selectedPromptAgentNodes();
    const linkedLabel = nodes.find((node) => node.id === comicState.linkedLabelId);
    return {
      context: [
        ...(linkedLabel
          ? [`已关联故事标签「${linkedLabel.title}」：\n${linkedLabel.body}`]
          : []),
        ...selectedContexts.map(
          (node, index) =>
            `素材 ${index + 1}「${node.title}」：${node.generationPrompt || node.body || "视觉参考"}`,
        ),
      ],
      visuals: selectedContexts
        .filter((node) => node.kind === "image" && node.mediaUrl)
        .map((node) => node.mediaUrl!),
    };
  },
  renderBrief: renderComicBrief,
  renderPlan: renderComicPlan,
  setInteractionLocked: setComicInteractionLocked,
  invalidateSession: () => comicSessionController.invalidate(),
  restoreSession: () => restoreComicSession(true),
  showToast: (message, tone) => showToast(message, tone),
});
function requestComicPlan() {
  return comicPlanController.submit();
}
const comicOutputController = new ComicOutputController({
  state: comicState,
  getNodes: () => nodes,
  prepareCanvas: () => {
    resetMarqueeRightGesture();
    if (selection.multiSelectMode) exitMultiSelectMode();
  },
  applyPlan: (result) => promptAgentFeature.application.applyPlan(result),
  closeStudio: closeComicStudio,
  onWorkflowReady: (stats) => {
    showToast(
      `工作流已铺到画布：${stats.characterCount} 个角色、${stats.propCount} 个道具、${stats.sceneCount} 个场景、${stats.storyboardCount} 张关键帧${stats.compositeCount ? `、${stats.compositeCount} 张合成底图` : ""}`,
      "success",
    );
    window.setTimeout(
      () =>
        showCanvasGuide({
          key: "comic-empty-images-guide",
          title: "连续分镜工作流已就绪",
          detail: `每次生图最多使用 2 张参考${stats.compositeCount ? `，${stats.compositeCount} 个复杂画面会逐层合成` : ""}；检查素材和提示词后，可点击顶栏“启动空图”。`,
          tone: "online",
          priority: 58,
          duration: 10000,
          actions: [
            {
              label: "知道了",
              run: () => hideCanvasGuide("comic-empty-images-guide"),
            },
            {
              label: "启动空图",
              primary: true,
              run: () => {
                hideCanvasGuide("comic-empty-images-guide");
                startAllEmptyImages();
              },
            },
          ],
        }),
      420,
    );
  },
  onWorkflowError: (message, shots, nodeCount) => {
    showToast("铺设漫剧工作流失败", "error", message);
    clientLog("comic_canvas_apply_failed", { message, shots, nodes: nodeCount });
  },
  createLabel: () => {
    const rightEdge = nodes.length
      ? Math.max(...nodes.map((node) => node.x + node.width))
      : world({ x: innerWidth / 2, y: innerHeight / 2 }).x - 220;
    addNode("prompt", {
      x: rightEdge + 180,
      y: world({ x: innerWidth / 2, y: innerHeight / 2 }).y - 280,
    });
    return nodes.find((node) => node.id === selection.selectedId);
  },
  renderLabelState: renderComicLabelState,
  persistCanvas: scheduleSave,
  draw,
  showSaved: (copy) =>
    showToast(
      copy ? "漫剧方案已另存为新标签" : "漫剧方案已保存并可继续修改",
      "success",
    ),
});
function applyComicToCanvas() {
  comicOutputController.applyToCanvas();
}
function saveComicAsLabel(copy = false) {
  comicOutputController.saveAsLabel(copy);
}
const comicNewSession = new ComicNewSessionController({
  studio: comicStudio,
  state: comicState,
  closeMobilePanel: () => showComicMobilePanel(null),
  resetConversation: () => resetComicConversationState(true),
  renderLabelState: renderComicLabelState,
  notify: (message, tone) => showToast(message, tone),
});
new ComicStudioInteractionController({
  studio: comicStudio,
  briefPanel: comicBriefPanel,
  planPanel: comicPlanSidePanel,
  headerNav: comicHeaderNav,
  submitting: () => comicState.submitting,
  close: closeComicStudio,
  newSession: () => comicNewSession.start(),
  send: (message) => { void requestComicDialogue(message); },
  requestPlan: () => { void requestComicPlan(); },
  applyCanvas: applyComicToCanvas,
  saveLabel: saveComicAsLabel,
  closeMobilePanel: () => showComicMobilePanel(null),
  renderLabelMenu: renderComicLabelMenu,
}).bind();
const canvasClearResultApplier = new CanvasClearResultApplier({
  nodes,
  links,
  camera,
  normalizeLinks: normalizeCanvasLinks,
  applySnapshot: (version, updatedAt) =>
    canvasSaveCoordinator.applyAuthoritativeSnapshot(
      captureCanvasSnapshot(
        version,
        updatedAt || canvasSaveCoordinator.serverUpdatedAt,
      ),
    ),
  clearSelection: () => { selection.selectedId = 0; },
  resetHistory: () => resetCanvasHistory(false),
  updateEditor,
  markSaved: () => setSaveState("saved", "已自动保存"),
  draw,
  notify: (count) => showToast(`已清除画布内容，保留 ${count} 个标签`, "success"),
});
new CanvasClearController({
  button: document.querySelector<HTMLElement>("#dock-clear")!,
  getNodeCount: () => nodes.length,
  getProjectId: () => currentProjectId,
  getServerVersion: () => canvasSaveCoordinator.serverVersion,
  prepareForClear: () => canvasSaveCoordinator.prepareExclusiveMutation(),
  applyResult: (result) => canvasClearResultApplier.apply(result),
  recoverCanvas: () => loadCanvas(),
  toast: (message, tone, detail) => showToast(message, tone, detail),
});

const panelBackdrop = document.querySelector<HTMLElement>("#panel-backdrop")!;
const workspacePanels =
  document.querySelectorAll<HTMLElement>(".workspace-panel");
const workspaceBrand = document.querySelector<HTMLElement>(".topbar .brand")!,
  mobileNavToggle =
    document.querySelector<HTMLButtonElement>("#mobile-nav-toggle")!;
let assetLibraryFeature: AssetLibraryFeature;
const workspacePanelController = new WorkspacePanelController(
  workspacePanels,
  panelBackdrop,
  workspaceBrand,
  mobileNavToggle,
  () => {
    assetLibraryFeature?.setImageTarget(null);
  },
);
function closeMobileWorkspaceMenu() {
  workspacePanelController.closeMobileMenu();
}
topbarMenus.register("workspace", closeMobileWorkspaceMenu);
function closeWorkspacePanels() {
  workspacePanelController.close();
}
function openWorkspacePanel(id: string, trigger: string) {
  workspacePanelController.open(
    document.querySelector<HTMLElement>(id)!,
    document.querySelector<HTMLElement>(trigger)!,
  );
}
new WorkspaceNavigationCoordinator({
  panels: workspacePanelController,
  brand: workspaceBrand,
  hasAssets: () => assetLibraryFeature.hasAssets,
  loadAssets: () => loadAssets(false),
  renderAssets,
  loadProjects: () => { void projectController.load(); },
  loadSquare: () => { void loadSquare(); },
  toggleTopbar: (opening) => closeTopbarMenus(opening ? "workspace" : undefined),
}).bind();
const assetPreviewController = new AssetPreviewController({
  modal: document.querySelector<HTMLElement>("#asset-preview")!,
  image: document.querySelector<HTMLImageElement>("#preview-image")!,
  video: document.querySelector<HTMLVideoElement>("#preview-video")!,
  name: document.querySelector<HTMLElement>("#preview-name")!,
  closeButton: document.querySelector<HTMLElement>("#close-preview")!,
});
const ASSET_PAGE_SIZE = 36;
assetLibraryFeature = new AssetLibraryFeature({
  nodes,
  getProjectId: () => currentProjectId,
  center: () => world({ x: innerWidth / 2, y: innerHeight / 2 }),
  addMedia: addMediaNode,
  preview: openAssetPreview,
  closePanels: closeWorkspacePanels,
  openPanel: () => openWorkspacePanel("#assets-panel", "#open-assets"),
  invalidateShowcase: () => authWorkspace.invalidateShowcase(),
  deleteCachedImage: (url) => { imageCache.delete(url); },
  selectNode: (id) => { selection.selectedId = id; },
  save: scheduleSave,
  updateEditor,
  draw,
  confirmDelete: async (count) => Boolean(await askProjectDialog({
    title: "删除所选资产？",
    description: `将永久删除所选的 ${count} 项资产，此操作无法撤销。`,
    confirm: "确认删除",
    danger: true,
  })),
  toast: (message, tone, detail) => showToast(message, tone, detail),
});
function openAssetUploadAt(position: Point | null = null) {
  assetLibraryFeature.openUploadAt(position);
}
function beginImageNodeUpload(nodeId: number) {
  assetLibraryFeature.beginNodeUpload(nodeId);
}
async function beginImageNodeLibrary(nodeId: number) {
  await assetLibraryFeature.beginNodeLibrary(nodeId);
}
const projectDialog = document.querySelector<HTMLElement>("#project-dialog")!;
const askProjectDialog = createProjectDialog(projectDialog);
const projectSwitchController = new ProjectSwitchController({
  currentProjectId: () => currentProjectId,
  setCurrentProjectId: (id) => { currentProjectId = id; },
  loadedProjectId: () => canvasSaveCoordinator.loadedProjectId,
  save: saveCanvas,
  stopSave: () => canvasSaveCoordinator.stopAndReset(),
  resetNodeLease: () => canvasNodeIds.reset(),
  closeComic: closeComicStudio,
  resetComic: () => resetComicConversationState(true),
  unlinkComicLabel: () => { comicState.linkedLabelId = 0; },
  loadCanvas: () => loadCanvas(),
  loadAssets: () => loadAssets(),
  closePanels: closeWorkspacePanels,
});
const projectController = new ProjectController({
  list: document.querySelector<HTMLElement>("#project-list")!,
  count: document.querySelector<HTMLElement>("#project-count")!,
  search: document.querySelector<HTMLInputElement>("#project-search")!,
  sort: document.querySelector<HTMLSelectElement>("#project-sort")!,
  newButton: document.querySelector<HTMLElement>("#new-project")!,
  ask: askProjectDialog,
  getCurrentProjectId: () => currentProjectId,
  switchProject,
  deleteCurrentProject: (nextProjectId) =>
    projectSwitchController.selectAfterDelete(nextProjectId),
  toast: (message, type, detail) => showToast(message, type, detail),
});
async function switchProject(projectId: string) {
  await projectSwitchController.switch(projectId);
}
async function loadAssets(render = true) {
  await assetLibraryFeature.load(render);
}
function renderAssets() {
  assetLibraryFeature.render();
}
const squareGrid = document.querySelector<HTMLElement>("#square-grid")!,
  squareSearch = document.querySelector<HTMLInputElement>("#square-search")!;
const squarePanelView = new SquarePanelView({
  grid: squareGrid,
  count: document.querySelector<HTMLElement>("#square-count")!,
  search: squareSearch,
  pageSize: ASSET_PAGE_SIZE,
  onOpen: (asset, kind) => openAssetPreview(asset.url, asset.name, kind),
});
async function loadSquare() {
  await squarePanelView.load();
}
document
  .querySelector("#square-refresh")!
  .addEventListener("click", () => void loadSquare());
function openAssetPreview(
  url: string,
  name: string,
  kind: "image" | "video" = "image",
) {
  assetPreviewController.open(url, name, kind);
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
    assetLibraryFeature.closeContextIfOutside(target),
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
    if (!assetPreviewController.isOpen) return false;
    assetPreviewController.close();
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
