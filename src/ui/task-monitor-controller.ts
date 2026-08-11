import type { FlowNode } from "../nodes/node-types";

type TaskStatus = {
  order: number;
  label: string;
  className: "running" | "queued" | "waiting" | "failed";
};

export class TaskMonitorController {
  readonly button = document.createElement("button");
  readonly panel = document.createElement("section");
  readonly startEmptyButton = document.createElement("button");
  private signature = "";

  constructor(
    private readonly deps: {
      nodes: FlowNode[];
      resetButton: HTMLElement;
      canGenerate: (node: FlowNode) => boolean;
      modelName: (model?: string) => string;
      focusNode: (nodeId: number) => void;
      startAllEmpty: () => void;
      cancelPending: () => void;
      closeOtherMenus: (opening: boolean) => void;
    },
  ) {
    this.mount();
    this.bind();
  }

  update() {
    const tasks = this.deps.nodes
      .map((node) => ({ node, status: this.taskStatus(node) }))
      .filter(
        (item): item is { node: FlowNode; status: TaskStatus } =>
          Boolean(item.status),
      )
      .sort(
        (left, right) =>
          left.status.order - right.status.order ||
          left.node.id - right.node.id,
      );
    const running = tasks.filter(
      (item) => item.status.className === "running",
    ).length;
    const queued = tasks.filter(
      (item) => item.status.className === "queued",
    ).length;
    const waiting = tasks.filter(
      (item) => item.status.className === "waiting",
    ).length;
    this.updateEmptyImages();
    this.updateCancelPending();
    this.button.classList.toggle("active", running + queued > 0);
    this.button.querySelector("b")!.textContent = String(running + queued);
    this.button.querySelector("small")!.textContent =
      `${running ? `生成中 ${running}` : ""}${running && queued ? " · " : ""}${queued ? `排队 ${queued}` : ""}${!running && !queued ? "暂无任务" : ""}`;
    this.panel.querySelector<HTMLElement>("header small")!.textContent =
      `生成中 ${running} · 排队 ${queued} · 等待上游 ${waiting}`;
    this.updateList(tasks);
  }

  emptyImageCandidates() {
    return this.deps.nodes.filter(
      (node) =>
        node.kind === "image" &&
        !node.mediaUrl &&
        node.role !== "result" &&
        this.deps.canGenerate(node) &&
        node.status !== "queued" &&
        node.status !== "running" &&
        node.status !== "waiting" &&
        !node.agentAuto,
    );
  }

  close() {
    this.panel.classList.remove("open");
  }

  private mount() {
    this.button.type = "button";
    this.button.className = "task-monitor-button";
    this.button.setAttribute("aria-label", "项目生成任务");
    this.button.innerHTML =
      "<i></i><span>任务</span><b>0</b><small>暂无任务</small>";
    this.deps.resetButton.parentElement!.insertBefore(
      this.button,
      this.deps.resetButton,
    );
    this.panel.className = "task-monitor-panel";
    this.panel.innerHTML =
      '<header><span><b>项目任务</b><small>当前画布生成状态</small></span><button type="button" aria-label="关闭">×</button></header><div data-task-list></div><footer><button type="button" data-start-empty-mobile disabled>启动空图 · 0</button><button type="button" data-cancel-pending disabled>取消等待任务</button></footer>';
    document.body.append(this.panel);
    this.startEmptyButton.type = "button";
    this.startEmptyButton.className = "start-empty-images-button";
    this.startEmptyButton.setAttribute("aria-label", "一键启动所有空图任务");
    this.startEmptyButton.innerHTML =
      "<span>✦</span><strong>启动空图</strong><b>0</b>";
    this.button.parentElement!.insertBefore(this.startEmptyButton, this.button);
  }

  private bind() {
    this.panel
      .querySelector<HTMLElement>("[data-task-list]")!
      .addEventListener("pointerup", (event) => {
        const target = (event.target as HTMLElement).closest<HTMLElement>(
          "[data-task-node]",
        );
        if (target) this.deps.focusNode(Number(target.dataset.taskNode));
      });
    this.startEmptyButton.addEventListener("click", this.deps.startAllEmpty);
    this.panel
      .querySelector("[data-start-empty-mobile]")!
      .addEventListener("click", () => {
        this.deps.startAllEmpty();
        this.close();
      });
    this.button.addEventListener("click", (event) => {
      event.stopPropagation();
      const opening = !this.panel.classList.contains("open");
      this.deps.closeOtherMenus(opening);
      if (!opening) return;
      const rect = this.button.getBoundingClientRect();
      this.panel.style.top = `${rect.bottom + 8}px`;
      this.panel.style.right = `${Math.max(12, innerWidth - rect.right)}px`;
      this.panel.classList.add("open");
    });
    this.panel
      .querySelector("header button")!
      .addEventListener("click", () => this.close());
    this.panel
      .querySelector("[data-cancel-pending]")!
      .addEventListener("click", this.deps.cancelPending);
    this.panel.addEventListener("click", (event) => event.stopPropagation());
  }

