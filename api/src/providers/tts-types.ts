export type TtsVoice = {
  id: string;
  name: string;
  language?: string;
  gender?: "female" | "male" | "neutral";
};

export type TtsCapabilities = {
  provider: string;
  name: string;
  available: boolean;
  local: boolean;
  streaming: boolean;
  formats: string[];
  emotion: boolean;
  voiceCloning: boolean;
};

export type TtsSynthesisInput = {
  text: string;
  voiceId: string;
  speed: number;
  format: "wav" | "mp3" | "opus" | "flac" | "aac";
  language?: string;
  emotion?: string;
};

export type TtsSynthesisResult = {
  bytes: Buffer;
  mimeType: string;
  duration: number;
};

export interface TtsProvider {
  readonly id: string;
  capabilities(): Promise<TtsCapabilities>;
  voices(): Promise<TtsVoice[]>;
  synthesize(input: TtsSynthesisInput): Promise<TtsSynthesisResult>;
}
