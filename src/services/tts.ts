import type { TtsProviderOption, TtsVoiceOption } from "../nodes/node-types";
import type { FlowNode } from "../nodes/node-types";
import { apiFetch } from "./api";

async function readJson<T>(response: Response, message: string): Promise<T> {
  const result = (await response.json()) as T;
  if (!response.ok) throw new Error(message);
  return result;
}

export async function fetchTtsProviders() {
  return readJson<TtsProviderOption[]>(
    await fetch("/api/tts/providers"),
    "provider list unavailable",
  );
}

export async function fetchTtsVoices(providerId: string) {
  const result = await readJson<{ voices?: TtsVoiceOption[] }>(
    await fetch(`/api/tts/providers/${encodeURIComponent(providerId)}/voices`),
    "voice list unavailable",
  );
  return result.voices ?? [];
}

export async function synthesizeTts(
  projectId: string,
  node: FlowNode,
  voice: FlowNode,
  text: string,
  preview = false,
) {
  const response = await apiFetch("/api/tts/synthesize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(185000),
    body: JSON.stringify({
      projectId,
      providerId: voice.voiceSettings?.providerId || "easyvoice-local",
      text,
      voiceId: voice.voiceSettings?.voiceId || "zh-CN-XiaoxiaoNeural",
      speed: voice.voiceSettings?.defaultSpeed ?? 1,
      pitch: voice.voiceSettings?.pitch ?? 0,
      volume: voice.voiceSettings?.volume ?? 1,
      format: preview ? "mp3" : node.ttsSettings?.format || "mp3",
      language: voice.voiceSettings?.language || "zh-CN",
      emotion: node.ttsSettings?.emotion || "中性",
      preview,
    }),
  });
  if (!response.ok) {
    const result = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(result.error || "语音生成失败");
  }
  return response;
}
