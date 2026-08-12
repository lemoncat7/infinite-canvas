export type CanvasCamera = { x: number; y: number; zoom: number };
export type CanvasPositionedNode = { id: number; x: number; y: number };
export type CanvasStoreChange =
  | { type: "camera" }
  | { type: "node-position"; nodeIds: readonly number[] }
  | { type: "structure" };

/**
 * Persistent canvas state owner. Renderers receive these stable collections
 * but must never replace them; save/restore keeps object identity intact.
 * Mutation commands and subscriptions are introduced incrementally so the
 * current persistence protocol remains unchanged during the renderer refactor.
 */
export class CanvasStore<Node extends CanvasPositionedNode, Link> {
  readonly nodes: Node[] = [];
  readonly links: Link[] = [];
  readonly camera: CanvasCamera;
  private readonly listeners = new Set<(change: CanvasStoreChange) => void>();

  constructor(initialCamera: CanvasCamera) {
    this.camera = { ...initialCamera };
  }

  subscribe(listener: (change: CanvasStoreChange) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  panCamera(dx: number, dy: number) {
    this.camera.x += dx;
    this.camera.y += dy;
    this.emit({ type: "camera" });
  }

  moveNodeById(id: number, dx: number, dy: number) {
    const node = this.nodes.find((candidate) => candidate.id === id);
    if (!node) return false;
    node.x += dx;
    node.y += dy;
    this.emit({ type: "node-position", nodeIds: [id] });
    return true;
  }

  moveNodesByIds(ids: Iterable<number>, dx: number, dy: number) {
    const movingIds = new Set(ids);
    const moved: number[] = [];
    this.nodes.forEach((node) => {
      if (!movingIds.has(node.id)) return;
      node.x += dx;
      node.y += dy;
      moved.push(node.id);
    });
    if (moved.length) this.emit({ type: "node-position", nodeIds: moved });
    return moved.length > 0;
  }

  notifyStructureChanged() {
    this.emit({ type: "structure" });
  }

  private emit(change: CanvasStoreChange) {
    this.listeners.forEach((listener) => listener(change));
  }
}
