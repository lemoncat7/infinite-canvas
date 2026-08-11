import type { FlowNode } from "./node-types";
import { normalizePromptText } from "./prompt-node";

export function compactPromptPart(value: string, limit: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  const pieces = normalized.match(/[^。！？；.!?;]+[。！？；.!?;]?/g) ?? [
    normalized,
  ];
  let result = "";
  for (const piece of pieces) {
    const next = `${result}${piece.trim()}`;
    if (next.length > limit) break;
    result = next;
  }
  return (result || normalized.slice(0, limit)).replace(/[，、：:\s]+$/, "");
}

export function imageSizeConstraint(size?: string) {
  if (!size || size === "auto") return "";
  const ratio = (
    {
      "1024x1024": "1:1",
      "1344x1008": "4:3",
      "1008x1344": "3:4",
      "1536x1024": "3:2",
      "1024x1536": "2:3",
      "1536x864": "16:9",
      "864x1536": "9:16",
    } as Record<string, string>
  )[size];
  const dimensions = size.replace("x", "×");
  return `输出要求：画面宽高比为 ${ratio ?? dimensions}，尺寸为 ${dimensions}，请直接按此比例构图，不要裁切。`;
}

export function composeImageGenerationPrompt(
  node: FlowNode,
  userDescription: string,
  inputs: FlowNode[],
) {
  const profile = node.promptProfile || "manual",
    description = normalizePromptText(userDescription),
    profileGuide = (
      {
        character:
          "生成目标：单一角色设定板，完整展示固定外观、服饰与身份特征；禁止剧情场景、表演动作、多人互动、海报构图和重复角色。",
        prop: "生成目标：单一道具设定素材，清楚展示结构、材质、颜色与细节；禁止人物、人体、手持动作、剧情表演和复杂场景。",
        scene:
          "生成目标：无人场景基准素材，只展示环境、空间结构、UI界面与光影；禁止任何人物、人体、手部、角色剪影、人形主体、动物或车辆特写；除剧情明确要求的既有标识外，禁止文字、字幕、标牌和水印。",
        storyboard:
          "生成目标：完整剧情分镜画面，按连接素材合成人物、场景与必要道具，并准确表现本帧动作、构图和剧情状态；禁止设定板、三视图、素材拼贴、重复人物和无关元素。",
        composite:
          "生成目标：技术素材合成图，只合并当前连接的图1与图2；禁止执行最终分镜动作、禁止补充未连接人物或道具、禁止扩写剧情。",
        manual: "",
      } as const
    )[profile],
    referenceList = inputs
      .slice(0, 4)
      .map(
        (item, index) =>
          `图${index + 1}「${compactPromptPart(item.title, 18)}」`,
      ),
    references = referenceList.length
      ? `参考素材：${referenceList.join("、")}。只执行描述中明确要求的新增、替换、动作、机位、景别或缩放变化；其余人物身份与数量、服装发型、道具外观和位置、场景结构、光照、画风均锁定，不得自行重设计或添加元素。`
      : "",
    characterCount = inputs.filter((item) =>
      /^角色\s*\d*\s*·/.test(item.title),
    ).length,
    roleGuide = characterCount
      ? "每张角色参考只对应一个人物实例，禁止复制参考角色充当路人。"
      : "",
    crowdGuide =
      node.crowdConstraint === "required"
        ? "本镜头明确需要匿名群众：必须把连接的群演背景参考合入最终画面，保留其人数范围、空间分布和行为；不得删除群众、不得替换成具名角色、不得复制角色脸或服装。"
        : node.crowdConstraint === "forbidden"
          ? "本镜头不含匿名群众，禁止添加路人、围观者或背景人群。"
          : "",
    sceneHardLock =
      profile === "storyboard"
        ? "场景硬锁：除本帧明确要求的环境变化外，墙体、房屋、门窗、道路及固定陈设的数量、位置、比例、朝向、材质和破损状态必须与连接场景一致；只改变指定人物动作和随身物品，禁止移动、增删、重建或替换建筑。镜头硬锁：未明确要求换机位、景别、焦段或构图时必须使用固定镜头，相机位置、取景范围、透视、轴线和画面边界不得改变。"
        : "",
    exclusionGuide =
      profile === "storyboard"
        ? `画面只出现描述和连接素材明确要求的主体；${node.crowdConstraint ? "" : "未要求匿名群众时禁止添加路人、围观者或背景人群；"}未要求时禁止人物或动物特写、车辆、可读文字、字幕、标识、水印及无关装饰。`
        : profile === "composite"
          ? "除连接素材已有内容外，禁止新增人物、动物、车辆、文字、字幕、标识或水印。"
          : "",
    sizeGuide = normalizePromptText(imageSizeConstraint(node.imageSettings?.size)),
    optionalDynamic = [
      profileGuide,
      exclusionGuide,
      references,
      node.formConstraint,
      node.continuityConstraint,
      roleGuide,
      node.styleConstraint ? `风格：${node.styleConstraint}` : "",
    ]
      .map((value) => normalizePromptText(value))
      .filter(Boolean),
    mandatoryDynamic = [crowdGuide, sceneHardLock, sizeGuide].filter(Boolean),
    dynamic = [...mandatoryDynamic, ...optionalDynamic].filter(Boolean),
    limit =
      profile === "character"
        ? 520
        : profile === "storyboard" || profile === "composite"
          ? 320
          : 260,
    full = [description, ...dynamic].filter(Boolean).join("\n");
  if (full.length <= limit)
    return { prompt: full, corePrompt: dynamic.join("\n") };
  const mandatoryCore = mandatoryDynamic.join("\n"),
    separators =
      (description ? 1 : 0) +
      (mandatoryCore ? 1 : 0) +
      (mandatoryCore && optionalDynamic.length ? 1 : 0),
    remaining = Math.max(
      0,
      limit - description.length - mandatoryCore.length - separators,
    ),
    optionalCore = remaining
      ? compactPromptPart(optionalDynamic.join("\n"), remaining)
      : "",
    corePrompt = [mandatoryCore, optionalCore].filter(Boolean).join("\n");
  return {
    prompt: [description, corePrompt].filter(Boolean).join("\n"),
    corePrompt,
  };
}
