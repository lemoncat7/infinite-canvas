import { apiFetch } from "../services/api";

type AppNotification = {
  id: string;
  title: string;
  content: string;
  type: string;
  createdAt: string;
  isRead: boolean;
};

type NotificationCenterOptions = {
  modal: HTMLElement;
  list: HTMLElement;
  count: HTMLElement;
  openButton: HTMLElement;
  getUserId: () => string | undefined;
  closeTopbarMenus: (opening: boolean) => void;
  toast: (message: string, type: "error") => void;
};

export class NotificationCenterController {
  private notifications: AppNotification[] = [];
  private visibleCount = 3;
  private popupCheckedUserId = "";
  private readonly loadObserver: IntersectionObserver;

  constructor(private readonly options: NotificationCenterOptions) {
    this.loadObserver = new IntersectionObserver(
      (entries) => {
        if (
          !entries.some((entry) => entry.isIntersecting) ||
          this.visibleCount >= this.notifications.length
        )
          return;
        this.visibleCount = Math.min(
          this.notifications.length,
          this.visibleCount + 3,
        );
        this.render();
      },
      { root: options.list, rootMargin: "0px 0px 20px" },
    );
    this.bindEvents();
  }

  async load() {
    const userId = this.options.getUserId();
    if (!userId) {
      this.notifications = [];
      this.popupCheckedUserId = "";
      this.render();
      return;
    }
    try {
      const response = await apiFetch("/api/notifications");
      if (!response.ok) throw new Error(String(response.status));
      this.notifications = (await response.json()) as AppNotification[];
      this.render();
      void this.claimDailyPopup(userId);
    } catch {
      this.options.count.textContent = "!";
      if (this.options.modal.classList.contains("open"))
        this.options.list.innerHTML =
          '<div class="notification-empty"><i>!</i><b>通知加载失败</b><span>请稍后重新打开</span></div>';
    }
  }

  close() {
    this.options.modal.classList.remove("open");
  }

  private bindEvents() {
    this.options.openButton.addEventListener("click", () => {
      const opening = !this.options.modal.classList.contains("open");
      this.options.closeTopbarMenus(opening);
      if (!opening) return;
      this.visibleCount = 3;
      this.options.list.scrollTop = 0;
      this.options.modal.classList.add("open");
      void this.load();
    });
    this.options.list.addEventListener(
      "scroll",
      () => {
        if (
          this.visibleCount >= this.notifications.length ||
          this.options.list.scrollTop + this.options.list.clientHeight <
            this.options.list.scrollHeight - 18
        )
          return;
        this.visibleCount = Math.min(
          this.notifications.length,
          this.visibleCount + 3,
        );
        this.render();
      },
      { passive: true },
    );
    this.options.modal
      .querySelectorAll("[data-notification-close]")
      .forEach((button) =>
        button.addEventListener("click", () => this.close()),
      );
    this.options.modal.addEventListener("pointerdown", (event) => {
      if (event.target === this.options.modal) this.close();
    });
    this.options.modal
      .querySelector<HTMLElement>("[data-notification-read-all]")!
      .addEventListener("click", () => void this.markAllRead());
  }

  private render() {
    const scrollTop = this.options.list.scrollTop;
    const unread = this.notifications.filter((item) => !item.isRead).length;
    const visible = this.notifications.slice(0, this.visibleCount);
    this.loadObserver.disconnect();
    this.options.count.textContent = String(unread);
    this.options.count.parentElement!.classList.toggle("has-unread", unread > 0);
    this.options.count.parentElement!.title = unread
      ? `${unread} 条未读通知`
      : "暂无未读通知";
    this.options.list.innerHTML = this.notifications.length
      ? visible
          .map(
            (item) =>
              `<article class="notification-item${item.isRead ? " read" : " unread"}" data-notification-id="${escapeHtml(item.id)}"><i aria-hidden="true"></i><div><header><span>${item.type === "fix" ? "问题修复" : "产品更新"}</span><time>${escapeHtml(notificationTime(item.createdAt))}</time></header><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.content)}</p></div></article>`,
          )
          .join("") +
        (visible.length < this.notifications.length
          ? `<div class="notification-load-hint">向下滚动加载更多 · ${visible.length} / ${this.notifications.length}</div>`
          : "")
      : '<div class="notification-empty"><i>◇</i><b>暂时没有新通知</b><span>产品进展会在这里与你同步</span></div>';
    this.options.list.scrollTop = scrollTop;
    const loadHint = this.options.list.querySelector<HTMLElement>(
      ".notification-load-hint",
    );
    if (loadHint) this.loadObserver.observe(loadHint);
    this.options.list
      .querySelectorAll<HTMLElement>("[data-notification-id]")
      .forEach((item) =>
        item.addEventListener("click", () => void this.markRead(item)),
      );
  }

