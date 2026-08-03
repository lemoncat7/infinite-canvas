import { GeminiImageProvider } from './gemini-image.js'
import { OpenAiImageProvider } from './openai-image.js'
import type { GenerationInput, GenerationProvider, GenerationUpdate } from './types.js'

export class ModelImageProvider implements GenerationProvider {
  readonly name='model-image'
  private readonly openai=new OpenAiImageProvider()
  private readonly gemini=new GeminiImageProvider()
  run(input:GenerationInput,onUpdate:(update:GenerationUpdate)=>void){return(input.model.startsWith('gemini-')?this.gemini:this.openai).run(input,onUpdate)}
}
