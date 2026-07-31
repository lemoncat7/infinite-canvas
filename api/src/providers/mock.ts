import type { GenerationInput, GenerationProvider, GenerationUpdate } from './types.js'

export class MockGenerationProvider implements GenerationProvider {
  readonly name = 'mock'

  async run(input: GenerationInput, onUpdate: (update: GenerationUpdate) => void) {
    for (const stage of [
      { delay: 600, progress: 18 },
      { delay: 900, progress: 52 },
      { delay: 1100, progress: 84 },
    ]) {
      await wait(stage.delay)
      onUpdate({ status: 'running', progress: stage.progress })
    }
    await wait(1200)
    const result: GenerationUpdate = { status: 'succeeded', progress: 100, resultUrl: `/api/mock/${input.kind}-${input.internalJobId}.webp` }
    onUpdate(result)
    return result
  }
}

const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))
