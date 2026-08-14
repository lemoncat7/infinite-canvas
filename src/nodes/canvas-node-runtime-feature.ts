import type { CanvasGuideMessage } from "../ui/canvas-guide-controller";
import { CanvasNodeEditorFeature } from "./canvas-node-editor-feature";
import { CanvasNodeLifecycleFeature } from "./canvas-node-lifecycle-feature";
import type { FlowLink, FlowNode, GenerationCapabilities, NodeKind, Point } from "./node-types";
import type { PromptNodeController } from "./prompt-node";

export class CanvasNodeRuntimeFeature {
  readonly lifecycle: CanvasNodeLifecycleFeature;
  readonly editor: CanvasNodeEditorFeature;

  constructor(options: {
    nodes: FlowNode[];
    links: FlowLink[];
    promptEditor: PromptNodeController;
    titleInput: HTMLInputElement;
    promptInput: HTMLTextAreaElement;
    modelInput: HTMLSelectElement;
    generateButton: HTMLButtonElement;
    jobLabel: HTMLElement;
    jobProgress: HTMLElement;
    nodeLayer: HTMLElement;
    infoModal: HTMLElement;
    allocateId: () => number | null;
    capabilities: () => GenerationCapabilities;
    center: () => Point;
    selectedId: () => number;
    select: (id: number) => void;
    batchIds: Set<number>;
    availableCredits: () => number;
    hasConnectedVoice: (node: FlowNode) => boolean;
    pixiActive: () => boolean;
    updateEditor: () => void;
    setEditingState: () => void;
    save: () => void;
    draw: () => void;
    updateTasks: () => void;
    cascadeIds: (seed: Set<number>) => Set<number>;
    confirmDelete: (input: {
      title: string;
      description: string;
      confirm: string;
      danger: boolean;
    }) => Promise<boolean>;
    notify: (message: string, tone: "warning" | "success") => void;
    guide: (message: CanvasGuideMessage) => void;
    hideGuide: (key: string) => void;
    undo: () => void | Promise<unknown>;
  }) {
    this.lifecycle = new CanvasNodeLifecycleFeature({
      nodes: options.nodes,
      links: options.links,
      allocateId: options.allocateId,
      capabilities: options.capabilities,
      center: options.center,
      selectedId: options.selectedId,
      select: options.select,
      batchIds: options.batchIds,
      updateEditor: options.updateEditor,
      save: options.save,
      draw: options.draw,
      cascadeIds: options.cascadeIds,
      confirmDelete: options.confirmDelete,
      notify: options.notify,
      guide: options.guide,
      hideGuide: options.hideGuide,
      undo: options.undo,
    });
    this.editor = new CanvasNodeEditorFeature({
      nodes: options.nodes,
      promptEditor: options.promptEditor,
      titleInput: options.titleInput,
      promptInput: options.promptInput,
      modelInput: options.modelInput,
      generateButton: options.generateButton,
      jobLabel: options.jobLabel,
      jobProgress: options.jobProgress,
      nodeLayer: options.nodeLayer,
      infoModal: options.infoModal,
      getSelectedId: options.selectedId,
      getAvailableCredits: options.availableCredits,
      hasConnectedVoice: options.hasConnectedVoice,
      activelyGenerating: (node) => this.lifecycle.isActive(node),
      pixiActive: options.pixiActive,
      setEditingState: options.setEditingState,
      draw: options.draw,
      save: options.save,
      updateTasks: options.updateTasks,
    });
  }

  add(kind: NodeKind = "image", position?: Point, deferRender = false) {
    return this.lifecycle.add(kind, position, deferRender);
  }
  addMedia(url: string, title: string, position: Point, kind: "image" | "video" = "image") {
    this.lifecycle.addMedia(url, title, position, kind);
  }
  beginTextEdit(node: FlowNode, element: HTMLElement) {
    this.editor.beginTextEdit(node, element);
  }
}
