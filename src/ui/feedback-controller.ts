import { apiFetch } from "../services/api";

type FeedbackControllerOptions = {
  modal: HTMLElement;
  form: HTMLFormElement;
  openButton: HTMLElement;
  closeUserMenu: () => void;
  getProjectId: () => string;
  toast: (message: string, type: "success") => void;
};

export class FeedbackController {
  constructor(private readonly options: FeedbackControllerOptions) {
    options.openButton.addEventListener("click", () => this.open());
    options.modal
      .querySelectorAll("[data-feedback-close]")
      .forEach((button) =>
        button.addEventListener("click", () => this.close()),
      );
    options.modal.addEventListener("pointerdown", (event) => {
      if (event.target === options.modal) this.close();
    });
    options.form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.submit();
    });
  }

  private open() {
    this.options.closeUserMenu();
    this.options.modal.classList.add("open");
    this.options.form
      .querySelector<HTMLInputElement>('input[name="title"]')!
      .focus();
  }

  private close() {
    this.options.modal.classList.remove("open");
  }

  private async submit() {
    const submit = this.options.form.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    )!;
    const output = this.options.form.querySelector<HTMLOutputElement>(
      "output",
    )!;
    const data = Object.fromEntries(new FormData(this.options.form));
    submit.disabled = true;
    output.textContent = "正在提交…";
    try {
      const response = await apiFetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...data,
          projectId: this.options.getProjectId() || undefined,
          pageUrl: location.href,
          userAgent: navigator.userAgent,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        id?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(result.error || "提交失败");
      this.options.form.reset();
      output.textContent = "感谢反馈，我们已经收到。";
      this.options.toast("反馈已提交，感谢你的帮助", "success");
      window.setTimeout(() => {
        this.close();
        output.textContent = "";
      }, 1200);
    } catch (reason) {
      output.textContent =
        reason instanceof Error ? reason.message : "提交失败，请稍后重试";
    } finally {
      submit.disabled = false;
    }
  }
}
