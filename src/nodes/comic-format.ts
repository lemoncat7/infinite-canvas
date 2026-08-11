import type { ComicBrief, ComicPlan } from "./comic-types";

export function briefFromComicPlan(plan: ComicPlan): ComicBrief {
  return {
    title: plan.title,
    premise: plan.logline,
    duration: plan.duration,
    aspectRatio: plan.aspectRatio || "16:9",
    visualStyle: plan.tone,
    characters: plan.characters.map((item) => item.name).join("、"),
    conflict: plan.outline?.[0]?.content || "",
    ending: plan.outline?.at(-1)?.content || "",
    openQuestions: [],
  };
}

export function stripCharactersFromScenePrompt(
  value: string,
  plan: ComicPlan | null,
) {
  let result = value;
  for (const character of plan?.characters || []) {
    const name = character.name.trim();
    if (name.length < 2) continue;
    result = result.replace(
      new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
      "",
    );
  }
  return result
    .replace(
      /(?:主角|男主|女主|角色|人物)[^，。；]{0,16}(?:站在|坐在|位于|走进|出现于)[^，。；]*/g,
      "",
    )
    .replace(/[，、；：]{2,}/g, "，")
    .replace(/^[，、；：\s]+|[，、；：\s]+$/g, "");
}

export function formatComicPlan(plan: ComicPlan) {
  const characters = plan.characters
    .map((character) => `【角色·${character.name}】${character.description}`)
    .join("\n");
  const props = (plan.props || [])
    .map((prop) => `【道具·${prop.name}】${prop.description}`)
    .join("\n");
  const outline = plan.outline
    .map((item) => `【${item.act}】${item.content}`)
    .join("\n");
  const shots = plan.shots
    .map((shot) => {
      const frames = shot.frames?.length
        ? shot.frames
        : [{ title: "主画面", imagePrompt: shot.imagePrompt }];
      return `${String(shot.number).padStart(2, "0")}｜${shot.title}｜${shot.duration} 秒\n${shot.storyBeat ? `剧情节拍：${shot.storyBeat}\n` : ""}${shot.action ? `表演动作：${shot.action}\n` : ""}画面：${shot.scene}\n对白/旁白：${shot.dialogue || "无对白，以画面动作推进"}\n${frames.map((frame, index) => `分镜 ${index + 1}·${frame.title}：${frame.imagePrompt}`).join("\n")}\n动态：${shot.videoPrompt}${shot.continuity ? `\n连续性：${shot.continuity}` : ""}`;
    })
    .join("\n\n");
  return `《${plan.title}》\n${plan.logline}\n\n时长：${plan.duration}　画幅：${plan.aspectRatio}\n风格：${plan.tone}\n\n—— 视觉资产 ——\n${characters}${props ? `\n${props}` : ""}\n\n—— 剧情大纲 ——\n${outline}\n\n—— 制作分镜 ——\n${shots}`;
}
