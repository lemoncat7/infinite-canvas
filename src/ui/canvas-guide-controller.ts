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
};

export class CanvasGuideController {
  private bubble: HTMLElement | null = null;
  private key = "";
  private priority = -1;
  private timer = 0;
  private hideTimer = 0;
  private frame = 0;

  constructor(
    private readonly escapeHtml: (value: string) => string,
    private readonly triggerSelector = "#prompt-agent-trigger",
  ) {}

  isVisible(key?: string) {
    return Boolean(this.key && (!key || this.key === key));
  }

  private position(notice: HTMLElement) {
    const trigger = document.querySelector<HTMLElement>(this.triggerSelector);
    if (!trigger || !notice.isConnected) return;
    const icon = trigger.querySelector<HTMLElement>("b") || trigger;
    const rect = icon.getBoundingClientRect();
    const anchorX = rect.left + rect.width / 2;
    const width = notice.offsetWidth;
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
      const icon = trigger?.querySelector<HTMLElement>("b") || trigger;
      if (icon) {
        const rect = icon.getBoundingClientRect();
        const signature = `${rect.left.toFixed(2)}:${rect.top.toFixed(2)}:${rect.width.toFixed(2)}:${notice.offsetWidth}`;
        if (signature !== previous) {
          previous = signature;
          this.position(notice);
        }
      }
      this.frame = requestAnimationFrame(update);
    };
    this.frame = requestAnimationFrame(update);
  }

  private ensureBubble() {
    if (this.bubble) return this.bubble;
    this.bubble = document.createElement("aside");
    this.bubble.className = "app-update-popover service-status-popover";
    this.bubble.hidden = true;
    document.body.append(this.bubble);
    return this.bubble;
  }

  private burst(notice: HTMLElement) {
    const rect = notice.getBoundingClientRect();
    const field = document.createElement("div");
    field.className = "canvas-guide-particle-field";
    field.style.left = `${rect.left + rect.width / 2}px`;
    field.style.top = `${rect.top + rect.height / 2}px`;
    field.innerHTML = Array.from({ length: 24 }, () => {
      const angle = Math.random() * Math.PI * 2;
      const distance = 38 + Math.random() * 104;
      const startX = (Math.random() - 0.5) * Math.min(84, rect.width * 0.34);
      const startY = (Math.random() - 0.5) * Math.min(34, rect.height * 0.5);
      const size = 3 + Math.random() * 5;
      return `<i style="left:${startX}px;top:${startY}px;width:${size}px;height:${size}px;--guide-px:${Math.cos(angle) * distance}px;--guide-py:${Math.sin(angle) * distance * (0.58 + Math.random() * 0.55)}px;--guide-delay:${Math.random() * 70}ms"></i>`;
    }).join("");
    document.body.append(field);
    window.setTimeout(() => field.remove(), 860);
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
      window.clearTimeout(this.hideTimer);
      this.burst(this.bubble);
      this.bubble.hidden = true;
      this.bubble.classList.remove("is-entering", "is-leaving");
    }
  }

  show(message: CanvasGuideMessage) {
    const priority = message.priority ?? 20;
    const duration = message.duration ?? (priority <= 40 ? 2800 : 0);
    if (this.key && this.key !== message.key && priority < this.priority)
      return false;
    const notice = this.ensureBubble();
    window.clearTimeout(this.timer);
    window.clearTimeout(this.hideTimer);
    this.timer = 0;
    this.hideTimer = 0;
    this.key = message.key;
    this.priority = priority;
    notice.className = `app-update-popover service-status-popover ${message.tone ?? "neutral"}${message.actions?.length ? " interactive" : ""}`;
    notice.innerHTML = `<span><b>${this.escapeHtml(message.title)}</b><small>${this.escapeHtml(message.detail)}</small>${message.actions?.length ? "<em></em>" : ""}</span>`;
    const actions = notice.querySelector<HTMLElement>("em");
    message.actions?.forEach((action) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = action.label;
      if (action.primary) button.dataset.updateReload = "";
      button.addEventListener("click", action.run);
      actions?.append(button);
    });
    notice.hidden = false;
    notice.classList.remove("is-leaving", "is-entering");
    void notice.offsetWidth;
    notice.classList.add("is-entering");
    this.follow(notice);
    if (duration > 0)
      this.timer = window.setTimeout(() => this.hide(message.key), duration);
    return true;
  }
}
