import type { FlowLink, FlowNode } from "../nodes/node-types";

type Snapshot = { nodes: FlowNode[]; links: FlowLink[]; nextId: number };
type State = {
  undo: Snapshot[];
  redo: Snapshot[];
  current: Snapshot | null;
  signature: string;
};

export class CanvasHistoryController {
  private readonly histories = new Map<string, State>();
  private timer: number | undefined;
  private restoring = false;

  constructor(
    private readonly deps: {
      nodes: FlowNode[];
      links: FlowLink[];
      undoButton: HTMLButtonElement;
      redoButton: HTMLButtonElement;
      projectId: () => string;
      nextId: () => number;
      setNextId: (value: number) => void;
      selectedId: () => number;
      setSelectedId: (value: number) => void;
      clearBatch: () => void;
      clearPromptEditing: () => void;
      generationActive: () => boolean;
      update: () => void;
      draw: () => void;
      save: () => Promise<unknown>;
      toast: (message: string) => void;
      guide: (kind: "undo" | "redo") => void;
    },
  ) {
    deps.undoButton.addEventListener("click", () => void this.undo());
  }

  reset(restore = true) {
    window.clearTimeout(this.timer);
    this.timer = undefined;
    const snapshot = this.snapshot();
    const signature = this.signature(snapshot);
    const state = this.state();
    let restored = false;
    if (restore)
      try {
        const saved = JSON.parse(
          sessionStorage.getItem(this.storageKey()) || "null",
        ) as State | null;
        if (saved?.current && saved.signature === signature) {
          state.undo = Array.isArray(saved.undo) ? saved.undo.slice(-20) : [];
          state.redo = Array.isArray(saved.redo) ? saved.redo.slice(-20) : [];
          restored = true;
        }
      } catch {
        // Start a new in-memory history when persisted data is invalid.
      }
    if (!restored) {
      state.undo = [];
      state.redo = [];
    }
    state.current = snapshot;
    state.signature = signature;
    this.persist();
    this.updateControls();
  }

