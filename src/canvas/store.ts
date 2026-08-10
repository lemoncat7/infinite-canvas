export type CanvasCamera = { x: number; y: number; zoom: number };

/**
 * Persistent canvas state owner. Renderers receive these stable collections
 * but must never replace them; save/restore keeps object identity intact.
 * Mutation commands and subscriptions are introduced incrementally so the
 * current persistence protocol remains unchanged during the renderer refactor.
 */
export class CanvasStore<Node, Link> {
  readonly nodes: Node[] = [];
  readonly links: Link[] = [];
  readonly camera: CanvasCamera;

  constructor(initialCamera: CanvasCamera) {
    this.camera = { ...initialCamera };
  }
}
