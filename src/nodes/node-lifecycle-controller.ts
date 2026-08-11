import type { GenerationCapabilities } from "./node-types";
import type { FlowLink, FlowNode, NodeKind, Point } from "./node-types";
import { createNode, makeNodePublicId } from "./node-service";

type GuideMessage = {
  key: string;
  title: string;
  detail: string;
  tone: "online";
  duration: number;
  actions: Array<{ label: string; primary: boolean; run: () => void }>;
};

export class NodeLifecycleController {
  constructor(private readonly options: {
    nodes: FlowNode[];
    links: FlowLink[];
    allocateId: () => number | null;
    capabilities: () => GenerationCapabilities;
    center: () => Point;
    selectedId: () => number;
    select: (id: number) => void;
    batchIds: Set<number>;
    updateEditor: () => void;
    save: () => void;
    draw: () => void;
    hasActiveGeneration: () => boolean;
    cascadeIds: (seed: Set<number>) => Set<number>;
    confirmDelete: (input: { title: string; description: string; confirm: string; danger: boolean }) => Promise<boolean>;
    notify: (message: string, tone: "warning" | "success") => void;
    guide: (message: GuideMessage) => void;
    hideGuide: (key: string) => void;
    undo: () => void | Promise<unknown>;
  }) {}

  add(kind: NodeKind = "image", position?: Point, deferRender = false) {
    const id = this.options.allocateId();
    if (id === null) return;
    this.options.nodes.push(createNode(id, kind, position ?? this.options.center(), this.options.capabilities()));
    this.options.select(id);
    if (!deferRender) {
      this.options.updateEditor();
      this.options.save();
      this.options.draw();
    }
  }

  addMedia(url: string, title: string, position: Point, kind: "image" | "video" = "image") {
    const id = this.options.allocateId();
    if (id === null) return;
    const capabilities = this.options.capabilities();
    this.options.nodes.push({
      id,
      publicId: makeNodePublicId(kind),
      kind,
      role: kind === "video" ? "result" : undefined,
      x: position.x - 145,
      y: position.y - 120,
      width: 290,
      height: 240,
      title,
      body: "",
      accent: kind === "video" ? "#ffb774" : "#8ee7ff",
      mediaUrl: url,
      model: kind === "video"
        ? (capabilities.video?.defaultModel ?? "agnes-video-v2.0")
        : (capabilities.image?.defaultModel ?? "gpt-image-2"),
      videoSettings: kind === "video"
        ? { seconds: "5", resolution: "720p", aspectRatio: "16:9" }
        : undefined,
    });
    this.options.select(id);
    this.options.updateEditor();
    this.options.save();
    this.options.draw();
  }

  async deleteSelected() {
    const selectedId = this.options.selectedId();
    const target = this.options.nodes.find((node) => node.id === selectedId);
    if (!target) return;
    if (this.options.hasActiveGeneration()) {
      this.options.notify("画布正在生成，任务完成后即可删除节点", "warning");
      return;
    }
    const targets = this.options.cascadeIds(new Set([target.id]));
    const cascadeCount = targets.size - 1;
    const title = target.title || "未命名卡片";
    const confirmed = await this.options.confirmDelete({
      title: "删除这张卡片？",
      description: cascadeCount
        ? `将删除“${title}”，并连带清理 ${cascadeCount} 张只依赖它的下游卡片。此操作无法撤销。`
        : `将删除“${title}”。此操作无法撤销。`,
      confirm: cascadeCount ? `删除 ${targets.size} 张卡片` : "确认删除",
      danger: true,
    });
    if (!confirmed || !this.options.nodes.some((node) => node.id === selectedId)) return;
    for (let index = this.options.nodes.length - 1; index >= 0; index--)
      if (targets.has(this.options.nodes[index].id)) this.options.nodes.splice(index, 1);
    for (let index = this.options.links.length - 1; index >= 0; index--)
      if (targets.has(this.options.links[index].from) || targets.has(this.options.links[index].to))
        this.options.links.splice(index, 1);
    this.options.select(0);
    targets.forEach((id) => this.options.batchIds.delete(id));
    this.options.updateEditor();
    this.options.save();
    this.options.draw();
    this.options.guide({
      key: "delete-cascade",
      title: `已删除 ${targets.size} 张卡片`,
      detail: cascadeCount ? `同时清理了 ${cascadeCount} 张只依赖该上游的下游卡片。` : "需要恢复时可立即撤销。",
      tone: "online",
      duration: 5200,
      actions: [{
        label: "撤销",
        primary: true,
        run: () => {
          this.options.hideGuide("delete-cascade");
          void this.options.undo();
        },
      }],
    });
  }
}

export function defaultNodeCopy(kind: NodeKind) {
  return kind === "prompt"
    ? "双击记录标签或说明"
    : kind === "image"
      ? "空图节点"
      : kind === "video"
        ? "连接图片并填写描述，生成视频"
        : kind === "voice"
          ? "为 Base 角色固定音色"
          : kind === "tts"
            ? "连接语音配置并填写台词"
            : kind === "audio"
              ? "生成后的音频结果"
              : "双击添加说明文字";
}
