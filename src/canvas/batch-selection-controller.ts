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
      multiSelectMode: () => boolean;
      screen: (point: { x: number; y: number }) => { x: number; y: number };
      viewportWidth: () => number;
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
      draw: () => void;
      save: () => void;
      toast: (message: string, tone: ToastTone, detail?: string) => void;
      confirm: (message: string) => boolean;
    },
  ) {
    this.bind();
  }

  refresh() {
    const validIds = new Set(this.deps.nodes.map((node) => node.id));
    if (!validIds.has(this.deps.selectedId())) this.deps.clearSelectedId();
    for (const id of this.deps.batchIds)
      if (!validIds.has(id)) this.deps.batchIds.delete(id);
    const count = this.deps.batchIds.size;
    this.deps.toolbar.classList.toggle("open", count > 0);
    const label = this.deps.toolbar.querySelector<HTMLElement>("[data-batch-count]")!;
    label.textContent = this.deps.viewportWidth() <= 780
      ? `已选 ${count}`
      : `已选 ${count} 项`;
    label.title = `已选择 ${count} 个卡片`;
    if (!count) return this.deps.draw();
    const selected = this.deps.nodes.filter((node) => this.deps.batchIds.has(node.id));
    const left = Math.min(...selected.map((node) => this.deps.screen(node).x));
    const right = Math.max(...selected.map((node) =>
      this.deps.screen({ x: node.x + node.width, y: node.y }).x,
    ));
    const top = Math.min(...selected.map((node) => this.deps.screen(node).y));
    const viewportWidth = this.deps.viewportWidth();
    this.deps.toolbar.style.left = `${Math.max(12, Math.min(
      viewportWidth - this.deps.toolbar.offsetWidth - 12,
      (left + right) / 2 - this.deps.toolbar.offsetWidth / 2,
    ))}px`;
    this.deps.toolbar.style.top = `${Math.max(72, top - 58)}px`;
    this.deps.draw();
  }

  clear() {
    this.deps.batchIds.clear();
    this.deps.toolbar.classList.remove("open");
    this.deps.draw();
  }

  toggle(id: number) {
    if (this.deps.batchIds.has(id)) this.deps.batchIds.delete(id);
    else this.deps.batchIds.add(id);
    this.deps.clearSelectedId();
    this.deps.update();
    this.refresh();
  }

  refreshModeHint() {
    const hint = document.querySelector<HTMLElement>(".dock-create-hint")!;
    const title = hint.querySelector<HTMLElement>("strong")!;
    const detail = hint.querySelector<HTMLElement>("small")!;
    const active = this.deps.multiSelectMode();
    hint.classList.toggle("multi-mode", active);
    title.textContent = active
      ? "点按卡片 · 选择 / 取消"
      : "双击画布 · 创建卡片";
    detail.textContent = active
      ? "长按空白框选 · 双击空白退出"
      : "菜单中可进入多选模式";
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
