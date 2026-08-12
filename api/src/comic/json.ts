export function parseFirstJsonObject(raw: string, label: string) {
  const normalized = raw.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  const start = normalized.indexOf("{");
  if (start < 0) throw new SyntaxError(`${label}未返回 JSON 对象`);
  let depth = 0, inString = false, escaped = false;
  for (let index = start; index < normalized.length; index++) {
    const character = normalized[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') { inString = true; continue; }
    if (character === "{") depth++;
    else if (character === "}" && --depth === 0) {
      const value = JSON.parse(normalized.slice(start, index + 1)) as Record<string, unknown>;
      const trailing = normalized.slice(index + 1).replace(/^\s*```\s*/i, "").trim();
      return { value, trailingLength: trailing.length };
    }
  }
  throw new SyntaxError(`${label}返回了不完整的 JSON`);
}
