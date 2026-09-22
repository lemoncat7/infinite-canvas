export type ModelKind = 'image' | 'video' | 'text'
export type ModelAdapter = 'openai-image' | 'openai-video' | 'agnes-image' | 'agnes-video' | 'openai-chat'
export type ModelPurpose = 'image' | 'video' | 'prompt' | 'comic'
export const adapterKinds: Record<ModelAdapter, ModelKind> = {
  'openai-image': 'image', 'openai-video': 'video', 'agnes-image': 'image', 'agnes-video': 'video', 'openai-chat': 'text',
}
export const purposeKinds: Record<ModelPurpose, ModelKind> = { image: 'image', video: 'video', prompt: 'text', comic: 'text' }
export type ModelCapabilities = {
  referenceImages: number; transparent: boolean; sizes: string[]; resolutions: string[]; aspectRatios: string[];
  minSeconds: number; maxSeconds: number;
}
export type ProviderConnection = { id: string; name: string; baseUrl: string; apiKey: string; apiKeys?: string[]; proxyUrl: string; enabled: boolean }
export type GlobalModel = {
  id: string; name: string; model: string; providerId: string; adapter: ModelAdapter; kind: ModelKind;
  enabled: boolean; order: number; creditCost: number; capabilities: ModelCapabilities; purposes?: ModelPurpose[];
}
export type ModelConfiguration = {
  revision: number; imported: boolean; schemaVersion?: number; providers: ProviderConnection[]; models: GlobalModel[];
  defaults: Partial<Record<ModelPurpose, string>>;
}
export type ResolvedModel = { revision: number; model: GlobalModel; connection: ProviderConnection }
export class ModelConfigError extends Error {
  constructor(message: string, readonly statusCode = 400) { super(message) }
}
