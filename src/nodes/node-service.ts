import type {
  FlowNode,
  GenerationCapabilities,
  NodeKind,
  Point,
} from "./node-types";

export function makeNodePublicId(kind: NodeKind) {
  const type = kind === "prompt" ? "text" : kind;
  return `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createNode(
  id: number,
  kind: NodeKind,
  center: Point,
  capabilities: GenerationCapabilities,
): FlowNode {
  const titles: Record<NodeKind, string> = {
      prompt: "标签",
      image: "文生图 · 新任务",
      video: "视频生成 · 新任务",
      note: "创作便签",
      voice: "语音配置 · 新角色",
      tts: "TTS 文本生成",
      audio: "音频结果",
    },
    width =
      kind === "video" || kind === "voice"
        ? 290
        : kind === "tts" || kind === "audio"
          ? 300
          : kind === "image"
            ? 280
            : 265,
    height =
      kind === "video" || kind === "voice"
        ? 225
        : kind === "tts"
          ? 270
          : kind === "audio"
            ? 180
            : kind === "image"
              ? 220
              : kind === "note"
                ? 135
                : 175;

  return {
    id,
    publicId: makeNodePublicId(kind),
    kind,
    x: center.x - width / 2,
    y: center.y - height / 2,
    width,
    height,
    title: titles[kind],
    body:
      kind === "image" || kind === "video" || kind === "tts"
        ? ""
        : kind === "prompt"
          ? "记录标签、分组标题或画布备注"
          : kind === "voice"
            ? "为角色选择固定音色"
            : kind === "audio"
              ? "生成完成后可试听与下载"
              : "等待配置模型与生成参数",
    accent:
      kind === "voice"
        ? "#78c8d8"
        : kind === "tts"
          ? "#7da9df"
          : kind === "audio"
            ? "#8b9fe8"
            : kind === "video"
              ? "#88bcd4"
              : kind === "prompt"
                ? "#8fb9c8"
                : kind === "note"
                  ? "#88b7b1"
                  : "#8ee7ff",
    model:
      kind === "video"
        ? (capabilities.video?.defaultModel ?? "agnes-video-v2.0")
        : kind === "voice" || kind === "tts"
          ? "easyvoice-local"
          : kind === "audio"
            ? undefined
            : (capabilities.image?.defaultModel ?? "gpt-image-2"),
    videoSettings:
      kind === "video"
        ? {
            seconds: String(capabilities.video?.seconds.default ?? 5),
            resolution: capabilities.video?.resolutions[1] ?? "720p",
            aspectRatio: capabilities.video?.aspectRatios.at(-1) ?? "16:9",
          }
        : undefined,
    voiceSettings:
      kind === "voice"
        ? {
            providerId: "easyvoice-local",
            voiceId: "zh-CN-XiaoxiaoNeural",
            language: "zh-CN",
            defaultSpeed: 1,
            pitch: 0,
            volume: 1,
            roleName: "",
            tone: "自然",
          }
        : undefined,
    ttsSettings:
      kind === "tts"
        ? { emotion: "中性", speed: 1, volume: 1, format: "mp3" }
        : undefined,
  };
}
