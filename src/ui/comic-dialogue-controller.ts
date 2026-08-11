import type { ComicSessionState } from "../services/comic-session-state";
import { streamComicDialogue } from "../services/comic";

type ComicDialogueControllerOptions = {
  studio: HTMLElement;
  briefPanel: HTMLElement;
  state: ComicSessionState;
  getProjectId: () => string;
  ensureProjectContext: () => Promise<boolean>;
  getContext: () => string[];
  renderBrief: () => void;
  showError: (message: string) => void;
};

function escapeHtml(value: string) {
  const element = document.createElement("span");
  element.textContent = value;
  return element.innerHTML;
}

export class ComicDialogueController {
  constructor(private readonly options: ComicDialogueControllerOptions) {}

  async submit(message: string) {
    const { state } = this.options;
    if (state.submitting || !message.trim()) return;
    state.submitting = true;
    if (!(await this.options.ensureProjectContext())) {
      state.submitting = false;
      this.options.showError("当前项目不可用，请重新进入项目");
      return;
    }
    const studio = this.options.studio;
    const conversation = studio.querySelector<HTMLElement>("[data-comic-conversation]")!;
    const userMessage = document.createElement("div");
    userMessage.className = "comic-message user";
    userMessage.innerHTML = `<div><p>${escapeHtml(message.trim())}</p></div>`;
    conversation.insertBefore(userMessage, studio.querySelector(".comic-plan"));

    const status = studio.querySelector<HTMLOutputElement>("[data-comic-status]")!;
    const send = studio.querySelector<HTMLButtonElement>("[data-comic-send]")!;
    const field = studio.querySelector<HTMLTextAreaElement>("[data-comic-message]")!;
    const confirm = this.options.briefPanel.querySelector<HTMLButtonElement>("[data-comic-confirm]")!;
    send.disabled = true;
    field.disabled = true;
    confirm.disabled = true;
    send.classList.add("thinking");
    status.textContent = "正在整理你的想法…";
    status.classList.add("visible");
    let streamingAssistant: HTMLElement | null = null;
    try {
      const assistant = document.createElement("div");
      streamingAssistant = assistant;
      assistant.className = "comic-message assistant compact streaming";
      assistant.innerHTML = "<i>✦</i><div><b>正在回应</b><p></p></div>";
      conversation.insertBefore(assistant, studio.querySelector(".comic-plan"));
      conversation.scrollTo({ top: conversation.scrollHeight, behavior: "smooth" });
      const replyText = assistant.querySelector<HTMLElement>("p")!;
      const replyTitle = assistant.querySelector<HTMLElement>("b")!;
      const result = await streamComicDialogue(
        {
          projectId: this.options.getProjectId(),
          sessionId: state.sessionId || undefined,
          message: message.trim(),
          context: this.options.getContext(),
          plan: state.sessionId ? undefined : state.plan,
          model: "gpt-5.5",
        },
        (event) => {
          if (event.type === "start") {
            state.sessionId = String(event.sessionId || state.sessionId);
            status.textContent = "正在理解并回应…";
          } else if (event.type === "delta") {
            replyText.textContent = event.text || "";
            conversation.scrollTop = conversation.scrollHeight;
          } else if (event.type === "retry") {
            replyText.textContent = "";
            status.textContent = event.message || "正在切换备用线路…";
          } else if (event.type === "reset") {
            replyText.textContent = "";
          }
        },
      );
      state.sessionId = String(result.sessionId || state.sessionId);
      state.brief = result.brief || state.brief;
      state.ready = Boolean(result.ready);
      state.pendingRevision = String(result.pendingRevision || "");
      if (!state.plan && !state.originalIdea)
        state.originalIdea = state.brief?.premise || message.trim();
      this.options.renderBrief();
      replyText.textContent = result.reply || replyText.textContent || "我已经记下了。";
      replyTitle.textContent = state.plan
        ? "修改建议已记下"
        : state.ready
          ? "方向已经清楚"
          : "我们继续把故事聊清楚";
      assistant.classList.remove("streaming");
      conversation.scrollTo({ top: conversation.scrollHeight, behavior: "smooth" });
      status.textContent = state.plan
        ? state.pendingRevision
          ? "等待你确认应用修改"
          : "继续告诉我想调整的地方"
        : state.ready
          ? "可以确认生成完整剧本"
          : "等待继续补充";
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "漫剧对话失败";
      if (streamingAssistant) {
        streamingAssistant.classList.remove("streaming");
        streamingAssistant.querySelector("b")!.textContent = "这次没有连接上";
        streamingAssistant.querySelector("p")!.textContent = "你的消息没有丢失，可以再次发送重试。";
      }
      status.textContent = errorMessage;
      this.options.showError(errorMessage);
    } finally {
      state.submitting = false;
      send.disabled = false;
      field.disabled = false;
      confirm.disabled = false;
      send.classList.remove("thinking");
      field.focus();
      window.setTimeout(() => {
        if (!state.submitting) status.classList.remove("visible");
      }, 2200);
    }
  }
}
