import type { RuntimeFoundation } from "../app/runtime-foundation";
import type { CanvasPersistenceRuntimeFeature } from "../canvas/canvas-persistence-runtime-feature";
import type { CanvasRenderingRuntimeFeature } from "../canvas/canvas-rendering-runtime-feature";
import type { CanvasNodeRuntimeFeature } from "../nodes/canvas-node-runtime-feature";
import { decodePromptClipboardText } from "../nodes/prompt-text";
import type { CanvasGenerationRuntime } from "../services/canvas-generation-composition";
import type { TtsFeature } from "../services/tts-feature";
import type { AuthUser } from "./user-menu-controller";
import { CanvasCreationSuiteFeature } from "./canvas-creation-suite-feature";
import type { CanvasGuideMessage } from "./canvas-guide-controller";
import type { CanvasTaskFeature } from "./canvas-task-feature";
import { WorkspaceAssetsRuntimeFeature } from "./workspace-assets-runtime-feature";

type Tone = "success" | "warning" | "error" | "info";

export class CanvasWorkspaceContentRuntime {
  readonly creation: CanvasCreationSuiteFeature;
  readonly assets: WorkspaceAssetsRuntimeFeature;

  constructor(options: {
    foundation: RuntimeFoundation;
    rendering: CanvasRenderingRuntimeFeature;
    nodeRuntime: CanvasNodeRuntimeFeature;
    persistence: CanvasPersistenceRuntimeFeature;
    generation: CanvasGenerationRuntime;
    tts: TtsFeature;
    tasks: CanvasTaskFeature<AuthUser>;
    user: () => AuthUser | null;
    ensureProject: () => Promise<boolean>;
    invalidateShowcase: () => void;
    isMultiSelect: () => boolean;
    exitMultiSelect: () => void;
    resetMarqueeGesture: () => void;
    imageCache: { delete: (key: string) => boolean };
    updateEditor: () => void;
    draw: (syncDom?: boolean) => void;
    save: (recordHistory?: boolean) => void;
    showGuide: (message: CanvasGuideMessage) => void;
    hideGuide: (key?: string) => void;
    clientLog: (event: string, details?: unknown) => void;
    closeTopbarMenus: (opening?: boolean) => void;
    registerWorkspaceMenu: (close: () => void) => void;
    toast: (message: string, tone: Tone, detail?: string) => void;
  }) {
    const { foundation } = options;
    const { nodes, links, camera, selection, nodeIds } = foundation;
    const { nodeLayer } = foundation.dom;
    const center = () => options.rendering.world({ x: innerWidth / 2, y: innerHeight / 2 });
    const addNode = (kind: Parameters<CanvasNodeRuntimeFeature["add"]>[0], position?: Parameters<CanvasNodeRuntimeFeature["add"]>[1]) =>
      options.nodeRuntime.add(kind, position);
    this.creation = new CanvasCreationSuiteFeature({
      prompt: {
        nodes,
        links,
        nodeLayer,
        camera,
        getSelectedId: () => selection.selectedId,
        setSelectedId: (id) => { selection.selectedId = id; },
        worldCenter: center,
        addNode,
        updateEditor: options.updateEditor,
        persist: options.save,
        draw: options.draw,
        runWorkflow: () => options.generation.run(),
        loadVoices: (providerId) => { void options.tts.loadVoices(providerId); },
        decodePrompt: decodePromptClipboardText,
        toast: options.toast,
        showGuide: options.showGuide,
        hideGuide: options.hideGuide,
      },
      comic: {
        nodes,
        getProjectId: () => foundation.projectId,
        getUserId: () => options.user()?.id,
        hasAuthenticatedContext: () => Boolean(options.user() && foundation.projectId),
        ensureProject: options.ensureProject,
        isMultiSelect: options.isMultiSelect,
        exitMultiSelect: options.exitMultiSelect,
        resetMarqueeGesture: options.resetMarqueeGesture,
        createLabel: () => {
          const viewportCenter = center();
          const rightEdge = nodes.length
            ? Math.max(...nodes.map((node) => node.x + node.width))
            : viewportCenter.x - 220;
          options.nodeRuntime.add("prompt", {
            x: rightEdge + 180,
            y: viewportCenter.y - 280,
          });
          return nodes.find((node) => node.id === selection.selectedId);
        },
        persistCanvas: options.save,
        draw: options.draw,
        startEmptyImages: () => options.tasks.startAllEmpty(),
        showGuide: options.showGuide,
        hideGuide: options.hideGuide,
        clientLog: options.clientLog,
        toast: options.toast,
      },
    });
    this.assets = new WorkspaceAssetsRuntimeFeature({
      nodes,
      getProjectId: () => foundation.projectId,
      setProjectId: (id) => { foundation.projectId = id; },
      getLoadedProjectId: () => options.persistence.loadedProjectId,
      center,
      addMedia: (url, title, position, kind) =>
        options.nodeRuntime.addMedia(url, title, position, kind),
      selectNode: (id) => { selection.selectedId = id; },
      saveCanvas: options.persistence.save,
      scheduleSave: options.save,
      stopSave: () => options.persistence.stopAndReset(),
      resetNodeLease: () => nodeIds.reset(),
      loadCanvas: () => options.persistence.load(),
      closeComic: () => this.creation.comic.close(),
      resetComic: () => this.creation.comic.reset(true),
      unlinkComicLabel: () => this.creation.comic.unlinkLabel(),
      invalidateShowcase: options.invalidateShowcase,
      deleteCachedImage: (url) => { options.imageCache.delete(url); },
      updateEditor: options.updateEditor,
      draw: options.draw,
      closeTopbarMenus: options.closeTopbarMenus,
      registerWorkspaceMenu: options.registerWorkspaceMenu,
      toast: options.toast,
    });
  }
}
