import type { FlowLink, FlowNode } from "./node-types";
import { composeImageGenerationPrompt } from "./image-node";
import { orderedImageReferences } from "./ordered-image-references";

export type PreparedGenerationRequest = {
  prompt: string;
  originalPrompt: string;
  corePrompt?: string;
  inputUrls: string[];
  parameters: Record<string, unknown>;
};

function orderedUpstream(source: FlowNode, output: FlowNode, nodes: FlowNode[], links: FlowLink[]) {
  const orderedImages = orderedImageReferences(source.id, nodes, links, output.id);
  const imageIds = new Set(orderedImages.map((item) => item.source.id));
  const other = links
    .filter((link) => link.to === source.id && link.from !== output.id && !imageIds.has(link.from))
    .map((link) => nodes.find((item) => item.id === link.from))
    .filter((item): item is FlowNode => Boolean(item));
  return orderedImages.map((item) => item.source).concat(other);
}

function cleanOriginalPrompt(value: string) {
  return value
    .replace(/\n?严格参考(?:连接|实际输入)素材：[^\n]*不得互换或重新设计。?/g, "")
    .replace(/\n?参考图1「[^\n]*保持人物身份、服装、道具和场景一致。?/g, "")
    .replace(/\n?角色实例约束：[^\n]*/g, "")
    .trim();
}

function generationParameters(node: FlowNode): Record<string, unknown> {
  if (node.kind !== "video")
    return Object.fromEntries(Object.entries(node.imageSettings ?? {}).filter(([, value]) => value && value !== "auto"));
  return Object.fromEntries(Object.entries({
    seconds: node.videoSettings?.seconds,
    resolution: node.videoSettings?.resolution,
    aspect_ratio: node.videoSettings?.aspectRatio,
    reference_mode: node.videoSettings?.referenceMode ?? "references",
    seed: node.videoSettings?.seed,
    negative_prompt: node.videoSettings?.referenceMode === "keyframes"
      ? "extra action, separate attack, weapon separation, pose reset, character redesign, identity change, clothing change, prop change, scene change, camera-axis break, text, subtitle, watermark"
      : "",
  }).filter(([, value]) => value !== undefined && value !== "" && value !== "auto"));
}

export function prepareGenerationRequest(
  source: FlowNode,
  output: FlowNode,
  nodes: FlowNode[],
  links: FlowLink[],
  normalizePrompt: (value: string) => string,
): PreparedGenerationRequest {
  const upstream = orderedUpstream(source, output, nodes, links);
  const inputMedia = (source.kind === "image" && source.mediaUrl ? [source] : [])
    .concat(upstream.filter((item) => Boolean(item.mediaUrl)));
  const uniqueMedia = inputMedia.filter((item, index, list) => list.findIndex((candidate) => candidate.mediaUrl === item.mediaUrl) === index);
  const effectiveMedia = source.kind === "image" && source.promptProfile === "storyboard" ? uniqueMedia.slice(0, 2) : uniqueMedia;
  const inputUrls = source.kind === "video"
    ? upstream.filter((item) => item.kind === "image").map((item) => item.mediaUrl).filter((url): url is string => Boolean(url)).filter((url, index, list) => list.indexOf(url) === index)
    : effectiveMedia.map((item) => item.mediaUrl!).filter(Boolean);
  const originalPrompt = cleanOriginalPrompt(normalizePrompt(source.body));
  const imagePrompt = source.kind === "image" ? composeImageGenerationPrompt(source, originalPrompt, effectiveMedia) : null;
  return {
    prompt: imagePrompt?.prompt ?? originalPrompt,
    originalPrompt,
    corePrompt: imagePrompt?.corePrompt,
    inputUrls,
    parameters: generationParameters(output),
  };
}
