import { apiFetch } from "../services/api";

export type AuthUser = {
  id: string;
  name: string;
  username?: string;
  email: string;
  inviteCode?: string;
  createdAt: string;
  credits?: number;
  reservedCredits?: number;
  isAdmin?: boolean;
};

type UserMenuControllerOptions = {
  menu: HTMLElement;
  button: HTMLButtonElement;
  homeLogin: HTMLButtonElement;
  homeEnter: HTMLButtonElement;
  logoutButton: HTMLElement;
  inviteCopyButton: HTMLButtonElement;
  getUser: () => AuthUser | null;
  setUser: (user: AuthUser) => void;
  closeTopbarMenus: (opening: boolean) => void;
  logout: () => Promise<void>;
  toast: (message: string, type: "success" | "error") => void;
};

export class UserMenuController {
  private visibleToken = "";
  private readonly renameButton = document.createElement("button");

  constructor(private readonly options: UserMenuControllerOptions) {
    this.renameButton.id = "rename-user";
    this.renameButton.type = "button";
    this.renameButton.title = "修改昵称";
    this.renameButton.setAttribute("aria-label", "修改昵称");
    this.renameButton.textContent = "✎";
    options.menu.querySelector("header")!.append(this.renameButton);
    this.bindEvents();
  }

  render(user: AuthUser | null) {
    const initial = user?.name?.slice(0, 1).toUpperCase() ?? "V";
    const available = Math.max(
      0,
      Number(user?.credits ?? 0) - Number(user?.reservedCredits ?? 0),
    );
    this.options.homeLogin.disabled = Boolean(user);
    this.options.homeLogin.textContent = user
      ? `${user.name} · 已登录`
      : "登录";
    this.options.homeEnter.textContent = user ? "返回工作台" : "进入工作台";
    this.options.button.querySelector("span")!.textContent = initial;
    this.options.button.querySelector("b")!.textContent = user?.name ?? "用户";
    this.options.menu.querySelector("header i")!.textContent = initial;
    this.options.menu.querySelector("strong")!.textContent = user?.name ?? "";
    this.options.menu.querySelector("header small")!.textContent = [
      user?.username ? `@${user.username}` : "",
      user?.email ?? "",
    ]
      .filter(Boolean)
      .join(" · ");
    this.options.menu.querySelector<HTMLElement>(
      "#copy-invite-code b",
    )!.textContent = user?.inviteCode ?? "—";
    const credits = this.options.menu.querySelector<HTMLButtonElement>(
      "#open-lab",
    )!;
    credits.querySelector("small")!.textContent = `${available} 点`;
    credits.classList.toggle("enabled", available > 0);
  }

  clearToken() {
    this.visibleToken = "";
  }

  close() {
    this.options.menu.classList.remove("open");
  }

  private bindEvents() {
    this.renameButton.addEventListener("click", (event) => {
      event.stopPropagation();
      void this.editNickname();
    });
    this.options.button.addEventListener("click", (event) => {
      event.stopPropagation();
      const opening = !this.options.menu.classList.contains("open");
      this.options.closeTopbarMenus(opening);
      if (opening) {
        this.options.menu.classList.add("open");
        void this.loadTokenState();
      }
    });
    this.options.logoutButton.addEventListener("click", () => {
      void this.options.logout();
    });
    this.options.inviteCopyButton.addEventListener("click", () => {
      void this.copyInviteCode();
    });
    this.options.menu
      .querySelector<HTMLButtonElement>("[data-token-refresh]")!
      .addEventListener("click", (event) => {
        event.stopPropagation();
        void this.refreshToken(event.currentTarget as HTMLButtonElement);
      });
    this.options.menu
      .querySelector<HTMLButtonElement>("[data-token-copy]")!
      .addEventListener("click", (event) => {
        event.stopPropagation();
        void this.copyToken(event.currentTarget as HTMLButtonElement);
      });
    document.addEventListener("pointerdown", (event) => {
      if (
        !(event.target as HTMLElement | null)?.closest(
          "#workspace-user,#workspace-user-menu",
        )
      )
        this.close();
    });
  }

