import type { FlowLink, FlowNode } from "../nodes/node-types";
import { PendingTaskCancellationController } from "../nodes/pending-task-cancellation-controller";
import { TaskMonitorController } from "./task-monitor-controller";

type ToastTone = "success" | "warning" | "error" | "info";
type GuideMessage = {
  key: string;
  title: string;
  detail: string;
  tone: "online";
  duration: number;
};

export class CanvasTaskFeature<TUser extends { credits?: number; reservedCredits?: number }> {
  private readonly monitor: TaskMonitorController;
  private readonly cancellation: PendingTaskCancellationController<TUser>;

  constructor(private readonly deps: {
    nodes: FlowNode[];
    links: FlowLink[];
    resetButton: HTMLElement;
    canGenerate: (node: FlowNode) => boolean;
    modelName: (model?: string) => string;
    projectId: () => string;
    cancelPoll: (jobId: string) => void;
    getUser: () => TUser | null;
    setUser: (user: TUser) => void;
    renderUser: () => void;
    refreshModels: () => void;
    closeOtherMenus: (opening: boolean) => void;
    focusNode: (node: FlowNode) => void;
    runWorkflow: () => void;
    ask: (options: {
      title: string;
      description: string;
      confirm: string;
    }) => Promise<boolean>;
    save: () => void;
    updateEditor: () => void;
    draw: () => void;
    showGuide: (message: GuideMessage) => void;
    toast: (message: string, tone: ToastTone, detail?: string) => void;
  }) {
    this.cancellation = new PendingTaskCancellationController<TUser>({
      nodes: deps.nodes,
      links: deps.links,
      projectId: deps.projectId,
      ask: deps.ask,
      cancelPoll: deps.cancelPoll,
      getUser: deps.getUser,
      setUser: deps.setUser,
      renderUser: deps.renderUser,
      refreshModels: deps.refreshModels,
      save: deps.save,
      update: deps.updateEditor,
      draw: deps.draw,
      toast: deps.toast,
    });
    this.monitor = new TaskMonitorController({
      nodes: deps.nodes,
      resetButton: deps.resetButton,
      canGenerate: deps.canGenerate,
      modelName: deps.modelName,
      focusNode: (nodeId) => this.focus(nodeId),
      startAllEmpty: () => this.startAllEmpty(),
      cancelPending: () => void this.cancellation.cancel(),
      closeOtherMenus: deps.closeOtherMenus,
    });
  }

  update() { this.monitor.update(); }
  close() { this.monitor.close(); }

  startAllEmpty() {
    const candidates = this.monitor.emptyImageCandidates();
    if (!candidates.length) {
      this.deps.showGuide({
        key: "empty-images-none",
        title: "没有可启动的空图",
        detail: "已有图片、提示词为空或已经进入任务的节点会被自动跳过。",
        tone: "online",
        duration: 2800,
      });
      return;
    }
    candidates.forEach((node) => {
      node.agentAuto = true;
      node.status = "waiting";
    });
    const ready = candidates.filter(
      (node) => !this.deps.links
        .filter((link) => link.to === node.id)
        .map((link) => this.deps.nodes.find((item) => item.id === link.from))
        .some((upstream) => upstream?.kind === "image" && !upstream.mediaUrl),
    ).length;
    const waiting = candidates.length - ready;
    this.deps.save();
    this.deps.draw();
    this.deps.runWorkflow();
    this.deps.showGuide({
      key: "empty-images-started",
      title: `已启动 ${candidates.length} 个空图任务`,
      detail: `${ready} 个立即进入队列${waiting ? `，${waiting} 个将在上游图片完成后自动继续` : ""}。可在旁边的“任务”中查看进度。`,
      tone: "online",
      duration: 5200,
    });
  }

  private focus(nodeId: number) {
    const node = this.deps.nodes.find((item) => item.id === nodeId);
    if (!node) return;
    this.deps.focusNode(node);
    this.monitor.close();
    this.deps.updateEditor();
    this.deps.draw();
  }
}
