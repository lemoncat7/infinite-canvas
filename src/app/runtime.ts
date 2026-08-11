import "../style.css";
import { CanvasPerformanceMonitor } from "../canvas/performance-monitor";
import { CanvasSpatialIndex } from "../canvas/spatial-index";
import { CanvasGeometryController } from "../canvas/canvas-geometry-controller";
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
import { CanvasSaveCoordinator } from "../canvas/save-coordinator";
import { CanvasLoadCoordinator } from "../canvas/load-coordinator";
import { BatchSelectionController } from "../canvas/batch-selection-controller";
import { CanvasHistoryController } from "../canvas/history-controller";
import { LinkInteractionView } from "../canvas/link-interaction-view";
import { GenerationPoller } from "../services/generation-poller";
import { GenerationWorkflow } from "../services/generation-workflow";
import { requestNodeIdLease } from "../services/node-id-lease";
import { NotificationStreamController } from "../services/notification-stream";
import { SessionActivityController } from "../services/session-activity";
import {
  appendRevisionNode,
  findOutputPosition,
  removeResultNode,
} from "../nodes/generation-node-lifecycle";
import { MediaLifecycleController } from "../canvas/media-lifecycle-controller";
import { NodeMediaRenderer, mediaThumbnailUrl } from "../canvas/node-media-renderer";
import type {
  FlowLink,
  FlowNode,
  GenerationCapabilities,
  NodeKind,
  Point,
  PortSide,
} from "../nodes/node-types";
import { makeNodePublicId } from "../nodes/node-service";
import { NodeLifecycleController } from "../nodes/node-lifecycle-controller";
import { decodePromptClipboardText, normalizePromptText } from "../nodes/prompt-text";
import { downloadNodeImage as downloadNodeImageFile } from "../nodes/node-download";
import { PromptNodeController } from "../nodes/prompt-node";
import { TtsCatalogController } from "../services/tts-catalog";
import { TtsGenerationController } from "../nodes/tts-generation-controller";
import {
  canGenerateNode as evaluateCanGenerateNode,
  generationBlockedReason as evaluateGenerationBlockedReason,
} from "../nodes/generation-eligibility";
import { GenerationSubmitController } from "../nodes/generation-submit-controller";
import { PendingTaskCancellationController } from "../nodes/pending-task-cancellation-controller";
import { apiFetch } from "../services/api";
import { AppUpdateController } from "../services/app-update-controller";
import {
  type GenerationJob,
} from "../services/generation";
import {
  fetchShowcaseAssets,
  type LibraryAsset,
} from "../services/assets";
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
import type {
  ComicPlan,
  ComicShot,
  PromptAgentMode,
  PromptAgentResult,
  PromptAgentStep,
} from "../nodes/comic-types";
import {
  briefFromComicPlan,
  stripCharactersFromScenePrompt,
} from "../nodes/comic-format";
import { bindNodeConfigPanel } from "../ui/node-editor";
import { AssetLibraryView } from "../ui/asset-library-view";
import { AssetLibraryController } from "../ui/asset-library-controller";
import { AssetTouchController } from "../ui/asset-touch-controller";
import { AssetPreviewController } from "../ui/asset-preview";
import { AssetUploadController } from "../ui/asset-upload-controller";
import { AssetContextController } from "../ui/asset-context-controller";
import { AssetBulkController } from "../ui/asset-bulk-controller";
import { SquarePanelView } from "../ui/square-panel";
import { WorkspacePanelController } from "../ui/toolbar";
import { WorkspaceKeyboardController } from "../ui/workspace-keyboard-controller";
import { TaskMonitorController } from "../ui/task-monitor-controller";
import { TopbarMenuCoordinator } from "../ui/topbar-menu-coordinator";
import { QuickNodeMenuController } from "../ui/quick-node-menu-controller";
import { HomeSceneController } from "../ui/home-scene-controller";
import { AppearanceController } from "../ui/appearance-controller";
import { NodeEditorStateController } from "../ui/node-editor-state-controller";
import { CanvasGuideController, type CanvasGuideMessage } from "../ui/canvas-guide-controller";
import { ToastController, type ToastType } from "../ui/toast-controller";
import {
  createProjectDialog,
} from "../ui/dialogs/project-dialog";
import { ProjectController } from "../ui/project-controller";
import {
  UserMenuController,
  type AuthUser,
} from "../ui/user-menu-controller";
import { AuthModalController } from "../ui/auth-modal-controller";
import {
  NotificationCenterController,
  OnlinePresenceView,
} from "../ui/notification-center";
import { FeedbackController } from "../ui/feedback-controller";
import { CreditLabController } from "../ui/credit-lab-controller";
import {
  CustomApiController,
  type CustomApiModel,
} from "../ui/custom-api-controller";
import { PromptAgentControls } from "../ui/prompt-agent-controls";
import { PromptAgentContextController } from "../ui/prompt-agent-context";
import { PromptAgentRequestController } from "../ui/prompt-agent-request-controller";
import { PromptAgentAnimationController } from "../ui/prompt-agent-animation";
import { createComicStudioShell } from "../ui/comic-studio-shell";
import { ComicSidePanelController } from "../ui/comic-side-panel";
import { ComicStudioView } from "../ui/comic-studio";
import { ComicSessionRecoveryView } from "../ui/comic-session-recovery";
import { ComicDialogueController } from "../ui/comic-dialogue-controller";
import { ComicPlanController } from "../ui/comic-plan-controller";
import { ComicOutputController } from "../ui/comic-output-controller";
import { ComicLabelController } from "../ui/comic-labels";
import {
  PromptAgentApplicationController,
} from "../nodes/prompt-agent-application";
import { BoundNodeViewFactory } from "../nodes/bound-node-view-factory";
import { BoundNodeDomSynchronizer } from "../nodes/bound-node-dom-synchronizer";
import { createDefaultGenerationCapabilities } from "./state";
import { WorkspaceSessionController } from "./workspace-session-controller";
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
const ttsCatalog = new TtsCatalogController({
  invalidateProviders: () => {
    nodes
      .filter((node) => node.kind === "voice")
      .forEach((node) => nodeDomStates.delete(node.id));
    draw();
  },
  invalidateVoices: (providerId) => {
    nodes
      .filter(
        (node) =>
          node.kind === "voice" &&
          node.voiceSettings?.providerId === providerId,
      )
      .forEach((node) => nodeDomStates.delete(node.id));
    draw();
  },
});
function loadTtsProviders() {
  return ttsCatalog.loadProviders();
}
function loadTtsVoices(providerId = "easyvoice-local") {
  return ttsCatalog.loadVoices(providerId);
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
let nextId = 1;
let canvasNodeIdBlockEnd = 0;
let canvasNodeIdLeasePromise: Promise<boolean> | null = null;
let contextPosition: Point = { x: 0, y: 0 };
const connection = new CanvasConnectionController();
let connectionAutoPanFrame = 0,
  connectionAutoPanPointer: Point | null = null;
let currentProjectId = localStorage.getItem("flow-project-id") ?? "default";
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
  return {
    nodes: structuredClone(nodes),
    links: structuredClone(links),
    camera: { ...camera },
    version: version ?? canvasSaveCoordinator.serverVersion,
    updatedAt: updatedAt ?? canvasSaveCoordinator.serverUpdatedAt,
  };
}
function applySynchronizedCanvas(
  snapshot: CanvasSyncSnapshot,
  preserveSelection = true,
) {
  const selected = preserveSelection ? selection.selectedId : 0,
    currentNodes = new Map(nodes.map((node) => [String(node.id), node])),
    mergedNodes = snapshot.nodes.map((source) => {
      const current = currentNodes.get(String(source.id));
      if (!current) return structuredClone(source);
      const mutable = current as unknown as Record<string, unknown>;
      for (const key of Object.keys(mutable))
        if (!(key in source)) delete mutable[key];
      Object.assign(current, structuredClone(source));
      return current;
    });
  nodes.splice(0, nodes.length, ...mergedNodes);
  links.splice(0, links.length, ...structuredClone(snapshot.links));
  Object.assign(camera, snapshot.camera);
  cameraViewport.syncTarget();
  nextId = Math.max(
    nextId,
    nodes.length ? Math.max(...nodes.map((node) => node.id)) + 1 : 1,
  );
  selection.selectedId = nodes.some((node) => node.id === selected) ? selected : 0;
  updateEditor();
  draw();
}
async function reserveCanvasNodeIds(projectId = currentProjectId) {
  if (canvasNodeIdLeasePromise) return canvasNodeIdLeasePromise;
  canvasNodeIdLeasePromise = (async () => {
    try {
      const result = await requestNodeIdLease(projectId);
      if (projectId !== currentProjectId) return false;
      nextId = result.start;
      canvasNodeIdBlockEnd = result.end;
      return true;
    } catch {
      return false;
    } finally {
      canvasNodeIdLeasePromise = null;
    }
  })();
  return canvasNodeIdLeasePromise;
}
function allocateCanvasNodeId() {
  if (nextId <= canvasNodeIdBlockEnd) return nextId++;
  showToast("正在扩展节点编号空间，请稍后重试", "warning");
  void reserveCanvasNodeIds();
  return null;
}
let backgroundMode: "dots" | "lines" | "blank" = "lines";
let colorTheme: "light" | "dark" =
  localStorage.getItem("flow-theme") === "light" ? "light" : "dark";
