import { apiFetch } from "../services/api";
import type { AuthUser } from "./user-menu-controller";

type CreditLabControllerOptions = {
  modal: HTMLElement;
  openButton: HTMLElement;
  getUser: () => AuthUser | null;
  setUser: (user: AuthUser) => void;
  closeUserMenu: () => void;
  onCreditsChanged: () => void;
  toast: (message: string, type: "success") => void;
};

export class CreditLabController {
  private readonly redeemForm: HTMLFormElement;
  private readonly adminForm: HTMLFormElement;
  private readonly codesOutput: HTMLTextAreaElement;

  constructor(private readonly options: CreditLabControllerOptions) {
    this.redeemForm = options.modal.querySelector<HTMLFormElement>(
      "#credit-redeem-form",
    )!;
    this.adminForm = options.modal.querySelector<HTMLFormElement>(
      "#credit-admin-form",
    )!;
    this.codesOutput = this.adminForm.querySelector<HTMLTextAreaElement>(
      "textarea",
    )!;
    options.openButton.addEventListener("click", () => this.open());
    options.modal
      .querySelectorAll<HTMLElement>("[data-lab-close]")
      .forEach((button) =>
        button.addEventListener("click", () => this.close()),
      );
    options.modal.addEventListener("pointerdown", (event) => {
      if (event.target === options.modal) this.close();
    });
    this.redeemForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.redeem();
    });
    this.adminForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.generateCodes();
    });
    this.adminForm
      .querySelector("[data-copy-codes]")!
      .addEventListener("click", () => void this.copyCodes());
  }

  private open() {
    this.options.closeUserMenu();
    const user = this.options.getUser();
    const available = Math.max(
      0,
      Number(user?.credits ?? 0) - Number(user?.reservedCredits ?? 0),
    );
    this.options.modal.querySelector<HTMLElement>(
      "[data-credit-value]",
    )!.textContent = String(available);
    this.options.modal.querySelector<HTMLElement>(
      "[data-credit-reserved]",
    )!.textContent =
      Number(user?.reservedCredits ?? 0) > 0
        ? `${user!.reservedCredits} 点正在生成任务中冻结`
        : "";
    this.adminForm.hidden = !user?.isAdmin;
    this.options.modal.classList.add("open");
  }

  private close() {
    this.options.modal.classList.remove("open");
  }

  private async redeem() {
    const user = this.options.getUser();
    if (!user) return;
    const submit = this.redeemForm.querySelector<HTMLButtonElement>("button")!;
    const output = this.redeemForm.querySelector<HTMLOutputElement>("output")!;
    const code = new FormData(this.redeemForm).get("code");
    submit.disabled = true;
    output.textContent = "正在兑换…";
    try {
      const response = await apiFetch("/api/users/me/credits/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        added?: number;
        credits?: number;
        reservedCredits?: number;
        error?: string;
      };
      if (!response.ok) throw new Error(result.error || "兑换失败");
      this.options.setUser({
        ...user,
        credits: result.credits,
        reservedCredits: result.reservedCredits,
      });
      this.options.onCreditsChanged();
      this.options.modal.querySelector<HTMLElement>(
        "[data-credit-value]",
      )!.textContent = String(
        Math.max(
          0,
          Number(result.credits ?? 0) - Number(result.reservedCredits ?? 0),
        ),
      );
      this.redeemForm.reset();
      output.textContent = `兑换成功，已到账 ${result.added} 点`;
      this.options.toast(`已到账 ${result.added} 创作点数`, "success");
    } catch (reason) {
      output.textContent =
        reason instanceof Error ? reason.message : "兑换失败，请重试";
    } finally {
      submit.disabled = false;
    }
  }

  private async generateCodes() {
    const submit = this.adminForm.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    )!;
    const output = this.adminForm.querySelector<HTMLOutputElement>("output")!;
    const data = Object.fromEntries(new FormData(this.adminForm));
    submit.disabled = true;
    output.textContent = "正在生成…";
    try {
      const response = await apiFetch("/api/admin/recharge-codes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = (await response.json().catch(() => ({}))) as {
        codes?: string[];
        error?: string;
      };
      if (!response.ok) throw new Error(result.error || "生成失败");
      this.codesOutput.value = (result.codes ?? []).join("\n");
      output.textContent = `已生成 ${result.codes?.length ?? 0} 个充值码`;
    } catch (reason) {
      output.textContent = reason instanceof Error ? reason.message : "生成失败";
    } finally {
      submit.disabled = false;
    }
  }

  private async copyCodes() {
    if (!this.codesOutput.value) return;
    await navigator.clipboard.writeText(this.codesOutput.value);
    this.options.toast("充值码已复制", "success");
  }
}
