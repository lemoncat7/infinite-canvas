import type { GenerationCapabilities, GenerationInput, GenerationProvider, GenerationUpdate } from './types.js'

export class GenerationRouter implements GenerationProvider {
  readonly name: string
  readonly capabilities: GenerationCapabilities

  constructor(private readonly image: GenerationProvider, private readonly video: GenerationProvider) {
    this.name = `router(image=${image.name},video=${video.name})`
    this.capabilities = {
      image: { provider: image.name, defaultModel: process.env.OPENAI_IMAGE_DEFAULT_MODEL || 'gpt-image-2' },
      video: { provider: video.name, defaultModel: process.env.AGNES_VIDEO_DEFAULT_MODEL || 'agnes-video-v2.0', seconds: { min: 1, max: 18, default: 5 }, resolutions: ['480p', '720p', '1080p'], aspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16'] },
    }
  }

  run(input: GenerationInput, onUpdate: (update: GenerationUpdate) => void) {
    return (input.kind === 'video' ? this.video : this.image).run(input, onUpdate)
  }
}
