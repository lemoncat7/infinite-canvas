import type { TtsProviderOption, TtsVoiceOption } from "../nodes/node-types";

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
