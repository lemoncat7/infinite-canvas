import type { CanvasInteractionRuntime } from "../canvas/canvas-interaction-runtime";
import type { CanvasPersistenceRuntimeFeature } from "../canvas/canvas-persistence-runtime-feature";
import type { CanvasRenderingRuntimeFeature } from "../canvas/canvas-rendering-runtime-feature";
import type { CanvasNodeRuntimeFeature } from "../nodes/canvas-node-runtime-feature";
import type { CanvasGuideMessage } from "../ui/canvas-guide-controller";
import type { ToastType } from "../ui/toast-controller";
import type { WorkspaceShell } from "./workspace-shell-composition";
import type { AccountRuntimeComposition } from "./account-runtime-composition";

export class RuntimeBindings {
  account!: AccountRuntimeComposition;
  interaction!: CanvasInteractionRuntime;
  rendering!: CanvasRenderingRuntimeFeature;
  node!: CanvasNodeRuntimeFeature;
  persistence!: CanvasPersistenceRuntimeFeature;
  workspace!: WorkspaceShell;

  draw = (syncDom = true) => this.rendering.render.draw(syncDom);
  paint = () => this.rendering.render.paint();
  resize = () => this.draw();
  updateEditor = () => this.node.editor.update();
  scheduleSave = (recordHistory = true) => this.persistence.schedule(recordHistory);
  showToast = (message: string, type: ToastType = "error", detail = "") =>
    this.account.showToast(message, type, detail);
  copyPrompt = (prompt?: string) => this.account.copyPrompt(prompt);
  hideGuide = (key?: string) => this.account.hideGuide(key);
  showGuide = (message: CanvasGuideMessage) => this.account.showGuide(message);
  showModeNotice = (title: string, detail: string) =>
    this.account.showModeNotice(title, detail);
  refreshNodeModels = () => this.account.refreshNodeModels();
  closeMenus = (except?: "workspace" | "task" | "user" | "notifications" | "presence") =>
    this.interaction.closeMenus(except);
  loadCapabilities = (redraw = false): Promise<void> =>
    this.workspace.loadCapabilities(redraw);
  modelName = (value?: string) => {
    if (!value?.startsWith("custom:")) return value || "";
    return this.account.account.models.find(
      (item) => `custom:${item.id}` === value,
    )?.name || "自定义模型";
  };
}
