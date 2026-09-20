export function parsePromptAgentResult(raw: string): Record<string, unknown> {
  if (!raw) throw new SyntaxError("Agent returned an empty response");
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const start = raw.indexOf("{"),
      end = raw.lastIndexOf("}");
    if (start >= 0 && end > start)
      return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    throw new SyntaxError("Agent returned truncated JSON");
  }
}

export const agnesPromptSections = [
  "Style",
  "Language",
  "Continuity",
  "Scene",
  "Camera",
  "Action",
  "Effects",
  "Audio",
  "Dialogue",
  "Voice",
  "Background",
  "Constraints",
] as const;

export function normalizeAgnesPrompt(value: string) {
  let normalized = value.replace(/\r\n?/g, "\n").trim();
  for (const section of agnesPromptSections)
    normalized = normalized.replace(
      new RegExp(`^${section}\\s*:?[ \\t]*$`, "gim"),
      `${section}:`,
    );
  for (const section of agnesPromptSections)
    normalized = normalized.replace(
      new RegExp(`^${section}:[ \\t]*\\n*`, "gim"),
      `${section}:\n`,
    );
  return normalized.replace(/\n{3,}/g, "\n\n");
}

export function validateAgnesPrompt(value: string) {
  let previous = -1;
  for (const section of agnesPromptSections) {
    const matches = value.match(new RegExp(`^${section}:$`, "gm")) || [];
    if (matches.length !== 1)
      return `Agnes prompt requires exactly one ${section}: section`;
    const index = value.indexOf(`${section}:`);
    if (index < 0) return `Agnes prompt missing ${section}:`;
    if (index <= previous) return "Agnes prompt section order is invalid";
    previous = index;
  }
  if (
    /follows? (?:the )?.{0,24}line of sight|camera sees|feels? closer|follows? the feeling/i.test(
      value,
    )
  )
    return "Agnes prompt contains abstract camera language";
  const required = [
    "No subtitles.",
    "No captions.",
    "No dialogue text.",
    "No narration text.",
    "No automatic transcription.",
    "No speech bubbles.",
    "No text overlays.",
    "No logos.",
    "No watermarks.",
    "Only animate the specified actions.",
    "Do not redesign characters.",
    "Do not change clothing.",
    "Do not change hairstyle.",
    "Do not change environment.",
    "No extra movement.",
    "No idle animation.",
    "No unnecessary camera movement.",
  ];
  return required.find((rule) => !value.includes(rule))
    ? "Agnes prompt is missing required constraints"
    : "";
}

export function compactImagePrompt(value: string, limit = 100) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  const sentences = normalized.match(/[^。！？；.!?;]+[。！？；.!?;]?/g) ?? [
    normalized,
  ];
  let compact = "";
  for (const sentence of sentences) {
    const next = `${compact}${sentence.trim()}`;
    if (next.length > limit) break;
    compact = next;
  }
  return (compact || normalized.slice(0, limit)).replace(/[，、：:\s]+$/, "");
}

export function sanitizeCharacterNamesFromScenePrompt(
  value: string,
  characterNames: string[],
) {
  let sanitized = value;
  for (const name of characterNames
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
    .sort((left, right) => right.length - left.length))
    sanitized = sanitized.replace(
      new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
      "",
    );
  sanitized = sanitized
    .replace(
      /(?:主角|男主|女主|角色|人物)[^，。；]{0,16}(?:站在|坐在|位于|走进|出现于)[^，。；]*/g,
      "",
    )
    .replace(/[，、；：]{2,}/g, "，")
    .replace(/^[，、；：\s]+|[，、；：\s]+$/g, "");
  return `纯场景环境基准图，禁止出现任何人物、人体、手部、角色剪影或人形主体；${sanitized}`;
}
