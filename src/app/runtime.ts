import "../style.css";
import { CanvasPerformanceMonitor } from "../canvas/performance-monitor";
import { CanvasSpatialIndex } from "../canvas/spatial-index";
import { CanvasStore } from "../canvas/store";
import {
  applyCanvasOperations,
  diffCanvasSnapshots,
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
import { normalizeCanvasDocument } from "../canvas/document-normalizer";
import {
  cancelActiveProjectJobs,
  clearCanvasDocument,
} from "../canvas/clear-client";
import { fetchCanvasDocument, submitCanvasChanges } from "../canvas/sync-client";
import { repairRestoredCanvas } from "../canvas/restoration";
import { LinkInteractionView } from "../canvas/link-interaction-view";
import { GenerationPoller } from "../services/generation-poller";
import { GenerationWorkflow } from "../services/generation-workflow";
import { requestNodeIdLease } from "../services/node-id-lease";
import { NotificationStreamController } from "../services/notification-stream";
import { requestPromptAgent } from "../services/prompt-agent";
import {
  appendRevisionNode,
  findOutputPosition,
  removeResultNode,
} from "../nodes/generation-node-lifecycle";
import { MediaLruCache } from "../canvas/media-cache";
import type {
  FlowLink,
  FlowNode,
  GenerationCapabilities,
  NodeKind,
  Point,
  PortSide,
  TtsProviderOption,
  TtsVoiceOption,
} from "../nodes/node-types";
import { createNode, makeNodePublicId } from "../nodes/node-service";
import { PromptNodeController } from "../nodes/prompt-node";
import {
  fetchTtsProviders,
  fetchTtsVoices,
  synthesizeTts,
} from "../services/tts";
import { apiFetch } from "../services/api";
import {
  hydrateGenerationPrompts,
  missingGenerationInputs,
  runGenerationJob,
  type GenerationJob,
} from "../services/generation";
import {
  fetchAssets,
  fetchAssetBlob,
  fetchShowcaseAssets,
  type LibraryAsset,
} from "../services/assets";
import { streamComicDialogue, streamComicPlan } from "../services/comic";
import { ComicSessionController } from "../services/comic-session";
import {
  clipVideoPrompt,
  composeStoryboardPrompt,
  fitVideoDialogue,
  inferAnonymousCrowd,
  speechSegments,
} from "../nodes/video-node";
import { inferVoiceConfig } from "../nodes/voice-node";
import type {
  ComicBrief,
  ComicPlan,
  ComicShot,
  PromptAgentMode,
  PromptAgentResult,
  PromptAgentStep,
} from "../nodes/comic-types";
import {
  briefFromComicPlan,
  formatComicPlan,
  stripCharactersFromScenePrompt,
} from "../nodes/comic-format";
import {
  bindNodeConfigPanel,
  renderComposerSubmit,
  renderNodeToolbar,
} from "../ui/node-editor";
import { filterAssets } from "../ui/asset-panel";
import { AssetLibraryView } from "../ui/asset-library-view";
import { AssetTouchController } from "../ui/asset-touch-controller";
import { AssetPreviewController } from "../ui/asset-preview";
import { AssetUploadController } from "../ui/asset-upload-controller";
import { AssetContextController } from "../ui/asset-context-controller";
import { AssetBulkController } from "../ui/asset-bulk-controller";
import { SquarePanelView } from "../ui/square-panel";
import { WorkspacePanelController } from "../ui/toolbar";
import {
  createProjectDialog,
} from "../ui/dialogs/project-dialog";
import { ProjectController } from "../ui/project-controller";
import {
  UserMenuController,
  type AuthUser,
} from "../ui/user-menu-controller";
import { ComicSidePanelController } from "../ui/comic-side-panel";
import { ComicStudioView } from "../ui/comic-studio";
import { ComicLabelController } from "../ui/comic-labels";
import { buildComicWorkflow } from "../nodes/comic-workflow";
import {
  configurePromptAgentNode,
  connectPromptAgentInputs,
  planComicWorkflowLayout,
  promptAgentStepPosition,
  resolvePromptAgentInputs,
} from "../nodes/prompt-agent-workflow";
import { createNodeView } from "../nodes/node-view-factory";
import { syncNodeMediaView } from "../nodes/node-media-view";
import { syncImageNodePanel } from "../nodes/image-node-sync";
import { syncVideoNodePanel } from "../nodes/video-node-sync";
import { syncVoiceTtsAudioPanels } from "../nodes/voice-node-sync";
import { syncVideoReferenceView } from "../nodes/video-reference-view";
import {
  syncBasicNodeContent,
} from "../nodes/node-dom-state";
import { synchronizeNodeDom } from "../nodes/node-dom-synchronizer";
import { bindVoiceNodePanels } from "../nodes/voice-node-view";
import { bindVideoNodePanel } from "../nodes/video-node-view";
import {
  bindClearImageAction,
  bindImageNodePanel,
} from "../nodes/image-node-view";
import {
  bindNodeLabelHeading,
  bindNodePointerInteraction,
  bindNodePorts,
  bindNodeToolbarActions,
} from "../nodes/node-interaction-view";
import { createDefaultGenerationCapabilities } from "./state";
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
let ttsProviders: TtsProviderOption[] = [];
const ttsVoicesByProvider = new Map<string, TtsVoiceOption[]>(),
  ttsVoiceLoads = new Map<string, Promise<void>>();
let ttsProvidersLoading: Promise<void> | null = null;
function loadTtsProviders() {
  if (ttsProviders.length) return Promise.resolve();
  if (ttsProvidersLoading) return ttsProvidersLoading;
  ttsProvidersLoading = (async () => {
    try {
      const result = await fetchTtsProviders();
      ttsProviders = Array.isArray(result) ? result : [];
      nodes
        .filter((node) => node.kind === "voice")
        .forEach((node) => nodeDomStates.delete(node.id));
      draw();
    } catch {
      /* 保留本地默认项，重绘时继续检测 */
    } finally {
      ttsProvidersLoading = null;
    }
  })();
  return ttsProvidersLoading;
}
function loadTtsVoices(providerId = "easyvoice-local") {
  if (ttsVoicesByProvider.has(providerId)) return Promise.resolve();
  const pending = ttsVoiceLoads.get(providerId);
  if (pending) return pending;
  const task = (async () => {
    try {
      const voices = await fetchTtsVoices(providerId);
      ttsVoicesByProvider.set(providerId, voices);
      nodes
        .filter(
          (node) =>
            node.kind === "voice" &&
            node.voiceSettings?.providerId === providerId,
        )
        .forEach((node) => nodeDomStates.delete(node.id));
      draw();
    } catch {
      /* 服务恢复或重新选择时可再次读取 */
    } finally {
      ttsVoiceLoads.delete(providerId);
    }
  })();
  ttsVoiceLoads.set(providerId, task);
  return task;
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
const taskMonitorButton = document.createElement("button"),
  taskMonitorPanel = document.createElement("section");
taskMonitorButton.type = "button";
taskMonitorButton.className = "task-monitor-button";
taskMonitorButton.setAttribute("aria-label", "项目生成任务");
taskMonitorButton.innerHTML =
  "<i></i><span>任务</span><b>0</b><small>暂无任务</small>";
const resetButton = document.querySelector<HTMLElement>("#reset")!;
resetButton.parentElement!.insertBefore(taskMonitorButton, resetButton);
taskMonitorPanel.className = "task-monitor-panel";
taskMonitorPanel.innerHTML =
  '<header><span><b>项目任务</b><small>当前画布生成状态</small></span><button type="button" aria-label="关闭">×</button></header><div data-task-list></div>';
document.body.append(taskMonitorPanel);
taskMonitorPanel
  .querySelector<HTMLElement>("[data-task-list]")!
  .addEventListener("pointerup", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-task-node]",
    );
    if (button) focusTaskNode(Number(button.dataset.taskNode));
  });
const startEmptyImagesButton = document.createElement("button");
startEmptyImagesButton.type = "button";
startEmptyImagesButton.className = "start-empty-images-button";
startEmptyImagesButton.setAttribute("aria-label", "一键启动所有空图任务");
startEmptyImagesButton.innerHTML =
  "<span>✦</span><strong>启动空图</strong><b>0</b>";
taskMonitorButton.parentElement!.insertBefore(
  startEmptyImagesButton,
  taskMonitorButton,
);
taskMonitorPanel.insertAdjacentHTML(
  "beforeend",
  '<footer><button type="button" data-start-empty-mobile disabled>启动空图 · 0</button><button type="button" data-cancel-pending disabled>取消等待任务</button></footer>',
);
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
const activeVoicePreviews = new Map<number, HTMLAudioElement>();
const promptNodeEditor = new PromptNodeController();
let nextId = 1;
let canvasNodeIdBlockEnd = 0;
let canvasNodeIdLeasePromise: Promise<boolean> | null = null;
let contextPosition: Point = { x: 0, y: 0 };
const connection = new CanvasConnectionController();
let connectionAutoPanFrame = 0,
  connectionAutoPanPointer: Point | null = null;
let currentProjectId = localStorage.getItem("flow-project-id") ?? "default";
let canvasLoadedProjectId = "";
let canvasServerVersion = 0,
  canvasServerUpdatedAt = "",
  canvasSavePromise: Promise<void> | null = null,
  canvasSaveQueued = false,
  canvasSaveBlocked = true,
  canvasSaveAbort: AbortController | null = null,
  canvasLoadSequence = 0;
