export type Point = { x: number; y: number };

export type NodeKind =
  | "prompt"
  | "image"
  | "video"
  | "note"
  | "voice"
  | "tts"
  | "audio";

export type PortSide = "top" | "right" | "bottom" | "left";

export type FlowNode = Point & {
  id: number;
  publicId?: string;
  kind: NodeKind;
  role?: "generator" | "result";
  sourceNodeId?: number;
  width: number;
  height: number;
  title: string;
  body: string;
  originalPrompt?: string;
  corePrompt?: string;
  promptProfile?:
    | "character"
    | "prop"
    | "scene"
    | "storyboard"
    | "composite"
    | "manual";
  styleConstraint?: string;
  formConstraint?: string;
  continuityConstraint?: string;
  crowdConstraint?: "required" | "forbidden";
  generationPrompt?: string;
  accent: string;
  model?: string;
  jobId?: string;
  progress?: number;
  status?: string;
  mediaUrl?: string;
  fontScale?: number;
  labelScroll?: number;
  agentAuto?: boolean;
  comicData?: unknown;
  imageSettings?: { size?: string; quality?: string; background?: string };
  videoSettings?: {
    seconds?: string;
    resolution?: string;
    aspectRatio?: string;
    referenceMode?: "keyframes" | "references";
    seed?: number;
  };
  videoResult?: {
    seconds?: string;
    size?: string;
    sizeMapping?: Record<string, unknown>;
    videoId?: string;
  };
  voiceSettings?: {
    providerId?: string;
    voiceId?: string;
    language?: string;
    defaultSpeed?: number;
    pitch?: number;
    volume?: number;
    roleName?: string;
    tone?: string;
  };
  ttsSettings?: {
    emotion?: string;
    speed?: number;
    volume?: number;
    format?: "wav" | "mp3" | "opus" | "flac" | "aac";
    duration?: number;
  };
};

export type FlowLink = {
  from: number;
  to: number;
  fromSide: PortSide;
  toSide: PortSide;
  inputOrder?: number;
};

export type GenerationCapabilities = {
  image?: {
    defaultModel: string;
    localFallback?: { model: string; available: boolean };
  };
  video?: {
    defaultModel: string;
    seconds: { min: number; max: number; default: number };
    resolutions: string[];
    aspectRatios: string[];
  };
};

export type TtsVoiceOption = {
  id: string;
  name: string;
  language?: string;
  gender?: string;
};

export type TtsProviderOption = {
  provider: string;
  name: string;
  available: boolean;
  local: boolean;
  streaming: boolean;
  formats: string[];
  emotion: boolean;
  voiceCloning: boolean;
};
