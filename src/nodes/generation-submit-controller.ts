import type { FlowLink, FlowNode } from "./node-types";
import {
  missingGenerationInputs,
  runGenerationJob,
} from "../services/generation";

type ToastTone = "success" | "warning" | "error" | "info";

export class GenerationSubmitController {
  constructor(
    private readonly deps: {
      nodes: FlowNode[];
      links: FlowLink[];
      selectedNode: () => FlowNode | undefined;
      blockedReason: (node: FlowNode) => string;
      normalizePrompt: (value: string) => string;
      projectId: () => string;
      clearSelection: () => void;
      update: () => void;
      draw: () => void;
      save: () => void;
      focusPrompt: () => void;
      setJobLabel: (value: string) => void;
      createRevision: (source: FlowNode) => FlowNode | null;
      removeFailedResult: (node: FlowNode, sourceId: number) => void;
      generateTts: (source: FlowNode) => Promise<unknown>;
      pollJob: (node: FlowNode) => void;
      applyCredits: (available: number) => void;
      hasAuthenticatedUser: () => boolean;
      toast: (message: string, tone: ToastTone, detail?: string) => void;
    },
  ) {}

  async generate(sourceOverride?: FlowNode) {
    const source = sourceOverride ?? this.deps.selectedNode();
    if (!source) {
      this.deps.toast("请先选择需要生成的卡片", "warning");
      return;
    }
    const blockedReason = this.deps.blockedReason(source);
    if (blockedReason) {
      this.deps.toast(blockedReason, "warning");
      if (
        (source.kind === "image" || source.kind === "video") &&
        !source.body.trim()
      )
        this.deps.focusPrompt();
      return;
    }
    if (source.kind === "tts") {
      this.deps.clearSelection();
      await this.deps.generateTts(source);
      return;
    }
    const wasAgentAuto = Boolean(source.agentAuto);
    const missingInputs = missingGenerationInputs(
      source,
      this.deps.nodes,
      this.deps.links,
    );
    if (missingInputs.length) {
      if (wasAgentAuto) {
        source.status = "waiting";
        source.progress = 0;
      } else {
        this.deps.toast(
          `仍有 ${missingInputs.length} 张上游参考图未生成`,
          "warning",
          "请等待所有已连接的参考图生成完成后再启动此任务。",
        );
      }
      this.refresh(true);
      return;
    }
    this.deps.clearSelection();
    this.deps.setJobLabel("正在提交…");
    source.agentAuto = false;
    if (source.kind === "video" && source.role !== "result") {
      source.status = "idle";
      source.progress = 0;
      delete source.jobId;
    }
    const createsOutput =
      source.kind === "video" ||
      (source.kind === "image" && Boolean(source.mediaUrl));
    const output = createsOutput ? this.deps.createRevision(source) : source;
    if (!output) return;
    output.status = "queued";
    output.progress = 0;
    this.refresh(false);
    const result = await runGenerationJob({
      projectId: this.deps.projectId(),
      source,
      output,
      nodes: this.deps.nodes,
      links: this.deps.links,
      normalizePrompt: this.deps.normalizePrompt,
    });
    if (result.ok) {
      if (
        this.deps.hasAuthenticatedUser() &&
        typeof result.job.creditsAvailable === "number"
      )
        this.deps.applyCredits(result.job.creditsAvailable);
      this.refresh(true);
      this.deps.pollJob(result.node);
      return;
    }
    this.deps.setJobLabel("提交失败，请检查 API");
    this.deps.toast(
      "任务提交失败，请检查接口配置",
      "error",
      result.error instanceof Error ? result.error.message : "未知错误",
    );
    if (result.node?.role === "result")
      this.deps.removeFailedResult(result.node, source.id);
    this.refresh(true);
  }

  private refresh(save: boolean) {
    this.deps.update();
    if (save) this.deps.save();
    this.deps.draw();
  }
}