  private taskStatus(node: FlowNode): TaskStatus | null {
    if (node.status === "running")
      return {
        order: 0,
        label: `生成中${Number(node.progress ?? 0) > 0 ? ` ${Math.round(node.progress ?? 0)}%` : ""}`,
        className: "running",
      };
    if (node.status === "queued")
      return { order: 1, label: "排队中", className: "queued" };
    if (node.agentAuto && node.status === "waiting")
      return { order: 2, label: "等待上游", className: "waiting" };
    if (node.status === "failed")
      return { order: 3, label: "生成失败", className: "failed" };
    return null;
  }

  private updateEmptyImages() {
    const count = this.emptyImageCandidates().length;
    const mobile = this.panel.querySelector<HTMLButtonElement>(
      "[data-start-empty-mobile]",
    )!;
    this.startEmptyButton.querySelector("b")!.textContent = String(count);
    this.startEmptyButton.disabled = count === 0;
    this.startEmptyButton.classList.toggle("ready", count > 0);
    this.startEmptyButton.title = count
      ? `将 ${count} 个没有图片的节点加入生成队列`
      : "当前没有可启动的空图节点";
    mobile.disabled = count === 0;
    mobile.textContent = count ? `启动空图 · ${count}` : "暂无可生成空图";
    mobile.classList.toggle("ready", count > 0);
  }

  private updateCancelPending() {
    const count = this.deps.nodes.filter(
      (node) =>
        node.status === "queued" ||
        (node.agentAuto && node.status === "waiting"),
    ).length;
    const button = this.panel.querySelector<HTMLButtonElement>(
      "[data-cancel-pending]",
    )!;
    button.disabled = count === 0;
    button.textContent = count ? `取消等待任务 · ${count}` : "没有等待任务";
  }

  private updateList(tasks: Array<{ node: FlowNode; status: TaskStatus }>) {
    const signature = tasks
      .map(
        ({ node }) =>
          `${node.id}:${node.status}:${node.title}:${node.model}`,
      )
      .join("|");
    if (signature === this.signature) {
      tasks.forEach(({ node, status }) => {
        const label = this.panel.querySelector<HTMLElement>(
          `[data-task-node="${node.id}"] > em`,
        );
        if (label) label.textContent = status.label;
      });
      return;
    }
    this.signature = signature;
    const list = this.panel.querySelector<HTMLElement>("[data-task-list]")!;
    const previousTop = list.scrollTop;
    const anchor = [...list.querySelectorAll<HTMLElement>("[data-task-node]")]
      .find((item) => item.offsetTop + item.offsetHeight > previousTop);
    const anchorId = anchor?.dataset.taskNode;
    const anchorOffset = anchor ? previousTop - anchor.offsetTop : 0;
    const visible = tasks.slice(0, 30);
    list.innerHTML = visible.length
      ? visible.map(({ node, status }) =>
          `<button type="button" data-task-node="${node.id}"><i class="${status.className}">${node.kind === "video" ? "▶" : "▧"}</i><span><b>${escapeHtml(node.title || "未命名任务")}</b><small>${escapeHtml(this.deps.modelName(node.model) || "默认模型")}</small></span><em>${status.label}</em></button>`,
        ).join("")
      : '<div class="task-monitor-empty"><b>✓</b><span>当前没有生成任务</span></div>';
    const nextAnchor = anchorId
      ? list.querySelector<HTMLElement>(`[data-task-node="${anchorId}"]`)
      : null;
    list.scrollTop = nextAnchor
      ? nextAnchor.offsetTop + anchorOffset
      : Math.min(previousTop, Math.max(0, list.scrollHeight - list.clientHeight));
  }
}

function escapeHtml(value: string) {
  const element = document.createElement("span");
  element.textContent = value;
  return element.innerHTML;
}
