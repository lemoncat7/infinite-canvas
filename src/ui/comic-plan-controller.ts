import { streamComicPlan } from "../services/comic";
import type { ComicSessionState } from "../services/comic-session-state";

type ComicPlanInputs = { context: string[]; visuals: string[] };

type ComicPlanControllerOptions = {
  studio: HTMLElement;
  briefPanel: HTMLElement;
  state: ComicSessionState;
  getProjectId: () => string;
  ensureProjectContext: () => Promise<boolean>;
  getInputs: () => ComicPlanInputs;
  renderBrief: () => void;
  renderPlan: (plan: NonNullable<ComicSessionState["plan"]>) => void;
  setInteractionLocked: (locked: boolean) => void;
  invalidateSession: () => void;
  restoreSession: () => Promise<unknown>;
  showToast: (message: string, tone: "warning" | "error") => void;
};

function escapeHtml(value: string) {
  const element = document.createElement("span");
  element.textContent = value;
  return element.innerHTML;
}

export class ComicPlanController {
  constructor(private readonly options: ComicPlanControllerOptions) {}

  async submit() {
    const { state } = this.options;
    if (state.submitting) return;
    state.submitting = true;
    if (!(await this.options.ensureProjectContext())) {
      state.submitting = false;
      this.options.showToast("当前项目不可用，请重新进入项目", "error");
      return;
    }
    if (!state.sessionId) {
      state.submitting = false;
      this.options.showToast("项目已切换，请先在当前项目重新聊聊创作方向", "warning");
      return;
    }
    const revision = state.plan ? state.pendingRevision : "";
    if (state.plan && !revision) {
      state.submitting = false;
      this.options.showToast("还没有需要应用的修改", "warning");
      return;
    }
    const { studio, briefPanel } = this.options;
    const conversation = studio.querySelector<HTMLElement>("[data-comic-conversation]")!;
    const status = studio.querySelector<HTMLOutputElement>("[data-comic-status]")!;
    const send = studio.querySelector<HTMLButtonElement>("[data-comic-send]")!;
    const field = studio.querySelector<HTMLTextAreaElement>("[data-comic-message]")!;
    const confirm = briefPanel.querySelector<HTMLButtonElement>("[data-comic-confirm]")!;
    send.disabled = true;
    field.disabled = true;
    confirm.disabled = true;
    confirm.querySelector("span")!.textContent = revision ? "正在应用修改…" : "正在生成完整剧本…";
    confirm.querySelector("small")!.textContent = "任务运行期间请稍候";
    send.classList.add("thinking");
    status.textContent = revision ? "正在理解你的修改…" : "正在理解故事想法…";
    status.style.setProperty("--comic-progress", "2%");
    status.classList.add("visible", "generating");
    const { context, visuals } = this.options.getInputs();
    try {
      const confirmedBrief = JSON.stringify(state.brief || { premise: state.originalIdea.slice(0, 1200) });
      let lastPhase = "正在构思…";
      const payload = await streamComicPlan(
        {
          projectId: this.options.getProjectId(),
          sessionId: state.sessionId,
          idea: confirmedBrief,
          context,
          visuals,
          previousPlan: state.plan,
          revision,
          model: "gpt-5.5",
        },
        (event) => {
          if (event.type === "start") {
            status.textContent = event.message || "正在构思…";
          } else if (event.type === "progress") {
            lastPhase = event.phase || lastPhase;
            const progress = Math.max(0, Math.min(100, event.progress || 0));
            const amount = event.receivedBytes ? ` · 已接收 ${(event.receivedBytes / 1024).toFixed(1)} KB` : "";
            status.style.setProperty("--comic-progress", `${progress}%`);
            status.textContent = `${lastPhase} · ${progress}%${amount}`;
          } else if (event.type === "heartbeat") {
            const amount = event.receivedBytes ? ` · 已接收 ${(event.receivedBytes / 1024).toFixed(1)} KB` : "";
            const waiting = (event.idleSeconds || 0) >= 10
              ? ` · 已等待 ${event.idleSeconds} 秒`
              : " · 持续接收中";
            status.textContent = `${lastPhase} · ${event.progress || 0}%${amount}${waiting}`;
          } else if (event.type === "result") {
            status.style.setProperty("--comic-progress", "100%");
          }
        },
      );
      state.plan = payload;
      state.brief = { ...(state.brief || {}), title: payload.title };
      state.pendingRevision = "";
      state.ready = false;
      this.options.renderPlan(payload);
      this.options.renderBrief();
      const assistant = document.createElement("div");
      assistant.className = "comic-message assistant compact";
      assistant.innerHTML = `<i>✦</i><div><b>${revision ? "修改已应用" : "完整剧本已经生成"}</b><p>${escapeHtml(revision ? payload.changeSummary || "未提及的部分保持不变。" : `《${payload.title}》共 ${payload.shots.length} 个镜头。你可以继续和我讨论改进方向，我会先整理修改，等你确认后再应用。`)}</p></div>`;
      conversation.insertBefore(assistant, studio.querySelector(".comic-plan"));
      status.textContent = revision ? "方案已更新" : "完整剧本已完成";
      conversation.scrollTo({ top: conversation.scrollHeight, behavior: "smooth" });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "漫剧方案生成失败";
      this.options.invalidateSession();
      await this.options.restoreSession();
      if (state.submitting) {
        status.classList.add("visible", "generating");
      } else {
        status.textContent = errorMessage;
        this.options.showToast(errorMessage, "error");
      }
    } finally {
      if (!state.submitting) {
        this.options.setInteractionLocked(false);
        this.options.renderBrief();
        field.focus();
        window.setTimeout(() => {
          if (!state.submitting) status.classList.remove("visible", "generating");
        }, 2600);
      }
    }
  }
}
