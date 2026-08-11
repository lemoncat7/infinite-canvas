import type { FlowLink, FlowNode } from "../nodes/node-types";
import { normalizeCanvasLinks, type CanvasSyncSnapshot } from "./sync";

type CanvasDocument = {
  nodes: FlowNode[];
  links: Array<FlowLink | [number, number]>;
  camera?: { x: number; y: number; zoom: number };
  version?: number;
  updatedAt?: string;
};

export function normalizeCanvasDocument(
  input: CanvasDocument,
  fallbackCamera: { x: number; y: number; zoom: number },
  normalizePrompt: (value: string) => string,
) {
  if (!Number.isSafeInteger(input.version) || Number(input.version) < 1 || !Array.isArray(input.nodes) || !Array.isArray(input.links))
    throw new Error("invalid canvas envelope");
  const ids = new Set<number>();
  for (const node of input.nodes) {
    if (!node || !Number.isFinite(node.id) || ids.has(node.id)) throw new Error("invalid canvas nodes");
    ids.add(node.id);
  }
  for (const link of input.links) {
    const from = Array.isArray(link) ? link[0] : link?.from, to = Array.isArray(link) ? link[1] : link?.to;
    if (!Number.isFinite(from) || !Number.isFinite(to) || !ids.has(Number(from)) || !ids.has(Number(to))) throw new Error("invalid canvas links");
  }
  const nodes = structuredClone(input.nodes);
  for (const node of nodes) {
    if (node.kind === "video" && (!node.model || node.model === "Kling 2.1")) node.model = "agnes-video-v2.0";
    if (node.kind === "video" && node.role === "result") node.body = "";
    if (node.kind === "voice" && (node.status === "running" || node.status === "queued")) Object.assign(node, { status: "idle", progress: 0 });
    if (node.kind === "prompt" && node.title === "文本") node.title = "标签";
    if (node.kind === "prompt" && node.body === "输入你的创意描述") node.body = "记录标签、分组标题或画布备注";
    if ((node.kind === "image" || node.kind === "video") && !node.mediaUrl && node.body === "等待配置模型与生成参数") node.body = "";
    if (node.kind === "image" && (node.status === "canceled" || node.status === "failed") && !node.body.trim() && (node.originalPrompt || node.generationPrompt)) {
      node.body = normalizePrompt(node.originalPrompt || node.generationPrompt || ""); node.progress = 0;
      if (node.status === "canceled") delete node.jobId;
    }
    if (node.kind === "image" && !node.jobId && (node.status === "queued" || node.status === "running") && node.body.trim())
      Object.assign(node, { status: "waiting", progress: 0, agentAuto: true });
    if (node.kind === "video") node.videoSettings = { seconds: "5", resolution: "720p", aspectRatio: "16:9", ...(node.videoSettings ?? {}) };
    if (node.kind === "video" && node.role !== "result") { node.status = "idle"; node.progress = 0; delete node.jobId; }
    if (node.imageSettings?.size && !["auto","1024x1024","1344x1008","1008x1344","1536x1024","1024x1536","1536x864","864x1536"].includes(node.imageSettings.size)) node.imageSettings.size = "auto";
  }
  const links = normalizeCanvasLinks(input.links);
  const baseline: CanvasSyncSnapshot = {
    nodes: structuredClone(input.nodes),
    links,
    camera: input.camera ? { ...input.camera } : { ...fallbackCamera },
    version: Number(input.version),
    updatedAt: input.updatedAt || "",
  };
  return { nodes, links, baseline };
}
