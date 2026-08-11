export type ProjectDialogOptions = {
  title: string;
  description: string;
  value?: string;
  confirm: string;
  danger?: boolean;
};

export function createProjectDialog(dialog: HTMLElement) {
  return (options: ProjectDialogOptions) =>
    new Promise<string | boolean>((resolve) => {
      const form = dialog.querySelector<HTMLFormElement>("form")!,
        label = form.querySelector<HTMLLabelElement>("label")!,
        input = form.querySelector<HTMLInputElement>("input")!,
        confirm = form.querySelector<HTMLButtonElement>("[data-dialog-confirm]")!;
      form.querySelector("h2")!.textContent = options.title;
      form.querySelector("p")!.textContent = options.description;
      label.hidden = options.value === undefined;
      input.value = options.value ?? "";
      input.required = options.value !== undefined;
      confirm.textContent = options.confirm;
      confirm.classList.toggle("danger", Boolean(options.danger));
      dialog.classList.add("open");
      const finish = (result: string | boolean) => {
        dialog.classList.remove("open");
        form.onsubmit = null;
        form.querySelector<HTMLButtonElement>("[data-dialog-cancel]")!.onclick = null;
        resolve(result);
      };
      form.onsubmit = (event) => {
        event.preventDefault();
        finish(options.value === undefined ? true : input.value.trim());
      };
      form.querySelector<HTMLButtonElement>("[data-dialog-cancel]")!.onclick =
        () => finish(false);
      if (!label.hidden)
        requestAnimationFrame(() => {
          input.focus();
          input.select();
        });
    });
}

export function formatProjectTime(value: string) {
  const time = Date.parse(value),
    delta = Date.now() - time;
  if (!Number.isFinite(time)) return "最近进入";
  if (delta < 60_000) return "刚刚进入";
  if (delta < 3_600_000)
    return `${Math.max(1, Math.floor(delta / 60_000))} 分钟前进入`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前进入`;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
  }).format(new Date(time));
}
