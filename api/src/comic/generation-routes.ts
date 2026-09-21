import { type FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import {
  resolveOwnedInputUrls,
  validateOwnedInputUrls,
} from "../assets/generation-inputs.js";
import { requireUser } from "../auth/service.js";
import { modelStore } from "../generation/config.js";
import { apiRoot } from "../models/network.js";
import { ownsProject } from "../projects/ownership.js";
import { database, getOne, persist } from "../storage/database.js";
import { auditComicContinuity } from "./audit-stage.js";
import {
  restoreComicCheckpoint,
  updateComicCheckpoint,
  type ComicGenerationCheckpoint,
} from "./checkpoint-store.js";
import {
  comicGenerationErrorMessage,
  comicGenerationIssue,
} from "./error-policy.js";
import { generateComicFoundation } from "./foundation-stage.js";
import { normalizeComicResult } from "./result-normalizer.js";
import { activeComicPlans } from "./runtime.js";
import { generateComicShots } from "./shots-stage.js";
import { createComicStageReader } from "./stage-reader.js";
import { repairComicStageUntilValid } from "./stage-repair.js";
import { ComicStreamState } from "./stream-state.js";

export function registerComicGenerationRoutes(app: FastifyInstance) {
  app.post("/agents/comic", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const input = request.body as {
      projectId?: string;
      sessionId?: string;
      idea?: string;
      duration?: string;
      aspectRatio?: string;
      context?: string[];
      visuals?: string[];
      previousPlan?: unknown;
      revision?: string;
      model?: string;
    };
    const projectId = String(input.projectId || ""),
      sessionId = String(input.sessionId || ""),
      comicSession = sessionId
        ? getOne(
            "SELECT id,brief,pending_revision AS pendingRevision,plan,generation_checkpoint AS generationCheckpoint FROM comic_sessions WHERE id=? AND user_id=? AND project_id=?",
            [sessionId, String(user.id), projectId],
          )
        : undefined;
    if (!projectId || !ownsProject(projectId, String(user.id)))
      return reply.code(404).send({ error: "当前漫剧项目不存在" });
    if (!comicSession)
      return reply
        .code(404)
        .send({ error: "漫剧会话已失效，请新建会话后重试" });
    const idea = String(input.idea ?? "").trim(),
      revision = String(input.revision ?? "").trim(),
      duration = String(input.duration || "由对话内容推断").slice(0, 30),
      aspectRatio = ["9:16", "16:9", "1:1"].includes(String(input.aspectRatio))
        ? String(input.aspectRatio)
        : "由对话内容推断";
    if (!idea && !input.previousPlan)
      return reply.code(400).send({ error: "请先描述你想创作的漫剧" });
    if (idea.length > 12000 || revision.length > 6000)
      return reply
        .code(400)
        .send({ error: "本次提交内容异常过长，请重新打开漫剧窗口后重试" });
    const textConfiguration = modelStore.resolve(input.model, "text", "comic");
    const baseUrl = apiRoot(
        textConfiguration?.connection.baseUrl ||
          process.env.PROMPT_AGENT_BASE_URL ||
          process.env.OPENAI_IMAGE_BASE_URL ||
          "",
      ),
      apiKey =
        textConfiguration?.connection.apiKey ??
        process.env.PROMPT_AGENT_API_KEY ??
        process.env.OPENAI_IMAGE_API_KEY ??
        "",
      model =
        textConfiguration?.model.model ||
        input.model ||
        process.env.PROMPT_AGENT_MODEL ||
        "gpt-5.5";
    if (!baseUrl || (!textConfiguration && !apiKey))
      return reply.code(503).send({ error: "灵感 Agent 接口尚未配置" });
    const visualSources = (input.visuals ?? [])
      .map(String)
      .filter((source) => /^\/api\/assets\/[^/]+\/content(?:\/|$)/.test(source))
      .slice(0, 8);
    let visualInputs: string[] = [];
    try {
      validateOwnedInputUrls(visualSources, String(user.id), "image");
      visualInputs = resolveOwnedInputUrls(
        visualSources,
        String(user.id),
        "image",
        model,
      );
    } catch {
      return reply.code(400).send({ error: "Agent 无法读取所选参考素材" });
    }
    let storedBrief = String(comicSession.brief || "{}"),
      confirmedBriefTitle = "";
    try {
      const value = JSON.parse(storedBrief) as { constraints?: unknown };
      confirmedBriefTitle = String(
        (value as Record<string, unknown>).title || "",
      )
        .trim()
        .slice(0, 100);
      if (Array.isArray(value.constraints))
        value.constraints = value.constraints.filter(
          (item) =>
            !/(?:暂不|不要|别|先不).{0,8}生成(?:完整)?(?:剧本|方案)/.test(
              String(item),
            ),
        );
      storedBrief = JSON.stringify(value);
    } catch {
      /* 沿用原始简报 */
    }
    const storedPlan = String(comicSession.plan || ""),
      previous =
        storedPlan ||
        (input.previousPlan && typeof input.previousPlan === "object"
          ? JSON.stringify(input.previousPlan)
          : "");
    const context = (input.context ?? [])
      .map(String)
      .filter(Boolean)
      .slice(0, 8);
    const effectiveRevision =
        String(comicSession.pendingRevision || "").trim() || revision,
      text = [
        `已确认创作简报：${storedBrief}`,
        `创作想法：${idea || "沿用创作简报"}`,
        `目标：${duration}，${aspectRatio}`,
        context.length
          ? `所选素材：\n${context.map((item, index) => `${index + 1}. ${item}`).join("\n")}`
          : "没有选择素材",
        previous ? `上一版方案：${previous}` : "",
        effectiveRevision
          ? `用户确认应用的修改：${effectiveRevision}`
          : "用户已确认，请生成第一版完整方案",
      ]
        .filter(Boolean)
        .join("\n\n");
    const content: unknown = visualInputs.length
      ? [
          { type: "text", text },
          ...visualInputs.map((url) => ({
            type: "image_url",
            image_url: { url },
          })),
        ]
      : text;
    const comicPipelineVersion = "compact-shot-plan-v4";
    const checkpointFingerprint = createHash("sha256")
      // Resolved visual inputs contain expiring signed URLs. Fingerprinting them
      // makes the same request look new on every retry and discards checkpoints.
      .update(
        JSON.stringify({ comicPipelineVersion, text, model, visualSources }),
      )
      .digest("hex");
    let checkpoint = restoreComicCheckpoint(
      comicSession.generationCheckpoint,
      checkpointFingerprint,
    );
    const saveCheckpoint = (patch: Partial<ComicGenerationCheckpoint>) => {
      const checkpointUpdatedAt = new Date().toISOString();
      checkpoint = updateComicCheckpoint(
        checkpoint,
        patch,
        checkpointFingerprint,
        checkpointUpdatedAt,
      );
      database.run(
        "UPDATE comic_sessions SET generation_checkpoint=?,updated_at=? WHERE id=? AND user_id=? AND project_id=?",
        [
          JSON.stringify(checkpoint),
          checkpointUpdatedAt,
          sessionId,
          String(user.id),
          projectId,
        ],
      );
      persist();
    };
    const comicLockKey = `${String(user.id)}:${projectId}`;
    if (activeComicPlans.has(comicLockKey))
      return reply
        .code(409)
        .send({ error: "当前项目已有完整剧本正在生成，请勿重复提交" });
    activeComicPlans.add(comicLockKey);
    database.run(
      "UPDATE comic_sessions SET generation_status='running',generation_stage=?,generation_progress=2,generation_received_bytes=0,generation_error='',generation_issues='[]',updated_at=? WHERE id=? AND user_id=? AND project_id=?",
      [
        revision ? "正在读取现有方案…" : "正在理解故事想法…",
        new Date().toISOString(),
        sessionId,
        String(user.id),
        projectId,
      ],
    );
    persist();
    const streamState = new ComicStreamState(model);
    let streamStarted = false,
      streamHeartbeat: ReturnType<typeof setInterval> | null = null,
      lastProgressPersistAt = 0,
      lastPersistedStage = "",
      lastPersistedProgress = -1;
    try {
      const proxyUrl = textConfiguration
        ? textConfiguration.connection.proxyUrl
        : String(
            process.env.PROMPT_AGENT_HTTPS_PROXY ||
              process.env.OPENAI_IMAGE_HTTPS_PROXY ||
              "",
          );
      reply.hijack();
      streamStarted = true;
      streamState.touch();
      reply.raw.writeHead(200, {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        "x-accel-buffering": "no",
        connection: "keep-alive",
      });
      const emit = (value: unknown) => {
        const event =
          value && typeof value === "object"
            ? (value as Record<string, unknown>)
            : {};
        if (event.type === "progress") {
          const stage = String(event.phase || ""),
            progress = Math.max(0, Math.min(99, Number(event.progress) || 0)),
            nowMs = Date.now(),
            shouldPersist =
              stage !== lastPersistedStage ||
              progress >= lastPersistedProgress + 2 ||
              nowMs - lastProgressPersistAt >= 2500;
          database.run(
            "UPDATE comic_sessions SET generation_status='running',generation_stage=?,generation_progress=?,generation_received_bytes=?,updated_at=? WHERE id=?",
            [
              stage,
              progress,
              Number(event.receivedBytes) || streamState.receivedBytes,
              new Date().toISOString(),
              sessionId,
            ],
          );
          if (shouldPersist) {
            persist();
            lastProgressPersistAt = nowMs;
            lastPersistedStage = stage;
            lastPersistedProgress = progress;
          }
        }
        if (!reply.raw.destroyed) reply.raw.write(`${JSON.stringify(value)}\n`);
      };
      emit({
        type: "start",
        message: revision ? "正在读取现有方案…" : "正在理解故事想法…",
      });
      streamHeartbeat = setInterval(() => {
        if (!reply.raw.destroyed)
          emit({
            type: "heartbeat",
            at: Date.now(),
            idleSeconds: streamState.idleSeconds(),
            receivedBytes: streamState.receivedBytes,
            progress: streamState.progress,
          });
      }, 10000);
      const headerTimeout = Math.max(
          20000,
          Math.min(
            90000,
            Number(process.env.COMIC_AGENT_HEADER_TIMEOUT_MS || 45000),
          ),
        ),
        idleTimeout = Math.max(
          20000,
          Math.min(
            120000,
            Number(process.env.COMIC_AGENT_IDLE_TIMEOUT_MS || 60000),
          ),
        );
      const readStage = createComicStageReader({
        baseUrl,
        apiKey,
        model,
        proxyUrl,
        headerTimeout,
        idleTimeout,
        managedModel: !!textConfiguration,
        connection: textConfiguration?.connection,
        state: streamState,
        emit,
        log: request.log,
      });
      const rewriteUntilValid = async (
        stage: string,
        value: Record<string, unknown>,
        kind: "assets" | "scenes" | "shots",
        system: string,
        contextText: string,
        progress: number,
        maxTokens: number,
      ) =>
        repairComicStageUntilValid({
          stage,
          value,
          kind,
          system,
          contextText,
          progress,
          maxTokens,
          readStage,
          emit: (update) =>
            emit({ ...update, receivedBytes: streamState.receivedBytes }),
        });
      const { foundation, outlineParts, allShots } =
        await generateComicFoundation({
          checkpoint,
          readStage,
          content,
          saveCheckpoint,
          emit,
          streamState,
          text,
          rewriteUntilValid,
        });
      const { shotPlan, shotBatchSize, batchCount } = await generateComicShots({
        checkpoint,
        readStage,
        saveCheckpoint,
        emit,
        streamState,
        text,
        foundation,
        outlineParts,
        allShots,
        log: request.log,
        visualInputs,
      });
      await auditComicContinuity({
        allShots,
        shotBatchSize,
        readStage,
        outlineParts,
        log: request.log,
        emit,
        streamState,
        saveCheckpoint,
        shotPlan,
        batchCount,
      });
      if (streamHeartbeat) {
        clearInterval(streamHeartbeat);
        streamHeartbeat = null;
      }
      const result = normalizeComicResult({
        foundation,
        allShots,
        log: request.log,
        streamState,
        model,
        visualInputs,
        confirmedBriefTitle,
        duration,
        aspectRatio,
      });
      database.run(
        "UPDATE comic_sessions SET phase=?,plan=?,pending_revision=?,generation_status='succeeded',generation_stage='完整剧本已完成',generation_progress=100,generation_error='',generation_checkpoint='{}',generation_issues='[]',updated_at=? WHERE id=? AND user_id=? AND project_id=?",
        [
          "generated",
          JSON.stringify(result),
          "",
          new Date().toISOString(),
          sessionId,
          String(user.id),
          projectId,
        ],
      );
      persist();
      emit({ type: "result", data: result });
      reply.raw.end();
      return;
    } catch (error) {
      if (streamHeartbeat) clearInterval(streamHeartbeat);
      request.log.error(
        {
          message: error instanceof Error ? error.message : String(error),
          elapsedMs: Date.now() - streamState.startedAt,
          receivedBytes: streamState.receivedBytes,
          progress: streamState.progress,
          idleSeconds: Math.floor(
            (Date.now() - streamState.lastContentAt) / 1000,
          ),
        },
        "comic agent failed",
      );
      const issue = comicGenerationIssue(
          error,
          streamState.progress,
          Boolean(checkpoint.story || checkpoint.assets || checkpoint.shotPlan),
        ),
        message = comicGenerationErrorMessage(error, issue);
      database.run(
        "UPDATE comic_sessions SET generation_status='failed',generation_stage='生成失败',generation_error=?,generation_issues=?,updated_at=? WHERE id=?",
        [message, JSON.stringify([issue]), new Date().toISOString(), sessionId],
      );
      persist();
      if (streamStarted) {
        if (!reply.raw.destroyed)
          reply.raw.write(
            `${JSON.stringify({ type: "error", error: message, issues: [issue] })}\n`,
          );
        if (!reply.raw.destroyed) reply.raw.end();
        return;
      }
      return reply
        .code(
          error instanceof DOMException && error.name === "TimeoutError"
            ? 504
            : 502,
        )
        .send({ error: message });
    } finally {
      activeComicPlans.delete(comicLockKey);
    }
  });
}
