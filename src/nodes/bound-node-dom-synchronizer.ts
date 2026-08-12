import type { FlowLink, FlowNode, NodeKind, TtsProviderOption, TtsVoiceOption } from "./node-types";
import { synchronizeNodeDom } from "./node-dom-synchronizer";
import { syncBasicNodeContent } from "./node-dom-state";
import { syncVoiceTtsAudioPanels } from "./voice-node-sync";
import { syncVideoReferenceView } from "./video-reference-view";
import { syncImageNodePanel } from "./image-node-sync";
import { syncVideoNodePanel } from "./video-node-sync";
import { syncNodeMediaView } from "./node-media-view";
import { renderComposerSubmit, renderNodeToolbar } from "../ui/node-editor";

type Camera = { x: number; y: number; zoom: number };
type Swap = { videoId: number; sourceId: number } | null;

type BoundNodeDomOptions = {
  viewport: HTMLElement;
  layer: HTMLElement;
  nodes: FlowNode[];
  links: FlowLink[];
  camera: Camera;
  getSelectedId: () => number;
  isSelectedDomVisible: () => boolean;
  getBatchIds: () => Set<number>;
  getEditingId: () => number;
  getDraggingId: () => number;
  isAgentSelecting: () => boolean;
  getAgentIds: () => Set<number>;
  getColorTheme: () => string;
  getSwap: () => Swap;
  setSwap: (value: Swap) => void;
  mountedIds: Set<number>;
  detached: Map<number, HTMLElement>;
  states: Map<number, unknown[]>;
  cacheDetached: (id: number, element: HTMLElement) => void;
  createElement: (node: FlowNode) => HTMLElement;
  isGenerating: (node: FlowNode) => boolean;
  defaultNodeCopy: (kind: NodeKind) => string;
  getProviders: () => TtsProviderOption[];
  getVoices: () => Map<string, TtsVoiceOption[]>;
  ensureProviders: () => void | Promise<void>;
  ensureVoices: (providerId: string) => void | Promise<void>;
  escapeHtml: (value: string) => string;
  scheduleSave: () => void;
  commitHistory: () => void;
  draw: () => void;
  paintImage: (target: HTMLCanvasElement, url: string) => void;
  paintVideo: (target: HTMLCanvasElement, url: string) => void;
  normalizePrompt: (value?: string) => string;
  displayModelName: (value?: string) => string;
  decodePrompt: (value?: string) => string;
  canGenerate: (node: FlowNode) => boolean;
  notify: (message: string, type: "success" | "warning" | "error" | "info", detail?: string) => void;
};

export class BoundNodeDomSynchronizer {
  constructor(private readonly options: BoundNodeDomOptions) {}

  sync() {
    const options = this.options;
    synchronizeNodeDom({
      viewport: options.viewport,
      layer: options.layer,
      nodes: options.nodes,
      links: options.links,
      camera: options.camera,
      selectedId: options.getSelectedId(),
      selectedDomVisible: options.isSelectedDomVisible(),
      batchIds: options.getBatchIds(),
      editingId: options.getEditingId(),
      draggingId: options.getDraggingId(),
      agentSelecting: options.isAgentSelecting(),
      agentIds: options.getAgentIds(),
      colorTheme: options.getColorTheme(),
      swap: options.getSwap(),
      mountedIds: options.mountedIds,
      detached: options.detached,
      states: options.states,
      cacheDetached: options.cacheDetached,
      createElement: options.createElement,
      isGenerating: options.isGenerating,
      syncNode: (element, node, flags) => {
        const { locked, workflowWaiting, onscreen } = flags;
        syncBasicNodeContent(element, node, flags.editing, options.defaultNodeCopy);
        syncVoiceTtsAudioPanels({
          element,
          node,
          nodes: options.nodes,
          links: options.links,
          providers: options.getProviders(),
          voicesByProvider: options.getVoices(),
          ensureProviders: options.ensureProviders,
          ensureVoices: options.ensureVoices,
          escapeHtml: options.escapeHtml,
          renderSubmit: renderComposerSubmit,
          locked,
        });
        syncVideoReferenceView({
          element,
          node,
          nodes: options.nodes,
          links: options.links,
          onscreen,
          getSwap: options.getSwap,
          setSwap: options.setSwap,
          escapeHtml: options.escapeHtml,
          notify: options.notify,
          scheduleSave: options.scheduleSave,
          commitHistory: options.commitHistory,
          draw: options.draw,
          paintImage: options.paintImage,
        });
        renderNodeToolbar(element, node, locked);
        syncImageNodePanel({
          element,
          node,
          selected: node.id === options.getSelectedId(),
          locked,
          normalizePrompt: options.normalizePrompt,
          displayModelName: options.displayModelName,
          renderSubmit: renderComposerSubmit,
        });
        syncVideoNodePanel({
          element,
          node,
          nodes: options.nodes,
          links: options.links,
          scheduleSave: options.scheduleSave,
          displayModelName: options.displayModelName,
          decodePrompt: options.decodePrompt,
          canGenerate: options.canGenerate,
          renderSubmit: renderComposerSubmit,
          locked,
        });
        syncNodeMediaView({
          element,
          node,
          onscreen,
          locked,
          workflowWaiting,
          paintImage: options.paintImage,
          paintVideo: options.paintVideo,
        });
      },
    });
  }
}
