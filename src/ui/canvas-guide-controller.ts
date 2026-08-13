export type CanvasGuideTone = "neutral" | "online" | "offline";
export type CanvasGuideAction = {
  label: string;
  primary?: boolean;
  run: () => void;
};
export type CanvasGuideMessage = {
  key: string;
  title: string;
  detail: string;
  tone?: CanvasGuideTone;
  priority?: number;
  duration?: number;
  actions?: CanvasGuideAction[];
  required?: boolean;
  smart?: {
    kind: "assist" | "discovery";
    cooldownMs?: number;
    maxShows?: number;
    dismissible?: boolean;
  };
};

export class CanvasGuideController {
  private bubble: HTMLElement | null = null;
  private key = "";
  private priority = -1;
  private timer = 0;
  private frame = 0;
  private queue: CanvasGuideMessage[] = [];
  private supportsPopover = false;
  private deferredTimer = 0;

  constructor(
    private readonly escapeHtml: (value: string) => string,
    private readonly triggerSelector = "#prompt-agent-trigger",
  ) {}

  isVisible(key?: string) {
    return Boolean(this.key && (!key || this.key === key));
  }

  private storageKey(message: CanvasGuideMessage) { return `flow-smart-guide:${message.key}`; }

  private readState(message: CanvasGuideMessage) {
    try {
      return JSON.parse(localStorage.getItem(this.storageKey(message)) || "{}") as { shown?: number; lastShown?: number; disabled?: boolean };
    } catch { return {}; }
  }

  private writeState(message: CanvasGuideMessage, state: { shown?: number; lastShown?: number; disabled?: boolean }) {
    try { localStorage.setItem(this.storageKey(message), JSON.stringify(state)); } catch { /* Storage can be unavailable in private mode. */ }
  }

  private isInteractionBusy() {
    const active = document.activeElement;
    return document.hidden
      || document.querySelector("#canvas.dragging,.flow-node.dragging,.is-dragging,.prompt-agent-panel.is-busy,.comic-studio.is-busy") !== null
      || Boolean(active?.matches("textarea,input,[contenteditable='true']"));
  }

  private scheduleWhenIdle(message: CanvasGuideMessage) {
    if (!this.queue.some((item) => item.key === message.key)) this.queue.push(message);
    if (this.deferredTimer) return;
    const retry = () => {
      this.deferredTimer = 0;
      if (this.key || this.isInteractionBusy()) {
        this.deferredTimer = window.setTimeout(retry, 700);
        return;
      }
      const next = this.queue.shift();
      if (next) this.show(next);
    };
    this.deferredTimer = window.setTimeout(retry, 700);
  }

  private position(notice: HTMLElement) {
    const trigger = document.querySelector<HTMLElement>(this.triggerSelector);
    if (!notice.isConnected) return;
    const triggerRect = trigger?.getBoundingClientRect();
    const triggerVisible = Boolean(triggerRect && triggerRect.width > 0 && triggerRect.height > 0 && triggerRect.bottom > 0 && triggerRect.top < innerHeight);
    const width = notice.offsetWidth;
    if (!triggerVisible || !triggerRect) {
      notice.dataset.anchored = "false";
      notice.style.left = `${Math.max(12, innerWidth - width - 12)}px`;
      notice.style.bottom = "max(12px, env(safe-area-inset-bottom))";
      return;
    }
    notice.dataset.anchored = "true";
    const icon = trigger!.querySelector<HTMLElement>("b svg") || trigger!.querySelector<HTMLElement>("b") || trigger!;
    const rect = icon.getBoundingClientRect();
    const anchorX = rect.left + rect.width / 2;
    const left = Math.max(12, Math.min(innerWidth - width - 12, anchorX - 18));
    const tailX = Math.max(10, Math.min(width - 10, anchorX - left));
    notice.style.left = `${left}px`;
    notice.style.bottom = `${Math.max(12, innerHeight - rect.top + 34)}px`;
    notice.style.setProperty("--bubble-tail-x", `${tailX}px`);
  }

