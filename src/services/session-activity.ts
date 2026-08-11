import { apiFetch } from "./api";

type SessionActivityOptions = {
  isAuthenticated: () => boolean;
  logout: (message: string) => Promise<void>;
  idleMs?: number;
};

export class SessionActivityController {
  private lastActivity = Date.now();
  private heartbeatDue = false;
  private logoutTimer = 0;
  private readonly idleMs: number;

  constructor(private readonly options: SessionActivityOptions) {
    this.idleMs = options.idleMs ?? 30 * 60 * 1000;
    for (const eventName of [
      "pointerdown",
      "keydown",
      "wheel",
      "touchstart",
    ] as const)
      window.addEventListener(eventName, () => this.touch(), { passive: true });
    document.addEventListener("visibilitychange", () =>
      this.checkVisibility(),
    );
    window.setInterval(() => void this.sendHeartbeat(), 60_000);
  }

  touch() {
    this.lastActivity = Date.now();
    this.heartbeatDue = true;
    this.schedule();
  }

  schedule() {
    window.clearTimeout(this.logoutTimer);
    if (!this.options.isAuthenticated()) return;
    const remaining = Math.max(
      0,
      this.idleMs - (Date.now() - this.lastActivity),
    );
    this.logoutTimer = window.setTimeout(
      () => void this.options.logout("长时间未操作，已安全退出登录"),
      remaining,
    );
  }

  private checkVisibility() {
    if (
      document.visibilityState !== "visible" ||
      !this.options.isAuthenticated()
    )
      return;
    if (Date.now() - this.lastActivity >= this.idleMs)
      void this.options.logout("长时间未操作，已安全退出登录");
    else this.schedule();
  }

  private async sendHeartbeat() {
    if (!this.options.isAuthenticated() || !this.heartbeatDue) return;
    this.heartbeatDue = false;
    const response = await apiFetch("/api/auth/activity", {
      method: "POST",
    }).catch(() => null);
    if (response?.status === 401)
      void this.options.logout("登录状态已过期，请重新登录");
  }
}
