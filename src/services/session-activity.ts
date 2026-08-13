import { apiFetch, restoreSession } from "./api";

type SessionActivityOptions = {
  isAuthenticated: () => boolean;
  sessionExpired: (message: string) => Promise<void>;
  lockWorkspace: () => Promise<void>;
};

const WORKSPACE_IDLE_MS = 2 * 60 * 60 * 1000;

export class SessionActivityController {
  private heartbeatDue = false;
  private lastActivity = Date.now();
  private lockTimer = 0;

  constructor(private readonly options: SessionActivityOptions) {
    for (const eventName of [
      "pointerdown",
      "keydown",
      "wheel",
      "touchstart",
    ] as const)
      window.addEventListener(eventName, () => this.touch(), { passive: true });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        if (Date.now() - this.lastActivity >= WORKSPACE_IDLE_MS) {
          void this.options.lockWorkspace();
          return;
        }
        this.heartbeatDue = true;
        void this.sendHeartbeat();
      }
    });
    window.setInterval(() => void this.sendHeartbeat(), 15_000);
  }

  touch() {
    this.lastActivity = Date.now();
    this.heartbeatDue = true;
    this.scheduleWorkspaceLock();
  }

  private scheduleWorkspaceLock() {
    window.clearTimeout(this.lockTimer);
    if (!this.options.isAuthenticated()) return;
    this.lockTimer = window.setTimeout(() => {
      if (Date.now() - this.lastActivity >= WORKSPACE_IDLE_MS)
        void this.options.lockWorkspace();
      else this.scheduleWorkspaceLock();
    }, Math.max(1_000, WORKSPACE_IDLE_MS - (Date.now() - this.lastActivity)));
  }

  private async sendHeartbeat() {
    if (!this.options.isAuthenticated()) return;
    this.heartbeatDue = false;
    const response = await apiFetch("/api/auth/activity", {
      method: "POST",
    }).catch(() => null);
    if (response?.status !== 401) return;
    if (await restoreSession()) {
      this.heartbeatDue = true;
      await this.sendHeartbeat();
      return;
    }
    void this.options.sessionExpired("可信登录已过期，请重新登录");
  }
}