  private follow(notice: HTMLElement) {
    if (this.frame) cancelAnimationFrame(this.frame);
    let previous = "";
    const update = () => {
      if (!notice.isConnected || notice.hidden) {
        this.frame = 0;
        return;
      }
      const trigger = document.querySelector<HTMLElement>(this.triggerSelector);
      const icon = trigger?.querySelector<HTMLElement>("b svg") || trigger?.querySelector<HTMLElement>("b") || trigger;
      const rect = icon?.getBoundingClientRect();
      const signature = rect
        ? `${rect.left.toFixed(2)}:${rect.top.toFixed(2)}:${rect.width.toFixed(2)}:${notice.offsetWidth}:${innerWidth}:${innerHeight}`
        : `safe:${notice.offsetWidth}:${innerWidth}:${innerHeight}`;
      if (signature !== previous) {
        previous = signature;
        this.position(notice);
      }
      this.frame = requestAnimationFrame(update);
    };
    this.frame = requestAnimationFrame(update);
  }

  private ensureBubble() {
    if (this.bubble) return this.bubble;
    this.bubble = document.createElement("aside");
    this.bubble.className = "canvas-guide-popover";
    this.supportsPopover = typeof this.bubble.showPopover === "function";
    if (this.supportsPopover) this.bubble.setAttribute("popover", "manual");
    this.bubble.setAttribute("role", "status");
    this.bubble.setAttribute("aria-live", "polite");
    this.bubble.hidden = true;
    document.body.append(this.bubble);
    return this.bubble;
  }

  hide(key?: string) {
    if (key && key !== this.key) return;
    window.clearTimeout(this.timer);
    this.timer = 0;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.key = "";
    this.priority = -1;
    if (this.bubble && !this.bubble.hidden) {
      if (this.supportsPopover && this.bubble.matches(":popover-open")) this.bubble.hidePopover();
      this.bubble.hidden = true;
      this.bubble.classList.remove("is-entering", "is-leaving");
    }
    const next = this.queue.shift();
    if (next) queueMicrotask(() => this.show(next));
  }

  show(message: CanvasGuideMessage) {
    if (!message.required && message.smart) {
      const state = this.readState(message);
      const maxShows = message.smart.maxShows ?? (message.smart.kind === "discovery" ? 2 : 3);
      const cooldown = message.smart.cooldownMs ?? (message.smart.kind === "discovery" ? 7 * 864e5 : 864e5);
      if (state.disabled || (state.shown ?? 0) >= maxShows || Date.now() - (state.lastShown ?? 0) < cooldown) return false;
      if (this.isInteractionBusy()) {
        this.scheduleWhenIdle(message);
        return true;
      }
    }
    const priority = message.priority ?? 20;
    const duration = message.required ? 0 : message.duration ?? (priority <= 40 ? 4200 : 0);
    if (this.key && this.key !== message.key) {
      if (priority <= this.priority || this.bubble?.dataset.required === "true") {
        if (!this.queue.some((item) => item.key === message.key)) this.queue.push(message);
        return true;
      }
      this.queue.unshift(message);
      this.hide(this.key);
      return true;
    }
    const notice = this.ensureBubble();
    window.clearTimeout(this.timer);
    this.timer = 0;
    this.key = message.key;
    this.priority = priority;
    const hasActions = Boolean(message.actions?.length || message.smart?.dismissible);
    notice.className = `canvas-guide-popover ${message.tone ?? "neutral"}${hasActions ? " interactive" : ""}`;
    notice.dataset.required = String(Boolean(message.required));
    notice.setAttribute("aria-live", message.required ? "assertive" : "polite");
    notice.innerHTML = `<span><b>${this.escapeHtml(message.title)}</b><small>${this.escapeHtml(message.detail)}</small>${hasActions ? "<em></em>" : ""}</span>`;
    const actions = notice.querySelector<HTMLElement>("em");
    const messageActions = [...(message.actions ?? [])];
    if (message.smart?.dismissible) messageActions.unshift({
      label: "不再提醒",
      run: () => {
        this.writeState(message, { ...this.readState(message), disabled: true });
        this.hide(message.key);
      },
    });
    messageActions.forEach((action) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = action.label;
      if (action.primary) button.dataset.updateReload = "";
      button.addEventListener("click", action.run);
      actions?.append(button);
    });
    notice.hidden = false;
    if (this.supportsPopover && !notice.matches(":popover-open")) {
      try { notice.showPopover(); } catch { this.supportsPopover = false; }
    }
    notice.classList.remove("is-leaving", "is-entering");
    this.position(notice);
    void notice.offsetWidth;
    notice.classList.add("is-entering");
    this.follow(notice);
    if (message.smart) {
      const state = this.readState(message);
      this.writeState(message, { ...state, shown: (state.shown ?? 0) + 1, lastShown: Date.now() });
    }
    if (duration > 0)
      this.timer = window.setTimeout(() => this.hide(message.key), duration);
    return true;
  }
}
