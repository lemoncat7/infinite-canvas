import { appendRevisionNode, removeResultNode } from "../nodes/generation-node-lifecycle";
import { GenerationSubmitController } from "../nodes/generation-submit-controller";
import type { FlowLink, FlowNode } from "../nodes/node-types";
import type { AuthUser } from "../ui/user-menu-controller";
import { GenerationFinalizer } from "./generation-finalizer";
import type { GenerationJob } from "./generation";

type Tone = "success" | "warning" | "error" | "info";

export class CanvasGenerationFeature {
  private readonly submit: GenerationSubmitController;
  private readonly finalizer: GenerationFinalizer;

  constructor(private readonly options: {
    nodes: FlowNode[];
    links: FlowLink[];
    imageCache: { delete: (key: string) => boolean };
    jobLabel: HTMLElement;
    getSelectedId: () => number;
    setSelectedId: (id: number) => void;
    selectedNode: () => FlowNode | undefined;
    blockedReason: (node: FlowNode) => string;
    normalizePrompt: (value?: string) => string;
    getProjectId: () => string;
    allocateNodeId: () => number | null;
    clearSelection: () => void;
    updateEditor: () => void;
    draw: () => void;
    save: (recordHistory?: boolean) => void;
    focusPrompt: () => void;
    generateTts: (source: FlowNode) => Promise<unknown>;
    pollJob: (node: FlowNode) => void;
    getUser: () => AuthUser | null;
    setUser: (user: AuthUser) => void;
    renderUser: () => void;
    refreshModelMenus: () => void;
    loadAssets: () => Promise<unknown>;
    renderAssets: () => void;
    isAssetPanelOpen: () => boolean;
    runWorkflow: () => void;
    toast: (message: string, tone: Tone, detail?: string) => void;
  }) {
    this.submit = new GenerationSubmitController({
      nodes: options.nodes,
      links: options.links,
      selectedNode: options.selectedNode,
      blockedReason: options.blockedReason,
      normalizePrompt: (value) => options.normalizePrompt(value),
      projectId: options.getProjectId,
      clearSelection: options.clearSelection,
      update: options.updateEditor,
      draw: options.draw,
      save: options.save,
      focusPrompt: options.focusPrompt,
      setJobLabel: (value) => { options.jobLabel.textContent = value; },
      createRevision: (source) => this.createRevision(source),
      removeFailedResult: (node, sourceId) => this.removeFailedResult(node, sourceId),
      generateTts: options.generateTts,
      pollJob: options.pollJob,
      hasAuthenticatedUser: () => Boolean(options.getUser()),
      applyCredits: (creditsAvailable) => {
        const user = options.getUser();
        if (!user) return;
        options.setUser({
          ...user,
          reservedCredits: Math.max(0, Number(user.credits ?? 0) - creditsAvailable),
        });
        options.renderUser();
        options.refreshModelMenus();
      },
      toast: options.toast,
    });
    this.finalizer = new GenerationFinalizer({
      imageCache: options.imageCache,
      jobLabel: options.jobLabel,
      getUser: options.getUser,
      setUser: options.setUser,
      normalizePrompt: options.normalizePrompt,
      removeFailedResult: (node) => this.removeFailedResult(node),
      loadAssets: options.loadAssets,
      isAssetPanelOpen: options.isAssetPanelOpen,
      renderAssets: options.renderAssets,
      renderUser: options.renderUser,
      refreshModelMenus: options.refreshModelMenus,
      updateEditor: options.updateEditor,
      draw: options.draw,
      save: options.save,
      runWorkflow: options.runWorkflow,
      toast: options.toast,
    });
  }

  generate(source?: FlowNode) { return this.submit.generate(source); }
  finalize(node: FlowNode, job: GenerationJob) { return this.finalizer.finalize(node, job); }

  private createRevision(source: FlowNode) {
    const id = this.options.allocateNodeId();
    if (id === null) return null;
    const revision = appendRevisionNode(id, source, this.options.nodes, this.options.links);
    this.options.save();
    this.options.draw();
    return revision;
  }

  private removeFailedResult(node: FlowNode, sourceId = node.sourceNodeId) {
    removeResultNode(node, this.options.nodes, this.options.links);
    if (this.options.getSelectedId() === node.id)
      this.options.setSelectedId(sourceId ?? 0);
  }
}