  queue() {
    if (this.restoring) return;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.commit(), 520);
  }

  commit() {
    this.timer = undefined;
    if (this.restoring) return;
    const state = this.state();
    const snapshot = this.snapshot();
    const signature = this.signature(snapshot);
    if (!state.current) {
      state.current = snapshot;
      state.signature = signature;
      this.updateControls();
      return;
    }
    if (signature === state.signature) {
      state.current = snapshot;
      return;
    }
    state.undo.push(state.current);
    if (state.undo.length > 50) state.undo.splice(0, state.undo.length - 50);
    state.redo = [];
    state.current = snapshot;
    state.signature = signature;
    this.persist();
    this.updateControls();
  }

  refreshControls() {
    this.updateControls();
  }

  async undo() {
    this.commit();
    const state = this.state();
    const previous = state.undo.at(-1);
    if (!previous) {
      this.deps.guide("undo");
      return;
    }
    if (this.deps.generationActive() && !this.safeStep(state.current, previous)) {
      this.deps.toast("生成中只能撤销卡片位置或尺寸调整");
      return;
    }
    state.undo.pop();
    state.redo.push(state.current!);
    state.current = structuredClone(previous);
    state.signature = this.signature(previous);
    this.persist();
    await this.apply(previous);
    this.deps.guide("undo");
  }

  async redo() {
    this.commit();
    const state = this.state();
    const next = state.redo.at(-1);
    if (!next) return;
    if (this.deps.generationActive() && !this.safeStep(state.current, next)) {
      this.deps.toast("生成中只能重做卡片位置或尺寸调整");
      return;
    }
    state.redo.pop();
    state.undo.push(state.current!);
    state.current = structuredClone(next);
    state.signature = this.signature(next);
    this.persist();
    await this.apply(next);
    this.deps.guide("redo");
  }

  private async apply(snapshot: Snapshot) {
    this.restoring = true;
    try {
      const selected = this.deps.selectedId();
      const currentNodes = structuredClone(this.deps.nodes);
      const currentLinks = structuredClone(this.deps.links);
      const currentById = new Map(currentNodes.map((node) => [node.id, node]));
      const restoredNodes = structuredClone(snapshot.nodes);
      for (const restored of restoredNodes) {
        const current = currentById.get(restored.id);
        if (!current) continue;
        for (const key of preservedKeys) {
          if (current[key] !== undefined)
            (restored as unknown as Record<string, unknown>)[key] = current[key];
          else delete (restored as unknown as Record<string, unknown>)[key];
        }
      }
      const restoredIds = new Set(restoredNodes.map((node) => node.id));
      const products = currentNodes.filter(
        (node) => isProduct(node) && !restoredIds.has(node.id),
      );
      restoredNodes.push(...products);
      const finalIds = new Set(restoredNodes.map((node) => node.id));
      const restoredLinks = structuredClone(snapshot.links);
      const keys = new Set(restoredLinks.map(linkKey));
      for (const link of currentLinks) {
        if (!finalIds.has(link.from) || !finalIds.has(link.to)) continue;
        if (!products.some((node) => node.id === link.from || node.id === link.to))
          continue;
        const key = linkKey(link);
        if (!keys.has(key)) {
          restoredLinks.push(link);
          keys.add(key);
        }
      }
      this.deps.nodes.splice(0, this.deps.nodes.length, ...restoredNodes);
      this.deps.links.splice(0, this.deps.links.length, ...restoredLinks);
      this.deps.setNextId(
        Math.max(
          snapshot.nextId,
          restoredNodes.length
            ? Math.max(...restoredNodes.map((node) => node.id)) + 1
            : 1,
        ),
      );
      this.deps.setSelectedId(finalIds.has(selected) ? selected : 0);
      this.deps.clearBatch();
      this.deps.clearPromptEditing();
      this.deps.update();
      this.deps.draw();
      await this.deps.save();
    } finally {
      this.restoring = false;
      this.updateControls();
    }
  }

  private snapshot(): Snapshot {
    return {
      nodes: structuredClone(this.deps.nodes),
      links: structuredClone(this.deps.links),
      nextId: this.deps.nextId(),
    };
  }

  private state() {
    const projectId = this.deps.projectId();
    let state = this.histories.get(projectId);
    if (!state) {
      state = { undo: [], redo: [], current: null, signature: "" };
      this.histories.set(projectId, state);
    }
    return state;
  }

  private signature(snapshot: Snapshot) {
    return historySignature(snapshot, false);
  }

  private safeStep(from: Snapshot | null, to?: Snapshot) {
    return Boolean(
      from && to && historySignature(from, true) === historySignature(to, true),
    );
  }

  private updateControls() {
    const state = this.state();
    const generating = this.deps.generationActive();
    const undoSafe = !generating || this.safeStep(state.current, state.undo.at(-1));
    const redoSafe = !generating || this.safeStep(state.current, state.redo.at(-1));
    this.deps.undoButton.disabled = !state.undo.length || !undoSafe;
    this.deps.undoButton.classList.toggle("available", state.undo.length > 0 && undoSafe);
    this.deps.undoButton.title = generating && !undoSafe
      ? "生成中仅可撤销卡片位置或尺寸调整"
      : `回溯${state.undo.length ? ` · ${state.undo.length} 步` : ""}（Ctrl+Z）`;
    this.deps.redoButton.disabled = !state.redo.length || !redoSafe;
  }

  private persist() {
    const state = this.state();
    try {
      sessionStorage.setItem(this.storageKey(), JSON.stringify({
        undo: state.undo.slice(-20),
        redo: state.redo.slice(-20),
        current: state.current,
        signature: state.signature,
      }));
    } catch {
      // Keep the current page's in-memory history if storage is full.
    }
  }

  private storageKey() {
    return `flow-canvas-history:${this.deps.projectId()}`;
  }
}

const preservedKeys = [
  "mediaUrl", "jobId", "status", "progress", "agentAuto",
  "generationPrompt", "originalPrompt", "corePrompt",
] as const;

function isProduct(node: FlowNode) {
  return node.role === "result" || node.title === "图片修改结果";
}

function linkKey(link: FlowLink) {
  return `${link.from}:${link.to}:${link.fromSide}:${link.toSide}`;
}

function historySignature(snapshot: Snapshot, structureOnly: boolean) {
  const ignored = new Set(snapshot.nodes.filter(isProduct).map((node) => node.id));
  const nodes = snapshot.nodes
    .filter((node) => !ignored.has(node.id))
    .map((node) => {
      const copy = { ...node } as Record<string, unknown>;
      for (const key of preservedKeys) delete copy[key];
      if (structureOnly)
        for (const key of ["x", "y", "width", "height"]) delete copy[key];
      return copy;
    });
  if (structureOnly) nodes.sort((a, b) => Number(a.id) - Number(b.id));
  const links = snapshot.links
    .filter((link) => !ignored.has(link.from) && !ignored.has(link.to))
    .map((link) => ({ ...link }));
  if (structureOnly)
    links.sort((a, b) =>
      a.from - b.from || a.to - b.to ||
      a.fromSide.localeCompare(b.fromSide) || a.toSide.localeCompare(b.toSide));
  return JSON.stringify({ nodes, links, ...(structureOnly ? {} : { nextId: snapshot.nextId }) });
}
