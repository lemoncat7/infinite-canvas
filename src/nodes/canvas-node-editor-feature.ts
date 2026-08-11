import { PromptNodeController } from "./prompt-node";
import type { FlowNode } from "./node-types";
import {
  canGenerateNode as evaluateCanGenerateNode,
  generationBlockedReason as evaluateGenerationBlockedReason,
} from "./generation-eligibility";
import { NodeEditorStateController } from "../ui/node-editor-state-controller";
import { NodeInfoController } from "../ui/node-info-controller";

export class CanvasNodeEditorFeature {
  private readonly state: NodeEditorStateController;
  private readonly info: NodeInfoController;

  constructor(private readonly options: {
    nodes: FlowNode[];
    promptEditor: PromptNodeController;
    titleInput: HTMLInputElement;
    promptInput: HTMLTextAreaElement;
    modelInput: HTMLSelectElement;
    generateButton: HTMLButtonElement;
    jobLabel: HTMLElement;
    jobProgress: HTMLElement;
    nodeLayer: HTMLElement;
    infoModal: HTMLElement;
    getSelectedId: () => number;
    getAvailableCredits: () => number;
    hasConnectedVoice: (node: FlowNode) => boolean;
    activelyGenerating: (node: FlowNode | undefined) => boolean;
    pixiActive: () => boolean;
    setEditingState: () => void;
    draw: () => void;
    save: () => void;
    updateTasks: () => void;
  }) {
    this.info = new NodeInfoController(options.infoModal, options.save);
    this.state = new NodeEditorStateController({
      titleInput: options.titleInput,
      promptInput: options.promptInput,
      modelInput: options.modelInput,
      generateButton: options.generateButton,
      jobLabel: options.jobLabel,
      jobProgress: options.jobProgress,
      nodeLayer: options.nodeLayer,
      selectedNode: () => this.selected(),
      selectedId: options.getSelectedId,
      activelyGenerating: options.activelyGenerating,
      canGenerate: (node) => this.canGenerate(node),
      pixiActive: options.pixiActive,
      draw: options.draw,
      save: options.save,
      updateTasks: options.updateTasks,
    });
  }

  selected() {
    const selectedId = this.options.getSelectedId();
    return this.options.nodes.find((node) => node.id === selectedId);
  }

  canGenerate(node: FlowNode) {
    return evaluateCanGenerateNode(node, this.eligibilityContext(node));
  }

  blockedReason(node: FlowNode) {
    return evaluateGenerationBlockedReason(node, this.eligibilityContext(node));
  }

  update() { this.state.update(); }
  updateProgress(node: FlowNode) { this.state.updateProgress(node); }
  openInfo(node: FlowNode) { this.info.open(node); }
  closeInfo() { this.info.close(); }

  beginTextEdit(node: FlowNode, element: HTMLElement) {
    this.options.promptEditor.beginEdit(node, element, {
      onInput: this.options.setEditingState,
      onFinish: () => {
        this.options.save();
        this.update();
        this.options.draw();
      },
    });
  }

  private eligibilityContext(node: FlowNode) {
    return {
      availableCredits: this.options.getAvailableCredits(),
      hasConnectedVoice: this.options.hasConnectedVoice(node),
    };
  }
}
