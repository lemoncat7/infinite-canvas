import type { FlowNode, GenerationCapabilities, Point } from "./node-types";
import type { DomNodeDrag } from "./node-interaction-view";
import { createNodeView } from "./node-view-factory";
import {
  bindNodeLabelHeading,
  bindNodePointerInteraction,
  bindNodePorts,
  bindNodeToolbarActions,
} from "./node-interaction-view";
import { bindClearImageAction, bindImageNodePanel } from "./image-node-view";
import { bindVideoNodePanel } from "./video-node-view";
import { bindVoiceNodePanels } from "./voice-node-view";

type CustomNodeModel = { id: string; kind: "image" | "video"; name: string; model: string };

type BoundNodeViewFactoryOptions = {
  nodes: FlowNode[];
  batchIds: Set<number>;
  authUser: () => { credits?: number; reservedCredits?: number } | null;
  customApiModels: () => CustomNodeModel[];
  generationCapabilities: () => GenerationCapabilities;
  getSelectedId: () => number;
  setSelectedId: (id: number) => void;
  isMultiSelectMode: () => boolean;
  getDrag: () => DomNodeDrag | null;
  setDrag: (drag: DomNodeDrag) => void;
  beginResize: (value: { id: number; startX: number; startY: number; width: number; height: number }) => void;
  isReleaseSuppressed: () => boolean;
  isAgentSelecting: () => boolean;
  isAgentCreateMode: () => boolean;
  updateEditor: () => void;
  draw: () => void;
  scheduleSave: () => void;
  setEditingState: () => void;
  editPrompt: (node: FlowNode, element: HTMLElement) => void;
  previewMedia: (node: FlowNode) => void;
  beginConnection: (nodeId: number, point: Point) => void;
  showInfo: (node: FlowNode) => void;
  focusEditor: () => void;
  generate: (node: FlowNode) => void | Promise<void>;
  downloadImage: (node: FlowNode) => void | Promise<void>;
  deleteNode: (node: FlowNode) => void;
  confirmClearImage: () => Promise<boolean>;
  removeCachedImage: (url: string) => void;
  normalizePrompt: (value: string) => string;
  notifyImageCleared: (message: string) => void;
  beginImageUpload: (nodeId: number) => void;
  beginImageLibrary: (nodeId: number) => void | Promise<void>;
  decodePrompt: (value: string) => string;
  previewVoice: (node: FlowNode) => void | Promise<void>;
  generateTts: (node: FlowNode) => void | Promise<void>;
  escapeHtml: (value: string) => string;
  copyPrompt: (value?: string) => void | Promise<void>;
};

export class BoundNodeViewFactory {
  constructor(private readonly options: BoundNodeViewFactoryOptions) {}

  create(node: FlowNode) {
    const liveNode = () => this.options.nodes.find((item) => item.id === node.id);
    const { element, resizeHandle, voicePanel, ttsPanel, audioPanel, videoPanel } = createNodeView({
      node,
      getNode: liveNode,
      authUser: this.options.authUser(),
      customApiModels: this.options.customApiModels(),
      escapeHtml: this.options.escapeHtml,
      copyPrompt: this.options.copyPrompt,
    });
    resizeHandle.addEventListener("pointerdown", (event) => {
      if (node.kind !== "prompt") return;
      event.preventDefault();
      event.stopPropagation();
      this.select(node.id);
      this.options.beginResize({
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
      allNodes: this.options.nodes,
      batchIds: this.options.batchIds,
      isMultiSelectMode: this.options.isMultiSelectMode,
      getDrag: this.options.getDrag,
      setDrag: this.options.setDrag,
      isAgentSelecting: this.options.isAgentSelecting,
      isAgentCreateMode: this.options.isAgentCreateMode,
      isReleaseSuppressed: this.options.isReleaseSuppressed,
      selectNode: (id) => this.select(id),
      clearSelection: () => this.select(0),
      draw: this.options.draw,
      editPrompt: this.options.editPrompt,
      previewMedia: this.options.previewMedia,
    });
    bindNodeLabelHeading({
      element,
      liveNode,
      setEditingState: this.options.setEditingState,
      scheduleSave: this.options.scheduleSave,
      draw: this.options.draw,
    });
    bindNodePorts(element, node.id, (nodeId, point) => {
      this.select(0);
      this.options.beginConnection(nodeId, point);
      this.options.draw();
    });
    bindNodeToolbarActions({
      element,
      liveNode,
      selectNode: (id) => this.select(id),
      showInfo: this.options.showInfo,
      editPrompt: this.options.editPrompt,
      focusEditor: this.options.focusEditor,
      scheduleSave: this.options.scheduleSave,
      draw: this.options.draw,
      generate: this.options.generate,
      beginImageUpload: this.options.beginImageUpload,
      beginImageLibrary: this.options.beginImageLibrary,
      previewMedia: this.options.previewMedia,
      downloadMedia: (current) => {
        if (current.kind === "audio") {
          audioPanel.querySelector<HTMLButtonElement>("[data-audio-download]")!.click();
          return;
        }
        return this.options.downloadImage(current);
      },
      deleteNode: (current) => {
        this.options.setSelectedId(current.id);
        this.options.deleteNode(current);
      },
    });
    bindClearImageAction({
      element,
      allNodes: this.options.nodes,
      confirm: this.options.confirmClearImage,
      removeCachedImage: this.options.removeCachedImage,
      normalizePrompt: this.options.normalizePrompt,
      selectNode: (id) => this.select(id),
      scheduleSave: this.options.scheduleSave,
      draw: this.options.draw,
      notify: this.options.notifyImageCleared,
    });
    bindImageNodePanel({
      element,
      nodeId: node.id,
      liveNode,
      scheduleSave: this.options.scheduleSave,
      setEditingState: this.options.setEditingState,
      draw: this.options.draw,
      generate: this.options.generate,
      selectNode: (id) => this.select(id),
      beginImageUpload: this.options.beginImageUpload,
      beginImageLibrary: this.options.beginImageLibrary,
    });
    bindVideoNodePanel({
      videoPanel,
      liveNode,
      generationCapabilities: this.options.generationCapabilities(),
      decodePromptClipboardText: this.options.decodePrompt,
      scheduleSave: this.options.scheduleSave,
      draw: this.options.draw,
      generate: this.options.generate,
      selectNode: (id) => this.select(id),
    });
    bindVoiceNodePanels({
      element,
      voicePanel,
      ttsPanel,
      audioPanel,
      liveNode,
      scheduleSave: this.options.scheduleSave,
      draw: this.options.draw,
      previewVoice: this.options.previewVoice,
      generateTts: this.options.generateTts,
      selectNode: (id) => this.select(id),
    });
    return element;
  }

  private select(id: number) {
    this.options.setSelectedId(id);
    this.options.updateEditor();
  }
}
