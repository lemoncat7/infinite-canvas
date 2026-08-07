import type {
  TtsCapabilities,
  TtsProvider,
  TtsSynthesisInput,
  TtsSynthesisResult,
  TtsVoice,
} from "./tts-types.js";

type LocalVoiceResponse = { voices?: Array<{ id?: string; name?: string }> };

export class LocalKokoroTtsProvider implements TtsProvider {
  readonly id = "kokoro-local";
  constructor(private readonly baseUrl = process.env.TTS_BASE_URL || "http://tts:8880") {}

  async capabilities(): Promise<TtsCapabilities> {
    let available = false;
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(2500),
      });
      available = response.ok;
    } catch {
      available = false;
    }
    return {
      provider: this.id,
      name: "本地 Kokoro",
      available,
      local: true,
      streaming: false,
      formats: ["wav", "mp3", "opus", "flac", "aac"],
      emotion: false,
      voiceCloning: false,
    };
  }

  async voices(): Promise<TtsVoice[]> {
    const response = await fetch(`${this.baseUrl}/v1/audio/voices`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`本地语音服务不可用（${response.status}）`);
    const payload = (await response.json()) as LocalVoiceResponse;
    return (payload.voices ?? []).map((voice) => {
      const id = String(voice.id || voice.name || "");
      return {
        id,
        name: localVoiceName(id),
        language: id.startsWith("z") ? "zh-CN" : undefined,
        gender: id.startsWith("zf_") ? "female" : id.startsWith("zm_") ? "male" : "neutral",
      };
    });
  }

  async synthesize(input: TtsSynthesisInput): Promise<TtsSynthesisResult> {
    const emotionRate = ({ 冷静: 0.95, 温柔: 0.92, 紧张: 1.08, 激动: 1.12, 沉重: 0.88 } as Record<string, number>)[input.emotion || ""] || 1;
    const effectiveSpeed = Math.max(0.5, Math.min(2, input.speed * emotionRate));
    const response = await fetch(`${this.baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "kokoro",
        input: input.text,
        voice: input.voiceId,
        speed: effectiveSpeed,
        response_format: input.format,
        lang_code: input.language === "zh-CN" ? "cmn" : input.language,
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(detail || `语音生成失败（${response.status}）`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) throw new Error("语音服务返回了空音频");
    const mimeType = response.headers.get("content-type")?.split(";")[0] || mimeForFormat(input.format);
    return { bytes, mimeType, duration: estimateDuration(bytes, input.format) };
  }
}

function localVoiceName(id: string) {
  const names: Record<string, string> = {
    zf_xiaoxiao: "晓晓 · 自然女声",
    zf_xiaobei: "小北 · 温柔女声",
    zf_xiaoni: "小妮 · 明亮女声",
    zf_xiaoyi: "小艺 · 沉静女声",
    zm_yunjian: "云健 · 稳重男声",
    zm_yunxi: "云希 · 青年男声",
    zm_yunxia: "云夏 · 清朗男声",
    zm_yunyang: "云扬 · 成熟男声",
  };
  return names[id] || id;
}

function mimeForFormat(format: TtsSynthesisInput["format"]) {
  return ({ wav: "audio/wav", mp3: "audio/mpeg", opus: "audio/opus", flac: "audio/flac", aac: "audio/aac" } as const)[format];
}

function estimateDuration(bytes: Buffer, format: TtsSynthesisInput["format"]) {
  if (format === "wav" && bytes.length > 44) return Math.max(0, (bytes.length - 44) / 48_000);
  return 0;
}
