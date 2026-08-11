import type { FlowLink, FlowNode } from "../nodes/node-types";

type ToastTone = "success" | "warning" | "error" | "info";

export class BatchSelectionController {
  constructor(
    private readonly deps: {
      toolbar: HTMLElement;
      nodes: FlowNode[];
      links: FlowLink[];
      batchIds: Set<number>;
      selectedId: () => number;
      clearSelectedId: () => void;
      generationActive: () => boolean;
      enqueue: (ids: Set<number>) => {
        candidates: number;
        ready: number;
        waiting: number;
        skipped: number;
      };
      clearSelection: () => void;
      exitMode: () => void;
      update: () => void;
      save: () => void;
      toast: (message: string, tone: ToastTone, detail?: string) => void;
      confirm: (message: string) => boolean;
    },
  ) {
    this.bind();
  }

  cascade(seed: Set<number>) {
    const result = new Set(seed);
    let changed = true;
    while (changed) {
      changed = false;
      for (const link of this.deps.links) {
        if (!result.has(link.from) || result.has(link.to)) continue;
        const incoming = this.deps.links.filter((item) => item.to === link.to);
        if (!incoming.length || incoming.some((item) => !result.has(item.from)))
          continue;
        result.add(link.to);
        changed = true;
      }
    }
    return result;
  }

  deleteSelection() {
    if (!this.deps.batchIds.size) return;
    if (this.deps.generationActive()) {
      this.deps.toast("画布正在生成，任务完成后即可批量删除", "warning");
      return;
    }
    const targets = this.cascade(this.deps.batchIds);
    const cascadeCount = targets.size - this.deps.batchIds.size;
    if (
      !this.deps.confirm(
        `删除 ${this.deps.batchIds.size} 个选中节点${cascadeCount ? `，并清理 ${cascadeCount} 个仅依赖它们的下游节点` : ""}？`,
      )
    )
      return;
    for (let index = this.deps.nodes.length - 1; index >= 0; index--)
      if (targets.has(this.deps.nodes[index].id))
        this.deps.nodes.splice(index, 1);
    for (let index = this.deps.links.length - 1; index >= 0; index--)
      if (
        targets.has(this.deps.links[index].from) ||
        targets.has(this.deps.links[index].to)
      )
        this.deps.links.splice(index, 1);
    if (targets.has(this.deps.selectedId())) this.deps.clearSelectedId();
    this.deps.clearSelection();
    this.deps.update();
    this.deps.save();
    this.deps.toast(`已删除 ${targets.size} 个节点`, "success");
  }

  generateSelection() {
    const result = this.deps.enqueue(this.deps.batchIds);
    if (!result.candidates) {
      this.deps.toast("选中区域没有可生成的任务节点", "warning");
      return;
    }
    this.deps.toast(
      `${result.candidates} 个任务已进入依赖队列`,
      "success",
      `${result.ready} 个可立即排队${result.waiting ? ` · ${result.waiting} 个等待上游` : ""}${result.skipped ? ` · ${result.skipped} 个不可生成` : ""}`,
    );
  }

  private bind() {
    this.deps.toolbar
      .querySelector("[data-batch-generate]")!
      .addEventListener("click", () => {
        this.generateSelection();
        this.deps.exitMode();
      });
    this.deps.toolbar
      .querySelector("[data-batch-delete]")!
      .addEventListener("click", () => {
        this.deleteSelection();
        this.deps.exitMode();
      });
    this.deps.toolbar
      .querySelector("[data-batch-clear]")!
      .addEventListener("click", this.deps.exitMode);
  }
}
