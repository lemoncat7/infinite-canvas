import { PromptAgentApplicationController } from "../nodes/prompt-agent-application";
import type { FlowLink, FlowNode, NodeKind, Point } from "../nodes/node-types";
import { PromptAgentAnimationController } from "./prompt-agent-animation";
import { PromptAgentContextController } from "./prompt-agent-context";
import { PromptAgentControls } from "./prompt-agent-controls";
import { PromptAgentLifecycleController } from "./prompt-agent-lifecycle-controller";
import { PromptAgentRequestController } from "./prompt-agent-request-controller";
import { createPromptAgentShell } from "./prompt-agent-shell";

type Tone = "success" | "warning" | "error";

export class PromptAgentFeature {
  readonly panel: HTMLElement;
  readonly controls: PromptAgentControls;
  readonly selectedIds = new Set<number>();
  readonly application: PromptAgentApplicationController;
  selecting = false;
  private readonly context: PromptAgentContextController;
  private readonly animation: PromptAgentAnimationController;
  private readonly lifecycle: PromptAgentLifecycleController;
  private requests: PromptAgentRequestController | null = null;

  constructor(private readonly options: {
    nodes: FlowNode[];
    links: FlowLink[];
    nodeLayer: HTMLElement;
    camera: { x: number; y: number; zoom: number };
    getSelectedId: () => number;
    setSelectedId: (id: number) => void;
    worldCenter: () => Point;
    addNode: (kind: NodeKind, position: Point, quiet?: boolean) => void;
    onComic: () => void;
    updateEditor: () => void;
    persist: () => void;
    draw: () => void;
    runWorkflow: () => void;
    loadVoices: (providerId: string) => void;
    decodePrompt: (value: string) => string;
    toast: (message: string, tone: Tone) => void;
  }) {
    const trigger = document.querySelector<HTMLButtonElement>("#prompt-agent-trigger")!;
    this.panel = createPromptAgentShell().panel;
    this.controls = new PromptAgentControls({
      panel: this.panel,
      onComic: options.onComic,
      onModeChanged: (mode) => {
        this.selecting = mode === "create" && this.panel.classList.contains("open");
        if (mode !== "create") {
          this.selectedIds.clear();
          this.renderContext(false);
        }
        options.draw();
      },
      isBusy: () => Boolean(this.requests?.busy),
    });
    this.context = new PromptAgentContextController({
      panel: this.panel,
      selectedIds: this.selectedIds,
      getNodes: () => options.nodes,
      getLinks: () => options.links,
      getPrimarySelectedId: options.getSelectedId,
      onChanged: options.draw,
    });
    this.animation = new PromptAgentAnimationController({
      trigger,
      panel: this.panel,
      isBusy: () => Boolean(this.requests?.busy),
      onBusy: () => options.toast("提示词生成中，请等待完成", "warning"),
      onClose: () => this.close(),
      onCancel: () => this.lifecycle.cancelRequest(),
      onOpen: () => {
        this.selectedIds.clear();
        this.renderContext(false);
        this.selecting = true;
        options.draw();
      },
    });
    this.lifecycle = new PromptAgentLifecycleController({
      panel: this.panel,
      trigger,
      cancelFormation: () => this.animation.cancelFormation(),
      cancelRequest: () => this.requests?.cancel(),
      clearResult: () => this.requests?.clearResult(),
      clearContext: () => this.selectedIds.clear(),
      setSelecting: (value) => { this.selecting = value; },
      draw: options.draw,
      disperseDirect: () => this.animation.disperse(false),
      position: () => this.animation.position(),
    });
    this.application = new PromptAgentApplicationController({
      nodes: options.nodes,
      links: options.links,
      getSources: () => this.selectedNodes(),
      getSelectedId: options.getSelectedId,
      setSelectedId: options.setSelectedId,
      worldCenter: options.worldCenter,
      addNode: options.addNode,
      persist: options.persist,
      draw: options.draw,
      runWorkflow: options.runWorkflow,
      loadVoices: options.loadVoices,
    });
    this.requests = new PromptAgentRequestController({
      panel: this.panel,
      controls: this.controls,
      getNodes: () => options.nodes,
      getSelectedId: options.getSelectedId,
      getContexts: () => this.selectedNodes(),
      applyPlan: (result) => this.application.applyPlan(result),
      applyVoice: (result) => this.application.applyVoice(result),
      playMeteor: (nodeId) => this.playMeteor(nodeId),
      locateNode: (nodeId) => this.locateNode(nodeId),
      updateEditor: options.updateEditor,
      persist: options.persist,
      draw: options.draw,
      decodePrompt: options.decodePrompt,
      disperse: () => this.disperse(),
      showToast: options.toast,
    });
    this.lifecycle.bindWindow();
  }

  selectedNodes() { return this.context.selectedNodes(); }
  renderContext(reset = false) { this.context.render(reset); }
  close() { this.lifecycle.close(); }
  disperse() { this.animation.disperse(true); }

  private playMeteor(nodeId: number) {
    const node = this.options.nodes.find((item) => item.id === nodeId);
    if (!node) return;
    const panel = this.panel.getBoundingClientRect();
    const start = { x: panel.left + panel.width * 0.25, y: panel.top + panel.height * 0.45 };
    const end = {
      x: innerWidth / 2 + this.options.camera.x + (node.x + node.width / 2) * this.options.camera.zoom,
      y: innerHeight / 2 + this.options.camera.y + (node.y + node.height / 2) * this.options.camera.zoom,
    };
    const element = this.options.nodeLayer.querySelector<HTMLElement>(`.flow-node[data-id="${node.id}"]`);
    this.animation.playMeteor(start, end, element);
  }

  private locateNode(nodeId: number) {
    const node = this.options.nodes.find((item) => item.id === nodeId);
    if (!node) return;
    this.options.setSelectedId(node.id);
    this.options.camera.x = -(node.x + node.width / 2) * this.options.camera.zoom;
    this.options.camera.y = -(node.y + node.height / 2) * this.options.camera.zoom;
    this.options.draw();
    this.close();
  }
}
