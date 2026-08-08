import type {
  TtsCapabilities,
  TtsProvider,
  TtsSynthesisInput,
  TtsSynthesisResult,
  TtsStreamResult,
  TtsVoice,
} from "./tts-types.js";

const voices: TtsVoice[] = [
  { id: "zh-CN-XiaoxiaoNeural", name: "晓晓 · 温暖女声", language: "zh-CN", gender: "female" },
  { id: "zh-CN-XiaoyiNeural", name: "晓伊 · 活泼女声", language: "zh-CN", gender: "female" },
  { id: "zh-CN-YunjianNeural", name: "云健 · 激昂男声", language: "zh-CN", gender: "male" },
  { id: "zh-CN-YunxiNeural", name: "云希 · 阳光男声", language: "zh-CN", gender: "male" },
  { id: "zh-CN-YunxiaNeural", name: "云夏 · 少年男声", language: "zh-CN", gender: "male" },
  { id: "zh-CN-YunyangNeural", name: "云扬 · 稳重男声", language: "zh-CN", gender: "male" },
  { id: "zh-CN-liaoning-XiaobeiNeural", name: "晓北 · 辽宁女声", language: "zh-CN", gender: "female" },
  { id: "zh-CN-shaanxi-XiaoniNeural", name: "晓妮 · 陕西女声", language: "zh-CN", gender: "female" },
];

const legacyVoiceMap: Record<string, string> = {
  zf_xiaoxiao: "zh-CN-XiaoxiaoNeural",
  zf_xiaoyi: "zh-CN-XiaoyiNeural",
  zf_xiaobei: "zh-CN-liaoning-XiaobeiNeural",
  zf_xiaoni: "zh-CN-shaanxi-XiaoniNeural",
  zm_yunxi: "zh-CN-YunxiNeural",
};

export class LocalEasyVoiceTtsProvider implements TtsProvider {
  readonly id = "easyvoice-local";
  constructor(private readonly baseUrl = process.env.TTS_BASE_URL || "http://easyvoice:3000") {}

  async capabilities(): Promise<TtsCapabilities> {
    let available = false;
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/tts/engines`, {
        signal: AbortSignal.timeout(2500),
      });
      available = response.ok;
    } catch {
      available = false;
    }
    return {
      provider: this.id,
      name: "EasyVoice 中文语音",
      available,
      local: true,
      streaming: true,
      formats: ["mp3"],
      emotion: false,
      voiceCloning: false,
    };
  }

  async voices(): Promise<TtsVoice[]> {
    const response = await fetch(`${this.baseUrl}/api/v1/tts/engines`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`EasyVoice 语音服务不可用（${response.status}）`);
    return voices;
  }

  private async requestSpeech(input: TtsSynthesisInput) {
    const voiceId = legacyVoiceMap[input.voiceId] || input.voiceId;
    const emotionRate = ({ 冷静: 0.95, 温柔: 0.92, 紧张: 1.08, 激动: 1.12, 沉重: 0.88 } as Record<string, number>)[input.emotion || ""] || 1;
    const speed = Math.max(0.5, Math.min(2, input.speed * emotionRate));
    const rate = `${speed >= 1 ? "+" : ""}${Math.round((speed - 1) * 100)}%`;
    const pitch = Math.max(-50, Math.min(50, Number(input.pitch) || 0));
    const volume = Math.max(0, Math.min(2, Number(input.volume) || 1));
    const response = await fetch(`${this.baseUrl}/api/v1/tts/createStream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: input.text,
        voice: voiceId,
        rate,
        pitch: `${pitch >= 0 ? "+" : ""}${Math.round(pitch)}Hz`,
        volume: `${volume >= 1 ? "+" : ""}${Math.round((volume - 1) * 100)}%`,
        useLLM: false,
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(detail || `EasyVoice 语音生成失败（${response.status}）`);
    }
    return response;
  }

  async synthesizeStream(input: TtsSynthesisInput): Promise<TtsStreamResult> {
    const response = await this.requestSpeech(input);
    if (!response.body) throw new Error("EasyVoice 未返回音频流");
    return { stream: response.body, mimeType: "audio/mpeg" };
  }

  async synthesize(input: TtsSynthesisInput): Promise<TtsSynthesisResult> {
    const response = await this.requestSpeech(input);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) throw new Error("EasyVoice 返回了空音频");
    return { bytes, mimeType: "audio/mpeg", duration: 0 };
  }
}

export function resolveEasyVoiceId(id: string) {
  return legacyVoiceMap[id] || id;
}
