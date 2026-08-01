import { AgnesVideoProvider } from './agnes-video.js'
import { OpenAiVideoProvider } from './openai-video.js'
import type { GenerationInput, GenerationProvider, GenerationUpdate } from './types.js'

export class ModelVideoProvider implements GenerationProvider {
  readonly name = 'model-video'
  private readonly agnes = new AgnesVideoProvider()
  private readonly openai = new OpenAiVideoProvider()

  run(input: GenerationInput, onUpdate: (update: GenerationUpdate) => void) {
    return (input.model.startsWith('agnes-') ? this.agnes : this.openai).run(input, onUpdate)
  }
}
