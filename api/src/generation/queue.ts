import { prepareOwnedGenerationInputs } from "../assets/generation-inputs.js";
import { EMBEDDED_ONLY } from "../providers/reference-transport.js";
import { parseJsonArray, parseJsonObject } from "../core/json.js";
import { logger } from "../core/logging.js";
import { type JobInput } from "../core/types.js";
import { configuredProvider } from "../models/runtime.js";
import { type ResolvedModel } from "../models/types.js";
import { OpenAiImageProvider } from "../providers/openai-image.js";
import { OpenAiVideoProvider } from "../providers/openai-video.js";
import { database, getAll, getOne, persist } from "../storage/database.js";
import { generationProvider, modelStore } from "./config.js";
import { localImageFallback } from "./fallback.js";
import { updateJob } from "./job-state.js";
import { checkTracking, deferTracking, loadAcceptedTask, recoverTracking, saveAcceptedTask } from './task-tracking.js';
import { TrackingDeferred, TrackingStopped } from '../providers/task-tracking.js';

export const configuredImageConcurrency = Number(
  process.env.IMAGE_GENERATION_CONCURRENCY || 3,
);

export const configuredVideoConcurrency = Number(
  process.env.VIDEO_GENERATION_CONCURRENCY || 2,
);

export const configuredImageEditConcurrency = Number(
  process.env.IMAGE_EDIT_CONCURRENCY || 3,
);

export const generationConcurrency: Record<JobInput["kind"], number> = {
  image: Number.isFinite(configuredImageConcurrency)
    ? Math.max(1, Math.floor(configuredImageConcurrency))
    : 3,
  video: Number.isFinite(configuredVideoConcurrency)
    ? Math.max(1, Math.floor(configuredVideoConcurrency))
    : 2,
};

export const activeGenerationJobs: Record<JobInput["kind"], Set<string>> = {
  image: new Set(),
  video: new Set(),
};

export let queuePumpRunning = false;

export let generationQueueWakeTimer: ReturnType<typeof setTimeout> | null =
  null;
let stopping = false;
let recoveredTracking = false;
const runningTasks = new Set<Promise<void>>();

/** Stop admitting jobs and drain accepted work before closing the database. */
export async function stopGenerationQueue() {
  stopping = true;
  if (generationQueueWakeTimer) clearTimeout(generationQueueWakeTimer);
  generationQueueWakeTimer = null;
  await Promise.allSettled([...runningTasks]);
}

export function scheduleGenerationQueueWake() {
  if (stopping) return;
  if (generationQueueWakeTimer) clearTimeout(generationQueueWakeTimer);
  generationQueueWakeTimer = null;
  const next = getOne(
      "SELECT MIN(retry_after) AS retryAfter FROM jobs WHERE (status='queued' OR (status='running' AND id IN (SELECT job_id FROM video_task_checkpoints))) AND retry_after IS NOT NULL",
      [],
    ),
    retryAt = Date.parse(String(next?.retryAfter || ""));
  if (!Number.isFinite(retryAt)) return;
  generationQueueWakeTimer = setTimeout(
    () => {
      generationQueueWakeTimer = null;
      pumpGenerationQueue();
    },
    Math.max(100, retryAt - Date.now() + 100),
  );
  generationQueueWakeTimer.unref();
}

export function pumpGenerationQueue() {
  if (stopping || queuePumpRunning) return;
  if (!recoveredTracking) { recoverTracking(); recoveredTracking = true; }
  queuePumpRunning = true;
  try {
    for (const kind of ["video", "image"] as const)
      while (activeGenerationJobs[kind].size < generationConcurrency[kind]) {
        const job = nextQueuedGenerationJob(kind);
        if (!job) break;
        const id = String(job.id);
        activeGenerationJobs[kind].add(id);
        database.run(
          "UPDATE jobs SET status = 'running', error = NULL, retry_after = NULL, updated_at = ? WHERE id = ? AND status IN ('queued','running')",
          [new Date().toISOString(), id],
        );
        persist();
        logger.info(
          {
            jobId: id,
            kind,
            active: activeGenerationJobs[kind].size,
            concurrency: generationConcurrency[kind],
          },
          "generation queue started job",
        );
        const task = executeQueuedJob(job)
          .catch((error) => {
            logger.error({ jobId: id, error }, "generation worker failed");
          })
          .finally(() => {
            runningTasks.delete(task);
            activeGenerationJobs[kind].delete(id);
            queueMicrotask(pumpGenerationQueue);
          });
        runningTasks.add(task);
      }
  } finally {
    queuePumpRunning = false;
    scheduleGenerationQueueWake();
  }
}

