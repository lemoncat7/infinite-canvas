import type { FlowNode } from "./node-types";
import { compactPromptPart } from "./image-node";

export function clipVideoPrompt(value: string, maxLength: number) {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= maxLength
    ? text
    : `${text.slice(0, Math.max(1, maxLength - 1)).replace(/[，、；：,.\s]+$/, "")}…`;
}

export function composeStoryboardPrompt(prompt: string, inputs: FlowNode[]) {
  const references = inputs
    .slice(0, 4)
    .map(
      (source, index) =>
        `图${index + 1}「${clipVideoPrompt(source.title, 14)}」`,
    )
    .join("、");
  const guide = references
    ? `参考${references}；保持人物身份、服装、道具和场景一致。`
    : "";
  const separator = guide ? "\n" : "",
    available = Math.max(80, 220 - guide.length - separator.length);
  return `${clipVideoPrompt(prompt, available)}${separator}${guide}`;
}

export function fitVideoDialogue(value: string, durationValue: number) {
  const duration = Math.max(3, Math.min(8, Number(durationValue) || 5)),
    limit = Math.round(duration * 10),
    lines = value
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
  let result = "";
  for (const line of lines) {
    const next = result ? `${result}；${line}` : line;
    if (next.length > limit) break;
    result = next;
  }
  return result || compactPromptPart(value, limit);
}

export function inferAnonymousCrowd(value: string) {
  const text = value.replace(
    /(?:无人知道|无人知晓|鲜为人知|人尽皆知|不为人知|杳无人烟|空无一人|没有人|无人物|禁止[^。；]{0,12}(?:人群|群众|路人|行人))/g,
    "",
  );
  return /(?:匿名|背景|远处|周围|成群|一群|多名|数名|若干|拥挤|熙攘)[^。；]{0,10}(?:路人|群众|人群|行人|围观者|学生|玩家|观众|乘客|村民|市民)|(?:路人|群众|人群|行人|围观者|学生们|玩家们|观众|乘客|村民|市民)[^。；]{0,10}(?:聚集|围观|经过|站立|散布|交谈|欢呼|奔跑)/.test(
    text,
  );
}

export function speechSegments(
  value: string,
  characterNames: string[],
) {
  const roles = [
      "旁白",
      "系统播报",
      "系统声音",
      "系统",
      ...characterNames,
    ].filter((role, index, list) => role && list.indexOf(role) === index),
    escaped = roles
      .map((role) => role.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|"),
    matcher = new RegExp(
      `(?:^|[。；;\\n])\\s*(${escaped})\\s*[：:]\\s*([\\s\\S]*?)(?=(?:[。；;\\n]\\s*(?:${escaped})\\s*[：:])|$)`,
      "g",
    ),
    segments: Array<{ roleName: string; text: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(value))) {
    const roleName = /^系统/.test(match[1]) ? "系统播报" : match[1],
      text = match[2].trim().replace(/[；;]+$/, "");
    if (text) segments.push({ roleName, text });
  }
  return segments;
}
