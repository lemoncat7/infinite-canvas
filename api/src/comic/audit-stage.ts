import { applyComicAuditRepairs, comicAuditSubset } from "./audit.js";
import { type ComicGenerationCheckpoint } from "./checkpoint-store.js";
import { comicAuditPrompt } from "./prompts.js";
import { createComicStageReader } from "./stage-reader.js";
import { ComicStreamState } from "./stream-state.js";

import type { FastifyBaseLogger } from "fastify";

export async function auditComicContinuity({
  allShots,
  shotBatchSize,
  readStage,
  outlineParts,
  log,
  emit,
  streamState,
  saveCheckpoint,
  shotPlan,
  batchCount,
}: {
  allShots: unknown[];
  shotBatchSize: number;
  readStage: ReturnType<typeof createComicStageReader>;
  outlineParts: unknown[];
  log: Pick<FastifyBaseLogger, "info" | "warn">;
  emit: (value: unknown) => void;
  streamState: ComicStreamState;
  saveCheckpoint: (patch: Partial<ComicGenerationCheckpoint>) => void;
  shotPlan: Record<string, unknown>;
  batchCount: number;
}) {
  const continuityAuditSubset = (shotNumbers: number[] = []) =>
    comicAuditSubset(allShots, shotBatchSize, shotNumbers);
  const auditSystem = comicAuditPrompt();
  let audit = await readStage(
    "正在审校跨段过渡…",
    auditSystem,
    JSON.stringify({
      outline: outlineParts.map((item) => ({
        act:
          item && typeof item === "object"
            ? (item as Record<string, unknown>).act
            : "",
        content: String(
          item && typeof item === "object"
            ? (item as Record<string, unknown>).content || ""
            : "",
        ).slice(0, 240),
      })),
      shots: continuityAuditSubset(),
    }),
    2200,
    94,
    97,
  );
  // Global issues are usually isolated to one boundary. Give targeted repair
  // enough room to converge instead of discarding an otherwise valid plan.
  for (let auditAttempt = 1; auditAttempt <= 6; auditAttempt++) {
    const repairs = Array.isArray(audit.repairs) ? audit.repairs : [],
      issues = Array.isArray(audit.issues) ? audit.issues : [];
    if (audit.valid === true && !issues.length) break;
    log.warn(
      { auditAttempt, issues, repairs },
      "comic continuity audit issues",
    );
    if (!repairs.length)
      throw new SyntaxError("跨段审校发现问题但未返回可执行修复");
    emit({
      type: "progress",
      progress: 97,
      phase: `镜头 ${
        repairs
          .map((repair) =>
            Number(
              repair && typeof repair === "object"
                ? (repair as Record<string, unknown>).shotNumber
                : 0,
            ),
          )
          .filter(Boolean)
          .join("、") || "边界"
      } 未通过，正在第 ${auditAttempt} 次定向修复…`,
      receivedBytes: streamState.receivedBytes,
      repairAttempt: auditAttempt,
    });
    applyComicAuditRepairs(allShots, repairs);
    saveCheckpoint({
      shotPlan,
      shots: allShots,
      completedBatches: batchCount,
    });
    emit({
      type: "progress",
      progress: 97,
      phase: `正在复检第 ${auditAttempt} 次边界修复结果…`,
      receivedBytes: streamState.receivedBytes,
      repairAttempt: auditAttempt,
    });
    audit = await readStage(
      "跨段修复复检中…",
      `${auditSystem} 本次是定向复检：只验证上一轮明确列出的 issues 是否已经通过 repairs 修复。除非仍存在会导致剧情事实矛盾、人物或道具状态冲突的硬错误，否则必须返回 valid=true；不得在复检时新增审美偏好、措辞优化或非阻断性建议。`,
      JSON.stringify({
        previousAudit: audit,
        shots: continuityAuditSubset(
          repairs.map((repair) =>
            Number(
              repair && typeof repair === "object"
                ? (repair as Record<string, unknown>).shotNumber
                : 0,
            ),
          ),
        ),
      }),
      1800,
      97,
      97,
      true,
    );
  }
  if (
    audit.valid !== true ||
    (Array.isArray(audit.issues) && audit.issues.length)
  )
    throw new SyntaxError("跨段连续性复检未通过");
  emit({
    type: "progress",
    progress: 98,
    phase: "全局连续性校验通过",
    receivedBytes: streamState.receivedBytes,
  });
}
