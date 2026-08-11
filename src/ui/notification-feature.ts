import { NotificationStreamController } from "../services/notification-stream";
import type { CanvasGuideMessage } from "./canvas-guide-controller";
import { NotificationCenterController, OnlinePresenceView } from "./notification-center";
import { ServiceStatusController } from "./service-status-controller";

type Tone = "success" | "warning" | "error" | "info";

export class NotificationFeature {
  private readonly center: NotificationCenterController;
  private readonly presence: OnlinePresenceView;
  private readonly serviceStatus: ServiceStatusController;
  private readonly stream: NotificationStreamController;
  private readonly getUserId: () => string | undefined;
  private readonly hideGuide: (key: string) => void;

  constructor(options: {
    getUserId: () => string | undefined;
    registerTopbarMenu: (close: () => void) => void;
    closeNotificationMenus: (opening?: boolean) => void;
    closePresenceMenus: (opening?: boolean) => void;
    showGuide: (message: CanvasGuideMessage) => unknown;
    hideGuide: (key: string) => void;
    isGuideVisible: (key: string) => boolean;
    checkAppUpdate: () => void;
    restoreAfterReconnect: () => void;
    toast: (message: string, type: Tone) => void;
  }) {
    this.getUserId = options.getUserId;
    this.hideGuide = options.hideGuide;
    const modal = document.querySelector<HTMLElement>("#notification-modal")!;
    const openButton = document.querySelector<HTMLElement>("#open-notifications")!;
    options.registerTopbarMenu(() => modal.classList.remove("open"));

    this.center = new NotificationCenterController({
      modal,
      list: modal.querySelector<HTMLElement>("#notification-list")!,
      count: document.querySelector<HTMLElement>("[data-notification-count]")!,
      openButton,
      getUserId: options.getUserId,
      closeTopbarMenus: options.closeNotificationMenus,
      toast: options.toast,
    });
    this.presence = new OnlinePresenceView(openButton, options.closePresenceMenus);
    this.serviceStatus = new ServiceStatusController(options.showGuide);
    this.stream = new NotificationStreamController({
      isAuthenticated: () => Boolean(options.getUserId()),
      isServiceKnownOffline: () => this.serviceStatus.offline,
      isServiceGuideVisible: () => options.isGuideVisible("service-status"),
      renderPresence: (count = this.presence.current(), reconnecting = false) =>
        this.presence.render(count, reconnecting),
      currentPresence: () => this.presence.current(),
      clearPresence: () => this.presence.clear(),
      onNotifications: () => { void this.center.load(); },
      onServerVersionChanged: options.checkAppUpdate,
      onServiceStatus: (mode) => this.serviceStatus.show(mode),
      onReconnect: options.restoreAfterReconnect,
    });
  }

  load() { return this.center.load(); }

  connect() {
    const userId = this.getUserId();
    if (!userId) return this.disconnect();
    this.stream.connect(userId);
  }

  disconnect(clearPresence = true) {
    this.stream.disconnect(clearPresence);
    this.hideGuide("service-status");
  }

}
