import type { FlowLink, FlowNode, Point, PortSide } from "../nodes/node-types";
import type { CanvasSpatialIndex } from "./spatial-index";

type Camera = { x: number; y: number; zoom: number };
type LinkGeometry = { a: Point; b: Point; ca: Point; cb: Point };

export class CanvasGeometryController {
  readonly nodeIndex = new Map<number, FlowNode>();
  private targetLinkIndex = new Map<number, FlowLink[]>();
  private readonly linkCache = new WeakMap<FlowLink, LinkGeometry & { key: string }>();

  constructor(
    private readonly nodes: FlowNode[],
    private readonly links: FlowLink[],
    private readonly camera: Camera,
    readonly spatialIndex: CanvasSpatialIndex,
    private readonly world: (point: Point) => Point,
    private readonly screen: (point: Point) => Point,
    private readonly portWorld: (node: FlowNode, side: PortSide) => Point,
  ) {}

  rebuild() {
    this.nodeIndex.clear();
    this.nodes.forEach((node) => this.nodeIndex.set(node.id, node));
    this.spatialIndex.rebuild(this.nodes);
    this.targetLinkIndex.clear();
    const grouped = new Map<number, FlowLink[]>();
    const order = new Map(this.links.map((link, index) => [link, index]));
    this.links.forEach((link) => {
      const target = grouped.get(link.to);
      if (target) target.push(link);
      else grouped.set(link.to, [link]);
    });
    grouped.forEach((targetLinks, targetId) => {
      targetLinks.sort((left, right) => {
        const leftSource = this.nodeIndex.get(left.from);
        const rightSource = this.nodeIndex.get(right.from);
        return (
          (left.inputOrder ?? Number.MAX_SAFE_INTEGER) -
            (right.inputOrder ?? Number.MAX_SAFE_INTEGER) ||
          (leftSource?.y ?? 0) - (rightSource?.y ?? 0) ||
          (leftSource?.x ?? 0) - (rightSource?.x ?? 0) ||
          (order.get(left) ?? 0) - (order.get(right) ?? 0)
        );
      });
      this.targetLinkIndex.set(targetId, targetLinks);
    });
  }

  private orderedTargetLinks(targetId: number) {
    return this.targetLinkIndex.get(targetId) ?? this.links
      .filter((link) => link.to === targetId)
      .map((link, originalIndex) => ({
        link,
        originalIndex,
        source: this.nodes.find((node) => node.id === link.from),
      }))
      .sort((left, right) =>
        (left.link.inputOrder ?? Number.MAX_SAFE_INTEGER) -
          (right.link.inputOrder ?? Number.MAX_SAFE_INTEGER) ||
        (left.source?.y ?? 0) - (right.source?.y ?? 0) ||
        (left.source?.x ?? 0) - (right.source?.x ?? 0) ||
        left.originalIndex - right.originalIndex,
      )
      .map((item) => item.link);
  }

  linkPath(link: FlowLink): LinkGeometry | null {
    const from = this.nodeIndex.get(link.from) ?? this.nodes.find((node) => node.id === link.from);
    const to = this.nodeIndex.get(link.to) ?? this.nodes.find((node) => node.id === link.to);
    if (!from || !to) return null;
    const siblings = this.orderedTargetLinks(link.to);
    const rank = siblings.indexOf(link);
    const key = [from.x, from.y, from.width, from.height, to.x, to.y, to.width, to.height, link.fromSide, link.toSide, rank, siblings.length, this.camera.zoom].join(":");
    const cached = this.linkCache.get(link);
    let relative: LinkGeometry;
    if (cached?.key === key) relative = cached;
    else {
      const source = this.portWorld(from, link.fromSide);
      const target = this.portWorld(to, link.toSide);
      const a = { x: source.x * this.camera.zoom, y: source.y * this.camera.zoom };
      const b = { x: target.x * this.camera.zoom, y: target.y * this.camera.zoom };
      const curve = Math.max(55, Math.hypot(b.x - a.x, b.y - a.y) * 0.35);
      const control = (point: Point, side: PortSide) => {
        if (side === "left") return { x: point.x - curve, y: point.y };
        if (side === "right") return { x: point.x + curve, y: point.y };
        if (side === "top") return { x: point.x, y: point.y - curve };
        return { x: point.x, y: point.y + curve };
      };
      relative = { a, b, ca: control(a, link.fromSide), cb: control(b, link.toSide) };
      if (rank >= 0 && siblings.length > 1) {
        const spread = (rank - (siblings.length - 1) / 2) * Math.min(34, 18 + siblings.length * 4) * this.camera.zoom;
        relative.ca.y += spread * 0.72;
        relative.cb.y += spread;
      }
      this.linkCache.set(link, { key, ...relative });
    }
    const offsetX = innerWidth / 2 + this.camera.x;
    const offsetY = innerHeight / 2 + this.camera.y;
    const translate = (point: Point) => ({ x: point.x + offsetX, y: point.y + offsetY });
    return { a: translate(relative.a), b: translate(relative.b), ca: translate(relative.ca), cb: translate(relative.cb) };
  }

