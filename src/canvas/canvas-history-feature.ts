import type { FlowLink, FlowNode } from "../nodes/node-types";
import type { CanvasGuideMessage } from "../ui/canvas-guide-controller";
import { CanvasHistoryController } from "./history-controller";

export class CanvasHistoryFeature {
  private readonly history: CanvasHistoryController;

  constructor(options: {
    nodes: FlowNode[];
    links: FlowLink[];
    getProjectId: () => string;
    getNextId: () => number;
    setNextId: (value: number) => void;
    getSelectedId: () => number;
    setSelectedId: (value: number) => void;
    clearBatch: () => void;
    clearPromptEditing: () => void;
    generationActive: () => boolean;
    updateEditor: () => void;
    draw: () => void;
    save: () => Promise<unknown>;
    toast: (message: string) => void;
    showGuide: (message: CanvasGuideMessage) => unknown;
  }) {
    this.history = new CanvasHistoryController({
      nodes: options.nodes,
      links: options.links,
      undoButton: document.querySelector<HTMLButtonElement>("#dock-history")!,
      redoButton: document.createElement("button"),
      projectId: options.getProjectId,
      nextId: options.getNextId,
      setNextId: options.setNextId,
      selectedId: options.getSelectedId,
      setSelectedId: options.setSelectedId,
      clearBatch: options.clearBatch,
      clearPromptEditing: options.clearPromptEditing,
      generationActive: options.generationActive,
      update: options.updateEditor,
      draw: options.draw,
      save: options.save,
      toast: options.toast,
      guide: (kind) => this.showShortcutGuide(kind, options.showGuide),
    });
  }

  reset(restore = true) { this.history.reset(restore); }
  queue() { this.history.queue(); }
  refreshControls() { this.history.refreshControls(); }
  undo() { return this.history.undo(); }
  redo() { return this.history.redo(); }

  private showShortcutGuide(
    kind: "undo" | "redo",
    show: (message: CanvasGuideMessage) => unknown,
  ) {
    const storageKey = `flow-history-guide:${kind}`;
    if (sessionStorage.getItem(storageKey)) return;
    sessionStorage.setItem(storageKey, "1");
    show(kind === "undo" ? {
      key: "history-undo-guide",
      title: "画布回溯",
      detail: "可以按 Ctrl/⌘ + Z 快速撤销上一步。",
      tone: "online",
      priority: 28,
      duration: 4200,
    } : {
      key: "history-redo-guide",
      title: "已重做上一步",
      detail: "可以按 Ctrl/⌘ + Shift + Z 恢复刚才撤销的操作。",
      tone: "online",
      priority: 28,
      duration: 4600,
    });
  }
}
