import { LocalKokoroTtsProvider } from "./tts-local.js";
import type { TtsProvider } from "./tts-types.js";

const providers: TtsProvider[] = [new LocalKokoroTtsProvider()];

export function listTtsProviders() {
  return providers;
}

export function getTtsProvider(id: string) {
  return providers.find((provider) => provider.id === id);
}

export type { TtsCapabilities, TtsProvider, TtsSynthesisInput, TtsVoice } from "./tts-types.js";