  hitNode(sx: number, sy: number) {
    const point = this.world({ x: sx, y: sy });
    const candidates = new Set(this.spatialIndex.search({ minX: point.x, minY: point.y, maxX: point.x, maxY: point.y }));
    for (let index = this.nodes.length - 1; index >= 0; index--) {
      const node = this.nodes[index];
      if (candidates.has(node.id) && point.x >= node.x && point.x <= node.x + node.width && point.y >= node.y && point.y <= node.y + node.height)
        return node;
    }
    return undefined;
  }

  hitPort(sx: number, sy: number, radius = 16, excludeNodeId?: number) {
    const center = this.world({ x: sx, y: sy });
    const worldRadius = radius / this.camera.zoom;
    const candidates = new Set(this.spatialIndex.search({ minX: center.x - worldRadius, minY: center.y - worldRadius, maxX: center.x + worldRadius, maxY: center.y + worldRadius }));
    const sides: PortSide[] = ["top", "right", "bottom", "left"];
    let closest: { node: FlowNode; side: PortSide; distance: number } | undefined;
    for (let index = this.nodes.length - 1; index >= 0; index--) {
      const node = this.nodes[index];
      if (!candidates.has(node.id) || node.id === excludeNodeId || (node.kind === "video" && node.role === "result")) continue;
      for (const side of sides) {
        const point = this.screen(this.portWorld(node, side));
        const distance = Math.hypot(sx - point.x, sy - point.y);
        if (distance <= radius && (!closest || distance < closest.distance)) closest = { node, side, distance };
      }
    }
    return closest && { node: closest.node, side: closest.side };
  }

  hitLink(sx: number, sy: number, tolerance = 9) {
    for (let index = this.links.length - 1; index >= 0; index--) {
      const geometry = this.linkPath(this.links[index]);
      if (!geometry) continue;
      const { a, b, ca, cb } = geometry;
      if (sx < Math.min(a.x, b.x, ca.x, cb.x) - tolerance || sx > Math.max(a.x, b.x, ca.x, cb.x) + tolerance || sy < Math.min(a.y, b.y, ca.y, cb.y) - tolerance || sy > Math.max(a.y, b.y, ca.y, cb.y) + tolerance) continue;
      let previous = a;
      for (let step = 1; step <= 32; step++) {
        const t = step / 32;
        const inverse = 1 - t;
        const point = {
          x: inverse ** 3 * a.x + 3 * inverse ** 2 * t * ca.x + 3 * inverse * t ** 2 * cb.x + t ** 3 * b.x,
          y: inverse ** 3 * a.y + 3 * inverse ** 2 * t * ca.y + 3 * inverse * t ** 2 * cb.y + t ** 3 * b.y,
        };
        const length = Math.hypot(point.x - previous.x, point.y - previous.y) || 1;
        const projection = Math.max(0, Math.min(1, ((sx - previous.x) * (point.x - previous.x) + (sy - previous.y) * (point.y - previous.y)) / (length * length)));
        const distance = Math.hypot(sx - (previous.x + projection * (point.x - previous.x)), sy - (previous.y + projection * (point.y - previous.y)));
        if (distance <= tolerance) return index;
        previous = point;
      }
    }
    return -1;
  }
}
