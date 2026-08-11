import { CanvasSpatialIndex } from "../canvas/spatial-index";
import { PixiEditorCache } from "../canvas/pixi-editor-cache";
import type { DomNodeDrag } from "./node-interaction-view";
import type {
  FlowLink,
  FlowNode,
  GenerationCapabilities,
  NodeKind,
  Point,
  TtsProviderOption,
  TtsVoiceOption,
} from "./node-types";
import { BoundNodeDomSynchronizer } from "./bound-node-dom-synchronizer";
import { BoundNodeViewFactory } from "./bound-node-view-factory";

type Tone = "success" | "warning" | "error" | "info";
type Swap = { videoId: number; sourceId: number } | null;
type CustomNodeModel = { id: string; kind: "image" | "video"; name: string; model: string };

export class CanvasNodeViewFeature {
  readonly states = new Map<number, unknown[]>();
  readonly mountedIds = new Set<number>();
  readonly spatialIndex = new CanvasSpatialIndex();
  readonly editorCache: PixiEditorCache;
  private readonly factory: BoundNodeViewFactory;
  private readonly synchronizer: BoundNodeDomSynchronizer;

  constructor(options: {
    viewport: HTMLElement;
    layer: HTMLElement;
    nodes: FlowNode[];
    links: FlowLink[];
    camera: { x: number; y: number; zoom: number };
    world: (point: Point) => Point;
    getSelectedId: () => number;
    setSelectedId: (id: number) => void;
    getBatchIds: () => Set<number>;
    getEditingId: () => number;
    getDraggingId: () => number;
    isMultiSelectMode: () => boolean;
    getDrag: () => DomNodeDrag | null;
    setDrag: (drag: DomNodeDrag) => void;
    beginResize: (value: { id: number; startX: number; startY: number; width: number; height: number }) => void;
    isReleaseSuppressed: () => boolean;
    isAgentSelecting: () => boolean;
    isAgentCreateMode: () => boolean;
    getAgentIds: () => Set<number>;
    getColorTheme: () => string;
    getSwap: () => Swap;
    setSwap: (value: Swap) => void;
    getAuthUser: () => { credits?: number; reservedCredits?: number } | null;
    getCustomModels: () => CustomNodeModel[];
    getCapabilities: () => GenerationCapabilities;
    isGenerating: (node: FlowNode) => boolean;
    defaultCopy: (kind: NodeKind) => string;
    getProviders: () => TtsProviderOption[];
    getVoices: () => Map<string, TtsVoiceOption[]>;
    ensureProviders: () => void | Promise<void>;
    ensureVoices: (providerId: string) => void | Promise<void>;
    escapeHtml: (value: string) => string;
    normalizePrompt: (value?: string) => string;
    displayModelName: (value?: string) => string;
    decodePrompt: (value?: string) => string;
    canGenerate: (node: FlowNode) => boolean;
    updateEditor: () => void;
    draw: () => void;
    scheduleSave: () => void;
    commitHistory: () => void;
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
    notifyImageCleared: (message: string) => void;
    beginImageUpload: (nodeId: number) => void;
    beginImageLibrary: (nodeId: number) => void | Promise<void>;
    previewVoice: (node: FlowNode) => void | Promise<void>;
    generateTts: (node: FlowNode) => void | Promise<void>;
    copyPrompt: (value?: string) => void | Promise<void>;
    paintImage: (target: HTMLCanvasElement, url: string) => void;
    paintVideo: (target: HTMLCanvasElement, url: string) => void;
    notify: (message: string, type: Tone, detail?: string) => void;
  }) {
    this.factory = new BoundNodeViewFactory({
      nodes: options.nodes,
      batchIds: options.getBatchIds(),
      authUser: options.getAuthUser,
      customApiModels: options.getCustomModels,
      generationCapabilities: options.getCapabilities,
      getSelectedId: options.getSelectedId,
      setSelectedId: options.setSelectedId,
      isMultiSelectMode: options.isMultiSelectMode,
      getDrag: options.getDrag,
      setDrag: options.setDrag,
      beginResize: options.beginResize,
      isReleaseSuppressed: options.isReleaseSuppressed,
      isAgentSelecting: options.isAgentSelecting,
      isAgentCreateMode: options.isAgentCreateMode,
      updateEditor: options.updateEditor,
      draw: options.draw,
      scheduleSave: options.scheduleSave,
      setEditingState: options.setEditingState,
      editPrompt: options.editPrompt,
      previewMedia: options.previewMedia,
      beginConnection: options.beginConnection,
      showInfo: options.showInfo,
      focusEditor: options.focusEditor,
      generate: options.generate,
      downloadImage: options.downloadImage,
      deleteNode: options.deleteNode,
      confirmClearImage: options.confirmClearImage,
      removeCachedImage: options.removeCachedImage,
      normalizePrompt: (value) => options.normalizePrompt(value),
      notifyImageCleared: options.notifyImageCleared,
      beginImageUpload: options.beginImageUpload,
      beginImageLibrary: options.beginImageLibrary,
      decodePrompt: (value) => options.decodePrompt(value),
      previewVoice: options.previewVoice,
      generateTts: options.generateTts,
      escapeHtml: options.escapeHtml,
      copyPrompt: options.copyPrompt,
    });
    this.editorCache = new PixiEditorCache(
      options.nodes,
      options.camera,
      this.spatialIndex,
      options.world,
      options.getSelectedId,
      (node) => this.factory.create(node),
      (id) => this.states.delete(id),
    );
    this.synchronizer = new BoundNodeDomSynchronizer({
      viewport: options.viewport,
      layer: options.layer,
      nodes: options.nodes,
      links: options.links,
      camera: options.camera,
      getSelectedId: options.getSelectedId,
      getBatchIds: options.getBatchIds,
      getEditingId: options.getEditingId,
      getDraggingId: options.getDraggingId,
      isAgentSelecting: options.isAgentSelecting,
      getAgentIds: options.getAgentIds,
      getColorTheme: options.getColorTheme,
      getSwap: options.getSwap,
      setSwap: options.setSwap,
      mountedIds: this.mountedIds,
      detached: this.editorCache.elements,
      states: this.states,
      cacheDetached: (id, element) => this.editorCache.detach(id, element),
      createElement: (node) => this.factory.create(node),
      isGenerating: options.isGenerating,
      defaultNodeCopy: options.defaultCopy,
      getProviders: options.getProviders,
      getVoices: options.getVoices,
      ensureProviders: options.ensureProviders,
      ensureVoices: options.ensureVoices,
      escapeHtml: options.escapeHtml,
      scheduleSave: options.scheduleSave,
      commitHistory: options.commitHistory,
      draw: options.draw,
      paintImage: options.paintImage,
      paintVideo: options.paintVideo,
      normalizePrompt: options.normalizePrompt,
      displayModelName: options.displayModelName,
      decodePrompt: options.decodePrompt,
      canGenerate: options.canGenerate,
      notify: options.notify,
    });
  }

  create(node: FlowNode) { return this.factory.create(node); }
  sync() { this.synchronizer.sync(); }
  scheduleWarmup() { this.editorCache.scheduleWarmup(); }
  clearEditors() { this.editorCache.clear(); }
  clearStates() { this.states.clear(); }
  invalidateState(id: number) { this.states.delete(id); }
}
