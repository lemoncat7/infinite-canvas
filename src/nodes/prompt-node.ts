import type { FlowNode } from "./node-types";

export function normalizePromptText(prompt?: string) {
  let value = prompt?.trim() || "";
  if (!value) return "";
  const blocks = value
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (
    blocks.length % 2 === 0 &&
    blocks.slice(0, blocks.length / 2).join("\n\n") ===
      blocks.slice(blocks.length / 2).join("\n\n")
  )
    value = blocks.slice(0, blocks.length / 2).join("\n\n");
  const lines = value.split("\n"),
    cleaned: string[] = [];
  for (const line of lines) {
    if (line.trim() && line.trim() === cleaned.at(-1)?.trim()) continue;
    cleaned.push(line);
  }
  return cleaned.join("\n").trim();
}

type PromptEditCallbacks = {
  onInput(): void;
  onFinish(): void;
};

/** Owns editable prompt-card text state and DOM editing lifecycle. */
export class PromptNodeController {
  editingId = 0;

  beginEdit(
    node: FlowNode,
    element: HTMLElement,
    callbacks: PromptEditCallbacks,
  ) {
    if (
      node.kind !== "prompt" ||
      node.status === "queued" ||
      node.status === "running"
    )
      return;
    const copy = element.querySelector<HTMLElement>(".node-copy");
    if (!copy) return;
    this.editingId = node.id;
    copy.contentEditable = "true";
    copy.classList.add("editing");
    element.classList.add("prompt-inline-editing");
    copy.focus();
    const range = document.createRange();
    range.selectNodeContents(copy);
    const browserSelection = getSelection();
    browserSelection?.removeAllRanges();
    browserSelection?.addRange(range);
    const finish = () => {
      if (this.editingId !== node.id) return;
      node.body = copy.innerText.trim();
      this.editingId = 0;
      copy.contentEditable = "false";
      copy.classList.remove("editing");
      element.classList.remove("prompt-inline-editing");
      copy.oninput = null;
      copy.onkeydown = null;
      copy.onblur = null;
      callbacks.onFinish();
    };
    copy.oninput = () => {
      node.body = copy.innerText;
      callbacks.onInput();
    };
    copy.onkeydown = (event) => {
      if (
        event.key === "Escape" ||
        ((event.metaKey || event.ctrlKey) && event.key === "Enter")
      ) {
        event.preventDefault();
        copy.blur();
      }
    };
    copy.onblur = finish;
  }

  reset() {
    this.editingId = 0;
  }
}