export function isImageEditJob(job: Record<string, unknown>) {
  return parseJsonArray(job.input_urls).length > 0;
}

export function activeImageEditCount() {
  let count = 0;
  for (const id of activeGenerationJobs.image) {
    const job = getOne("SELECT input_urls FROM jobs WHERE id = ?", [id]);
    if (job && isImageEditJob(job)) count++;
  }
  return count;
}

export function nextQueuedGenerationJob(kind: JobInput["kind"]) {
  if (kind !== "image")
    return getOne(
      "SELECT * FROM jobs WHERE kind = ? AND ((status='queued' AND (retry_after IS NULL OR retry_after <= ?)) OR (status='running' AND retry_after <= ? AND id IN (SELECT job_id FROM video_task_checkpoints))) ORDER BY COALESCE(retry_after,created_at) ASC, rowid ASC LIMIT 1",
      [kind, new Date().toISOString(), new Date().toISOString()],
    );
  const imageEditConcurrency = Number.isFinite(configuredImageEditConcurrency)
    ? Math.max(
        1,
        Math.min(
          generationConcurrency.image,
          Math.floor(configuredImageEditConcurrency),
        ),
      )
    : 3;
  const editSlotAvailable = activeImageEditCount() < imageEditConcurrency;
  return getAll(
    "SELECT * FROM jobs WHERE status = 'queued' AND kind = 'image' ORDER BY created_at ASC, rowid ASC",
    [],
  ).find((job) => !isImageEditJob(job) || editSlotAvailable);
}

