import { apiFetch } from "../services/api";
import type { AuthUser } from "./user-menu-controller";

export type AuthMode = "login" | "register";

type AuthModalControllerOptions = {
  modal: HTMLElement;
  onAuthenticated: (user: AuthUser, mode: AuthMode) => Promise<void>;
};

export class AuthModalController {
  mode: AuthMode = "login";
  private readonly form: HTMLFormElement;

  constructor(private readonly options: AuthModalControllerOptions) {
    this.form = options.modal.querySelector<HTMLFormElement>("form")!;
    options.modal
      .querySelector(".home-login-close")!
      .addEventListener("click", () => this.close());
    options.modal.addEventListener("click", (event) => {
      if (event.target === options.modal) this.close();
    });
    options.modal
      .querySelectorAll<HTMLElement>("[data-auth-mode]")
      .forEach((button) =>
        button.addEventListener("click", () =>
          this.setMode(button.dataset.authMode as AuthMode),
        ),
      );
    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.submit();
    });
    this.setMode("login");
  }

  open(mode: AuthMode) {
    this.setMode(mode);
    this.options.modal.classList.add("open");
    this.options.modal
      .querySelector<HTMLInputElement>('input[name="email"]')!
      .focus();
  }

  close() {
    this.options.modal.classList.remove("open");
  }

  setMode(mode: AuthMode) {
    this.mode = mode;
    this.options.modal
      .querySelectorAll<HTMLElement>("[data-auth-mode]")
      .forEach((button) =>
        button.classList.toggle("active", button.dataset.authMode === mode),
      );
    this.options.modal
      .querySelectorAll<HTMLElement>("[data-register-field]")
      .forEach((field) => {
        field.hidden = mode !== "register";
      });
    const name = this.field("name");
    const inviteCode = this.field("inviteCode");
    const account = this.field("email");
    name.required = mode === "register";
    inviteCode.required = mode === "register";
    name.parentElement!.firstChild!.textContent = "用户名";
    name.placeholder = "用于登录，例如 creator_01";
    account.type = mode === "register" ? "email" : "text";
    account.autocomplete = mode === "register" ? "email" : "username";
    account.placeholder =
      mode === "register" ? "name@example.com" : "输入用户名或邮箱";
    account.parentElement!.firstChild!.textContent =
      mode === "register" ? "邮箱" : "用户名 / 邮箱";
    this.submitButton.textContent =
      mode === "register" ? "使用邀请码创建账号" : "登录";
    this.errorOutput.textContent = "";
  }

  private async submit() {
    const completedMode = this.mode;
    this.submitButton.disabled = true;
    this.errorOutput.textContent = "";
    try {
      const data = new FormData(this.form);
      const response = await apiFetch(`/api/auth/${completedMode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          inviteCode: data.get("inviteCode"),
          email: data.get("email"),
          password: data.get("password"),
        }),
      });
      const result = (await response.json()) as AuthUser & { error?: string };
      if (!response.ok) throw new Error(result.error || "登录失败");
      await this.options.onAuthenticated(result, completedMode);
      this.close();
      this.form.reset();
    } catch (reason) {
      this.errorOutput.textContent =
        reason instanceof Error ? reason.message : "登录失败，请重试";
    } finally {
      this.submitButton.disabled = false;
    }
  }

  private field(name: string) {
    return this.options.modal.querySelector<HTMLInputElement>(
      `input[name="${name}"]`,
    )!;
  }

  private get submitButton() {
    return this.form.querySelector<HTMLButtonElement>(".home-login-submit")!;
  }

  private get errorOutput() {
    return this.form.querySelector<HTMLOutputElement>(".home-login-error")!;
  }
}
