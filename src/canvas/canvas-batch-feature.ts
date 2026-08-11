import type { FlowLink, FlowNode } from "../nodes/node-types";
import { BatchSelectionController } from "./batch-selection-controller";

type ToastTone = "success" | "warning" | "error" | "info";

export class CanvasBatchFeature {
  readonly marqueeBox = document.createElement("div");
  readonly toolbar = document.createElement("div");
  private readonly controller: BatchSelectionController;

  constructor(deps: {
    nodes: FlowNode[];
    links: FlowLink[];
    batchIds: Set<number>;
    getSelectedId: () => number;
    clearSelectedId: () => void;
    isMultiSelectMode: () => boolean;
    screen: (point: { x: number; y: number }) => { x: number; y: number };
    viewportWidth: () => number;
    generationActive: () => boolean;
    enqueue: (ids: Set<number>) => {
      candidates: number;
      ready: number;
      waiting: number;
      skipped: number;
    };
    exitMode: () => void;
    updateEditor: () => void;
    draw: () => void;
    save: () => void;
    toast: (message: string, tone: ToastTone, detail?: string) => void;
    confirm: (message: string) => boolean;
  }) {
    this.marqueeBox.className = "canvas-marquee";
    this.toolbar.className = "canvas-batch-toolbar";
    this.toolbar.innerHTML =
      '<span data-batch-count>已选 0 项</span><button type="button" data-batch-generate aria-label="生成所选卡片" title="生成">生成</button><button type="button" data-batch-delete aria-label="删除所选卡片" title="删除">删除</button><button type="button" data-batch-clear aria-label="退出多选模式" title="退出">退出</button>';
    document.body.append(this.marqueeBox, this.toolbar);

    this.controller = new BatchSelectionController({
      toolbar: this.toolbar,
      nodes: deps.nodes,
      links: deps.links,
      batchIds: deps.batchIds,
      selectedId: deps.getSelectedId,
      clearSelectedId: deps.clearSelectedId,
      multiSelectMode: deps.isMultiSelectMode,
      screen: deps.screen,
      viewportWidth: deps.viewportWidth,
      generationActive: deps.generationActive,
      enqueue: deps.enqueue,
      clearSelection: () => this.clear(),
      exitMode: deps.exitMode,
      update: deps.updateEditor,
      draw: deps.draw,
      save: deps.save,
      toast: deps.toast,
      confirm: deps.confirm,
    });
  }

  refresh() { this.controller.refresh(); }
  clear() { this.controller.clear(); }
  toggle(id: number) { this.controller.toggle(id); }
  refreshModeHint() { this.controller.refreshModeHint(); }
  cascade(seed: Set<number>) { return this.controller.cascade(seed); }
}
