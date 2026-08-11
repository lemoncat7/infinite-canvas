import { apiFetch } from "./api";

type NotificationStreamOptions = {
  isAuthenticated: () => boolean;
  isServiceKnownOffline: () => boolean;
  isServiceGuideVisible: () => boolean;
  renderPresence: (count: number | undefined, reconnecting?: boolean) => void;
  currentPresence: () => number | undefined;
  clearPresence: () => void;
  onNotifications: () => void;
  onServerVersionChanged: () => void;
  onServiceStatus: (status: "online" | "offline") => void;
  onReconnect: () => void;
};

export class NotificationStreamController {
  private stream: EventSource | null = null;
  private userId = "";
  private serverVersion = "";
  private offlineTimer = 0;
  private fallbackTimer = 0;
  private reachabilityFailures = 0;

  constructor(private readonly options: NotificationStreamOptions) {}

  connect(userId: string) {
    if (!this.options.isAuthenticated()) return this.disconnect();
    if (this.stream && this.userId === userId) return;
    this.disconnect(false);
    this.userId = userId;
    let connected = false;
    let wasOffline = false;
    const stream = new EventSource("/api/notifications/stream");
    this.stream = stream;

    stream.onopen = () => {
      if (this.stream !== stream) return;
      window.clearTimeout(this.offlineTimer);
      this.stopFallback();
      this.reachabilityFailures = 0;
      this.options.renderPresence(this.options.currentPresence(), false);
      const recovered = wasOffline || this.options.isServiceGuideVisible();
      if (recovered) {
        this.options.onServiceStatus("online");
        this.options.onReconnect();
      }
      connected = true;
      wasOffline = false;
    };
    stream.onerror = () => {
      if (!this.options.isAuthenticated() || this.stream !== stream) return;
      connected = false;
      this.options.renderPresence(this.options.currentPresence(), true);
      window.clearTimeout(this.offlineTimer);
      this.startFallback();
      this.offlineTimer = window.setTimeout(() => {
        if (
          this.stream === stream &&
          !connected &&
          stream.readyState !== EventSource.OPEN
        ) {
          wasOffline = true;
          void this.verifyReachability(stream);
        }
      }, 3500);
    };
    stream.addEventListener("notifications", (event) => {
      if (this.stream !== stream) return;
      this.options.onNotifications();
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as {
          serverVersion?: string;
        };
        if (
          this.serverVersion &&
          payload.serverVersion &&
          payload.serverVersion !== this.serverVersion
        )
          this.options.onServerVersionChanged();
        if (payload.serverVersion) this.serverVersion = payload.serverVersion;
      } catch {
        // A later event will retry the version synchronization.
      }
    });
    stream.addEventListener("presence", (event) => {
      if (this.stream !== stream) return;
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as {
          online?: number;
        };
        this.options.renderPresence(
          Math.max(1, Number(payload.online) || 1),
          false,
        );
      } catch {
        this.options.renderPresence(this.options.currentPresence() ?? 1, false);
      }
    });
  }

  disconnect(clearPresence = true) {
    window.clearTimeout(this.offlineTimer);
    this.stopFallback();
    this.reachabilityFailures = 0;
    this.stream?.close();
    this.stream = null;
    this.userId = "";
    this.serverVersion = "";
    if (clearPresence) this.options.clearPresence();
    this.options.renderPresence(this.options.currentPresence());
  }

  private stopFallback() {
    window.clearInterval(this.fallbackTimer);
    this.fallbackTimer = 0;
  }

  private startFallback() {
    if (this.fallbackTimer) return;
    this.fallbackTimer = window.setInterval(() => {
      if (!this.options.isAuthenticated() || document.hidden) return;
      if (this.stream) void this.verifyReachability(this.stream);
      this.options.onNotifications();
    }, 15000);
  }

  private async verifyReachability(stream: EventSource) {
    if (this.stream !== stream || !this.options.isAuthenticated()) return;
    try {
      const response = await apiFetch(`/api/health?guide-check=${Date.now()}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(4000),
      });
      if (response.ok) {
        this.reachabilityFailures = 0;
        if (this.options.isServiceKnownOffline()) {
          this.options.onServiceStatus("online");
          this.options.onReconnect();
        }
        this.startFallback();
        return;
      }
    } catch {
      // Require consecutive failures before reporting an outage.
    }
    if (this.stream !== stream) return;
    this.reachabilityFailures++;
    if (
      this.reachabilityFailures >= 2 &&
      !this.options.isServiceKnownOffline()
    )
      this.options.onServiceStatus("offline");
  }
}
