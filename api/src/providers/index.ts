import { AgnesVideoProvider } from './agnes-video.js'
import { CustomApiGenerationProvider } from './custom-api.js'
import { MockGenerationProvider } from './mock.js'
import { ModelVideoProvider } from './model-video.js'
import { OpenAiVideoProvider } from './openai-video.js'
import { OpenAiImageProvider } from './openai-image.js'
import { ModelImageProvider } from './model-image.js'
import { GenerationRouter } from './router.js'
import type { GenerationProvider } from './types.js'

export function createGenerationProvider(): GenerationProvider {
  const name = process.env.GENERATION_PROVIDER ?? 'mock'
  if (name === 'router') return new GenerationRouter(createProvider(process.env.IMAGE_GENERATION_PROVIDER || 'openai-image'), createProvider(process.env.VIDEO_GENERATION_PROVIDER || 'agnes-video'))
  return createProvider(name)
}

function createProvider(name: string): GenerationProvider {
  if (name === 'mock') return new MockGenerationProvider()
  if (name === 'custom-api') return new CustomApiGenerationProvider()
  if (name === 'openai-image') return new OpenAiImageProvider()
  if (name === 'model-image') return new ModelImageProvider()
  if (name === 'agnes-video') return new AgnesVideoProvider()
  if (name === 'openai-video') return new OpenAiVideoProvider()
  if (name === 'model-video') return new ModelVideoProvider()
  throw new Error(`Unsupported GENERATION_PROVIDER: ${name}`)
}

export type { GenerationCapabilities, GenerationInput, GenerationProvider, GenerationUpdate } from './types.js'
