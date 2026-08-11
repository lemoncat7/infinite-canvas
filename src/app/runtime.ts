import "../style.css";
import { CanvasPersistenceRuntimeFeature } from "../canvas/canvas-persistence-runtime-feature";
import { CanvasRenderingRuntimeFeature } from "../canvas/canvas-rendering-runtime-feature";
import { createCanvasPersistenceComposition } from "../canvas/canvas-persistence-composition";
import { createCanvasRenderingComposition } from "../canvas/canvas-rendering-composition";
import { CanvasInteractionRuntime } from "../canvas/canvas-interaction-runtime";
import type { GenerationCapabilities } from "../nodes/node-types";
import { CanvasNodeRuntimeFeature } from "../nodes/canvas-node-runtime-feature";
import { createCanvasNodeComposition } from "../nodes/canvas-node-composition";
import { createTtsRuntime, type TtsRuntime } from "../services/tts-composition";
import {
  createCanvasGenerationRuntime,
  type CanvasGenerationRuntime,
} from "../services/canvas-generation-composition";
import { RuntimeDiagnosticsFeature } from "./runtime-diagnostics-feature";
import { CanvasControlsRuntime } from "../ui/canvas-controls-runtime";
import { CanvasWorkspaceContentRuntime } from "../ui/canvas-workspace-content-runtime";
import { CanvasNodePresentationRuntime } from "../nodes/canvas-node-presentation-runtime";
import { createDefaultGenerationCapabilities } from "./state";
import { RuntimeFoundation } from "./runtime-foundation";
import { AccountRuntimeComposition } from "./account-runtime-composition";
import { createWorkspaceShell, type WorkspaceShell } from "./workspace-shell-composition";
import { RuntimeBindings } from "./runtime-bindings";

let renderingRuntime: CanvasRenderingRuntimeFeature;

let generationCapabilities: GenerationCapabilities =
  createDefaultGenerationCapabilities();
let generationRuntime: CanvasGenerationRuntime;
let nodeRuntime: CanvasNodeRuntimeFeature;
const bindings = new RuntimeBindings();
const foundation = new RuntimeFoundation(() =>
  bindings.showToast("正在扩展节点编号空间，请稍后重试", "warning"),
);
let canvasPersistence: CanvasPersistenceRuntimeFeature;
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
  refreshModels: bindings.refreshNodeModels,
  modelName: bindings.modelName,
  updateEditor: bindings.updateEditor,
  draw: bindings.draw,
  save: bindings.scheduleSave,
  showGuide: bindings.showGuide,
  showModeNotice: bindings.showModeNotice,
  toast: bindings.showToast,
});
bindings.interaction = interactionRuntime;
const canvasTasks = interactionRuntime.tasks;
const canvasHistory = interactionRuntime.history;
const canvasInput = interactionRuntime.input;
const ttsFeature: TtsRuntime = createTtsRuntime({
  foundation,
  presentation: () => nodePresentation,
  content: () => contentRuntime,
  updateEditor: bindings.updateEditor,
  draw: bindings.draw,
  save: bindings.scheduleSave,
  toast: bindings.showToast,
});
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
  getCustomModels: () => accountRuntime.account.models,
  getCapabilities: () => generationCapabilities,
  getColorTheme: () => foundation.colorTheme,
  displayModelName: bindings.modelName,
  updateEditor: bindings.updateEditor,
  draw: bindings.draw,
  resize: bindings.resize,
  save: bindings.scheduleSave,
  commitHistory: () => canvasHistory.queue(),
  setEditing: () => canvasPersistence.setEditing(),
  copyPrompt: bindings.copyPrompt,
  refreshAppearance: () => controlsRuntime.refreshAppearance(),
  toast: bindings.showToast,
});
const imageCache = nodePresentation.media.cache;
const accountRuntime: AccountRuntimeComposition = new AccountRuntimeComposition({
  foundation,
  persistence: () => canvasPersistence,
  rendering: () => renderingRuntime,
  content: () => contentRuntime,
  resize: bindings.resize,
  loadCapabilities: bindings.loadCapabilities,
  registerMenu: (menu, close) => interactionRuntime.menus.register(menu, close),
  closeMenus: bindings.closeMenus,
});
bindings.account = accountRuntime;
const authWorkspace = accountRuntime.auth;
authWorkspace.applyRoute();

renderingRuntime = createCanvasRenderingComposition({
  foundation,
  interaction: interactionRuntime,
  presentation: nodePresentation,
  content: () => contentRuntime,
  save: bindings.scheduleSave,
  notify: (message) => bindings.showToast(message, "warning"),
  log: clientLog,
});
bindings.rendering = renderingRuntime;
nodeRuntime = createCanvasNodeComposition({
  foundation,
  rendering: renderingRuntime,
  interaction: interactionRuntime,
  persistence: () => canvasPersistence,
  content: () => contentRuntime,
  account: accountRuntime,
  tts: ttsFeature,
  capabilities: () => generationCapabilities,
  updateEditor: bindings.updateEditor,
  draw: bindings.draw,
  save: bindings.scheduleSave,
  showGuide: bindings.showGuide,
  hideGuide: bindings.hideGuide,
  toast: bindings.showToast,
});
bindings.node = nodeRuntime;

canvasPersistence = createCanvasPersistenceComposition({
  foundation,
  interaction: interactionRuntime,
  presentation: nodePresentation,
  generation: () => generationRuntime,
  account: accountRuntime,
  updateEditor: bindings.updateEditor,
  draw: bindings.draw,
  showGuide: bindings.showGuide,
  hideGuide: bindings.hideGuide,
  toast: bindings.showToast,
});
bindings.persistence = canvasPersistence;

generationRuntime = createCanvasGenerationRuntime({
  foundation,
  nodeRuntime,
  tts: ttsFeature,
  assets: () => contentRuntime.assets,
  imageCache,
  user: () => authWorkspace.user,
  setUser: (user) => authWorkspace.setUser(user),
  renderUser: () => authWorkspace.renderUser(),
  updateEditor: bindings.updateEditor,
  draw: bindings.draw,
  save: bindings.scheduleSave,
  refreshModelMenus: bindings.refreshNodeModels,
  toast: bindings.showToast,
});
controlsRuntime = new CanvasControlsRuntime({
  foundation,
  input: canvasInput,
  rendering: renderingRuntime,
  nodeRuntime,
  presentation: nodePresentation,
  generation: generationRuntime,
  content: () => contentRuntime,
  updateEditor: bindings.updateEditor,
  draw: bindings.draw,
  save: bindings.scheduleSave,
  toast: bindings.showToast,
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
  isMultiSelect: () => foundation.selection.multiSelectMode,
  exitMultiSelect: () => marqueeController.exit(),
  resetMarqueeGesture: () => marqueeController.resetRightGesture(),
  imageCache,
  updateEditor: bindings.updateEditor,
  draw: bindings.draw,
  save: bindings.scheduleSave,
  showGuide: bindings.showGuide,
  hideGuide: bindings.hideGuide,
  clientLog,
  closeTopbarMenus: (opening) => bindings.closeMenus(opening ? "workspace" : undefined),
  registerWorkspaceMenu: (close) => interactionRuntime.menus.register("workspace", close),
  toast: bindings.showToast,
});
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
bindings.workspace = workspaceRuntime;
workspaceRuntime.start(bindings.resize, bindings.updateEditor);
