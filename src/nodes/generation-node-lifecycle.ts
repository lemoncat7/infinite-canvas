import type { FlowLink, FlowNode } from "./node-types";
import { makeNodePublicId } from "./node-service";

export function findOutputPosition(source: FlowNode, nodes: FlowNode[], excludeId?: number) {
  const candidates: Array<{ column: number; row: number }> = [];
  for (let column = 0; column < 8; column++) candidates.push({ column, row: 0 });
  for (const row of [1, -1, 2, -2]) for (let column = 0; column < 8; column++) candidates.push({ column, row });
  for (const { column, row } of candidates) {
    const candidate = { x: source.x+source.width+110+column*390, y: source.y+row*260 };
    const occupied = nodes.some((node) => node.id !== source.id && node.id !== excludeId
      && candidate.x < node.x+node.width+24 && candidate.x+304 > node.x
      && candidate.y < node.y+node.height+24 && candidate.y+244 > node.y);
    if (!occupied) return candidate;
  }
  return { x: source.x+source.width+110, y: source.y };
}

export function appendRevisionNode(id: number, source: FlowNode, nodes: FlowNode[], links: FlowLink[]) {
  const position = findOutputPosition(source, nodes), kind = source.kind === "video" ? "video" : "image";
  const revision: FlowNode = {
    id, publicId: makeNodePublicId(kind), kind,
    role: kind === "video" ? "result" : undefined,
    sourceNodeId: kind === "video" ? source.id : undefined,
    x: position.x, y: position.y, width: 280, height: 220,
    title: kind === "video" ? "视频生成结果" : "图片修改结果", body: "",
    originalPrompt: kind === "image" ? source.originalPrompt : undefined,
    corePrompt: kind === "image" ? source.corePrompt : undefined,
    promptProfile: kind === "image" ? source.promptProfile : undefined,
    styleConstraint: kind === "image" ? source.styleConstraint : undefined,
    formConstraint: kind === "image" ? source.formConstraint : undefined,
    continuityConstraint: kind === "image" ? source.continuityConstraint : undefined,
    accent: kind === "video" ? "#ffb774" : "#8ee7ff",
    model: source.model ?? (kind === "video" ? "agnes-video-v2.0" : "gpt-image-2"),
    imageSettings: kind === "image" ? { ...(source.imageSettings ?? {}) } : undefined,
    videoSettings: kind === "video" ? { ...(source.videoSettings ?? {}) } : undefined,
    status: "queued", progress: 0,
  };
  nodes.push(revision);
  links.push({ from: source.id, to: revision.id, fromSide: "right", toSide: "left" });
  return revision;
}

export function removeResultNode(node: FlowNode, nodes: FlowNode[], links: FlowLink[]) {
  const index = nodes.indexOf(node);
  if (index >= 0) nodes.splice(index, 1);
  for (let linkIndex = links.length-1; linkIndex >= 0; linkIndex--)
    if (links[linkIndex].from === node.id || links[linkIndex].to === node.id) links.splice(linkIndex, 1);
}
