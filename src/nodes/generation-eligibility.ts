import type { FlowNode } from "./node-types";

function modelCost(node: FlowNode) {
  if (node.model === "grok-imagine-video-1.5-preview") return 2;
  if (node.model === "grok-imagine-image") return 1;
  return 0;
}

export function canGenerateNode(
  node: FlowNode,
  options: { availableCredits: number; hasConnectedVoice: boolean },
) {
  if (node.kind === "tts")
    return Boolean(node.body.trim() && options.hasConnectedVoice);
  return (
    node.model !== "gemini-3.1-flash-image" &&
    (node.kind === "image" || node.kind === "video") &&
    node.role !== "result" &&
    options.availableCredits >= modelCost(node) &&
    Boolean(node.body.trim())
  );
}

export function generationBlockedReason(
  node: FlowNode,
  options: { availableCredits: number; hasConnectedVoice: boolean },
) {
  if (node.kind === "tts")
    return !options.hasConnectedVoice
      ? "请先连接一张语音配置卡片"
      : !node.body.trim()
        ? "请先填写需要生成的文本"
        : "";
  if (node.kind !== "image" && node.kind !== "video")
    return "当前卡片不支持生成";
  if (node.role === "result")
    return node.kind === "video"
      ? "已生成的视频节点仅用于播放"
      : "生成结果节点不能再次生成";
  if ((node.status === "queued" || node.status === "running") && node.jobId)
    return "当前任务正在生成，请稍候";
  if (node.model === "gemini-3.1-flash-image")
    return "Gemini 图片模型仍在适配中，请选择其他模型";
  const cost = modelCost(node);
  if (options.availableCredits < cost)
    return `创作点数不足，当前模型需要 ${cost} 点`;
  if (!node.body.trim()) return "请先填写图片描述，再开始生成";
  return "";
}
