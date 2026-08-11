import type { GenerationCapabilities } from "../nodes/node-types";
import { apiFetch } from "./api";

export class GenerationCapabilitiesController {
  constructor(private readonly options: {
    current: () => GenerationCapabilities;
    apply: (capabilities: GenerationCapabilities) => void;
    availabilityChanged: () => void;
  }) {}

  async load(redraw = false) {
    try {
      const response = await apiFetch("/api/generation/capabilities", { cache: "no-store" });
      if (!response.ok) return;
      const previous = this.options.current().image?.localFallback?.available;
      const capabilities = await response.json() as GenerationCapabilities;
      this.options.apply(capabilities);
      if (redraw && previous !== capabilities.image?.localFallback?.available)
        this.options.availabilityChanged();
    } catch {
      // Keep the safe default capabilities when the service is unavailable.
    }
  }
}
