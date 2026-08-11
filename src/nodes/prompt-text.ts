export function normalizePromptText(prompt?: string) {
  let value = prompt?.trim() || "";
  if (!value) return "";
  const blocks = value.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  if (blocks.length % 2 === 0 && blocks.slice(0, blocks.length / 2).join("\n\n") === blocks.slice(blocks.length / 2).join("\n\n"))
    value = blocks.slice(0, blocks.length / 2).join("\n\n");
  const cleaned: string[] = [];
  for (const line of value.split("\n")) {
    if (line.trim() && line.trim() === cleaned.at(-1)?.trim()) continue;
    cleaned.push(line);
  }
  return cleaned.join("\n").trim();
}

export function decodePromptClipboardText(value: string) {
  const encoded = (value.match(/%[0-9a-fA-F]{2}/g) || []).length;
  if (encoded < 2 && !/%20/i.test(value)) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value.replace(/%20/gi, " ");
  }
}
