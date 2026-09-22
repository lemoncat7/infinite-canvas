import { archiveJobResult } from "../assets/archive.js";
import { settleJobCredits } from "../billing/settlement.js";
import { logger } from "../core/logging.js";
import { type GenerationUpdate } from "../providers/index.js";
import { database, getOne, persist } from "../storage/database.js";
import { TrackingDeferred } from '../providers/task-tracking.js';

export async function updateJob(id: string, update: GenerationUpdate) {
  if (
    String(getOne("SELECT status FROM jobs WHERE id = ?", [id])?.status) ===
    "canceled"
  )
    return;
  let resultUrl = update.resultUrl;
  let succeeded = update.status === "succeeded";
  try {
    if (update.status === "succeeded" && resultUrl)
      resultUrl = await archiveJobResult(id, resultUrl);
    if (getOne('SELECT status FROM jobs WHERE id=?', [id])?.status === 'canceled') return;
    database.run(
      "UPDATE jobs SET status = ?, progress = ?, result_url = COALESCE(?, result_url), result_metadata = COALESCE(?, result_metadata), error = ?, updated_at = ? WHERE id = ?",
      [
        update.status,
        update.progress,
        resultUrl ?? null,
        update.resultMetadata ? JSON.stringify(update.resultMetadata) : null,
        update.error ?? null,
        new Date().toISOString(),
        id,
      ],
    );
  } catch (error) {
    // The video exists upstream. A failed download must not discard its task or refund it as a generation failure.
    if (getOne('SELECT job_id FROM video_task_checkpoints WHERE job_id=?', [id])) throw new TrackingDeferred(30000);
    succeeded = false;
    logger.error(
      {
        jobId: id,
        resultSource: resultUrl
          ? (() => {
              try {
                return new URL(resultUrl).host;
              } catch {
                return "inline-or-local";
              }
            })()
          : "missing",
        error:
          error instanceof Error
            ? { message: error.message, cause: error.cause }
            : String(error),
      },
      "job result archive failed",
    );
    database.run(
      "UPDATE jobs SET status = ?, progress = ?, error = ?, updated_at = ? WHERE id = ?",
      [
        "failed",
        0,
        `结果保存到资产库失败：${error instanceof Error ? error.message : "unknown error"}`,
        new Date().toISOString(),
        id,
      ],
    );
  }
  if (update.status === "succeeded" || update.status === "failed")
    settleJobCredits(id, succeeded);
  persist();
}
