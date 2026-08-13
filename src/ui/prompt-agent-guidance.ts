import type { PromptAgentMode } from "../nodes/comic-types";

export type PromptAgentGuidance = {
  placeholder: string;
  title: string;
  detail: string;
};

export function promptAgentGuidance(mode: PromptAgentMode, materialCount = 0): PromptAgentGuidance {
  if (mode === "create") return materialCount > 0 ? {
    placeholder: `已选 ${materialCount} 个素材 · 描述想要的变化…`,
    title: "基于素材创作",
    detail: "说明保留项、变化项和目标结果，描述越明确，关联卡片越准确。",
  } : {
    placeholder: "描述想创造的内容…",
    title: "选择画布素材",
    detail: "点击卡片加入参考素材，再次点击可取消；也可以不选素材直接描述创作目标。",
  };
  if (mode === "voice") return {
    placeholder: "描述想要的角色声音…",
    title: "角色音色可复用",
    detail: "描述声音特征后会创建语音配置卡片，可关联角色并跨镜头复用。",
  };
  if (mode === "agnes") return {
    placeholder: "描述需要转换的视频镜头…",
    title: "Agnes 专用策略",
    detail: "按 Agnes Video v2.0 的连续性、镜头、动作、声音与限制结构生成。",
  };
  return {
    placeholder: "描述需要生成的画面或视频…",
    title: "通用提示词",
    detail: "适合多数图片与视频模型；补充主体、环境、画面要求和限制会更准确。",
  };
}
