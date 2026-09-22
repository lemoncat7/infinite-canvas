import { ModelConfigError } from '../models/types.js';
import type { GenerationInput } from './types.js';

/** Official contract: https://www.agnes-ai.com/zh-Hans/docs/agnes-video-25-flash */
export const isAgnesVideo25 = (model: string) => /^agnes-video-2\.5(?:-flash)?$/.test(model);

export function createAgnes25Body(input: Pick<GenerationInput, 'model' | 'prompt' | 'parameters'>, images: string[]) {
  const p = input.parameters || {}, flash = input.model === 'agnes-video-2.5-flash';
  const seconds = Number(p.seconds ?? 5), size = String(p.resolution ?? '720p').toUpperCase();
  if (!Number.isInteger(seconds) || seconds < 4 || seconds > 12) throw new ModelConfigError('Agnes Video 2.5 时长必须为 4–12 秒');
  if (!(flash ? ['720P'] : ['720P', '1080P', '1K', '2K']).includes(size))
    throw new ModelConfigError(flash ? 'Agnes Video 2.5 Flash 仅支持 720p' : 'Agnes Video 2.5 不支持所选分辨率');
  const ratio = String(p.aspect_ratio ?? '16:9');
  if (!['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'].includes(ratio)) throw new ModelConfigError('Agnes Video 2.5 不支持所选画幅');
  const keyframes = p.reference_mode === 'keyframes';
  if (keyframes && (images.length < 1 || images.length > 2)) throw new ModelConfigError('Agnes Video 2.5 首尾帧模式需要 1–2 张图片');
  if (!keyframes && images.length > (flash ? 5 : 8)) throw new ModelConfigError(`Agnes Video 2.5${flash ? ' Flash' : ''} 参考图最多 ${flash ? 5 : 8} 张`);
  return { model: input.model, prompt: input.prompt, seconds: String(seconds), size, aspect_ratio: ratio, n: 1,
    ...(Number.isSafeInteger(p.seed) && Number(p.seed) >= 0 ? { seed: p.seed } : {}),
    ...(keyframes ? { mode: 'keyframe', first_frame: images[0], ...(images[1] ? { last_frame: images[1] } : {}) }
      : images.length ? { mode: 'reference', images } : { mode: 'text' }),
  };
}
