import RBush from "rbush";

export type SpatialBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type SpatialNode = {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

type SpatialEntry = SpatialBounds & { id: number };

export class CanvasSpatialIndex {
  private readonly tree = new RBush<SpatialEntry>();

  rebuild(nodes: readonly SpatialNode[]) {
    this.tree.clear();
    this.tree.load(
      nodes.map((node) => ({
        id: node.id,
        minX: node.x,
        minY: node.y,
        maxX: node.x + node.width,
        maxY: node.y + node.height,
      })),
    );
  }

  search(bounds: SpatialBounds) {
    return this.tree.search(bounds).map((entry) => entry.id);
  }

  clear() {
    this.tree.clear();
  }
}
