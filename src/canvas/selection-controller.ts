type SelectableNode = { id: number };

/** Owns canvas selection state without depending on rendering or DOM events. */
export class CanvasSelectionController {
  selectedId = 0;
  readonly batchIds = new Set<number>();
  multiSelectMode = false;

  select(id: number) {
    this.selectedId = id;
  }

  clearSingle() {
    this.selectedId = 0;
  }

  clearBatch() {
    this.batchIds.clear();
  }

  toggleBatch(id: number) {
    if (this.batchIds.has(id)) this.batchIds.delete(id);
    else this.batchIds.add(id);
    this.clearSingle();
  }

  prune(nodes: readonly SelectableNode[]) {
    const validIds = new Set(nodes.map((node) => node.id));
    if (!validIds.has(this.selectedId)) this.clearSingle();
    for (const id of this.batchIds)
      if (!validIds.has(id)) this.batchIds.delete(id);
  }

  selectedNodes<T extends SelectableNode>(nodes: readonly T[]) {
    return nodes.filter((node) => this.batchIds.has(node.id));
  }

  enterMultiSelect() {
    this.multiSelectMode = true;
  }

  exitMultiSelect() {
    this.multiSelectMode = false;
    this.clearBatch();
  }
}
