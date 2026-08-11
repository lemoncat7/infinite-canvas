import type { FlowLink, FlowNode, NodeKind, Point } from "./node-types";
import type { PromptAgentResult } from "./comic-types";
import {
  configurePromptAgentNode,
  connectPromptAgentInputs,
  planComicWorkflowLayout,
  promptAgentStepPosition,
  resolvePromptAgentInputs,
} from "./prompt-agent-workflow";

export type PromptAgentApplication = {
  appliedNodeId: number;
  undo: (() => void) | null;
};

type PromptAgentApplicationOptions = {
  nodes: FlowNode[];
  links: FlowLink[];
  getSources: () => FlowNode[];
  getSelectedId: () => number;
  setSelectedId: (id: number) => void;
  worldCenter: () => Point;
  addNode: (kind: NodeKind, position: Point, quiet?: boolean) => void;
  persist: () => void;
  draw: () => void;
  runWorkflow: () => void;
  loadVoices: (providerId: string) => void;
};

export class PromptAgentApplicationController {
  constructor(private readonly options: PromptAgentApplicationOptions) {}

  applyPlan(result: PromptAgentResult): PromptAgentApplication {
    const { nodes, links } = this.options;
    const sources = this.options.getSources();
    const current = sources[0];
    const kind = result.targetType || result.kind;
    const canUpdate = current && current.kind === kind && current.role !== "result" && !current.mediaUrl;
    const action = result.action === "update_current" && canUpdate
      ? "update_current"
      : result.action === "create_new"
        ? "create_new"
        : "create_child";
    const planned = (result.steps || [])
      .filter((step) => ["image", "video", "voice", "tts"].includes(step.kind) && step.prompt?.trim())
      .slice(0, 192);
    if (planned.length) return this.applySteps(result, planned, sources, current);

    let appliedNodeId = 0;
    let undo: (() => void) | null = null;
    if (action === "update_current" && current) {
      const before = { body: current.body, generationPrompt: current.generationPrompt, title: current.title };
      current.body = result.finalPrompt;
      current.generationPrompt = result.finalPrompt;
      current.title = kind === "video" ? "Agent · 视频任务" : "Agent · 图像任务";
      appliedNodeId = current.id;
      undo = () => {
        Object.assign(current, before);
        this.options.setSelectedId(current.id);
        this.commit();
      };
    } else {
      const anchor = action === "create_child" && current
        ? { x: current.x + current.width + 120, y: current.y + current.height / 2 }
        : this.options.worldCenter();
      this.options.addNode(kind, anchor);
      const created = nodes.find((node) => node.id === this.options.getSelectedId());
      if (!created) return { appliedNodeId: 0, undo: null };
      created.body = result.finalPrompt;
      created.generationPrompt = result.finalPrompt;
      created.title = kind === "video" ? "Agent · 视频任务" : "Agent · 图像任务";
      appliedNodeId = created.id;
      if (action === "create_child")
        sources.filter((source) => source.id !== created.id).forEach((source, inputIndex) => {
          if (!links.some((link) => link.from === source.id && link.to === created.id))
            links.push({ from: source.id, to: created.id, fromSide: "right", toSide: "left", inputOrder: inputIndex + 1 });
        });
      undo = () => this.removeCreated([created.id]);
    }
    this.options.setSelectedId(appliedNodeId);
    this.commit();
    return { appliedNodeId, undo };
  }

  applyVoice(result: PromptAgentResult): PromptAgentApplication {
    const config = result.voiceConfig || {};
    this.options.addNode("voice", this.options.worldCenter());
    const created = this.options.nodes.find((node) => node.id === this.options.getSelectedId());
    if (!created) return { appliedNodeId: 0, undo: null };
    const speed = Math.max(0.5, Math.min(2, Number(config.speed) || 1));
    const pitch = Math.max(-50, Math.min(50, Number(config.pitch) || 0));
    const volume = Math.max(0, Math.min(2, Number(config.volume) || 1));
    created.title = `语音配置 · ${String(config.roleName || "新角色").trim() || "新角色"}`;
    created.body = String(result.finalPrompt || config.tone || "自然").trim();
    created.voiceSettings = {
      providerId: "easyvoice-local",
      voiceId: String(config.voiceId || "zh-CN-XiaoxiaoNeural"),
      language: "zh-CN",
      defaultSpeed: speed,
      pitch,
      volume,
      roleName: String(config.roleName || "").trim(),
      tone: String(config.tone || "自然").trim(),
    };
    this.options.loadVoices("easyvoice-local");
    this.commit();
    return { appliedNodeId: created.id, undo: () => this.removeCreated([created.id]) };
  }

  private applySteps(
    result: PromptAgentResult,
    planned: NonNullable<PromptAgentResult["steps"]>,
    sources: FlowNode[],
    current: FlowNode | undefined,
  ): PromptAgentApplication {
    const { nodes, links } = this.options;
    const imageSources = sources.filter((source) => source.kind === "image" && Boolean(source.mediaUrl));
    const createdIds: number[] = [];
    const createdNodes: FlowNode[] = [];
    const rightEdge = nodes.length ? Math.max(...nodes.map((node) => node.x + node.width)) : 0;
    const center = this.options.worldCenter();
    const base = { x: rightEdge + 230, y: current ? current.y + 80 : center.y };
    const comicLayout = planComicWorkflowLayout(planned, base);
    planned.forEach((step, index) => {
      const comicWorkflow = result.layout === "comic-workflow";
      const position = promptAgentStepPosition({ index, step, layout: result.layout, base, comic: comicLayout });
      this.options.addNode(step.kind, position, true);
      const created = nodes.find((node) => node.id === this.options.getSelectedId());
      if (!created) return;
      configurePromptAgentNode({ node: created, step, index, comicWorkflow, shouldGenerate: Boolean(result.shouldGenerate) });
      createdIds.push(created.id);
      createdNodes.push(created);
      connectPromptAgentInputs(created, resolvePromptAgentInputs({ step, stepIndex: index, imageSources, createdNodes, comicWorkflow }), links);
    });
    const appliedNodeId = createdIds[0] || 0;
    this.options.setSelectedId(appliedNodeId);
    this.commit();
    if (result.shouldGenerate) queueMicrotask(this.options.runWorkflow);
    return { appliedNodeId, undo: () => this.removeCreated(createdIds) };
  }

  private removeCreated(ids: number[]) {
    const { nodes, links } = this.options;
    for (let index = links.length - 1; index >= 0; index--)
      if (ids.includes(links[index].from) || ids.includes(links[index].to)) links.splice(index, 1);
    for (let index = nodes.length - 1; index >= 0; index--)
      if (ids.includes(nodes[index].id)) nodes.splice(index, 1);
    if (ids.includes(this.options.getSelectedId())) this.options.setSelectedId(0);
    this.commit();
  }

  private commit() {
    this.options.persist();
    this.options.draw();
  }
}
