import type { ComicBrief, ComicPlan } from "../nodes/comic-types";

export interface ComicBriefViewState {
  brief: ComicBrief | null;
  plan: ComicPlan | null;
  sessionId: string;
  pendingRevision: string;
  ready: boolean;
  linkedTitle?: string;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export class ComicStudioView {
  constructor(
    private readonly studio: HTMLElement,
    private readonly briefPanel: HTMLElement,
    private readonly positionPanels: () => void,
  ) {}

  setInteractionLocked(locked: boolean) {
    const field = this.studio.querySelector<HTMLTextAreaElement>(
      "[data-comic-message]",
    )!;
    const send = this.studio.querySelector<HTMLButtonElement>("[data-comic-send]")!;
    const confirm = this.briefPanel.querySelector<HTMLButtonElement>(
      "[data-comic-confirm]",
    )!;
    const newSession = this.studio.querySelector<HTMLButtonElement>("[data-comic-new]")!;
    field.disabled = locked;
    send.disabled = locked;
    confirm.disabled = locked;
    newSession.disabled = locked;
    send.classList.toggle("thinking", locked);
    this.studio.classList.toggle("is-busy", locked);
  }

  renderBrief(view: ComicBriefViewState) {
    const { brief, plan, sessionId, pendingRevision, ready, linkedTitle } = view;
    const content = this.briefPanel.querySelector<HTMLElement>(
      "[data-comic-brief-content]",
    )!;
    const confirm = this.briefPanel.querySelector<HTMLButtonElement>(
      "[data-comic-confirm]",
    )!;
    const state = this.briefPanel.querySelector<HTMLElement>(
      "[data-comic-brief-state]",
    )!;
    this.briefPanel.hidden = !brief || !this.studio.classList.contains("open");
    const values = brief
      ? [
          ["简介", brief.premise],
          ["类型", brief.genre],
          ["画幅", brief.aspectRatio || "16:9"],
          ["预计时长", brief.duration || "评估中"],
          ["人物", brief.characters],
          ["冲突", brief.conflict],
          ["风格", brief.visualStyle],
          ["结局", brief.ending],
        ].filter((entry): entry is [string, string] => Boolean(entry[1]))
      : [];
    this.briefPanel.querySelector<HTMLElement>(
      "[data-comic-brief-title]",
    )!.textContent = brief?.title || plan?.title || linkedTitle || "漫剧创作方案";
    content.innerHTML =
      values
        .map(
          ([label, value]) =>
            `<p><b>${label}</b><span>${escapeHtml(value)}</span></p>`,
        )
        .join("") +
      (brief?.openQuestions?.length
        ? `<aside><b>还需确认</b><span>${brief.openQuestions.map(escapeHtml).join(" · ")}</span></aside>`
        : "");
    const canConfirm = Boolean(sessionId && (plan ? pendingRevision : ready));
    confirm.hidden = !canConfirm;
    confirm.querySelector("span")!.textContent = plan ? "应用本轮修改" : "生成完整剧本";
    confirm.querySelector("small")!.textContent = plan
      ? "只调整已确认的内容"
      : "确认后开始正式构思";
    const briefState = plan
      ? pendingRevision
        ? "revision"
        : "generated"
      : ready
        ? "ready"
        : "discussing";
    state.dataset.state = briefState;
    state.textContent = {
      revision: "待确认修改",
      generated: "方案已生成",
      ready: "可以生成",
      discussing: "讨论中",
    }[briefState];
    this.briefPanel.classList.toggle("ready", canConfirm);
    requestAnimationFrame(this.positionPanels);
  }

  renderPlan(plan: ComicPlan) {
    const panel = this.studio.querySelector<HTMLElement>(".comic-plan")!;
    panel.hidden = false;
    const frameCount = plan.shots.reduce(
      (sum, shot) => sum + (shot.frames?.length || 1),
      0,
    );
    this.studio.querySelector<HTMLElement>("[data-comic-title]")!.textContent =
      plan.title || "未命名漫剧";
    this.studio.querySelector<HTMLElement>("[data-comic-logline]")!.textContent =
      plan.logline || "";
    this.studio.querySelector<HTMLElement>("[data-comic-meta]")!.textContent =
      `${plan.duration} · ${plan.aspectRatio} · ${plan.shots.length} 个制作镜头 · ${frameCount} 张分镜图`;
    const assets = [
      ...(plan.characters || []).map(
        (character) =>
          `<div class="comic-character"><b>角色 · ${escapeHtml(character.name)}</b><p>${escapeHtml(character.description)}</p></div>`,
      ),
      ...(plan.props || []).map(
        (prop) =>
          `<div class="comic-character"><b>道具 · ${escapeHtml(prop.name)}</b><p>${escapeHtml(prop.description)}</p></div>`,
      ),
    ];
    this.studio.querySelector<HTMLElement>("[data-comic-characters]")!.innerHTML =
      assets.join("") || "<p>本方案没有需要单独锁定的视觉资产</p>";
    this.studio.querySelector<HTMLElement>("[data-comic-outline]")!.innerHTML =
      (plan.outline || [])
        .map(
          (item) =>
            `<li><b>${escapeHtml(item.act)}</b><span>${escapeHtml(item.content)}</span></li>`,
        )
        .join("");
    this.studio.querySelector<HTMLElement>("[data-comic-shots]")!.innerHTML =
      plan.shots
        .map((shot) => {
          const frames = shot.frames?.length
            ? shot.frames
            : [{ title: "主画面", imagePrompt: shot.imagePrompt }];
          return `<details class="comic-shot"><summary><em>${String(shot.number).padStart(2, "0")}</em><span><b>${escapeHtml(shot.title)}</b><small>${shot.duration} 秒 · ${frames.length} 张连续分镜 · ${escapeHtml(shot.scene)}</small></span><i>⌄</i></summary><div>${shot.storyBeat ? `<p><b>剧情节拍</b>${escapeHtml(shot.storyBeat)}</p>` : ""}${shot.action ? `<p><b>表演动作</b>${escapeHtml(shot.action)}</p>` : ""}<p><b>对白 / 旁白</b>${escapeHtml(shot.dialogue || "无对白，以画面动作推进")}</p>${frames.map((frame, index) => `<p><b>分镜 ${index + 1} · ${escapeHtml(frame.title)}</b>${escapeHtml(frame.imagePrompt)}</p>`).join("")}<p><b>动态</b>${escapeHtml(shot.videoPrompt)}</p>${shot.continuity ? `<p><b>连续性</b>${escapeHtml(shot.continuity)}</p>` : ""}${shot.transition ? `<p><b>转场</b>${escapeHtml(shot.transition)}</p>` : ""}</div></details>`;
        })
        .join("");
    const conversation = this.studio.querySelector<HTMLElement>(
      "[data-comic-conversation]",
    )!;
    conversation.scrollTo({ top: conversation.scrollHeight, behavior: "smooth" });
  }
}
