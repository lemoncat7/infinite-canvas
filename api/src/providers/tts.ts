import { LocalEasyVoiceTtsProvider, resolveEasyVoiceId } from "./tts-local.js";
import type { TtsProvider } from "./tts-types.js";

const providers: TtsProvider[] = [new LocalEasyVoiceTtsProvider()];

export function listTtsProviders() {
  return providers;
}

export function getTtsProvider(id: string) {
  const resolvedId = id === "kokoro-local" ? "easyvoice-local" : id;
  return providers.find((provider) => provider.id === resolvedId);
}

export { resolveEasyVoiceId };

export type { TtsCapabilities, TtsProvider, TtsSynthesisInput, TtsVoice } from "./tts-types.js";