  private async loadTokenState() {
    if (!this.options.getUser()) return;
    const code = this.tokenCode();
    const copy = this.tokenCopyButton();
    const refresh = this.tokenRefreshButton();
    try {
      const response = await apiFetch("/api/users/me/api-token");
      const result = (await response.json()) as {
        exists?: boolean;
        hint?: string;
      };
      if (!response.ok) throw new Error();
      if (!this.visibleToken)
        code.textContent = result.exists ? result.hint || "已生成" : "尚未生成";
      copy.disabled = !this.visibleToken;
      refresh.textContent = result.exists ? "刷新" : "生成";
    } catch {
      code.textContent = "读取失败";
    }
  }

  private async editNickname() {
    const user = this.options.getUser();
    if (!user) return;
    const header = this.options.menu.querySelector("header")!;
    const name = header.querySelector<HTMLElement>("strong")!;
    const input = document.createElement("input");
    input.className = "user-name-input";
    input.value = user.name;
    input.maxLength = 40;
    name.hidden = true;
    this.renameButton.hidden = true;
    name.after(input);
    input.focus();
    input.select();
    let finished = false;
    const finish = async (save: boolean) => {
      if (finished) return;
      finished = true;
      const nextName = input.value.trim();
      input.remove();
      name.hidden = false;
      this.renameButton.hidden = false;
      if (!save || nextName === user.name) return;
      if (nextName.length < 2) {
        this.options.toast("昵称至少需要 2 个字符", "error");
        return;
      }
      const response = await apiFetch("/api/users/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: nextName }),
      });
      const result = (await response.json().catch(() => ({}))) as AuthUser & {
        error?: string;
      };
      if (!response.ok) {
        this.options.toast(result.error || "昵称修改失败", "error");
        return;
      }
      const updated = { ...user, name: result.name };
      this.options.setUser(updated);
      this.render(updated);
      this.options.toast("昵称已更新", "success");
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        void finish(false);
      }
    });
    input.addEventListener("blur", () => void finish(true));
  }

  private async copyInviteCode() {
    const inviteCode = this.options.getUser()?.inviteCode;
    if (!inviteCode) return;
    await navigator.clipboard.writeText(inviteCode);
    const label = this.options.inviteCopyButton.querySelector<HTMLElement>(
      "span",
    )!;
    label.textContent = "已复制";
    window.setTimeout(() => (label.textContent = "复制"), 1400);
  }

  private async refreshToken(button: HTMLButtonElement) {
    button.disabled = true;
    button.textContent = "生成中…";
    try {
      const response = await apiFetch("/api/users/me/api-token", {
        method: "POST",
      });
      const result = (await response.json()) as {
        token?: string;
        error?: string;
      };
      if (!response.ok || !result.token)
        throw new Error(result.error || "Token 生成失败");
      this.visibleToken = result.token;
      this.tokenCode().textContent = result.token;
      this.tokenCode().title = result.token;
      this.tokenCopyButton().disabled = false;
      button.textContent = "刷新";
      await navigator.clipboard.writeText(result.token).catch(() => {});
      this.options.toast("新 Token 已生成并复制，请妥善保存", "success");
    } catch (reason) {
      this.options.toast(
        reason instanceof Error ? reason.message : "Token 生成失败",
        "error",
      );
      button.textContent = "重试";
    } finally {
      button.disabled = false;
    }
  }

  private async copyToken(button: HTMLButtonElement) {
    if (!this.visibleToken) return;
    await navigator.clipboard.writeText(this.visibleToken);
    button.textContent = "已复制";
    window.setTimeout(() => (button.textContent = "复制"), 1200);
  }

  private tokenCode() {
    return this.options.menu.querySelector<HTMLElement>("[data-user-token]")!;
  }

  private tokenCopyButton() {
    return this.options.menu.querySelector<HTMLButtonElement>(
      "[data-token-copy]",
    )!;
  }

  private tokenRefreshButton() {
    return this.options.menu.querySelector<HTMLButtonElement>(
      "[data-token-refresh]",
    )!;
  }
}
