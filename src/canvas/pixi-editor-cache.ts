import type { FlowNode, Point } from "../nodes/node-types";
import type { CanvasSpatialIndex } from "./spatial-index";

export class PixiEditorCache {
  readonly elements = new Map<number, HTMLElement>();
  private warmScheduled = false;

  constructor(
    private readonly nodes: FlowNode[],
    private readonly camera: { x: number; y: number; zoom: number },
    private readonly spatialIndex: CanvasSpatialIndex,
    private readonly world: (point: Point) => Point,
    private readonly selectedId: () => number,
    private readonly createElement: (node: FlowNode) => HTMLElement,
    private readonly clearState: (id: number) => void,
    private readonly capacity = 2,
  ) {}

  detach(id: number, element: HTMLElement) {
    this.elements.delete(id);
    this.elements.set(id, element);
    element.remove();
    while (this.elements.size > this.capacity) {
      const oldestId = this.elements.keys().next().value as number | undefined;
      if (oldestId === undefined) break;
      this.elements.delete(oldestId);
      this.clearState(oldestId);
    }
  }

  clear() {
    this.elements.clear();
    this.warmScheduled = false;
  }

  scheduleWarmup() {
    if (this.warmScheduled || this.elements.size >= this.capacity || !this.nodes.length)
      return;
    this.warmScheduled = true;
    const warm = () => {
      this.warmScheduled = false;
      const center = this.world({ x: innerWidth / 2, y: innerHeight / 2 });
      const offsetX = innerWidth / 2 + this.camera.x;
      const offsetY = innerHeight / 2 + this.camera.y;
      const candidates = this.spatialIndex
        .search({
          minX: -offsetX / this.camera.zoom,
          minY: -offsetY / this.camera.zoom,
          maxX: (innerWidth - offsetX) / this.camera.zoom,
          maxY: (innerHeight - offsetY) / this.camera.zoom,
        })
        .map((id) => this.nodes.find((node) => node.id === id))
        .filter((node): node is FlowNode => Boolean(node))
        .sort((left, right) =>
          Math.hypot(left.x - center.x, left.y - center.y) -
          Math.hypot(right.x - center.x, right.y - center.y),
        );
      for (const node of candidates) {
        if (this.elements.has(node.id) || node.id === this.selectedId()) continue;
        this.detach(node.id, this.createElement(node));
        if (this.elements.size >= this.capacity) break;
      }
    };
    const requestIdle = Reflect.get(window, "requestIdleCallback") as
      | ((callback: () => void, options: { timeout: number }) => number)
      | undefined;
    if (requestIdle) requestIdle(warm, { timeout: 1200 });
    else globalThis.setTimeout(warm, 180);
  }
}
