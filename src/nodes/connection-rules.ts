import type { FlowLink, FlowNode, PortSide } from "./node-types";

export class ConnectionRules {
  constructor(private readonly options: {
    nodes: FlowNode[];
    links: FlowLink[];
    notify: (message: string) => void;
  }) {}

  create(firstId: number, firstSide: PortSide, secondId: number, secondSide: PortSide): FlowLink | null {
    if (firstId === secondId || firstSide !== "right" || secondSide !== "left") return null;
    const source = this.options.nodes.find((node) => node.id === firstId);
    const target = this.options.nodes.find((node) => node.id === secondId);
    if (!source || !target) return null;
    if (target.kind === "voice" && (source.kind !== "image" || !/\bBase\b/i.test(source.title)))
      return this.reject("语音配置只能关联角色 Base 卡片");
    if (target.kind === "voice" && this.options.links.some((link) => link.to === target.id))
      return this.reject("一个固定音色只能关联一个 Base 角色");
    if (target.kind === "tts" && source.kind !== "voice")
      return this.reject("TTS 文本卡片只能接收语音配置");
    if (target.kind === "tts" && this.options.links.some((link) =>
      link.to === target.id && this.options.nodes.find((node) => node.id === link.from)?.kind === "voice"))
      return this.reject("一张 TTS 卡片只能连接一个固定音色");
    if (target.kind === "audio") return this.reject("音频结果由 TTS 生成，无需手动连接");
    return { from: firstId, to: secondId, fromSide: "right", toSide: "left" };
  }

  private reject(message: string): null {
    this.options.notify(message);
    return null;
  }
}
