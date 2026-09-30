import type { FlowNode } from '../nodes/node-types'

export type GenerationStage = 'local_queue' | 'cloud_queue' | 'local_generation' | 'cloud_generation'

const stages = new Set<GenerationStage>(['local_queue', 'cloud_queue', 'local_generation', 'cloud_generation'])

export function resolvedGenerationStage(node: Pick<FlowNode, 'status' | 'progress' | 'model' | 'generationStage' | 'kind'>): GenerationStage | undefined {
  if (node.status !== 'queued' && node.status !== 'running') return undefined
  if (node.generationStage && stages.has(node.generationStage)) return node.generationStage
  if (node.status === 'queued') return 'local_queue'
  return node.kind === 'video' || node.model?.startsWith('agnes-') ? 'cloud_generation' : 'local_generation'
}

export function generationStageLabel(node: Pick<FlowNode, 'status' | 'progress' | 'model' | 'generationStage' | 'kind'>) {
  const stage = resolvedGenerationStage(node)
  if (!stage) return ''
  const label: Record<GenerationStage, string> = {
    local_queue: '本地排队',
    cloud_queue: '云端排队',
    local_generation: '本地生成',
    cloud_generation: '云端生成',
  }
  const progress = Number(node.progress ?? 0)
  return `${label[stage]}${stage.endsWith('generation') && progress > 0 ? ` ${Math.round(progress)}%` : ''}`
}
