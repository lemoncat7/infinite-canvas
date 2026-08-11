export type ComicSidePanelKind = "brief" | "plan" | null;

interface ComicSidePanelState {
  linkedLabelId: number;
  sessionId: string;
  hasPlan: boolean;
  pendingRevision: string;
  ready: boolean;
  submitting: boolean;
}

interface ComicSidePanelOptions {
  studio: HTMLElement;
  briefPanel: HTMLElement;
  sourcePlan: HTMLElement;
  planPanel: HTMLElement;
  headerNav: HTMLElement;
  getState: () => ComicSidePanelState;
  showWarning: (message: string) => void;
}

const MOBILE_TABS =
  '<nav class="comic-mobile-tabs"><button type="button" data-comic-tab="brief">当前方案</button><button type="button" data-comic-tab="plan">完整方案</button></nav>';

export class ComicSidePanelController {
  private observer: MutationObserver;

  constructor(private readonly options: ComicSidePanelOptions) {
    const { briefPanel, planPanel, sourcePlan, headerNav, studio } = options;
    headerNav
      .querySelectorAll<HTMLButtonElement>("[data-comic-desktop-side]")
      .forEach((button) => button.classList.add("active"));
    briefPanel.insertAdjacentHTML("afterbegin", MOBILE_TABS);
    planPanel.insertAdjacentHTML("afterbegin", MOBILE_TABS);
    this.bindTabs(briefPanel);
    this.bindTabs(planPanel);
    this.bindHeaderControls();
    this.preparePlanSections();
    this.observer = new MutationObserver(() => this.syncPlan());
    this.observer.observe(sourcePlan, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden"],
    });
    window.addEventListener("resize", this.position);
    studio.addEventListener("transitionend", (event) => {
      if (event.target === studio && studio.classList.contains("open"))
        this.position();
    });
  }

  showMobile(kind: ComicSidePanelKind) {
    const { briefPanel, planPanel, headerNav } = this.options;
    if (kind === "plan" && planPanel.hidden) {
      this.options.showWarning("完整方案尚未生成");
      return;
    }
    briefPanel.classList.toggle("mobile-open", kind === "brief");
    planPanel.classList.toggle("mobile-open", kind === "plan");
    headerNav
      .querySelector<HTMLButtonElement>("[data-comic-scheme]")
      ?.classList.toggle("active", kind !== null);
    for (const panel of [briefPanel, planPanel])
      panel
        .querySelectorAll<HTMLButtonElement>("[data-comic-tab]")
        .forEach((button) =>
          button.classList.toggle("active", button.dataset.comicTab === kind),
        );
    const confirm = briefPanel.querySelector<HTMLButtonElement>(
      "[data-comic-confirm]",
    );
    const state = this.options.getState();
    if (confirm && kind === "brief" && state.sessionId) {
      const available = state.hasPlan ? Boolean(state.pendingRevision) : state.ready;
      confirm.hidden = false;
      confirm.disabled = state.submitting || !available;
      if (!available) {
        confirm.querySelector("span")!.textContent = state.hasPlan
          ? "等待新的修改"
          : "继续完善方案";
        confirm.querySelector("small")!.textContent = state.hasPlan
          ? "先在对话中说明需要调整的内容"
          : "回答待确认问题后即可生成";
      }
    }
    this.position();
  }

  toggleDesktop(kind: "brief" | "plan", button: HTMLButtonElement) {
    const panel = kind === "brief" ? this.options.briefPanel : this.options.planPanel;
    panel.classList.toggle("desktop-collapsed");
    button.classList.toggle("active", !panel.classList.contains("desktop-collapsed"));
    this.position();
  }

  position = () => {
    const { studio, briefPanel, planPanel } = this.options;
    if (!studio.classList.contains("open")) return;
    const bounds = studio.getBoundingClientRect();
    if (innerWidth <= 780) {
      const left = Math.max(14, bounds.left + 14);
      const top = bounds.top + 70;
      const width = Math.max(220, bounds.width - 28);
      const height = Math.min(430, Math.max(260, bounds.height * 0.62));
      for (const panel of [briefPanel, planPanel]) {
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
        panel.style.width = `${width}px`;
        panel.style.height = `${height}px`;
      }
      return;
    }
    const computed = getComputedStyle(studio);
    const finalRight = Number.parseFloat(computed.right) || 22;
    const finalBottom = Number.parseFloat(computed.bottom);
    const studioHeight = studio.offsetHeight;
    const finalLeft = innerWidth - finalRight - studio.offsetWidth;
    const finalTop = Number.isFinite(finalBottom)
      ? innerHeight - finalBottom - studioHeight
      : Number.parseFloat(computed.top) || bounds.top;
    const width = Math.min(300, Math.max(238, finalLeft - 30));
    const left = Math.max(10, finalLeft - width - 12);
    const studioBottom = finalTop + studioHeight;
    const briefTop = finalTop + 18;
    const briefHeight = Math.min(265, Math.max(205, studioHeight * 0.34));
    const briefVisible =
      !briefPanel.classList.contains("desktop-collapsed") && !briefPanel.hidden;
    const planTop = briefVisible ? briefTop + briefHeight + 9 : briefTop;
    const planHeight = Math.max(230, studioBottom - planTop);
    Object.assign(briefPanel.style, {
      width: `${width}px`, left: `${left}px`, top: `${briefTop}px`, height: `${briefHeight}px`,
    });
    Object.assign(planPanel.style, {
      width: `${width}px`, left: `${left}px`, top: `${planTop}px`, height: `${planHeight}px`,
    });
  };

  private bindTabs(panel: HTMLElement) {
    panel.querySelectorAll<HTMLButtonElement>("[data-comic-tab]").forEach((button) =>
      button.addEventListener("click", () =>
        this.showMobile(button.dataset.comicTab as "brief" | "plan"),
      ),
    );
  }

  private bindHeaderControls() {
    const { studio, briefPanel, planPanel, headerNav } = this.options;
    headerNav
      .querySelector<HTMLButtonElement>("[data-comic-scheme]")!
      .addEventListener("click", () => {
        studio
          .querySelector<HTMLElement>("[data-comic-label-menu]")
          ?.classList.remove("open");
        this.showMobile(
          briefPanel.classList.contains("mobile-open") ||
            planPanel.classList.contains("mobile-open")
            ? null
            : "brief",
        );
      });
    headerNav
      .querySelectorAll<HTMLButtonElement>("[data-comic-desktop-side]")
      .forEach((button) =>
        button.addEventListener("click", () =>
          this.toggleDesktop(
            button.dataset.comicDesktopSide as "brief" | "plan",
            button,
          ),
        ),
      );
  }

  private preparePlanSections() {
    this.options.planPanel
      .querySelectorAll<HTMLElement>(".comic-plan-scroll > article")
      .forEach((article, index) => {
        if (index > 1) return;
        article.classList.add("comic-plan-collapsible", "collapsed");
        const heading = article.querySelector<HTMLElement>("h4");
        if (!heading) return;
        heading.tabIndex = 0;
        heading.setAttribute("role", "button");
        heading.setAttribute("aria-expanded", "false");
        const toggle = () => {
          const collapsed = article.classList.toggle("collapsed");
          heading.setAttribute("aria-expanded", String(!collapsed));
        };
        heading.addEventListener("click", toggle);
        heading.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          toggle();
        });
      });
  }

  private syncPlan() {
    const { planPanel, sourcePlan } = this.options;
    const mobileOpen = planPanel.classList.contains("mobile-open");
    planPanel.innerHTML = sourcePlan.innerHTML;
    planPanel.insertAdjacentHTML("afterbegin", MOBILE_TABS);
    planPanel.hidden = sourcePlan.hidden;
    planPanel.classList.toggle("mobile-open", mobileOpen);
    const saveLabel = planPanel.querySelector<HTMLElement>("[data-comic-label] span");
    if (saveLabel)
      saveLabel.textContent = this.options.getState().linkedLabelId
        ? "保存当前标签"
        : "保存为标签";
    this.bindTabs(planPanel);
    planPanel
      .querySelectorAll<HTMLButtonElement>(
        "[data-comic-label],[data-comic-label-copy],[data-comic-canvas]",
      )
      .forEach((button) =>
        button.addEventListener("click", () => {
          const attribute = button.hasAttribute("data-comic-label-copy")
            ? "data-comic-label-copy"
            : button.hasAttribute("data-comic-canvas")
              ? "data-comic-canvas"
              : "data-comic-label";
          sourcePlan.querySelector<HTMLButtonElement>(`[${attribute}]`)?.click();
        }),
      );
    this.preparePlanSections();
  }
}
