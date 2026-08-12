import type { RuntimeFoundation } from "../app/runtime-foundation";
import type { CanvasNodePresentationRuntime } from "../nodes/canvas-node-presentation-runtime";
import type { CanvasNodeRuntimeFeature } from "../nodes/canvas-node-runtime-feature";
import { labelBodyMetrics, labelTextViewport } from "../nodes/label-text-layout";
import type { CanvasGenerationRuntime } from "../services/canvas-generation-composition";
import type { CanvasControlsRuntime } from "../ui/canvas-controls-runtime";
import type { CanvasGuideMessage } from "../ui/canvas-guide-controller";
import { CanvasTaskFeature } from "../ui/canvas-task-feature";
import type { CanvasWorkspaceContentRuntime } from "../ui/canvas-workspace-content-runtime";
import { TopbarMenuCoordinator } from "../ui/topbar-menu-coordinator";
import type { AuthUser } from "../ui/user-menu-controller";
import { CanvasBatchFeature } from "./canvas-batch-feature";
import { CanvasHistoryFeature } from "./canvas-history-feature";
import { CanvasInputFeature } from "./canvas-input-feature";
import type { CanvasPersistenceRuntimeFeature } from "./canvas-persistence-runtime-feature";
import type { CanvasRenderingRuntimeFeature } from "./canvas-rendering-runtime-feature";

type Tone = "success" | "warning" | "error" | "info";
type Menu = "workspace" | "task" | "user" | "notifications" | "presence";

export class CanvasInteractionRuntime {
  readonly menus = new TopbarMenuCoordinator();
  readonly tasks: CanvasTaskFeature<AuthUser>;
  readonly history: CanvasHistoryFeature;
  readonly batch: CanvasBatchFeature;
  readonly input: CanvasInputFeature;

