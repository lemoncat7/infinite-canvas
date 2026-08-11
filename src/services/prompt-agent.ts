import type {
  PromptAgentMode,
  PromptAgentResult,
} from "../nodes/comic-types";
import type { NodeKind } from "../nodes/node-types";
import { apiFetch } from "./api";

export type PromptAgentRequest = {
  idea: string;
  kind: "image" | "video";
  promptMode: PromptAgentMode;
  complexity: string;
  model: string;
  context?: string[];
  visuals?: string[];
  target?: {
    id: number;
    kind: NodeKind;
    role: string;
    hasMedia: boolean;
    hasPrompt: boolean;
  } | null;
};

export async function requestPromptAgent(
  request: PromptAgentRequest,
  signal?: AbortSignal,
): Promise<PromptAgentResult> {
  const response = await apiFetch("/api/agents/prompt", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  const responseText = await response.text();
  let result: PromptAgentResult & { error?: string };
  try {
    result = JSON.parse(responseText) as PromptAgentResult & { error?: string };
  } catch {
    if (request.promptMode === "voice")
      throw new Error("音色服务暂时不可用，请稍后重试");
    throw new Error(
      response.status === 504
        ? "提示词生成超时，请再次尝试"
        : "灵感服务暂时不可用，请稍后重试",
    );
  }
  if (!response.ok) {
    const promptOnly = request.promptMode !== "create";
    throw new Error(
      result.error ||
        (request.promptMode === "voice"
          ? "音色配置生成失败"
          : promptOnly
            ? "提示词生成失败"
            : "创作规划失败"),
    );
  }
  return result;
}
