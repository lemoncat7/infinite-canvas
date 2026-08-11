import { apiFetch } from "../services/api";

export type CustomApiModel = {
  id: string;
  kind: "image" | "video";
  name: string;
  model: string;
  baseUrl: string;
  hasKey: boolean;
  hasProxy: boolean;
};

type CustomApiControllerOptions = {
  modal: HTMLElement;
  form: HTMLFormElement;
  list: HTMLElement;
  openButton: HTMLButtonElement;
  getModels: () => CustomApiModel[];
  setModels: (models: CustomApiModel[]) => void;
  closeUserMenu: () => void;
  refreshNodeModels: () => void;
};

export class CustomApiController {
  constructor(private readonly options: CustomApiControllerOptions) {
    options.openButton.addEventListener("click", () => this.open());
    options.modal
      .querySelector("[data-custom-close]")!
      .addEventListener("click", () => this.close());
    options.modal.addEventListener("pointerdown", (event) => {
      if (event.target === options.modal) this.close();
    });
    options.form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.add();
    });
    document
      .querySelector("#custom-api-test")!
      .addEventListener("click", () => void this.test());
  }

  async load() {
    const response = await apiFetch("/api/user-api-models");
    if (!response.ok) return;
    this.options.setModels((await response.json()) as CustomApiModel[]);
    this.render();
    this.options.refreshNodeModels();
  }

  private open() {
    if (this.options.openButton.disabled) return;
    this.options.closeUserMenu();
    this.options.modal.classList.add("open");
    void this.load();
  }

  private close() {
    this.options.modal.classList.remove("open");
  }

  private render() {
    const models = this.options.getModels();
    this.options.list.innerHTML = models.length
      ? models
          .map(
            (item) =>
              `<article class="custom-api-entry" data-custom-id="${item.id}"><b>${escapeHtml(item.name)}</b><small>${item.kind === "image" ? "图像" : "视频"} · ${escapeHtml(item.model)} · ${escapeHtml(item.baseUrl)}</small><button type="button">删除</button></article>`,
          )
          .join("")
      : '<article class="custom-api-entry"><b>还没有自定义模型</b><small>添加后会出现在对应节点的模型列表中</small></article>';
    this.options.list
      .querySelectorAll<HTMLButtonElement>("[data-custom-id] button")
      .forEach((button) =>
        button.addEventListener("click", () => void this.remove(button)),
      );
  }

  private async remove(button: HTMLButtonElement) {
    const id = button.closest<HTMLElement>("[data-custom-id]")!.dataset
      .customId!;
    const response = await apiFetch(`/api/user-api-models/${id}`, {
      method: "DELETE",
    });
    if (!response.ok) return;
    this.options.setModels(
      this.options.getModels().filter((item) => item.id !== id),
    );
    this.render();
    this.options.refreshNodeModels();
  }

  private async test() {
    const data = new FormData(this.options.form);
    const output = this.output;
    output.textContent = "正在测试连接…";
    const response = await apiFetch("/api/user-api-models/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseUrl: data.get("baseUrl"),
        apiKey: data.get("apiKey"),
      }),
    });
    const result = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    output.textContent = response.ok
      ? "连接成功"
      : `连接失败：${result.error || "未知错误"}`;
  }

  private async add() {
    const data = Object.fromEntries(new FormData(this.options.form));
    const response = await apiFetch("/api/user-api-models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
    const result = (await response.json().catch(() => ({}))) as CustomApiModel & {
      error?: string;
    };
    if (!response.ok) {
      this.output.textContent = result.error || "添加失败";
      return;
    }
    this.options.setModels([...this.options.getModels(), result]);
    this.options.form.reset();
    this.output.textContent = "已添加，可在模型列表中选择";
    this.render();
    this.options.refreshNodeModels();
  }

  private get output() {
    return this.options.form.querySelector<HTMLOutputElement>("output")!;
  }
}

function escapeHtml(value: string) {
  const element = document.createElement("span");
  element.textContent = value;
  return element.innerHTML;
}
