export const LABEL_TEXT_LAYOUT = {
  horizontalPadding: 22,
  titleTop: 32,
  titleFontSize: 16,
  titleLineHeight: 20,
  bodyTop: 62,
  bodyBottom: 18,
  bodyFontSize: 11,
  bodyLineHeight: 18,
  minScale: 0.7,
  maxScale: 2,
} as const;

export function labelBodyMetrics(width: number, height: number, scale = 1) {
  const fontScale = Math.max(
    LABEL_TEXT_LAYOUT.minScale,
    Math.min(LABEL_TEXT_LAYOUT.maxScale, scale),
  );
  const fontSize = LABEL_TEXT_LAYOUT.bodyFontSize * fontScale;
  const lineHeight = LABEL_TEXT_LAYOUT.bodyLineHeight * fontScale;
  const contentWidth = Math.max(
    80,
    width - LABEL_TEXT_LAYOUT.horizontalPadding * 2,
  );
  const contentHeight = Math.max(
    lineHeight,
    height - LABEL_TEXT_LAYOUT.bodyTop - LABEL_TEXT_LAYOUT.bodyBottom,
  );
  return {
    fontScale,
    titleFontSize: LABEL_TEXT_LAYOUT.titleFontSize * fontScale,
    titleLineHeight: LABEL_TEXT_LAYOUT.titleLineHeight * fontScale,
    fontSize,
    lineHeight,
    contentWidth,
    contentHeight,
    visibleLines: Math.max(1, Math.floor(contentHeight / lineHeight)),
  };
}

function characterWidth(character: string) {
  return /[\u0000-\u00ff]/.test(character) ? 0.55 : 1;
}

/** Shared viewport calculation for the Pixi label body and its wheel bounds. */
export function labelTextViewport(
  value: string,
  columns: number,
  visibleLines: number,
  requestedScroll = 0,
) {
  const normalized = value.replace(/\r/g, "").trim();
  if (!normalized)
    return { text: "暂无描述", scrollLine: 0, maxScrollLine: 0 };

  const lines: string[] = [];
  let line = "";
  let width = 0;
  const flush = () => {
    lines.push(line);
    line = "";
    width = 0;
  };
  for (const character of Array.from(normalized)) {
    if (character === "\n") {
      flush();
      continue;
    }
    const nextWidth = characterWidth(character);
    if (line && width + nextWidth > columns) flush();
    line += character;
    width += nextWidth;
  }
  if (line || !lines.length) flush();

  const maxScrollLine = Math.max(0, lines.length - visibleLines);
  const scrollLine = Math.min(
    maxScrollLine,
    Math.max(0, Math.round(requestedScroll)),
  );
  const end = Math.min(lines.length, scrollLine + visibleLines);
  const prefix = scrollLine > 0 ? "…" : "";
  const suffix = end < lines.length ? "…" : "";
  return {
    text: `${prefix}${lines.slice(scrollLine, end).join("\n")}${suffix}`,
    scrollLine,
    maxScrollLine,
  };
}
