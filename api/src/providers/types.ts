export type GenerationKind = 'image' | 'video'
export type GenerationStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export type GenerationInput = {
  internalJobId: string
  projectId: string
  nodeId: number
  kind: GenerationKind
  prompt: string
  model: string
  inputUrls?: string[]
  /** Owned originals are read lazily; never serialize this execution-only callback. */
  readInputAsDataUrl?: (index: number, proxyUrl?: string) => Promise<string>
  parameters?: Record<string, unknown>
}

export type GenerationUpdate = {
  status: GenerationStatus
  progress: number
  resultUrl?: string
  resultMetadata?: Record<string, unknown>
  error?: string
}

export interface GenerationProvider {
  readonly name: string
  readonly capabilities?: GenerationCapabilities
  referencePolicy?(model: string, kind: GenerationKind): ReferencePolicy
  run(input: GenerationInput, onUpdate: (update: GenerationUpdate) => void): Promise<GenerationUpdate>
}

export type ReferencePolicy = { preferred: 'url' | 'base64'; fallbackToBase64: boolean }

export type GenerationCapabilities = {
  image?: { provider: string; defaultModel: string }
  video?: { provider: string; defaultModel: string; seconds: { min: number; max: number; default: number }; resolutions: string[]; aspectRatios: string[] }
}
