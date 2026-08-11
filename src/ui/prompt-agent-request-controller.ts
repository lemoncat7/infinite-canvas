import type { FlowNode } from "../nodes/node-types";
import type { PromptAgentResult } from "../nodes/comic-types";
import { requestPromptAgent } from "../services/prompt-agent";
import type { PromptAgentControls } from "./prompt-agent-controls";
import type { PromptAgentApplication } from "../nodes/prompt-agent-application";

type ToastTone = "success" | "warning" | "error";

type PromptAgentRequestOptions = {
  panel: HTMLElement;
  controls: PromptAgentControls;
  getNodes: () => FlowNode[];
  getSelectedId: () => number;
  getContexts: () => FlowNode[];
  applyPlan: (result: PromptAgentResult) => PromptAgentApplication;
  applyVoice: (result: PromptAgentResult) => PromptAgentApplication;
  playMeteor: (nodeId: number) => void;
  locateNode: (nodeId: number) => void;
  updateEditor: () => void;
  persist: () => void;
  draw: () => void;
  decodePrompt: (value: string) => string;
  disperse: () => void;
  showToast: (message: string, tone: ToastTone) => void;
};

export class PromptAgentRequestController {
  private abortController: AbortController | null = null;
  private version = 0;
  private result: PromptAgentResult | null = null;
  private appliedNodeId = 0;
  private undo: (() => void) | null = null;

  constructor(private readonly options: PromptAgentRequestOptions) {
    this.bindEvents();
  }

  get busy() { return Boolean(this.abortController); }

  clearResult() {
    this.result = null;
    this.undo = null;
    this.appliedNodeId = 0;
    const article = this.article;
    this.options.panel.classList.remove("prompt-result-open");
    article.hidden = true;
    article.querySelector<HTMLElement>("[data-agent-prompt]")!.textContent = "";
    article.querySelector<HTMLElement>("[data-agent-summary]")!.textContent = "";
  }

  cancel() {
    if (this.abortController) this.abortController.abort();
    this.abortController = null;
    this.version++;
    this.unlock();
  }

  private bindEvents() {
    const submit = this.options.panel.querySelector<HTMLButtonElement>(".agent-submit")!;
    submit.addEventListener("click", (event) => {
      if (this.options.controls.mode !== "voice") return;
      event.stopImmediatePropagation();
      void this.submitVoice();
    });
    submit.addEventListener("click", () => void this.submitPrompt());
    this.options.panel.querySelector("[data-agent-copy]")!.addEventListener("click", () => void this.copy());
    this.options.panel.querySelector("[data-agent-apply]")!.addEventListener("click", () => this.applyToSelected());
    this.options.panel.querySelector("[data-agent-undo]")!.addEventListener("click", () => this.undoApplied());
    this.options.panel.querySelector("[data-agent-locate]")!.addEventListener("click", () => {
      if (this.appliedNodeId) this.options.locateNode(this.appliedNodeId);
    });
  }

  private async submitVoice() {
    const idea = this.textarea.value.trim();
    if (this.busy) return this.options.showToast("音色配置生成中，请等待完成", "warning");
    if (!idea) return this.options.showToast("先描述角色和想要的声音", "warning");
    const { controller, version } = this.begin("正在理解角色并匹配中文音色…", "正在匹配音色", false);
    try {
      const result = await requestPromptAgent({
        idea,
        kind: "image",
        promptMode: "voice",
        complexity: "simple",
        model: this.options.controls.modelSelect.value,
      }, controller.signal);
      if (version !== this.version) return;
      if (!result.voiceConfig) throw new Error("没有匹配到可用中文音色");
      this.result = result;
      const applied = this.options.applyVoice(result);
      this.setApplied(applied);
      this.options.playMeteor(applied.appliedNodeId);
      this.status.textContent = "音色配置已创建";
      this.textarea.value = "";
      this.options.showToast(result.summary || "音色配置卡片已创建", "success");
    } catch (error) {
      this.handleError(error, controller, version, "音色配置生成失败");
    } finally {
      this.finish(version);
    }
  }

  private async submitPrompt() {
    if (this.options.controls.mode === "voice") return;
    const idea = this.textarea.value.trim();
    const promptOnly = this.options.controls.mode !== "create";
    if (this.busy) return this.options.showToast("提示词生成中，请等待完成", "warning");
    if (!idea) return this.options.showToast(promptOnly ? "先描述需要生成提示词的镜头" : "先告诉我你想创造什么", "warning");
    const selected = this.options.getNodes().find((node) => node.id === this.options.getSelectedId());
    const contexts = this.options.getContexts();
    const promptKind = this.options.controls.mode === "agnes" || /视频|动态|动起来|镜头运动|运镜/.test(idea) ? "video" : "image";
    const { controller, version } = this.begin(
      promptOnly ? "正在理解镜头并生成提示词…" : "正在理解素材并规划画布…",
      "正在生成提示词",
      true,
    );
    try {
      const result = await requestPromptAgent({
        idea,
        kind: promptKind,
        promptMode: this.options.controls.mode,
        complexity: this.options.controls.complexity,
        context: contexts.map((node, index) => `${index === 0 ? "当前节点" : `参考节点${index + 1}`}「${node.title}」：${node.generationPrompt || node.body || "无文字说明"}`),
        visuals: contexts.filter((node) => node.kind === "image" && node.mediaUrl).map((node) => node.mediaUrl!),
        model: this.options.controls.modelSelect.value,
        target: selected ? {
          id: selected.id,
          kind: selected.kind,
          role: selected.role || "generator",
          hasMedia: Boolean(selected.mediaUrl),
          hasPrompt: Boolean((selected.generationPrompt || selected.body).trim()),
        } : null,
      }, controller.signal);
      if (version !== this.version) return;
      this.result = result;
      if (!promptOnly) {
        const applied = this.options.applyPlan(result);
        this.setApplied(applied);
        this.options.playMeteor(applied.appliedNodeId);
      } else {
        this.setApplied({ appliedNodeId: 0, undo: null });
      }
      this.renderResult(result, promptOnly, selected, contexts.length);
      this.status.textContent = promptOnly ? "提示词已生成" : "画布已更新";
      this.textarea.value = "";
      this.options.showToast(promptOnly ? "提示词已生成" : result.summary || "创作节点已准备", "success");
    } catch (error) {
      this.handleError(error, controller, version, promptOnly ? "提示词生成失败" : "创作规划失败");
    } finally {
      this.finish(version);
    }
  }

