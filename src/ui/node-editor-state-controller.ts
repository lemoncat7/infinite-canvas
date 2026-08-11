import type { FlowNode } from "../nodes/node-types";

export class NodeEditorStateController {
  constructor(
    private readonly deps: {
      titleInput: HTMLInputElement;
      promptInput: HTMLTextAreaElement;
      modelInput: HTMLSelectElement;
      generateButton: HTMLButtonElement;
      jobLabel: HTMLElement;
      jobProgress: HTMLElement;
      nodeLayer: HTMLElement;
      selectedNode: () => FlowNode | undefined;
      selectedId: () => number;
      activelyGenerating: (node: FlowNode) => boolean;
      canGenerate: (node: FlowNode) => boolean;
      pixiActive: () => boolean;
      draw: (syncDom?: boolean) => void;
      save: () => void;
      updateTasks: () => void;
    },
  ) {
    this.bindInputs();
  }

  update() {
    const node = this.deps.selectedNode();
    if (!node) {
      this.deps.titleInput.value = "";
      this.deps.promptInput.value = "";
      this.deps.jobLabel.textContent = "画布中没有节点";
      this.deps.jobProgress.style.width = "0%";
      this.deps.titleInput.disabled = true;
      this.deps.promptInput.disabled = true;
      this.deps.modelInput.disabled = true;
      return;
    }
    const locked =
      this.deps.activelyGenerating(node) &&
      !(node.kind === "video" && node.role !== "result");
    this.deps.titleInput.disabled = locked;
    this.deps.promptInput.disabled = locked;
    this.deps.modelInput.disabled = locked;
    this.deps.generateButton.disabled = locked || !this.deps.canGenerate(node);
    if (document.activeElement !== this.deps.titleInput)
      this.deps.titleInput.value = node.title;
    if (document.activeElement !== this.deps.promptInput)
      this.deps.promptInput.value = node.body;
    if (document.activeElement !== this.deps.modelInput)
      this.deps.modelInput.value =
        node.model ??
        (node.kind === "video" ? "agnes-video-v2.0" : "gpt-image-2");
    this.deps.jobLabel.textContent =
      node.status === "succeeded"
        ? "生成完成（模拟结果）"
        : node.status === "running"
          ? `生成中 ${node.progress ?? 0}%`
          : node.status === "queued"
            ? "任务排队中"
            : "准备生成";
    this.deps.jobProgress.style.width = `${node.progress ?? 0}%`;
  }

  updateProgress(node: FlowNode) {
    if (this.deps.pixiActive()) this.deps.draw(false);
    const element = this.deps.nodeLayer.querySelector<HTMLElement>(
      `.flow-node[data-id="${node.id}"]`,
    );
    const workflowWaiting = Boolean(
      node.agentAuto && node.status === "waiting",
    );
    const locked =
      (this.deps.activelyGenerating(node) || workflowWaiting) &&
      !(node.kind === "video" && node.role !== "result");
    if (element) this.renderProgress(element, node, locked, workflowWaiting);
    if (this.deps.selectedId() === node.id) this.update();
    this.deps.updateTasks();
  }

  private renderProgress(
    element: HTMLElement,
    node: FlowNode,
    locked: boolean,
    workflowWaiting: boolean,
  ) {
    element.classList.toggle("generating", locked);
    element.classList.toggle("workflow-waiting", workflowWaiting);
    const progress = element.querySelector<HTMLElement>(".node-progress i");
    const track = element.querySelector<HTMLElement>(".node-progress");
    const indeterminate =
      locked &&
      (workflowWaiting ||
        node.status === "queued" ||
        Number(node.progress ?? 0) <= 0);
    if (progress)
      progress.style.width = indeterminate ? "100%" : `${node.progress ?? 0}%`;
    if (track) {
      track.classList.toggle("visible", locked);
      track.classList.toggle("indeterminate", indeterminate);
    }
    if (node.kind !== "video" || node.role !== "result") return;
    const label = element.querySelector<HTMLElement>(".video-generation-count");
    if (!label) return;
    label.textContent =
      node.status === "queued"
        ? "任务排队中"
        : node.status === "running"
          ? Number(node.progress ?? 0) > 0
            ? `生成中 ${Math.round(node.progress ?? 0)}%`
            : node.model?.startsWith("agnes-")
              ? "云端处理中"
              : "生成中 · 等待进度"
          : label.textContent;
  }

  private bindInputs() {
    this.deps.titleInput.addEventListener("input", () => {
      const node = this.deps.selectedNode();
      if (!node) return;
      node.title = this.deps.titleInput.value;
      this.deps.save();
      this.deps.draw();
    });
    this.deps.promptInput.addEventListener("input", () => {
      const node = this.deps.selectedNode();
      if (!node) return;
      node.body = this.deps.promptInput.value;
      this.deps.save();
      this.deps.draw();
    });
    this.deps.modelInput.addEventListener("change", () => {
      const node = this.deps.selectedNode();
      if (!node) return;
      node.model = this.deps.modelInput.value;
      this.deps.save();
      this.deps.draw();
    });
  }
}
