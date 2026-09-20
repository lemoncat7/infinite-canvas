import { type FastifyInstance } from "fastify";
import { generationProvider, modelStore } from "../generation/config.js";
import { localImageFallbackAvailable } from "../generation/fallback.js";

export function registerHttpStatusRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({
    ok: true,
    service: "flow-studio-api",
    generationProvider: generationProvider.name,
  }));

  app.get("/generation/capabilities", async () => {
    const capabilities = generationProvider.capabilities ?? {
      image: {
        provider: generationProvider.name,
        defaultModel: process.env.OPENAI_IMAGE_DEFAULT_MODEL || "gpt-image-2",
      },
      video: {
        provider: generationProvider.name,
        defaultModel:
          process.env.AGNES_VIDEO_DEFAULT_MODEL || "agnes-video-v2.0",
        seconds: { min: 1, max: 18, default: 5 },
        resolutions: ["480p", "720p", "1080p"],
        aspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"],
      },
    };
    return {
      ...capabilities,
      video: {
        ...capabilities.video,
        defaultModel: modelStore.catalog().defaults.video ?? "",
      },
      image: {
        ...capabilities.image,
        defaultModel: modelStore.catalog().defaults.image ?? "",
        localFallback: {
          model: "flux1-kontext-dev",
          available: localImageFallbackAvailable,
        },
      },
    };
  });
}
