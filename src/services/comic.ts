import type { ComicBrief, ComicPlan } from "../nodes/comic-types";
import { apiFetch } from "./api";

export type ComicDialogueEvent = {
  type: string;
  text?: string;
  message?: string;
  sessionId?: string;
  phase?: string;
  reply?: string;
  ready?: boolean;
  brief?: ComicBrief;
  pendingRevision?: string;
  hasPlan?: boolean;
  error?: string;
};

export type ComicDialogueRequest = {
  projectId: string;
  sessionId?: string;
  message: string;
  context: string[];
  plan?: ComicPlan | null;
  model: string;
};

export interface ComicSessionSnapshot {
  id?: string;
  phase?: string;
  brief?: ComicBrief;
  pendingRevision?: string;
  plan?: ComicPlan | null;
  generationStatus?: string;
  generationStage?: string;
  generationProgress?: number;
  generationReceivedBytes?: number;
  generationError?: string;
  hasGenerationCheckpoint?: boolean;
}

export async function fetchComicSession(
  projectId: string,
  sessionId = "",
): Promise<ComicSessionSnapshot | null | undefined> {
  const query = new URLSearchParams({ projectId });
  if (sessionId) query.set("sessionId", sessionId);
  const response = await apiFetch(`/api/agents/comic/session?${query}`);
  if (response.status === 204) return null;
  if (!response.ok) return undefined;
  return (await response.json()) as ComicSessionSnapshot;
}

export async function streamComicDialogue(
  request: ComicDialogueRequest,
  onEvent: (event: ComicDialogueEvent) => void,
) {
  const response = await apiFetch("/api/agents/comic/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const failure = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(failure.error || "漫剧对话失败");
  }
  if (!response.body) throw new Error("浏览器没有收到漫剧对话流");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    result: ComicDialogueEvent | null = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as ComicDialogueEvent;
      if (event.type === "error")
        throw new Error(event.error || "漫剧对话失败");
      if (event.type === "result") result = event;
      onEvent(event);
    }
  }
  if (!result) throw new Error("漫剧对话没有完整结束");
  return result;
}
