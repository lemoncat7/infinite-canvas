import { AgnesImageProvider } from './agnes-image.js'
import { GeminiImageProvider } from './gemini-image.js'
import { OpenAiImageProvider } from './openai-image.js'
import { SdCppImageProvider } from './sdcpp-image.js'
import type { GenerationInput, GenerationProvider, GenerationUpdate } from './types.js'

export class ModelImageProvider implements GenerationProvider {
  readonly name='model-image'
  private readonly openai=new OpenAiImageProvider()
  private readonly agnes=new AgnesImageProvider()
  private readonly gemini=new GeminiImageProvider()
  private readonly sdcpp=process.env.SDCPP_IMAGE_BASE_URL?new SdCppImageProvider():null
  run(input:GenerationInput,onUpdate:(update:GenerationUpdate)=>void){const provider=['flux1-kontext-dev','z-image-turbo'].includes(input.model)?(this.sdcpp||missingSdCpp()):input.model.startsWith('agnes-image-')?this.agnes:input.model.startsWith('gemini-')?this.gemini:this.openai;return provider.run(input,onUpdate)}
}

function missingSdCpp():never{throw new Error('FLUX.1 Kontext 本地服务尚未配置')}
