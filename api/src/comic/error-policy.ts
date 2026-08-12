export type ComicGenerationIssue = {
  code: string;
  stage: number;
  message: string;
  recoverable: boolean;
};

export function comicGenerationIssue(
  error: unknown,
  stage: number,
  recoverable: boolean,
): ComicGenerationIssue {
  const message = error instanceof Error ? error.message : String(error),
    code = /对白|时长|拆镜/.test(message)
      ? "E101"
      : /提示词|Prompt|超过\d+字/.test(message)
        ? "E203"
        : /人物|道具|场景|引用|索引/.test(message)
          ? "E301"
          : /连续性|跨段|转场|承接/.test(message)
            ? "E401"
            : /镜头|分镜/.test(message)
              ? "E201"
              : "E001";
  return { code, stage, message, recoverable };
}

export function comicGenerationErrorMessage(error: unknown, issue: ComicGenerationIssue) {
  if (error instanceof SyntaxError)
    return `漫剧校验未通过（${issue.code}）：${issue.message}。已保留通过校验的阶段，可直接继续。`;
  if (error instanceof DOMException && error.name === "TimeoutError")
    return "漫剧构思连续 60 秒没有新内容，请重试";
  return "漫剧策划暂时失败，请稍后重试";
}
