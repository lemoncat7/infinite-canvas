import type {
  ComicPlan,
  ComicShot,
  PromptAgentResult,
  PromptAgentStep,
} from "./comic-types";
import { stripCharactersFromScenePrompt } from "./comic-format";
import { inferVoiceConfig } from "./voice-node";
import {
  clipVideoPrompt,
  fitVideoDialogue,
  inferAnonymousCrowd,
  speechSegments,
} from "./video-node";

function compactPromptPart(value: string, limit: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  const pieces = normalized.match(/[^。！？；.!?;]+[。！？；.!?;]?/g) ?? [normalized];
  let result = "";
  for (const piece of pieces) {
    const next = `${result}${piece.trim()}`;
    if (next.length > limit) break;
    result = next;
  }
  return (result || normalized.slice(0, limit)).replace(/[，、：:\s]+$/, "");
}

export interface ComicWorkflowBuild {
  result: PromptAgentResult;
  storyboardCount: number;
  compositeCount: number;
  sceneCount: number;
}

export function buildComicWorkflow(plan: ComicPlan): ComicWorkflowBuild {
  const steps: PromptAgentStep[] = [],
    characterSteps: number[] = [],
    characterVoiceSteps: number[] = [],
    characterFormSteps = new Map<string, number>(),
    propSteps: number[] = [],
    sceneSteps = new Map<string, number>(),
    visualStyle = (
      plan.tone || "动漫风，统一角色线条、上色、光影与色彩"
    ).trim(),
    styleType = /写实|摄影|真人|电影实拍/.test(visualStyle)
      ? "写实风"
      : /拟人/.test(visualStyle)
        ? "拟人风"
        : /三维|3D|卡通渲染/.test(visualStyle)
          ? "三维卡通风"
          : /插画|绘本|水彩|国画/.test(visualStyle)
            ? "插画风"
            : "动漫风";
  plan.characters.forEach((character, index) => {
    const nonVisual =
      character.visualAsset === false ||
      /无实体|没有实体|旁白|系统之声/.test(
        `${character.name}${character.description}`,
      );
    if (nonVisual) {
      characterSteps[index] = 0;
      return;
    }
    const basePrompt =
      character.imagePrompt ||
      `${character.name} Base 人物三视图设定板：${character.description}`;
    steps.push({
      title: `角色 ${index + 1} · ${character.name} · Base`,
      kind: "image",
      prompt: basePrompt,
      referenceIndexes: [],
      dependsOn: [],
      aspectRatio: "16:9",
      stage: "character",
      styleConstraint: styleType,
      autoGenerate: true,
    });
    const baseStep = steps.length;
    characterSteps[index] = baseStep;
    (character.forms || []).forEach((form) => {
      const formPrompt =
        form.imagePrompt ||
        `${character.name}「${form.name}」形态三视图设定板：${form.description}`;
      steps.push({
        title: `角色 ${index + 1} · ${character.name} · ${form.name}`,
        kind: "image",
        prompt: formPrompt,
        referenceIndexes: [],
        dependsOn: [baseStep],
        aspectRatio: "16:9",
        stage: "character",
        styleConstraint: styleType,
        formConstraint: `严格沿用 ${character.name} Base 的身份、脸型、发型和体型，只改变「${form.name}」指定部分。`,
        autoGenerate: true,
      });
      characterFormSteps.set(`${index + 1}:${form.name}`, steps.length);
    });
  });
  plan.characters.forEach((character, index) => {
    if (!characterSteps[index]) return;
    const voiceProfile =
        character.voiceProfile || "自然中文普通话，声线符合年龄与性格",
      voiceConfig = inferVoiceConfig(
        character.name,
        voiceProfile,
        character.description,
      );
    steps.push({
      title: `语音配置 · ${character.name}`,
      kind: "voice",
      prompt: voiceProfile,
      dependsOn: [characterSteps[index]],
      stage: "voice",
      roleName: character.name,
      voiceProfile,
      ...voiceConfig,
      autoGenerate: false,
    });
    characterVoiceSteps[index] = steps.length;
  });
  let narratorVoiceStep = 0,
    systemVoiceStep = 0;
  if (
    plan.shots.some((shot) =>
      /(?:^|[；。\n])\s*旁白\s*[：:]/.test(shot.dialogue || ""),
    )
  ) {
    const voiceProfile = "稳定、沉浸、低沉、吐字清楚、语速偏慢",
      voiceConfig = inferVoiceConfig("旁白", voiceProfile);
    steps.push({
      title: "语音配置 · 旁白",
      kind: "voice",
      prompt: voiceProfile,
      dependsOn: [],
      stage: "voice",
      roleName: "旁白",
      voiceProfile,
      ...voiceConfig,
      autoGenerate: false,
    });
    narratorVoiceStep = steps.length;
  }
  if (
    plan.shots.some((shot) =>
      /(?:^|[；。\n])\s*(?:系统|系统播报|系统声音)\s*[：:]/.test(
        shot.dialogue || "",
      ),
    )
  ) {
    const voiceProfile = "清晰、克制、中性、机械感轻微",
      voiceConfig = inferVoiceConfig("系统播报", voiceProfile);
    steps.push({
      title: "语音配置 · 系统播报",
      kind: "voice",
      prompt: voiceProfile,
      dependsOn: [],
      stage: "voice",
      roleName: "系统播报",
      voiceProfile,
      ...voiceConfig,
      autoGenerate: false,
    });
    systemVoiceStep = steps.length;
  }
  (plan.props || []).forEach((prop, index) => {
    steps.push({
      title: `道具 ${index + 1} · ${prop.name}`,
      kind: "image",
      prompt:
        prop.imagePrompt || `${prop.name}道具设定图，${prop.description}`,
      referenceIndexes: [],
      dependsOn: [],
      aspectRatio: plan.aspectRatio,
      stage: "prop",
      styleConstraint: styleType,
      autoGenerate: true,
    });
    propSteps[index] = steps.length;
  });
  let storyboardCount = 0,
    compositeCount = 0,
    previousShotLastFrame = 0,
    previousShotSceneKey = "",
    sceneCrowdSteps = new Map<string, number>(),
    previousFrameCharacterKeys = new Set<string>(),
    previousFramePropIndexes = new Set<number>();
  const prepareTwoReferenceInputs = (
    candidates: number[],
    label: string,
    aspectRatio: string,
  ) => {
    const unique = [...new Set(candidates.filter(Boolean))];
    if (unique.length <= 2) return unique;
    let composite = 0;
    for (let cursor = 2; cursor < unique.length; cursor++) {
      const dependencies = composite
        ? [composite, unique[cursor - 1]]
        : unique.slice(0, 2);
      const sourceTitles = dependencies.map((stepIndex) =>
          clipVideoPrompt(
            steps[stepIndex - 1]?.title || `素材 ${stepIndex}`,
            24,
          ),
        ),
        localPrompt = composite
          ? `仅在图1已有合成画面中加入图2「${sourceTitles[1]}」，保持图1全部内容、位置、比例、服饰、场景和光线不变。`
          : `仅合并图1「${sourceTitles[0]}」与图2「${sourceTitles[1]}」，按原素材建立统一空间关系，不添加其他人物、道具或剧情内容。`;
      steps.push({
        title: `素材合成 · ${label} · 第 ${cursor - 1} 步`,
        kind: "image",
        prompt: localPrompt,
        referenceIndexes: [],
        dependsOn: dependencies,
        aspectRatio,
        stage: "storyboard",
        promptProfile: "composite",
        styleConstraint: styleType,
        formConstraint:
          "当前仅执行连接素材合并；每张角色参考只对应一个人物实例，禁止复制角色、改变身份或提前生成未连接素材。",
        continuityConstraint: composite
          ? "严格继承图1已有合成结果，本步只加入图2。"
          : "只使用图1与图2建立底图，不执行最终分镜动作。",
        autoGenerate: true,
      });
      composite = steps.length;
      compositeCount++;
    }
    return [composite, unique.at(-1)!];
  };
  const ensureSceneStep = (
    sceneKey: string,
    fallbackShot?: ComicShot,
    requestedView: "main" | "reverse" | "left" | "right" | "top" = "main",
  ): number => {
    const mapKey = `${sceneKey}:${requestedView}`,
      existing = sceneSteps.get(mapKey);
    if (existing) return existing;
    const sceneAsset = plan.scenes?.find((scene) => scene.sceneId === sceneKey),
      sceneView = sceneAsset?.views?.find((view) => view.id === requestedView),
      mainViewStep = requestedView === "main" ? 0 : ensureSceneStep(sceneKey, fallbackShot, "main"),
      parentKey = sceneAsset?.baseSceneId?.trim(),
      parentStep = requestedView === "main" && parentKey && parentKey !== sceneKey ? ensureSceneStep(parentKey, undefined, "main") : 0,
      scenePropIndexes = [...new Set((sceneAsset?.propIndexes || []).filter((value) => Number.isInteger(value) && value >= 1 && value <= propSteps.length))],
      rawScenePrompt = requestedView === "main"
        ? sceneAsset?.imagePrompt || fallbackShot?.scenePrompt || fallbackShot?.scene || sceneAsset?.description || sceneAsset?.name || "空场景"
        : sceneView?.imagePrompt || `${sceneView?.name || requestedView}，保持同一空间结构`,
      anchors = (sceneAsset?.environmentAnchors || []).join("；"),
      variantGuide = requestedView !== "main"
        ? `严格基于连接的场景主视角生成「${sceneView?.name || requestedView}」；建筑尺寸、标志物、固定道具位置、材质、主光方向和摄影轴线完全不变，只改变摄影机方位，禁止重新设计。`
        : parentStep
        ? `严格基于连接的父场景生成${sceneAsset?.variantType === "area" ? "同一地点的局部区域" : sceneAsset?.variantType === "time" ? "同一空间的时段变体" : "同一空间的状态变体"}；继承建筑语言、标志物、材质、色彩、空间方向和主光，禁止重新设计。`
        : "",
      scenePrompt = `无人物场景基准图，禁止出现任何人物、人体、手部、角色剪影或人形主体；仅生成可供后续分镜合成的环境。${variantGuide}${clipVideoPrompt(rawScenePrompt.replace(/^(?:无人物|空镜头?|纯场景)[，,：:\s]*/, "").trim(), parentStep ? 80 : 105)}${anchors ? `；固定空间锚点：${clipVideoPrompt(anchors, 55)}` : ""}`,
      dependencies = prepareTwoReferenceInputs(
        [mainViewStep || parentStep, ...(requestedView === "main" ? scenePropIndexes.map((value) => propSteps[value - 1]) : [])].filter(Boolean),
        `场景 ${sceneAsset?.name || fallbackShot?.title || sceneKey}`,
        plan.aspectRatio,
      );
    steps.push({
      title: `场景 · ${sceneAsset?.name || fallbackShot?.title || sceneKey} · ${sceneView?.name || "主视角"}`,
      kind: "image",
      prompt: scenePrompt,
      referenceIndexes: [],
      dependsOn: dependencies,
      aspectRatio: plan.aspectRatio,
      stage: "scene",
      styleConstraint: styleType,
      formConstraint: [
        requestedView !== "main" ? "连接的主视角是当前方位唯一空间基准，只允许改变摄影机方向。" : parentStep ? "连接的父场景是本场景唯一空间基准，只允许执行指定的区域、时段或状态变化。" : "",
        scenePropIndexes.length ? "连接的固定道具属于场景结构，只按空间锚点放置并锁定外观、比例与位置，禁止重新设计或生成副本。" : "",
      ].filter(Boolean).join("；"),
      autoGenerate: true,
    });
    const created = steps.length;
    sceneSteps.set(mapKey, created);
    return created;
  };
  plan.scenes?.forEach((scene) =>
    (scene.views?.length
      ? scene.views
      : [
          { id: "main" as const, name: "主视角" },
          { id: "reverse" as const, name: "反向视角" },
          { id: "top" as const, name: "俯视布局" },
        ]
    ).forEach((view) => ensureSceneStep(scene.sceneId, undefined, view.id)),
  );
  plan.shots.forEach((shot, index) => {
    shot = {
      ...shot,
      scenePrompt: stripCharactersFromScenePrompt(
        shot.scenePrompt || shot.scene,
        plan,
      ),
    };
    const sceneKey = shot.sceneId?.trim() || `scene-${index + 1}`,
      sceneAsset = plan.scenes?.find(
        (scene) => scene.sceneId === sceneKey,
      ),
      scenePropIndexes = [
        ...new Set(
          (sceneAsset?.propIndexes || []).filter(
            (value) =>
              Number.isInteger(value) &&
              value >= 1 &&
              value <= propSteps.length,
          ),
        ),
      ],
      scenePropSet = new Set(scenePropIndexes);
    const requestedSceneView = ["main", "reverse", "left", "right", "top"].includes(String(shot.sceneView))
        ? shot.sceneView!
        : "main",
      sceneStep = ensureSceneStep(sceneKey, shot, requestedSceneView);
    const characterEvidence = `${shot.scene}${shot.storyBeat || ""}${shot.action || ""}${shot.dialogue}${shot.imagePrompt}${JSON.stringify(shot.frames || [])}`,
      mentionedCharacterIndexes = plan.characters
        .map((character, characterIndex) =>
          characterEvidence.includes(character.name) ? characterIndex + 1 : 0,
        )
        .filter(Boolean),
      declaredCharacterIndexes = shot.characterIndexes || [],
      characterIndexes =
        declaredCharacterIndexes.length && mentionedCharacterIndexes.length
          ? declaredCharacterIndexes.filter((value) =>
              mentionedCharacterIndexes.includes(value),
            )
          : declaredCharacterIndexes.length
            ? declaredCharacterIndexes
            : mentionedCharacterIndexes,
      shotSelectedForms = new Map(
        (shot.characterForms || []).map((selection) => [
          selection.characterIndex,
          selection.form,
        ]),
      ),
      currentPropIndexes = shot.propIndexes || [],
      frames = shot.frames?.length
        ? shot.frames
        : [{ title: "主画面", imagePrompt: shot.imagePrompt }],
      frameSteps: number[] = [],
      continuesPrevious = Boolean(
        previousShotLastFrame && previousShotSceneKey === sceneKey,
      ),
      hasAnonymousCrowd =
        typeof shot.hasAnonymousCrowd === "boolean"
          ? shot.hasAnonymousCrowd
          : inferAnonymousCrowd(characterEvidence);
    let crowdStep = 0;
    if (hasAnonymousCrowd) {
      crowdStep = sceneCrowdSteps.get(sceneKey) || 0;
      if (!crowdStep) {
        steps.push({
          title: `群演基图 · ${sceneAsset?.name || shot.title}`,
          kind: "image",
          prompt: `当前场景的可复用匿名群演基图，只生成不具名人物：${clipVideoPrompt(shot.crowdPrompt || shot.scene, 100)}。保持连接场景的建筑、布局、机位轴线和光线；所有个体脸型、发型、年龄、体型、服装颜色与动作明显不同，自然错落分布；禁止出现或复制任何具名角色，禁止多人共用同一张脸。`,
          referenceIndexes: [],
          dependsOn: [sceneStep],
          aspectRatio: plan.aspectRatio,
          stage: "storyboard",
          styleConstraint: styleType,
          continuityConstraint: "这是当前场景唯一的匿名群演分布基准，后续镜头只允许在此基础上改变动作和站位，不得随机更换整批人群。",
          autoGenerate: true,
        });
        crowdStep = steps.length;
        sceneCrowdSteps.set(sceneKey, crowdStep);
      }
    }
    let priorCharacterKeys = continuesPrevious
        ? new Set(previousFrameCharacterKeys)
        : new Set<string>(),
      priorPropIndexes = continuesPrevious
        ? new Set(previousFramePropIndexes)
        : new Set<number>();
    frames.forEach((frame, frameIndex) => {
      const frameEvidence = `${frame.title}${frame.imagePrompt}${frame.change || ""}${frame.inherit || ""}`,
        inferredFrameCharacters = plan.characters
          .map((character, characterIndex) =>
            frameEvidence.includes(character.name) ? characterIndex + 1 : 0,
          )
          .filter(Boolean),
        frameCharacterIndexes = frame.characterIndexes?.length
          ? frame.characterIndexes
          : frames.length === 1
            ? characterIndexes
            : inferredFrameCharacters,
        frameSelectedForms = new Map(shotSelectedForms);
      for (const selection of frame.characterForms || [])
        frameSelectedForms.set(selection.characterIndex, selection.form);
      const frameCharacterKeys = new Set(
          frameCharacterIndexes.map(
            (value) => `${value}:${frameSelectedForms.get(value) || "Base"}`,
          ),
        ),
        framePropIndexes = frame.propIndexes?.length
          ? frame.propIndexes
          : frames.length === 1
            ? currentPropIndexes
            : (plan.props || [])
                .map((prop, propIndex) =>
                  frameEvidence.includes(prop.name) ? propIndex + 1 : 0,
                )
                .filter(Boolean),
        framePropSet = new Set(framePropIndexes),
        newCharacterDependencies = [...frameCharacterKeys]
          .filter((key) => !priorCharacterKeys.has(key))
          .map((key) => {
            const [rawIndex, form] = key.split(":");
            const characterIndex = Number(rawIndex);
            return form === "Base"
              ? characterSteps[characterIndex - 1]
              : characterFormSteps.get(`${characterIndex}:${form}`) ||
                  characterSteps[characterIndex - 1];
          })
          .filter(Boolean),
        newPropDependencies = framePropIndexes
          .filter(
            (value) =>
              !scenePropSet.has(value) && !priorPropIndexes.has(value),
          )
          .map((value) => propSteps[value - 1])
          .filter(Boolean),
        generatedKeyframe =
          frame.keyframe ||
          (frames.length === 1
            ? "start"
            : frameIndex === 0
              ? "start"
              : frameIndex === frames.length - 1
                ? "end"
                : "middle"),
        continuityGuide = [
          frameIndex === 0 && continuesPrevious
            ? "严格承接上一镜末帧的人物位置、动作结束姿态、视线、服饰与道具状态；同时以连接的当前场景基准恢复建筑、空间方向、主光和轴线，换景别或换角度不得丢失场景。"
            : "",
          frameIndex === 0 && !continuesPrevious && index > 0
            ? `这是新场景建立帧，按“${shot.transition || "明确转场"}”完成地点或时段转换，先建立空间再表现动作，不得伪装成上一场景。`
            : "",
          frameIndex === 0 && shot.continuity
            ? `镜头承接：${shot.continuity}`
            : "",
          frameIndex === 0 && shot.transition
            ? `过渡方式：${shot.transition}`
            : "",
          frame.inherit ? `继承：${frame.inherit}` : "",
          frame.change ? `本帧只改变：${frame.change}` : "",
        ]
          .filter(Boolean)
          .join(" "),
        formGuide = [...frameSelectedForms]
          .filter(([characterIndex]) =>
            frameCharacterIndexes.includes(characterIndex),
          )
          .map(
            ([characterIndex, form]) =>
              `${plan.characters[characterIndex - 1]?.name || `角色${characterIndex}`}使用「${form}」形态`,
          )
          .join("；"),
        formLock = formGuide ? `${formGuide}，不得混用其他形态。` : "",
        crowdLock = crowdStep
          ? "匿名人群只能沿用“群演背景”参考，每个具名角色仅出现一次；禁止用角色 Base 填充路人、复制脸或复制服装。"
          : "本镜头不含匿名群众，禁止自行添加路人、围观者或背景人群。",
        stateLock = frame.lock ? `锁定不变：${frame.lock}` : "",
        framePrompt = clipVideoPrompt(
          frame.imagePrompt || shot.imagePrompt,
          100,
        ),
        continuityFrame = frameIndex
          ? frameSteps[frameIndex - 1]
          : continuesPrevious
            ? previousShotLastFrame
            : 0,
        // Every continuous frame keeps the canonical scene as the second
        // reference. The previous frame preserves transient damage and
        // character state; the scene reference prevents cumulative drift of
        // walls, buildings, doors, roads and fixed furnishings. Additional
        // new assets are still folded in through the existing two-reference
        // staged compositor.
        needsSceneAnchor = Boolean(continuityFrame),
        referenceCandidates = continuityFrame
          ? [
              continuityFrame,
              ...(needsSceneAnchor ? [sceneStep] : []),
              ...(crowdStep ? [crowdStep] : []),
              ...newCharacterDependencies,
              ...newPropDependencies,
            ]
          : [
              crowdStep || sceneStep,
              ...newCharacterDependencies,
              ...newPropDependencies,
            ],
        frameDependencies = prepareTwoReferenceInputs(
          referenceCandidates,
          `分镜 ${shot.number}.${frameIndex + 1}`,
          plan.aspectRatio,
        );
      steps.push({
        title: `分镜 ${shot.number}.${frameIndex + 1} · ${generatedKeyframe === "start" ? "起始" : generatedKeyframe === "end" ? "结束" : "中间"}关键帧 · ${frame.title || shot.title}`,
        kind: "image",
        prompt: framePrompt,
        referenceIndexes: shot.referenceIndexes,
        dependsOn: frameDependencies,
        aspectRatio: plan.aspectRatio,
        stage: "storyboard",
        styleConstraint: `${styleType}，${clipVideoPrompt(visualStyle.replace(/^风格类型：[^。]+。?/, "").trim(), 55)}`,
        formConstraint: [formLock, crowdLock, stateLock]
          .filter(Boolean)
          .join("；"),
        continuityConstraint: continuityGuide,
        crowdConstraint: crowdStep ? "required" : "forbidden",
        autoGenerate: true,
      });
      frameSteps.push(steps.length);
      storyboardCount++;
      priorCharacterKeys = frameCharacterKeys;
      priorPropIndexes = framePropSet;
    });
    const spokenText = (shot.dialogue || "").trim(),
      fittedDialogue = fitVideoDialogue(spokenText, shot.duration),
      hasSpeech = fittedDialogue && !/^无对白/.test(fittedDialogue),
      speakingCharacters = plan.characters.filter((character) =>
        new RegExp(
          `${character.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[：:]`,
        ).test(fittedDialogue),
      ),
      hasNarration = /(?:^|[；。])\s*旁白\s*[：:]/.test(fittedDialogue),
      hasSystemVoice =
        /(?:^|[；。])\s*(?:系统|系统播报|系统声音)\s*[：:]/.test(
          fittedDialogue,
        ),
      voiceProfiles = [
        ...speakingCharacters.map(
          (character) =>
            `${character.name}固定声线：${character.voiceProfile || "自然中文普通话，声线符合年龄与性格"}`,
        ),
        ...(hasNarration
          ? ["旁白固定声线：成年男性，低沉沉稳、沉浸克制、吐字清楚、语速偏慢"]
          : []),
        ...(hasSystemVoice
          ? ["系统播报固定声线：中性、清晰克制、轻微机械感、语速稳定"]
          : []),
      ],
      voiceProfile = compactPromptPart(voiceProfiles.join("；"), 110),
      videoDialogueGuide = hasSpeech
        ? `中文台词：${fittedDialogue}。${voiceProfile ? `${voiceProfile}；跨镜头保持相同音色、音高、语速和说话方式。` : ""}${hasNarration ? "旁白时所有人物闭口。" : ""}${hasSystemVoice ? "系统播报不由画面人物发声。" : ""}按顺序自然口型，未说话者闭口。`
        : "无对白，不生成说话口型，以动作和环境声推进。";
    const conciseVideoPrompt = [
      `禁止字幕、对白文字、旁白文字、自动转写、气泡字和水印；台词仅通过中文语音与口型呈现。`,
      compactPromptPart(shot.videoPrompt, 105),
      videoDialogueGuide,
      `保持${styleType}及连接分镜中的人物、服装、场景一致，只执行指定动作和运镜，不重新设计。`,
    ]
      .filter(Boolean)
      .join(" ");
    steps.push({
      title: `镜头 ${shot.number} · ${shot.title}`,
      kind: "video",
      prompt: compactPromptPart(conciseVideoPrompt, 360),
      referenceIndexes: [],
      dependsOn: frameSteps,
      duration: shot.duration,
      aspectRatio: plan.aspectRatio,
      stage: "video",
      autoGenerate: false,
    });
    if (hasSpeech) {
      for (const segment of speechSegments(fittedDialogue, plan.characters.map((character) => character.name))) {
        const characterIndex = plan.characters.findIndex(
            (character) => character.name === segment.roleName,
          ),
          voiceStep =
            segment.roleName === "旁白"
              ? narratorVoiceStep
              : segment.roleName === "系统播报"
                ? systemVoiceStep
                : characterIndex >= 0
                  ? characterVoiceSteps[characterIndex]
                  : 0;
        if (voiceStep)
          steps.push({
            title: `对白 ${shot.number} · ${segment.roleName}`,
            kind: "tts",
            prompt: segment.text,
            dependsOn: [voiceStep],
            stage: "tts",
            roleName: segment.roleName,
            autoGenerate: false,
          });
      }
    }
    previousShotLastFrame = frameSteps.at(-1) || 0;
    previousShotSceneKey = sceneKey;
    previousFrameCharacterKeys = priorCharacterKeys;
    previousFramePropIndexes = priorPropIndexes;
  });
  const result: PromptAgentResult = {
    model: plan.model || "gpt-5.5",
    kind: "video",
    subject: "",
    scene: "",
    composition: "",
    lighting: "",
    style: plan.tone || "",
    motion: "",
    negativePrompt: "",
    finalPrompt: plan.logline,
    action: "create_new",
    targetType: "video",
    summary: `《${plan.title}》已铺设角色、道具、场景、连续分镜与视频工作流`,
    shouldGenerate: false,
    layout: "comic-workflow",
    steps,
  };
  
  return {
    result,
    storyboardCount,
    compositeCount,
    sceneCount: sceneSteps.size,
  };
}