let canvasBaseline: CanvasSyncSnapshot | null = null;
const canvasSyncClientId = (() => {
  const existing = sessionStorage.getItem("flow-canvas-client-id");
  if (existing) return existing;
  const id = `client_${crypto.randomUUID().replaceAll("-", "")}`;
  sessionStorage.setItem("flow-canvas-client-id", id);
  return id;
})();
function captureCanvasSnapshot(
  version = canvasServerVersion,
  updatedAt = canvasServerUpdatedAt,
): CanvasSyncSnapshot {
  return {
    nodes: structuredClone(nodes),
    links: structuredClone(links),
    camera: { ...camera },
    version,
    updatedAt,
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
type CanvasHistorySnapshot = {
  nodes: FlowNode[];
  links: FlowLink[];
  nextId: number;
};
type CanvasHistoryState = {
  undo: CanvasHistorySnapshot[];
  redo: CanvasHistorySnapshot[];
  current: CanvasHistorySnapshot | null;
  signature: string;
};
const canvasHistories = new Map<string, CanvasHistoryState>();
let historyCommitTimer: number | undefined,
  historyRestoring = false;
const undoButton = document.querySelector<HTMLButtonElement>("#dock-history")!,
  redoButton = document.createElement("button");
function cloneHistorySnapshot(): CanvasHistorySnapshot {
  return {
    nodes: structuredClone(nodes),
    links: structuredClone(links),
    nextId,
  };
}
function isGeneratedProductNode(node: FlowNode) {
  return node.role === "result" || node.title === "图片修改结果";
}
function historySignature(snapshot: CanvasHistorySnapshot) {
  const ignoredIds = new Set(
    snapshot.nodes.filter(isGeneratedProductNode).map((node) => node.id),
  );
  return JSON.stringify({
    nodes: snapshot.nodes
      .filter((node) => !ignoredIds.has(node.id))
      .map(
        ({
          progress,
          status,
          jobId,
          agentAuto,
          mediaUrl,
          generationPrompt,
          originalPrompt,
          corePrompt,
          ...node
        }) => node,
      ),
    links: snapshot.links.filter(
      (link) => !ignoredIds.has(link.from) && !ignoredIds.has(link.to),
    ),
    nextId: snapshot.nextId,
  });
}
function historyStructureSignature(snapshot: CanvasHistorySnapshot) {
  const ignoredIds = new Set(
    snapshot.nodes.filter(isGeneratedProductNode).map((node) => node.id),
  );
  return JSON.stringify({
    nodes: snapshot.nodes
      .filter((node) => !ignoredIds.has(node.id))
      .map(
        ({
          x,
          y,
          width,
          height,
          progress,
          status,
          jobId,
          agentAuto,
          mediaUrl,
          generationPrompt,
          originalPrompt,
          corePrompt,
          ...node
        }) => node,
      )
      .sort((a, b) => a.id - b.id),
    links: snapshot.links
      .filter((link) => !ignoredIds.has(link.from) && !ignoredIds.has(link.to))
      .map((link) => ({ ...link }))
      .sort(
        (a, b) =>
          a.from - b.from ||
          a.to - b.to ||
          a.fromSide.localeCompare(b.fromSide) ||
          a.toSide.localeCompare(b.toSide),
      ),
  });
}
function generationSafeHistoryStep(
  from: CanvasHistorySnapshot | null,
  to: CanvasHistorySnapshot | undefined,
) {
  return Boolean(
    from &&
    to &&
    historyStructureSignature(from) === historyStructureSignature(to),
  );
}
function historyState() {
  let state = canvasHistories.get(currentProjectId);
  if (!state) {
    state = { undo: [], redo: [], current: null, signature: "" };
    canvasHistories.set(currentProjectId, state);
  }
  return state;
}
function updateHistoryControls() {
  const state = historyState(),
    generating = canvasHasActiveGeneration(),
    undoSafe =
      !generating ||
      generationSafeHistoryStep(state.current, state.undo.at(-1)),
    redoSafe =
      !generating ||
      generationSafeHistoryStep(state.current, state.redo.at(-1));
  undoButton.disabled = !state.undo.length || !undoSafe;
  undoButton.classList.toggle("available", state.undo.length > 0 && undoSafe);
  undoButton.title =
    generating && !undoSafe
      ? "生成中仅可撤销卡片位置或尺寸调整"
      : `回溯${state.undo.length ? ` · ${state.undo.length} 步` : ""}（Ctrl+Z）`;
  redoButton.disabled = !state.redo.length || !redoSafe;
}
function persistCanvasHistory() {
  const state = historyState();
  try {
    sessionStorage.setItem(
      `flow-canvas-history:${currentProjectId}`,
      JSON.stringify({
        undo: state.undo.slice(-20),
        redo: state.redo.slice(-20),
        current: state.current,
        signature: state.signature,
      }),
    );
  } catch {
    /* 历史过大时仍保留当前页面内撤销 */
  }
}
function resetCanvasHistory(restore = true) {
  window.clearTimeout(historyCommitTimer);
  historyCommitTimer = undefined;
  const snapshot = cloneHistorySnapshot(),
    signature = historySignature(snapshot),
    state = historyState();
  let restored = false;
  if (restore)
    try {
      const saved = JSON.parse(
        sessionStorage.getItem(`flow-canvas-history:${currentProjectId}`) ||
          "null",
      ) as CanvasHistoryState | null;
      if (saved?.current && saved.signature === signature) {
        state.undo = Array.isArray(saved.undo) ? saved.undo.slice(-20) : [];
        state.redo = Array.isArray(saved.redo) ? saved.redo.slice(-20) : [];
        restored = true;
      }
    } catch {
      /* 使用新历史 */
    }
  if (!restored) {
    state.undo = [];
    state.redo = [];
  }
  state.current = snapshot;
  state.signature = signature;
  persistCanvasHistory();
  updateHistoryControls();
}
function commitCanvasHistory() {
  historyCommitTimer = undefined;
  if (historyRestoring) return;
  const state = historyState(),
    snapshot = cloneHistorySnapshot(),
    signature = historySignature(snapshot);
  if (!state.current) {
    state.current = snapshot;
    state.signature = signature;
    updateHistoryControls();
    return;
  }
  if (signature === state.signature) {
    state.current = snapshot;
    return;
  }
  state.undo.push(state.current);
  if (state.undo.length > 50) state.undo.splice(0, state.undo.length - 50);
  state.redo = [];
  state.current = snapshot;
  state.signature = signature;
  persistCanvasHistory();
  updateHistoryControls();
}
function queueCanvasHistory() {
  if (historyRestoring) return;
  window.clearTimeout(historyCommitTimer);
  historyCommitTimer = window.setTimeout(commitCanvasHistory, 520);
}
async function applyCanvasHistory(snapshot: CanvasHistorySnapshot) {
  historyRestoring = true;
  const selectedBeforeRestore = selection.selectedId,
    currentNodes = structuredClone(nodes),
    currentLinks = structuredClone(links),
    currentById = new Map(currentNodes.map((node) => [node.id, node])),
    restoredNodes = structuredClone(snapshot.nodes);
  for (const restored of restoredNodes) {
    const current = currentById.get(restored.id);
    if (!current) continue;
    for (const key of [
      "mediaUrl",
      "jobId",
      "status",
      "progress",
      "agentAuto",
      "generationPrompt",
      "originalPrompt",
      "corePrompt",
    ] as const) {
      if (current[key] !== undefined)
        (restored as unknown as Record<string, unknown>)[key] = current[key];
      else delete (restored as unknown as Record<string, unknown>)[key];
    }
  }
  const restoredIds = new Set(restoredNodes.map((node) => node.id)),
    protectedProducts = currentNodes.filter(
      (node) => isGeneratedProductNode(node) && !restoredIds.has(node.id),
    );
  restoredNodes.push(...protectedProducts);
  const finalIds = new Set(restoredNodes.map((node) => node.id)),
    restoredLinks = structuredClone(snapshot.links),
    restoredLinkKeys = new Set(
      restoredLinks.map(
        (link) => `${link.from}:${link.to}:${link.fromSide}:${link.toSide}`,
      ),
    );
  for (const link of currentLinks) {
    if (!finalIds.has(link.from) || !finalIds.has(link.to)) continue;
    if (
      !protectedProducts.some(
        (node) => node.id === link.from || node.id === link.to,
      )
    )
      continue;
    const key = `${link.from}:${link.to}:${link.fromSide}:${link.toSide}`;
    if (!restoredLinkKeys.has(key)) {
      restoredLinks.push(link);
      restoredLinkKeys.add(key);
    }
  }
  nodes.splice(0, nodes.length, ...restoredNodes);
  links.splice(0, links.length, ...restoredLinks);
  nextId = Math.max(
    snapshot.nextId,
    nodes.length ? Math.max(...nodes.map((node) => node.id)) + 1 : 1,
  );
  selection.selectedId = finalIds.has(selectedBeforeRestore) ? selectedBeforeRestore : 0;
  selection.batchIds.clear();
  promptNodeEditor.editingId = 0;
  updateEditor();
  draw();
  await saveCanvas();
  historyRestoring = false;
  updateHistoryControls();
}
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
async function undoCanvas() {
  commitCanvasHistory();
  const state = historyState(),
    previous = state.undo.at(-1);
  if (!previous) {
    showHistoryShortcutGuide("undo");
    return;
  }
  if (
    canvasHasActiveGeneration() &&
    !generationSafeHistoryStep(state.current, previous)
  ) {
    showToast("生成中只能撤销卡片位置或尺寸调整", "warning");
    return;
  }
  state.undo.pop();
  state.redo.push(state.current!);
  state.current = structuredClone(previous);
  state.signature = historySignature(previous);
  persistCanvasHistory();
  await applyCanvasHistory(previous);
  showHistoryShortcutGuide("undo");
}
async function redoCanvas() {
  commitCanvasHistory();
  const state = historyState(),
    next = state.redo.at(-1);
  if (!next) return;
  if (
    canvasHasActiveGeneration() &&
    !generationSafeHistoryStep(state.current, next)
  ) {
    showToast("生成中只能重做卡片位置或尺寸调整", "warning");
    return;
  }
  state.redo.pop();
  state.undo.push(state.current!);
  state.current = structuredClone(next);
  state.signature = historySignature(next);
  persistCanvasHistory();
  await applyCanvasHistory(next);
  showHistoryShortcutGuide("redo");
}
undoButton.addEventListener("click", () => void undoCanvas());
let taskMonitorSignature = "";
function taskStatus(node: FlowNode) {
  if (node.status === "running")
    return {
      order: 0,
      label: `生成中${Number(node.progress ?? 0) > 0 ? ` ${Math.round(node.progress ?? 0)}%` : ""}`,
      className: "running",
    };
  if (node.status === "queued")
    return { order: 1, label: "排队中", className: "queued" };
  if (node.agentAuto && node.status === "waiting")
    return { order: 2, label: "等待上游", className: "waiting" };
  if (node.status === "failed")
    return { order: 3, label: "生成失败", className: "failed" };
  return null;
}
function updateCancelPendingButton() {
  const count = nodes.filter(
      (node) =>
        node.status === "queued" ||
        (node.agentAuto && node.status === "waiting"),
    ).length,
    button = taskMonitorPanel.querySelector<HTMLButtonElement>(
      "[data-cancel-pending]",
    )!;
  button.disabled = count === 0;
  button.textContent = count ? `取消等待任务 · ${count}` : "没有等待任务";
}
function emptyImageCandidates() {
  return nodes.filter(
    (node) =>
      node.kind === "image" &&
      !node.mediaUrl &&
      node.role !== "result" &&
      canGenerateNode(node) &&
      node.status !== "queued" &&
      node.status !== "running" &&
      node.status !== "waiting" &&
      !node.agentAuto,
  );
}
function updateStartEmptyImagesButton() {
  const count = emptyImageCandidates().length,
    mobileButton = taskMonitorPanel.querySelector<HTMLButtonElement>(
      "[data-start-empty-mobile]",
    )!;
  startEmptyImagesButton.querySelector("b")!.textContent = String(count);
  startEmptyImagesButton.disabled = count === 0;
  startEmptyImagesButton.classList.toggle("ready", count > 0);
  startEmptyImagesButton.title = count
    ? `将 ${count} 个没有图片的节点加入生成队列`
    : "当前没有可启动的空图节点";
  mobileButton.disabled = count === 0;
  mobileButton.textContent = count ? `启动空图 · ${count}` : "暂无可生成空图";
  mobileButton.classList.toggle("ready", count > 0);
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
async function cancelPendingProjectTasks() {
  const localWaiting = nodes.filter(
      (node) => node.agentAuto && node.status === "waiting",
    ),
    queued = nodes.filter((node) => node.status === "queued"),
    orphanQueued = new Set(
      queued.filter((node) => !node.jobId).map((node) => node.id),
    );
  if (!localWaiting.length && !queued.length) return;
  const confirmed = await askProjectDialog({
    title: "取消所有等待任务？",
    description: `将取消 ${queued.length} 个排队任务和 ${localWaiting.length} 个等待上游任务，已经生成中的任务不会受到影响。`,
    confirm: "一键取消",
  });
  if (!confirmed) return;
  try {
    const response = await apiFetch(
        `/api/projects/${currentProjectId}/jobs/cancel-pending`,
        { method: "POST" },
      ),
      result = (await response.json()) as {
        canceled?: number;
        ids?: string[];
        error?: string;
      };
    if (!response.ok) throw new Error(result.error || "取消失败");
    const canceledIds = new Set(result.ids || []);
    localWaiting.forEach((node) => {
      node.agentAuto = false;
      node.status = "idle";
      node.progress = 0;
    });
    for (const jobId of canceledIds) {
      generationPoller.cancel(jobId);
    }
    for (let index = nodes.length - 1; index >= 0; index--) {
      const node = nodes[index],
        orphan = orphanQueued.has(node.id);
      if (!orphan && (!node.jobId || !canceledIds.has(node.jobId))) continue;
      if (node.role === "result" || node.title === "图片修改结果" || orphan) {
        const id = node.id;
        nodes.splice(index, 1);
        for (let linkIndex = links.length - 1; linkIndex >= 0; linkIndex--)
          if (links[linkIndex].from === id || links[linkIndex].to === id)
            links.splice(linkIndex, 1);
      } else {
        delete node.jobId;
        node.status = "idle";
        node.progress = 0;
        node.agentAuto = false;
      }
    }
    try {
      const userResponse = await apiFetch("/api/users/me");
      if (userResponse.ok) {
        const previousAvailable = Math.max(
          0,
          Number(authUser?.credits ?? 0) -
            Number(authUser?.reservedCredits ?? 0),
        );
        authUser = (await userResponse.json()) as AuthUser;
        const nextAvailable = Math.max(
          0,
          Number(authUser.credits ?? 0) - Number(authUser.reservedCredits ?? 0),
        );
        renderAuthenticatedUser();
        if (
          previousAvailable >= 1 !== nextAvailable >= 1 ||
          previousAvailable >= 2 !== nextAvailable >= 2
        )
          refreshNodeModelMenus();
      }
    } catch {
      /* 稍后同步 */
    }
    scheduleSave();
    updateEditor();
    draw();
    showToast(
      `已取消 ${(result.canceled || 0) + localWaiting.length + orphanQueued.size} 个等待任务`,
      "success",
    );
  } catch (error) {
    showToast(
      "取消等待任务失败",
      "error",
      error instanceof Error ? error.message : "请稍后重试",
    );
  }
}
function focusTaskNode(nodeId: number) {
  const node = nodes.find((item) => item.id === nodeId);
  if (!node) return;
  selection.selectedId = node.id;
  camera.x = -(node.x + node.width / 2) * camera.zoom;
  camera.y = -(node.y + node.height / 2) * camera.zoom;
  taskMonitorPanel.classList.remove("open");
  updateEditor();
  draw();
}
function updateTaskMonitor() {
  const tasks = nodes
      .map((node) => ({ node, status: taskStatus(node) }))
      .filter(
        (
          item,
        ): item is {
          node: FlowNode;
          status: NonNullable<ReturnType<typeof taskStatus>>;
        } => Boolean(item.status),
      )
      .sort(
        (left, right) =>
          left.status.order - right.status.order ||
          left.node.id - right.node.id,
      ),
    running = tasks.filter(
      (item) => item.status.className === "running",
    ).length,
    queued = tasks.filter((item) => item.status.className === "queued").length,
    waiting = tasks.filter(
      (item) => item.status.className === "waiting",
    ).length,
    signature = tasks
      .map(
        (item) =>
          `${item.node.id}:${item.node.status}:${item.node.title}:${item.node.model}`,
      )
      .join("|");
  updateStartEmptyImagesButton();
  taskMonitorButton.classList.toggle("active", running + queued > 0);
  taskMonitorButton.querySelector("b")!.textContent = String(running + queued);
  taskMonitorButton.querySelector("small")!.textContent =
    `${running ? `生成中 ${running}` : ""}${running && queued ? " · " : ""}${queued ? `排队 ${queued}` : ""}${!running && !queued ? "暂无任务" : ""}`;
  taskMonitorPanel.querySelector<HTMLElement>("header small")!.textContent =
    `生成中 ${running} · 排队 ${queued} · 等待上游 ${waiting}`;
  if (signature !== taskMonitorSignature) {
    taskMonitorSignature = signature;
    const list =
        taskMonitorPanel.querySelector<HTMLElement>("[data-task-list]")!,
      visible = tasks.slice(0, 30),
      previousTop = list.scrollTop,
      anchor = [...list.querySelectorAll<HTMLElement>("[data-task-node]")].find(
        (item) => item.offsetTop + item.offsetHeight > previousTop,
      ),
      anchorId = anchor?.dataset.taskNode,
      anchorOffset = anchor ? previousTop - anchor.offsetTop : 0;
    list.innerHTML = visible.length
      ? visible
          .map(
            ({ node, status }) =>
              `<button type="button" data-task-node="${node.id}"><i class="${status.className}">${node.kind === "video" ? "▶" : "▧"}</i><span><b>${escapeHtml(node.title || "未命名任务")}</b><small>${escapeHtml(modelDisplayName(node.model) || "默认模型")}</small></span><em>${status.label}</em></button>`,
          )
          .join("")
      : '<div class="task-monitor-empty"><b>✓</b><span>当前没有生成任务</span></div>';
    const nextAnchor = anchorId
      ? list.querySelector<HTMLElement>(`[data-task-node="${anchorId}"]`)
      : null;
    list.scrollTop = nextAnchor
      ? nextAnchor.offsetTop + anchorOffset
      : Math.min(
          previousTop,
          Math.max(0, list.scrollHeight - list.clientHeight),
        );
  } else
    tasks.forEach(({ node, status }) => {
      const label = taskMonitorPanel.querySelector<HTMLElement>(
        `[data-task-node="${node.id}"] > em`,
      );
      if (label) label.textContent = status.label;
    });
}
startEmptyImagesButton.addEventListener("click", startAllEmptyImages);
taskMonitorPanel
  .querySelector("[data-start-empty-mobile]")!
  .addEventListener("click", () => {
    startAllEmptyImages();
    taskMonitorPanel.classList.remove("open");
  });
function closeTopbarMenus(
  except?: "workspace" | "task" | "user" | "notifications" | "presence",
) {
  if (except !== "task") taskMonitorPanel.classList.remove("open");
  if (except !== "user") workspaceUserMenu.classList.remove("open");
  if (except !== "notifications") notificationModal.classList.remove("open");
  if (except !== "presence")
    document.querySelector("#online-status-panel")?.classList.remove("open");
  if (except !== "workspace") closeMobileWorkspaceMenu();
}
taskMonitorButton.addEventListener("click", (event) => {
  event.stopPropagation();
  const opening = !taskMonitorPanel.classList.contains("open");
  closeTopbarMenus(opening ? "task" : undefined);
  if (!opening) return;
  const rect = taskMonitorButton.getBoundingClientRect();
  taskMonitorPanel.style.top = `${rect.bottom + 8}px`;
  taskMonitorPanel.style.right = `${Math.max(12, innerWidth - rect.right)}px`;
  taskMonitorPanel.classList.add("open");
});
taskMonitorPanel
  .querySelector("header button")!
  .addEventListener("click", () => taskMonitorPanel.classList.remove("open"));
taskMonitorPanel
  .querySelector("[data-cancel-pending]")!
  .addEventListener("click", () => void cancelPendingProjectTasks());
taskMonitorPanel.addEventListener("click", (event) => event.stopPropagation());
document.addEventListener("click", () => {
  taskMonitorPanel.classList.remove("open");
  document.querySelector("#online-status-panel")?.classList.remove("open");
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
let saveTimer: number | undefined;
let drawFrame: number | null = null;
let drawNeedsDomSync = true;
const nodeDomStates = new Map<number, unknown[]>();
const pixiDetachedNodeCache = new Map<number, HTMLElement>();
let pixiEditorWarmScheduled = false;
function cacheDetachedPixiNode(id: number, element: HTMLElement) {
  pixiDetachedNodeCache.delete(id);
  pixiDetachedNodeCache.set(id, element);
  element.remove();
  while (pixiDetachedNodeCache.size > 2) {
    const oldestId = pixiDetachedNodeCache.keys().next().value as
      | number
      | undefined;
    if (oldestId === undefined) break;
    pixiDetachedNodeCache.delete(oldestId);
    nodeDomStates.delete(oldestId);
  }
}
function schedulePixiEditorWarmup() {
  if (pixiEditorWarmScheduled || pixiDetachedNodeCache.size >= 2 || !nodes.length)
    return;
  pixiEditorWarmScheduled = true;
  const warm = () => {
    pixiEditorWarmScheduled = false;
    const center = world({ x: innerWidth / 2, y: innerHeight / 2 }),
      offsetX = innerWidth / 2 + camera.x,
      offsetY = innerHeight / 2 + camera.y,
      candidates = canvasSpatialIndex
        .search({
          minX: -offsetX / camera.zoom,
          minY: -offsetY / camera.zoom,
          maxX: (innerWidth - offsetX) / camera.zoom,
          maxY: (innerHeight - offsetY) / camera.zoom,
        })
        .map((id) => nodes.find((node) => node.id === id))
        .filter((node): node is FlowNode => Boolean(node))
        .sort(
          (left, right) =>
            Math.hypot(left.x - center.x, left.y - center.y) -
            Math.hypot(right.x - center.x, right.y - center.y),
        );
    for (const node of candidates) {
      if (pixiDetachedNodeCache.has(node.id) || node.id === selection.selectedId) continue;
      cacheDetachedPixiNode(node.id, createDomNode(node));
      if (pixiDetachedNodeCache.size >= 2) break;
    }
  };
  const requestIdle = Reflect.get(window, "requestIdleCallback") as
    | ((callback: () => void, options: { timeout: number }) => number)
    | undefined;
  if (requestIdle) requestIdle(warm, { timeout: 1200 });
  else globalThis.setTimeout(warm, 180);
}
const pendingMediaLoads = new Set<string>();
const thumbnailLoadRetries = new Map<string, number>();
function releaseCachedImage(url: string, image: HTMLImageElement) {
  pendingMediaLoads.delete(url);
  image.onload = null;
  image.onerror = null;
  image.removeAttribute("src");
}
const imageCache = new MediaLruCache<HTMLImageElement>(
  innerWidth <= 780 ? 24 : 48,
  releaseCachedImage,
  (url) => pendingMediaLoads.has(url),
);
function clearThumbnailCache() {
  imageCache.clear();
  pendingMediaLoads.clear();
  thumbnailLoadRetries.clear();
}
function trimThumbnailCache() {
  imageCache.trim();
}
function rememberCachedImage(url: string, image: HTMLImageElement) {
  imageCache.set(url, image);
}
function releaseFullResolutionPreviews() {
  document
    .querySelectorAll<HTMLVideoElement>("#home-preview video,#preview-video")
    .forEach((video) => {
      video.pause();
      video.removeAttribute("src");
      video.load();
    });
  document
    .querySelectorAll<HTMLImageElement>("#home-preview img,#preview-image")
    .forEach((image) => image.removeAttribute("src"));
  document
    .querySelectorAll<HTMLElement>("#home-preview,#asset-preview")
    .forEach((preview) => preview.classList.remove("open"));
}
document.addEventListener("visibilitychange", () => {
  const backgrounded = document.hidden;
  if (backgrounded) pixiRenderer?.suspend();
  else pixiRenderer?.resume();
  document.body.classList.toggle("page-backgrounded", backgrounded);
  if (backgrounded) {
    clearThumbnailCache();
    releaseFullResolutionPreviews();
    nodeDomStates.clear();
    nodeLayer
      .querySelectorAll<HTMLElement>(".node-media")
      .forEach((media) => delete media.dataset.sourceKey);
    nodeLayer
      .querySelectorAll<HTMLCanvasElement>("[data-reference-url]")
      .forEach((media) => delete media.dataset.paintedUrl);
    nodeLayer
      .querySelectorAll<HTMLCanvasElement>(".node-media-canvas")
      .forEach((media) => {
        media.width = 2;
        media.height = 2;
      });
  } else {
    nodeDomStates.clear();
    draw(true);
  }
});
window.addEventListener("pagehide", clearThumbnailCache);
window.addEventListener("pageshow", () => {
  document.body.classList.remove("page-backgrounded", "page-unfocused");
  nodeDomStates.clear();
  requestAnimationFrame(() => {
    resize();
    draw(true);
  });
});
window.addEventListener("focus", () => {
  if (document.visibilityState !== "visible") return;
  document.body.classList.remove("page-backgrounded", "page-unfocused");
  requestAnimationFrame(() => draw(true));
});
window.addEventListener("blur", () =>
  document.body.classList.add("page-unfocused"),
);
window.addEventListener("focus", () => {
  document.body.classList.remove("page-unfocused");
  draw();
});
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
function friendlyGenerationError(raw: string, fallback: string) {
  const text = raw.trim() || fallback,
    lower = text.toLowerCase(),
    requestId = text.match(/request id\s*[:：]?\s*([a-z0-9-]+)/i)?.[1];
  if (
    /safety system|content.?policy|safety_violations|安全(?:系统|检查)|内容政策/.test(
      lower,
    )
  )
    return {
      title: "图片未通过安全检查",
      message: "提示词或参考图片可能触发了内容安全规则。",
      advice:
        "尝试使用更中性的描述，移除危险动作；如果使用了参考图，请逐张排查或更换图片。",
      requestId,
    };
  if (
    /\b401\b|unauthorized|invalid api key|incorrect api key|鉴权|密钥.*(?:无效|错误)/.test(
      lower,
    )
  )
    return {
      title: "接口认证失败",
      message: "当前 API 密钥无效、已过期或没有该模型权限。",
      advice: "请检查接口地址、密钥和模型权限后重试。",
      requestId,
    };
  if (/\b403\b|forbidden|permission denied|无权限/.test(lower))
    return {
      title: "接口没有访问权限",
      message: "当前账号或密钥无权执行这项生成任务。",
      advice: "检查模型授权、账号权限或代理服务配置。",
      requestId,
    };
  if (/\b429\b|rate.?limit|too many requests|quota|额度|请求过多/.test(lower))
    return {
      title: "请求过于频繁",
      message: "生成接口当前繁忙，或账号额度已经用完。",
      advice: "稍后重试，并检查接口额度与并发限制。",
      requestId,
    };
  if (/auth_unavailable|no auth available/.test(lower))
    return {
      title: "CPA 暂无可用账号",
      message: "CPA 的生图认证池当前没有可用账号。",
      advice:
        "暂停重复提交，等待账号冷却后再试，或检查 CPA 的 Codex 认证状态。",
      requestId,
    };
  if (/unexpected eof|backend-api\/codex\/images/.test(lower))
    return {
      title: "CPA 生图连接中断",
      message: "CPA 请求上游图片接口时连接被提前断开。",
      advice:
        "这不是素材顺序错误；等待 CPA 恢复后重试，持续出现时请检查 CPA 日志和账号状态。",
      requestId,
    };
  if (/结果保存到资产库失败|result archive|下载生成结果失败/.test(lower))
    return {
      title: "生成结果归档失败",
      message: "模型已经生成完成，但服务器下载结果并写入资产库时网络中断。",
      advice:
        "这不是提示词或参考图问题；可以重试任务，若持续出现请检查结果地址与代理连接。",
      requestId,
    };
  if (/timeout|timed out|aborted due to timeout|超时/.test(lower))
    return {
      title: "生成等待时间过长",
      message: "接口在限定时间内没有返回完整结果。",
      advice: "稍后重试；复杂提示词可以切换为简洁模式，并减少参考图片数量。",
      requestId,
    };
  if (
    /download.*image|image.*download|读取.*图片|参考图片.*(?:读取|下载)|首帧图片/.test(
      lower,
    )
  )
    return {
      title: "参考图片读取失败",
      message: "生成服务暂时无法访问其中一张参考图片。",
      advice: "重新上传图片、检查公网地址，或稍后再试。",
      requestId,
    };
  if (/未返回任务 id|没有.*task.?id|without.*(?:task|request).*id/.test(lower))
    return {
      title: "接口格式不兼容",
      message: "视频接口没有返回可用于查询进度的任务编号。",
      advice: "检查所选模型与 Provider 适配方式是否匹配。",
      requestId,
    };
  if (
    /\b5\d\d\b|bad gateway|service unavailable|internal server error|upstream/.test(
      lower,
    )
  )
    return {
      title: "生成服务暂时异常",
      message: "上游接口当前不可用或返回了服务端错误。",
      advice: "稍后重试；如果持续发生，请检查 CPA 或模型服务日志。",
      requestId,
    };
  return {
    title: "生成失败",
    message: fallback || "任务未能完成。",
    advice: "可以重试一次；若仍然失败，请展开技术详情查看接口返回。",
    requestId,
  };
}
function showToast(
  message: string,
  type: "error" | "success" | "warning" | "info" = "error",
  detail = "",
) {
  if (type === "info") {
    showCanvasGuide({
      key: "video-reference-order-guide",
      title: "调整素材顺序",
      detail: detail || message,
      tone: "online",
      priority: 44,
      duration: 4200,
    });
    return;
  }
  const toast = document.createElement("div"),
    raw = detail || message,
    friendly = type === "error" ? friendlyGenerationError(raw, message) : null;
  const successTitle = /登录/.test(message)
    ? "登录成功"
    : /生成|创建|加入资产库/.test(message)
      ? "生成完成"
      : /保存|更新|重命名|复制/.test(message)
        ? "保存完成"
        : "操作完成";
  const toastTitle =
    friendly?.title ||
    (type === "success"
      ? successTitle
      : type === "warning"
        ? "提示"
        : "操作失败");
  toast.className = `app-toast ${type}`;
  toast.innerHTML = `<i>${type === "error" ? "!" : type === "success" ? "✓" : "i"}</i><span><b>${escapeHtml(toastTitle)}</b><small>${escapeHtml(friendly?.message || message)}</small>${friendly ? `<p>${escapeHtml(friendly.advice)}</p><details><summary>技术详情</summary><em>${escapeHtml(raw)}${friendly.requestId ? `\nRequest ID: ${escapeHtml(friendly.requestId)}` : ""}</em></details>` : detail ? `<em>${escapeHtml(detail)}</em>` : ""}</span><button type="button" aria-label="关闭">×</button>`;
  let timer =
    type === "error"
      ? 0
      : window.setTimeout(
          () => toast.remove(),
          type === "warning" ? 9000 : 6000,
        );
  toast.querySelector("button")!.addEventListener("click", () => {
    window.clearTimeout(timer);
    toast.remove();
  });
  toast.querySelector("details")?.addEventListener("toggle", (event) => {
    if (type === "error") return;
    if ((event.currentTarget as HTMLDetailsElement).open)
      window.clearTimeout(timer);
    else timer = window.setTimeout(() => toast.remove(), 12000);
  });
  toastStack.append(toast);
  while (toastStack.children.length > 3) toastStack.firstElementChild?.remove();
}

function normalizePromptText(prompt?: string) {
  let value = prompt?.trim() || "";
  if (!value) return "";
  const blocks = value
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (
    blocks.length % 2 === 0 &&
    blocks.slice(0, blocks.length / 2).join("\n\n") ===
      blocks.slice(blocks.length / 2).join("\n\n")
  )
    value = blocks.slice(0, blocks.length / 2).join("\n\n");
  const lines = value.split("\n"),
    cleaned: string[] = [];
  for (const line of lines) {
    if (line.trim() && line.trim() === cleaned.at(-1)?.trim()) continue;
    cleaned.push(line);
  }
  return cleaned.join("\n").trim();
}
function decodePromptClipboardText(value: string) {
  const encoded = (value.match(/%[0-9a-fA-F]{2}/g) || []).length;
  if (encoded < 2 && !/%20/i.test(value)) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value.replace(/%20/gi, " ");
  }
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

function appAssetFingerprint(root: Document) {
  return [
    ...root.querySelectorAll<HTMLScriptElement | HTMLLinkElement>(
      'script[type="module"][src],link[rel="stylesheet"][href]',
    ),
  ]
    .map(
      (element) =>
        element.getAttribute(
          element instanceof HTMLScriptElement ? "src" : "href",
        ) || "",
    )
    .filter(Boolean)
    .sort()
    .join("|");
}
const initialAppAssets = appAssetFingerprint(document);
let updateNoticeShown = false;
type CanvasGuideTone = "neutral" | "online" | "offline";
type CanvasGuideAction = { label: string; primary?: boolean; run: () => void };
type CanvasGuideMessage = {
  key: string;
  title: string;
  detail: string;
  tone?: CanvasGuideTone;
  priority?: number;
  duration?: number;
  actions?: CanvasGuideAction[];
};
let canvasGuideBubble: HTMLElement | null = null;
let canvasGuideKey = "",
  canvasGuidePriority = -1,
  canvasGuideTimer = 0,
  canvasGuideHideTimer = 0,
  canvasGuideFrame = 0;
let serviceKnownOffline = false;
function positionInspirationBubble(notice: HTMLElement) {
  const trigger = document.querySelector<HTMLElement>("#prompt-agent-trigger");
  if (!trigger || !notice.isConnected) return;
  const icon = trigger.querySelector<HTMLElement>("b") || trigger;
  const rect = icon.getBoundingClientRect();
  const anchorX = rect.left + rect.width / 2;
  const gap = 34;
  // Starting at the icon: small -> middle -> body travels up and to the right.
  const preferredTailX = 18;
  const width = notice.offsetWidth;
  const left = Math.max(
    12,
    Math.min(innerWidth - width - 12, anchorX - preferredTailX),
  );
  const tailX = Math.max(10, Math.min(width - 10, anchorX - left));
  notice.style.left = `${left}px`;
  notice.style.bottom = `${Math.max(12, innerHeight - rect.top + gap)}px`;
  notice.style.setProperty("--bubble-tail-x", `${tailX}px`);
}
function followInspirationBubble(notice: HTMLElement) {
  if (canvasGuideFrame) cancelAnimationFrame(canvasGuideFrame);
  let previous = "";
  const follow = () => {
    if (!notice.isConnected || notice.hidden) {
      canvasGuideFrame = 0;
      return;
    }
    const trigger = document.querySelector<HTMLElement>(
      "#prompt-agent-trigger",
    );
    const icon = trigger?.querySelector<HTMLElement>("b") || trigger;
    if (icon) {
      const rect = icon.getBoundingClientRect();
      const signature = `${rect.left.toFixed(2)}:${rect.top.toFixed(2)}:${rect.width.toFixed(2)}:${notice.offsetWidth}`;
      if (signature !== previous) {
        previous = signature;
        positionInspirationBubble(notice);
      }
    }
    canvasGuideFrame = requestAnimationFrame(follow);
  };
  canvasGuideFrame = requestAnimationFrame(follow);
}
function ensureCanvasGuideBubble() {
  if (canvasGuideBubble) return canvasGuideBubble;
  canvasGuideBubble = document.createElement("aside");
  canvasGuideBubble.className = "app-update-popover service-status-popover";
  canvasGuideBubble.hidden = true;
  document.body.append(canvasGuideBubble);
  return canvasGuideBubble;
}
function burstCanvasGuide(notice: HTMLElement) {
  const rect = notice.getBoundingClientRect(),
    field = document.createElement("div");
  field.className = "canvas-guide-particle-field";
  field.style.left = `${rect.left + rect.width / 2}px`;
  field.style.top = `${rect.top + rect.height / 2}px`;
  field.innerHTML = Array.from({ length: 24 }, () => {
    const angle = Math.random() * Math.PI * 2,
      distance = 38 + Math.random() * 104,
      startX = (Math.random() - 0.5) * Math.min(84, rect.width * 0.34),
      startY = (Math.random() - 0.5) * Math.min(34, rect.height * 0.5),
      size = 3 + Math.random() * 5;
    return `<i style="left:${startX}px;top:${startY}px;width:${size}px;height:${size}px;--guide-px:${Math.cos(angle) * distance}px;--guide-py:${Math.sin(angle) * distance * (0.58 + Math.random() * 0.55)}px;--guide-delay:${Math.random() * 70}ms"></i>`;
  }).join("");
  document.body.append(field);
  window.setTimeout(() => field.remove(), 860);
}
function hideCanvasGuide(key?: string) {
  if (key && key !== canvasGuideKey) return;
  window.clearTimeout(canvasGuideTimer);
  canvasGuideTimer = 0;
  if (canvasGuideFrame) cancelAnimationFrame(canvasGuideFrame);
  canvasGuideFrame = 0;
  canvasGuideKey = "";
  canvasGuidePriority = -1;
  if (canvasGuideBubble && !canvasGuideBubble.hidden) {
    window.clearTimeout(canvasGuideHideTimer);
    const leaving = canvasGuideBubble;
    burstCanvasGuide(leaving);
    leaving.hidden = true;
    leaving.classList.remove("is-entering", "is-leaving");
  }
}
function showCanvasGuide(message: CanvasGuideMessage) {
  const priority = message.priority ?? 20;
  const duration = message.duration ?? (priority <= 40 ? 2800 : 0);
  if (
    canvasGuideKey &&
    canvasGuideKey !== message.key &&
    priority < canvasGuidePriority
  )
    return false;
  const notice = ensureCanvasGuideBubble();
  window.clearTimeout(canvasGuideTimer);
  canvasGuideTimer = 0;
  window.clearTimeout(canvasGuideHideTimer);
  canvasGuideHideTimer = 0;
  canvasGuideKey = message.key;
  canvasGuidePriority = priority;
  notice.className = `app-update-popover service-status-popover ${message.tone ?? "neutral"}${message.actions?.length ? " interactive" : ""}`;
  notice.innerHTML = `<span><b>${escapeHtml(message.title)}</b><small>${escapeHtml(message.detail)}</small>${message.actions?.length ? "<em></em>" : ""}</span>`;
  const actions = notice.querySelector<HTMLElement>("em");
  message.actions?.forEach((action) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action.label;
    if (action.primary) button.dataset.updateReload = "";
    button.addEventListener("click", action.run);
    actions?.append(button);
  });
  notice.hidden = false;
  notice.classList.remove("is-leaving", "is-entering");
  void notice.offsetWidth;
  notice.classList.add("is-entering");
  followInspirationBubble(notice);
  if (duration > 0)
    canvasGuideTimer = window.setTimeout(
      () => hideCanvasGuide(message.key),
      duration,
    );
  return true;
}
async function checkForAppUpdate() {
  if (
    updateNoticeShown ||
    !initialAppAssets ||
    document.visibilityState === "hidden"
  )
    return;
  try {
    const response = await apiFetch(`/?app-version=${Date.now()}`, {
      cache: "no-store",
      headers: { "cache-control": "no-cache" },
    });
    if (!response.ok) return;
    const nextDocument = new DOMParser().parseFromString(
      await response.text(),
      "text/html",
    );
    const nextAssets = appAssetFingerprint(nextDocument);
    if (!nextAssets || nextAssets === initialAppAssets) return;
    updateNoticeShown = showCanvasGuide({
      key: "app-update",
      title: "检测到服务器版本更新",
      detail: "刷新页面后即可使用最新版本。",
      priority: 80,
      actions: [
        { label: "稍后", run: () => hideCanvasGuide("app-update") },
        { label: "刷新生效", primary: true, run: () => location.reload() },
      ],
    });
  } catch {
    /* deployment may briefly reset the connection */
  }
}
let backgroundMaintenanceTimer = 0;
function runBackgroundMaintenance() {
  if (document.hidden || !authUser) return;
  void Promise.all([checkForAppUpdate(), loadGenerationCapabilities(true)]);
}
window.setTimeout(() => {
  runBackgroundMaintenance();
  backgroundMaintenanceTimer = window.setInterval(
    runBackgroundMaintenance,
    30_000,
  );
}, 20_000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void checkForAppUpdate();
});

const homePage = document.querySelector<HTMLElement>("#home-page")!;
const homeGallery = document.querySelector<HTMLElement>("#home-gallery")!;
const homeLoginModal =
  document.querySelector<HTMLElement>("#home-login-modal")!;
const homePreview = document.querySelector<HTMLElement>("#home-preview")!;
type CustomApiModel = {
  id: string;
  kind: "image" | "video";
  name: string;
  model: string;
  baseUrl: string;
  hasKey: boolean;
  hasProxy: boolean;
};
type AppNotification = {
  id: string;
  title: string;
  content: string;
  type: string;
  createdAt: string;
  isRead: boolean;
};
let authUser: AuthUser | null = null;
let customApiModels: CustomApiModel[] = [];
let appNotifications: AppNotification[] = [];
let autoPopupCheckedUserId = "";
let authReady = false;
let authMode: "login" | "register" = "login";
let showcaseLoaded = false;
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
  setAuthMode(mode);
  homeLoginModal.classList.add("open");
  homeLoginModal
    .querySelector<HTMLInputElement>('input[name="email"]')!
    .focus();
}
function setAuthMode(mode: "login" | "register") {
  authMode = mode;
  homeLoginModal
    .querySelectorAll<HTMLElement>("[data-auth-mode]")
    .forEach((button) =>
      button.classList.toggle("active", button.dataset.authMode === mode),
    );
  homeLoginModal
    .querySelectorAll<HTMLElement>("[data-register-field]")
    .forEach((field) => {
      field.hidden = mode !== "register";
    });
  const name =
      homeLoginModal.querySelector<HTMLInputElement>('input[name="name"]')!,
    inviteCode = homeLoginModal.querySelector<HTMLInputElement>(
      'input[name="inviteCode"]',
    )!,
    account = homeLoginModal.querySelector<HTMLInputElement>(
      'input[name="email"]',
    )!;
  name.required = mode === "register";
  inviteCode.required = mode === "register";
  name.parentElement!.firstChild!.textContent = "用户名";
  name.placeholder = "用于登录，例如 creator_01";
  account.type = mode === "register" ? "email" : "text";
  account.autocomplete = mode === "register" ? "email" : "username";
  account.placeholder =
    mode === "register" ? "name@example.com" : "输入用户名或邮箱";
  account.parentElement!.firstChild!.textContent =
    mode === "register" ? "邮箱" : "用户名 / 邮箱";
  homeLoginModal.querySelector<HTMLElement>(".home-login-submit")!.textContent =
    mode === "register" ? "使用邀请码创建账号" : "登录";
  homeLoginModal.querySelector<HTMLElement>(".home-login-error")!.textContent =
    "";
}
function renderAuthenticatedUser() {
  userMenuController.render(authUser);
  if (authUser) {
    void loadNotifications();
    connectNotificationStream();
  } else disconnectNotificationStream();
}
async function ensureCurrentUserProject() {
  const response = await apiFetch("/api/projects");
  if (!response.ok) return false;
  const projects = (await response.json()) as Array<{ id: string }>;
  if (!projects.length) return false;
  if (!projects.some((project) => project.id === currentProjectId)) {
    currentProjectId = projects[0].id;
    localStorage.setItem("flow-project-id", currentProjectId);
  }
  return true;
}
async function synchronizeCanvasAfterAuthentication(force = false) {
  if (!authUser) return false;
  if (!force && location.hash !== "#/canvas" && authMode === "login")
    return ensureCurrentUserProject();
  await ensurePixiRenderer();
  canvasSaveBlocked = true;
  window.clearTimeout(saveTimer);
  canvasSaveQueued = false;
  canvasSaveAbort?.abort();
  canvasLoadedProjectId = "";
  canvasBaseline = null;
  canvasServerVersion = 0;
  canvasServerUpdatedAt = "";
  canvasNodeIdBlockEnd = 0;
  setWorkspaceBootStatus("正在同步账号与项目");
  if (!(await ensureCurrentUserProject())) return false;
  setWorkspaceBootStatus("正在恢复画布与任务");
  await loadCanvas(true);
  return (
    canvasLoadedProjectId === currentProjectId &&
    !canvasSaveBlocked &&
    canvasServerVersion > 0
  );
}
async function enterWorkspace() {
  if (!authUser) return;
  document.body.classList.add(
    "home-mode",
    "workspace-loading",
    "workspace-preparing",
  );
  setWorkspaceBootStatus("正在同步账号与项目");
  const ready =
    canvasLoadedProjectId === currentProjectId &&
    !canvasSaveBlocked &&
    canvasServerVersion > 0;
  let finalStatus = workspaceBootStatusVersion,
    completed = false;
  try {
    await ensurePixiRenderer();
    if (!ready && !(await synchronizeCanvasAfterAuthentication(true)))
      throw new Error("画布尚未完整同步，请检查网络后重试");
    setWorkspaceBootStatus("正在加载资产索引与创作模型");
    await Promise.all([loadAssets(false), loadCustomApiModels()]);
    completed = true;
    finalStatus = setWorkspaceBootStatus("工作区已准备完成");
  } catch (error) {
    showToast(
      error instanceof Error ? error.message : "工作区加载失败",
      "error",
    );
    finalStatus = setWorkspaceBootStatus("工作区加载失败");
  } finally {
    if (completed) {
      location.hash = "#/canvas";
      document.body.classList.remove("workspace-preparing");
      applyAppRoute();
    }
    hideWorkspaceBootStatusAfter(finalStatus, completed ? 360 : 1800);
    document.body.classList.remove("workspace-loading");
    if (!completed) document.body.classList.remove("workspace-preparing");
  }
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
let homeSceneProgress = 0,
  homeSceneTarget = 0,
  homeSceneFrame = 0,
  homeSceneStart = 0,
  homeSceneStartedAt = 0,
  homeTouchY = 0,
  homeWheelDelta = 0,
  homeWheelResetTimer = 0,
  homeWheelLockedUntil = 0;
function setHomeSceneTarget(value: number) {
  const next = Math.max(0, Math.min(3, Math.round(value)));
  if (next === homeSceneTarget && homeSceneFrame) return;
  homeSceneStart = homeSceneProgress;
  homeSceneTarget = next;
  homeSceneStartedAt = performance.now();
  if (!homeSceneFrame) homeSceneFrame = requestAnimationFrame(animateHomeScene);
}
function animateHomeScene(now: number) {
  const duration = 700;
  const elapsed = Math.min(
    1,
    Math.max(0, (now - homeSceneStartedAt) / duration),
  );
  const eased = 1 - Math.pow(1 - elapsed, 3);
  homeSceneProgress =
    homeSceneStart + (homeSceneTarget - homeSceneStart) * eased;
  if (elapsed >= 1) homeSceneProgress = homeSceneTarget;
  homePage.style.setProperty("--home-progress", homeSceneProgress.toFixed(4));
  homePage
    .querySelectorAll<HTMLElement>(".home-scene")
    .forEach((element, index) => {
      const distance = index - homeSceneProgress;
      element.style.setProperty("--scene-distance", distance.toFixed(4));
      element.style.setProperty(
        "--scene-presence",
        Math.max(0, 1 - Math.abs(distance)).toFixed(4),
      );
    });
  const scene = Math.max(0, Math.min(3, Math.round(homeSceneProgress)));
  homePage.dataset.scene = String(scene);
  homePage
    .querySelectorAll<HTMLElement>("[data-home-scene]")
    .forEach((button) =>
      button.classList.toggle(
        "active",
        Number(button.dataset.homeScene) === scene,
      ),
    );
  if (elapsed < 1) homeSceneFrame = requestAnimationFrame(animateHomeScene);
  else homeSceneFrame = 0;
}
homePage.addEventListener(
  "wheel",
  (event) => {
    if (
      innerWidth <= 800 ||
      homeLoginModal.classList.contains("open") ||
      homePreview.classList.contains("open") ||
      (event.target as HTMLElement).closest(".home-gallery-card")
    )
      return;
    event.preventDefault();
    if (performance.now() < homeWheelLockedUntil) return;
    homeWheelDelta += event.deltaY;
    window.clearTimeout(homeWheelResetTimer);
    homeWheelResetTimer = window.setTimeout(() => {
      homeWheelDelta = 0;
    }, 180);
    if (Math.abs(homeWheelDelta) < 54) return;
    setHomeSceneTarget(Math.round(homeSceneTarget) + Math.sign(homeWheelDelta));
    homeWheelDelta = 0;
    homeWheelLockedUntil = performance.now() + 760;
  },
  { passive: false },
);
homePage
  .querySelectorAll<HTMLElement>("[data-home-scene]")
  .forEach((button) =>
    button.addEventListener("click", () =>
      setHomeSceneTarget(Number(button.dataset.homeScene)),
    ),
  );
homePage
  .querySelectorAll<HTMLAnchorElement>('a[href="#showcase"]')
  .forEach((link) =>
    link.addEventListener("click", (event) => {
      if (innerWidth <= 800) return;
      event.preventDefault();
      setHomeSceneTarget(3);
    }),
  );
homePage.addEventListener(
  "touchstart",
  (event) => {
    homeTouchY = event.touches[0]?.clientY ?? 0;
  },
  { passive: true },
);
homePage.addEventListener(
  "touchend",
  (event) => {
    if (innerWidth <= 800) return;
    const distance =
      homeTouchY - (event.changedTouches[0]?.clientY ?? homeTouchY);
    if (Math.abs(distance) > 45)
      setHomeSceneTarget(Math.round(homeSceneTarget) + (distance > 0 ? 1 : -1));
  },
  { passive: true },
);
setHomeSceneTarget(0);
homeLoginModal
  .querySelector(".home-login-close")!
  .addEventListener("click", () => homeLoginModal.classList.remove("open"));
homeLoginModal.addEventListener("click", (event) => {
  if (event.target === homeLoginModal) homeLoginModal.classList.remove("open");
});
homeLoginModal
  .querySelectorAll<HTMLElement>("[data-auth-mode]")
  .forEach((button) =>
    button.addEventListener("click", () =>
      setAuthMode(button.dataset.authMode as "login" | "register"),
    ),
  );
homeLoginModal
  .querySelector("form")!
  .addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement,
      submit = form.querySelector<HTMLButtonElement>(".home-login-submit")!,
      error = form.querySelector<HTMLOutputElement>(".home-login-error")!,
      data = new FormData(form),
      completedMode = authMode;
    submit.disabled = true;
    error.textContent = "";
    try {
      const response = await apiFetch(`/api/auth/${completedMode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          inviteCode: data.get("inviteCode"),
          email: data.get("email"),
          password: data.get("password"),
        }),
      });
      const result = (await response.json()) as AuthUser & { error?: string };
      if (!response.ok) throw new Error(result.error || "登录失败");
      authUser = result;
      authReady = true;
      lastUserActivity = Date.now();
      scheduleIdleLogout();
      renderAuthenticatedUser();
      if (!(await synchronizeCanvasAfterAuthentication()))
        throw new Error("登录成功，但画布未能完整同步，请重试");
      homeLoginModal.classList.remove("open");
      form.reset();
      if (completedMode === "register") {
        location.hash = "#/canvas";
        await Promise.all([loadAssets(), loadCustomApiModels()]);
        applyAppRoute();
      } else showToast(`欢迎回来，${result.name}`, "success");
    } catch (reason) {
      error.textContent =
        reason instanceof Error ? reason.message : "登录失败，请重试";
    } finally {
      submit.disabled = false;
    }
  });
homePreview
  .querySelector(":scope > button")!
  .addEventListener("click", closeHomePreview);
homePreview.addEventListener("click", (event) => {
  if (event.target === homePreview) closeHomePreview();
});
const workspaceUserMenu = document.querySelector<HTMLElement>(
  "#workspace-user-menu",
)!;
async function logoutToHome(message?: string) {
  window.clearTimeout(saveTimer);
  canvasSaveQueued = false;
  canvasSaveBlocked = true;
  canvasSaveAbort?.abort();
  await canvasSavePromise?.catch(() => {});
  canvasLoadedProjectId = "";
  canvasBaseline = null;
  canvasServerVersion = 0;
  canvasServerUpdatedAt = "";
  await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  authUser = null;
  userMenuController.clearToken();
  nodes.splice(0);
  links.splice(0);
  selection.selectedId = 0;
  userMenuController.close();
  renderAuthenticatedUser();
  location.hash = "#/";
  applyAppRoute();
  if (message) showToast(message, "warning");
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
let notificationVisibleCount = 3;
const notificationLoadObserver = new IntersectionObserver(
  (entries) => {
    if (
      !entries.some((entry) => entry.isIntersecting) ||
      notificationVisibleCount >= appNotifications.length
    )
      return;
    notificationVisibleCount = Math.min(
      appNotifications.length,
      notificationVisibleCount + 3,
    );
    renderNotifications();
  },
  { root: notificationList, rootMargin: "0px 0px 20px" },
);
const onlineStatus = document.createElement("button"),
  onlineStatusPanel = document.createElement("div");
onlineStatus.id = "online-status";
onlineStatus.type = "button";
onlineStatus.ariaLabel = "在线状态";
onlineStatus.innerHTML = "<i></i><b>同步中</b>";
onlineStatusPanel.id = "online-status-panel";
onlineStatusPanel.innerHTML =
  "<header><i></i><span><b>创作空间在线</b><small>按登录用户去重统计</small></span></header><p>关闭页面或连接中断后，在线状态会自动更新。</p>";
document
  .querySelector("#open-notifications")!
  .before(onlineStatus, onlineStatusPanel);
let lastOnlineUserCount: number | undefined;
function renderOnlineStatus(count = lastOnlineUserCount, reconnecting = false) {
  if (count !== undefined) lastOnlineUserCount = count;
  const label =
    count === undefined
      ? "同步中"
      : count <= 1
        ? "创作空间在线"
        : `${count} 人在线`;
  onlineStatus.querySelector("b")!.textContent = label;
  onlineStatus.classList.toggle("connected", count !== undefined);
  onlineStatus.classList.toggle("reconnecting", reconnecting);
  onlineStatus.title = reconnecting ? "在线人数连接正在恢复" : label;
  onlineStatusPanel.querySelector("header b")!.textContent = label;
  onlineStatusPanel.querySelector("header small")!.textContent = reconnecting
    ? "连接波动，正在后台恢复"
    : "按登录用户去重统计";
}
onlineStatus.addEventListener("click", (event) => {
  event.stopPropagation();
  const opening = !onlineStatusPanel.classList.contains("open");
  closeTopbarMenus(opening ? "presence" : undefined);
  onlineStatusPanel.classList.toggle("open", opening);
});
onlineStatusPanel.addEventListener("click", (event) => event.stopPropagation());
function notificationTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
function renderNotifications() {
  const scrollTop = notificationList.scrollTop,
    unread = appNotifications.filter((item) => !item.isRead).length,
    visible = appNotifications.slice(0, notificationVisibleCount);
  notificationLoadObserver.disconnect();
  notificationCount.textContent = String(unread);
  notificationCount.parentElement!.classList.toggle("has-unread", unread > 0);
  notificationCount.parentElement!.title = unread
    ? `${unread} 条未读通知`
    : "暂无未读通知";
  notificationList.innerHTML = appNotifications.length
    ? visible
        .map(
          (item) =>
            `<article class="notification-item${item.isRead ? " read" : " unread"}" data-notification-id="${escapeHtml(item.id)}"><i aria-hidden="true"></i><div><header><span>${item.type === "fix" ? "问题修复" : "产品更新"}</span><time>${escapeHtml(notificationTime(item.createdAt))}</time></header><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.content)}</p></div></article>`,
        )
        .join("") +
      (visible.length < appNotifications.length
        ? `<div class="notification-load-hint">向下滚动加载更多 · ${visible.length} / ${appNotifications.length}</div>`
        : "")
    : '<div class="notification-empty"><i>◇</i><b>暂时没有新通知</b><span>产品进展会在这里与你同步</span></div>';
  notificationList.scrollTop = scrollTop;
  const loadHint = notificationList.querySelector<HTMLElement>(
    ".notification-load-hint",
  );
  if (loadHint) notificationLoadObserver.observe(loadHint);
  notificationList
    .querySelectorAll<HTMLElement>("[data-notification-id]")
    .forEach((item) =>
      item.addEventListener("click", async () => {
        const id = item.dataset.notificationId!,
          target = appNotifications.find((entry) => entry.id === id);
        if (!target || target.isRead) return;
        target.isRead = true;
        renderNotifications();
        const response = await apiFetch(
          `/api/notifications/${encodeURIComponent(id)}/read`,
          { method: "POST" },
        );
        if (!response.ok) {
          target.isRead = false;
          renderNotifications();
          showToast("通知状态同步失败，请稍后重试", "error");
        }
      }),
    );
}
async function claimDailyNotificationPopup() {
  if (!authUser || autoPopupCheckedUserId === authUser.id) return;
  autoPopupCheckedUserId = authUser.id;
  try {
    const response = await apiFetch("/api/notifications/claim-popup", {
        method: "POST",
      }),
      result = (await response.json()) as { show?: boolean };
    if (response.ok && result.show) notificationModal.classList.add("open");
  } catch {
    /* 未读角标仍可正常使用 */
  }
}
async function loadNotifications() {
  if (!authUser) {
    appNotifications = [];
    autoPopupCheckedUserId = "";
    renderNotifications();
    return;
  }
  try {
    const response = await apiFetch("/api/notifications");
    if (!response.ok) throw new Error(String(response.status));
    appNotifications = (await response.json()) as AppNotification[];
    renderNotifications();
    void claimDailyNotificationPopup();
  } catch {
    notificationCount.textContent = "!";
    if (notificationModal.classList.contains("open"))
      notificationList.innerHTML =
        '<div class="notification-empty"><i>!</i><b>通知加载失败</b><span>请稍后重新打开</span></div>';
  }
}
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
  isServiceGuideVisible: () => canvasGuideKey === "service-status",
  renderPresence: renderOnlineStatus,
  currentPresence: () => lastOnlineUserCount,
  clearPresence: () => {
    lastOnlineUserCount = undefined;
  },
  onNotifications: () => {
    autoPopupCheckedUserId = "";
    void loadNotifications();
  },
  onServerVersionChanged: () => void checkForAppUpdate(),
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
document.querySelector("#open-notifications")!.addEventListener("click", () => {
  const opening = !notificationModal.classList.contains("open");
  closeTopbarMenus(opening ? "notifications" : undefined);
  if (opening) {
    notificationVisibleCount = 3;
    notificationList.scrollTop = 0;
    notificationModal.classList.add("open");
    void loadNotifications();
  }
});
notificationList.addEventListener(
  "scroll",
  () => {
    if (
      notificationVisibleCount >= appNotifications.length ||
      notificationList.scrollTop + notificationList.clientHeight <
        notificationList.scrollHeight - 18
    )
      return;
    notificationVisibleCount = Math.min(
      appNotifications.length,
      notificationVisibleCount + 3,
    );
    renderNotifications();
  },
  { passive: true },
);
notificationModal
  .querySelectorAll("[data-notification-close]")
  .forEach((button) =>
    button.addEventListener("click", () =>
      notificationModal.classList.remove("open"),
    ),
  );
notificationModal.addEventListener("pointerdown", (event) => {
  if (event.target === notificationModal)
    notificationModal.classList.remove("open");
});
notificationModal
  .querySelector<HTMLElement>("[data-notification-read-all]")!
  .addEventListener("click", async () => {
    if (!appNotifications.some((item) => !item.isRead)) return;
    const previous = appNotifications.map((item) => item.isRead);
    appNotifications.forEach((item) => (item.isRead = true));
    renderNotifications();
    const response = await apiFetch("/api/notifications/read-all", {
      method: "POST",
    });
    if (!response.ok) {
      appNotifications.forEach(
        (item, index) => (item.isRead = previous[index]),
      );
      renderNotifications();
      showToast("全部已读同步失败，请稍后重试", "error");
    }
  });
document.querySelector("#open-feedback")!.addEventListener("click", () => {
  workspaceUserMenu.classList.remove("open");
  feedbackModal.classList.add("open");
  feedbackForm.querySelector<HTMLInputElement>('input[name="title"]')!.focus();
});
feedbackModal
  .querySelectorAll("[data-feedback-close]")
  .forEach((button) =>
    button.addEventListener("click", () =>
      feedbackModal.classList.remove("open"),
    ),
  );
feedbackModal.addEventListener("pointerdown", (event) => {
  if (event.target === feedbackModal) feedbackModal.classList.remove("open");
});
feedbackForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = feedbackForm.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    )!,
    output = feedbackForm.querySelector<HTMLOutputElement>("output")!,
    data = Object.fromEntries(new FormData(feedbackForm));
  submit.disabled = true;
  output.textContent = "正在提交…";
  try {
    const response = await apiFetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...data,
          projectId: currentProjectId || undefined,
          pageUrl: location.href,
          userAgent: navigator.userAgent,
        }),
      }),
      result = (await response.json().catch(() => ({}))) as {
        id?: string;
        error?: string;
      };
    if (!response.ok) throw new Error(result.error || "提交失败");
    feedbackForm.reset();
    output.textContent = "感谢反馈，我们已经收到。";
    showToast("反馈已提交，感谢你的帮助", "success");
    window.setTimeout(() => {
      feedbackModal.classList.remove("open");
      output.textContent = "";
    }, 1200);
  } catch (reason) {
    output.textContent =
      reason instanceof Error ? reason.message : "提交失败，请稍后重试";
  } finally {
    submit.disabled = false;
  }
});
const labModal = document.querySelector<HTMLElement>("#lab-modal")!;
document.querySelector("#open-lab")!.addEventListener("click", () => {
  workspaceUserMenu.classList.remove("open");
  const available = Math.max(
    0,
    Number(authUser?.credits ?? 0) - Number(authUser?.reservedCredits ?? 0),
  );
  labModal.querySelector<HTMLElement>("[data-credit-value]")!.textContent =
    String(available);
  labModal.querySelector<HTMLElement>("[data-credit-reserved]")!.textContent =
    Number(authUser?.reservedCredits ?? 0) > 0
      ? `${authUser!.reservedCredits} 点正在生成任务中冻结`
      : "";
  labModal.querySelector<HTMLFormElement>("#credit-admin-form")!.hidden =
    !authUser?.isAdmin;
  labModal.classList.add("open");
});
labModal
  .querySelectorAll<HTMLElement>("[data-lab-close]")
  .forEach((button) =>
    button.addEventListener("click", () => labModal.classList.remove("open")),
  );
labModal.addEventListener("pointerdown", (event) => {
  if (event.target === labModal) labModal.classList.remove("open");
});
labModal
  .querySelector<HTMLFormElement>("#credit-redeem-form")!
  .addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement,
      submit = form.querySelector<HTMLButtonElement>("button")!,
      output = form.querySelector<HTMLOutputElement>("output")!,
      code = new FormData(form).get("code");
    submit.disabled = true;
    output.textContent = "正在兑换…";
    try {
      const response = await apiFetch("/api/users/me/credits/redeem", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code }),
        }),
        result = (await response.json().catch(() => ({}))) as {
          added?: number;
          credits?: number;
          reservedCredits?: number;
          error?: string;
        };
      if (!response.ok) throw new Error(result.error || "兑换失败");
      authUser = {
        ...authUser!,
        credits: result.credits,
        reservedCredits: result.reservedCredits,
      };
      renderAuthenticatedUser();
      refreshNodeModelMenus();
      labModal.querySelector<HTMLElement>("[data-credit-value]")!.textContent =
        String(
          Math.max(
            0,
            Number(result.credits ?? 0) - Number(result.reservedCredits ?? 0),
          ),
        );
      form.reset();
      output.textContent = `兑换成功，已到账 ${result.added} 点`;
      showToast(`已到账 ${result.added} 创作点数`, "success");
    } catch (reason) {
      output.textContent =
        reason instanceof Error ? reason.message : "兑换失败，请重试";
    } finally {
      submit.disabled = false;
    }
  });
const creditAdminForm =
    labModal.querySelector<HTMLFormElement>("#credit-admin-form")!,
  creditCodesOutput =
    creditAdminForm.querySelector<HTMLTextAreaElement>("textarea")!;
creditAdminForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = creditAdminForm.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    )!,
    output = creditAdminForm.querySelector<HTMLOutputElement>("output")!,
    data = Object.fromEntries(new FormData(creditAdminForm));
  submit.disabled = true;
  output.textContent = "正在生成…";
  try {
    const response = await apiFetch("/api/admin/recharge-codes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      }),
      result = (await response.json().catch(() => ({}))) as {
        codes?: string[];
        error?: string;
      };
    if (!response.ok) throw new Error(result.error || "生成失败");
    creditCodesOutput.value = (result.codes ?? []).join("\n");
    output.textContent = `已生成 ${result.codes?.length ?? 0} 个充值码`;
  } catch (reason) {
    output.textContent = reason instanceof Error ? reason.message : "生成失败";
  } finally {
    submit.disabled = false;
  }
});
creditAdminForm
  .querySelector("[data-copy-codes]")!
  .addEventListener("click", async () => {
    if (!creditCodesOutput.value) return;
    await navigator.clipboard.writeText(creditCodesOutput.value);
    showToast("充值码已复制", "success");
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
async function loadCustomApiModels() {
  const response = await apiFetch("/api/user-api-models");
  if (response.ok) {
    customApiModels = (await response.json()) as CustomApiModel[];
    renderCustomApiModels();
    refreshNodeModelMenus();
  }
}
function renderCustomApiModels() {
  customApiList.innerHTML = customApiModels.length
    ? customApiModels
        .map(
          (item) =>
            `<article class="custom-api-entry" data-custom-id="${item.id}"><b>${escapeHtml(item.name)}</b><small>${item.kind === "image" ? "图像" : "视频"} · ${escapeHtml(item.model)} · ${escapeHtml(item.baseUrl)}</small><button type="button">删除</button></article>`,
        )
        .join("")
    : '<article class="custom-api-entry"><b>还没有自定义模型</b><small>添加后会出现在对应节点的模型列表中</small></article>';
  customApiList
    .querySelectorAll<HTMLButtonElement>("[data-custom-id] button")
    .forEach((button) =>
      button.addEventListener("click", async () => {
        const id =
          button.closest<HTMLElement>("[data-custom-id]")!.dataset.customId!;
        if (
          (await apiFetch(`/api/user-api-models/${id}`, { method: "DELETE" })).ok
        ) {
          customApiModels = customApiModels.filter((item) => item.id !== id);
          renderCustomApiModels();
          refreshNodeModelMenus();
        }
      }),
    );
}
document
  .querySelector<HTMLButtonElement>("#open-custom-api")!
  .addEventListener("click", (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    if (button.disabled) return;
    workspaceUserMenu.classList.remove("open");
    customApiModal.classList.add("open");
    void loadCustomApiModels();
  });
customApiModal
  .querySelector("[data-custom-close]")!
  .addEventListener("click", () => customApiModal.classList.remove("open"));
customApiModal.addEventListener("pointerdown", (event) => {
  if (event.target === customApiModal) customApiModal.classList.remove("open");
});
document
  .querySelector("#custom-api-test")!
  .addEventListener("click", async () => {
    const data = new FormData(customApiForm),
      output = customApiForm.querySelector<HTMLOutputElement>("output")!;
    output.textContent = "正在测试连接…";
    const response = await apiFetch("/api/user-api-models/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseUrl: data.get("baseUrl"),
        apiKey: data.get("apiKey"),
      }),
    });
    const result = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    output.textContent = response.ok
      ? "连接成功"
      : `连接失败：${result.error || "未知错误"}`;
  });
customApiForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(customApiForm)),
    output = customApiForm.querySelector<HTMLOutputElement>("output")!;
  const response = await apiFetch("/api/user-api-models", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
  const result = (await response.json().catch(() => ({}))) as CustomApiModel & {
    error?: string;
  };
  if (!response.ok) {
    output.textContent = result.error || "添加失败";
    return;
  }
  customApiModels.push(result);
  customApiForm.reset();
  output.textContent = "已添加，可在模型列表中选择";
  renderCustomApiModels();
  refreshNodeModelMenus();
});
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
let paintNodeIndex = new Map<number, FlowNode>();
let paintTargetLinkIndex = new Map<number, FlowLink[]>();
const canvasSpatialIndex = new CanvasSpatialIndex();
const linkGeometryCache = new WeakMap<
  FlowLink,
  {
    key: string;
    a: Point;
    b: Point;
    ca: Point;
    cb: Point;
  }
>();
canvasStore.subscribe((change) => {
  if (change.type === "node-position")
    change.nodeIds.forEach((id) => {
      const node = nodes.find((candidate) => candidate.id === id);
      if (node) canvasSpatialIndex.update(node);
    });
  else if (change.type === "structure") canvasSpatialIndex.rebuild(nodes);
});
function rebuildPaintIndexes() {
  paintNodeIndex = new Map(nodes.map((node) => [node.id, node]));
  canvasSpatialIndex.rebuild(nodes);
  paintTargetLinkIndex = new Map();
  const grouped = new Map<number, FlowLink[]>(),
    linkOrder = new Map(links.map((link, index) => [link, index]));
  for (const link of links) {
    const targetLinks = grouped.get(link.to);
    if (targetLinks) targetLinks.push(link);
    else grouped.set(link.to, [link]);
  }
  for (const [targetId, targetLinks] of grouped) {
    targetLinks.sort((left, right) => {
      const leftOrder = left.inputOrder ?? Number.MAX_SAFE_INTEGER,
        rightOrder = right.inputOrder ?? Number.MAX_SAFE_INTEGER;
      const leftSource = paintNodeIndex.get(left.from),
        rightSource = paintNodeIndex.get(right.from);
      return (
        leftOrder - rightOrder ||
        (leftSource?.y ?? 0) - (rightSource?.y ?? 0) ||
        (leftSource?.x ?? 0) - (rightSource?.x ?? 0) ||
        (linkOrder.get(left) ?? 0) - (linkOrder.get(right) ?? 0)
      );
    });
    paintTargetLinkIndex.set(targetId, targetLinks);
  }
}
function linkPathGeometry(link: FlowLink) {
  const from =
      paintNodeIndex.get(link.from) ??
      nodes.find((node) => node.id === link.from),
    to =
      paintNodeIndex.get(link.to) ?? nodes.find((node) => node.id === link.to);
  if (!from || !to) return null;
  const siblings =
    paintTargetLinkIndex.get(link.to) ?? orderedTargetLinks(link.to);
  const rank = siblings.indexOf(link),
    cacheKey = [
      from.x,
      from.y,
      from.width,
      from.height,
      to.x,
      to.y,
      to.width,
      to.height,
      link.fromSide,
      link.toSide,
      rank,
      siblings.length,
      camera.zoom,
    ].join(":"),
    cached = linkGeometryCache.get(link);
  let relative: { a: Point; b: Point; ca: Point; cb: Point };
  if (cached?.key === cacheKey) relative = cached;
  else {
    const fromPort = portWorld(from, link.fromSide),
      toPort = portWorld(to, link.toSide),
      a = { x: fromPort.x * camera.zoom, y: fromPort.y * camera.zoom },
      b = { x: toPort.x * camera.zoom, y: toPort.y * camera.zoom },
      curve = Math.max(55, Math.hypot(b.x - a.x, b.y - a.y) * 0.35),
      ca = controlPoint(a, link.fromSide, curve),
      cb = controlPoint(b, link.toSide, curve);
    relative = { a, b, ca, cb };
    if (rank >= 0 && siblings.length > 1) {
    // Connections that share a target can otherwise overlap perfectly. Fan their
    // curves out while keeping the real port position unchanged.
      const spread =
        (rank - (siblings.length - 1) / 2) *
        Math.min(34, 18 + siblings.length * 4) *
        camera.zoom;
      relative.ca.y += spread * 0.72;
      relative.cb.y += spread;
    }
    linkGeometryCache.set(link, { key: cacheKey, ...relative });
  }
  const offsetX = innerWidth / 2 + camera.x,
    offsetY = innerHeight / 2 + camera.y,
    translate = (point: Point) => ({
      x: point.x + offsetX,
      y: point.y + offsetY,
    });
  return {
    a: translate(relative.a),
    b: translate(relative.b),
    ca: translate(relative.ca),
    cb: translate(relative.cb),
  };
}
function canvasInteractionActive() {
  return Boolean(pointer.down || domPointer.drag || interaction.marquee?.active || touchPinch.active);
}
function hitNode(sx: number, sy: number) {
  const p = world({ x: sx, y: sy }),
    candidates = new Set(
      canvasSpatialIndex.search({
        minX: p.x,
        minY: p.y,
        maxX: p.x,
        maxY: p.y,
      }),
    );
  for (let index = nodes.length - 1; index >= 0; index--) {
    const node = nodes[index];
    if (!candidates.has(node.id)) continue;
    if (
      p.x >= node.x &&
      p.x <= node.x + node.width &&
      p.y >= node.y &&
      p.y <= node.y + node.height
    )
      return node;
  }
  return undefined;
}
function hitPort(sx: number, sy: number, radius = 12, excludeNodeId?: number) {
  const sides: PortSide[] = ["top", "right", "bottom", "left"];
  const center = world({ x: sx, y: sy }),
    worldRadius = radius / camera.zoom,
    candidates = new Set(
      canvasSpatialIndex.search({
        minX: center.x - worldRadius,
        minY: center.y - worldRadius,
        maxX: center.x + worldRadius,
        maxY: center.y + worldRadius,
      }),
    );
  let closest: { node: FlowNode; side: PortSide; distance: number } | undefined;
  for (let index = nodes.length - 1; index >= 0; index--) {
    const node = nodes[index];
    if (
      !candidates.has(node.id) ||
      node.id === excludeNodeId ||
      (node.kind === "video" && node.role === "result")
    )
      continue;
    for (const side of sides) {
      const p = screen(portWorld(node, side)),
        distance = Math.hypot(sx - p.x, sy - p.y);
      if (distance <= radius && (!closest || distance < closest.distance))
        closest = { node, side, distance };
    }
  }
  return closest && { node: closest.node, side: closest.side };
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
  for (let index = links.length - 1; index >= 0; index--) {
    const geometry = linkPathGeometry(links[index]);
    if (!geometry) continue;
    const { a, b, ca, cb } = geometry;
    if (
      sx < Math.min(a.x, b.x, ca.x, cb.x) - tolerance ||
      sx > Math.max(a.x, b.x, ca.x, cb.x) + tolerance ||
      sy < Math.min(a.y, b.y, ca.y, cb.y) - tolerance ||
      sy > Math.max(a.y, b.y, ca.y, cb.y) + tolerance
    )
      continue;
    let previous = a;
    for (let step = 1; step <= 32; step++) {
      const t = step / 32,
        inverse = 1 - t,
        point = {
          x:
            inverse ** 3 * a.x +
            3 * inverse ** 2 * t * ca.x +
            3 * inverse * t ** 2 * cb.x +
            t ** 3 * b.x,
          y:
            inverse ** 3 * a.y +
            3 * inverse ** 2 * t * ca.y +
            3 * inverse * t ** 2 * cb.y +
            t ** 3 * b.y,
        };
      const length =
          Math.hypot(point.x - previous.x, point.y - previous.y) || 1,
        projection = Math.max(
          0,
          Math.min(
            1,
            ((sx - previous.x) * (point.x - previous.x) +
              (sy - previous.y) * (point.y - previous.y)) /
              (length * length),
          ),
        ),
        distance = Math.hypot(
          sx - (previous.x + projection * (point.x - previous.x)),
          sy - (previous.y + projection * (point.y - previous.y)),
        );
      if (distance <= tolerance) return index;
      previous = point;
    }
  }
  return -1;
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
  if (syncUi || paintNodeIndex.size !== nodes.length) rebuildPaintIndexes();
  positionCardLayerForFrame();
  if (syncUi) {
    syncDomNodes();
    schedulePixiEditorWarmup();
    updateTaskMonitor();
    updateCancelPendingButton();
    updateHistoryControls();
    zoomSlider.value = String(Math.round(camera.zoom * 100));
    zoomSlider.title = `${Math.round(camera.zoom * 100)}%`;
    zoomPercent.value = `${Math.round(camera.zoom * 100)}%`;
    nodeCount.textContent = String(nodes.length);
  }
  const pendingNode = connection.active
    ? paintNodeIndex.get(connection.active.nodeId) ??
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
function addNode(
  kind: NodeKind = "image",
  position?: Point,
  deferRender = false,
) {
  const id = allocateCanvasNodeId();
  if (id === null) return;
  const center = position ?? world({ x: innerWidth / 2, y: innerHeight / 2 });
  nodes.push(createNode(id, kind, center, generationCapabilities));
  selection.selectedId = id;
  if (!deferRender) {
    updateEditor();
    scheduleSave();
    draw();
  }
}
function addMediaNode(
  url: string,
  title: string,
  position = contextPosition,
  kind: "image" | "video" = "image",
) {
  const id = allocateCanvasNodeId();
  if (id === null) return;
  nodes.push({
    id,
    publicId: makeNodePublicId(kind),
    kind,
    role: kind === "video" ? "result" : undefined,
    x: position.x - 145,
    y: position.y - 120,
    width: 290,
    height: 240,
    title,
    body: "",
    accent: kind === "video" ? "#ffb774" : "#8ee7ff",
    mediaUrl: url,
    model:
      kind === "video"
        ? (generationCapabilities.video?.defaultModel ?? "agnes-video-v2.0")
        : (generationCapabilities.image?.defaultModel ?? "gpt-image-2"),
    videoSettings:
      kind === "video"
        ? { seconds: "5", resolution: "720p", aspectRatio: "16:9" }
        : undefined,
  });
  selection.selectedId = id;
  updateEditor();
  scheduleSave();
  draw();
}

function syncDomNodes() {
  synchronizeNodeDom({
    viewport: nodeViewport, layer: nodeLayer, nodes, links, camera,
    selectedId: selection.selectedId, batchIds: selection.batchIds,
    editingId: promptNodeEditor.editingId, draggingId: domPointer.drag?.id ?? 0,
    agentSelecting: promptAgentSelecting, agentIds: promptAgentContextSelection,
    colorTheme, swap: videoReferenceSwapSelection, mountedIds: mountedDomNodeIds,
    detached: pixiDetachedNodeCache, states: nodeDomStates, cacheDetached: cacheDetachedPixiNode,
    createElement: createDomNode, isGenerating: nodeIsActivelyGenerating,
    syncNode: (element, node, flags) => {
      const { locked, workflowWaiting, onscreen } = flags;
    syncBasicNodeContent(element, node, flags.editing, defaultNodeCopy);
    syncVoiceTtsAudioPanels({
      element,
      node,
      nodes,
      links,
      providers: ttsProviders,
      voicesByProvider: ttsVoicesByProvider,
      ensureProviders: loadTtsProviders,
      ensureVoices: loadTtsVoices,
      escapeHtml,
      renderSubmit: renderComposerSubmit,
      locked,
    });
    syncVideoReferenceView({
      element,
      node,
      nodes,
      links,
      onscreen,
      getSwap: () => videoReferenceSwapSelection,
      setSwap: (value) => {
        videoReferenceSwapSelection = value;
      },
      escapeHtml,
      notify: (message, type, detail) => showToast(message, type, detail),
      scheduleSave,
      commitHistory: queueCanvasHistory,
      draw,
      paintImage: paintNodeMedia,
    });
    renderNodeToolbar(element, node, locked);
    syncImageNodePanel({
      element,
      node,
      selected: node.id === selection.selectedId,
      locked,
      normalizePrompt: normalizePromptText,
      displayModelName: modelDisplayName,
      renderSubmit: renderComposerSubmit,
    });
    syncVideoNodePanel({
      element,
      node,
      nodes,
      links,
      scheduleSave,
      displayModelName: modelDisplayName,
      decodePrompt: decodePromptClipboardText,
      canGenerate: canGenerateNode,
      renderSubmit: renderComposerSubmit,
      locked,
    });
    syncNodeMediaView({
      element,
      node,
      onscreen,
      locked,
      workflowWaiting,
      paintImage: paintNodeMedia,
      paintVideo: paintNodeVideo,
    });
    },
  });
}
function createDomNode(node: FlowNode) {
  // Always resolve the live object because authoritative canvas sync may
  // replace node instances while retaining the DOM view.
  const liveNode = () => nodes.find((item) => item.id === node.id);
  const {
    element,
    resizeHandle,
    voicePanel,
    ttsPanel,
    audioPanel,
    videoPanel,
  } = createNodeView({
    node,
    getNode: liveNode,
    authUser,
    customApiModels,
    escapeHtml,
    copyPrompt: copyOriginalPrompt,
  });
  resizeHandle.addEventListener("pointerdown", (event) => {
    if (node.kind !== "prompt") return;
    event.preventDefault();
    event.stopPropagation();
    selection.selectedId = node.id;
    updateEditor();
    domPointer.beginResize({
      id: node.id,
      startX: event.clientX,
      startY: event.clientY,
      width: node.width,
      height: node.height,
    });
    resizeHandle.setPointerCapture(event.pointerId);
  });
  bindNodePointerInteraction({
    element,
    liveNode,
    allNodes: nodes,
    batchIds: selection.batchIds,
    isMultiSelectMode: () => selection.multiSelectMode,
    getDrag: () => domPointer.drag,
    setDrag: (drag) => {
      domPointer.drag = drag;
    },
    isAgentSelecting: () => promptAgentSelecting,
    isAgentCreateMode: () => promptAgentMode === "create",
    isReleaseSuppressed: domPointer.isReleaseSuppressed,
    selectNode: (id) => {
      selection.selectedId = id;
      updateEditor();
    },
    clearSelection: () => {
      selection.selectedId = 0;
      updateEditor();
    },
    draw,
    editPrompt: enterTextEdit,
    previewMedia: (current) =>
      openAssetPreview(current.mediaUrl!, current.title, current.kind as "image" | "video"),
  });
  bindNodeLabelHeading({
    element,
    liveNode,
    setEditingState: () => setSaveState("editing", "编辑中…"),
    scheduleSave,
    draw,
  });
  bindNodePorts(element, node.id, (nodeId, point) => {
    selection.selectedId = 0;
    updateEditor();
    connection.begin(nodeId, "right", point);
    draw();
  });
  bindNodeToolbarActions({
    element,
    liveNode,
    selectNode: (id) => {
      selection.selectedId = id;
      updateEditor();
    },
    showInfo: openNodeInfo,
    editPrompt: enterTextEdit,
    focusEditor: () => promptInput.focus(),
    scheduleSave,
    draw,
    generate,
    previewMedia: (current) =>
      openAssetPreview(current.mediaUrl!, current.title, current.kind as "image" | "video"),
    downloadMedia: (current) => {
      if (current.kind === "audio") {
        audioPanel
          .querySelector<HTMLButtonElement>("[data-audio-download]")!
          .click();
        return;
      }
      return downloadNodeImage(current);
    },
    deleteNode: (current) => {
      selection.selectedId = current.id;
      deleteSelectedNode();
    },
  });
  bindClearImageAction({
    element,
    allNodes: nodes,
    confirm: async () =>
      Boolean(await askProjectDialog({
        title: "清除当前卡片的图片？",
        description:
          "资产库中的原图不会删除。原提示词、当前描述、模型、图像设置和参考连线都会保留。",
        confirm: "清除图片",
      })),
    removeCachedImage: (url) => imageCache.delete(url),
    normalizePrompt: normalizePromptText,
    selectNode: (id) => {
      selection.selectedId = id;
      updateEditor();
    },
    scheduleSave,
    draw,
    notify: (message) => showToast(message, "success"),
  });
  bindImageNodePanel({
    element,
    nodeId: node.id,
    liveNode,
    scheduleSave,
    setEditingState: () => setSaveState("editing", "编辑中…"),
    draw,
    generate,
    selectNode: (id) => {
      selection.selectedId = id;
      updateEditor();
    },
    beginImageUpload: beginImageNodeUpload,
    beginImageLibrary: beginImageNodeLibrary,
  });
  bindVideoNodePanel({
    videoPanel,
    liveNode,
    generationCapabilities,
    decodePromptClipboardText,
    scheduleSave,
    draw,
    generate,
    selectNode: (id) => {
      selection.selectedId = id;
      updateEditor();
    },
  });
  bindVoiceNodePanels({
    element,
    voicePanel,
    ttsPanel,
    audioPanel,
    liveNode,
    scheduleSave,
    draw,
    previewVoice,
    generateTts,
    selectNode: (id) => {
      selection.selectedId = id;
      updateEditor();
    },
  });
  return element;
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
  const displayUrl = mediaThumbnailUrl(url);
  let image = imageCache.get(displayUrl);
  if (!image) {
    image = new Image();
    pendingMediaLoads.add(displayUrl);
    rememberCachedImage(displayUrl, image);
    refreshAppearanceButton();
    image.onload = () => {
      pendingMediaLoads.delete(displayUrl);
      thumbnailLoadRetries.delete(displayUrl);
      repaintMediaUrl(url);
      trimThumbnailCache();
      refreshAppearanceButton();
    };
    image.onerror = () => {
      pendingMediaLoads.delete(displayUrl);
      imageCache.delete(displayUrl);
      refreshAppearanceButton();
      const retries = thumbnailLoadRetries.get(displayUrl) ?? 0;
      if (retries >= 2) {
        thumbnailLoadRetries.delete(displayUrl);
        drawMediaImage(target, image!);
        return;
      }
      thumbnailLoadRetries.set(displayUrl, retries + 1);
      window.setTimeout(
        () => {
          if (document.hidden) return;
          nodes
            .filter((node) => node.mediaUrl === url)
            .forEach((node) => nodeDomStates.delete(node.id));
          nodeLayer
            .querySelectorAll<HTMLElement>(
              `.flow-node .node-media[data-source-key="${CSS.escape(url)}"]`,
            )
            .forEach((media) => delete media.dataset.sourceKey);
          nodeLayer
            .querySelectorAll<HTMLCanvasElement>(
              `[data-reference-url="${CSS.escape(url)}"]`,
            )
            .forEach((canvas) => delete canvas.dataset.paintedUrl);
          draw(true);
        },
        700 * (retries + 1),
      );
    };
    image.src = displayUrl;
  } else rememberCachedImage(displayUrl, image);
  drawMediaImage(target, image);
}
function mediaThumbnailUrl(url: string) {
  return url.replace(
    /^(\/api\/(?:public\/)?assets\/[^/]+)\/content(?:\/.*)?$/,
    "$1/thumbnail",
  );
}
function drawMediaImage(target: HTMLCanvasElement, image: HTMLImageElement) {
  const context = target.getContext("2d")!;
  const dark = colorTheme === "dark",
    fill = dark ? "#111a1c" : "#e7efeb";
  context.fillStyle = fill;
  context.fillRect(0, 0, target.width, target.height);
  if (image.complete && image.naturalWidth) {
    const scale = Math.min(
        target.width / image.naturalWidth,
        target.height / image.naturalHeight,
      ),
      width = image.naturalWidth * scale,
      height = image.naturalHeight * scale;
    context.drawImage(
      image,
      (target.width - width) / 2,
      (target.height - height) / 2,
      width,
      height,
    );
  } else {
    // Resizing a canvas clears its pixels. Always paint a visible fallback
    // while the thumbnail decodes (or fails), otherwise light mode flashes a
    // featureless white card whenever DOM cards are remounted.
    const centerX = target.width / 2,
      centerY = target.height / 2,
      size = Math.max(24, Math.min(42, target.width * 0.11));
    context.strokeStyle = dark ? "#607579" : "#8ba19a";
    context.lineWidth = Math.max(2, target.width / 180);
    context.strokeRect(centerX - size / 2, centerY - size, size, size);
    context.beginPath();
    context.moveTo(centerX - size * 0.34, centerY - size * 0.18);
    context.lineTo(centerX - size * 0.08, centerY - size * 0.48);
    context.lineTo(centerX + size * 0.34, centerY - size * 0.08);
    context.stroke();
    context.fillStyle = dark ? "#8fa4a7" : "#60736d";
    context.font = `${Math.max(12, Math.min(18, target.width / 22))}px system-ui`;
    context.textAlign = "center";
    context.fillText(
      image.complete ? "缩略图加载失败" : "缩略图加载中",
      centerX,
      centerY + Math.max(18, size * 0.45),
    );
  }
}
function paintNodeVideo(target: HTMLCanvasElement, url: string) {
  paintNodeMedia(target, url);
}
function repaintMediaUrl(url: string) {
  const image = imageCache.get(mediaThumbnailUrl(url));
  if (!image) return;
  nodes
    .filter((node) => node.mediaUrl === url)
    .forEach((node) => {
      const target = nodeLayer.querySelector<HTMLCanvasElement>(
        `.flow-node[data-id="${node.id}"] .node-media-canvas`,
      );
      if (target) drawMediaImage(target, image!);
    });
}
function repaintAllMedia() {
  nodes
    .filter((node) => node.mediaUrl)
    .forEach((node) => repaintMediaUrl(node.mediaUrl!));
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
  const index = nodes.findIndex((node) => node.id === selection.selectedId);
  if (index < 0) return;
  if (canvasHasActiveGeneration()) {
    showToast("画布正在生成，任务完成后即可删除节点", "warning");
    return;
  }
  const targets = cascadeSelectionIds(new Set([nodes[index].id]));
  const cascadeCount = targets.size - 1;
  const targetTitle = nodes[index].title || "未命名卡片",
    confirmed = await askProjectDialog({
      title: "删除这张卡片？",
      description: cascadeCount
        ? `将删除“${targetTitle}”，并连带清理 ${cascadeCount} 张只依赖它的下游卡片。此操作无法撤销。`
        : `将删除“${targetTitle}”。此操作无法撤销。`,
      confirm: cascadeCount ? `删除 ${targets.size} 张卡片` : "确认删除",
      danger: true,
    });
  if (!confirmed || nodes.findIndex((node) => node.id === selection.selectedId) < 0)
    return;
  for (let nodeIndex = nodes.length - 1; nodeIndex >= 0; nodeIndex--)
    if (targets.has(nodes[nodeIndex].id)) nodes.splice(nodeIndex, 1);
  for (let linkIndex = links.length - 1; linkIndex >= 0; linkIndex--) {
    if (targets.has(links[linkIndex].from) || targets.has(links[linkIndex].to))
      links.splice(linkIndex, 1);
  }
  selection.selectedId = 0;
  for (const id of targets) selection.batchIds.delete(id);
  updateEditor();
  scheduleSave();
  draw();
  showCanvasGuide({
    key: "delete-cascade",
    title: `已删除 ${targets.size} 张卡片`,
    detail: cascadeCount
      ? `同时清理了 ${cascadeCount} 张只依赖该上游的下游卡片。`
      : "需要恢复时可立即撤销。",
    tone: "online",
    duration: 5200,
    actions: [
      {
        label: "撤销",
        primary: true,
        run: () => {
          hideCanvasGuide("delete-cascade");
          void undoCanvas();
        },
      },
    ],
  });
}

function selectedNode() {
  return nodes.find((node) => node.id === selection.selectedId);
}
function canGenerateNode(node: FlowNode) {
  const credits =
      Number(authUser?.credits ?? 0) - Number(authUser?.reservedCredits ?? 0),
    modelCost =
      node.model === "grok-imagine-video-1.5-preview"
        ? 2
        : node.model === "grok-imagine-image"
          ? 1
          : 0;
  if (node.kind === "tts")
    return Boolean(node.body.trim() && connectedVoiceNode(node));
  return (
    node.model !== "gemini-3.1-flash-image" &&
    (node.kind === "image" || node.kind === "video") &&
    node.role !== "result" &&
    credits >= modelCost &&
    Boolean(node.body.trim())
  );
}
function generationBlockedReason(node: FlowNode) {
  if (node.kind === "tts")
    return !connectedVoiceNode(node)
      ? "请先连接一张语音配置卡片"
      : !node.body.trim()
        ? "请先填写需要生成的文本"
        : "";
  if (node.kind !== "image" && node.kind !== "video")
    return "当前卡片不支持生成";
  if (node.role === "result")
    return node.kind === "video"
      ? "已生成的视频节点仅用于播放"
      : "生成结果节点不能再次生成";
  if ((node.status === "queued" || node.status === "running") && node.jobId)
    return "当前任务正在生成，请稍候";
  if (node.model === "gemini-3.1-flash-image")
    return "Gemini 图片模型仍在适配中，请选择其他模型";
  const credits =
      Number(authUser?.credits ?? 0) - Number(authUser?.reservedCredits ?? 0),
    cost =
      node.model === "grok-imagine-video-1.5-preview"
        ? 2
        : node.model === "grok-imagine-image"
          ? 1
          : 0;
  if (credits < cost) return `创作点数不足，当前模型需要 ${cost} 点`;
  if (!node.body.trim()) return "请先填写图片描述，再开始生成";
  return "";
}
function updateEditor() {
  const node = selectedNode();
  if (!node) {
    titleInput.value = "";
    promptInput.value = "";
    jobLabel.textContent = "画布中没有节点";
    jobProgress.style.width = "0%";
    titleInput.disabled = true;
    promptInput.disabled = true;
    modelInput.disabled = true;
    return;
  }
  const locked =
    nodeIsActivelyGenerating(node) &&
    !(node.kind === "video" && node.role !== "result");
  titleInput.disabled = locked;
  promptInput.disabled = locked;
  modelInput.disabled = locked;
  generateButton.disabled = locked || !canGenerateNode(node);
  if (document.activeElement !== titleInput) titleInput.value = node.title;
  if (document.activeElement !== promptInput) promptInput.value = node.body;
  if (document.activeElement !== modelInput)
    modelInput.value =
      node.model ??
      (node.kind === "video" ? "agnes-video-v2.0" : "gpt-image-2");
  jobLabel.textContent =
    node.status === "succeeded"
      ? "生成完成（模拟结果）"
      : node.status === "running"
        ? `生成中 ${node.progress ?? 0}%`
        : node.status === "queued"
          ? "任务排队中"
          : "准备生成";
  jobProgress.style.width = `${node.progress ?? 0}%`;
}

function updateNodeJobProgressUi(node: FlowNode) {
  if (pixiRenderer) draw(false);
  const element = nodeLayer.querySelector<HTMLElement>(
      `.flow-node[data-id="${node.id}"]`,
    ),
    workflowWaiting = Boolean(node.agentAuto && node.status === "waiting"),
    locked =
      (nodeIsActivelyGenerating(node) || workflowWaiting) &&
      !(node.kind === "video" && node.role !== "result");
  if (element) {
    element.classList.toggle("generating", locked);
    element.classList.toggle("workflow-waiting", workflowWaiting);
    const progress = element.querySelector<HTMLElement>(".node-progress i"),
      progressTrack =
        element.querySelector<HTMLElement>(".node-progress"),
      waitingWithoutProgress =
        locked &&
        (workflowWaiting ||
          node.status === "queued" ||
          Number(node.progress ?? 0) <= 0);
    if (progress)
      progress.style.width = waitingWithoutProgress
        ? "100%"
        : `${node.progress ?? 0}%`;
    if (progressTrack) {
      progressTrack.classList.toggle("visible", locked);
      progressTrack.classList.toggle("indeterminate", waitingWithoutProgress);
    }
    if (node.kind === "video" && node.role === "result") {
      const label = element.querySelector<HTMLElement>(
        ".video-generation-count",
      );
      if (label)
        label.textContent =
          node.status === "queued"
            ? "任务排队中"
            : node.status === "running"
              ? Number(node.progress ?? 0) > 0
                ? `生成中 ${Math.round(node.progress ?? 0)}%`
                : node.model?.startsWith("agnes-")
                  ? "云端处理中"
                  : "生成中 · 等待进度"
              : label.textContent;
    }
  }
  if (selection.selectedId === node.id) updateEditor();
  updateTaskMonitor();
}

function scheduleSave(recordHistory = true) {
  setSaveState("editing", "编辑中…");
  if (recordHistory) queueCanvasHistory();
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveCanvas, 500);
}

async function saveCanvas() {
  if (!authUser || canvasSaveBlocked || canvasLoadedProjectId !== currentProjectId || !canvasBaseline || canvasBaseline.version !== canvasServerVersion) return;
  if (canvasSavePromise) { canvasSaveQueued = true; return canvasSavePromise; }
  const savingProjectId = currentProjectId, controller = new AbortController();
  const sentSnapshot = captureCanvasSnapshot();
  canvasSaveAbort = controller;
  canvasSavePromise = (async () => {
    try {
      setSaveState("saving", "正在自动保存…");
      const result = await submitCanvasChanges({
        projectId: savingProjectId,
        clientId: canvasSyncClientId,
        baseline: canvasBaseline!,
        sentSnapshot,
        captureLive: captureCanvasSnapshot,
        signal: controller.signal,
      });
      if (result.kind === "unchanged") { setSaveState("saved", "已自动保存"); return; }
      if (result.kind === "conflict") {
        canvasSaveQueued = false; canvasSaveBlocked = true;
        const emptyGuard = result.error === "canvas_empty_guard";
        setSaveState("error", emptyGuard ? "已阻止空画布覆盖" : "版本需要同步");
        showCanvasGuide({
          key: "canvas-save-conflict",
          title: emptyGuard ? "已保护服务器画布" : "服务器画布已有新版本",
          detail: "正在停止本地保存并强制载入服务器上的完整版本。",
          tone: "offline", priority: 110,
        });
        await loadCanvas();
        return;
      }
      if (savingProjectId === currentProjectId) {
        canvasBaseline = structuredClone(result.serverSnapshot);
        canvasServerUpdatedAt = result.serverSnapshot.updatedAt;
        canvasServerVersion = result.serverSnapshot.version;
        applySynchronizedCanvas(result.mergedSnapshot);
        if (result.hasPostSubmitOperations) canvasSaveQueued = true;
      }
      setSaveState("saved", "已自动保存");
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setSaveState("error", "自动保存失败");
    } finally {
      if (canvasSaveAbort === controller) canvasSaveAbort = null;
      canvasSavePromise = null;
      if (canvasSaveQueued && !canvasSaveBlocked && canvasLoadedProjectId === currentProjectId) {
        canvasSaveQueued = false; void saveCanvas();
      }
    }
  })();
  return canvasSavePromise;
}
function setSaveState(
  state: "editing" | "saving" | "saved" | "error",
  label: string,
) {
  saveState.dataset.state = state;
  saveState.textContent = label;
}

async function loadCanvas(keepLoadingStatus = false) {
  const loadSequence = ++canvasLoadSequence;
  canvasSaveBlocked = true;
  window.clearTimeout(saveTimer);
  canvasSaveQueued = false;
  try {
    const loadingProjectId = currentProjectId,
      leasedNextId = nextId,
      leasedEnd = canvasNodeIdBlockEnd;
    setWorkspaceBootStatus("正在读取画布与生成任务");
    generationPoller.cancelAll();
    const canvasResult = await fetchCanvasDocument(loadingProjectId);
    if (
      loadingProjectId !== currentProjectId ||
      loadSequence !== canvasLoadSequence
    )
      return;
    if (canvasResult.kind === "missing") {
      canvasLoadedProjectId = loadingProjectId;
      await saveCanvas();
      resetCanvasHistory(false);
      return;
    }
    const document = canvasResult.document;
    const normalizedDocument = normalizeCanvasDocument(document, camera, normalizePromptText),
      receivedBaseline = normalizedDocument.baseline;
    document.nodes = normalizedDocument.nodes;
    document.links = normalizedDocument.links;
    nodeLayer.replaceChildren();
    pixiDetachedNodeCache.clear();
    pixiEditorWarmScheduled = false;
    nodes.splice(0, nodes.length, ...normalizedDocument.nodes);
    await hydrateGenerationPrompts(nodes);
    const migrated = normalizeCanvasLinks(document.links ?? []);
    links.splice(0, links.length, ...migrated);
    if (leasedNextId <= leasedEnd) {
      nextId = leasedNextId;
      canvasNodeIdBlockEnd = leasedEnd;
    } else {
      nextId = nodes.length ? Math.max(...nodes.map((node) => node.id)) + 1 : 1;
      canvasNodeIdBlockEnd = 0;
    }
    const { repositionedResult } = repairRestoredCanvas(nodes, links);
    if (document.camera) {
      Object.assign(camera, document.camera);
      cameraViewport.syncTarget();
    }
    if (
      loadSequence !== canvasLoadSequence ||
      loadingProjectId !== currentProjectId
    )
      return;
    if (nextId > canvasNodeIdBlockEnd) {
      setWorkspaceBootStatus("正在申请安全节点空间");
      if (!(await reserveCanvasNodeIds(loadingProjectId)))
        throw new Error("canvas id lease failed");
    } else setWorkspaceBootStatus("正在校验节点编号空间");
    if (
      loadSequence !== canvasLoadSequence ||
      loadingProjectId !== currentProjectId
    )
      return;
    canvasLoadedProjectId = loadingProjectId;
    canvasBaseline = receivedBaseline;
    canvasServerVersion = Number(document.version);
    canvasServerUpdatedAt = document.updatedAt || "";
    canvasSaveBlocked = false;
    hideCanvasGuide("canvas-save-conflict");
    selection.selectedId = 0;
    setSaveState("saved", "已自动保存");
    updateEditor();
    draw();
    resetCanvasHistory(true);
    if (
      repositionedResult ||
      diffCanvasSnapshots(receivedBaseline, captureCanvasSnapshot()).length
    )
      scheduleSave();
    nodes
      .filter(
        (node) =>
          node.jobId && (node.status === "queued" || node.status === "running"),
      )
      .forEach(pollJob);
    queueMicrotask(runAgentWorkflow);
    if (!keepLoadingStatus) {
      const status = setWorkspaceBootStatus("已同步服务器最新版本");
      hideWorkspaceBootStatusAfter(status, 650);
    }
  } catch {
    setSaveState("error", "离线模式");
    if (!keepLoadingStatus) {
      const status = setWorkspaceBootStatus("同步失败，请检查连接");
      hideWorkspaceBootStatusAfter(status, 1800);
    }
  }
}

async function generate(sourceOverride?: FlowNode) {
  const source = sourceOverride ?? selectedNode();
  if (!source) {
    showToast("请先选择需要生成的卡片", "warning");
    return;
  }
  const blockedReason = generationBlockedReason(source);
  if (blockedReason) {
    showToast(blockedReason, "warning");
    if (
      (source.kind === "image" || source.kind === "video") &&
      !source.body.trim()
    )
      promptInput.focus();
    return;
  }
  if (source.kind === "tts") {
    selection.selectedId = 0;
    updateEditor();
    draw();
    await generateTts(source);
    return;
  }
  const wasAgentAuto = Boolean(source.agentAuto),
    missingImageUpstreams = missingGenerationInputs(source, nodes, links);
  if (missingImageUpstreams.length) {
    if (wasAgentAuto) {
      source.status = "waiting";
      source.progress = 0;
    } else
      showToast(
        `仍有 ${missingImageUpstreams.length} 张上游参考图未生成`,
        "warning",
        "请等待所有已连接的参考图生成完成后再启动此任务。",
      );
    updateEditor();
    scheduleSave();
    draw();
    return;
  }
  selection.selectedId = 0;
  updateEditor();
  draw();
  jobLabel.textContent = "正在提交…";
  source.agentAuto = false;
  if (source.kind === "video" && source.role !== "result") {
    source.status = "idle";
    source.progress = 0;
    delete source.jobId;
  }
  const createsOutput =
    source.kind === "video" ||
    (source.kind === "image" && Boolean(source.mediaUrl));
  const node = createsOutput ? createRevisionNode(source) : source;
  if (!node) return;
  node.status = "queued";
  node.progress = 0;
  updateEditor();
  draw();
  const result = await runGenerationJob({
    projectId: currentProjectId,
    source,
    output: node,
    nodes,
    links,
    normalizePrompt: normalizePromptText,
  });
  if (result.ok) {
    const { job, node: liveNode } = result;
    if (authUser && typeof job.creditsAvailable === "number") {
      authUser = {
        ...authUser,
        reservedCredits: Math.max(
          0,
          Number(authUser.credits ?? 0) - job.creditsAvailable,
        ),
      };
      renderAuthenticatedUser();
      refreshNodeModelMenus();
    }
    updateEditor();
    scheduleSave();
    draw();
    pollJob(liveNode);
  } else {
    const { error, node: liveNode } = result;
    jobLabel.textContent = "提交失败，请检查 API";
    showToast(
      "任务提交失败，请检查接口配置",
      "error",
      error instanceof Error ? error.message : "未知错误",
    );
    if (liveNode?.role === "result") removeFailedResult(liveNode, source.id);
    updateEditor();
    scheduleSave();
    draw();
  }
}

function connectedVoiceNode(ttsNode: FlowNode) {
  return links
    .filter((link) => link.to === ttsNode.id)
    .map((link) => nodes.find((node) => node.id === link.from))
    .find((node): node is FlowNode => node?.kind === "voice");
}
async function previewVoice(voice: FlowNode) {
  const existing = activeVoicePreviews.get(voice.id);
  if (existing) {
    existing.pause();
    existing.removeAttribute("src");
    existing.load();
    activeVoicePreviews.delete(voice.id);
    showToast("已停止试听", "info");
    return;
  }
  const params = new URLSearchParams({
      projectId: currentProjectId,
      providerId: voice.voiceSettings?.providerId || "easyvoice-local",
      text: `${voice.voiceSettings?.roleName || "角色"}的声音已经准备好了。`,
      voiceId: voice.voiceSettings?.voiceId || "zh-CN-XiaoxiaoNeural",
      speed: String(voice.voiceSettings?.defaultSpeed ?? 1),
      pitch: String(voice.voiceSettings?.pitch ?? 0),
      volume: String(voice.voiceSettings?.volume ?? 1),
      t: String(Date.now()),
    }),
    audio = new Audio(`/api/tts/preview?${params}`);
  audio.preload = "none";
  activeVoicePreviews.set(voice.id, audio);
  showToast("正在连接流式试听", "info");
  try {
    await new Promise<void>((resolve, reject) => {
      audio.onplaying = () => showToast("正在流式试听", "success");
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error("流式试听加载失败"));
      void audio.play().catch(reject);
    });
  } catch (error) {
    showToast(error instanceof Error ? error.message : "试听失败", "error");
  } finally {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    if (activeVoicePreviews.get(voice.id) === audio)
      activeVoicePreviews.delete(voice.id);
  }
}
async function generateTts(source: FlowNode) {
  const voice = connectedVoiceNode(source);
  if (!voice) {
    showToast("请先连接一张语音配置卡片", "warning");
    return;
  }
  if (!source.body.trim()) {
    showToast("请先填写需要生成的文本", "warning");
    return;
  }
  if (source.status === "running" || source.status === "queued") return;
  source.status = "running";
  source.progress = 15;
  updateEditor();
  draw();
  try {
    const response = await synthesizeTts(currentProjectId, source, voice, source.body.trim()),
      result = (await response.json()) as {
        assetUrl: string;
        duration?: number;
        provider?: string;
        voiceId?: string;
      };
    let audioNode = links
      .filter((link) => link.from === source.id)
      .map((link) => nodes.find((node) => node.id === link.to))
      .find((node): node is FlowNode => node?.kind === "audio");
    if (audioNode) {
      audioNode.title = `音频 · ${voice.voiceSettings?.roleName || "语音"}`;
      audioNode.body = source.body;
      audioNode.model =
        result.provider || voice.voiceSettings?.providerId || "easyvoice-local";
      audioNode.mediaUrl = result.assetUrl;
      audioNode.status = "succeeded";
      audioNode.progress = 100;
      audioNode.ttsSettings = {
        ...(source.ttsSettings || {}),
        duration: Number(result.duration) || undefined,
      };
    } else {
      const id = allocateCanvasNodeId();
      if (id === null) throw new Error("无法创建音频结果卡片");
      const position = findOutputPosition(source, nodes);
      audioNode = {
        id,
        publicId: makeNodePublicId("audio"),
        kind: "audio",
        role: "result",
        sourceNodeId: source.id,
        x: position.x,
        y: position.y,
        width: 300,
        height: 180,
        title: `音频 · ${voice.voiceSettings?.roleName || "语音"}`,
        body: source.body,
        accent: "#8b9fe8",
        model:
          result.provider ||
          voice.voiceSettings?.providerId ||
          "easyvoice-local",
        mediaUrl: result.assetUrl,
        status: "succeeded",
        progress: 100,
        ttsSettings: {
          ...(source.ttsSettings || {}),
          duration: Number(result.duration) || undefined,
        },
      };
      nodes.push(audioNode);
      links.push({
        from: source.id,
        to: audioNode.id,
        fromSide: "right",
        toSide: "left",
      });
    }
    source.status = "succeeded";
    source.progress = 100;
    scheduleSave();
    draw();
    void loadAssets(false);
    showToast("语音已生成并加入资产库", "success");
  } catch (error) {
    source.status = "failed";
    source.progress = 0;
    showToast(error instanceof Error ? error.message : "语音生成失败", "error");
  } finally {
    if (source.status === "running") {
      source.status = "idle";
      source.progress = 0;
    }
    updateEditor();
    scheduleSave();
    draw();
  }
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
function cascadeSelectionIds(seed: Set<number>) {
  const result = new Set(seed);
  let changed = true;
  while (changed) {
    changed = false;
    for (const link of links) {
      if (!result.has(link.from) || result.has(link.to)) continue;
      const incoming = links.filter((item) => item.to === link.to);
      if (!incoming.length || incoming.some((item) => !result.has(item.from)))
        continue;
      result.add(link.to);
      changed = true;
    }
  }
  return result;
}
function deleteBatchSelection() {
  if (!selection.batchIds.size) return;
  if (canvasHasActiveGeneration()) {
    showToast("画布正在生成，任务完成后即可批量删除", "warning");
    return;
  }
  const targets = cascadeSelectionIds(selection.batchIds),
    cascadeCount = targets.size - selection.batchIds.size;
  if (
    !window.confirm(
      `删除 ${selection.batchIds.size} 个选中节点${cascadeCount ? `，并清理 ${cascadeCount} 个仅依赖它们的下游节点` : ""}？`,
    )
  )
    return;
  for (let index = nodes.length - 1; index >= 0; index--)
    if (targets.has(nodes[index].id)) nodes.splice(index, 1);
  for (let index = links.length - 1; index >= 0; index--)
    if (targets.has(links[index].from) || targets.has(links[index].to))
      links.splice(index, 1);
  if (targets.has(selection.selectedId)) selection.selectedId = 0;
  clearBatchSelection();
  updateEditor();
  scheduleSave();
  showToast(`已删除 ${targets.size} 个节点`, "success");
}
function generateBatchSelection() {
  const result = generationWorkflow.enqueue(selection.batchIds);
  if (!result.candidates) {
    showToast("选中区域没有可生成的任务节点", "warning");
    return;
  }
  showToast(
    `${result.candidates} 个任务已进入依赖队列`,
    "success",
    `${result.ready} 个可立即排队${result.waiting ? ` · ${result.waiting} 个等待上游` : ""}${result.skipped ? ` · ${result.skipped} 个不可生成` : ""}`,
  );
}
batchToolbar
  .querySelector("[data-batch-generate]")!
  .addEventListener("click", () => {
    generateBatchSelection();
    exitMultiSelectMode();
  });
batchToolbar
  .querySelector("[data-batch-delete]")!
  .addEventListener("click", () => {
    deleteBatchSelection();
    exitMultiSelectMode();
  });
batchToolbar
  .querySelector("[data-batch-clear]")!
  .addEventListener("click", exitMultiSelectMode);

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
titleInput.addEventListener("input", () => {
  const node = selectedNode();
  if (!node) return;
  node.title = titleInput.value;
  scheduleSave();
  draw();
});
promptInput.addEventListener("input", () => {
  const node = selectedNode();
  if (!node) return;
  node.body = promptInput.value;
  scheduleSave();
  draw();
});
modelInput.addEventListener("change", () => {
  const node = selectedNode();
  if (!node) return;
  node.model = modelInput.value;
  scheduleSave();
  draw();
});
document
  .querySelectorAll<HTMLElement>("[data-add]")
  .forEach((button) =>
    button.addEventListener("click", () =>
      addNode(button.dataset.add as NodeKind),
    ),
  );
const quickNodeMenu = document.querySelector<HTMLElement>("#quick-node-menu")!;
let quickNodePosition: Point | null = null;
function closeQuickNodeMenu() {
  quickNodeMenu.classList.remove("open");
  quickNodePosition = null;
}
function positionQuickNodeMenu(clientX: number, clientY: number) {
  const margin = 12,
    gap = 12,
    width = quickNodeMenu.offsetWidth || 304,
    height = quickNodeMenu.offsetHeight;
  const left = Math.max(
      margin,
      Math.min(clientX + gap, innerWidth - width - margin),
    ),
    spaceBelow = innerHeight - clientY - gap - margin,
    spaceAbove = clientY - gap - margin,
    openUp = height > spaceBelow && spaceAbove > spaceBelow;
  const top = openUp
    ? Math.max(margin, clientY - gap - height)
    : Math.min(clientY + gap, innerHeight - height - margin);
  quickNodeMenu.style.left = `${left}px`;
  quickNodeMenu.style.top = `${Math.max(margin, top)}px`;
  quickNodeMenu.classList.toggle("opens-up", openUp);
}
canvas.addEventListener("dblclick", (event) => {
  if (event.button !== 0 || connection.active) return;
  const hit = hitNode(event.clientX, event.clientY);
  if (hit) {
    event.preventDefault();
    selection.selectedId = hit.id;
    updateEditor();
    draw();
    if (
      hit.mediaUrl &&
      (hit.kind === "image" || hit.kind === "video")
    )
      openAssetPreview(hit.mediaUrl, hit.title, hit.kind);
    else if (hit.kind === "prompt")
      requestAnimationFrame(() => {
        const element = nodeLayer.querySelector<HTMLElement>(
          `.flow-node[data-id="${hit.id}"]`,
        );
        if (element) enterTextEdit(hit, element);
      });
    return;
  }
  event.preventDefault();
  if (selection.multiSelectMode) {
    exitMultiSelectMode();
    return;
  }
  quickNodePosition = world({ x: event.clientX, y: event.clientY });
  quickNodeMenu.classList.remove("open");
  requestAnimationFrame(() => {
    quickNodeMenu.classList.add("open");
    positionQuickNodeMenu(event.clientX, event.clientY);
  });
});
quickNodeMenu
  .querySelectorAll<HTMLButtonElement>("[data-quick-add]")
  .forEach((button) =>
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (quickNodePosition)
        addNode(button.dataset.quickAdd as NodeKind, quickNodePosition);
      closeQuickNodeMenu();
    }),
  );
quickNodeMenu
  .querySelector<HTMLButtonElement>("[data-quick-upload]")!
  .addEventListener("click", (event) => {
    event.stopPropagation();
    closeQuickNodeMenu();
    openAssetUploadAt(quickNodePosition);
  });
quickNodeMenu
  .querySelector<HTMLButtonElement>("[data-quick-multi]")!
  .addEventListener("click", (event) => {
    event.stopPropagation();
    closeQuickNodeMenu();
    enterMultiSelectMode();
  });
const appearanceButton =
  document.querySelector<HTMLButtonElement>("#dock-appearance")!;
let themeTransitioning = false;
function refreshAppearanceButton() {
  appearanceButton.disabled = themeTransitioning || pendingMediaLoads.size > 0;
  appearanceButton.title = pendingMediaLoads.size
    ? `等待 ${pendingMediaLoads.size} 个图片资源加载完成`
    : "切换画布外观";
}
appearanceButton.addEventListener("click", () => {
  if (themeTransitioning || appearanceButton.disabled) return;
  themeTransitioning = true;
  refreshAppearanceButton();
  document.body.classList.add("theme-click-fade");
  window.setTimeout(() => {
    colorTheme = colorTheme === "dark" ? "light" : "dark";
    document.body.dataset.theme = colorTheme;
    localStorage.setItem("flow-theme", colorTheme);
    repaintAllMedia();
    paint();
    document.body.classList.add("theme-click-return");
    document.body.classList.remove("theme-click-fade");
  }, 90);
  window.setTimeout(() => {
    document.body.classList.remove("theme-click-return");
    themeTransitioning = false;
    refreshAppearanceButton();
  }, 260);
});
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
let promptAgentMode =
  (localStorage.getItem("flow-prompt-agent-mode") as PromptAgentMode) ||
  "create";
if (!["create", "general", "agnes", "voice"].includes(promptAgentMode))
  promptAgentMode = "create";
function setPromptAgentMode(mode: PromptAgentMode) {
  promptAgentMode = mode;
  localStorage.setItem("flow-prompt-agent-mode", mode);
  promptAgentPanel.querySelector<HTMLElement>(
    "[data-agent-mode-trigger] b",
  )!.textContent = "模式";
  promptAgentPanel
    .querySelectorAll<HTMLButtonElement>("[data-agent-mode]")
    .forEach((button) =>
      button.classList.toggle("active", button.dataset.agentMode === mode),
    );
  promptAgentPanel
    .querySelector<HTMLElement>(".agent-mode")!
    .classList.remove("open");
  promptAgentPanel
    .querySelector<HTMLElement>(".agent-prompt-submenu")!
    .classList.remove("open");
  promptAgentPanel
    .querySelector<HTMLButtonElement>("[data-agent-mode-trigger]")!
    .setAttribute("aria-expanded", "false");
  promptAgentPanel.classList.remove("prompt-result-open");
  promptAgentPanel.querySelector<HTMLElement>("article")!.hidden = true;
  const promptOnly = mode === "general" || mode === "agnes",
    field = promptAgentPanel.querySelector<HTMLTextAreaElement>("textarea")!,
    submit =
      promptAgentPanel.querySelector<HTMLButtonElement>(".agent-submit")!;
  field.placeholder =
    mode === "create"
      ? "告诉我你想创造什么…"
      : mode === "voice"
        ? "输入想要音色的描述"
        : mode === "agnes"
          ? "描述需要转换为 Agnes 视频提示词的镜头…"
          : "描述需要生成提示词的画面或需求…";
  submit.setAttribute(
    "aria-label",
    mode === "voice" ? "生成音色配置" : promptOnly ? "生成提示词" : "开始创作",
  );
  promptAgentSelecting =
    mode === "create" && promptAgentPanel.classList.contains("open");
  promptAgentPanel.classList.toggle("prompt-only", mode !== "create");
  if (mode !== "create") {
    promptAgentContextSelection.clear();
    promptAgentContextNodes = [];
    renderPromptAgentContext(false);
  }
  draw();
}
promptAgentPanel
  .querySelector("[data-agent-mode-trigger]")!
  .addEventListener("click", (event) => {
    event.stopPropagation();
    const control = promptAgentPanel.querySelector<HTMLElement>(".agent-mode")!,
      open = control.classList.toggle("open");
    promptAgentPanel
      .querySelector<HTMLButtonElement>("[data-agent-mode-trigger]")!
      .setAttribute("aria-expanded", String(open));
  });
promptAgentPanel
  .querySelectorAll<HTMLButtonElement>("[data-agent-mode]")
  .forEach((button) =>
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      setPromptAgentMode(button.dataset.agentMode as PromptAgentMode);
    }),
  );
promptAgentPanel
  .querySelector<HTMLButtonElement>("[data-agent-prompt-menu]")!
  .addEventListener("click", (event) => {
    event.stopPropagation();
    const submenu = promptAgentPanel.querySelector<HTMLElement>(
        ".agent-prompt-submenu",
      )!,
      open = submenu.classList.toggle("open");
    promptAgentPanel
      .querySelector<HTMLButtonElement>("[data-agent-prompt-menu]")!
      .setAttribute("aria-expanded", String(open));
  });
promptAgentPanel
  .querySelector<HTMLButtonElement>("[data-agent-comic]")!
  .addEventListener("click", (event) => {
    event.stopPropagation();
    openComicStudio();
  });
document.addEventListener("click", (event) => {
  if (!(event.target as HTMLElement | null)?.closest(".agent-mode")) {
    promptAgentPanel
      .querySelector<HTMLElement>(".agent-mode")
      ?.classList.remove("open");
    promptAgentPanel
      .querySelector<HTMLButtonElement>("[data-agent-mode-trigger]")
      ?.setAttribute("aria-expanded", "false");
  }
});
queueMicrotask(() => setPromptAgentMode(promptAgentMode));
const promptAgentGoalInput = promptAgentPanel.querySelector<HTMLTextAreaElement>(
  ".agent-goal textarea",
)!;
function resizePromptAgentGoal() {
  promptAgentGoalInput.style.height = "42px";
  const height = Math.min(62, Math.max(42, promptAgentGoalInput.scrollHeight));
  promptAgentGoalInput.style.height = `${height}px`;
  promptAgentPanel.classList.toggle("has-wrapped-goal", height > 44);
}
promptAgentGoalInput.addEventListener("input", resizePromptAgentGoal);
promptAgentGoalInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    if (
      promptAgentRequestController ||
      (event.currentTarget as HTMLTextAreaElement).disabled
    )
      return;
    promptAgentPanel.querySelector<HTMLButtonElement>(".agent-submit")!.click();
  });
const comicStudio = document.createElement("section");
comicStudio.className = "comic-studio comic-chat-studio";
comicStudio.innerHTML = `<header><div><small>VIORA STORY</small><h2>和灵感一起写漫剧</h2></div><nav><div class="comic-label-control"><button type="button" data-comic-label-picker aria-label="关联标签"><span>◇</span><b>关联标签</b></button><div class="comic-label-menu" data-comic-label-menu></div></div><button type="button" data-comic-new aria-label="新会话"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>新会话</span></button><button type="button" data-comic-close aria-label="关闭"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.75 6.75 17.25 17.25M17.25 6.75 6.75 17.25"/></svg></button></nav></header><aside class="comic-linked-label" data-comic-linked-label hidden></aside><div class="comic-conversation" data-comic-conversation><div class="comic-message assistant comic-welcome"><i>✦</i><div><b>先聊聊你想做的故事</b><p>我会边聊边整理创作方案，不会因为一句话就直接生成。等方向明确后，由你确认生成完整剧本。</p></div></div><aside class="comic-brief" data-comic-brief hidden><header><span><small>当前方案</small><b data-comic-brief-title>正在整理</b></span><em data-comic-brief-state>讨论中</em></header><div data-comic-brief-content></div><button type="button" data-comic-confirm hidden><span>生成完整剧本</span><small>确认后开始正式构思</small></button></aside><section class="comic-plan" hidden><div class="comic-plan-head"><div><small data-comic-meta></small><h3 data-comic-title></h3><p data-comic-logline></p></div></div><div class="comic-plan-scroll"><article><h4>人物与世界</h4><div data-comic-characters></div></article><article><h4>剧情大纲</h4><ol data-comic-outline></ol></article><article><h4>制作分镜</h4><div data-comic-shots></div></article></div><div class="comic-plan-actions"><button type="button" data-comic-label><span>保存为标签</span></button><button type="button" data-comic-label-copy hidden><span>另存为标签</span></button><button type="button" data-comic-canvas><span>铺到画布</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button></div></section></div><footer class="comic-composer"><textarea data-comic-message rows="1" placeholder="继续补充人物、剧情、风格或你不想要的内容…"></textarea><button type="button" data-comic-send aria-label="发送"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button></footer><output data-comic-status></output>`;
document.body.append(comicStudio);
const comicConversationElement = comicStudio.querySelector<HTMLElement>(
    "[data-comic-conversation]",
  )!,
  comicPlanElement = comicStudio.querySelector<HTMLElement>(".comic-plan")!;
comicPlanElement.classList.add("comic-plan-source");
const comicPlanSidePanel = comicPlanElement.cloneNode(true) as HTMLElement;
comicPlanSidePanel.classList.remove("comic-plan-source");
comicPlanSidePanel.classList.add("comic-plan-side");
document.body.append(comicPlanSidePanel);
const comicHeaderNav = comicStudio.querySelector<HTMLElement>(
    ":scope > header nav",
  )!,
  comicLabelControl = comicHeaderNav.querySelector<HTMLElement>(
    ".comic-label-control",
  )!;
comicLabelControl.insertAdjacentHTML(
  "beforebegin",
  '<button type="button" data-comic-desktop-side="brief" aria-label="显示或隐藏当前方案"><span>当前方案</span></button><button type="button" data-comic-desktop-side="plan" aria-label="显示或隐藏完整方案"><span>完整方案</span></button><button type="button" data-comic-scheme aria-label="查看创作方案"><span>方案</span></button>',
);
const comicThinkingStatus = comicStudio.querySelector<HTMLOutputElement>(
    "[data-comic-status]",
  )!,
  comicComposer = comicStudio.querySelector<HTMLElement>(".comic-composer")!,
  comicMessageField = comicComposer.querySelector<HTMLTextAreaElement>(
    "[data-comic-message]",
  )!;
comicThinkingStatus.setAttribute("aria-live", "polite");
comicComposer.insertBefore(comicThinkingStatus, comicMessageField);
const comicBriefPanel =
  comicStudio.querySelector<HTMLElement>("[data-comic-brief]")!;
comicBriefPanel.classList.add("comic-brief-side", "expanded");
document.body.append(comicBriefPanel);
const comicSidePanel = new ComicSidePanelController({
  studio: comicStudio,
  briefPanel: comicBriefPanel,
  sourcePlan: comicPlanElement,
  planPanel: comicPlanSidePanel,
  headerNav: comicHeaderNav,
  getState: () => ({
    linkedLabelId: comicLinkedLabelId,
    sessionId: comicSessionId,
    hasPlan: Boolean(comicPlan),
    pendingRevision: comicPendingRevision,
    ready: comicReady,
    submitting: comicSubmitting,
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
comicHeaderNav
  .querySelector<HTMLButtonElement>("[data-comic-scheme]")!
  .addEventListener("click", () => {
    comicStudio
      .querySelector<HTMLElement>("[data-comic-label-menu]")
      ?.classList.remove("open");
    showComicMobilePanel(
      comicBriefPanel.classList.contains("mobile-open") ||
        comicPlanSidePanel.classList.contains("mobile-open")
        ? null
        : "brief",
    );
  });
comicHeaderNav
  .querySelectorAll<HTMLButtonElement>("[data-comic-desktop-side]")
  .forEach((button) =>
    button.addEventListener("click", () =>
      comicSidePanel.toggleDesktop(
        button.dataset.comicDesktopSide as "brief" | "plan",
        button,
      ),
    ),
  );
const promptAgentModelSelect = document.createElement("select");
promptAgentModelSelect.hidden = true;
promptAgentModelSelect.innerHTML =
  '<option value="gpt-5.5" selected>gpt-5.5</option>';
promptAgentPanel.append(promptAgentModelSelect);
const promptAgentEffects = document.createElement("canvas"),
  promptAgentEffectsFront = document.createElement("canvas");
promptAgentEffects.className = "agent-capsule-effects";
promptAgentEffectsFront.className = "agent-capsule-effects front";
document.body.append(promptAgentEffects, promptAgentEffectsFront);
const promptAgentRibbonBack = document.createElement("div"),
  promptAgentRibbonFront = document.createElement("div");
promptAgentRibbonBack.className = "agent-capsule-ribbon back";
promptAgentRibbonFront.className = "agent-capsule-ribbon front";
promptAgentRibbonBack.innerHTML = `<svg viewBox="0 0 720 180" preserveAspectRatio="none"><defs><linearGradient id="agent-ribbon-back" x1="0" y1="0" x2="720" y2="180" gradientUnits="userSpaceOnUse"><stop stop-color="#80ddd4" stop-opacity="0"/><stop offset=".28" stop-color="#74d8d0" stop-opacity=".5"/><stop offset=".68" stop-color="#829ee0" stop-opacity=".38"/><stop offset="1" stop-color="#829ee0" stop-opacity="0"/></linearGradient><filter id="agent-ribbon-blur"><feGaussianBlur stdDeviation="1.7"/></filter></defs><path d="M-42 118C92 12 188 151 318 73C431 5 527 150 762 46" fill="none" stroke="url(#agent-ribbon-back)" stroke-width="15" stroke-linecap="round" filter="url(#agent-ribbon-blur)"/></svg>`;
promptAgentRibbonFront.innerHTML = `<svg viewBox="0 0 720 180" preserveAspectRatio="none"><defs><linearGradient id="agent-ribbon-front" x1="0" y1="180" x2="720" y2="0" gradientUnits="userSpaceOnUse"><stop stop-color="#819de2" stop-opacity="0"/><stop offset=".32" stop-color="#8ba9e8" stop-opacity=".36"/><stop offset=".64" stop-color="#8de7da" stop-opacity=".55"/><stop offset="1" stop-color="#8de7da" stop-opacity="0"/></linearGradient><filter id="agent-ribbon-front-blur"><feGaussianBlur stdDeviation="1.25"/></filter></defs><path d="M-35 42C123 151 226 23 356 111C484 198 575 22 755 126" fill="none" stroke="url(#agent-ribbon-front)" stroke-width="9" stroke-linecap="round" filter="url(#agent-ribbon-front-blur)"/></svg>`;
document.body.append(promptAgentRibbonBack, promptAgentRibbonFront);
promptAgentRibbonBack.innerHTML = `<svg viewBox="0 0 720 180" preserveAspectRatio="none"><defs><linearGradient id="agent-ribbon-surface-back" x1="0" y1="20" x2="720" y2="160" gradientUnits="userSpaceOnUse"><stop stop-color="#75ddd3" stop-opacity="0"/><stop offset=".2" stop-color="#72d9d0" stop-opacity=".48"/><stop offset=".53" stop-color="#94e7dd" stop-opacity=".34"/><stop offset=".8" stop-color="#809de0" stop-opacity=".4"/><stop offset="1" stop-color="#809de0" stop-opacity="0"/></linearGradient><filter id="agent-ribbon-surface-soft"><feGaussianBlur stdDeviation="1.1"/></filter></defs><path fill="url(#agent-ribbon-surface-back)" filter="url(#agent-ribbon-surface-soft)" d="M-45 113C73 17 181 153 315 72C439-3 548 145 765 43L765 73C557 169 447 27 322 105C188 187 72 49-45 145Z"><animate attributeName="d" dur="7.6s" repeatCount="indefinite" calcMode="spline" keyTimes="0;.34;.68;1" keySplines=".42 0 .58 1;.42 0 .58 1;.42 0 .58 1" values="M-45 113C73 17 181 153 315 72C439-3 548 145 765 43L765 73C557 169 447 27 322 105C188 187 72 49-45 145Z;M-45 126C82 34 173 133 304 59C430-12 557 158 765 55L765 91C550 177 453 38 329 91C196 164 65 65-45 153Z;M-45 102C61 8 194 165 326 82C451 3 535 129 765 35L765 63C570 155 438 17 314 116C176 197 83 39-45 134Z;M-45 113C73 17 181 153 315 72C439-3 548 145 765 43L765 73C557 169 447 27 322 105C188 187 72 49-45 145Z"/></path></svg>`;
promptAgentRibbonFront.innerHTML = `<svg viewBox="0 0 720 180" preserveAspectRatio="none"><defs><linearGradient id="agent-ribbon-surface-front" x1="0" y1="170" x2="720" y2="10" gradientUnits="userSpaceOnUse"><stop stop-color="#829fe3" stop-opacity="0"/><stop offset=".24" stop-color="#8ca8e7" stop-opacity=".36"/><stop offset=".58" stop-color="#9be9df" stop-opacity=".5"/><stop offset=".84" stop-color="#78dcd2" stop-opacity=".42"/><stop offset="1" stop-color="#78dcd2" stop-opacity="0"/></linearGradient><filter id="agent-ribbon-front-soft"><feGaussianBlur stdDeviation=".8"/></filter></defs><path fill="url(#agent-ribbon-surface-front)" filter="url(#agent-ribbon-front-soft)" d="M-40 35C112 143 218 18 354 104C482 185 579 17 760 119L760 145C574 51 484 211 348 129C214 48 117 171-40 62Z"><animate attributeName="d" dur="9.1s" repeatCount="indefinite" calcMode="spline" keyTimes="0;.38;.72;1" keySplines=".42 0 .58 1;.42 0 .58 1;.42 0 .58 1" values="M-40 35C112 143 218 18 354 104C482 185 579 17 760 119L760 145C574 51 484 211 348 129C214 48 117 171-40 62Z;M-40 48C125 159 207 7 341 92C469 174 590 31 760 132L760 157C585 68 471 198 360 119C224 30 103 187-40 78Z;M-40 24C98 127 231 32 366 116C495 196 563 5 760 105L760 134C563 39 497 220 337 140C201 62 132 154-40 51Z;M-40 35C112 143 218 18 354 104C482 185 579 17 760 119L760 145C574 51 484 211 348 129C214 48 117 171-40 62Z"/></path></svg>`;
promptAgentRibbonBack.innerHTML = `<svg viewBox="0 0 720 180" preserveAspectRatio="none"><defs><linearGradient id="agent-silk-back" x1="0" y1="20" x2="720" y2="130" gradientUnits="userSpaceOnUse"><stop stop-color="#72d8cf" stop-opacity="0"/><stop offset=".18" stop-color="#7cddd4" stop-opacity=".34"/><stop offset=".46" stop-color="#b5f3e9" stop-opacity=".42"/><stop offset=".72" stop-color="#91a9e7" stop-opacity=".3"/><stop offset="1" stop-color="#849fe2" stop-opacity="0"/></linearGradient><linearGradient id="agent-silk-shine" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#fff" stop-opacity=".34"/><stop offset=".45" stop-color="#fff" stop-opacity=".05"/><stop offset="1" stop-color="#557fc8" stop-opacity=".12"/></linearGradient><filter id="agent-silk-soft"><feGaussianBlur stdDeviation=".65"/></filter></defs><path fill="url(#agent-silk-back)" filter="url(#agent-silk-soft)" d="M-35 103C72 20 214 33 356 37C502 41 642 17 755 93L755 113C635 45 503 62 355 59C208 56 75 42-35 126Z"><animate attributeName="d" dur="10.5s" repeatCount="indefinite" calcMode="spline" keyTimes="0;.5;1" keySplines=".42 0 .58 1;.42 0 .58 1" values="M-35 103C72 20 214 33 356 37C502 41 642 17 755 93L755 113C635 45 503 62 355 59C208 56 75 42-35 126Z;M-35 109C78 26 205 38 353 33C508 28 635 25 755 99L755 120C628 51 511 55 358 61C203 67 81 48-35 131Z;M-35 103C72 20 214 33 356 37C502 41 642 17 755 93L755 113C635 45 503 62 355 59C208 56 75 42-35 126Z"/></path><path fill="url(#agent-silk-shine)" opacity=".42" d="M-20 104C101 31 220 42 357 45C505 48 626 30 741 96L741 101C625 41 501 56 357 53C215 50 101 40-20 114Z"/></svg>`;
promptAgentRibbonFront.innerHTML = `<svg viewBox="0 0 720 180" preserveAspectRatio="none"><defs><linearGradient id="agent-silk-front-left" x1="0" y1="0" x2="240" y2="120" gradientUnits="userSpaceOnUse"><stop stop-color="#7edfd5" stop-opacity="0"/><stop offset=".48" stop-color="#a4eee4" stop-opacity=".58"/><stop offset="1" stop-color="#8ca9e8" stop-opacity="0"/></linearGradient><linearGradient id="agent-silk-front-right" x1="470" y1="30" x2="720" y2="150" gradientUnits="userSpaceOnUse"><stop stop-color="#8ca7e7" stop-opacity="0"/><stop offset=".48" stop-color="#9feadf" stop-opacity=".52"/><stop offset="1" stop-color="#79dcd2" stop-opacity="0"/></linearGradient><filter id="agent-silk-front-soft"><feGaussianBlur stdDeviation=".45"/></filter></defs><path fill="url(#agent-silk-front-left)" filter="url(#agent-silk-front-soft)" d="M-25 112C45 137 115 146 212 132L225 151C122 168 46 154-25 128Z"><animate attributeName="d" dur="9.8s" repeatCount="indefinite" values="M-25 112C45 137 115 146 212 132L225 151C122 168 46 154-25 128Z;M-25 116C51 142 119 140 220 127L231 148C126 163 48 158-25 132Z;M-25 112C45 137 115 146 212 132L225 151C122 168 46 154-25 128Z"/></path><path fill="url(#agent-silk-front-right)" filter="url(#agent-silk-front-soft)" d="M490 41C586 27 670 48 755 100L755 120C660 67 584 53 482 62Z"><animate attributeName="d" dur="11.2s" repeatCount="indefinite" values="M490 41C586 27 670 48 755 100L755 120C660 67 584 53 482 62Z;M476 46C579 29 665 54 755 106L755 126C654 70 575 56 470 67Z;M490 41C586 27 670 48 755 100L755 120C660 67 584 53 482 62Z"/></path></svg>`;
const physicalAgentRibbon = (id: string, front: boolean) =>
  `<svg viewBox="0 0 720 180" preserveAspectRatio="none"><defs><linearGradient id="${id}-fabric" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#496f78"/><stop offset=".12" stop-color="#759ca4"/><stop offset=".3" stop-color="#b9d4d2"/><stop offset=".47" stop-color="#739ca2"/><stop offset=".7" stop-color="#9bbbc0"/><stop offset=".9" stop-color="#526f82"/><stop offset="1" stop-color="#354c60"/></linearGradient><linearGradient id="${id}-fade" x1="0" y1="0" x2="720" y2="0" gradientUnits="userSpaceOnUse"><stop stop-color="#fff" stop-opacity="0"/><stop offset=".13" stop-color="#fff" stop-opacity="1"/><stop offset=".87" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient><mask id="${id}-end-fade"><rect width="720" height="180" fill="url(#${id}-fade)"/></mask>${front ? `<clipPath id="${id}-front"><rect x="0" y="0" width="178" height="180"/><rect x="548" y="0" width="172" height="180"/></clipPath>` : ""}</defs><g mask="url(#${id}-end-fade)" ${front ? `clip-path="url(#${id}-front)"` : ""}><path class="physical-ribbon-body" fill="url(#${id}-fabric)" d="M-42 112C74 18 190 157 326 68C450-13 557 151 762 48L762 80C564 178 455 20 333 101C195 190 82 55-42 147Z"/><path class="physical-ribbon-fold light" d="M-30 114C86 33 194 153 327 77C451 6 556 155 750 62"/><path class="physical-ribbon-fold shade" d="M-28 136C91 67 196 176 332 92C458 14 560 168 748 73"/></g></svg>`;
promptAgentRibbonBack.innerHTML = physicalAgentRibbon(
  "physical-agent-back",
  false,
);
promptAgentRibbonFront.innerHTML = physicalAgentRibbon(
  "physical-agent-front",
  true,
);
const promptAgentBurst = document.createElement("div");
promptAgentBurst.className = "agent-particle-burst";
promptAgentBurst.innerHTML = Array.from({ length: 28 }, () => "<i></i>").join(
  "",
);
promptAgentTrigger.append(promptAgentBurst);
promptAgentBurst
  .querySelectorAll<HTMLElement>("i")
  .forEach((particle, index) => {
    const angle = index * 2.399 + (index % 4) * 0.19,
      distance = 34 + ((index * 17) % 86);
    particle.style.setProperty("--hx", `${Math.cos(angle) * distance}px`);
    particle.style.setProperty(
      "--hy",
      `${Math.sin(angle) * distance * 0.72}px`,
    );
    particle.style.setProperty("--delay", `${-(index % 14) * 61}ms`);
    particle.style.setProperty("--duration", `${720 + (index % 7) * 34}ms`);
  });
let promptAgentKind: "image" | "video" = "image",
  promptAgentComplexity: "simple" | "detailed" = "simple",
  promptAgentResult: PromptAgentResult | null = null,
  promptAgentContextNodes: FlowNode[] = [],
  promptAgentAppliedNodeId = 0,
  promptAgentUndo: (() => void) | null = null;
let promptAgentEffectFrame: number | null = null;
let promptAgentRequestController: AbortController | null = null,
  promptAgentRequestVersion = 0,
  promptAgentFormTimer = 0;
const promptAgentEffectParticles = Array.from({ length: 46 }, (_, index) => ({
  offset: (index * 0.754877666) % 1,
  speed: 0.026 + (index % 9) * 0.004,
  size: 0.8 + (index % 6) * 0.32,
  ribbon: index % 2,
  phase: index * 1.37,
  lag: 10 + (index % 8) * 3,
}));
function paintPromptAgentEffects(now: number) {
  if (!promptAgentPanel.classList.contains("open")) {
    promptAgentEffects.hidden = true;
    promptAgentEffectsFront.hidden = true;
    promptAgentEffectFrame = null;
    return;
  }
  promptAgentEffects.hidden = false;
  promptAgentEffectsFront.hidden = false;
  const rect = promptAgentPanel.getBoundingClientRect(),
    padX = 46,
    padY = 42,
    width = Math.ceil(rect.width + padX * 2),
    height = Math.ceil(rect.height + padY * 2),
    ratio = Math.min(2, devicePixelRatio || 1),
    canvases = [promptAgentEffects, promptAgentEffectsFront];
  for (const canvas of canvases) {
    canvas.style.left = `${rect.left - padX}px`;
    canvas.style.top = `${rect.top - padY}px`;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
      canvas.width = width * ratio;
      canvas.height = height * ratio;
    }
  }
  const contexts = canvases.map((canvas) => canvas.getContext("2d")!);
  for (const context of contexts) {
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
  }
  const time = now / 1000,
    center = height / 2;
  const ribbonY = (progress: number, ribbon: number) =>
    center +
    (ribbon ? 1 : -1) * (rect.height / 2 + 8) +
    Math.sin(
      progress * (ribbon ? 7.1 : 6.35) +
        time * (ribbon ? 0.7 : 0.86) +
        (ribbon ? 1.8 : 0.25),
    ) *
      4.8 +
    Math.sin(progress * (ribbon ? 15.2 : 12.7) - time * 0.42 + ribbon) * 1.9;
  const drawRibbon = (
    context: CanvasRenderingContext2D,
    ribbon: number,
    start = 0,
    end = 1,
    alpha = 0.5,
  ) => {
    const thickness = ribbon ? 5.5 : 7,
      from = 12 + start * (width - 24),
      to = 12 + end * (width - 24),
      gradient = context.createLinearGradient(from, 0, to, 0);
    gradient.addColorStop(0, "rgba(95,214,207,0)");
    gradient.addColorStop(
      0.18,
      ribbon ? "rgba(123,151,236,.72)" : "rgba(86,225,212,.78)",
    );
    gradient.addColorStop(
      0.78,
      ribbon ? "rgba(145,167,241,.62)" : "rgba(139,240,226,.68)",
    );
    gradient.addColorStop(1, "rgba(108,220,213,0)");
    context.beginPath();
    for (let x = from; x <= to; x += 4) {
      const y = ribbonY(x / width, ribbon);
      if (x === from) context.moveTo(x, y - thickness / 2);
      else context.lineTo(x, y - thickness / 2);
    }
    for (let x = to; x >= from; x -= 4)
      context.lineTo(x, ribbonY(x / width, ribbon) + thickness / 2);
    context.closePath();
    context.fillStyle = gradient;
    context.globalAlpha = alpha;
    context.shadowColor = ribbon
      ? "rgba(116,145,235,.5)"
      : "rgba(80,222,211,.62)";
    context.shadowBlur = 11;
    context.fill();
  };
  drawRibbon(contexts[0], 0, 0, 1, 0.46);
  drawRibbon(contexts[0], 1, 0, 1, 0.4);
  const frontCenter0 = (time * 0.075) % 1,
    frontCenter1 = (0.55 + time * 0.061) % 1;
  for (const [ribbon, frontCenter] of [
    [0, frontCenter0],
    [1, frontCenter1],
  ] as const) {
    const start = frontCenter - 0.15,
      end = frontCenter + 0.15;
    if (start < 0) {
      drawRibbon(contexts[1], ribbon, start + 1, 1, 0.68);
      drawRibbon(contexts[1], ribbon, 0, end, 0.68);
    } else if (end > 1) {
      drawRibbon(contexts[1], ribbon, start, 1, 0.68);
      drawRibbon(contexts[1], ribbon, 0, end - 1, 0.68);
    } else drawRibbon(contexts[1], ribbon, start, end, 0.68);
  }
  for (const particle of promptAgentEffectParticles) {
    const life = (particle.offset + time * particle.speed) % 1,
      progress = Math.max(0.015, life - particle.lag / width),
      frontCenter = particle.ribbon ? frontCenter1 : frontCenter0,
      distance = Math.min(
        Math.abs(progress - frontCenter),
        1 - Math.abs(progress - frontCenter),
      ),
      context = contexts[distance < 0.17 ? 1 : 0],
      x = 12 + progress * (width - 24),
      trailFade = Math.sin(life * Math.PI),
      outward = particle.ribbon ? 1 : -1,
      scatter = outward * (5 + Math.sin(life * 17 + particle.phase) * 4);
    context.beginPath();
    context.arc(
      x,
      ribbonY(progress, particle.ribbon) + scatter,
      particle.size,
      0,
      Math.PI * 2,
    );
    context.fillStyle = particle.ribbon
      ? "rgba(145,169,246,.9)"
      : "rgba(137,244,231,.94)";
    context.globalAlpha = trailFade * trailFade * 0.72;
    context.shadowColor = particle.ribbon ? "#91a8f2" : "#8cf1e5";
    context.shadowBlur = 7;
    context.fill();
  }
  for (const context of contexts) context.globalAlpha = 1;
  promptAgentEffectFrame = requestAnimationFrame(paintPromptAgentEffects);
}
function positionPromptAgentRibbons() {
  const rect = promptAgentPanel.getBoundingClientRect();
  for (const ribbon of [promptAgentRibbonBack, promptAgentRibbonFront]) {
    ribbon.style.left = `${rect.left - 54}px`;
    ribbon.style.top = `${rect.top - 38}px`;
    ribbon.style.width = `${rect.width + 108}px`;
    ribbon.style.height = `${rect.height + 76}px`;
  }
}
function startPromptAgentEffects() {
  promptAgentEffects.hidden = true;
  promptAgentEffectsFront.hidden = true;
  promptAgentRibbonBack.classList.remove("visible");
  promptAgentRibbonFront.classList.remove("visible");
}
function clearPromptAgentResult() {
  promptAgentResult = null;
  promptAgentUndo = null;
  promptAgentAppliedNodeId = 0;
  promptAgentPanel.classList.remove("prompt-result-open");
  const article = promptAgentPanel.querySelector<HTMLElement>("article")!;
  article.hidden = true;
  article.querySelector<HTMLElement>("[data-agent-prompt]")!.textContent = "";
  article.querySelector<HTMLElement>("[data-agent-summary]")!.textContent = "";
}
function closePromptAgent() {
  window.clearTimeout(promptAgentFormTimer);
  promptAgentFormTimer = 0;
  promptAgentRequestController?.abort();
  promptAgentRequestController = null;
  promptAgentRequestVersion++;
  promptAgentPanel
    .querySelector(".agent-submit")
    ?.classList.remove("is-running");
  promptAgentPanel.classList.remove("open", "forming");
  promptAgentTrigger.classList.remove("active");
  promptAgentSelecting = false;
  promptAgentContextSelection.clear();
  promptAgentContextNodes = [];
  clearPromptAgentResult();
  if (promptAgentEffectFrame !== null)
    cancelAnimationFrame(promptAgentEffectFrame);
  promptAgentEffectFrame = null;
  promptAgentEffects.hidden = true;
  promptAgentEffectsFront.hidden = true;
  promptAgentRibbonBack.classList.remove("visible");
  promptAgentRibbonFront.classList.remove("visible");
  draw();
}
function cancelPromptAgentRequest() {
  if (!promptAgentRequestController) return;
  promptAgentRequestController.abort();
  promptAgentRequestController = null;
  promptAgentRequestVersion++;
  promptAgentPanel.querySelector<HTMLTextAreaElement>("textarea")!.disabled =
    false;
  promptAgentPanel.querySelector<HTMLButtonElement>(".agent-submit")!.disabled =
    false;
  promptAgentPanel.querySelector<HTMLButtonElement>(
    "[data-agent-mode-trigger]",
  )!.disabled = false;
  promptAgentPanel.classList.remove("is-busy");
  promptAgentPanel
    .querySelector(".agent-submit")
    ?.classList.remove("is-running");
}
function dispersePromptAgent() {
  if (promptAgentRequestController) {
    showToast("提示词生成中，请等待完成", "warning");
    return;
  }
  if (
    !promptAgentPanel.classList.contains("open") ||
    promptAgentPanel.classList.contains("gathering")
  )
    return;
  const panelRect = promptAgentPanel.getBoundingClientRect(),
    ghost = promptAgentPanel.cloneNode(true) as HTMLElement;
  ghost.removeAttribute("id");
  ghost
    .querySelectorAll("[id]")
    .forEach((element) => element.removeAttribute("id"));
  ghost.classList.add("agent-disperse-ghost", "gathering");
  Object.assign(ghost.style, {
    left: `${panelRect.left}px`,
    top: `${panelRect.top}px`,
    right: "auto",
    bottom: "auto",
    width: `${panelRect.width}px`,
    height: `${panelRect.height}px`,
  });
  document.body.append(ghost);
  const target = { x: panelRect.width / 2, y: panelRect.height / 2 },
    materials = [
      ...ghost.querySelectorAll<HTMLElement>("[data-agent-context-node]"),
    ];
  materials.forEach((material, index) => {
    const rect = material.getBoundingClientRect();
    material.style.setProperty(
      "--gather-x",
      `${target.x - (rect.left - panelRect.left + rect.width / 2)}px`,
    );
    material.style.setProperty(
      "--gather-y",
      `${target.y - (rect.top - panelRect.top + rect.height / 2)}px`,
    );
    material.style.setProperty("--gather-delay", `${index * 18}ms`);
    material.classList.add("is-gathering");
  });
  closePromptAgent();
  window.setTimeout(
    () => {
      const field = document.createElement("div");
      field.className = "agent-disperse-field";
      field.style.left = `${panelRect.left}px`;
      field.style.top = `${panelRect.top}px`;
      field.style.width = `${panelRect.width}px`;
      field.style.height = `${panelRect.height}px`;
      field.innerHTML = Array.from({ length: 82 }, (_, index) => {
        const column = (index * 37) % 100,
          row = (index * 61) % 100,
          angle = index * 2.399963,
          distance = 28 + (index % 11) * 5,
          dx = Math.cos(angle) * distance,
          dy = Math.sin(angle) * distance * 0.72,
          size = 2 + (index % 4);
        return `<i style="left:${column}%;top:${row}%;width:${size}px;height:${size}px;--scatter-x:${dx}px;--scatter-y:${dy}px;--particle-delay:${(index % 9) * 8}ms"></i>`;
      }).join("");
      document.body.append(field);
      ghost.classList.add("dispersing");
      requestAnimationFrame(() => field.classList.add("active"));
      window.setTimeout(() => {
        field.remove();
        ghost.remove();
      }, 680);
    },
    Math.max(190, materials.length * 18 + 150),
  );
}
function dispersePromptAgentDirect() {
  if (promptAgentRequestController) {
    showToast("提示词生成中，请等待完成", "warning");
    return;
  }
  if (!promptAgentPanel.classList.contains("open")) return;
  const panelRect = promptAgentPanel.getBoundingClientRect();
  closePromptAgent();
  const field = document.createElement("div");
  field.className = "agent-disperse-field";
  field.style.left = `${panelRect.left}px`;
  field.style.top = `${panelRect.top}px`;
  field.style.width = `${panelRect.width}px`;
  field.style.height = `${panelRect.height}px`;
  field.innerHTML = Array.from({ length: 82 }, (_, index) => {
    const column = (index * 37) % 100,
      row = (index * 61) % 100,
      angle = index * 2.399963,
      distance = 32 + (index % 11) * 6,
      dx = Math.cos(angle) * distance,
      dy = Math.sin(angle) * distance * 0.72,
      size = 2 + (index % 4);
    return `<i style="left:${column}%;top:${row}%;width:${size}px;height:${size}px;--scatter-x:${dx}px;--scatter-y:${dy}px;--particle-delay:${(index % 9) * 8}ms"></i>`;
  }).join("");
  document.body.append(field);
  requestAnimationFrame(() => field.classList.add("active"));
  window.setTimeout(() => field.remove(), 680);
}
function playAgentMeteor() {
  const node = nodes.find((item) => item.id === promptAgentAppliedNodeId);
  if (!node) return;
  const panel = promptAgentPanel.getBoundingClientRect(),
    start = {
      x: panel.left + panel.width * 0.25,
      y: panel.top + panel.height * 0.45,
    },
    end = {
      x: innerWidth / 2 + camera.x + (node.x + node.width / 2) * camera.zoom,
      y: innerHeight / 2 + camera.y + (node.y + node.height / 2) * camera.zoom,
    },
    dx = end.x - start.x,
    dy = end.y - start.y,
    distance = Math.hypot(dx, dy),
    meteor = document.createElement("div");
  meteor.className = "agent-meteor";
  meteor.style.left = `${start.x}px`;
  meteor.style.top = `${start.y}px`;
  meteor.style.width = `${distance}px`;
  meteor.style.rotate = `${Math.atan2(dy, dx)}rad`;
  meteor.style.setProperty("--distance", `${distance}px`);
  meteor.innerHTML = Array.from(
    { length: 18 },
    (_, index) =>
      `<i style="--delay:${index * 13}ms;--lane:${((index % 5) - 2) * 3}px"></i>`,
  ).join("");
  document.body.append(meteor);
  const element = nodeLayer.querySelector<HTMLElement>(
    `.flow-node[data-id="${node.id}"]`,
  );
  element?.classList.add("agent-materializing");
  window.setTimeout(() => {
    meteor.remove();
    element?.classList.remove("agent-materializing");
  }, 900);
}
function positionPromptAgentParticles() {
  promptAgentBurst.style.left = "50%";
  promptAgentBurst.style.top = "50%";
}
function positionPromptAgentCapsule() {
  const trigger = promptAgentTrigger.getBoundingClientRect(),
    width = promptAgentPanel.offsetWidth || 330,
    left = Math.max(
      10,
      Math.min(
        innerWidth - width - 10,
        trigger.left + trigger.width / 2 - width / 2,
      ),
    );
  promptAgentPanel.style.right = "auto";
  promptAgentPanel.style.left = `${left}px`;
  promptAgentPanel.style.bottom = `${Math.max(82, innerHeight - trigger.top + 12)}px`;
}
function stopPromptAgentHover() {
  promptAgentBurst.classList.remove("hover-active");
}
function playPromptAgentHover() {
  positionPromptAgentParticles();
  promptAgentBurst.classList.add("hover-active");
}
function collectPromptAgentContext() {
  const selected = nodes.find((node) => node.id === selection.selectedId),
    result: FlowNode[] = [],
    seen = new Set<number>(),
    visit = (node: FlowNode) => {
      if (seen.has(node.id) || result.length >= 8) return;
      seen.add(node.id);
      result.push(node);
      links
        .filter((link) => link.to === node.id)
        .map((link) => nodes.find((item) => item.id === link.from))
        .filter((item): item is FlowNode => Boolean(item))
        .sort((a, b) => a.y - b.y || a.x - b.x || a.id - b.id)
        .forEach(visit);
    };
  for (const id of promptAgentContextSelection) {
    const node = nodes.find((item) => item.id === id);
    if (node) visit(node);
  }
  if (selected) visit(selected);
  return result;
}
function selectedPromptAgentNodes() {
  return [...promptAgentContextSelection]
    .map((id) => nodes.find((node) => node.id === id))
    .filter((node): node is FlowNode => Boolean(node));
}
function renderPromptAgentContext(reset = false) {
  promptAgentContextNodes = collectPromptAgentContext();
  if (reset)
    promptAgentContextSelection = new Set(
      promptAgentContextNodes.map((node) => node.id),
    );
  else
    promptAgentContextSelection = new Set(
      [...promptAgentContextSelection].filter((id) =>
        nodes.some((node) => node.id === id),
      ),
    );
  const list = promptAgentPanel.querySelector<HTMLElement>(
      "[data-agent-context-list]",
    )!,
    selectedNodes = selectedPromptAgentNodes(),
    hint = promptAgentPanel.querySelector<HTMLElement>(
      ".agent-selection-hint",
    )!;
  promptAgentPanel.classList.toggle("has-materials", selectedNodes.length > 0);
  hint.querySelector("span")!.textContent = selectedNodes.length
    ? `已选择 ${selectedNodes.length} 个素材 · 点击卡片可增减`
    : "点击卡片选择素材";
  if (!selectedNodes.length) {
    list.innerHTML = "<small>点击卡片添加素材</small>";
    return;
  }
  list.innerHTML = selectedNodes
    .map(
      (node, index) =>
        `<button type="button" class="active" title="${escapeHtml(node.title)}" data-agent-context-node="${node.id}">${node.mediaUrl && node.kind === "image" ? `<img src="${escapeHtml(node.mediaUrl)}" alt="">` : `<i>${node.kind === "image" ? "▧" : node.kind === "video" ? "▶" : "T"}</i>`}<span><b>素材 ${index + 1}</b><small>${escapeHtml(node.title)}</small></span><em>✓</em></button>`,
    )
    .join("");
  list
    .querySelectorAll<HTMLButtonElement>("[data-agent-context-node]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        promptAgentContextSelection.delete(
          Number(button.dataset.agentContextNode),
        );
        renderPromptAgentContext(false);
        draw();
      }),
    );
}
function formPromptAgent() {
  window.clearTimeout(promptAgentFormTimer);
  promptAgentContextSelection.clear();
  promptAgentContextNodes = [];
  renderPromptAgentContext(false);
  positionPromptAgentCapsule();
  const trigger = promptAgentTrigger.getBoundingClientRect(),
    panel = promptAgentPanel.getBoundingClientRect(),
    originX = Math.max(
      0,
      Math.min(panel.width, trigger.left + trigger.width / 2 - panel.left),
    ),
    originY = Math.max(
      0,
      Math.min(panel.height, trigger.top + trigger.height / 2 - panel.top),
    );
  promptAgentPanel.style.setProperty("--agent-origin-x", `${originX}px`);
  promptAgentPanel.style.setProperty("--agent-origin-y", `${originY}px`);
  positionPromptAgentParticles();
  promptAgentBurst.classList.add("hover-active");
  promptAgentPanel.classList.add("forming");
  promptAgentTrigger.classList.add("active");
  promptAgentFormTimer = window.setTimeout(() => {
    promptAgentFormTimer = 0;
    promptAgentPanel.classList.remove("forming");
    promptAgentPanel.classList.add("open");
    promptAgentSelecting = true;
    promptAgentPanel.querySelector("textarea")?.focus();
    startPromptAgentEffects();
    draw();
  }, 40);
}
promptAgentTrigger.addEventListener("pointerenter", playPromptAgentHover);
promptAgentTrigger.addEventListener("pointerleave", stopPromptAgentHover);
promptAgentTrigger.addEventListener("click", (event) => {
  event.stopPropagation();
  const touchToggle =
    matchMedia("(pointer: coarse)").matches || innerWidth <= 800;
  if (touchToggle && promptAgentPanel.classList.contains("open")) {
    cancelPromptAgentRequest();
    dispersePromptAgentDirect();
    return;
  }
  if (promptAgentPanel.classList.contains("forming")) {
    window.clearTimeout(promptAgentFormTimer);
    promptAgentFormTimer = 0;
    promptAgentPanel.classList.remove("forming");
    promptAgentPanel.classList.add("open");
    promptAgentSelecting = true;
    promptAgentPanel.querySelector("textarea")?.focus();
    draw();
    return;
  }
  if (!promptAgentPanel.classList.contains("open")) formPromptAgent();
});
promptAgentPanel
  .querySelectorAll<HTMLButtonElement>("[data-agent-kind]")
  .forEach((button) =>
    button.addEventListener("click", () => {
      promptAgentKind = button.dataset.agentKind as "image" | "video";
      promptAgentPanel
        .querySelectorAll("[data-agent-kind]")
        .forEach((item) => item.classList.toggle("active", item === button));
    }),
  );
promptAgentPanel
  .querySelectorAll<HTMLButtonElement>("[data-agent-complexity]")
  .forEach((button) =>
    button.addEventListener("click", () => {
      promptAgentComplexity = button.dataset.agentComplexity as
        "simple" | "detailed";
      promptAgentPanel
        .querySelectorAll("[data-agent-complexity]")
        .forEach((item) => item.classList.toggle("active", item === button));
      promptAgentPanel.querySelector<HTMLElement>(
        ".agent-submit b",
      )!.textContent =
        promptAgentComplexity === "simple"
          ? "生成简洁提示词"
          : "生成详细提示词";
    }),
  );
let comicPlan: ComicPlan | null = null,
  comicSubmitting = false,
  comicOriginalIdea = "",
  comicLinkedLabelId = 0,
  comicSessionId = "",
  comicSessionOwnerKey = "",
  comicBrief: ComicBrief | null = null,
  comicReady = false,
  comicPendingRevision = "";
function setComicInteractionLocked(locked: boolean) {
  comicStudioView.setInteractionLocked(locked);
}
function currentComicOwnerKey() {
  return `${authUser?.id || "anonymous"}:${currentProjectId}`;
}
function resetComicConversationState(clearPlan = true) {
  comicSessionId = "";
  comicSessionOwnerKey = currentComicOwnerKey();
  comicBrief = null;
  comicReady = false;
  comicPendingRevision = "";
  if (clearPlan) comicPlan = null;
  renderComicBrief();
}
async function ensureComicProjectContext() {
  const previousOwner = comicSessionOwnerKey;
  if (!(await ensureCurrentUserProject())) return false;
  const owner = currentComicOwnerKey();
  if (previousOwner && previousOwner !== owner)
    resetComicConversationState(true);
  comicSessionOwnerKey = owner;
  return Boolean(currentProjectId);
}
function renderComicBrief() {
  const linkedTitle = nodes
    .find((node) => node.id === comicLinkedLabelId)
    ?.title.replace(/^漫剧方案\s*·\s*/, "");
  comicStudioView.renderBrief({
    brief: comicBrief,
    plan: comicPlan,
    sessionId: comicSessionId,
    pendingRevision: comicPendingRevision,
    ready: comicReady,
    linkedTitle,
  });
}
function comicLabels() {
  return nodes
    .filter((node) => node.kind === "prompt" && node.body.trim())
    .sort((a, b) => b.id - a.id);
}
function unlinkComicLabel() {
  comicLinkedLabelId = 0;
  comicOriginalIdea = "";
  resetComicConversationState(true);
  comicStudio.querySelector<HTMLElement>(".comic-plan")!.hidden = true;
  renderComicLabelState();
}
function selectComicLabel(label: FlowNode) {
  comicLinkedLabelId = label.id;
  comicOriginalIdea = label.body;
  const stored = label.comicData as ComicPlan | undefined;
  const saved =
    stored?.shots && Array.isArray(stored.shots) ? structuredClone(stored) : null;
  resetComicConversationState(true);
  if (saved) {
    comicPlan = saved;
    comicBrief = briefFromComicPlan(saved);
    renderComicPlan(saved);
  } else {
    comicPlan = null;
    comicBrief = {
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
  getLinkedId: () => comicLinkedLabelId,
  onSelect: selectComicLabel,
  onUnlink: unlinkComicLabel,
});
function renderComicLabelState() {
  comicLabelController.renderState();
}
function renderComicLabelMenu() {
  comicLabelController.renderMenu();
}
function clearRestoredComicSession() {
  comicSubmitting = false;
  setComicInteractionLocked(false);
  comicOriginalIdea = "";
  comicLinkedLabelId = 0;
  resetComicConversationState(true);
  renderComicLabelState();
  comicStudio
    .querySelectorAll(".comic-message:not(.comic-welcome)")
    .forEach((message) => message.remove());
  comicStudio.querySelector<HTMLElement>(".comic-plan")!.hidden = true;
  comicStudio
    .querySelector<HTMLOutputElement>("[data-comic-status]")!
    .classList.remove("visible", "generating");
}
function applyRestoredComicSession(saved: import("../services/comic").ComicSessionSnapshot) {
  comicSessionId = String(saved.id || "");
  comicBrief = saved.brief || null;
  comicPendingRevision = String(saved.pendingRevision || "");
  comicPlan = saved.plan || null;
  comicReady = saved.phase === "ready";
  if (comicPlan) renderComicPlan(comicPlan);
  renderComicBrief();
  const status = comicStudio.querySelector<HTMLOutputElement>(
      "[data-comic-status]",
    )!,
    running = saved.generationStatus === "running";
  comicSubmitting = running;
  setComicInteractionLocked(running);
  if (running) {
    status.classList.add("visible", "generating");
    const amount = saved.generationReceivedBytes
      ? ` · 已接收 ${(Number(saved.generationReceivedBytes) / 1024).toFixed(1)} KB`
      : "";
    status.textContent = `${saved.generationStage || "正在生成完整剧本"} · ${Number(saved.generationProgress) || 0}%${amount}`;
    status.style.setProperty(
      "--comic-progress",
      `${Number(saved.generationProgress) || 0}%`,
    );
  } else if (
    saved.generationStatus === "interrupted" ||
    saved.generationStatus === "failed"
  ) {
    const baseMessage =
        saved.generationError || "上一次漫剧生成已中断，请重新生成",
      message = saved.hasGenerationCheckpoint
        ? `${baseMessage} 再次点击生成将从已校验检查点继续。`
        : baseMessage;
    status.textContent = message;
    status.classList.add("visible");
    showToast(message, "warning");
  } else if (saved.generationStatus === "succeeded" && comicPlan) {
    status.textContent = "完整剧本已恢复";
    status.classList.add("visible");
    window.setTimeout(
      () => status.classList.remove("visible", "generating"),
      2200,
    );
  }
}
const comicSessionController = new ComicSessionController({
  getProjectId: () => currentProjectId,
  getOwnerKey: currentComicOwnerKey,
  getTrackedSessionId: () => (comicSubmitting ? comicSessionId : ""),
  onEmpty: clearRestoredComicSession,
  onSnapshot: applyRestoredComicSession,
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
  if (comicSessionOwnerKey && comicSessionOwnerKey !== currentComicOwnerKey()) {
    resetComicConversationState(true);
    comicSessionController.invalidate();
  }
  comicSessionOwnerKey = currentComicOwnerKey();
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
async function requestComicDialogue(message: string) {
  if (comicSubmitting || !message.trim()) return;
  comicSubmitting = true;
  if (!(await ensureComicProjectContext())) {
    comicSubmitting = false;
    showToast("当前项目不可用，请重新进入项目", "error");
    return;
  }
  const conversation = comicStudio.querySelector<HTMLElement>(
      "[data-comic-conversation]",
    )!,
    userMessage = document.createElement("div");
  userMessage.className = "comic-message user";
  userMessage.innerHTML = `<div><p>${escapeHtml(message.trim())}</p></div>`;
  conversation.insertBefore(
    userMessage,
    comicStudio.querySelector(".comic-plan"),
  );
  const status = comicStudio.querySelector<HTMLOutputElement>(
      "[data-comic-status]",
    )!,
    send = comicStudio.querySelector<HTMLButtonElement>("[data-comic-send]")!,
    field = comicStudio.querySelector<HTMLTextAreaElement>(
      "[data-comic-message]",
    )!,
    confirm = comicBriefPanel.querySelector<HTMLButtonElement>(
      "[data-comic-confirm]",
    )!;
  send.disabled = true;
  field.disabled = true;
  confirm.disabled = true;
  send.classList.add("thinking");
  status.textContent = "正在整理你的想法…";
  status.classList.add("visible");
  const selectedContexts = selectedPromptAgentNodes(),
    linkedLabel = nodes.find((node) => node.id === comicLinkedLabelId),
    context = [
      ...(linkedLabel
        ? [
            `关联标签「${linkedLabel.title}」：${linkedLabel.body.slice(0, 5000)}`,
          ]
        : []),
      ...selectedContexts.map(
        (node, index) =>
          `素材 ${index + 1}「${node.title}」：${node.generationPrompt || node.body || "视觉参考"}`,
      ),
    ];
  let streamingAssistant: HTMLElement | null = null;
  try {
    const assistant = document.createElement("div");
    streamingAssistant = assistant;
    assistant.className = "comic-message assistant compact streaming";
    assistant.innerHTML = "<i>✦</i><div><b>正在回应</b><p></p></div>";
    conversation.insertBefore(
      assistant,
      comicStudio.querySelector(".comic-plan"),
    );
    conversation.scrollTo({
      top: conversation.scrollHeight,
      behavior: "smooth",
    });
    const replyText = assistant.querySelector<HTMLElement>("p")!,
      replyTitle = assistant.querySelector<HTMLElement>("b")!,
      result = await streamComicDialogue(
        {
          projectId: currentProjectId,
          sessionId: comicSessionId || undefined,
          message: message.trim(),
          context,
          plan: comicSessionId ? undefined : comicPlan,
          model: "gpt-5.5",
        },
        (event) => {
        if (event.type === "start") {
          comicSessionId = String(event.sessionId || comicSessionId);
          status.textContent = "正在理解并回应…";
        } else if (event.type === "delta") {
          replyText.textContent = event.text || "";
          conversation.scrollTop = conversation.scrollHeight;
        } else if (event.type === "retry") {
          replyText.textContent = "";
          status.textContent = event.message || "正在切换备用线路…";
        } else if (event.type === "reset") replyText.textContent = "";
        },
      );
    comicSessionId = String(result.sessionId || comicSessionId);
    comicBrief = result.brief || comicBrief;
    comicReady = Boolean(result.ready);
    comicPendingRevision = String(result.pendingRevision || "");
    if (!comicPlan && !comicOriginalIdea)
      comicOriginalIdea = comicBrief?.premise || message.trim();
    renderComicBrief();
    replyText.textContent =
      result.reply || replyText.textContent || "我已经记下了。";
    replyTitle.textContent = comicPlan
      ? "修改建议已记下"
      : comicReady
        ? "方向已经清楚"
        : "我们继续把故事聊清楚";
    assistant.classList.remove("streaming");
    conversation.scrollTo({
      top: conversation.scrollHeight,
      behavior: "smooth",
    });
    status.textContent = comicPlan
      ? comicPendingRevision
        ? "等待你确认应用修改"
        : "继续告诉我想调整的地方"
      : comicReady
        ? "可以确认生成完整剧本"
        : "等待继续补充";
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "漫剧对话失败";
    if (streamingAssistant) {
      streamingAssistant.classList.remove("streaming");
      streamingAssistant.querySelector("b")!.textContent = "这次没有连接上";
      streamingAssistant.querySelector("p")!.textContent =
        "你的消息没有丢失，可以再次发送重试。";
    }
    status.textContent = messageText;
    showToast(messageText, "error");
  } finally {
    comicSubmitting = false;
    send.disabled = false;
    field.disabled = false;
    confirm.disabled = false;
    send.classList.remove("thinking");
    field.focus();
    window.setTimeout(() => {
      if (!comicSubmitting) status.classList.remove("visible");
    }, 2200);
  }
}
async function requestComicPlan() {
  if (comicSubmitting) return;
  comicSubmitting = true;
  if (!(await ensureComicProjectContext())) {
    comicSubmitting = false;
    showToast("当前项目不可用，请重新进入项目", "error");
    return;
  }
  if (!comicSessionId) {
    comicSubmitting = false;
    showToast("项目已切换，请先在当前项目重新聊聊创作方向", "warning");
    return;
  }
  const revision = comicPlan ? comicPendingRevision : "";
  if (comicPlan && !revision) {
    comicSubmitting = false;
    showToast("还没有需要应用的修改", "warning");
    return;
  }
  const conversation = comicStudio.querySelector<HTMLElement>(
    "[data-comic-conversation]",
  )!;
  const status = comicStudio.querySelector<HTMLOutputElement>(
      "[data-comic-status]",
    )!,
    send = comicStudio.querySelector<HTMLButtonElement>("[data-comic-send]")!,
    field = comicStudio.querySelector<HTMLTextAreaElement>(
      "[data-comic-message]",
    )!,
    confirm = comicBriefPanel.querySelector<HTMLButtonElement>(
      "[data-comic-confirm]",
    )!;
  send.disabled = true;
  field.disabled = true;
  confirm.disabled = true;
  confirm.querySelector("span")!.textContent = revision
    ? "正在应用修改…"
    : "正在生成完整剧本…";
  confirm.querySelector("small")!.textContent = "任务运行期间请稍候";
  send.classList.add("thinking");
  status.textContent = revision ? "正在理解你的修改…" : "正在理解故事想法…";
  status.style.setProperty("--comic-progress", "2%");
  status.classList.add("visible", "generating");
  const selectedContexts = selectedPromptAgentNodes(),
    linkedLabel = nodes.find((node) => node.id === comicLinkedLabelId),
    context = [
      ...(linkedLabel
        ? [`已关联故事标签「${linkedLabel.title}」：\n${linkedLabel.body}`]
        : []),
      ...selectedContexts.map(
        (node, index) =>
          `素材 ${index + 1}「${node.title}」：${node.generationPrompt || node.body || "视觉参考"}`,
      ),
    ],
    visuals = selectedContexts
      .filter((node) => node.kind === "image" && node.mediaUrl)
      .map((node) => node.mediaUrl!);
  try {
    const confirmedBrief = JSON.stringify(
      comicBrief || { premise: comicOriginalIdea.slice(0, 1200) },
    );
    let lastPhase = "正在构思…";
    const payload = await streamComicPlan(
      {
        projectId: currentProjectId,
        sessionId: comicSessionId,
        idea: confirmedBrief,
        context,
        visuals,
        previousPlan: comicPlan,
        revision,
        model: "gpt-5.5",
      },
      (event) => {
        if (event.type === "start")
          status.textContent = event.message || "正在构思…";
        else if (event.type === "progress") {
          lastPhase = event.phase || lastPhase;
          const progress = Math.max(0, Math.min(100, event.progress || 0));
          const amount = event.receivedBytes
            ? ` · 已接收 ${(event.receivedBytes / 1024).toFixed(1)} KB`
            : "";
          status.style.setProperty("--comic-progress", `${progress}%`);
          status.textContent = `${lastPhase} · ${progress}%${amount}`;
        } else if (event.type === "heartbeat") {
          const amount = event.receivedBytes
            ? ` · 已接收 ${(event.receivedBytes / 1024).toFixed(1)} KB`
            : "";
          const waiting =
            (event.idleSeconds || 0) >= 10
              ? ` · 已等待 ${event.idleSeconds} 秒`
              : " · 持续接收中";
          status.textContent = `${lastPhase} · ${event.progress || 0}%${amount}${waiting}`;
        } else if (event.type === "result")
          status.style.setProperty("--comic-progress", "100%");
      },
    );
    comicPlan = payload;
    comicBrief = { ...(comicBrief || {}), title: payload.title };
    comicPendingRevision = "";
    comicReady = false;
    renderComicPlan(payload);
    renderComicBrief();
    const assistant = document.createElement("div");
    assistant.className = "comic-message assistant compact";
    assistant.innerHTML = `<i>✦</i><div><b>${revision ? "修改已应用" : "完整剧本已经生成"}</b><p>${escapeHtml(revision ? payload.changeSummary || "未提及的部分保持不变。" : `《${payload.title}》共 ${payload.shots.length} 个镜头。你可以继续和我讨论改进方向，我会先整理修改，等你确认后再应用。`)}</p></div>`;
    conversation.insertBefore(
      assistant,
      comicStudio.querySelector(".comic-plan"),
    );
    status.textContent = revision ? "方案已更新" : "完整剧本已完成";
    conversation.scrollTo({
      top: conversation.scrollHeight,
      behavior: "smooth",
    });
  } catch (error) {
    const messageText =
      error instanceof Error ? error.message : "漫剧方案生成失败";
    // A browser/proxy stream can disconnect while the server-side generation
    // continues. Reconcile with the persisted session before reporting failure
    // or unlocking the editor, otherwise users can accidentally submit twice.
    comicSessionController.invalidate();
    await restoreComicSession(true);
    if (comicSubmitting) {
      status.classList.add("visible", "generating");
    } else {
      status.textContent = messageText;
      showToast(messageText, "error");
    }
  } finally {
    if (!comicSubmitting) {
      setComicInteractionLocked(false);
      renderComicBrief();
      field.focus();
      window.setTimeout(() => {
        if (!comicSubmitting) status.classList.remove("visible", "generating");
      }, 2600);
    }
  }
}
function scenePromptWithoutCharacters(value: string) {
  return stripCharactersFromScenePrompt(value, comicPlan);
}
function applyComicToCanvas() {
  if (!comicPlan) return;
  resetMarqueeRightGesture();
  if (selection.multiSelectMode) exitMultiSelectMode();
  try {
    const { result, storyboardCount, compositeCount, sceneCount } =
      buildComicWorkflow(comicPlan);
    applyPromptAgentPlan(result);
    closeComicStudio();
    showToast(
      `工作流已铺到画布：${comicPlan.characters.length} 个角色、${comicPlan.props?.length || 0} 个道具、${sceneCount} 个场景、${storyboardCount} 张关键帧${compositeCount ? `、${compositeCount} 张合成底图` : ""}`,
      "success",
    );
    window.setTimeout(
      () =>
        showCanvasGuide({
          key: "comic-empty-images-guide",
          title: "连续分镜工作流已就绪",
          detail: `每次生图最多使用 2 张参考${compositeCount ? `，${compositeCount} 个复杂画面会逐层合成` : ""}；检查素材和提示词后，可点击顶栏“启动空图”。`,
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    showToast("铺设漫剧工作流失败", "error", message);
    clientLog("comic_canvas_apply_failed", {
      message,
      shots: comicPlan.shots.length,
      nodes: nodes.length,
    });
  }
}
function comicPlanText(plan: ComicPlan) {
  return formatComicPlan(plan);
}
function saveComicAsLabel(copy = false) {
  if (!comicPlan) return;
  let label = !copy
    ? nodes.find((node) => node.id === comicLinkedLabelId)
    : undefined;
  if (!label) {
    const rightEdge = nodes.length
      ? Math.max(...nodes.map((node) => node.x + node.width))
      : world({ x: innerWidth / 2, y: innerHeight / 2 }).x - 220;
    addNode("prompt", {
      x: rightEdge + 180,
      y: world({ x: innerWidth / 2, y: innerHeight / 2 }).y - 280,
    });
    label = nodes.find((node) => node.id === selection.selectedId);
  }
  if (!label) return;
  label.title = `漫剧方案 · ${comicPlan.title}`;
  label.body = comicPlanText(comicPlan);
  label.comicData = structuredClone(comicPlan);
  label.width = 440;
  label.height = 560;
  label.fontScale = 0.92;
  comicLinkedLabelId = label.id;
  renderComicLabelState();
  scheduleSave();
  draw();
  showToast(
    copy ? "漫剧方案已另存为新标签" : "漫剧方案已保存并可继续修改",
    "success",
  );
}
comicStudio
  .querySelector("[data-comic-close]")!
  .addEventListener("click", closeComicStudio);
comicStudio.querySelector("[data-comic-new]")!.addEventListener("click", () => {
  if (comicSubmitting) {
    showToast("请等待当前构思完成后再开始新会话", "warning");
    return;
  }
  showComicMobilePanel(null);
  comicStudio
    .querySelector<HTMLElement>("[data-comic-label-menu]")
    ?.classList.remove("open");
  comicOriginalIdea = "";
  comicLinkedLabelId = 0;
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
  if (comicSubmitting) return;
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
    if (!comicSubmitting) sendComicMessage();
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
function applyPromptAgentPlan(result: PromptAgentResult) {
  const sources = selectedPromptAgentNodes(),
    current = sources[0],
    kind = result.targetType || result.kind,
    canUpdate =
      current &&
      current.kind === kind &&
      current.role !== "result" &&
      !current.mediaUrl,
    action =
      result.action === "update_current" && canUpdate
        ? "update_current"
        : result.action === "create_new"
          ? "create_new"
          : "create_child";
  promptAgentUndo = null;
  promptAgentAppliedNodeId = 0;
  const planned = (result.steps || [])
    .filter(
      (step) =>
        ["image", "video", "voice", "tts"].includes(step.kind) &&
        step.prompt?.trim(),
    )
    .slice(0, 192);
  if (planned.length) {
    const imageSources = sources.filter(
        (source) => source.kind === "image" && Boolean(source.mediaUrl),
      ),
      createdIds: number[] = [],
      createdNodes: FlowNode[] = [],
      rightEdge = nodes.length
        ? Math.max(...nodes.map((node) => node.x + node.width))
        : 0,
      base = {
        x: rightEdge + 230,
        y: current
          ? current.y + 80
          : world({ x: innerWidth / 2, y: innerHeight / 2 }).y,
      },
      comicLayout = planComicWorkflowLayout(planned, base);
    planned.forEach((step, index) => {
      const comicWorkflow = result.layout === "comic-workflow",
        position = promptAgentStepPosition({
          index,
          step,
          layout: result.layout,
          base,
          comic: comicLayout,
        });
      addNode(step.kind, position, true);
      const created = nodes.find((node) => node.id === selection.selectedId);
      if (!created) return;
      configurePromptAgentNode({
        node: created,
        step,
        index,
        comicWorkflow,
        shouldGenerate: Boolean(result.shouldGenerate),
      });
      createdIds.push(created.id);
      createdNodes.push(created);
      connectPromptAgentInputs(
        created,
        resolvePromptAgentInputs({
          step,
          stepIndex: index,
          imageSources,
          createdNodes,
          comicWorkflow,
        }),
        links,
      );
    });
    promptAgentAppliedNodeId = createdIds[0] || 0;
    promptAgentUndo = () => {
      for (let index = links.length - 1; index >= 0; index--)
        if (
          createdIds.includes(links[index].from) ||
          createdIds.includes(links[index].to)
        )
          links.splice(index, 1);
      for (let index = nodes.length - 1; index >= 0; index--)
        if (createdIds.includes(nodes[index].id)) nodes.splice(index, 1);
      selection.selectedId = 0;
      promptAgentAppliedNodeId = 0;
      scheduleSave();
      draw();
    };
    selection.selectedId = promptAgentAppliedNodeId;
    scheduleSave();
    draw();
    if (result.shouldGenerate) queueMicrotask(runAgentWorkflow);
    return;
  }
  if (action === "update_current" && current) {
    const before = {
      body: current.body,
      generationPrompt: current.generationPrompt,
      title: current.title,
    };
    current.body = result.finalPrompt;
    current.generationPrompt = result.finalPrompt;
    current.title = kind === "video" ? "Agent · 视频任务" : "Agent · 图像任务";
    promptAgentAppliedNodeId = current.id;
    promptAgentUndo = () => {
      current.body = before.body;
      current.generationPrompt = before.generationPrompt;
      current.title = before.title;
      selection.selectedId = current.id;
      scheduleSave();
      draw();
    };
  } else {
    const anchor =
      action === "create_child" && current
        ? {
            x: current.x + current.width + 120,
            y: current.y + current.height / 2,
          }
        : world({ x: innerWidth / 2, y: innerHeight / 2 });
    addNode(kind, anchor);
    const created = nodes.find((node) => node.id === selection.selectedId);
    if (!created) return;
    created.body = result.finalPrompt;
    created.generationPrompt = result.finalPrompt;
    created.title = kind === "video" ? "Agent · 视频任务" : "Agent · 图像任务";
    promptAgentAppliedNodeId = created.id;
    if (action === "create_child")
      sources
        .filter((source) => source.id !== created.id)
        .forEach((source, inputIndex) => {
          if (
            !links.some(
              (link) => link.from === source.id && link.to === created.id,
            )
          )
            links.push({
              from: source.id,
              to: created.id,
              fromSide: "right",
              toSide: "left",
              inputOrder: inputIndex + 1,
            });
        });
    promptAgentUndo = () => {
      const index = nodes.findIndex((node) => node.id === created.id);
      if (index >= 0) nodes.splice(index, 1);
      for (let index = links.length - 1; index >= 0; index--)
        if (links[index].from === created.id || links[index].to === created.id)
          links.splice(index, 1);
      if (selection.selectedId === created.id) selection.selectedId = 0;
      promptAgentAppliedNodeId = 0;
      scheduleSave();
      draw();
    };
  }
  selection.selectedId = promptAgentAppliedNodeId;
  scheduleSave();
  draw();
}
function applyPromptAgentVoice(result: PromptAgentResult) {
  const config = result.voiceConfig || {},
    anchor = world({ x: innerWidth / 2, y: innerHeight / 2 });
  addNode("voice", anchor);
  const created = nodes.find((node) => node.id === selection.selectedId);
  if (!created) return;
  const speed = Math.max(0.5, Math.min(2, Number(config.speed) || 1)),
    pitch = Math.max(-50, Math.min(50, Number(config.pitch) || 0)),
    volume = Math.max(0, Math.min(2, Number(config.volume) || 1));
  created.title = `语音配置 · ${String(config.roleName || "新角色").trim() || "新角色"}`;
  created.body = String(result.finalPrompt || config.tone || "自然").trim();
  created.voiceSettings = {
    providerId: "easyvoice-local",
    voiceId: String(config.voiceId || "zh-CN-XiaoxiaoNeural"),
    language: "zh-CN",
    defaultSpeed: speed,
    pitch,
    volume,
    roleName: String(config.roleName || "").trim(),
    tone: String(config.tone || "自然").trim(),
  };
  promptAgentAppliedNodeId = created.id;
  promptAgentUndo = () => {
    const index = nodes.findIndex((node) => node.id === created.id);
    if (index >= 0) nodes.splice(index, 1);
    for (let index = links.length - 1; index >= 0; index--)
      if (links[index].from === created.id || links[index].to === created.id)
        links.splice(index, 1);
    if (selection.selectedId === created.id) selection.selectedId = 0;
    promptAgentAppliedNodeId = 0;
    scheduleSave();
    draw();
  };
  void loadTtsVoices("easyvoice-local");
  scheduleSave();
  draw();
}
promptAgentPanel
  .querySelector<HTMLButtonElement>(".agent-submit")!
  .addEventListener("click", (event) => {
    if (promptAgentMode !== "voice") return;
    event.stopImmediatePropagation();
    const textarea =
        promptAgentPanel.querySelector<HTMLTextAreaElement>("textarea")!,
      idea = textarea.value.trim(),
      submit =
        promptAgentPanel.querySelector<HTMLButtonElement>(".agent-submit")!,
      modeTrigger = promptAgentPanel.querySelector<HTMLButtonElement>(
        "[data-agent-mode-trigger]",
      )!,
      status =
        promptAgentPanel.querySelector<HTMLOutputElement>(".agent-status")!;
    if (promptAgentRequestController) {
      showToast("音色配置生成中，请等待完成", "warning");
      return;
    }
    if (!idea) {
      showToast("先描述角色和想要的声音", "warning");
      return;
    }
    const controller = new AbortController(),
      version = ++promptAgentRequestVersion;
    promptAgentRequestController = controller;
    textarea.disabled = true;
    submit.disabled = true;
    modeTrigger.disabled = true;
    promptAgentPanel.classList.add("is-busy");
    submit.classList.add("is-running");
    submit.title = "正在匹配音色";
    status.textContent = "正在理解角色并匹配中文音色…";
    void (async () => {
      try {
        const result = await requestPromptAgent(
          {
            idea,
            kind: "image",
            promptMode: "voice",
            complexity: "simple",
            model: promptAgentModelSelect.value,
          },
          controller.signal,
        );
        if (version !== promptAgentRequestVersion) return;
        if (!result.voiceConfig) throw new Error("没有匹配到可用中文音色");
        promptAgentResult = result;
        applyPromptAgentVoice(result);
        playAgentMeteor();
        status.textContent = "音色配置已创建";
        textarea.value = "";
        showToast(result.summary || "音色配置卡片已创建", "success");
      } catch (error) {
        if (controller.signal.aborted || version !== promptAgentRequestVersion)
          return;
        const message =
          error instanceof Error ? error.message : "音色配置生成失败";
        status.textContent = message;
        showToast(message, "error");
      } finally {
        if (version === promptAgentRequestVersion) {
          promptAgentRequestController = null;
          textarea.disabled = false;
          submit.disabled = false;
          modeTrigger.disabled = false;
          promptAgentPanel.classList.remove("is-busy");
          submit.classList.remove("is-running");
          submit.title = "";
        }
      }
    })();
  });
promptAgentPanel
  .querySelector<HTMLButtonElement>(".agent-submit")!
  .addEventListener("click", async () => {
    const textarea =
        promptAgentPanel.querySelector<HTMLTextAreaElement>("textarea")!,
      idea = textarea.value.trim(),
      submit =
        promptAgentPanel.querySelector<HTMLButtonElement>(".agent-submit")!,
      status =
        promptAgentPanel.querySelector<HTMLOutputElement>(".agent-status")!,
      article = promptAgentPanel.querySelector<HTMLElement>("article")!,
      selected = nodes.find((node) => node.id === selection.selectedId),
      promptOnly = promptAgentMode !== "create",
      modeTrigger = promptAgentPanel.querySelector<HTMLButtonElement>(
        "[data-agent-mode-trigger]",
      )!,
      comicEntry =
        promptAgentPanel.querySelector<HTMLButtonElement>(
          ".agent-comic-entry",
        )!;
    if (promptAgentRequestController) {
      showToast("提示词生成中，请等待完成", "warning");
      return;
    }
    if (!idea) {
      showToast(
        promptOnly ? "先描述需要生成提示词的镜头" : "先告诉我你想创造什么",
        "warning",
      );
      return;
    }
    const controller = new AbortController(),
      version = ++promptAgentRequestVersion;
    promptAgentRequestController = controller;
    promptAgentKind =
      promptAgentMode === "agnes" || /视频|动态|动起来|镜头运动|运镜/.test(idea)
        ? "video"
        : "image";
    const selectedContexts = selectedPromptAgentNodes(),
      context = selectedContexts.map(
        (node, index) =>
          `${index === 0 ? "当前节点" : `参考节点${index + 1}`}「${node.title}」：${node.generationPrompt || node.body || "无文字说明"}`,
      ),
      visuals = selectedContexts
        .filter((node) => node.kind === "image" && node.mediaUrl)
        .map((node) => node.mediaUrl!);
    textarea.disabled = true;
    submit.disabled = true;
    modeTrigger.disabled = true;
    comicEntry.disabled = true;
    promptAgentPanel.classList.add("is-busy");
    submit.classList.add("is-running");
    submit.title = "正在生成提示词";
    status.textContent = promptOnly
      ? "正在理解镜头并生成提示词…"
      : "正在理解素材并规划画布…";
    article.hidden = true;
    promptAgentPanel.classList.remove("prompt-result-open");
    try {
      const result = await requestPromptAgent(
        {
            idea,
            kind: promptAgentKind,
            promptMode: promptAgentMode,
            complexity: promptAgentComplexity,
            context,
            visuals,
            model: promptAgentModelSelect.value,
            target: selected
              ? {
                  id: selected.id,
                  kind: selected.kind,
                  role: selected.role || "generator",
                  hasMedia: Boolean(selected.mediaUrl),
                  hasPrompt: Boolean(
                    (selected.generationPrompt || selected.body).trim(),
                  ),
                }
              : null,
        },
        controller.signal,
      );
      if (version !== promptAgentRequestVersion) return;
      promptAgentResult = result;
      if (!promptOnly) {
        applyPromptAgentPlan(result);
        playAgentMeteor();
      } else {
        promptAgentUndo = null;
        promptAgentAppliedNodeId = 0;
      }
      article.querySelector<HTMLElement>("[data-agent-prompt]")!.textContent =
        result.finalPrompt;
      article.querySelector<HTMLElement>("[data-agent-summary]")!.textContent =
        promptOnly
          ? promptAgentMode === "agnes"
            ? "Agnes Video v2.0 提示词已生成"
            : "通用提示词已生成"
          : result.summary || "已根据你的素材准备好画布节点";
      article.querySelector("small")!.textContent =
        `${result.model} · ${promptOnly ? (promptAgentMode === "agnes" ? "Agnes" : "通用") : (result.targetType || result.kind) === "video" ? "视频" : "图像"} · ${selectedContexts.length} 个参考`;
      article.querySelector<HTMLButtonElement>("[data-agent-undo]")!.hidden =
        promptOnly || !promptAgentUndo;
      article.querySelector<HTMLButtonElement>("[data-agent-apply]")!.hidden =
        !promptOnly ||
        !selected ||
        !["image", "video"].includes(selected.kind) ||
        selected.role === "result";
      article.querySelector<HTMLButtonElement>("[data-agent-locate]")!.hidden =
        promptOnly;
      article.hidden = false;
      promptAgentPanel.classList.toggle("prompt-result-open", promptOnly);
      status.textContent = promptOnly ? "提示词已生成" : "画布已更新";
      textarea.value = "";
      showToast(
        promptOnly ? "提示词已生成" : result.summary || "创作节点已准备",
        "success",
      );
    } catch (error) {
      if (controller.signal.aborted || version !== promptAgentRequestVersion)
        return;
      const message =
        error instanceof Error
          ? error.message
          : promptOnly
            ? "提示词生成失败"
            : "创作规划失败";
      status.textContent = message;
      showToast(message, "error");
    } finally {
      if (version === promptAgentRequestVersion) {
        promptAgentRequestController = null;
        textarea.disabled = false;
        submit.disabled = false;
        modeTrigger.disabled = false;
        comicEntry.disabled = false;
        promptAgentPanel.classList.remove("is-busy");
        submit.classList.remove("is-running");
        submit.title = "";
      }
    }
  });
promptAgentPanel
  .querySelector("[data-agent-copy]")!
  .addEventListener("click", async () => {
    if (!promptAgentResult) return;
    await navigator.clipboard.writeText(
      decodePromptClipboardText(promptAgentResult.finalPrompt),
    );
    showToast("提示词已复制", "success");
    dispersePromptAgent();
  });
promptAgentPanel
  .querySelector("[data-agent-apply]")!
  .addEventListener("click", () => {
    if (!promptAgentResult) return;
    const node = nodes.find((item) => item.id === selection.selectedId);
    if (
      !node ||
      !["image", "video"].includes(node.kind) ||
      node.role === "result"
    ) {
      showToast("请先选择可编辑的生成卡片", "warning");
      return;
    }
    node.body = promptAgentResult.finalPrompt;
    node.originalPrompt = promptAgentResult.finalPrompt;
    updateEditor();
    scheduleSave();
    draw();
    showToast("提示词已写入选中卡片", "success");
    dispersePromptAgent();
  });
promptAgentPanel
  .querySelector("[data-agent-undo]")!
  .addEventListener("click", () => {
    if (!promptAgentUndo) return;
    promptAgentUndo();
    promptAgentUndo = null;
    promptAgentPanel.querySelector<HTMLButtonElement>(
      "[data-agent-undo]",
    )!.hidden = true;
    promptAgentPanel.querySelector<HTMLOutputElement>(
      ".agent-status",
    )!.textContent = "已撤销刚才的画布操作";
  });
promptAgentPanel
  .querySelector("[data-agent-locate]")!
  .addEventListener("click", () => {
    const node = nodes.find((item) => item.id === promptAgentAppliedNodeId);
    if (!node) return;
    selection.selectedId = node.id;
    camera.x = -(node.x + node.width / 2) * camera.zoom;
    camera.y = -(node.y + node.height / 2) * camera.zoom;
    draw();
    closePromptAgent();
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
    positionPromptAgentRibbons();
  }
});
document.querySelector("#dock-clear")!.addEventListener("click", async () => {
  if (!nodes.length || !currentProjectId) return;
  if (!window.confirm("确定清除图片、视频和生成节点吗？标签将保留。")) return;
  const cancelJobs = window.confirm(
    "是否同时取消当前项目中排队和生成中的任务？\n\n确定：清除并取消任务\n取消：只清除画布内容，任务继续并保存到资产库",
  );
  if (cancelJobs) {
    try {
      const canceled = await cancelActiveProjectJobs(currentProjectId);
      showToast(
        canceled
          ? `已取消 ${canceled} 个未完成任务`
          : "当前没有未完成任务",
        "success",
      );
    } catch (error) {
      showToast(
        "部分任务取消失败",
        "error",
        error instanceof Error ? error.message : "请稍后重试",
      );
    }
  }
  canvasSaveBlocked = true;
  window.clearTimeout(saveTimer);
  canvasSaveQueued = false;
  canvasSaveAbort?.abort();
  await canvasSavePromise?.catch(() => {});
  const requestedVersion = canvasServerVersion + 1;
  let result: Awaited<ReturnType<typeof clearCanvasDocument>>;
  try {
    result = await clearCanvasDocument(currentProjectId, requestedVersion);
  } catch (error) {
    showToast(
      error instanceof Error
        ? error.message
        : "清除画布失败，请重新载入后再试",
      "error",
    );
    await loadCanvas();
    return;
  }
  canvasServerVersion = result.version;
  canvasServerUpdatedAt = result.updatedAt || canvasServerUpdatedAt;
  nodes.splice(0, nodes.length, ...result.nodes);
  links.splice(0, links.length, ...normalizeCanvasLinks(result.links));
  if (result.camera) Object.assign(camera, result.camera);
  canvasBaseline = captureCanvasSnapshot(
    canvasServerVersion,
    canvasServerUpdatedAt,
  );
  selection.selectedId = 0;
  resetCanvasHistory(false);
  updateEditor();
  setSaveState("saved", "已自动保存");
  canvasSaveBlocked = false;
  draw();
  showToast(`已清除画布内容，保留 ${nodes.length} 个标签`, "success");
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
    imageNodeAssetTargetId = null;
  },
);
function closeMobileWorkspaceMenu() {
  workspacePanelController.closeMobileMenu();
}
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
    if (!libraryAssets.length)
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
let imageNodeAssetTargetId: number | null = null;
let draggingAsset: {
  url: string;
  name: string;
  kind: "image" | "video";
} | null = null;
let libraryAssets: LibraryAsset[] = [];
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
let libraryAudio: HTMLAudioElement | null = null,
  libraryAudioAssetId = "";
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
function visibleLibraryAssets() {
  return filterAssets(libraryAssets, {
    query: assetSearch.value,
    scope: assetProjectFilter.value,
    type: imageNodeAssetTargetId ? "image" : assetTypeFilter.value,
    sort: assetSort.value,
    currentProjectId,
  });
}
function playLibraryAudio(asset: LibraryAsset) {
  if (libraryAudio && libraryAudioAssetId === asset.id) {
    if (libraryAudio.paused) void libraryAudio.play();
    else libraryAudio.pause();
    return;
  }
  libraryAudio?.pause();
  libraryAudio = new Audio(asset.url);
  libraryAudioAssetId = asset.id;
  libraryAudio.onended = () => {
    libraryAudioAssetId = "";
    renderAssets();
  };
  void libraryAudio
    .play()
    .then(renderAssets)
    .catch(() => showToast("音频预览失败", "error"));
}
function assetForRenderedItem(item: HTMLElement) {
  return libraryAssets.find((asset) => asset.id === item.dataset.assetId);
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
  getAssets: () => libraryAssets,
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
  onAudio: playLibraryAudio,
  onPickImage: (asset) => {
    const targetId = imageNodeAssetTargetId;
    imageNodeAssetTargetId = null;
    if (targetId) attachAssetToImageNode(targetId, asset);
    closeWorkspacePanels();
  },
  onContext: openAssetContextAt,
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
  imageNodeAssetTargetId = null;
  assetUploadController.openForNode(nodeId);
}
async function beginImageNodeLibrary(nodeId: number) {
  if (!imageNodeAllowsSourceChange(nodeId)) return;
  openWorkspacePanel("#assets-panel", "#open-assets");
  imageNodeAssetTargetId = nodeId;
  assetTypeFilter.value = "image";
  assetProjectFilter.value = "current";
  await loadAssets();
  renderAssets();
}
[assetSearch, assetProjectFilter, assetTypeFilter, assetSort].forEach(
  (control) =>
    control.addEventListener("input", () => {
      assetLibraryView.resetPage();
      renderAssets();
    }),
);
document
  .querySelectorAll<HTMLButtonElement>("[data-asset-view]")
  .forEach((button) =>
    button.addEventListener("click", () => {
      assetLibraryView.setView(
        button.dataset.assetView as "grid" | "list",
      );
      document
        .querySelectorAll("[data-asset-view]")
        .forEach((item) => item.classList.toggle("active", item === button));
      renderAssets();
    }),
  );
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
  if (canvasLoadedProjectId === currentProjectId) await saveCanvas();
  closeComicStudio();
  canvasSaveBlocked = true;
  canvasLoadedProjectId = "";
  canvasBaseline = null;
  canvasServerVersion = 0;
  canvasServerUpdatedAt = "";
  canvasNodeIdBlockEnd = 0;
  currentProjectId = projectId;
  localStorage.setItem("flow-project-id", projectId);
  resetComicConversationState(true);
  comicLinkedLabelId = 0;
  await Promise.all([loadCanvas(), loadAssets()]);
  closeWorkspacePanels();
}
async function loadAssets(render = true) {
  try {
    libraryAssets = await fetchAssets();
    if (render) renderAssets();
  } catch {
    /* 面板保留现有资产，等待下次同步 */
  }
}
function renderAssets() {
  const assets = visibleLibraryAssets();
  assetLibraryView.render(assets, {
    picking: Boolean(imageNodeAssetTargetId),
    playingAudioId:
      libraryAudio && !libraryAudio.paused ? libraryAudioAssetId : "",
  });
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
  if (!node.mediaUrl) return;
  try {
    const blob = await fetchAssetBlob(node.mediaUrl);
    const mime = blob.type.split(";")[0].toLowerCase();
    const extension =
      (
        {
          "image/png": "png",
          "image/jpeg": "jpg",
          "image/webp": "webp",
          "image/gif": "gif",
          "image/avif": "avif",
          "image/svg+xml": "svg",
        } as Record<string, string>
      )[mime] ?? "png";
    const title =
      (node.title || "图片").trim().replace(/[\\/:*?"<>|]/g, "-") || "图片";
    const filename = /\.[a-z0-9]{2,5}$/i.test(title)
      ? title
      : `${title}.${extension}`;
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch (error) {
    showToast(
      "图片下载失败",
      "error",
      error instanceof Error ? error.message : "请稍后重试",
    );
  }
}
document.addEventListener("dragover", (event) => {
  event.preventDefault();
  if (event.dataTransfer)
    event.dataTransfer.dropEffect = draggingAsset ? "copy" : "none";
});
document.addEventListener("drop", (event) => {
  event.preventDefault();
  event.stopPropagation();
  if (!draggingAsset) return;
  const asset = draggingAsset;
  draggingAsset = null;
  closeWorkspacePanels();
  addMediaNode(
    asset.url,
    asset.name,
    world({ x: event.clientX, y: event.clientY }),
    asset.kind,
  );
});
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
window.addEventListener("keydown", (event) => {
  const shortcutTarget = event.target as HTMLElement | null,
    isEditing = Boolean(
      shortcutTarget?.matches(
        'input, textarea, select, [contenteditable="true"]',
      ),
    );
  if (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !isEditing &&
    event.key.toLowerCase() === "z"
  ) {
    event.preventDefault();
    if (event.shiftKey) void redoCanvas();
    else void undoCanvas();
    return;
  }
  if (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !isEditing &&
    event.key.toLowerCase() === "y"
  ) {
    event.preventDefault();
    void redoCanvas();
    return;
  }
  if (event.key === "Escape" && quickNodeMenu.classList.contains("open")) {
    closeQuickNodeMenu();
    return;
  }
  if (event.key === "Escape" && nodeInfoModal.classList.contains("open")) {
    closeNodeInfo();
    return;
  }
  if (event.key === "Escape" && assetPreviewController.isOpen) {
    assetPreviewController.close();
    return;
  }
  if (event.key !== "Delete" && event.key !== "Backspace") return;
  const target = event.target as HTMLElement | null;
  if (target?.matches('input, textarea, select, [contenteditable="true"]'))
    return;
  event.preventDefault();
  deleteSelectedNode();
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
    lastUserActivity = Date.now();
    scheduleIdleLogout();
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

const idleLogoutMs = 30 * 60 * 1000;
let lastUserActivity = Date.now(),
  activityHeartbeatDue = false,
  idleLogoutTimer = 0;
function scheduleIdleLogout() {
  window.clearTimeout(idleLogoutTimer);
  if (!authUser) return;
  const remaining = Math.max(0, idleLogoutMs - (Date.now() - lastUserActivity));
  idleLogoutTimer = window.setTimeout(
    () => void logoutToHome("长时间未操作，已安全退出登录"),
    remaining,
  );
}
function recordUserActivity() {
  lastUserActivity = Date.now();
  activityHeartbeatDue = true;
  scheduleIdleLogout();
}
for (const eventName of [
  "pointerdown",
  "keydown",
  "wheel",
  "touchstart",
] as const)
  window.addEventListener(eventName, recordUserActivity, { passive: true });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !authUser) return;
  if (Date.now() - lastUserActivity >= idleLogoutMs)
    void logoutToHome("长时间未操作，已安全退出登录");
  else scheduleIdleLogout();
});
window.setInterval(async () => {
  if (!authUser || !activityHeartbeatDue) return;
  activityHeartbeatDue = false;
  const response = await apiFetch("/api/auth/activity", { method: "POST" }).catch(
    () => null,
  );
  if (response?.status === 401) void logoutToHome("登录状态已过期，请重新登录");
}, 60_000);
