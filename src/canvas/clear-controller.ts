import { cancelActiveProjectJobs, clearCanvasDocument } from "./clear-client";

type ClearCanvasResult = Awaited<ReturnType<typeof clearCanvasDocument>>;

type CanvasClearControllerOptions = {
  button: HTMLElement;
  getNodeCount: () => number;
  getProjectId: () => string;
  getServerVersion: () => number;
  prepareForClear: () => Promise<void>;
  applyResult: (result: ClearCanvasResult) => void;
  recoverCanvas: () => Promise<unknown>;
  toast: (message: string, tone: "success" | "error", detail?: string) => void;
};

export class CanvasClearController {
  constructor(private readonly options: CanvasClearControllerOptions) {
    options.button.addEventListener("click", () => void this.clear());
  }

  private async clear() {
    const projectId = this.options.getProjectId();
    if (!this.options.getNodeCount() || !projectId) return;
    if (!window.confirm("确定清除图片、视频和生成节点吗？标签将保留。")) return;
    const cancelJobs = window.confirm(
      "是否同时取消当前项目中排队和生成中的任务？\n\n确定：清除并取消任务\n取消：只清除画布内容，任务继续并保存到资产库",
    );
    if (cancelJobs) await this.cancelJobs(projectId);
    await this.options.prepareForClear();
    try {
      const result = await clearCanvasDocument(projectId, this.options.getServerVersion() + 1);
      this.options.applyResult(result);
    } catch (error) {
      this.options.toast(
        error instanceof Error ? error.message : "清除画布失败，请重新载入后再试",
        "error",
      );
      await this.options.recoverCanvas();
    }
  }

  private async cancelJobs(projectId: string) {
    try {
      const canceled = await cancelActiveProjectJobs(projectId);
      this.options.toast(canceled ? `已取消 ${canceled} 个未完成任务` : "当前没有未完成任务", "success");
    } catch (error) {
      this.options.toast(
        "部分任务取消失败",
        "error",
        error instanceof Error ? error.message : "请稍后重试",
      );
    }
  }
}
