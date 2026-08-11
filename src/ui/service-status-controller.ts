import type { CanvasGuideMessage } from "./canvas-guide-controller";

export class ServiceStatusController {
  offline = false;

  constructor(private readonly showGuide: (message: CanvasGuideMessage) => unknown) {}

  show(mode: "offline" | "online") {
    this.offline = mode === "offline";
    this.showGuide(mode === "offline" ? {
      key: "service-status",
      title: "服务器暂时离线",
      detail: "正在后台尝试重新连接，恢复后会自动同步。",
      tone: "offline",
      priority: 100,
    } : {
      key: "service-status",
      title: "已重新连接",
      detail: "通知和创作状态已恢复同步。",
      tone: "online",
      priority: 100,
      duration: 2600,
    });
  }
}
