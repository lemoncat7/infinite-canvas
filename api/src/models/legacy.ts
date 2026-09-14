import { modelInput } from './validation.js'
import type { ModelConfiguration, ModelAdapter } from './types.js'

/** Read-only compatibility view. Explicit import copies this once; restarts never overwrite it. */
export function legacyModels(env: NodeJS.ProcessEnv): ModelConfiguration {
  const config: ModelConfiguration = { revision: 0, imported: false, providers: [], models: [], defaults: {} }
  const add = (id: string, name: string, baseUrl: string | undefined, apiKey: string | undefined, proxyUrl: string | undefined, adapter: ModelAdapter, models: string[]) => {
    if (!baseUrl || !apiKey) return
    config.providers.push({ id: `env-${id}`, name, baseUrl: baseUrl.replace(/\/$/, ''), apiKey, proxyUrl: proxyUrl || '', enabled: true })
    for (const [index, model] of [...new Set(models.filter(Boolean))].entries()) config.models.push(modelInput({ name: model, model, adapter, providerId: `env-${id}`, order: index,
      creditCost: model === 'grok-imagine-image' ? 1 : model === 'grok-imagine-video-1.5-preview' ? 2 : 0,
      capabilities: { referenceImages: adapter === 'openai-chat' ? 8 : adapter === 'agnes-video' ? 2 : 7, transparent: adapter === 'openai-image', minSeconds: 1, maxSeconds: 18 },
    }, `global:env-${id}-${index}`))
  }
  add('image', '环境 · OpenAI 图片', env.OPENAI_IMAGE_BASE_URL, env.OPENAI_IMAGE_API_KEY, undefined, 'openai-image', [env.OPENAI_IMAGE_DEFAULT_MODEL || 'gpt-image-2', 'grok-imagine-image'])
  add('video', '环境 · OpenAI 视频', env.OPENAI_VIDEO_BASE_URL || env.OPENAI_IMAGE_BASE_URL, env.OPENAI_VIDEO_API_KEY || env.OPENAI_IMAGE_API_KEY, undefined, 'openai-video', ['grok-imagine-video-1.5-preview'])
  add('agnes-image', '环境 · Agnes 图片', env.AGNES_IMAGE_BASE_URL || env.AGNES_VIDEO_BASE_URL, env.AGNES_IMAGE_API_KEY || env.AGNES_VIDEO_API_KEY, env.AGNES_IMAGE_HTTPS_PROXY || env.AGNES_VIDEO_HTTPS_PROXY, 'agnes-image', ['agnes-image-2.1-flash'])
  const agnesKeys = [...new Set([env.AGNES_VIDEO_API_KEY, env.AGNES_VIDEO_API_KEY_2, ...(env.AGNES_VIDEO_API_KEYS || '').split(',')].map(key => key?.trim()).filter((key): key is string => !!key))]
  add('agnes-video', '环境 · Agnes 视频', env.AGNES_VIDEO_BASE_URL, agnesKeys[0], env.AGNES_VIDEO_HTTPS_PROXY, 'agnes-video', [env.AGNES_VIDEO_DEFAULT_MODEL || 'agnes-video-v2.0'])
  const agnesProvider = config.providers.find(p => p.id === 'env-agnes-video')
  if (agnesProvider) agnesProvider.apiKeys = agnesKeys
  add('text', '环境 · 文本助手', env.PROMPT_AGENT_BASE_URL || env.OPENAI_IMAGE_BASE_URL, env.PROMPT_AGENT_API_KEY || env.OPENAI_IMAGE_API_KEY, env.PROMPT_AGENT_HTTPS_PROXY || env.OPENAI_IMAGE_HTTPS_PROXY, 'openai-chat', [env.PROMPT_AGENT_MODEL || 'gpt-5.5', 'kimi-k2.5', 'gpt-5.4-mini'])
  config.defaults = { image: config.models.find(m => m.adapter === 'openai-image')?.id, video: config.models.find(m => m.adapter === 'agnes-video')?.id || config.models.find(m => m.kind === 'video')?.id, prompt: config.models.find(m => m.kind === 'text')?.id, comic: config.models.find(m => m.kind === 'text')?.id }
  return config
}
