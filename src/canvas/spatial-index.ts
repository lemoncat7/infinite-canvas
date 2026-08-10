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
  private readonly entries = new Map<number, SpatialEntry>();

  rebuild(nodes: readonly SpatialNode[]) {
    this.tree.clear();
    this.entries.clear();
    const entries = nodes.map((node) => ({
        id: node.id,
        minX: node.x,
        minY: node.y,
        maxX: node.x + node.width,
        maxY: node.y + node.height,
      }));
    entries.forEach((entry) => this.entries.set(entry.id, entry));
    this.tree.load(entries);
  }

  update(node: SpatialNode) {
    const previous = this.entries.get(node.id);
    if (previous) this.tree.remove(previous);
    const entry = {
      id: node.id,
      minX: node.x,
      minY: node.y,
      maxX: node.x + node.width,
      maxY: node.y + node.height,
    };
    this.entries.set(node.id, entry);
    this.tree.insert(entry);
  }

  search(bounds: SpatialBounds) {
    return this.tree.search(bounds).map((entry) => entry.id);
  }

  clear() {
    this.tree.clear();
    this.entries.clear();
  }
}
