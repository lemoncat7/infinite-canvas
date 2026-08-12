import type { FlowLink, FlowNode, Point, PortSide } from "../nodes/node-types";
import type { CanvasConnectionFeature } from "./canvas-connection-feature";
import type { CanvasConnectionController } from "./connection-controller";

export class CanvasRenderState {
  constructor(private readonly options: {
    nodes: FlowNode[];
    links: FlowLink[];
    camera: { x: number; y: number; zoom: number };
    connectionFeature: CanvasConnectionFeature;
    connection: CanvasConnectionController;
    domOwnedNodeIds: () => number[];
    selectedId: () => number;
    batchIds: Set<number>;
    agentIds: () => Set<number>;
    dark: () => boolean;
    backgroundMode: () => "dots" | "lines" | "blank";
    screen: (point: Point) => Point;
    portWorld: (node: FlowNode, side: PortSide) => Point;
  }) {}

  snapshot = () => {
    const { connection, connectionFeature, nodes } = this.options;
    const pendingNode = connection.active
      ? connectionFeature.geometry.nodeIndex.get(connection.active.nodeId) ??
        nodes.find((node) => node.id === connection.active!.nodeId)
      : undefined;
    return {
      nodes,
      links: this.options.links,
      nodeCount: nodes.length,
      indexedNodeCount: connectionFeature.geometry.nodeIndex.size,
      domOwnedNodeIds: this.options.domOwnedNodeIds(),
      camera: this.options.camera,
      selectedId: this.options.selectedId(),
      selectedIds: [
        ...new Set([...this.options.batchIds, ...this.options.agentIds()]),
      ],
      dark: this.options.dark(),
      backgroundMode: this.options.backgroundMode(),
      hoveredLinkIndex: connection.hoveredLinkIndex,
      touchSelectedLinkIndex: connection.touchSelectedLinkIndex,
      pendingConnection: connection.active && pendingNode
        ? {
            from: this.options.screen(
              this.options.portWorld(pendingNode, connection.active.side),
            ),
            to: connection.active.pointer,
            fromSide: connection.active.side,
            snapped: Boolean(connection.snap),
          }
        : undefined,
    };
  };
}
