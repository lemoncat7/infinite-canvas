import { CustomApiGenerationProvider } from './custom-api.js'
import { MockGenerationProvider } from './mock.js'
import { OpenAiImageProvider } from './openai-image.js'
import type { GenerationProvider } from './types.js'

export function createGenerationProvider(): GenerationProvider {
  const name = process.env.GENERATION_PROVIDER ?? 'mock'
  if (name === 'mock') return new MockGenerationProvider()
  if (name === 'custom-api') return new CustomApiGenerationProvider()
  if (name === 'openai-image') return new OpenAiImageProvider()
  throw new Error(`Unsupported GENERATION_PROVIDER: ${name}`)
}

export type { GenerationInput, GenerationProvider, GenerationUpdate } from './types.js'
