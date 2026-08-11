import type { GenerationCapabilities } from "../nodes/node-types";

export function createDefaultGenerationCapabilities(): GenerationCapabilities {
  return {
    image: { defaultModel: "gpt-image-2" },
    video: {
      defaultModel: "agnes-video-v2.0",
      seconds: { min: 1, max: 18, default: 5 },
      resolutions: ["480p", "720p", "1080p"],
      aspectRatios: ["1:1", "4:3", "16:9"],
    },
  };
}
