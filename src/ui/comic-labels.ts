import type { FlowNode } from "../nodes/node-types";
import type { ComicPlan } from "../nodes/comic-types";
import { briefFromComicPlan } from "../nodes/comic-format";
import type { ComicSessionState } from "../services/comic-session-state";

interface ComicLabelControllerOptions {
  studio: HTMLElement;
  state: ComicSessionState;
  getLabels: () => FlowNode[];
  resetConversation: (clearPlan: boolean) => void;
  renderPlan: (plan: ComicPlan) => void;
  renderBrief: () => void;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export class ComicLabelController {
  constructor(private readonly options: ComicLabelControllerOptions) {}

  unlink() {
    const { state, studio } = this.options;
    state.linkedLabelId = 0;
    state.originalIdea = "";
    this.options.resetConversation(true);
    studio.querySelector<HTMLElement>(".comic-plan")!.hidden = true;
    this.renderState();
  }

  select(label: FlowNode) {
    const { state, studio } = this.options;
    state.linkedLabelId = label.id;
    state.originalIdea = label.body;
    const stored = label.comicData as ComicPlan | undefined;
    const saved = stored?.shots && Array.isArray(stored.shots)
      ? structuredClone(stored)
      : null;
    this.options.resetConversation(true);
    if (saved) {
      state.plan = saved;
      state.brief = briefFromComicPlan(saved);
      this.options.renderPlan(saved);
    } else {
      state.plan = null;
      state.brief = {
        title: label.title.replace(/^漫剧方案\s*·\s*/, ""),
        premise: label.body.replace(/\s+/g, " ").trim().slice(0, 360),
        aspectRatio: "16:9",
        openQuestions: ["继续对话，确认需要保留和调整的内容"],
      };
      studio.querySelector<HTMLElement>(".comic-plan")!.hidden = true;
    }
    this.renderState();
    this.options.renderBrief();
    this.appendRestoreNotice(label, Boolean(saved));
    studio.querySelector<HTMLTextAreaElement>("[data-comic-message]")!.focus();
  }

  private appendRestoreNotice(label: FlowNode, restored: boolean) {
    const { studio } = this.options;
    const conversation = studio.querySelector<HTMLElement>(
      "[data-comic-conversation]",
    )!;
    const notice = document.createElement("div");
    notice.className = "comic-message assistant compact";
    notice.innerHTML = `<i>◇</i><div><b>${restored ? "已恢复" : "已关联"}《${escapeHtml(label.title)}》</b><p>${restored ? "人物、剧情、风格和分镜已经载入，可以直接继续修改或续写。" : "标签内容已载入当前方案，可继续对话整理为完整剧本。"}</p></div>`;
    conversation.insertBefore(notice, studio.querySelector(".comic-plan"));
  }

  renderState() {
    const { studio } = this.options;
    const linked = this.options
      .getLabels()
      .find((node) => node.id === this.options.state.linkedLabelId);
    const card = studio.querySelector<HTMLElement>("[data-comic-linked-label]")!;
    const picker = studio.querySelector<HTMLButtonElement>("[data-comic-label-picker]")!;
    const save = studio.querySelector<HTMLButtonElement>("[data-comic-label]")!;
    const copy = studio.querySelector<HTMLButtonElement>("[data-comic-label-copy]")!;
    picker.querySelector("b")!.textContent = linked ? "更换标签" : "关联标签";
    card.hidden = !linked;
    card.innerHTML = linked
      ? `<span><i>◇</i><span><small>正在延续</small><b>${escapeHtml(linked.title)}</b></span></span><button type="button" aria-label="取消关联">×</button>`
      : "";
    card.querySelector("button")?.addEventListener("click", () => this.unlink());
    save.querySelector("span")!.textContent = linked ? "更新原标签" : "保存为标签";
    copy.hidden = !linked;
  }

  renderMenu() {
    const { studio } = this.options;
    const menu = studio.querySelector<HTMLElement>("[data-comic-label-menu]")!;
    const labels = this.options.getLabels();
    const linkedId = this.options.state.linkedLabelId;
    menu.innerHTML = `<header><b>选择故事标签</b><small>读取后可继续对话修改</small></header>${labels.length ? labels.map((label) => `<button type="button" data-comic-label-id="${label.id}" class="${label.id === linkedId ? "active" : ""}"><i>◇</i><span><b>${escapeHtml(label.title || "未命名标签")}</b><small>${escapeHtml(label.body.replace(/\s+/g, " ").trim().slice(0, 90) || "暂无内容")}</small></span><em>${label.id === linkedId ? "✓" : "›"}</em></button>`).join("") : "<p>当前画布还没有可用标签</p>"}`;
    menu
      .querySelectorAll<HTMLButtonElement>("[data-comic-label-id]")
      .forEach((button) =>
        button.addEventListener("click", () => {
          const label = labels.find(
            (node) => node.id === Number(button.dataset.comicLabelId),
          );
          if (!label) return;
          this.select(label);
          menu.classList.remove("open");
        }),
      );
  }
}
