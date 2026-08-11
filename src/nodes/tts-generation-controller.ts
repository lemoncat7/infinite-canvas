import type { FlowLink, FlowNode } from "./node-types";
import { makeNodePublicId } from "./node-service";
import { findOutputPosition } from "./generation-node-lifecycle";
import { synthesizeTts } from "../services/tts";

type Tone = "success" | "warning" | "error" | "info";

type TtsGenerationOptions = {
  nodes: FlowNode[];
  links: FlowLink[];
  getProjectId: () => string;
  allocateNodeId: () => number | null;
  updateEditor: () => void;
  draw: () => void;
  save: () => void;
  reloadAssets: () => void | Promise<void>;
  toast: (message: string, tone: Tone) => void;
};

export class TtsGenerationController {
  private readonly previews = new Map<number, HTMLAudioElement>();

  constructor(private readonly options: TtsGenerationOptions) {}

  async preview(voice: FlowNode) {
    const existing = this.previews.get(voice.id);
    if (existing) {
      this.releasePreview(voice.id, existing);
      this.options.toast("已停止试听", "info");
      return;
    }
    const params = new URLSearchParams({
      projectId: this.options.getProjectId(),
      providerId: voice.voiceSettings?.providerId || "easyvoice-local",
      text: `${voice.voiceSettings?.roleName || "角色"}的声音已经准备好了。`,
      voiceId: voice.voiceSettings?.voiceId || "zh-CN-XiaoxiaoNeural",
      speed: String(voice.voiceSettings?.defaultSpeed ?? 1),
      pitch: String(voice.voiceSettings?.pitch ?? 0),
      volume: String(voice.voiceSettings?.volume ?? 1),
      t: String(Date.now()),
    });
    const audio = new Audio(`/api/tts/preview?${params}`);
    audio.preload = "none";
    this.previews.set(voice.id, audio);
    this.options.toast("正在连接流式试听", "info");
    try {
      await new Promise<void>((resolve, reject) => {
        audio.onplaying = () => this.options.toast("正在流式试听", "success");
        audio.onended = () => resolve();
        audio.onerror = () => reject(new Error("流式试听加载失败"));
        void audio.play().catch(reject);
      });
    } catch (error) {
      this.options.toast(error instanceof Error ? error.message : "试听失败", "error");
    } finally {
      if (this.previews.get(voice.id) === audio) this.releasePreview(voice.id, audio);
    }
  }

  async generate(source: FlowNode) {
    const voice = this.connectedVoice(source);
    if (!voice) return this.options.toast("请先连接一张语音配置卡片", "warning");
    if (!source.body.trim()) return this.options.toast("请先填写需要生成的文本", "warning");
    if (source.status === "running" || source.status === "queued") return;
    source.status = "running";
    source.progress = 15;
    this.options.updateEditor();
    this.options.draw();
    try {
      const response = await synthesizeTts(this.options.getProjectId(), source, voice, source.body.trim());
      const result = (await response.json()) as { assetUrl: string; duration?: number; provider?: string; voiceId?: string };
      let audioNode = this.options.links
        .filter((link) => link.from === source.id)
        .map((link) => this.options.nodes.find((node) => node.id === link.to))
        .find((node): node is FlowNode => node?.kind === "audio");
      if (!audioNode) audioNode = this.createAudioNode(source, voice, result);
      else this.updateAudioNode(audioNode, source, voice, result);
      source.status = "succeeded";
      source.progress = 100;
      this.options.save();
      this.options.draw();
      void this.options.reloadAssets();
      this.options.toast("语音已生成并加入资产库", "success");
    } catch (error) {
      source.status = "failed";
      source.progress = 0;
      this.options.toast(error instanceof Error ? error.message : "语音生成失败", "error");
    } finally {
      if (source.status === "running") {
        source.status = "idle";
        source.progress = 0;
      }
      this.options.updateEditor();
      this.options.save();
      this.options.draw();
    }
  }

  connectedVoice(ttsNode: FlowNode) {
    return this.options.links
      .filter((link) => link.to === ttsNode.id)
      .map((link) => this.options.nodes.find((node) => node.id === link.from))
      .find((node): node is FlowNode => node?.kind === "voice");
  }

  private createAudioNode(source: FlowNode, voice: FlowNode, result: { assetUrl: string; duration?: number; provider?: string }) {
    const id = this.options.allocateNodeId();
    if (id === null) throw new Error("无法创建音频结果卡片");
    const position = findOutputPosition(source, this.options.nodes);
    const audioNode: FlowNode = {
      id,
      publicId: makeNodePublicId("audio"),
      kind: "audio",
      role: "result",
      sourceNodeId: source.id,
      x: position.x,
      y: position.y,
      width: 300,
      height: 180,
      title: `音频 · ${voice.voiceSettings?.roleName || "语音"}`,
      body: source.body,
      accent: "#8b9fe8",
      model: result.provider || voice.voiceSettings?.providerId || "easyvoice-local",
      mediaUrl: result.assetUrl,
      status: "succeeded",
      progress: 100,
      ttsSettings: { ...(source.ttsSettings || {}), duration: Number(result.duration) || undefined },
    };
    this.options.nodes.push(audioNode);
    this.options.links.push({ from: source.id, to: audioNode.id, fromSide: "right", toSide: "left" });
    return audioNode;
  }

  private updateAudioNode(audioNode: FlowNode, source: FlowNode, voice: FlowNode, result: { assetUrl: string; duration?: number; provider?: string }) {
    audioNode.title = `音频 · ${voice.voiceSettings?.roleName || "语音"}`;
    audioNode.body = source.body;
    audioNode.model = result.provider || voice.voiceSettings?.providerId || "easyvoice-local";
    audioNode.mediaUrl = result.assetUrl;
    audioNode.status = "succeeded";
    audioNode.progress = 100;
    audioNode.ttsSettings = { ...(source.ttsSettings || {}), duration: Number(result.duration) || undefined };
  }

  private releasePreview(id: number, audio: HTMLAudioElement) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    this.previews.delete(id);
  }
}
