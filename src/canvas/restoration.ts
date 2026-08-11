import type { FlowLink, FlowNode } from "../nodes/node-types";
import { findOutputPosition, removeResultNode } from "../nodes/generation-node-lifecycle";

export function repairRestoredCanvas(nodes: FlowNode[], links: FlowLink[]) {
  nodes
    .filter((node) => node.kind === "image" && node.title.startsWith("分镜 ") && node.status === "failed" && !node.jobId
      && links.some((link) => link.to === node.id && nodes.some((source) => source.id === link.from && source.status === "failed")))
    .forEach((node) => { node.status = "waiting"; node.agentAuto = true; });

  let repositionedResult = false;
  nodes.filter((node) => node.kind === "video" && node.role === "result" && node.sourceNodeId).forEach((node) => {
    const source = nodes.find((item) => item.id === node.sourceNodeId);
    if (!source || Math.abs(node.y-source.y) <= 780) return;
    const position = findOutputPosition(source, nodes, node.id);
    Object.assign(node, position); repositionedResult = true;
  });

  const invalidResults = nodes.filter((node) => node.kind === "video" && node.status === "failed" && !node.mediaUrl
    && links.some((link) => link.to === node.id && nodes.some((source) => source.id === link.from && source.kind === "video")));
  for (const node of invalidResults) removeResultNode(node, nodes, links);
  return { repositionedResult, removedInvalidResults: invalidResults.length };
}
