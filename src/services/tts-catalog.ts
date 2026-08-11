import type { TtsProviderOption, TtsVoiceOption } from "../nodes/node-types";
import { fetchTtsProviders, fetchTtsVoices } from "./tts";

type TtsCatalogOptions = {
  invalidateProviders: () => void;
  invalidateVoices: (providerId: string) => void;
};

export class TtsCatalogController {
  providers: TtsProviderOption[] = [];
  readonly voicesByProvider = new Map<string, TtsVoiceOption[]>();
  private providerLoad: Promise<void> | null = null;
  private readonly voiceLoads = new Map<string, Promise<void>>();

  constructor(private readonly options: TtsCatalogOptions) {}

  loadProviders() {
    if (this.providers.length) return Promise.resolve();
    if (this.providerLoad) return this.providerLoad;
    this.providerLoad = (async () => {
      try {
        const result = await fetchTtsProviders();
        this.providers = Array.isArray(result) ? result : [];
        this.options.invalidateProviders();
      } catch {
        // Keep local defaults and retry when the view next requests providers.
      } finally {
        this.providerLoad = null;
      }
    })();
    return this.providerLoad;
  }

  loadVoices(providerId = "easyvoice-local") {
    if (this.voicesByProvider.has(providerId)) return Promise.resolve();
    const pending = this.voiceLoads.get(providerId);
    if (pending) return pending;
    const task = (async () => {
      try {
        this.voicesByProvider.set(providerId, await fetchTtsVoices(providerId));
        this.options.invalidateVoices(providerId);
      } catch {
        // Retry after service recovery or another provider selection.
      } finally {
        this.voiceLoads.delete(providerId);
      }
    })();
    this.voiceLoads.set(providerId, task);
    return task;
  }
}