  private async markRead(element: HTMLElement) {
    const id = element.dataset.notificationId!;
    const target = this.notifications.find((entry) => entry.id === id);
    if (!target || target.isRead) return;
    target.isRead = true;
    this.render();
    const response = await apiFetch(
      `/api/notifications/${encodeURIComponent(id)}/read`,
      { method: "POST" },
    );
    if (!response.ok) {
      target.isRead = false;
      this.render();
      this.options.toast("通知状态同步失败，请稍后重试", "error");
    }
  }

  private async markAllRead() {
    if (!this.notifications.some((item) => !item.isRead)) return;
    const previous = this.notifications.map((item) => item.isRead);
    this.notifications.forEach((item) => (item.isRead = true));
    this.render();
    const response = await apiFetch("/api/notifications/read-all", {
      method: "POST",
    });
    if (!response.ok) {
      this.notifications.forEach(
        (item, index) => (item.isRead = previous[index]),
      );
      this.render();
      this.options.toast("全部已读同步失败，请稍后重试", "error");
    }
  }

  private async claimDailyPopup(userId: string) {
    if (this.popupCheckedUserId === userId) return;
    this.popupCheckedUserId = userId;
    try {
      const response = await apiFetch("/api/notifications/claim-popup", {
        method: "POST",
      });
      const result = (await response.json()) as { show?: boolean };
      if (response.ok && result.show) this.options.modal.classList.add("open");
    } catch {
      // The unread badge remains available if popup claiming fails.
    }
  }
}

export class OnlinePresenceView {
  private count: number | undefined;
  readonly button = document.createElement("button");
  readonly panel = document.createElement("div");

  constructor(
    anchor: Element,
    closeTopbarMenus: (opening: boolean) => void,
  ) {
    this.button.id = "online-status";
    this.button.type = "button";
    this.button.ariaLabel = "在线状态";
    this.button.innerHTML = "<i></i><b>同步中</b>";
    this.panel.id = "online-status-panel";
    this.panel.innerHTML =
      "<header><i></i><span><b>创作空间在线</b><small>按登录用户去重统计</small></span></header><p>关闭页面或连接中断后，在线状态会自动更新。</p>";
    anchor.before(this.button, this.panel);
    this.button.addEventListener("click", (event) => {
      event.stopPropagation();
      const opening = !this.panel.classList.contains("open");
      closeTopbarMenus(opening);
      this.panel.classList.toggle("open", opening);
    });
    this.panel.addEventListener("click", (event) => event.stopPropagation());
  }

  render(count = this.count, reconnecting = false) {
    if (count !== undefined) this.count = count;
    const label =
      count === undefined
        ? "同步中"
        : count <= 1
          ? "创作空间在线"
          : `${count} 人在线`;
    this.button.querySelector("b")!.textContent = label;
    this.button.classList.toggle("connected", count !== undefined);
    this.button.classList.toggle("reconnecting", reconnecting);
    this.button.title = reconnecting ? "在线人数连接正在恢复" : label;
    this.panel.querySelector("header b")!.textContent = label;
    this.panel.querySelector("header small")!.textContent = reconnecting
      ? "连接波动，正在后台恢复"
      : "按登录用户去重统计";
  }

  current() {
    return this.count;
  }

  clear() {
    this.count = undefined;
  }
}

function notificationTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function escapeHtml(value: string) {
  const element = document.createElement("span");
  element.textContent = value;
  return element.innerHTML;
}
