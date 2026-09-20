import { type FastifyInstance } from "fastify";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import {
  resolveOwnedInputUrls,
  validateOwnedInputUrls,
} from "../assets/generation-inputs.js";
import { requireUser } from "../auth/service.js";
import { modelStore } from "../generation/config.js";
import { safeModelError } from "../models/errors.js";
import { apiRoot } from "../models/network.js";
import {
  compactImagePrompt,
  normalizeAgnesPrompt,
  parsePromptAgentResult,
  validateAgnesPrompt,
} from "./prompt-format.js";

export function registerAgentsPromptRoutes(app: FastifyInstance) {
  app.post("/agents/prompt", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const input = request.body as {
        idea?: string;
        kind?: string;
        promptMode?: string;
        complexity?: string;
        context?: string[];
        visuals?: string[];
        model?: string;
        target?: {
          id?: number;
          kind?: string;
          role?: string;
          hasMedia?: boolean;
          hasPrompt?: boolean;
        } | null;
      },
      idea = String(input.idea ?? "").trim(),
      kind = input.kind === "video" ? "video" : "image",
      promptMode = ["general", "agnes", "voice"].includes(
        String(input.promptMode),
      )
        ? String(input.promptMode)
        : "create",
      complexity = input.complexity === "detailed" ? "detailed" : "simple",
      context = (input.context ?? [])
        .map((item) => String(item).trim())
        .filter(Boolean)
        .slice(0, 8);
    if (!idea || idea.length > 4000)
      return reply.code(400).send({ error: "请输入 1–4000 字的创作想法" });
    const textConfiguration = modelStore.resolve(input.model, "text", "prompt");
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
      return reply.code(503).send({ error: "提示词 Agent 接口尚未配置" });
    const detailRule =
      complexity === "simple"
        ? `finalPrompt 控制在${kind === "video" ? "180" : "120"}个中文字符以内，只保留主体、场景、关键动作或构图与一种主要风格，避免堆砌。`
        : `详细模式通过拆分更多必要步骤、分镜和依赖关系表达复杂度，不要增加单个图片步骤的提示词长度；另可返回 subject、scene、composition、lighting、style、motion、negativePrompt 字符串字段。`;
    const creativeSystem = `你是 Viora 无限画布中的创作 Agent。理解用户需求、当前节点和上游视觉素材，规划可实际执行的完整工作流并生成底层提示词。只返回合法完整 JSON，不要 Markdown或解释。必须包含 finalPrompt、action、targetType、summary、shouldGenerate、steps。steps 是按执行顺序排列的数组，每项必须为 {"title":"简短名称","kind":"image或video","prompt":"该节点独立使用的完整提示词","referenceIndexes":[1],"dependsOn":[1]}。所有 kind=image 的步骤默认使用 gpt-image-2，每条 prompt 必须控制在 140 个中文字符以内，只保留主体/参考素材对应关系、关键修改、场景构图和一种主要风格；禁止堆砌形容词、镜头参数、材质清单和重复约束。图片需求复杂时拆为多个具有明确职责的 image 步骤，不得写成一条超长提示词。referenceIndexes 使用用户附带视觉参考的 1 开始编号；dependsOn 使用 steps 的 1 开始编号，只能引用当前步骤之前的步骤。复杂视频必须采用分层生产链：先按需要生成可复用的人物、产品和环境设定图；再为每个镜头创建独立的最终分镜 image 步骤，通过 dependsOn 组合该镜头所需的设定素材；最后每个 video 步骤只依赖自己对应的最终分镜图，不要再次直接依赖已经被该分镜使用的人物或场景祖先素材。每个含人物或产品的 video 提示词都要明确要求严格保持输入分镜中的身份、脸型、发型、服装、产品外形和配色，禁止换脸、改变年龄性别、重设计服装或产品；只描述必要动作、环境运动和镜头运动。若最终视频需要先创造场景、人物或分镜参考图，必须先规划 image 步骤，再让 video 步骤通过 dependsOn 引用对应图片步骤。不同镜头需要不同场景时分别生成并正确复用；需要保持角色、产品或美术一致性时复用统一设定图。最终交付物必须出现在 steps 中：用户要视频时不能只返回准备图片，必须包含至少一个 video 步骤；用户明确不要视频时禁止添加 video。若用户已有合适图片，应优先直接引用素材，不重复生成。需要多个方案、场景或分镜时拆成多个步骤，每个视频镜头独立一个 video 步骤，最多 16 步。用户明确指定数量时必须准确提供相应数量的最终交付步骤；若还需要角色设定等中间步骤，应在 16 步内一并规划。禁止循环依赖，video 步骤通常作为末端。需求非常模糊且未指定媒体类型时，采用最小可行方案，只创建一个 image 步骤，不擅自扩展视频。action 只能是 update_current、create_child、create_new；targetType 只能是 image、video；summary 用一句简短中文说明完整执行链。没有当前节点时 create_new；有素材并继续创作时 create_child。用户点击开始创作即视为授权执行，shouldGenerate 默认 true，除非用户明确只要求规划或提示词。${detailRule} 当前节点信息：${JSON.stringify(input.target ?? null)}。不要声称媒体已经生成。`;
    const generalPromptSystem = `你是专业 AI 视觉提示词工程师。根据用户的中文画面需求、当前节点上下文和视觉参考，只生成一条可直接使用的${kind === "video" ? "视频" : "图片"}提示词，不创建工作流，不规划节点，不扩写用户未提供的剧情。保持已有角色、服装、道具、场景和风格一致。只返回合法 JSON：{"finalPrompt":"最终提示词","summary":"通用提示词已生成"}。finalPrompt 使用清晰自然的中文，控制在 ${kind === "video" ? 280 : 180} 字以内。`;
    const agnesPromptSystem = `你是专业动画导演和 Agnes Video v2.0 Prompt 工程师。把用户提供的中文剧情分镜转换成连续动漫视频的英文 Prompt，像动画分镜脚本而不是小说。不得扩写剧情、创造角色、改变设定、增加对白或把多个复杂事件塞入同一镜头。只返回合法 JSON：{"finalPrompt":"完整 Agnes Prompt","summary":"Agnes Video v2.0 提示词已生成"}，不要返回 steps 或解释。finalPrompt 必须严格按以下带英文冒号的标题顺序输出：Style:, Language:, Continuity:, Scene:, Camera:, Action:, Effects:, Audio:, Dialogue:, Voice:, Background:, Constraints:。每个一级标题必须独占一行、只出现一次，正文从下一行开始；多个动作放在同一个 Action: 区块中，每个动作单独一行，绝不能重复输出 Action: 标题。Style 固定为 Anime, cinematic.；Language 固定为 Chinese.。Continuity 说明 Continue seamlessly from the previous shot，并锁定人物身份、服装、发型、建筑、场景与光照，禁止重新设计；同一场景增加 Environment Lock: Keep the same background environment and spatial layout. Do not move, rebuild, or redesign architecture. Scene 只描述当前画面的环境与主体。Camera 只能使用 Wide shot, Medium shot, Medium close-up, Close-up, Slow dolly in, Slow dolly out, Slow pan, Tracking shot, Aerial shot, Reframe toward character 等明确电影语言，禁止抽象镜头描述。输入中的“顺视线切到”必须翻译成 Slow pan 或 Reframe toward character，绝不能在 Camera 或 Action 中出现 follows the line of sight、camera sees、feels closer 等抽象措辞。Action 一句话一个可见动作，不写心理，不增加输入中没有的动作。Effects 只写可见光效、能量、UI、天气或粒子。Audio 中旁白必须写 Narration: "中文旁白"，系统声音必须写 System Announcement: "中文系统声音"，不得放入 Dialogue。Dialogue 只放真实人物台词，格式 Character Name: "中文台词"；已有角色必须始终使用角色名，禁止用 boy、teenager、young man 等模糊称呼替代。一个镜头最多一个主要说话角色。人物讲话时加入 Only the speaking character moves their lips. Everyone else keeps their mouths closed.；无人镜头不得生成 lip sync。Voice 写年龄、性别、音色、情绪、语速和说话方式。Background 写环境声音。Constraints 每次原样包含：No subtitles. No captions. No dialogue text. No narration text. No automatic transcription. No speech bubbles. No text overlays. No logos. No watermarks. Only animate the specified actions. Do not redesign characters. Do not change clothing. Do not change hairstyle. Do not change environment. No extra movement. No idle animation. No unnecessary camera movement. 最终 Prompt 除中文台词、中文旁白和中文系统播报外，其余全部使用英文。`;
    const voicePromptSystem = `你是中文角色选角与声音设计助手。根据用户描述，从固定 EasyVoice 中文音色中选择最匹配的一项，并同时设计音量、音调和语速，尽可能还原用户要求。只返回合法 JSON，不要解释：{"finalPrompt":"一句简洁的中文声音说明，明确所选音色及参数为何符合需求","summary":"已为角色生成音色配置","voiceConfig":{"roleName":"角色名，未提供则写新角色","voiceId":"必须从允许值中选择","tone":"不超过20字的声音气质","speed":1.0,"pitch":0,"volume":1.0}}。允许的 voiceId：zh-CN-XiaoxiaoNeural（温暖女声）、zh-CN-XiaoyiNeural（活泼女声）、zh-CN-YunjianNeural（激昂男声）、zh-CN-YunxiNeural（阳光男声）、zh-CN-YunxiaNeural（少年男声）、zh-CN-YunyangNeural（稳重男声）、zh-CN-liaoning-XiaobeiNeural（辽宁女声）、zh-CN-shaanxi-XiaoniNeural（陕西女声）。必须综合判断年龄、性别、地域口音、音色明暗、厚薄、情绪强度和说话节奏，而非只匹配单个关键词。低沉、成熟、威严通常降低 pitch；清亮、稚嫩可提高 pitch；舒缓、沉稳降低 speed；急促、活泼提高 speed；轻声降低 volume；洪亮、有力提高 volume。speed 范围 0.5–2，通常保持 0.85–1.15；pitch 范围 -50–50，通常保持 -8–8；volume 范围 0–2，通常保持 0.8–1.2。用户明确给出参数时优先采用并限制在合法范围；要求超出可用音色能力时选择整体最接近的一项，不得虚构 voiceId 或角色背景。`;
    const system =
      promptMode === "agnes"
        ? agnesPromptSystem
        : promptMode === "general"
          ? generalPromptSystem
          : promptMode === "voice"
            ? voicePromptSystem
            : creativeSystem;
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
      return reply.code(400).send({ error: "Agent 无法读取所选参考图片" });
    }
    const textContent = [
      `用户想法：${idea}`,
      context.length
        ? `画布上下文：\n${context.map((item, index) => `${index + 1}. ${item}`).join("\n")}`
        : "画布上下文：无",
      visualInputs.length
        ? `附带 ${visualInputs.length} 张视觉参考，顺序与参考节点中的图片顺序一致。请理解图片内容后再生成提示词。`
        : "没有视觉参考。",
    ].join("\n\n");
    const content: unknown = visualInputs.length
      ? [
          { type: "text", text: textContent },
          ...visualInputs.map((url) => ({
            type: "image_url",
            image_url: { url },
          })),
        ]
      : textContent;
    const clientAbort = new AbortController();
    request.raw.once("aborted", () => clientAbort.abort());
    reply.raw.once("close", () => {
      if (!reply.raw.writableEnded) clientAbort.abort();
    });
    try {
      const url = `${baseUrl}/v1/chat/completions`;
      const proxyUrl = textConfiguration
        ? textConfiguration.connection.proxyUrl
        : String(
            process.env.PROMPT_AGENT_HTTPS_PROXY ||
              process.env.OPENAI_IMAGE_HTTPS_PROXY ||
              "",
          );
      let result: Record<string, unknown> | undefined,
        raw = "",
        finishReason = "";
      for (let attempt = 1; attempt <= 2; attempt++) {
        const options = {
          redirect: "error" as const,
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model,
            stream: false,
            temperature: complexity === "simple" ? 0.35 : 0.65,
            max_tokens: complexity === "simple" ? 4800 : 7000,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: system },
              { role: "user", content },
            ],
          }),
          signal: AbortSignal.any([
            clientAbort.signal,
            AbortSignal.timeout(
              Number(process.env.PROMPT_AGENT_TIMEOUT_MS || 90000),
            ),
          ]),
        };
        const response = proxyUrl
          ? await undiciFetch(url, {
              ...options,
              dispatcher: new ProxyAgent(proxyUrl),
            })
          : await fetch(url, options);
        const payload = (await response.json()) as {
          choices?: Array<{
            finish_reason?: string;
            message?: { content?: string };
          }>;
          error?: { message?: string };
        };
        if (!response.ok) {
          if (
            attempt < 2 &&
            (response.status === 429 || response.status >= 500)
          ) {
            request.log.warn(
              { attempt, status: response.status },
              "prompt agent upstream retry",
            );
            continue;
          }
          return reply.code(response.status).send({
            error: `Agent 接口返回 HTTP ${response.status}，请检查模型配置或稍后重试`,
          });
        }
        raw = String(payload.choices?.[0]?.message?.content || "")
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/, "")
          .trim();
        finishReason = String(payload.choices?.[0]?.finish_reason || "");
        try {
          const parsed = parsePromptAgentResult(raw);
          if (!String(parsed.finalPrompt ?? "").trim())
            throw new SyntaxError("Agent missing finalPrompt");
          if (promptMode === "agnes") {
            const normalized = normalizeAgnesPrompt(String(parsed.finalPrompt));
            const validationError = validateAgnesPrompt(normalized);
            if (validationError) throw new SyntaxError(validationError);
            parsed.finalPrompt = normalized;
          }
          result = parsed;
          break;
        } catch (error) {
          if (attempt >= 2) throw error;
          request.log.warn(
            { attempt, finishReason, responseLength: raw.length },
            "prompt agent malformed response retry",
          );
        }
      }
      if (!result) throw new SyntaxError("Agent returned no valid plan");
      request.log.info(
        { model, complexity, finishReason, responseLength: raw.length },
        "prompt agent response received",
      );
      const field = (name: string) => String(result[name] ?? "").trim();
      const rawFinalPrompt = field("finalPrompt");
      if (!rawFinalPrompt) throw new Error("Agent 未返回 finalPrompt");
      if (promptMode !== "create") {
        const voiceConfig =
          promptMode === "voice" &&
          result.voiceConfig &&
          typeof result.voiceConfig === "object"
            ? (result.voiceConfig as Record<string, unknown>)
            : undefined;
        const allowedVoiceIds = new Set([
          "zh-CN-XiaoxiaoNeural",
          "zh-CN-XiaoyiNeural",
          "zh-CN-YunjianNeural",
          "zh-CN-YunxiNeural",
          "zh-CN-YunxiaNeural",
          "zh-CN-YunyangNeural",
          "zh-CN-liaoning-XiaobeiNeural",
          "zh-CN-shaanxi-XiaoniNeural",
        ]);
        return {
          model,
          kind,
          action: "create_new",
          targetType: kind,
          summary:
            field("summary") ||
            (promptMode === "agnes"
              ? "Agnes Video v2.0 提示词已生成"
              : "通用提示词已生成"),
          shouldGenerate: false,
          steps: [],
          finalPrompt: rawFinalPrompt,
          promptMode,
          ...(voiceConfig
            ? {
                voiceConfig: {
                  roleName: String(voiceConfig.roleName || "新角色").slice(
                    0,
                    40,
                  ),
                  voiceId: allowedVoiceIds.has(String(voiceConfig.voiceId))
                    ? String(voiceConfig.voiceId)
                    : "zh-CN-XiaoxiaoNeural",
                  tone: String(voiceConfig.tone || "自然").slice(0, 40),
                  speed: Math.max(
                    0.5,
                    Math.min(2, Number(voiceConfig.speed) || 1),
                  ),
                  pitch: Math.max(
                    -50,
                    Math.min(50, Number(voiceConfig.pitch) || 0),
                  ),
                  volume: Math.max(
                    0,
                    Math.min(2, Number(voiceConfig.volume) || 1),
                  ),
                },
              }
            : {}),
        };
      }
      const action = ["update_current", "create_child", "create_new"].includes(
          field("action"),
        )
          ? field("action")
          : "create_child",
        targetType =
          field("targetType") === "video"
            ? "video"
            : field("targetType") === "image"
              ? "image"
              : kind;
      const finalPrompt =
        targetType === "image"
          ? compactImagePrompt(rawFinalPrompt)
          : rawFinalPrompt;
      const rawSteps = Array.isArray(result.steps) ? result.steps : [];
      let steps = rawSteps
        .slice(0, 16)
        .map((item, index) => {
          const step =
            item && typeof item === "object"
              ? (item as Record<string, unknown>)
              : {};
          const stepKind = step.kind === "video" ? "video" : "image";
          const rawPrompt = String(step.prompt || "").trim();
          return {
            title: String(step.title || "").trim(),
            kind: stepKind,
            prompt:
              stepKind === "image" ? compactImagePrompt(rawPrompt) : rawPrompt,
            referenceIndexes: Array.isArray(step.referenceIndexes)
              ? [
                  ...new Set(
                    step.referenceIndexes
                      .map(Number)
                      .filter(
                        (value) =>
                          Number.isInteger(value) &&
                          value >= 1 &&
                          value <= visualInputs.length,
                      ),
                  ),
                ]
              : [],
            dependsOn: Array.isArray(step.dependsOn)
              ? [
                  ...new Set(
                    step.dependsOn
                      .map(Number)
                      .filter(
                        (value) =>
                          Number.isInteger(value) &&
                          value >= 1 &&
                          value <= index,
                      ),
                  ),
                ]
              : [],
          };
        })
        .filter((step) => step.prompt);
      const explicitlyNoVideo =
        /(?:不要|无需|不需要|禁止)(?:生成|制作)?视频|只(?:要|生成).{0,8}(?:图片|海报|封面)/.test(
          idea,
        );
      let forcedFinalVideo = false;
      if (
        kind === "video" &&
        !explicitlyNoVideo &&
        !steps.some((step) => step.kind === "video")
      ) {
        forcedFinalVideo = true;
        steps = steps.slice(0, 15);
        const imageDependencies = steps
          .map((step, index) => (step.kind === "image" ? index + 1 : 0))
          .filter(Boolean);
        steps.push({
          title: "最终视频",
          kind: "video",
          prompt: `根据前置关键视觉素材制作完整视频：${idea}`.slice(0, 500),
          referenceIndexes: visualInputs.map((_, index) => index + 1),
          dependsOn: imageDependencies,
        });
      }
      const isAncestor = (
        candidate: number,
        stepNumber: number,
        seen = new Set<number>(),
      ): boolean => {
        if (seen.has(stepNumber)) return false;
        seen.add(stepNumber);
        const parent = steps[stepNumber - 1];
        return Boolean(
          parent?.dependsOn.some(
            (dependency) =>
              dependency === candidate ||
              isAncestor(candidate, dependency, seen),
          ),
        );
      };
      steps = steps.map((step) =>
        step.kind !== "video"
          ? step
          : {
              ...step,
              dependsOn: step.dependsOn.filter(
                (candidate) =>
                  !step.dependsOn.some(
                    (other) =>
                      other !== candidate && isAncestor(candidate, other),
                  ),
              ),
            },
      );
      return {
        model,
        kind: targetType,
        action,
        targetType,
        summary: forcedFinalVideo
          ? "先生成所需关键视觉图，再基于这些素材制作最终视频。"
          : field("summary") ||
            `已准备${targetType === "video" ? "视频" : "图像"}创作节点`,
        shouldGenerate: result.shouldGenerate !== false,
        steps: steps.length
          ? steps
          : [
              {
                title: "创作任务",
                kind: targetType,
                prompt: finalPrompt,
                referenceIndexes: visualInputs.map((_, index) => index + 1),
                dependsOn: [],
              },
            ],
        subject: field("subject"),
        scene: field("scene"),
        composition: field("composition"),
        lighting: field("lighting"),
        style: field("style"),
        motion: field("motion"),
        negativePrompt: field("negativePrompt"),
        finalPrompt,
      };
    } catch (error) {
      if (clientAbort.signal.aborted) return;
      if (textConfiguration && !(error instanceof SyntaxError))
        error = safeModelError(error);
      request.log.error(
        { message: error instanceof Error ? error.message : String(error) },
        "prompt agent failed",
      );
      return reply.code(502).send({
        error:
          error instanceof SyntaxError
            ? "Agent 返回内容不完整，请重新生成一次"
            : error instanceof Error
              ? error.message
              : "提示词生成失败",
      });
    }
  });
}
