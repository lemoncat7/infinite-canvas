export function inferVoiceConfig(
  roleName: string,
  profile: string,
  description = "",
) {
  const evidence = `${roleName} ${profile} ${description}`,
    female = /(?:女|少女|女性|姐姐|母亲|奶奶|清脆女声|温柔女声)/.test(evidence),
    young = /(?:少年|少女|儿童|孩子|年轻|学生|十[二三四五六七八九]岁)/.test(
      evidence,
    ),
    intense = /(?:激昂|强势|愤怒|暴躁|反派|威严|战斗|洪亮)/.test(evidence),
    calm = /(?:低沉|稳重|沉稳|冷静|克制|旁白|老者|老人)/.test(evidence),
    fast = /(?:语速快|急促|活泼|轻快)/.test(evidence),
    slow = /(?:语速慢|缓慢|从容|低沉|沉稳)/.test(evidence);
  const voiceId = female
      ? "zh-CN-XiaoxiaoNeural"
      : young
        ? "zh-CN-YunxiaNeural"
        : intense
          ? "zh-CN-YunjianNeural"
          : "zh-CN-YunyangNeural",
    defaultSpeed = fast
      ? 1.08
      : slow
        ? 0.92
        : roleName === "系统播报"
          ? 0.95
          : 1,
    pitch = female ? (young ? 4 : 2) : young ? 3 : calm ? -3 : intense ? -1 : 0,
    volume = intense ? 1.08 : roleName === "旁白" ? 1.03 : 1;
  return {
    voiceId,
    voiceSpeed: defaultSpeed,
    voicePitch: pitch,
    voiceVolume: volume,
  };
}
