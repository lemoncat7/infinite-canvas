import type { FlowNode } from "./node-types";

export class ImageAssetController {
  constructor(private readonly options: {
    nodes: FlowNode[];
    select: (id: number) => void;
    save: () => void;
    updateEditor: () => void;
    draw: () => void;
    notify: (message: string, tone: "warning" | "success") => void;
    clearLibraryTarget: () => void;
    openUpload: (nodeId: number) => void;
    openLibraryPanel: () => void;
    setLibraryTarget: (nodeId: number) => void;
    selectImageFilter: () => void;
    loadAssets: () => Promise<unknown>;
    renderAssets: () => void;
  }) {}

  private node(nodeId: number) {
    return this.options.nodes.find((item) => item.id === nodeId && item.kind === "image");
  }

  private generating(node: FlowNode) {
    return node.status === "queued" || node.status === "running" || (node.agentAuto && node.status === "waiting");
  }

  allowsSourceChange(nodeId: number) {
    const node = this.node(nodeId);
    if (!node) return false;
    if (this.generating(node)) {
      this.options.notify("生成期间不可更换素材", "warning");
      return false;
    }
    return true;
  }

  attach(nodeId: number, asset: { url: string; name: string }) {
    const node = this.node(nodeId);
    if (!node) {
      this.options.notify("目标图片节点已不存在", "warning");
      return;
    }
    if (this.generating(node)) {
      this.options.notify("节点已经进入生成队列，未替换素材", "warning");
      return;
    }
    node.mediaUrl = asset.url;
    node.title = asset.name || node.title;
    node.generationPrompt = undefined;
    node.status = "idle";
    node.progress = 0;
    this.options.select(node.id);
    this.options.save();
    this.options.updateEditor();
    this.options.draw();
    this.options.notify("图片已放入当前节点", "success");
  }

  beginUpload(nodeId: number) {
    if (!this.allowsSourceChange(nodeId)) return;
    this.options.clearLibraryTarget();
    this.options.openUpload(nodeId);
  }

  async beginLibrary(nodeId: number) {
    if (!this.allowsSourceChange(nodeId)) return;
    this.options.openLibraryPanel();
    this.options.setLibraryTarget(nodeId);
    this.options.selectImageFilter();
    await this.options.loadAssets();
    this.options.renderAssets();
  }
}