document.body.dataset.theme = colorTheme;
function clientLog(event: string, details: unknown = {}) {
  const payload = {
    event,
    details,
    userAgent: navigator.userAgent,
    path: location.pathname,
    timestamp: new Date().toISOString(),
  };
  console.info("[client-diagnostic]", payload);
  void apiFetch("/api/client-logs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {});
}
window.addEventListener("error", (event) =>
  clientLog("window-error", {
    message: event.message,
    file: event.filename,
    line: event.lineno,
    column: event.colno,
    stack: event.error?.stack,
  }),
);
window.addEventListener("unhandledrejection", (event) =>
  clientLog("unhandled-rejection", {
    reason:
      event.reason instanceof Error
        ? { message: event.reason.message, stack: event.reason.stack }
        : String(event.reason),
  }),
);
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
  nextId: () => nextId,
  setNextId: (value) => { nextId = value; },
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
function commitCanvasHistory() { canvasHistory.commit(); }
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
  getUser: () => authUser,
  setUser: (user) => { authUser = user; },
  renderUser: renderAuthenticatedUser,
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
let promptAgentContextSelection = new Set<number>();
let promptAgentSelecting = false;
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
  isAgentSelected: (id) => promptAgentContextSelection.has(id),
  agentSelectionSize: () => promptAgentContextSelection.size,
  toggleAgentSelection: (id) => {
    if (promptAgentContextSelection.has(id)) promptAgentContextSelection.delete(id);
    else promptAgentContextSelection.add(id);
  },
  renderAgentSelection: () => renderPromptAgentContext(false),
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
let drawFrame: number | null = null;
let drawNeedsDomSync = true;
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
const mediaLifecycle = new MediaLifecycleController({
  mobile: innerWidth <= 780,
  nodeLayer,
  suspendRenderer: () => pixiRenderer?.suspend(),
  resumeRenderer: () => pixiRenderer?.resume(),
  clearNodeStates: () => nodeDomStates.clear(),
  resize,
  draw,
});
const pendingMediaLoads = mediaLifecycle.pendingLoads;
const imageCache = mediaLifecycle.cache;
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
    customApiModels.find((item) => `custom:${item.id}` === value)?.name ||
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

let serviceKnownOffline = false;
function hideCanvasGuide(key?: string) {
  canvasGuideController.hide(key);
}
function showCanvasGuide(message: CanvasGuideMessage) {
  return canvasGuideController.show(message);
}
const appUpdateController = new AppUpdateController({
  authenticated: () => Boolean(authUser),
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

const homePage = document.querySelector<HTMLElement>("#home-page")!;
const homeGallery = document.querySelector<HTMLElement>("#home-gallery")!;
const homeLoginModal =
  document.querySelector<HTMLElement>("#home-login-modal")!;
const homePreview = document.querySelector<HTMLElement>("#home-preview")!;
let authUser: AuthUser | null = null;
let customApiModels: CustomApiModel[] = [];
let authReady = false;
let showcaseLoaded = false;
const sessionActivity = new SessionActivityController({
  isAuthenticated: () => Boolean(authUser),
  logout: (message) => logoutToHome(message),
});
const authModalController = new AuthModalController({
  modal: homeLoginModal,
  onAuthenticated: async (user, completedMode) => {
    authUser = user;
    authReady = true;
    sessionActivity.touch();
    renderAuthenticatedUser();
    if (!(await synchronizeCanvasAfterAuthentication()))
      throw new Error("登录成功，但画布未能完整同步，请重试");
    if (completedMode === "register") {
      location.hash = "#/canvas";
      await Promise.all([loadAssets(), loadCustomApiModels()]);
      applyAppRoute();
    } else showToast(`欢迎回来，${user.name}`, "success");
  },
});
const workspaceBootStatus = document.createElement("div");
workspaceBootStatus.className = "workspace-boot-status";
workspaceBootStatus.innerHTML = "<i></i><span>正在检测登录状态</span>";
document.body.append(workspaceBootStatus);
let workspaceBootStatusVersion = 0;
function setWorkspaceBootStatus(message: string, visible = true) {
  const version = ++workspaceBootStatusVersion;
  workspaceBootStatus.querySelector("span")!.textContent = message;
  workspaceBootStatus.classList.toggle(
    "visible",
    visible &&
      (location.hash === "#/canvas" ||
        document.body.classList.contains("workspace-preparing")),
  );
  return version;
}
function hideWorkspaceBootStatusAfter(version: number, delay: number) {
  window.setTimeout(() => {
    if (workspaceBootStatusVersion === version)
      setWorkspaceBootStatus("", false);
  }, delay);
}
function randomizeHomeTheme() {
  const theme =
    crypto.getRandomValues(new Uint8Array(1))[0] % 2 ? "dark" : "light";
  homePage.dataset.homeTheme = theme;
  document.body.dataset.homeTheme = theme;
}
function applyAppRoute() {
  const home = location.hash !== "#/canvas" || !authUser;
  const wasHome = document.body.classList.contains("home-mode");
  if (home && !wasHome) randomizeHomeTheme();
  document.body.classList.toggle("home-mode", home);
  if (home && !showcaseLoaded) void loadShowcase();
  if (!home) requestAnimationFrame(resize);
  if (authReady && location.hash === "#/canvas" && !authUser) openAuth("login");
}
function requestWorkspace() {
  if (authUser) void enterWorkspace();
  else openAuth("register");
}
function openAuth(mode: "login" | "register") {
  authModalController.open(mode);
}
function renderAuthenticatedUser() {
  userMenuController.render(authUser);
  if (authUser) {
    void notificationCenter.load();
    connectNotificationStream();
  } else disconnectNotificationStream();
}
const workspaceSession = new WorkspaceSessionController({
  nodes,
  links,
  authenticated: () => Boolean(authUser),
  currentProjectId: () => currentProjectId,
  setCurrentProjectId: (id) => { currentProjectId = id; },
  loginMode: () => authModalController.mode,
  loadedProjectId: () => canvasSaveCoordinator.loadedProjectId,
  saveBlocked: () => canvasSaveCoordinator.blocked,
  serverVersion: () => canvasSaveCoordinator.serverVersion,
  ensureRenderer: ensurePixiRenderer,
  stopSave: (logout) => canvasSaveCoordinator.stopAndReset(logout),
  resetNodeLease: () => { canvasNodeIdBlockEnd = 0; },
  loadCanvas: (keepStatus) => loadCanvas(keepStatus),
  loadAssets: () => loadAssets(false),
  loadModels: () => loadCustomApiModels(),
  apiFetch,
  status: setWorkspaceBootStatus,
  hideStatus: hideWorkspaceBootStatusAfter,
  applyRoute: applyAppRoute,
  clearSelection: () => { selection.selectedId = 0; },
  clearToken: () => userMenuController.clearToken(),
  closeUserMenu: () => userMenuController.close(),
  renderUser: renderAuthenticatedUser,
  clearUser: () => { authUser = null; },
  notify: (message, type, detail) => showToast(message, type, detail),
});
async function ensureCurrentUserProject() {
  return workspaceSession.ensureCurrentProject();
}
async function synchronizeCanvasAfterAuthentication(force = false) {
  return workspaceSession.synchronize(force);
}
async function enterWorkspace() {
  await workspaceSession.enter();
}
async function loadShowcase() {
  showcaseLoaded = true;
  try {
    const response = await apiFetch("/api/showcase");
    if (!response.ok) throw new Error(String(response.status));
    const assets = (await response.json()) as Array<{
      id: string;
      name: string;
      mimeType: string;
      createdAt: string;
      author: string;
      url: string;
      thumbnailUrl?: string;
    }>;
    if (!assets.length) return;
    homeGallery.innerHTML = "";
    for (const asset of assets) {
      const video = asset.mimeType.startsWith("video/"),
        card = document.createElement("article");
      card.className = "home-gallery-card";
      card.tabIndex = 0;
      card.innerHTML = `<img src="${asset.thumbnailUrl || mediaThumbnailUrl(asset.url)}" alt="${escapeHtml(asset.name)}" loading="lazy" decoding="async"><i>${video ? "▶" : "⌕"}</i><footer><strong>${escapeHtml(asset.name)}</strong><small>${escapeHtml(asset.author || "Flow 创作者")}</small></footer>`;
      const open = () => openHomePreview(asset);
      card.addEventListener("click", open);
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter") open();
      });
      homeGallery.append(card);
    }
  } catch {
    homeGallery.innerHTML =
      '<div class="home-gallery-empty"><i>◇</i><b>作品暂时无法加载</b><span>稍后刷新页面再试</span></div>';
  }
}
function openHomePreview(asset: {
  name: string;
  mimeType: string;
  author: string;
  url: string;
}) {
  const image = homePreview.querySelector<HTMLImageElement>("img")!,
    video = homePreview.querySelector<HTMLVideoElement>("video")!,
    isVideo = asset.mimeType.startsWith("video/");
  image.hidden = isVideo;
  video.hidden = !isVideo;
  if (isVideo) {
    video.src = asset.url;
    void video.play().catch(() => {});
  } else {
    image.src = asset.url;
    image.alt = asset.name;
  }
  homePreview.querySelector<HTMLElement>("strong")!.textContent = asset.name;
  homePreview.querySelector<HTMLElement>("footer span")!.textContent =
    asset.author || "Flow 创作者";
  homePreview.classList.add("open");
}
function closeHomePreview() {
  const video = homePreview.querySelector<HTMLVideoElement>("video")!;
  video.pause();
  video.removeAttribute("src");
  homePreview.querySelector<HTMLImageElement>("img")!.removeAttribute("src");
  homePreview.classList.remove("open");
}
document.querySelector("#home-login")!.addEventListener("click", () => {
  if (!authUser) openAuth("login");
});
document
  .querySelector("#home-enter")!
  .addEventListener("click", requestWorkspace);
document
  .querySelector("#home-start")!
  .addEventListener("click", requestWorkspace);
const showcaseSection = document.querySelector<HTMLElement>(".home-showcase")!;
const showcaseObserver = new IntersectionObserver(
  (entries) => {
    if (entries.some((entry) => entry.isIntersecting)) {
      showcaseSection.classList.add("revealed");
      showcaseObserver.disconnect();
    }
  },
  { threshold: 0.12 },
);
showcaseObserver.observe(showcaseSection);
new HomeSceneController(homePage, homeLoginModal, homePreview);
homePreview
  .querySelector(":scope > button")!
  .addEventListener("click", closeHomePreview);
homePreview.addEventListener("click", (event) => {
  if (event.target === homePreview) closeHomePreview();
});
const workspaceUserMenu = document.querySelector<HTMLElement>(
  "#workspace-user-menu",
)!;
topbarMenus.register("user", () => workspaceUserMenu.classList.remove("open"));
async function logoutToHome(message?: string) {
  await workspaceSession.logout(message);
}
const userMenuController = new UserMenuController({
  menu: workspaceUserMenu,
  button: document.querySelector<HTMLButtonElement>("#workspace-user")!,
  homeLogin: document.querySelector<HTMLButtonElement>("#home-login")!,
  homeEnter: document.querySelector<HTMLButtonElement>("#home-enter")!,
  logoutButton: document.querySelector<HTMLElement>("#workspace-logout")!,
  inviteCopyButton:
    document.querySelector<HTMLButtonElement>("#copy-invite-code")!,
  getUser: () => authUser,
  setUser: (user) => {
    authUser = user;
  },
  closeTopbarMenus: (opening) =>
    closeTopbarMenus(opening ? "user" : undefined),
  logout: () => logoutToHome(),
  toast: (message, type) => showToast(message, type),
});
const feedbackModal = document.querySelector<HTMLElement>("#feedback-modal")!,
  feedbackForm =
    feedbackModal.querySelector<HTMLFormElement>("#feedback-form")!;
const notificationModal = document.querySelector<HTMLElement>(
    "#notification-modal",
  )!,
  notificationList =
    notificationModal.querySelector<HTMLElement>("#notification-list")!,
  notificationCount = document.querySelector<HTMLElement>(
    "[data-notification-count]",
  )!;
topbarMenus.register("notifications", () =>
  notificationModal.classList.remove("open"),
);
const notificationCenter = new NotificationCenterController({
  modal: notificationModal,
  list: notificationList,
  count: notificationCount,
  openButton: document.querySelector<HTMLElement>("#open-notifications")!,
  getUserId: () => authUser?.id,
  closeTopbarMenus: (opening) =>
    closeTopbarMenus(opening ? "notifications" : undefined),
  toast: (message, type) => showToast(message, type),
});
const onlinePresenceView = new OnlinePresenceView(
  document.querySelector("#open-notifications")!,
  (opening) => closeTopbarMenus(opening ? "presence" : undefined),
);
const renderOnlineStatus = (
  count = onlinePresenceView.current(),
  reconnecting = false,
) => onlinePresenceView.render(count, reconnecting);
function showServiceStatusNotice(mode: "offline" | "online") {
  serviceKnownOffline = mode === "offline";
  showCanvasGuide(
    mode === "offline"
      ? {
          key: "service-status",
          title: "服务器暂时离线",
          detail: "正在后台尝试重新连接，恢复后会自动同步。",
          tone: "offline",
          priority: 100,
        }
      : {
          key: "service-status",
          title: "已重新连接",
          detail: "通知和创作状态已恢复同步。",
          tone: "online",
          priority: 100,
          duration: 2600,
        },
  );
}
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
const notificationStreamController = new NotificationStreamController({
  isAuthenticated: () => Boolean(authUser),
  isServiceKnownOffline: () => serviceKnownOffline,
  isServiceGuideVisible: () => canvasGuideController.isVisible("service-status"),
  renderPresence: renderOnlineStatus,
  currentPresence: () => onlinePresenceView.current(),
  clearPresence: () => onlinePresenceView.clear(),
  onNotifications: () => {
    void notificationCenter.load();
  },
  onServerVersionChanged: () => void appUpdateController.checkNow(),
  onServiceStatus: showServiceStatusNotice,
  onReconnect: () => void restoreComicAfterReconnect(),
});
function disconnectNotificationStream(clearPresence = true) {
  notificationStreamController.disconnect(clearPresence);
  hideCanvasGuide("service-status");
}
function connectNotificationStream() {
  if (!authUser) return disconnectNotificationStream();
  notificationStreamController.connect(authUser.id);
}
new FeedbackController({
  modal: feedbackModal,
  form: feedbackForm,
  openButton: document.querySelector<HTMLElement>("#open-feedback")!,
  closeUserMenu: () => userMenuController.close(),
  getProjectId: () => currentProjectId,
  toast: (message, type) => showToast(message, type),
});
const labModal = document.querySelector<HTMLElement>("#lab-modal")!;
new CreditLabController({
  modal: labModal,
  openButton: document.querySelector<HTMLElement>("#open-lab")!,
  getUser: () => authUser,
  setUser: (user) => {
    authUser = user;
  },
  closeUserMenu: () => userMenuController.close(),
  onCreditsChanged: () => {
    renderAuthenticatedUser();
    refreshNodeModelMenus();
  },
  toast: (message, type) => showToast(message, type),
});
const customApiModal =
    document.querySelector<HTMLElement>("#custom-api-modal")!,
  customApiForm = document.querySelector<HTMLFormElement>("#custom-api-form")!,
  customApiList = document.querySelector<HTMLElement>("#custom-api-list")!;
function refreshNodeModelMenus() {
  nodeLayer
    .querySelectorAll(".flow-node")
    .forEach((element) => element.remove());
  draw();
}
const customApiController = new CustomApiController({
  modal: customApiModal,
  form: customApiForm,
  list: customApiList,
  openButton: document.querySelector<HTMLButtonElement>("#open-custom-api")!,
  getModels: () => customApiModels,
  setModels: (models) => {
    customApiModels = models;
  },
  closeUserMenu: () => userMenuController.close(),
  refreshNodeModels: refreshNodeModelMenus,
});
const loadCustomApiModels = () => customApiController.load();
window.addEventListener("hashchange", applyAppRoute);
applyAppRoute();

const viewportSize = () => ({ width: innerWidth, height: innerHeight });
const screen = (point: Point) =>
  worldToScreen(point, camera, viewportSize());
const world = (point: Point) =>
  screenToWorld(point, camera, viewportSize());
const portWorld = nodePortPosition;
const controlPoint = connectionControlPoint;

function nodeIsActivelyGenerating(node: FlowNode | undefined) {
  return node?.status === "queued" || node?.status === "running";
}
function canvasHasActiveGeneration() {
  return nodes.some((node) => nodeIsActivelyGenerating(node));
}
function nodeFeedsActiveGeneration(nodeId: number) {
  const visited = new Set<number>();
  const pending = [nodeId];
  while (pending.length) {
    const currentId = pending.pop()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);
    if (
      currentId !== nodeId &&
      nodeIsActivelyGenerating(nodes.find((node) => node.id === currentId))
    )
      return true;
    links
      .filter((link) => link.from === currentId)
      .forEach((link) => pending.push(link.to));
  }
  return false;
}
function nodeIsGenerationProtected(node: FlowNode) {
  return nodeIsActivelyGenerating(node) || nodeFeedsActiveGeneration(node.id);
}
function orderedImageInputs(targetId: number) {
  return links
    .filter((link) => link.to === targetId)
    .map((link) => ({
      link,
      node: nodes.find((node) => node.id === link.from),
    }))
    .filter((input): input is { link: FlowLink; node: FlowNode } =>
      Boolean(input.node?.kind === "image" && input.node.mediaUrl),
    )
    .sort(
      (left, right) =>
        left.node.y - right.node.y ||
        left.node.x - right.node.x ||
        left.node.id - right.node.id,
    );
}
function imageInputOrder(link: FlowLink) {
  const index = orderedImageInputs(link.to).findIndex(
    (input) => input.link === link,
  );
  return index < 0 ? undefined : index + 1;
}
function orderedTargetLinks(targetId: number) {
  return links
    .filter((link) => link.to === targetId)
    .map((link, originalIndex) => ({
      link,
      originalIndex,
      source: nodes.find((node) => node.id === link.from),
    }))
    .sort((left, right) => {
      const leftOrder = left.link.inputOrder ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = right.link.inputOrder ?? Number.MAX_SAFE_INTEGER;
      return (
        leftOrder - rightOrder ||
        (left.source?.y ?? 0) - (right.source?.y ?? 0) ||
        (left.source?.x ?? 0) - (right.source?.x ?? 0) ||
        left.originalIndex - right.originalIndex
      );
    })
    .map((item) => item.link);
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
function linkPathGeometry(link: FlowLink) {
  return canvasGeometry.linkPath(link);
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
  if (firstId === secondId || firstSide !== "right" || secondSide !== "left")
    return null;
  const source = nodes.find((node) => node.id === firstId),
    target = nodes.find((node) => node.id === secondId);
  if (!source || !target) return null;
  if (
    target.kind === "voice" &&
    (source.kind !== "image" || !/\bBase\b/i.test(source.title))
  ) {
    showToast("语音配置只能关联角色 Base 卡片", "warning");
    return null;
  }
  if (target.kind === "voice" && links.some((link) => link.to === target.id)) {
    showToast("一个固定音色只能关联一个 Base 角色", "warning");
    return null;
  }
  if (target.kind === "tts" && source.kind !== "voice") {
    showToast("TTS 文本卡片只能接收语音配置", "warning");
    return null;
  }
  if (
    target.kind === "tts" &&
    links.some(
      (link) =>
        link.to === target.id &&
        nodes.find((node) => node.id === link.from)?.kind === "voice",
    )
  ) {
    showToast("一张 TTS 卡片只能连接一个固定音色", "warning");
    return null;
  }
  if (target.kind === "audio") {
    showToast("音频结果由 TTS 生成，无需手动连接", "warning");
    return null;
  }
  return { from: firstId, to: secondId, fromSide: "right", toSide: "left" };
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
function stopConnectionAutoPan() {
  if (connectionAutoPanFrame) cancelAnimationFrame(connectionAutoPanFrame);
  connectionAutoPanFrame = 0;
  connectionAutoPanPointer = null;
}
function startConnectionAutoPan(sx: number, sy: number) {
  connectionAutoPanPointer = { x: sx, y: sy };
  if (connectionAutoPanFrame) return;
  let previous = performance.now();
  const tick = (now: number) => {
    if (!connection.active || !connectionAutoPanPointer) {
      connectionAutoPanFrame = 0;
      return;
    }
    const elapsed = Math.min(2, (now - previous) / 16.67),
      edge = 88,
      maxSpeed = 14,
      axisSpeed = (position: number, limit: number) =>
        position < edge
          ? -Math.min(1, Math.max(0, 1 - position / edge)) * maxSpeed
          : position > limit - edge
            ? Math.min(1, Math.max(0, 1 - (limit - position) / edge)) * maxSpeed
            : 0,
      vx = axisSpeed(connectionAutoPanPointer.x, innerWidth),
      vy = axisSpeed(connectionAutoPanPointer.y, innerHeight);
    if (vx || vy) {
      camera.x -= vx * elapsed;
      camera.y -= vy * elapsed;
      updateConnectionPointer(
        connectionAutoPanPointer.x,
        connectionAutoPanPointer.y,
      );
      draw(false);
    }
    previous = now;
    connectionAutoPanFrame = requestAnimationFrame(tick);
  };
  connectionAutoPanFrame = requestAnimationFrame(tick);
}
function hitLink(sx: number, sy: number, tolerance = 9) {
  return canvasGeometry.hitLink(sx, sy, tolerance);
}
function positionCardLayerForFrame() {
  nodeViewport.style.transform = `translate3d(${innerWidth / 2 + camera.x}px, ${innerHeight / 2 + camera.y}px,0) scale(${camera.zoom})`;
}
const mountedDomNodeIds = new Set<number>();
function paint() {
  const performanceFrame = canvasPerformance.beginFrame();
  drawFrame = null;
  const interacting = canvasInteractionActive(),
    syncUi = drawNeedsDomSync && !interacting;
  if (syncUi) drawNeedsDomSync = false;
  if (syncUi || canvasGeometry.nodeIndex.size !== nodes.length)
    rebuildPaintIndexes();
  positionCardLayerForFrame();
  if (syncUi) {
    syncDomNodes();
    schedulePixiEditorWarmup();
    updateTaskMonitor();
    updateHistoryControls();
    zoomSlider.value = String(Math.round(camera.zoom * 100));
    zoomSlider.title = `${Math.round(camera.zoom * 100)}%`;
    zoomPercent.value = `${Math.round(camera.zoom * 100)}%`;
    nodeCount.textContent = String(nodes.length);
  }
  const pendingNode = connection.active
    ? canvasGeometry.nodeIndex.get(connection.active.nodeId) ??
      nodes.find((node) => node.id === connection.active!.nodeId)
    : undefined;
  pixiRenderer?.render({
    nodes,
    links,
    domNodeIds: [...mountedDomNodeIds],
    camera,
    selectedId: selection.selectedId,
    selectedIds: [
      ...new Set([...selection.batchIds, ...promptAgentContextSelection]),
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
  });
  canvasPerformance.endFrame(performanceFrame);
}
function draw(syncDom = true) {
  if (syncDom) drawNeedsDomSync = true;
  if (drawFrame === null) drawFrame = requestAnimationFrame(paint);
}
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
  isAgentSelecting: () => promptAgentSelecting,
  getAgentIds: () => promptAgentContextSelection,
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
  getProviders: () => ttsCatalog.providers,
  getVoices: () => ttsCatalog.voicesByProvider,
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
  authUser: () => authUser,
  customApiModels: () => customApiModels,
  generationCapabilities: () => generationCapabilities,
  getSelectedId: () => selection.selectedId,
  setSelectedId: (id) => { selection.selectedId = id; },
  isMultiSelectMode: () => selection.multiSelectMode,
  getDrag: () => domPointer.drag,
  setDrag: (drag) => { domPointer.drag = drag; },
  beginResize: (value) => domPointer.beginResize(value),
  isReleaseSuppressed: domPointer.isReleaseSuppressed,
  isAgentSelecting: () => promptAgentSelecting,
  isAgentCreateMode: () => promptAgentControls.mode === "create",
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
const nodeInfoDetails =
  document.querySelector<HTMLElement>("#node-info-details")!;
const nodeInfoJson = document.querySelector<HTMLElement>("#node-info-json")!;
function nodeInfoData(node: FlowNode) {
  node.publicId ||= makeNodePublicId(node.kind);
  return {
    id: node.publicId,
    type: node.kind === "prompt" ? "label" : node.kind,
    title: node.title,
    position: { x: node.x, y: node.y },
    width: node.width,
    height: node.height,
    metadata: {
      content: node.body,
      status: node.status ?? "idle",
      fontSize: Math.round(12 * (node.fontScale ?? 1)),
    },
  };
}
function openNodeInfo(node: FlowNode) {
  const info = nodeInfoData(node);
  const typeLabel =
    node.kind === "prompt"
      ? "标签"
      : node.kind === "image"
        ? "图片"
        : node.kind === "video"
          ? "视频"
          : "便签";
  nodeInfoDetails.innerHTML = `<dl><div><dt>ID</dt><dd>${escapeHtml(info.id)}</dd></div><div><dt>名称</dt><dd>${escapeHtml(info.title)}</dd></div><div><dt>类型</dt><dd>${typeLabel}</dd></div><div><dt>尺寸</dt><dd>${Math.round(info.width)} × ${Math.round(info.height)}</dd></div><div><dt>位置</dt><dd>${Math.round(info.position.x)}, ${Math.round(info.position.y)}</dd></div><div><dt>状态</dt><dd><i></i>${escapeHtml(info.metadata.status)}</dd></div></dl>`;
  nodeInfoJson.textContent = JSON.stringify(info, null, 2);
  nodeInfoDetails.hidden = false;
  nodeInfoJson.hidden = true;
  nodeInfoModal
    .querySelectorAll("[data-info-tab]")
    .forEach((button) =>
      button.classList.toggle(
        "active",
        (button as HTMLElement).dataset.infoTab === "details",
      ),
    );
  nodeInfoModal.classList.add("open");
  scheduleSave();
}
function closeNodeInfo() {
  nodeInfoModal.classList.remove("open");
}
document
  .querySelector("#close-node-info")!
  .addEventListener("click", closeNodeInfo);
nodeInfoModal.addEventListener("click", (event) => {
  if (event.target === nodeInfoModal) closeNodeInfo();
});
nodeInfoModal
  .querySelectorAll<HTMLElement>("[data-info-tab]")
  .forEach((button) =>
    button.addEventListener("click", () => {
      const json = button.dataset.infoTab === "json";
      nodeInfoDetails.hidden = json;
      nodeInfoJson.hidden = !json;
      nodeInfoModal
        .querySelectorAll("[data-info-tab]")
        .forEach((item) => item.classList.toggle("active", item === button));
    }),
  );

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
  nodeMediaRenderer.paint(target, url);
}
function paintNodeVideo(target: HTMLCanvasElement, url: string) {
  paintNodeMedia(target, url);
}
function repaintMediaUrl(url: string) {
  nodeMediaRenderer.repaintUrl(url);
}
function repaintAllMedia() {
  nodeMediaRenderer.repaintAll();
}

const nodeMediaRenderer = new NodeMediaRenderer({
  lifecycle: mediaLifecycle,
  nodes,
  nodeLayer,
  theme: () => colorTheme,
  invalidateNode: (id) => nodeDomStates.delete(id),
  draw,
  refreshAppearance: refreshAppearanceButton,
});

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
      Number(authUser?.credits ?? 0) - Number(authUser?.reservedCredits ?? 0),
    hasConnectedVoice: Boolean(connectedVoiceNode(node)),
  });
}
function generationBlockedReason(node: FlowNode) {
  return evaluateGenerationBlockedReason(node, {
    availableCredits:
      Number(authUser?.credits ?? 0) - Number(authUser?.reservedCredits ?? 0),
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

const canvasSaveCoordinator: CanvasSaveCoordinator = new CanvasSaveCoordinator({
  clientId: canvasSyncClientId,
  authenticated: () => Boolean(authUser),
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
  getLease: () => ({ nextId, end: canvasNodeIdBlockEnd }),
  restoreLease: (leasedNextId, leasedEnd) => {
    nextId = leasedNextId;
    canvasNodeIdBlockEnd = leasedEnd;
  },
  resetLease: (value) => {
    nextId = value;
    canvasNodeIdBlockEnd = 0;
  },
  needsLease: () => nextId > canvasNodeIdBlockEnd,
  reserveIds: reserveCanvasNodeIds,
  syncCamera: () => cameraViewport.syncTarget(),
  setBootStatus: setWorkspaceBootStatus,
  hideBootStatus: hideWorkspaceBootStatusAfter,
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

const ttsGenerationController = new TtsGenerationController({
  nodes,
  links,
  getProjectId: () => currentProjectId,
  allocateNodeId: allocateCanvasNodeId,
  updateEditor,
  draw,
  save: scheduleSave,
  reloadAssets: () => loadAssets(false),
  toast: (message, tone) => showToast(message, tone),
});
function connectedVoiceNode(source: FlowNode) {
  return ttsGenerationController.connectedVoice(source);
}
function previewVoice(voice: FlowNode) {
  return ttsGenerationController.preview(voice);
}
function generateTts(source: FlowNode) {
  return ttsGenerationController.generate(source);
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
  hasAuthenticatedUser: () => Boolean(authUser),
  applyCredits: (creditsAvailable) => {
    if (!authUser) return;
    authUser = {
      ...authUser,
      reservedCredits: Math.max(
        0,
        Number(authUser.credits ?? 0) - creditsAvailable,
      ),
    };
    renderAuthenticatedUser();
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
async function finalizeGenerationJob(currentNode: FlowNode, job: GenerationJob) {
  if (job.status === "succeeded" && job.result_url) {
    currentNode.mediaUrl = job.result_url;
    try {
      const metadata = JSON.parse(job.result_metadata || "{}");
      if (metadata && typeof metadata === "object") currentNode.videoResult = metadata;
    } catch { /* 旧任务没有结果规格 */ }
    imageCache.delete(job.result_url);
    void loadAssets(false).then(() => {
      if (document.querySelector("#assets-panel")?.classList.contains("open")) renderAssets();
    });
    if (currentNode.kind === "video") showToast("视频已生成并加入资产库", "success");
  }
  if (job.status === "failed") {
    const message = job.error || "视频生成失败";
    jobLabel.textContent = `生成失败：${message}`;
    showToast(message, "error");
    if (currentNode.role === "result") removeFailedResult(currentNode);
  }
  if (job.status === "canceled") {
    currentNode.progress = 0;
    if (!currentNode.body.trim()) currentNode.body = normalizePromptText(currentNode.originalPrompt || currentNode.generationPrompt || "");
    delete currentNode.jobId;
    jobLabel.textContent = "任务已取消，可重新生成";
    showToast("等待任务已取消", "warning", "卡片描述和配置已保留，可随时重新生成。");
  }
  try {
    const response = await apiFetch("/api/users/me");
    if (response.ok) {
      const previous = Math.max(0, Number(authUser?.credits ?? 0)-Number(authUser?.reservedCredits ?? 0));
      authUser = (await response.json()) as AuthUser;
      const next = Math.max(0, Number(authUser.credits ?? 0)-Number(authUser.reservedCredits ?? 0));
      renderAuthenticatedUser();
      if (previous >= 1 !== next >= 1 || previous >= 2 !== next >= 2) refreshNodeModelMenus();
    }
  } catch { /* 下次刷新同步余额 */ }
  updateEditor(); draw(); scheduleSave(false); runAgentWorkflow();
}
function pollJob(node: FlowNode) { generationPoller.poll(node); }
function refreshBatchSelection() {
  selection.prune(nodes);
  batchToolbar.classList.toggle("open", selection.batchIds.size > 0);
  const count = batchToolbar.querySelector<HTMLElement>("[data-batch-count]")!;
  count.textContent =
    innerWidth <= 780
      ? `已选 ${selection.batchIds.size}`
      : `已选 ${selection.batchIds.size} 项`;
  count.title = `已选择 ${selection.batchIds.size} 个卡片`;
  if (!selection.batchIds.size) {
    draw();
    return;
  }
  const selected = selection.selectedNodes(nodes),
    left = Math.min(...selected.map((node) => screen(node).x)),
    right = Math.max(
      ...selected.map(
        (node) => screen({ x: node.x + node.width, y: node.y }).x,
      ),
    ),
    top = Math.min(...selected.map((node) => screen(node).y));
  batchToolbar.style.left = `${Math.max(12, Math.min(innerWidth - batchToolbar.offsetWidth - 12, (left + right) / 2 - batchToolbar.offsetWidth / 2))}px`;
  batchToolbar.style.top = `${Math.max(72, top - 58)}px`;
  draw();
}
function clearBatchSelection() {
  selection.clearBatch();
  batchToolbar.classList.remove("open");
  draw();
}
function toggleBatchNode(id: number) {
  selection.toggleBatch(id);
  updateEditor();
  refreshBatchSelection();
}
function refreshCanvasModeHint() {
  const hint = document.querySelector<HTMLElement>(".dock-create-hint")!,
    title = hint.querySelector<HTMLElement>("strong")!,
    detail = hint.querySelector<HTMLElement>("small")!;
  hint.classList.toggle("multi-mode", selection.multiSelectMode);
  if (!selection.multiSelectMode) {
    title.textContent = "双击画布 · 创建卡片";
    detail.textContent = "菜单中可进入多选模式";
  } else {
    title.textContent = "点按卡片 · 选择 / 取消";
    detail.textContent = "长按空白框选 · 双击空白退出";
  }
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
  generationActive: canvasHasActiveGeneration,
  enqueue: (ids) => generationWorkflow.enqueue(ids),
  clearSelection: clearBatchSelection,
  exitMode: exitMultiSelectMode,
  update: updateEditor,
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
document.querySelector("#reset")!.addEventListener("click", cameraViewport.fit);
document
  .querySelector("#mobile-fit-canvas")!
  .addEventListener("click", cameraViewport.fit);
zoomSlider.addEventListener("input", () => {
  cameraViewport.setImmediate(Number(zoomSlider.value) / 100, { x: innerWidth / 2, y: innerHeight / 2 });
});
document
  .querySelector("#zoom-in")!
  .addEventListener("click", () =>
    cameraViewport.smoothBy(1.15, { x: innerWidth / 2, y: innerHeight / 2 }),
  );
document
  .querySelector("#zoom-out")!
  .addEventListener("click", () =>
    cameraViewport.smoothBy(1 / 1.15, { x: innerWidth / 2, y: innerHeight / 2 }),
  );
document
  .querySelector("#quick-create")!
  .addEventListener("click", () => addNode("image"));
generateButton.addEventListener("click", () => void generate());
document
  .querySelector("#delete-node")!
  .addEventListener("click", deleteSelectedNode);
document
  .querySelectorAll<HTMLElement>("[data-add]")
  .forEach((button) =>
    button.addEventListener("click", () =>
      addNode(button.dataset.add as NodeKind),
    ),
  );
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
const promptAgentTrigger = document.querySelector<HTMLButtonElement>(
    "#prompt-agent-trigger",
  )!,
  promptAgentPanel = document.createElement("section");
promptAgentPanel.className = "prompt-agent-panel agent-capsule";
promptAgentPanel.innerHTML = `<aside class="agent-selection-hint" aria-live="polite"><i>◇</i><span>点击卡片选择素材</span><em></em><kbd>右击</kbd><small>退出</small></aside><section class="agent-context"><div data-agent-context-list></div></section><div class="agent-mode"><button type="button" data-agent-mode-trigger aria-label="选择灵感功能" aria-expanded="false"><span>✦</span><b>功能</b><i></i></button><div class="agent-mode-menu"><button type="button" data-agent-comic><b>漫剧</b><small>进入对话式漫剧创作</small></button><button type="button" data-agent-mode="voice"><b>音色</b><small>描述声音并创建语音配置</small></button><div class="agent-prompt-submenu"><button type="button" data-agent-prompt-menu aria-expanded="false"><b>提示词</b><small>选择创作策略</small><i></i></button><div><button type="button" data-agent-mode="create"><b>创作</b><small>选择素材并创建关联节点</small></button><button type="button" data-agent-mode="general"><b>通用</b><small>只生成通用格式 Prompt</small></button><button type="button" data-agent-mode="agnes"><b>Agnes</b><small>只生成 Agnes Video v2.0 Prompt</small></button></div></div></div></div><label class="agent-goal"><textarea rows="1" placeholder="告诉我你想创造什么…" aria-label="创作需求"></textarea></label><button class="agent-submit" type="button" aria-label="开始创作"><span>✦</span><b>开始创作</b></button><output class="agent-status" hidden></output><article hidden><div class="agent-result-meta"><span>执行结果</span><small></small></div><strong data-agent-summary></strong><p data-agent-prompt></p><footer><button type="button" data-agent-undo hidden>撤销</button><button type="button" data-agent-apply hidden>写入选中卡片</button><button type="button" data-agent-copy>复制</button><button type="button" data-agent-locate>定位</button></footer></article>`;
document.body.append(promptAgentPanel);
const promptAgentComicBusyProxy = document.createElement("button");
promptAgentComicBusyProxy.className = "agent-comic-entry";
promptAgentComicBusyProxy.hidden = true;
promptAgentPanel.append(promptAgentComicBusyProxy);
let promptAgentRequests: PromptAgentRequestController | null = null;
const promptAgentControls = new PromptAgentControls({
  panel: promptAgentPanel,
  onComic: openComicStudio,
  onModeChanged: (mode) => {
    promptAgentSelecting =
      mode === "create" && promptAgentPanel.classList.contains("open");
    if (mode !== "create") {
      promptAgentContextSelection.clear();
      renderPromptAgentContext(false);
    }
    draw();
  },
  isBusy: () => Boolean(promptAgentRequests?.busy),
});
const promptAgentGoalInput = promptAgentControls.goalInput;
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
function clearPromptAgentResult() {
  promptAgentRequests?.clearResult();
}
function closePromptAgent() {
  promptAgentAnimation.cancelFormation();
  promptAgentRequests?.cancel();
  promptAgentPanel
    .querySelector(".agent-submit")
    ?.classList.remove("is-running");
  promptAgentPanel.classList.remove("open", "forming");
  promptAgentTrigger.classList.remove("active");
  promptAgentSelecting = false;
  promptAgentContextSelection.clear();
  clearPromptAgentResult();
  draw();
}
function cancelPromptAgentRequest() {
  promptAgentRequests?.cancel();
}
function playAgentMeteor(nodeId: number) {
  const node = nodes.find((item) => item.id === nodeId);
  if (!node) return;
  const panel = promptAgentPanel.getBoundingClientRect(),
    start = {
      x: panel.left + panel.width * 0.25,
      y: panel.top + panel.height * 0.45,
    },
    end = {
      x: innerWidth / 2 + camera.x + (node.x + node.width / 2) * camera.zoom,
      y: innerHeight / 2 + camera.y + (node.y + node.height / 2) * camera.zoom,
    };
  const element = nodeLayer.querySelector<HTMLElement>(
    `.flow-node[data-id="${node.id}"]`,
  );
  promptAgentAnimation.playMeteor(start, end, element);
}
function positionPromptAgentCapsule() {
  promptAgentAnimation.position();
}
const promptAgentContextController = new PromptAgentContextController({
  panel: promptAgentPanel,
  selectedIds: promptAgentContextSelection,
  getNodes: () => nodes,
  getLinks: () => links,
  getPrimarySelectedId: () => selection.selectedId,
  onChanged: () => draw(),
});
function selectedPromptAgentNodes() {
  return promptAgentContextController.selectedNodes();
}
function renderPromptAgentContext(reset = false) {
  promptAgentContextController.render(reset);
}
const promptAgentAnimation = new PromptAgentAnimationController({
  trigger: promptAgentTrigger,
  panel: promptAgentPanel,
  isBusy: () => Boolean(promptAgentRequests?.busy),
  onBusy: () => showToast("提示词生成中，请等待完成", "warning"),
  onClose: closePromptAgent,
  onCancel: cancelPromptAgentRequest,
  onOpen: () => {
    promptAgentContextSelection.clear();
    renderPromptAgentContext(false);
    promptAgentSelecting = true;
    draw();
  },
});
function dispersePromptAgent() { promptAgentAnimation.disperse(true); }
function dispersePromptAgentDirect() { promptAgentAnimation.disperse(false); }
const comicState = new ComicSessionState();
function setComicInteractionLocked(locked: boolean) {
  comicStudioView.setInteractionLocked(locked);
}
function currentComicOwnerKey() {
  return `${authUser?.id || "anonymous"}:${currentProjectId}`;
}
function resetComicConversationState(clearPlan = true) {
  comicState.reset(currentComicOwnerKey(), clearPlan);
  renderComicBrief();
}
async function ensureComicProjectContext() {
  const previousOwner = comicState.ownerKey;
  if (!(await ensureCurrentUserProject())) return false;
  const owner = currentComicOwnerKey();
  if (previousOwner && previousOwner !== owner)
    resetComicConversationState(true);
  comicState.ownerKey = owner;
  return Boolean(currentProjectId);
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
function unlinkComicLabel() {
  comicState.linkedLabelId = 0;
  comicState.originalIdea = "";
  resetComicConversationState(true);
  comicStudio.querySelector<HTMLElement>(".comic-plan")!.hidden = true;
  renderComicLabelState();
}
function selectComicLabel(label: FlowNode) {
  comicState.linkedLabelId = label.id;
  comicState.originalIdea = label.body;
  const stored = label.comicData as ComicPlan | undefined;
  const saved =
    stored?.shots && Array.isArray(stored.shots) ? structuredClone(stored) : null;
  resetComicConversationState(true);
  if (saved) {
    comicState.plan = saved;
    comicState.brief = briefFromComicPlan(saved);
    renderComicPlan(saved);
  } else {
    comicState.plan = null;
    comicState.brief = {
      title: label.title.replace(/^漫剧方案\s*·\s*/, ""),
      premise: label.body.replace(/\s+/g, " ").trim().slice(0, 360),
      aspectRatio: "16:9",
      openQuestions: ["继续对话，确认需要保留和调整的内容"],
    };
    comicStudio.querySelector<HTMLElement>(".comic-plan")!.hidden = true;
  }
  renderComicLabelState();
  renderComicBrief();
  const conversation = comicStudio.querySelector<HTMLElement>(
      "[data-comic-conversation]",
    )!,
    notice = document.createElement("div");
  notice.className = "comic-message assistant compact";
  notice.innerHTML = `<i>◇</i><div><b>${saved ? "已恢复" : "已关联"}《${escapeHtml(label.title)}》</b><p>${saved ? "人物、剧情、风格和分镜已经载入，可以直接继续修改或续写。" : "标签内容已载入当前方案，可继续对话整理为完整剧本。"}</p></div>`;
  conversation.insertBefore(notice, comicStudio.querySelector(".comic-plan"));
  comicStudio.querySelector<HTMLTextAreaElement>("[data-comic-message]")!.focus();
}
const comicLabelController = new ComicLabelController({
  studio: comicStudio,
  getLabels: comicLabels,
  getLinkedId: () => comicState.linkedLabelId,
  onSelect: selectComicLabel,
  onUnlink: unlinkComicLabel,
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
function restoreComicSession(force = false) {
  return comicSessionController.restore(force);
}
async function restoreComicAfterReconnect() {
  if (!comicStudio.classList.contains("open") || !authUser || !currentProjectId)
    return;
  comicSessionController.invalidate();
  await restoreComicSession(true);
}
function openComicStudio() {
  const seed = promptAgentPanel
    .querySelector<HTMLTextAreaElement>("textarea")!
    .value.trim();
  resetMarqueeRightGesture();
  if (selection.multiSelectMode) exitMultiSelectMode();
  closePromptAgent();
  if (comicState.ownerKey && comicState.ownerKey !== currentComicOwnerKey()) {
    resetComicConversationState(true);
    comicSessionController.invalidate();
  }
  comicState.ownerKey = currentComicOwnerKey();
  comicStudio.classList.add("open");
  comicPlanSidePanel.classList.add("studio-open");
  promptAgentPanel.classList.add("comic-hidden");
  renderComicLabelState();
  renderComicBrief();
  void restoreComicSession();
  const field = comicStudio.querySelector<HTMLTextAreaElement>(
    "[data-comic-message]",
  )!;
  if (seed && !field.value) field.value = seed;
  field.focus();
}
function closeComicStudio() {
  comicStudio.classList.remove("open");
  comicBriefPanel.hidden = true;
  comicPlanSidePanel.classList.remove("studio-open", "mobile-open");
  promptAgentPanel.classList.remove("comic-hidden");
  closePromptAgent();
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
function scenePromptWithoutCharacters(value: string) {
  return stripCharactersFromScenePrompt(value, comicState.plan);
}
const comicOutputController = new ComicOutputController({
  state: comicState,
  getNodes: () => nodes,
  prepareCanvas: () => {
    resetMarqueeRightGesture();
    if (selection.multiSelectMode) exitMultiSelectMode();
  },
  applyPlan: applyPromptAgentPlan,
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
comicStudio
  .querySelector("[data-comic-close]")!
  .addEventListener("click", closeComicStudio);
comicStudio.querySelector("[data-comic-new]")!.addEventListener("click", () => {
  if (comicState.submitting) {
    showToast("请等待当前构思完成后再开始新会话", "warning");
    return;
  }
  showComicMobilePanel(null);
  comicStudio
    .querySelector<HTMLElement>("[data-comic-label-menu]")
    ?.classList.remove("open");
  comicState.originalIdea = "";
  comicState.linkedLabelId = 0;
  resetComicConversationState(true);
  renderComicLabelState();
  comicStudio
    .querySelectorAll(".comic-message:not(.comic-welcome)")
    .forEach((message) => message.remove());
  comicStudio.querySelector<HTMLElement>(".comic-plan")!.hidden = true;
  comicStudio.querySelector<HTMLTextAreaElement>(
    "[data-comic-message]",
  )!.value = "";
  comicStudio
    .querySelector<HTMLOutputElement>("[data-comic-status]")!
    .classList.remove("visible");
  comicStudio
    .querySelector<HTMLTextAreaElement>("[data-comic-message]")!
    .focus();
  showToast("已开始新的漫剧会话", "success");
});
const comicMessage = comicStudio.querySelector<HTMLTextAreaElement>(
  "[data-comic-message]",
)!;
function sendComicMessage() {
  if (comicState.submitting) return;
  const message = comicMessage.value.trim();
  if (!message) return;
  comicMessage.value = "";
  void requestComicDialogue(message);
}
comicStudio
  .querySelector("[data-comic-send]")!
  .addEventListener("click", sendComicMessage);
comicBriefPanel
  .querySelector("[data-comic-confirm]")!
  .addEventListener("click", () => void requestComicPlan());
comicMessage.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    if (!comicState.submitting) sendComicMessage();
  }
});
comicStudio
  .querySelector("[data-comic-canvas]")!
  .addEventListener("click", applyComicToCanvas);
comicStudio
  .querySelector("[data-comic-label-picker]")!
  .addEventListener("click", (event) => {
    event.stopPropagation();
    const menu = comicStudio.querySelector<HTMLElement>(
      "[data-comic-label-menu]",
    )!;
    if (menu.classList.contains("open")) {
      menu.classList.remove("open");
      return;
    }
    showComicMobilePanel(null);
    renderComicLabelMenu();
    menu.classList.add("open");
  });
comicStudio
  .querySelector("[data-comic-label]")!
  .addEventListener("click", () => saveComicAsLabel(false));
comicStudio
  .querySelector("[data-comic-label-copy]")!
  .addEventListener("click", () => saveComicAsLabel(true));
comicStudio.addEventListener("click", (event) => {
  if (!(event.target as HTMLElement).closest(".comic-label-control"))
    comicStudio
      .querySelector("[data-comic-label-menu]")
      ?.classList.remove("open");
});
document.addEventListener(
  "pointerdown",
  (event) => {
    if (innerWidth > 780) return;
    const target = event.target as Node,
      scheme = comicHeaderNav.querySelector<HTMLElement>("[data-comic-scheme]"),
      labelControl = comicStudio.querySelector<HTMLElement>(
        ".comic-label-control",
      ),
      insideSchemePanel =
        comicBriefPanel.contains(target) || comicPlanSidePanel.contains(target);
    if (!insideSchemePanel && !scheme?.contains(target))
      showComicMobilePanel(null);
    if (!labelControl?.contains(target))
      comicStudio
        .querySelector<HTMLElement>("[data-comic-label-menu]")
        ?.classList.remove("open");
  },
  true,
);
const promptAgentApplication = new PromptAgentApplicationController({
  nodes,
  links,
  getSources: selectedPromptAgentNodes,
  getSelectedId: () => selection.selectedId,
  setSelectedId: (id) => { selection.selectedId = id; },
  worldCenter: () => world({ x: innerWidth / 2, y: innerHeight / 2 }),
  addNode,
  persist: scheduleSave,
  draw,
  runWorkflow: runAgentWorkflow,
  loadVoices: (providerId) => { void loadTtsVoices(providerId); },
});
function applyPromptAgentPlan(result: PromptAgentResult) {
  promptAgentApplication.applyPlan(result);
}
promptAgentRequests = new PromptAgentRequestController({
  panel: promptAgentPanel,
  controls: promptAgentControls,
  getNodes: () => nodes,
  getSelectedId: () => selection.selectedId,
  getContexts: selectedPromptAgentNodes,
  applyPlan: (result) => promptAgentApplication.applyPlan(result),
  applyVoice: (result) => promptAgentApplication.applyVoice(result),
  playMeteor: playAgentMeteor,
  locateNode: (nodeId) => {
    const node = nodes.find((item) => item.id === nodeId);
    if (!node) return;
    selection.selectedId = node.id;
    camera.x = -(node.x + node.width / 2) * camera.zoom;
    camera.y = -(node.y + node.height / 2) * camera.zoom;
    draw();
    closePromptAgent();
  },
  updateEditor,
  persist: scheduleSave,
  draw,
  decodePrompt: decodePromptClipboardText,
  disperse: dispersePromptAgent,
  showToast: (message, tone) => showToast(message, tone),
});
window.addEventListener(
  "contextmenu",
  (event) => {
    if (!promptAgentPanel.classList.contains("open")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    cancelPromptAgentRequest();
    dispersePromptAgentDirect();
  },
  true,
);
window.addEventListener("resize", () => {
  if (promptAgentPanel.classList.contains("open")) {
    positionPromptAgentCapsule();
  }
});
new CanvasClearController({
  button: document.querySelector<HTMLElement>("#dock-clear")!,
  getNodeCount: () => nodes.length,
  getProjectId: () => currentProjectId,
  getServerVersion: () => canvasSaveCoordinator.serverVersion,
  prepareForClear: () => canvasSaveCoordinator.prepareExclusiveMutation(),
  applyResult: (result) => {
    nodes.splice(0, nodes.length, ...result.nodes);
    links.splice(0, links.length, ...normalizeCanvasLinks(result.links));
    if (result.camera) Object.assign(camera, result.camera);
    canvasSaveCoordinator.applyAuthoritativeSnapshot(
      captureCanvasSnapshot(
        result.version,
        result.updatedAt || canvasSaveCoordinator.serverUpdatedAt,
      ),
    );
    selection.selectedId = 0;
    resetCanvasHistory(false);
    updateEditor();
    setSaveState("saved", "已自动保存");
    draw();
    showToast(`已清除画布内容，保留 ${nodes.length} 个标签`, "success");
  },
  recoverCanvas: () => loadCanvas(),
  toast: (message, tone, detail) => showToast(message, tone, detail),
});

const panelBackdrop = document.querySelector<HTMLElement>("#panel-backdrop")!;
const workspacePanels =
  document.querySelectorAll<HTMLElement>(".workspace-panel");
const workspaceBrand = document.querySelector<HTMLElement>(".topbar .brand")!,
  mobileNavToggle =
    document.querySelector<HTMLButtonElement>("#mobile-nav-toggle")!;
const workspacePanelController = new WorkspacePanelController(
  workspacePanels,
  panelBackdrop,
  workspaceBrand,
  mobileNavToggle,
  () => {
    assetLibraryController?.setImageTarget(null);
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
function renderAssetsAfterPanelOpen() {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (document.querySelector("#assets-panel")?.classList.contains("open"))
        renderAssets();
    }),
  );
}
workspacePanelController.bindNavigation({
  projectsButton: document.querySelector<HTMLElement>("#open-projects")!,
  projectsPanel: document.querySelector<HTMLElement>("#projects-panel")!,
  assetsButton: document.querySelector<HTMLElement>("#open-assets")!,
  assetsPanel: document.querySelector<HTMLElement>("#assets-panel")!,
  squareButton: document.querySelector<HTMLElement>("#open-square")!,
  squarePanel: document.querySelector<HTMLElement>("#square-panel")!,
  mainNav: workspaceBrand.querySelector<HTMLElement>(".main-nav")!,
  closeButtons: document.querySelectorAll<HTMLElement>(".panel-close"),
  onProjectsOpen: () => void projectController.load(),
  onAssetsOpen: () => {
    if (!assetLibraryController.hasAssets)
      void loadAssets(false).then(renderAssetsAfterPanelOpen);
    else renderAssetsAfterPanelOpen();
  },
  onSquareOpen: () => void loadSquare(),
  onMobileToggle: (opening) =>
    closeTopbarMenus(opening ? "workspace" : undefined),
});
const assetUpload = document.querySelector<HTMLInputElement>("#asset-upload")!,
  assetGrid = document.querySelector<HTMLElement>("#asset-grid")!,
  assetCount = document.querySelector<HTMLElement>("#asset-count")!;
const assetPreviewController = new AssetPreviewController({
  modal: document.querySelector<HTMLElement>("#asset-preview")!,
  image: document.querySelector<HTMLImageElement>("#preview-image")!,
  video: document.querySelector<HTMLVideoElement>("#preview-video")!,
  name: document.querySelector<HTMLElement>("#preview-name")!,
  closeButton: document.querySelector<HTMLElement>("#close-preview")!,
});
let assetLibraryController: AssetLibraryController;
const ASSET_PAGE_SIZE = 36;
const assetSearch = document.querySelector<HTMLInputElement>("#asset-search")!,
  assetProjectFilter = document.querySelector<HTMLSelectElement>(
    "#asset-project-filter",
  )!,
  assetTypeFilter =
    document.querySelector<HTMLSelectElement>("#asset-type-filter")!,
  assetSort = document.querySelector<HTMLSelectElement>("#asset-sort")!;
assetTypeFilter.insertAdjacentHTML(
  "beforeend",
  '<option value="audio">音频</option>',
);
const assetContextController = new AssetContextController({
  menu: document.querySelector<HTMLElement>("#asset-context-menu")!,
  placeButton: document.querySelector<HTMLElement>("#asset-context-place")!,
  previewButton: document.querySelector<HTMLElement>("#asset-context-preview")!,
  publishButton: document.querySelector<HTMLElement>("#asset-context-publish")!,
  publishLabel: document.querySelector<HTMLElement>("#asset-context-publish span")!,
  deleteButton: document.querySelector<HTMLElement>("#asset-context-delete")!,
  onPlace: (asset) =>
    addMediaNode(
      asset.url,
      asset.name,
      world({ x: innerWidth / 2, y: innerHeight / 2 }),
      asset.kind,
    ),
  onPreview: (asset) =>
    openAssetPreview(asset.url, asset.name, asset.kind),
  onCloseWorkspace: closeWorkspacePanels,
  onVisibilityChanged: () => {
    showcaseLoaded = false;
  },
  onDeleted: (asset) => imageCache.delete(asset.url),
  reloadAssets: () => loadAssets(),
  toast: (message, type) => showToast(message, type),
});
const openAssetContextAt = (asset: LibraryAsset, x: number, y: number) =>
  assetContextController.open(asset, x, y);
function assetForRenderedItem(item: HTMLElement) {
  return assetLibraryController.resolveItem(item);
}
const assetTouchController = new AssetTouchController({
  grid: assetGrid,
  resolveAsset: assetForRenderedItem,
  onContext: openAssetContextAt,
});
const assetBulkController = new AssetBulkController({
  deleteButton: document.querySelector<HTMLButtonElement>(
    "#asset-bulk-delete",
  )!,
  downloadButton: document.querySelector<HTMLButtonElement>(
    "#asset-bulk-download",
  )!,
  getAssets: () => assetLibraryController.allAssets,
  confirmDelete: async (count) =>
    Boolean(
      await askProjectDialog({
        title: "删除所选资产？",
        description: `将永久删除所选的 ${count} 项资产，此操作无法撤销。`,
        confirm: "确认删除",
        danger: true,
      }),
    ),
  reloadAssets: () => loadAssets(),
  toast: (message, type) => showToast(message, type),
});
const assetLibraryView = new AssetLibraryView({
  grid: assetGrid,
  count: assetCount,
  pageSize: ASSET_PAGE_SIZE,
  selectedIds: assetBulkController.selectedIds,
  bulkDelete: document.querySelector<HTMLButtonElement>(
    "#asset-bulk-delete",
  )!,
  bulkDownload: document.querySelector<HTMLButtonElement>(
    "#asset-bulk-download",
  )!,
  isTouchContextBlocked: () => assetTouchController.isContextBlocked(),
  onOpen: (asset, kind) => openAssetPreview(asset.url, asset.name, kind),
  onAudio: (asset) => assetLibraryController.playAudio(asset),
  onPickImage: (asset) => {
    const targetId = assetLibraryController.consumeImageTarget();
    if (targetId) attachAssetToImageNode(targetId, asset);
    closeWorkspacePanels();
  },
  onContext: openAssetContextAt,
});
assetLibraryController = new AssetLibraryController({
  search: assetSearch,
  projectFilter: assetProjectFilter,
  typeFilter: assetTypeFilter,
  sort: assetSort,
  viewButtons: document.querySelectorAll<HTMLButtonElement>("[data-asset-view]"),
  getCurrentProjectId: () => currentProjectId,
  getView: () => assetLibraryView,
  showError: (message) => showToast(message, "error"),
});
const imageNodeUpload = document.createElement("input");
imageNodeUpload.type = "file";
imageNodeUpload.accept = "image/*";
imageNodeUpload.hidden = true;
document.body.append(imageNodeUpload);
function attachAssetToImageNode(
  nodeId: number,
  asset: { url: string; name: string },
) {
  const node = nodes.find(
    (item) => item.id === nodeId && item.kind === "image",
  );
  if (!node) {
    showToast("目标图片节点已不存在", "warning");
    return;
  }
  if (
    node.status === "queued" ||
    node.status === "running" ||
    (node.agentAuto && node.status === "waiting")
  ) {
    showToast("节点已经进入生成队列，未替换素材", "warning");
    return;
  }
  node.mediaUrl = asset.url;
  node.title = asset.name || node.title;
  node.generationPrompt = undefined;
  node.status = "idle";
  node.progress = 0;
  selection.selectedId = node.id;
  scheduleSave();
  updateEditor();
  draw();
  showToast("图片已放入当前节点", "success");
}
function imageNodeAllowsSourceChange(nodeId: number) {
  const node = nodes.find(
    (item) => item.id === nodeId && item.kind === "image",
  );
  if (!node) return false;
  if (
    node.status === "queued" ||
    node.status === "running" ||
    (node.agentAuto && node.status === "waiting")
  ) {
    showToast("生成期间不可更换素材", "warning");
    return false;
  }
  return true;
}
const assetUploadController = new AssetUploadController({
  input: assetUpload,
  nodeInput: imageNodeUpload,
  button: document.querySelector<HTMLButtonElement>("#upload-assets")!,
  triggers: [
    document.querySelector<HTMLElement>("#upload-assets")!,
    document.querySelector<HTMLElement>("#dock-upload")!,
  ],
  getProjectId: () => currentProjectId,
  getPastePosition: () => world({ x: innerWidth / 2, y: innerHeight / 2 }),
  onAttachNode: attachAssetToImageNode,
  onPlace: (position, asset) =>
    addMediaNode(asset.url, asset.name, position, "image"),
  onReload: () => loadAssets(),
  onToast: (message, tone, detail) => showToast(message, tone, detail),
});
function openAssetUploadAt(position: Point | null = null) {
  assetUploadController.open(position);
}
function beginImageNodeUpload(nodeId: number) {
  if (!imageNodeAllowsSourceChange(nodeId)) return;
  assetLibraryController.setImageTarget(null);
  assetUploadController.openForNode(nodeId);
}
async function beginImageNodeLibrary(nodeId: number) {
  if (!imageNodeAllowsSourceChange(nodeId)) return;
  openWorkspacePanel("#assets-panel", "#open-assets");
  assetLibraryController.setImageTarget(nodeId);
  assetTypeFilter.value = "image";
  assetProjectFilter.value = "current";
  await loadAssets();
  renderAssets();
}
const projectDialog = document.querySelector<HTMLElement>("#project-dialog")!;
const askProjectDialog = createProjectDialog(projectDialog);
const projectController = new ProjectController({
  list: document.querySelector<HTMLElement>("#project-list")!,
  count: document.querySelector<HTMLElement>("#project-count")!,
  search: document.querySelector<HTMLInputElement>("#project-search")!,
  sort: document.querySelector<HTMLSelectElement>("#project-sort")!,
  newButton: document.querySelector<HTMLElement>("#new-project")!,
  ask: askProjectDialog,
  getCurrentProjectId: () => currentProjectId,
  switchProject,
  deleteCurrentProject: async (nextProjectId) => {
    currentProjectId = nextProjectId;
    localStorage.setItem("flow-project-id", nextProjectId);
    await Promise.all([loadCanvas(), loadAssets()]);
  },
  toast: (message, type, detail) => showToast(message, type, detail),
});
async function switchProject(projectId: string) {
  if (projectId === currentProjectId) {
    closeWorkspacePanels();
    return;
  }
  if (canvasSaveCoordinator.loadedProjectId === currentProjectId) await saveCanvas();
  closeComicStudio();
  await canvasSaveCoordinator.stopAndReset();
  canvasNodeIdBlockEnd = 0;
  currentProjectId = projectId;
  localStorage.setItem("flow-project-id", projectId);
  resetComicConversationState(true);
  comicState.linkedLabelId = 0;
  await Promise.all([loadCanvas(), loadAssets()]);
  closeWorkspacePanels();
}
async function loadAssets(render = true) {
  await assetLibraryController.load(render);
}
function renderAssets() {
  assetLibraryController.render();
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
  squarePanelView.setLoading(true);
  try {
    squarePanelView.setAssets(await fetchShowcaseAssets());
  } catch {
    squarePanelView.showLoadError();
  } finally {
    squarePanelView.setLoading(false);
  }
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
document.addEventListener("pointerdown", (event) => {
  const target = event.target as Node;
  if (!quickNodeMenu.contains(target)) closeQuickNodeMenu();
  assetContextController.closeIfOutside(target);
  document
    .querySelectorAll<HTMLDetailsElement>(
      ".image-config-panel details[open],.video-config-panel details[open],.voice-config-panel details[open]",
    )
    .forEach((details) => {
      if (!details.contains(target)) details.open = false;
    });
});
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
async function loadGenerationCapabilities(redraw = false) {
  try {
    const response = await apiFetch("/api/generation/capabilities", {
      cache: "no-store",
    });
    if (response.ok) {
      const previous = generationCapabilities.image?.localFallback?.available;
      generationCapabilities =
        (await response.json()) as GenerationCapabilities;
      if (
        redraw &&
        previous !== generationCapabilities.image?.localFallback?.available
      ) {
        refreshLocalImageAvailabilityUI();
        draw();
      }
    }
  } catch {
    /* 使用通用默认配置 */
  }
}
async function bootstrapApplication() {
  setWorkspaceBootStatus("正在检测登录状态");
  try {
    const response = await apiFetch("/api/users/me");
    if (response.ok) authUser = (await response.json()) as AuthUser;
  } catch {
    authUser = null;
  }
  authReady = true;
  localStorage.removeItem("flow-authenticated");
  renderAuthenticatedUser();
  if (authUser) {
    sessionActivity.touch();
  }
  const capabilities = loadGenerationCapabilities();
  if (authUser && location.hash === "#/canvas") {
    document.body.classList.add(
      "home-mode",
      "workspace-loading",
      "workspace-preparing",
    );
    randomizeHomeTheme();
    setWorkspaceBootStatus("登录成功，正在同步项目");
    const restored = await synchronizeCanvasAfterAuthentication(true);
    if (restored) {
      setWorkspaceBootStatus("正在加载资产索引与创作模型");
      await Promise.all([loadAssets(false), capabilities]);
      setWorkspaceBootStatus("工作区已准备完成");
    } else {
      location.hash = "#/";
      showToast("工作区同步失败，请重新进入创作", "error");
    }
    document.body.classList.remove("workspace-loading", "workspace-preparing");
  } else await capabilities;
  setWorkspaceBootStatus("", false);
  applyAppRoute();
}
window.addEventListener("resize", resize);
resize();
updateEditor();
void bootstrapApplication();
