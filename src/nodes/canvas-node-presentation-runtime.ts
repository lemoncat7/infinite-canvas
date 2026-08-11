import type { RuntimeFoundation } from "../app/runtime-foundation";
import type { CanvasInputFeature } from "../canvas/canvas-input-feature";
import { CanvasMediaFeature } from "../canvas/canvas-media-feature";
import type { CanvasRenderingRuntimeFeature } from "../canvas/canvas-rendering-runtime-feature";
import type { CanvasGenerationRuntime } from "../services/canvas-generation-composition";
import type { TtsFeature } from "../services/tts-feature";
import type { WorkspaceAssetsRuntimeFeature } from "../ui/workspace-assets-runtime-feature";
import { escapeRuntimeHtml } from "../app/runtime-foundation";
import { defaultNodeCopy } from "./node-lifecycle-controller";
import { decodePromptClipboardText, normalizePromptText } from "./prompt-text";
import { CanvasNodeViewFeature } from "./canvas-node-view-feature";
import type { CanvasNodeRuntimeFeature } from "./canvas-node-runtime-feature";

type ViewOptions = ConstructorParameters<typeof CanvasNodeViewFeature>[0];

export class CanvasNodePresentationRuntime {
  readonly views: CanvasNodeViewFeature;
  readonly media: CanvasMediaFeature;

  constructor(options: {
    foundation: RuntimeFoundation;
    input: CanvasInputFeature;
    nodeRuntime: () => CanvasNodeRuntimeFeature;
    rendering: () => CanvasRenderingRuntimeFeature;
    generation: () => CanvasGenerationRuntime;
    assets: () => WorkspaceAssetsRuntimeFeature;
    tts: TtsFeature;
    agent: () => {
      selecting: boolean;
      controls: { mode: string };
      selectedIds: Set<number>;
    };
    getAuthUser: ViewOptions["getAuthUser"];
    getCustomModels: ViewOptions["getCustomModels"];
    getCapabilities: ViewOptions["getCapabilities"];
    getColorTheme: () => "light" | "dark";
    displayModelName: (value?: string) => string;
    updateEditor: () => void;
    draw: (syncDom?: boolean) => void;
    resize: () => void;
    save: (recordHistory?: boolean) => void;
    commitHistory: () => void;
    setEditing: () => void;
    copyPrompt: ViewOptions["copyPrompt"];
    refreshAppearance: () => void;
    toast: ViewOptions["notify"];
  }) {
    const { foundation } = options;
    const { nodes, links, camera, selection, promptEditor, connection } = foundation;
    const { nodeViewport, nodeLayer, promptInput } = foundation.dom;
    const pointer = options.input.domPointer;
    this.views = new CanvasNodeViewFeature({
      viewport: nodeViewport,
      layer: nodeLayer,
      nodes,
      links,
      camera,
      world: (point) => options.rendering().world(point),
      getSelectedId: () => selection.selectedId,
      setSelectedId: (id) => { selection.selectedId = id; },
      getBatchIds: () => selection.batchIds,
      getEditingId: () => promptEditor.editingId,
      getDraggingId: () => pointer.drag?.id ?? 0,
      isMultiSelectMode: () => selection.multiSelectMode,
      getDrag: () => pointer.drag,
      setDrag: (drag) => { pointer.drag = drag; },
      beginResize: (value) => pointer.beginResize(value),
      isReleaseSuppressed: pointer.isReleaseSuppressed,
      isAgentSelecting: () => options.agent().selecting,
      isAgentCreateMode: () => options.agent().controls.mode === "create",
      getAgentIds: () => options.agent().selectedIds,
      getColorTheme: options.getColorTheme,
      getSwap: () => foundation.videoReferenceSwapSelection,
      setSwap: (value) => { foundation.videoReferenceSwapSelection = value; },
      getAuthUser: options.getAuthUser,
      getCustomModels: options.getCustomModels,
      getCapabilities: options.getCapabilities,
      isGenerating: (node) => options.nodeRuntime().lifecycle.isActive(node),
      defaultCopy: defaultNodeCopy,
      getProviders: () => options.tts.catalog.providers,
      getVoices: () => options.tts.catalog.voicesByProvider,
      ensureProviders: () => options.tts.loadProviders(),
      ensureVoices: (providerId) => options.tts.loadVoices(providerId),
      escapeHtml: escapeRuntimeHtml,
      normalizePrompt: normalizePromptText,
      displayModelName: options.displayModelName,
      decodePrompt: (value = "") => decodePromptClipboardText(value),
      canGenerate: (node) => options.nodeRuntime().editor.canGenerate(node),
      updateEditor: options.updateEditor,
      draw: options.draw,
      scheduleSave: options.save,
      commitHistory: options.commitHistory,
      setEditingState: options.setEditing,
      editPrompt: (node, element) => options.nodeRuntime().beginTextEdit(node, element),
      previewMedia: (node) => options.assets().openPreview(
        node.mediaUrl!, node.title, node.kind as "image" | "video",
      ),
      beginConnection: (nodeId, point) => connection.begin(nodeId, "right", point),
      showInfo: (node) => options.nodeRuntime().editor.openInfo(node),
      focusEditor: () => promptInput.focus(),
      generate: (node) => options.generation().generate(node),
      downloadImage: (node) => options.assets().downloadNodeImage(node),
      deleteNode: () => { void options.nodeRuntime().lifecycle.deleteSelected(); },
      confirmClearImage: async () => Boolean(await options.assets().ask({
        title: "清除当前卡片的图片？",
        description: "资产库中的原图不会删除。原提示词、当前描述、模型、图像设置和参考连线都会保留。",
        confirm: "清除图片",
      })),
      removeCachedImage: (url) => this.media.cache.delete(url),
      notifyImageCleared: (message) => options.toast(message, "success"),
      beginImageUpload: (nodeId) => options.assets().beginNodeUpload(nodeId),
      beginImageLibrary: (nodeId) => options.assets().beginNodeLibrary(nodeId),
      previewVoice: (node) => options.tts.preview(node),
      generateTts: (node) => options.tts.generate(node),
      copyPrompt: options.copyPrompt,
      paintImage: (target, url) => this.media.paint(target, url),
      paintVideo: (target, url) => this.media.paint(target, url),
      notify: options.toast,
    });
    this.media = new CanvasMediaFeature({
      mobile: innerWidth <= 780,
      nodes,
      nodeLayer,
      theme: options.getColorTheme,
      suspendRenderer: () => options.rendering().render.suspend(),
      resumeRenderer: () => options.rendering().render.resume(),
      clearNodeStates: () => this.views.clearStates(),
      invalidateNode: (id) => this.views.invalidateState(id),
      resize: options.resize,
      draw: options.draw,
      refreshAppearance: options.refreshAppearance,
    });
  }
}
