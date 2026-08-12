import { validateComicStage, type ComicValidationKind } from "./validation.js";

type ComicStageReader = (
  stage: string,
  system: string,
  content: string,
  maxTokens: number,
  progressStart: number,
  progressEnd: number,
  holdProgress: boolean,
) => Promise<Record<string, unknown>>;

type ComicRepairProgress = (update: {
  type: "progress";
  progress: number;
  phase: string;
  rewrite: number;
}) => void;

export async function repairComicStageUntilValid(options: {
  stage: string;
  value: Record<string, unknown>;
  kind: ComicValidationKind;
  system: string;
  contextText: string;
  progress: number;
  maxTokens: number;
  readStage: ComicStageReader;
  emit: ComicRepairProgress;
  maxRewrites?: number;
}) {
  const maxRewrites = options.maxRewrites ?? 2;
  let current = options.value;
  for (let rewrite = 1; rewrite <= maxRewrites; rewrite++) {
    const issues = validateComicStage(current, options.kind);
    if (!issues.length) return current;
    options.emit({
      type: "progress",
      progress: options.progress,
      phase: `${options.stage}校验发现 ${issues.length} 项问题，正在第 ${rewrite} 次重写…`,
      rewrite,
    });
    current = await options.readStage(
      `${options.stage}重写中…`,
      options.system,
      `保持原 JSON 的事实、编号、剧情和引用关系不变，只修复下列校验问题。不得删减必要剧情，不得新增无关内容。\n问题：\n${issues.join("\n")}\n\n上下文：\n${options.contextText}\n\n待重写 JSON：\n${JSON.stringify(current)}`,
      options.maxTokens,
      options.progress,
      options.progress,
      true,
    );
  }
  const remaining = validateComicStage(current, options.kind);
  if (remaining.length)
    throw new SyntaxError(`${options.stage}复检仍有 ${remaining.length} 项不合格`);
  return current;
}
