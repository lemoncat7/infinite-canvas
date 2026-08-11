import type { FlowNode } from "../nodes/node-types";
import type { AuthUser } from "../ui/user-menu-controller";
import { apiFetch } from "./api";
import type { GenerationJob } from "./generation";

export class GenerationFinalizer {
  constructor(private readonly options: {
    imageCache: { delete: (key: string) => boolean };
    jobLabel: HTMLElement;
    getUser: () => AuthUser | null;
    setUser: (user: AuthUser) => void;
    normalizePrompt: (value?: string) => string;
    removeFailedResult: (node: FlowNode) => void;
    loadAssets: () => Promise<unknown>;
    isAssetPanelOpen: () => boolean;
    renderAssets: () => void;
    renderUser: () => void;
    refreshModelMenus: () => void;
    updateEditor: () => void;
    draw: () => void;
    save: (immediate?: boolean) => void;
    runWorkflow: () => void;
    toast: (message: string, tone: "success" | "error" | "warning", detail?: string) => void;
  }) {}

  finalize = async (node: FlowNode, job: GenerationJob) => {
    if (job.status === "succeeded" && job.result_url)
      this.applySuccess(node, job);
    if (job.status === "failed") this.applyFailure(node, job);
    if (job.status === "canceled") this.applyCancellation(node);
    await this.refreshCredits();
    this.options.updateEditor();
    this.options.draw();
    this.options.save(false);
    this.options.runWorkflow();
  };

  private applySuccess(node: FlowNode, job: GenerationJob) {
    node.mediaUrl = job.result_url;
    try {
      const metadata = JSON.parse(job.result_metadata || "{}");
      if (metadata && typeof metadata === "object") node.videoResult = metadata;
    } catch { /* Older jobs may not have result metadata. */ }
    this.options.imageCache.delete(job.result_url!);
    void this.options.loadAssets().then(() => {
      if (this.options.isAssetPanelOpen()) this.options.renderAssets();
    });
    if (node.kind === "video")
      this.options.toast("视频已生成并加入资产库", "success");
  }

  private applyFailure(node: FlowNode, job: GenerationJob) {
    const message = job.error || "视频生成失败";
    this.options.jobLabel.textContent = `生成失败：${message}`;
    this.options.toast(message, "error");
    if (node.role === "result") this.options.removeFailedResult(node);
  }

  private applyCancellation(node: FlowNode) {
    node.progress = 0;
    if (!node.body.trim())
      node.body = this.options.normalizePrompt(
        node.originalPrompt || node.generationPrompt || "",
      );
    delete node.jobId;
    this.options.jobLabel.textContent = "任务已取消，可重新生成";
    this.options.toast(
      "等待任务已取消",
      "warning",
      "卡片描述和配置已保留，可随时重新生成。",
    );
  }

  private async refreshCredits() {
    try {
      const response = await apiFetch("/api/users/me");
      if (!response.ok) return;
      const current = this.options.getUser();
      const previous = Math.max(
        0,
        Number(current?.credits ?? 0) - Number(current?.reservedCredits ?? 0),
      );
      const nextUser = (await response.json()) as AuthUser;
      const next = Math.max(
        0,
        Number(nextUser.credits ?? 0) - Number(nextUser.reservedCredits ?? 0),
      );
      this.options.setUser(nextUser);
      this.options.renderUser();
      if (previous >= 1 !== next >= 1 || previous >= 2 !== next >= 2)
        this.options.refreshModelMenus();
    } catch { /* The next refresh will synchronize the balance. */ }
  }
}