  constructor(options: {
    foundation: RuntimeFoundation;
    nodeRuntime: () => CanvasNodeRuntimeFeature;
    generation: () => CanvasGenerationRuntime;
    rendering: () => CanvasRenderingRuntimeFeature;
    presentation: () => CanvasNodePresentationRuntime;
    persistence: () => CanvasPersistenceRuntimeFeature;
    controls: () => CanvasControlsRuntime;
    content: () => CanvasWorkspaceContentRuntime;
    user: () => AuthUser | null;
    setUser: (user: AuthUser) => void;
    renderUser: () => void;
    refreshModels: () => void;
    modelName: (value?: string) => string;
    updateEditor: () => void;
    previewMedia: (node: import("../nodes/node-types").FlowNode) => void;
    draw: (syncDom?: boolean) => void;
    save: (recordHistory?: boolean) => void;
    showGuide: (message: CanvasGuideMessage) => void;
    showModeNotice: (title: string, detail: string) => void;
    toast: (message: string, tone: Tone, detail?: string) => void;
  }) {
    const { foundation } = options;
    const { nodes, links, camera, selection, promptEditor, interaction, connection, store, nodeIds } = foundation;
    const { canvas, nodeLayer, resetButton } = foundation.dom;
    this.tasks = new CanvasTaskFeature<AuthUser>({
      nodes,
      links,
      resetButton,
      canGenerate: (node) => options.nodeRuntime().editor.canGenerate(node),
      modelName: options.modelName,
      projectId: () => foundation.projectId,
      cancelPoll: (jobId) => options.generation().cancel(jobId),
      getUser: options.user,
      setUser: options.setUser,
      renderUser: options.renderUser,
      refreshModels: options.refreshModels,
      closeOtherMenus: (opening) => this.closeMenus(opening ? "task" : undefined),
      focusNode: (node) => {
        selection.selectedId = node.id;
        camera.x = -(node.x + node.width / 2) * camera.zoom;
        camera.y = -(node.y + node.height / 2) * camera.zoom;
      },
      runWorkflow: () => options.generation().run(),
      ask: async (input) => (await options.content().assets.ask(input)) === true,
      save: options.save,
      updateEditor: options.updateEditor,
      draw: options.draw,
      showGuide: options.showGuide,
      toast: options.toast,
    });
    this.menus.register("task", () => this.tasks.close());
    this.menus.register("presence", () =>
      document.querySelector("#online-status-panel")?.classList.remove("open"),
    );
    this.history = new CanvasHistoryFeature({
      nodes,
      links,
      getProjectId: () => foundation.projectId,
      getNextId: () => nodeIds.nextId,
      setNextId: (value) => { nodeIds.nextId = value; },
      getSelectedId: () => selection.selectedId,
      setSelectedId: (value) => { selection.selectedId = value; },
      clearBatch: () => selection.batchIds.clear(),
      clearPromptEditing: () => { promptEditor.editingId = 0; },
      generationActive: () => options.nodeRuntime().lifecycle.hasActiveGeneration(),
      updateEditor: options.updateEditor,
      draw: options.draw,
      save: () => options.persistence().save(),
      toast: (message) => options.toast(message, "warning"),
      showGuide: options.showGuide,
    });
    this.batch = new CanvasBatchFeature({
      nodes,
      links,
      batchIds: selection.batchIds,
      getSelectedId: () => selection.selectedId,
      clearSelectedId: () => { selection.selectedId = 0; },
      isMultiSelectMode: () => selection.multiSelectMode,
      screen: (point) => options.rendering().screen(point),
      viewportWidth: () => innerWidth,
      generationActive: () => options.nodeRuntime().lifecycle.hasActiveGeneration(),
      enqueue: (ids) => options.generation().enqueue(ids),
      exitMode: () => this.input.marquee.exit(),
      updateEditor: options.updateEditor,
      draw: options.draw,
      save: options.save,
      toast: options.toast,
      confirm: (message) => window.confirm(message),
    });
    this.input = new CanvasInputFeature({
      canvas,
      nodeLayer,
      nodes,
      camera,
      interaction,
      selection,
      marqueeBox: this.batch.marqueeBox,
      batchToolbar: this.batch.toolbar,
      draw: options.draw,
      pan: () => options.rendering().pan(),
      save: options.save,
      setEditing: () => options.persistence().setEditing(),
      updateEditor: options.updateEditor,
      showSelectedDom: () => {
        nodeLayer.classList.remove("dom-interaction-suspended");
        options.presentation().views.showSelectedDom();
      },
      hideSelectedDom: () => {
        nodeLayer.classList.add("dom-interaction-suspended");
        options.presentation().views.hideSelectedDom();
      },
      syncDraggedElements: (ids) =>
        options.presentation().views.syncDraggedElements(ids, nodes),
      refreshBatchSelection: () => this.batch.refresh(),
      clearBatchSelection: () => this.batch.clear(),
      toggleBatchNode: (id) => this.batch.toggle(id),
      refreshCanvasModeHint: () => this.batch.refreshModeHint(),
      showCanvasModeNotice: options.showModeNotice,
      getAgentIds: () => options.content().creation.prompt.selectedIds,
      renderAgentSelection: () => options.content().creation.prompt.renderContext(false),
      warnAgentLimit: () => options.toast("参考素材最多选择 8 个", "warning"),
      hasConnection: () => Boolean(connection.active),
      moveConnection: (event, syncDom) => {
        options.rendering().connection.updatePointer(event.clientX, event.clientY);
        options.rendering().connection.startAutoPan(event.clientX, event.clientY);
        options.draw(syncDom);
      },
      finishConnection: (event) => options.rendering().connection.finish(event),
      cancelConnection: () => {
        connection.cancel();
        options.rendering().connection.stopAutoPan();
      },
      hitNode: (x, y) => options.rendering().connection.hitNode(x, y),
      editPrompt: (node) => {
        const element = nodeLayer.querySelector<HTMLElement>(
          `.flow-node[data-id="${node.id}"]`,
        );
        if (element) {
          options.nodeRuntime().beginTextEdit(node, element);
          options.draw(true);
        }
      },
      editPromptTitle: (node) => {
        const element = nodeLayer.querySelector<HTMLElement>(
          `.flow-node[data-id="${node.id}"]`,
        );
        element?.querySelector<HTMLElement>(".node-label-heading")?.dispatchEvent(
          new MouseEvent("dblclick", { bubbles: true }),
        );
      },
      isPromptTitleHit: (node, x, y) => {
        const point = options.rendering().world({ x, y });
        return point.y >= node.y + 22 && point.y < node.y + 58;
      },
      scrollPrompt: (node, delta) => {
        const direction = Math.sign(delta);
        if (!direction) return;
        const metrics = labelBodyMetrics(node.width, node.height, node.fontScale);
        const viewport = labelTextViewport(
          node.body,
          Math.max(8, Math.floor(metrics.contentWidth / metrics.fontSize)),
          metrics.visibleLines,
          (node.labelScroll ?? 0) + direction * 2,
        );
        node.labelScroll = viewport.scrollLine;
        options.draw(false);
      },
      previewMedia: options.previewMedia,
      moveNode: (id, dx, dy) => store.moveNodeById(id, dx, dy),
      panCamera: (dx, dy) => store.panCamera(dx, dy),
      closeQuickMenu: () => options.controls().closeQuickMenu(),
      screen: (point) => options.rendering().screen(point),
      world: (point) => options.rendering().world(point),
    });
    document.addEventListener("click", () => {
      this.tasks.close();
      this.menus.closeAll();
    });
  }

  closeMenus(except?: Menu) { this.menus.closeAll(except); }
}
