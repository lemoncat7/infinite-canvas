import { randomUUID } from "node:crypto";
import { validateOwnedInputUrls } from "../assets/generation-inputs.js";
import { defaultProjectId } from "../core/config.js";
import { type JobInput } from "../core/types.js";
import { validateGeneration } from "../models/validation.js";
import { ownsProject } from "../projects/ownership.js";
import { database, getOne, persist } from "../storage/database.js";
import { generationProvider, modelStore } from "./config.js";
import { pumpGenerationQueue } from "./queue.js";

import { ApplicationError } from "../core/errors.js";
import { generationRequest, recordGenerationRequest } from "./idempotency.js";

export function submitGeneration(
  user: Record<string, unknown>,
  input: JobInput,
  requestKey?: unknown,
) {
  const userId = String(user.id);
  if (!input || (input.kind !== "image" && input.kind !== "video"))
    throw new ApplicationError(
      400,
      { error: "生成类型必须是 image 或 video" }.error,
    );
  if (typeof input.prompt !== "string" || !input.prompt.trim())
    throw new ApplicationError(400, { error: "Prompt is required" }.error);
  const projectId = input.projectId ?? defaultProjectId;
  if (!ownsProject(projectId, userId))
    throw new ApplicationError(404, { error: "Project not found" }.error);
  if (!Number.isSafeInteger(input.nodeId) || input.nodeId < 1)
    throw new ApplicationError(400, "nodeId must be a positive safe integer");
  if (
    input.inputUrls !== undefined &&
    (!Array.isArray(input.inputUrls) ||
      input.inputUrls.some((url) => typeof url !== "string"))
  )
    throw new ApplicationError(400, "inputUrls must be a list of URLs");
  const request = generationRequest(userId, input, requestKey);
  if (request?.jobId) {
    const job = getOne(
      "SELECT id, status, progress, model, credit_cost AS creditCost FROM jobs WHERE id=? AND user_id=?",
      [request.jobId, userId],
    );
    if (!job)
      throw new ApplicationError(
        409,
        "Original generation no longer exists; use a new request ID only to intentionally generate again",
      );
    return {
      ...job,
      provider: generationProvider.name,
      creditsAvailable:
        Number(user.credits ?? 0) - Number(user.reservedCredits ?? 0),
      replayed: true,
    };
  }
  let model =
    input.model ??
    (input.kind === "video"
      ? process.env.AGNES_VIDEO_DEFAULT_MODEL || "agnes-video-v2.0"
      : process.env.OPENAI_IMAGE_DEFAULT_MODEL || "gpt-image-2");
  const selectedModel = model.startsWith("custom:")
    ? undefined
    : modelStore.resolve(input.model, input.kind, input.kind);
  if (selectedModel) {
    model = selectedModel.model.model;
    validateGeneration(
      selectedModel.model,
      input.inputUrls?.length || 0,
      input.parameters || {},
    );
    // Unknown provider parameters must not override the resolved model or bypass capability checks.
    const allowedParameters = new Set([
      "size",
      "quality",
      "background",
      "seconds",
      "resolution",
      "aspect_ratio",
      "reference_mode",
      "seed",
      "negative_prompt",
    ]);
    if (
      Object.keys(input.parameters || {}).some(
        (key) => !allowedParameters.has(key),
      )
    )
      throw new ApplicationError(
        400,
        { error: "模型参数包含不支持的字段" }.error,
      );
  }
  if (!selectedModel && model === "gemini-3.1-flash-image")
    throw new ApplicationError(
      503,
      "Gemini 图片模型仍处于实验性适配阶段，暂未开放生成",
    );
  const creditCost = selectedModel
    ? selectedModel.model.creditCost
    : model === "grok-imagine-video-1.5-preview"
      ? 2
      : model === "grok-imagine-image"
        ? 1
        : 0;
  if (
    creditCost &&
    Number(user.credits ?? 0) - Number(user.reservedCredits ?? 0) < creditCost
  )
    throw new ApplicationError(
      402,
      `创作点数不足，当前模型每次生成需要 ${creditCost} 点`,
    );
  const customId =
      !selectedModel && model.startsWith("custom:") ? model.slice(7) : "",
    custom = customId
      ? getOne("SELECT * FROM user_api_models WHERE id = ? AND user_id = ?", [
          customId,
          userId,
        ])
      : undefined;
  if (customId && (!custom || String(custom.kind) !== input.kind))
    throw new ApplicationError(
      400,
      { error: "自定义模型不存在或类型不匹配" }.error,
    );
  if (custom) model = String(custom.model);
  const inputUrls = input.inputUrls ?? [];
  if (
    input.kind === "video" &&
    (selectedModel
      ? selectedModel.model.adapter === "agnes-video"
      : model.startsWith("agnes-"))
  ) {
    const referenceMode =
      input.parameters?.reference_mode === "keyframes"
        ? "keyframes"
        : "references";
    if (referenceMode === "keyframes" && inputUrls.length < 2)
      throw new ApplicationError(
        400,
        { error: "Agnes 关键帧动画至少需要 2 张按顺序连接的图片" }.error,
      );
    if (referenceMode !== "keyframes" && inputUrls.length > 1)
      throw new ApplicationError(
        400,
        { error: "Agnes 官方接口不支持多图自由参考，请改用关键帧动画" }.error,
      );
    const ratio = String(input.parameters?.aspect_ratio || "16:9");
    if (!["1:1", "4:3", "3:4", "16:9", "9:16"].includes(ratio))
      throw new ApplicationError(
        400,
        { error: "Agnes 不支持当前视频画幅" }.error,
      );
  }
  try {
    validateOwnedInputUrls(inputUrls, userId, input.kind);
  } catch (error) {
    throw new ApplicationError(
      400,
      error instanceof Error ? error.message : "无法读取输入素材",
    );
  }
  const finalPrompt = input.prompt.trim(),
    promptLimit = input.kind === "video" ? 4000 : 1024;
  if (finalPrompt.length > promptLimit)
    throw new ApplicationError(
      400,
      `最终提示词长度 ${finalPrompt.length} 超过当前类型上限 ${promptLimit}，请精简当前描述`,
    );
  const id = randomUUID(),
    now = new Date().toISOString();
  database.run("BEGIN");
  try {
    if (creditCost)
      database.run(
        "UPDATE users SET reserved_credits = reserved_credits + ? WHERE id = ?",
        [creditCost, userId],
      );
    database.run(
      "INSERT INTO jobs (id, project_id, user_id, node_id, kind, prompt, model, status, progress, input_urls, parameters, custom_model_id, credit_cost, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        projectId,
        userId,
        input.nodeId,
        input.kind,
        finalPrompt,
        model,
        "queued",
        0,
        JSON.stringify(inputUrls),
        JSON.stringify(input.parameters ?? {}),
        customId || null,
        creditCost,
        now,
        now,
      ],
    );
    if (selectedModel)
      database.run("UPDATE jobs SET model_snapshot=? WHERE id=?", [
        modelStore.secrets.seal(selectedModel),
        id,
      ]);
    recordGenerationRequest(userId, request, id);
    database.run("COMMIT");
  } catch (error) {
    database.run("ROLLBACK");
    throw error;
  }
  persist();
  queueMicrotask(pumpGenerationQueue);
  return {
    id,
    status: "queued",
    progress: 0,
    model,
    provider: generationProvider.name,
    creditCost,
    creditsAvailable:
      Number(user.credits ?? 0) -
      Number(user.reservedCredits ?? 0) -
      creditCost,
  };
}
