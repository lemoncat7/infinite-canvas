import type { FlowLink, FlowNode, Point, PortSide } from "../nodes/node-types";
import { ConnectionRules } from "../nodes/connection-rules";
import { CanvasConnectionController } from "./connection-controller";
import { ConnectionAutoPanController } from "./connection-auto-pan-controller";
import { CanvasGeometryController } from "./canvas-geometry-controller";
import type { CanvasSpatialIndex } from "./spatial-index";

export class CanvasConnectionFeature {
  readonly geometry: CanvasGeometryController;
  private readonly rules: ConnectionRules;
  private readonly autoPan: ConnectionAutoPanController;

  constructor(private readonly options: {
    nodes: FlowNode[];
    links: FlowLink[];
    camera: { x: number; y: number; zoom: number };
    spatialIndex: CanvasSpatialIndex;
    connection: CanvasConnectionController;
    world: (point: Point) => Point;
    screen: (point: Point) => Point;
    portWorld: (node: FlowNode, side: PortSide) => Point;
    save: () => void;
    draw: (syncDom?: boolean) => void;
    notify: (message: string) => void;
  }) {
    this.rules = new ConnectionRules({
      nodes: options.nodes,
      links: options.links,
      notify: options.notify,
    });
    this.geometry = new CanvasGeometryController(
      options.nodes,
      options.links,
      options.camera,
      options.spatialIndex,
      options.world,
      options.screen,
      options.portWorld,
    );
    this.autoPan = new ConnectionAutoPanController({
      camera: options.camera,
      active: () => Boolean(options.connection.active),
      updatePointer: (x, y) => this.updatePointer(x, y),
      draw: () => options.draw(false),
    });
  }

  rebuild() { this.geometry.rebuild(); }
  hitNode(x: number, y: number) { return this.geometry.hitNode(x, y); }
  hitPort(x: number, y: number, radius = 12, excludeNodeId?: number) {
    return this.geometry.hitPort(x, y, radius, excludeNodeId);
  }
  hitLink(x: number, y: number, tolerance = 9) {
    return this.geometry.hitLink(x, y, tolerance);
  }
  directedLink(firstId: number, firstSide: PortSide, secondId: number, secondSide: PortSide) {
    return this.rules.create(firstId, firstSide, secondId, secondSide);
  }
  updatePointer(x: number, y: number) {
    const { connection, screen, portWorld } = this.options;
    if (!connection.active) return;
    const candidate = this.hitPort(x, y, connection.snapRadius, connection.active.nodeId);
    const target = candidate?.side === "left" ? candidate : null;
    connection.update(
      target ? screen(portWorld(target.node, target.side)) : { x, y },
      target ? { nodeId: target.node.id, side: target.side } : null,
    );
  }
  startAutoPan(x: number, y: number) { this.autoPan.start(x, y); }
  stopAutoPan() { this.autoPan.stop(); }

  finish(event: PointerEvent) {
    const { connection, nodes, links } = this.options;
    if (!connection.active) return;
    const snappedNode = connection.snap
      ? nodes.find((node) => node.id === connection.snap!.nodeId)
      : undefined;
    const target = snappedNode
      ? { node: snappedNode, side: connection.snap!.side }
      : this.hitPort(
          event.clientX,
          event.clientY,
          connection.snapRadius,
          connection.active.nodeId,
        );
    if (target) {
      const next = this.directedLink(
        connection.active.nodeId,
        connection.active.side,
        target.node.id,
        target.side,
      );
      if (next && !links.some((link) => link.from === next.from && link.to === next.to)) {
        links.push(next);
        this.options.save();
      }
    }
    connection.cancel();
    this.stopAutoPan();
    this.options.draw();
  }
}