  private renderResult(result: PromptAgentResult, promptOnly: boolean, selected: FlowNode | undefined, contextCount: number) {
    const article = this.article;
    article.querySelector<HTMLElement>("[data-agent-prompt]")!.textContent = result.finalPrompt;
    article.querySelector<HTMLElement>("[data-agent-summary]")!.textContent = promptOnly
      ? this.options.controls.mode === "agnes" ? "Agnes Video v2.0 提示词已生成" : "通用提示词已生成"
      : result.summary || "已根据你的素材准备好画布节点";
    article.querySelector("small")!.textContent = `${result.model} · ${promptOnly ? (this.options.controls.mode === "agnes" ? "Agnes" : "通用") : (result.targetType || result.kind) === "video" ? "视频" : "图像"} · ${contextCount} 个参考`;
    article.querySelector<HTMLButtonElement>("[data-agent-undo]")!.hidden = promptOnly || !this.undo;
    article.querySelector<HTMLButtonElement>("[data-agent-apply]")!.hidden = !promptOnly || !selected || !["image", "video"].includes(selected.kind) || selected.role === "result";
    article.querySelector<HTMLButtonElement>("[data-agent-locate]")!.hidden = promptOnly;
    article.hidden = false;
    this.options.panel.classList.toggle("prompt-result-open", promptOnly);
  }

  private async copy() {
    if (!this.result) return;
    await navigator.clipboard.writeText(this.options.decodePrompt(this.result.finalPrompt));
    this.options.showToast("提示词已复制", "success");
    this.options.disperse();
  }

  private applyToSelected() {
    if (!this.result) return;
    const node = this.options.getNodes().find((item) => item.id === this.options.getSelectedId());
    if (!node || !["image", "video"].includes(node.kind) || node.role === "result")
      return this.options.showToast("请先选择可编辑的生成卡片", "warning");
    node.body = this.result.finalPrompt;
    node.originalPrompt = this.result.finalPrompt;
    this.options.updateEditor();
    this.options.persist();
    this.options.draw();
    this.options.showToast("提示词已写入选中卡片", "success");
    this.options.disperse();
  }

  private undoApplied() {
    if (!this.undo) return;
    this.undo();
    this.undo = null;
    this.options.panel.querySelector<HTMLButtonElement>("[data-agent-undo]")!.hidden = true;
    this.status.textContent = "已撤销刚才的画布操作";
  }

  private begin(message: string, title: string, lockComic: boolean) {
    const controller = new AbortController();
    const version = ++this.version;
    this.abortController = controller;
    this.textarea.disabled = true;
    this.submit.disabled = true;
    this.modeTrigger.disabled = true;
    if (lockComic) this.comicEntry.disabled = true;
    this.options.panel.classList.add("is-busy");
    this.submit.classList.add("is-running");
    this.submit.title = title;
    this.status.textContent = message;
    this.article.hidden = true;
    this.options.panel.classList.remove("prompt-result-open");
    return { controller, version };
  }

  private finish(version: number) {
    if (version !== this.version) return;
    this.abortController = null;
    this.unlock();
  }

  private unlock() {
    this.textarea.disabled = false;
    this.submit.disabled = false;
    this.modeTrigger.disabled = false;
    this.comicEntry.disabled = false;
    this.options.panel.classList.remove("is-busy");
    this.submit.classList.remove("is-running");
    this.submit.title = "";
  }

  private handleError(error: unknown, controller: AbortController, version: number, fallback: string) {
    if (controller.signal.aborted || version !== this.version) return;
    const message = error instanceof Error ? error.message : fallback;
    this.status.textContent = message;
    this.options.showToast(message, "error");
  }

  private setApplied(value: PromptAgentApplication) {
    this.appliedNodeId = value.appliedNodeId;
    this.undo = value.undo;
  }

  private get textarea() { return this.options.panel.querySelector<HTMLTextAreaElement>("textarea")!; }
  private get submit() { return this.options.panel.querySelector<HTMLButtonElement>(".agent-submit")!; }
  private get modeTrigger() { return this.options.panel.querySelector<HTMLButtonElement>("[data-agent-mode-trigger]")!; }
  private get comicEntry() { return this.options.panel.querySelector<HTMLButtonElement>(".agent-comic-entry")!; }
  private get status() { return this.options.panel.querySelector<HTMLOutputElement>(".agent-status")!; }
  private get article() { return this.options.panel.querySelector<HTMLElement>("article")!; }
}