export async function executeQueuedJob(job: Record<string, unknown>) {
  const id = String(job.id),
    kind = String(job.kind) as JobInput["kind"],
    userId = String(job.user_id),
    model = String(job.model);
  try {
    const acceptedTask = loadAcceptedTask(id);
    const customId = String(job.custom_model_id || ""),
      custom = customId
        ? getOne("SELECT * FROM user_api_models WHERE id = ? AND user_id = ?", [
            customId,
            userId,
          ])
        : undefined;
    if (customId && (!custom || String(custom.kind) !== kind))
      throw new Error("自定义模型已被删除或类型不匹配");
    const snapshot = job.model_snapshot
      ? modelStore.secrets.open<ResolvedModel>(String(job.model_snapshot))
      : undefined;
    const provider = snapshot
      ? configuredProvider(snapshot)
      : custom
        ? kind === "image"
          ? new OpenAiImageProvider({
              baseUrl: String(custom.base_url),
              apiKey: String(custom.api_key),
            })
          : new OpenAiVideoProvider({
              baseUrl: String(custom.base_url),
              apiKey: String(custom.api_key),
            })
        : generationProvider;
    const rawInputUrls = parseJsonArray(job.input_urls),
      preparedInputs = acceptedTask ? { inputUrls: rawInputUrls, readInputAsDataUrl: undefined } : prepareOwnedGenerationInputs(
        rawInputUrls,
        userId,
        kind,
        provider.referencePolicy?.(model, kind) || EMBEDDED_ONLY,
      ), inputUrls = preparedInputs.inputUrls!;
    const parameters = parseJsonObject(job.parameters);
    let progress = Number(job.progress || 0);
    let updates = Promise.resolve(),
      lastError: unknown;
    // Video acceptance may be ambiguous after a timeout. Only the provider can
    // safely retry an explicit rejection; never replay the entire video workflow.
    const attempts = kind === "image" ? 3 : 1;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        await provider.run(
          {
            internalJobId: id,
            projectId: String(job.project_id),
            nodeId: Number(job.node_id),
            kind,
            prompt: String(job.prompt),
            model,
            inputUrls,
            readInputAsDataUrl: preparedInputs.readInputAsDataUrl,
            parameters,
            acceptedTask,
            saveAcceptedTask: task => saveAcceptedTask(id, task),
            checkTracking: () => checkTracking(id, stopping),
          },
          (update) => {
            progress = Math.max(progress, update.progress);
            update = { ...update, progress };
            updates = updates.then(() =>
              updateJob(
                id,
                update.status === "queued"
                  ? { ...update, status: "running" }
                  : update,
              ),
            );
          },
        );
        await updates;
        return;
      } catch (error) {
        await updates;
        lastError = error;
        if (attempt >= attempts || !isTransientGenerationError(error))
          throw error;
        logger.warn(
          {
            jobId: id,
            kind,
            attempt,
            error: error instanceof Error ? error.message : String(error),
          },
          "transient generation failure, retrying",
        );
        await updateJob(id, {
          status: "running",
          progress: Math.max(5, Math.min(20, attempt * 8)),
          error: undefined,
        });
        await new Promise((resolve) => setTimeout(resolve, attempt * 2500));
      }
    }
    if (
      !custom &&
      !snapshot &&
      kind === "image" &&
      process.env.SDCPP_IMAGE_FALLBACK_ENABLED === "true" &&
      !["flux1-kontext-dev", "z-image-turbo"].includes(model) &&
      isLocalImageFallbackError(lastError) &&
      localImageFallback
    ) {
      if (await localImageFallback.available()) {
        logger.warn(
          {
            jobId: id,
            model,
            error:
              lastError instanceof Error
                ? lastError.message
                : String(lastError),
          },
          "primary image provider failed, using local fallback",
        );
        await updateJob(id, {
          status: "running",
          progress: 3,
          error: undefined,
        });
        await localImageFallback.run(
          {
            internalJobId: id,
            projectId: String(job.project_id),
            nodeId: Number(job.node_id),
            kind,
            prompt: String(job.prompt),
            model: "flux1-kontext-dev",
            inputUrls,
            parameters,
          },
          (update) => {
            updates = updates.then(() =>
              updateJob(
                id,
                update.status === "queued"
                  ? { ...update, status: "running" }
                  : update,
              ),
            );
          },
        );
        await updates;
        return;
      }
    }
    throw lastError;
  } catch (error) {
    if (error instanceof TrackingStopped) return;
    if (error instanceof TrackingDeferred) {
      deferTracking(id, error);
      logger.warn({ jobId: id }, 'accepted video tracking deferred; original task will be queried again');
      return;
    }
    if (kind === "video" && isProviderQueueCapacityError(error)) {
      const retryCount = Number(job.retry_count || 0) + 1,
        retryDelayMs =
          Math.min(300_000, 20_000 * 2 ** Math.min(4, retryCount - 1)) +
          Math.floor(Math.random() * 5000),
        retryAfter = new Date(Date.now() + retryDelayMs).toISOString(),
        now = new Date().toISOString();
      database.run(
        "UPDATE jobs SET status='queued',progress=0,error=?,retry_after=?,retry_count=?,updated_at=? WHERE id=? AND status!='canceled'",
        [
          "Agnes 云端队列繁忙，正在等待自动重试",
          retryAfter,
          retryCount,
          now,
          id,
        ],
      );
      persist();
      logger.warn(
        { jobId: id, retryCount, retryAfter, retryDelayMs },
        "video provider queue full, job requeued",
      );
      return;
    }
    await updateJob(id, {
      status: "failed",
      progress: 0,
      error: error instanceof Error ? error.message : "Generation failed",
    });
  }
}

export function isProviderQueueCapacityError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /video queue is full|queue full|queue is full|server queue.*full|队列.*(?:已满|繁忙)/i.test(
    message,
  );
}

export function isTransientGenerationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /auth_unavailable|no auth available|unexpected EOF|ETIMEDOUT|timeout|timed out|aborted due to timeout|backend-api\/codex\/images/i.test(
      message,
    )
  )
    return false;
  return /ECONNRESET|ECONNREFUSED|fetch failed|socket|network|temporar|HTTP\/2 stream.*not closed cleanly|curl:\s*\(18\)|502|503|504/i.test(
    message,
  );
}

export function isLocalImageFallbackError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /safety|rejected|content policy|auth_unavailable|no auth available|unauthori[sz]ed|forbidden|\b400\b|\b401\b|\b403\b/i.test(
      message,
    )
  )
    return false;
  return /unexpected EOF|ETIMEDOUT|timeout|timed out|aborted|ECONNRESET|ECONNREFUSED|fetch failed|socket|network|temporar|\b429\b|\b5\d\d\b|backend-api\/codex\/images/i.test(
    message,
  );
}
