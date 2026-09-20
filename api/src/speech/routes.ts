import { type FastifyInstance } from "fastify";
import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { namedAssetUrl } from "../assets/urls.js";
import { requireUser } from "../auth/service.js";
import { defaultProjectId } from "../core/config.js";
import { ownsProject } from "../projects/ownership.js";
import {
  getTtsProvider,
  listTtsProviders,
  resolveEasyVoiceId,
} from "../providers/tts.js";
import { database, persist, uploadDirectory } from "../storage/database.js";
import { ttsPreviewRequests } from "./runtime.js";

export function registerSpeechRoutes(app: FastifyInstance) {
  app.get("/tts/providers", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    return Promise.all(
      listTtsProviders().map((provider) => provider.capabilities()),
    );
  });

  app.get("/tts/providers/:providerId/voices", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { providerId } = request.params as { providerId: string };
    const provider = getTtsProvider(providerId);
    if (!provider) return reply.code(404).send({ error: "语音服务不存在" });
    try {
      return {
        provider: provider.id,
        voices: (await provider.voices()).filter(
          (voice) => voice.language === "zh-CN",
        ),
      };
    } catch (error) {
      return reply.code(503).send({
        error: error instanceof Error ? error.message : "无法读取语音列表",
      });
    }
  });

  app.get("/tts/preview", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const query = request.query as {
      projectId?: string;
      providerId?: string;
      text?: string;
      voiceId?: string;
      speed?: string;
      pitch?: string;
      volume?: string;
    };
    const projectId = String(query.projectId || defaultProjectId);
    if (!ownsProject(projectId, String(user.id)))
      return reply.code(404).send({ error: "Project not found" });
    const text = String(query.text || "")
      .trim()
      .slice(0, 120);
    if (!text) return reply.code(400).send({ error: "试听文本不能为空" });
    const provider = getTtsProvider(
      String(query.providerId || "easyvoice-local"),
    );
    if (!provider) return reply.code(400).send({ error: "当前语音服务不可用" });
    const voiceId = resolveEasyVoiceId(
      String(query.voiceId || "zh-CN-XiaoxiaoNeural"),
    );
    try {
      const supportedVoice = (await provider.voices()).some(
        (voice) => voice.id === voiceId && voice.language === "zh-CN",
      );
      if (!supportedVoice)
        return reply.code(400).send({ error: "该服务不支持所选中文音色" });
      const speed = Math.max(0.5, Math.min(2, Number(query.speed) || 1));
      const pitch = Math.max(-50, Math.min(50, Number(query.pitch) || 0));
      const volume = Math.max(0, Math.min(2, Number(query.volume) || 1));
      const previewInput = {
          text,
          voiceId,
          speed,
          pitch,
          volume,
          format: "mp3" as const,
          language: "zh-CN",
          emotion: "中性",
        },
        previewKey = createHash("sha256")
          .update(JSON.stringify({ provider: provider.id, ...previewInput }))
          .digest("hex");
      let previewRequest = ttsPreviewRequests.get(previewKey);
      if (!previewRequest) {
        previewRequest = provider.synthesize(previewInput);
        ttsPreviewRequests.set(previewKey, previewRequest);
        // Media elements can request the same URL twice while probing metadata.
        // Keep the completed promise briefly so both requests share one TTS job.
        void previewRequest.finally(() =>
          setTimeout(() => ttsPreviewRequests.delete(previewKey), 10_000),
        );
      }
      const result = await previewRequest;
      return reply
        .type(result.mimeType)
        .header("cache-control", "no-store")
        .header("content-disposition", "inline")
        .header("content-length", String(result.bytes.length))
        .send(result.bytes);
    } catch (error) {
      request.log.error(
        { error, provider: provider.id },
        "tts preview stream failed",
      );
      return reply.code(502).send({
        error: error instanceof Error ? error.message : "流式试听失败",
      });
    }
  });

  app.post("/tts/synthesize", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const userId = String(user.id);
    const input = request.body as {
      projectId?: string;
      providerId?: string;
      text?: string;
      voiceId?: string;
      speed?: number;
      pitch?: number;
      volume?: number;
      format?: "wav" | "mp3" | "opus" | "flac" | "aac";
      language?: string;
      emotion?: string;
      preview?: boolean;
    };
    const projectId = String(input.projectId || defaultProjectId);
    if (!ownsProject(projectId, userId))
      return reply.code(404).send({ error: "Project not found" });
    const text = String(input.text || "").trim();
    if (!text) return reply.code(400).send({ error: "请先填写需要生成的文本" });
    if (text.length > 4000)
      return reply.code(400).send({ error: "单个语音文本不能超过 4000 字" });
    const provider = getTtsProvider(
      String(input.providerId || "easyvoice-local"),
    );
    if (!provider) return reply.code(404).send({ error: "语音服务不存在" });
    const language = String(input.language || "zh-CN");
    if (language !== "zh-CN")
      return reply.code(400).send({ error: "当前仅开放中文语音生成" });
    const voiceId = resolveEasyVoiceId(
      String(input.voiceId || "zh-CN-XiaoxiaoNeural"),
    );
    let supportedVoice;
    try {
      supportedVoice = (await provider.voices()).find(
        (voice) => voice.id === voiceId && voice.language === "zh-CN",
      );
    } catch (error) {
      return reply.code(503).send({
        error: error instanceof Error ? error.message : "无法读取中文音色列表",
      });
    }
    if (!supportedVoice)
      return reply.code(400).send({ error: "该服务不支持所选中文音色" });
    const speed = Number(input.speed ?? 1);
    if (!Number.isFinite(speed) || speed < 0.5 || speed > 2)
      return reply.code(400).send({ error: "语速必须在 0.5 到 2.0 之间" });
    const pitch = Number(input.pitch ?? 0);
    if (!Number.isFinite(pitch) || pitch < -50 || pitch > 50)
      return reply.code(400).send({ error: "音调必须在 -50Hz 到 +50Hz 之间" });
    const volume = Number(input.volume ?? 1);
    if (!Number.isFinite(volume) || volume < 0 || volume > 2)
      return reply.code(400).send({ error: "音量必须在 0 到 2.0 之间" });
    const format = input.format || "mp3";
    try {
      const result = await provider.synthesize({
        text,
        voiceId,
        speed,
        pitch,
        volume,
        format,
        language,
        emotion: String(input.emotion || ""),
      });
      if (input.preview)
        return reply
          .type(result.mimeType)
          .header("cache-control", "no-store")
          .send(result.bytes);
      if (result.bytes.length > 100 * 1024 * 1024)
        return reply.code(413).send({ error: "生成音频超过 100MB" });
      const assetId = randomUUID(),
        storageName = `${assetId}.bin`,
        now = new Date().toISOString();
      const extension =
        result.mimeType === "audio/mpeg"
          ? "mp3"
          : format === "aac"
            ? "aac"
            : format;
      const name = `AI 语音-${new Date().toLocaleString("zh-CN").replace(/[/:]/g, "-")}.${extension}`;
      writeFileSync(`${uploadDirectory}/${storageName}`, result.bytes);
      database.run(
        "INSERT INTO assets (id, project_id, user_id, name, mime_type, size, storage_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
          assetId,
          projectId,
          userId,
          name,
          result.mimeType,
          result.bytes.length,
          storageName,
          now,
        ],
      );
      persist();
      return {
        provider: provider.id,
        voiceId,
        duration: result.duration,
        mimeType: result.mimeType,
        assetId,
        assetUrl: namedAssetUrl(assetId, name),
      };
    } catch (error) {
      request.log.error(
        { error, provider: provider.id },
        "tts synthesis failed",
      );
      return reply.code(502).send({
        error: error instanceof Error ? error.message : "语音生成失败",
      });
    }
  });
}
