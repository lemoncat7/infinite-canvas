import { OpenAiImageProvider } from '../providers/openai-image.js'
import { OpenAiVideoProvider } from '../providers/openai-video.js'
import { AgnesImageProvider } from '../providers/agnes-image.js'
import { AgnesVideoProvider } from '../providers/agnes-video.js'
import type { GenerationProvider } from '../providers/types.js'
import type { ResolvedModel } from './types.js'
import { apiRoot } from './network.js'
import { safeModelError } from './errors.js'
import { createGenerationProvider } from '../providers/index.js'

/** An unconfigured legacy adapter must not prevent administrators configuring models in the UI. */
export function compatibleLegacyProvider(): GenerationProvider {
  try { return createGenerationProvider() }
  catch (error) {
    if (!(error instanceof Error) || !/is required/.test(error.message)) throw error
    return { name: 'unconfigured', run: async () => { throw new Error('旧环境模型连接尚未配置，请在全局模型管理中选择可用模型') } }
  }
}

export function configuredProvider(resolved: ResolvedModel): GenerationProvider {
  const config = { ...resolved.connection, baseUrl: apiRoot(resolved.connection.baseUrl) }
  let provider: GenerationProvider
  switch (resolved.model.adapter) {
    case 'openai-image': provider = new OpenAiImageProvider(config); break
    case 'openai-video': provider = new OpenAiVideoProvider(config); break
    case 'agnes-image': provider = new AgnesImageProvider(config); break
    case 'agnes-video': provider = new AgnesVideoProvider(config); break
    default: throw new Error('当前模型不是生成模型')
  }
  return { name: provider.name, run: async (input, update) => {
    try { return await provider.run(input, update) }
    catch (error) { throw safeModelError(error) }
  } }
}
