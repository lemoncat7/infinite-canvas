import { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { requireUser } from "../auth/service.js";
import { modelStore } from "../generation/config.js";
import { safeModelError } from "../models/errors.js";
import { apiRoot } from "../models/network.js";
import { ownsProject } from "../projects/ownership.js";
import { database, getOne, persist } from "../storage/database.js";
import { parseFirstJsonObject } from "./json.js";
import { activeComicChats, activeComicPlans } from "./runtime.js";

export function registerComicChatRoutes(app: FastifyInstance) {
  app.post("/agents/comic/chat", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const input = request.body as {
        projectId?: string;
        sessionId?: string;
        message?: string;
        context?: string[];
        plan?: unknown;
        model?: string;
      },
      userId = String(user.id),
      projectId = String(input.projectId || ""),
      requestedSessionId = String(input.sessionId || ""),
      message = String(input.message || "").trim();
    if (!projectId || !ownsProject(projectId, userId))
      return reply.code(404).send({ error: "当前项目不存在" });
    if (activeComicPlans.has(`${userId}:${projectId}`))
      return reply
        .code(409)
        .send({ error: "完整剧本正在生成，请完成后再继续对话" });
    const chatLockKey = `${userId}:${projectId}`;
    if (activeComicChats.has(chatLockKey))
      return reply
        .code(409)
        .send({ error: "另一台设备正在处理本项目的漫剧对话，请稍候" });
    if (message.length < 1 || message.length > 12000)
      return reply.code(400).send({ error: "每次对话需要 1–12000 个字符" });
    let session = requestedSessionId
      ? getOne(
          "SELECT id,phase,brief,messages,pending_revision AS pendingRevision,plan FROM comic_sessions WHERE id=? AND user_id=? AND project_id=?",
          [requestedSessionId, userId, projectId],
        )
      : undefined;
    if (requestedSessionId && !session)
      return reply.code(404).send({ error: "漫剧会话不存在或不属于当前项目" });
    const now = new Date().toISOString(),
      sessionId = session ? String(session.id) : randomUUID();
    if (!session) {
      const initialPlan =
        input.plan && typeof input.plan === "object"
          ? JSON.stringify(input.plan)
          : null;
      database.run(
        "INSERT INTO comic_sessions (id,user_id,project_id,phase,brief,messages,pending_revision,plan,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        [
          sessionId,
          userId,
          projectId,
          initialPlan ? "generated" : "discussing",
          "{}",
          "[]",
          "",
          initialPlan,
          now,
          now,
        ],
      );
      session = {
        id: sessionId,
        phase: initialPlan ? "generated" : "discussing",
        brief: "{}",
        messages: "[]",
        pendingRevision: "",
        plan: initialPlan,
      };
    }
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
    activeComicChats.add(chatLockKey);
    let history: Array<{ role: "user" | "assistant"; content: string }> = [];
    try {
      const parsed = JSON.parse(String(session.messages || "[]"));
      if (Array.isArray(parsed))
        history = parsed
          .filter(
            (item) =>
              item &&
              ["user", "assistant"].includes(item.role) &&
              typeof item.content === "string",
          )
          .slice(-16);
      // The brief is the durable source of truth. Keep recent conversational
      // wording for tone and local context, but cap its total size so several
      // pasted scripts cannot make every later turn progressively slower.
      while (
        history.length > 2 &&
        history.reduce((total, item) => total + item.content.length, 0) > 24000
      )
        history.shift();
    } catch {
      /* 从空历史继续 */
    }
    let brief: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(String(session.brief || "{}"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        brief = parsed;
    } catch {
      /* 由本轮重新整理 */
    }
    const hasPlan = Boolean(session.plan),
      context = (input.context ?? []).map(String).filter(Boolean).slice(0, 8),
      system = `你是 Viora 的漫剧创作导演，现在只与用户讨论、澄清和收敛需求，绝对不要生成完整剧本、人物设定、镜头表或分镜提示词。每轮自然回应，并且最多追问 1–2 个真正影响创作的问题；用户信息已经足够时，不必为了提问而提问。持续维护创作简报。${hasPlan ? "已有正式方案，本轮只整理用户希望修改的内容，未确认前不得改写正式方案。" : "尚未生成正式方案，帮助用户明确故事方向。"}只返回合法 JSON：{"reply":"给用户的简洁自然回复","ready":true,"brief":{"title":"不超过18字的作品暂定标题","premise":"核心创意与故事简介","genre":"类型与基调","audience":"受众","duration":"预计总时长，例如约60秒或约3分钟","aspectRatio":"画幅，默认16:9","visualStyle":"视觉风格","characters":"核心人物与关系","conflict":"核心冲突","ending":"结局方向","dialogue":"对白旁白偏好","constraints":["明确不要的作品内容"],"confirmed":["已确认要点"],"openQuestions":["最多两个待确认问题"]},"pendingRevision":"已有正式方案时，累计整理待应用的修改；没有正式方案时为空字符串"}。title 必须是简短作品名，premise 才是完整简介，禁止把整段简介放进 title。用户没有明确指定画幅时，aspectRatio 始终填写 16:9。故事梗概、人物和冲突已经足够判断制作规模后，必须按合理的镜头密度主动估算 duration；duration 仍为空时不得返回 ready=true。ready 表示信息已经足以让用户点击确认生成，不代表你可以自行生成。必须继承旧简报中未被本轮推翻的内容。“先讨论、暂不生成、确认后再生成”等只描述当前交互阶段，绝不能写进作品 constraints。`;
    const userContent = [
      `当前简报：${JSON.stringify(brief)}`,
      hasPlan
        ? `已有正式方案摘要：${String(session.plan).slice(0, 6000)}`
        : "尚无正式方案",
      String(session.pendingRevision || "").trim()
        ? `尚未应用的修改：${String(session.pendingRevision)}`
        : "",
      context.length ? `当前参考素材：${context.join("\n")}` : "",
      `用户本轮消息：${message}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    const streamedReply = (raw: string) => {
      const marker = /"reply"\s*:\s*"/.exec(raw);
      if (!marker) return "";
      let output = "";
      for (
        let index = marker.index + marker[0].length;
        index < raw.length;
        index++
      ) {
        const char = raw[index];
        if (char === '"') break;
        if (char !== "\\") {
          output += char;
          continue;
        }
        const escaped = raw[++index];
        if (escaped === undefined) break;
        if (escaped === "u") {
          const code = raw.slice(index + 1, index + 5);
          if (!/^[0-9a-f]{4}$/i.test(code)) break;
          output += String.fromCharCode(Number.parseInt(code, 16));
          index += 4;
        } else
          output +=
            (
              {
                n: "\n",
                r: "\r",
                t: "\t",
                b: "\b",
                f: "\f",
                '"': '"',
                "\\": "\\",
                "/": "/",
              } as Record<string, string>
            )[escaped] ?? escaped;
      }
      return output.slice(0, 1200);
    };
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    });
    const emit = (value: unknown) => {
      if (!reply.raw.destroyed) reply.raw.write(`${JSON.stringify(value)}\n`);
    };
    emit({
      type: "start",
      sessionId,
      phase: hasPlan ? "revising" : "discussing",
    });
    const heartbeat = setInterval(
      () => emit({ type: "heartbeat", at: Date.now() }),
      8000,
    );
    try {
      const proxyUrl = textConfiguration
          ? textConfiguration.connection.proxyUrl
          : String(
              process.env.PROMPT_AGENT_HTTPS_PROXY ||
                process.env.OPENAI_IMAGE_HTTPS_PROXY ||
                "",
            ),
        candidateModels = [
          model,
          ...(textConfiguration || model === "gpt-5.4-mini"
            ? []
            : ["gpt-5.4-mini"]),
        ];
      let parsed:
          | {
              reply?: string;
              ready?: boolean;
              brief?: Record<string, unknown>;
              pendingRevision?: string;
            }
          | undefined,
        lastError = "";
      for (const [attempt, usedModel] of candidateModels.entries()) {
        if (attempt)
          emit({ type: "retry", message: "主模型响应较慢，正在切换备用线路…" });
        emit({ type: "model", model: usedModel });
        const controller = new AbortController(),
          timeoutMs = attempt ? 45000 : 65000,
          timer = setTimeout(
            () =>
              controller.abort(
                new DOMException("漫剧对话响应超时", "TimeoutError"),
              ),
            timeoutMs,
          ),
          options = {
            method: "POST",
            headers: {
              authorization: `Bearer ${apiKey}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: usedModel,
              stream: true,
              stream_options: { include_usage: false },
              temperature: 0.35,
              max_tokens: 1800,
              response_format: { type: "json_object" },
              messages: [
                { role: "system", content: system },
                ...history,
                { role: "user", content: userContent },
              ],
            }),
            signal: controller.signal,
          };
        try {
          const response = proxyUrl
            ? await undiciFetch(`${baseUrl}/v1/chat/completions`, {
                ...options,
                redirect: "error",
                dispatcher: new ProxyAgent(proxyUrl),
              })
            : await fetch(`${baseUrl}/v1/chat/completions`, {
                ...options,
                redirect: "error",
              });
          if (!response.ok) {
            await response.body?.cancel();
            throw new Error(`upstream HTTP ${response.status}`);
          }
          if (!response.body) throw new Error("漫剧对话没有响应流");
          const reader = (
              response.body as ReadableStream<Uint8Array>
            ).getReader(),
            decoder = new TextDecoder();
          let buffer = "",
            raw = "",
            lastReply = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() || "";
            for (const line of lines) {
              const data = line.startsWith("data:") ? line.slice(5).trim() : "";
              if (!data || data === "[DONE]") continue;
              const packet = JSON.parse(data) as {
                  choices?: Array<{ delta?: { content?: string } }>;
                },
                delta = String(packet.choices?.[0]?.delta?.content || "");
              if (!delta) continue;
              raw += delta;
              const nextReply = streamedReply(raw);
              if (nextReply !== lastReply) {
                lastReply = nextReply;
                emit({ type: "delta", text: nextReply });
              }
            }
          }
          const extracted = parseFirstJsonObject(raw, "漫剧对话");
          if (extracted.trailingLength)
            request.log.warn(
              {
                projectId,
                sessionId,
                trailingLength: extracted.trailingLength,
              },
              "comic dialogue ignored trailing model output",
            );
          parsed = extracted.value as typeof parsed;
          break;
        } catch (error) {
          lastError = textConfiguration
            ? safeModelError(error).message
            : error instanceof Error
              ? error.message
              : String(error);
          request.log.warn(
            {
              userId,
              projectId,
              sessionId,
              attempt: attempt + 1,
              model: usedModel,
              message: lastError,
            },
            "comic dialogue upstream retry",
          );
          emit({ type: "reset" });
        } finally {
          clearTimeout(timer);
        }
      }
      if (!parsed) throw new Error(lastError || "漫剧对话未返回有效内容");
      const assistantReply = String(
          parsed.reply ||
            "我已经记下了。你可以继续补充，确认后我再生成完整方案。",
        ).slice(0, 1200),
        nextBrief =
          parsed.brief && typeof parsed.brief === "object"
            ? parsed.brief
            : brief,
        pendingRevision = hasPlan
          ? String(
              parsed.pendingRevision || session.pendingRevision || "",
            ).slice(0, 5000)
          : "";
      if (!String(nextBrief.aspectRatio || "").trim())
        nextBrief.aspectRatio = "16:9";
      const ready = Boolean(
        parsed.ready && String(nextBrief.duration || "").trim(),
      );
      history.push(
        { role: "user", content: message },
        { role: "assistant", content: assistantReply },
      );
      history = history.slice(-18);
      while (
        history.length > 2 &&
        history.reduce((total, item) => total + item.content.length, 0) > 24000
      )
        history.shift();
      const phase = hasPlan ? "revising" : ready ? "ready" : "discussing";
      database.run(
        "UPDATE comic_sessions SET phase=?,brief=?,messages=?,pending_revision=?,updated_at=? WHERE id=? AND user_id=? AND project_id=?",
        [
          phase,
          JSON.stringify(nextBrief),
          JSON.stringify(history),
          pendingRevision,
          new Date().toISOString(),
          sessionId,
          userId,
          projectId,
        ],
      );
      persist();
      emit({
        type: "result",
        sessionId,
        phase,
        reply: assistantReply,
        ready,
        brief: nextBrief,
        pendingRevision,
        hasPlan,
      });
      clearInterval(heartbeat);
      activeComicChats.delete(chatLockKey);
      reply.raw.end();
    } catch (error) {
      clearInterval(heartbeat);
      activeComicChats.delete(chatLockKey);
      request.log.error(
        {
          userId,
          projectId,
          sessionId,
          message: error instanceof Error ? error.message : String(error),
        },
        "comic dialogue failed",
      );
      emit({ type: "error", error: "漫剧对话暂时没有响应，请稍后重试" });
      reply.raw.end();
    }
  });
}
