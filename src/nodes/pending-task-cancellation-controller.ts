import type { FlowLink, FlowNode } from "./node-types";
import { apiFetch } from "../services/api";

type UserCredits = { credits?: number; reservedCredits?: number };
type ToastTone = "success" | "warning" | "error" | "info";

export class PendingTaskCancellationController<TUser extends UserCredits> {
  constructor(
    private readonly deps: {
      nodes: FlowNode[];
      links: FlowLink[];
      projectId: () => string;
      ask: (options: {
        title: string;
        description: string;
        confirm: string;
      }) => Promise<boolean>;
      cancelPoll: (jobId: string) => void;
      getUser: () => TUser | null;
      setUser: (user: TUser) => void;
      renderUser: () => void;
      refreshModels: () => void;
      save: () => void;
      update: () => void;
      draw: () => void;
      toast: (message: string, tone: ToastTone, detail?: string) => void;
    },
  ) {}

  async cancel() {
    const waiting = this.deps.nodes.filter(
      (node) => node.agentAuto && node.status === "waiting",
    );
    const queued = this.deps.nodes.filter((node) => node.status === "queued");
    const orphanQueued = new Set(
      queued.filter((node) => !node.jobId).map((node) => node.id),
    );
    if (!waiting.length && !queued.length) return;
    const confirmed = await this.deps.ask({
      title: "取消所有等待任务？",
      description: `将取消 ${queued.length} 个排队任务和 ${waiting.length} 个等待上游任务，已经生成中的任务不会受到影响。`,
      confirm: "一键取消",
    });
    if (!confirmed) return;
    try {
      const response = await apiFetch(
        `/api/projects/${this.deps.projectId()}/jobs/cancel-pending`,
        { method: "POST" },
      );
      const result = (await response.json()) as {
        canceled?: number;
        ids?: string[];
        error?: string;
      };
      if (!response.ok) throw new Error(result.error || "取消失败");
      const canceledIds = new Set(result.ids || []);
      waiting.forEach((node) =>
        Object.assign(node, { agentAuto: false, status: "idle", progress: 0 }),
      );
      canceledIds.forEach(this.deps.cancelPoll);
      this.removeCanceledNodes(canceledIds, orphanQueued);
      await this.refreshCredits();
      this.deps.save();
      this.deps.update();
      this.deps.draw();
      this.deps.toast(
        `已取消 ${(result.canceled || 0) + waiting.length + orphanQueued.size} 个等待任务`,
        "success",
      );
    } catch (error) {
      this.deps.toast(
        "取消等待任务失败",
        "error",
        error instanceof Error ? error.message : "请稍后重试",
      );
    }
  }

  private removeCanceledNodes(
    canceledIds: Set<string>,
    orphanQueued: Set<number>,
  ) {
    for (let index = this.deps.nodes.length - 1; index >= 0; index--) {
      const node = this.deps.nodes[index];
      const orphan = orphanQueued.has(node.id);
      if (!orphan && (!node.jobId || !canceledIds.has(node.jobId))) continue;
      if (node.role === "result" || node.title === "图片修改结果" || orphan) {
        const id = node.id;
        this.deps.nodes.splice(index, 1);
        for (let linkIndex = this.deps.links.length - 1; linkIndex >= 0; linkIndex--)
          if (
            this.deps.links[linkIndex].from === id ||
            this.deps.links[linkIndex].to === id
          )
            this.deps.links.splice(linkIndex, 1);
      } else {
        delete node.jobId;
        Object.assign(node, { status: "idle", progress: 0, agentAuto: false });
      }
    }
  }

  private async refreshCredits() {
    try {
      const response = await apiFetch("/api/users/me");
      if (!response.ok) return;
      const previous = availableCredits(this.deps.getUser());
      const user = (await response.json()) as TUser;
      const next = availableCredits(user);
      this.deps.setUser(user);
      this.deps.renderUser();
      if (previous >= 1 !== next >= 1 || previous >= 2 !== next >= 2)
        this.deps.refreshModels();
    } catch {
      // The session activity refresh will synchronize credits later.
    }
  }
}

function availableCredits(user: UserCredits | null) {
  return Math.max(
    0,
    Number(user?.credits ?? 0) - Number(user?.reservedCredits ?? 0),
  );
}
