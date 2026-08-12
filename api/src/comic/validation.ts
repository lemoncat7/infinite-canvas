export type ComicValidationKind = "assets" | "scenes" | "shots";

export function normalizeComicDialogue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  const entries = Array.isArray(value) ? value : [value];
  return entries
    .map((entry) => {
      if (typeof entry === "string") return entry.trim();
      if (!entry || typeof entry !== "object") return "";
      const item = entry as Record<string, unknown>;
      const speaker = String(
        item.speaker || item.character || item.name || item.role || item.type || "",
      ).trim();
      const text = String(
        item.text || item.line || item.content || item.dialogue || item.words || "",
      ).trim();
      if (!text) return "";
      const normalizedSpeaker = /旁白|narrat/i.test(speaker) ? "旁白" : speaker;
      return normalizedSpeaker ? `${normalizedSpeaker}：${text}` : text;
    })
    .filter(Boolean)
    .join("\n");
}

export function estimateComicSpeechDuration(value: unknown) {
  const dialogue = normalizeComicDialogue(value);
  if (!dialogue || /^无对白/.test(dialogue))
    return { spokenCharacters: 0, utterances: 0, minimumSeconds: 3 };
  const utterances = dialogue
    .split(/\n+|(?<=[。！？!?])\s*(?=[^，。！？!?：:\s]{1,12}[：:])/) 
    .map((line) => line.trim())
    .filter(Boolean);
  const spokenCharacters = utterances.reduce((sum, line) => {
    const speech = line.replace(/^[^：:\n]{1,16}[：:]/, "");
    return sum + (speech.match(/[\p{Script=Han}A-Za-z0-9]/gu)?.length || 0);
  }, 0);
  return {
    spokenCharacters,
    utterances: utterances.length,
    minimumSeconds: Math.max(
      3,
      Math.ceil(spokenCharacters / 3.6 + Math.max(0, utterances.length - 1) * 0.35 + 1.2),
    ),
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

export function validateComicStage(value: Record<string, unknown>, kind: ComicValidationKind) {
  const issues: string[] = [];
  if (kind === "assets") {
    const characters = Array.isArray(value.characters) ? value.characters : [];
    const props = Array.isArray(value.props) ? value.props : [];
    characters.forEach((raw, index) => {
      const item = record(raw), prompt = String(item.imagePrompt || "");
      if (item.visualAsset !== false && !prompt) issues.push(`角色${index + 1}.imagePrompt 为空`);
      if (prompt.length > 420) issues.push(`角色${index + 1}.imagePrompt ${prompt.length}>420`);
      const forms = Array.isArray(item.forms) ? item.forms : [];
      forms.forEach((rawForm, formIndex) => {
        const formPrompt = String(record(rawForm).imagePrompt || "");
        if (!formPrompt) issues.push(`角色${index + 1}.forms[${formIndex}].imagePrompt 为空`);
        if (formPrompt.length > 420)
          issues.push(`角色${index + 1}.forms[${formIndex}].imagePrompt ${formPrompt.length}>420`);
      });
    });
    props.forEach((raw, index) => {
      const prompt = String(record(raw).imagePrompt || "");
      if (!prompt) issues.push(`道具${index + 1}.imagePrompt 为空`);
      if (prompt.length > 160) issues.push(`道具${index + 1}.imagePrompt ${prompt.length}>160`);
    });
  }
  if (kind === "scenes") {
    const scenes = Array.isArray(value.scenes) ? value.scenes : [];
    if (!scenes.length) issues.push("scenes 为空");
    const sceneIds = scenes.map((raw, index) => String(record(raw).sceneId || "").trim() || `scene-${index + 1}`);
    const knownSceneIds = new Set(sceneIds);
    if (knownSceneIds.size !== sceneIds.length) issues.push("场景 sceneId 重复");
    scenes.forEach((raw, index) => {
      const item = record(raw), prompt = String(item.imagePrompt || item.scenePrompt || "");
      if (!prompt) issues.push(`场景${index + 1}.imagePrompt 为空`);
      if (prompt.length > 160) issues.push(`场景${index + 1}.imagePrompt ${prompt.length}>160`);
      const baseSceneId = String(item.baseSceneId || "").trim();
      const variantType = String(item.variantType || (baseSceneId ? "area" : "base"));
      if (!["base", "area", "state", "time"].includes(variantType))
        issues.push(`场景${index + 1}.variantType 无效`);
      if (baseSceneId && (!knownSceneIds.has(baseSceneId) || baseSceneId === sceneIds[index]))
        issues.push(`场景${index + 1}.baseSceneId 无效`);
      if (variantType !== "base" && !baseSceneId) issues.push(`场景${index + 1}变体缺少 baseSceneId`);
    });
    for (const sceneId of sceneIds) {
      const visited = new Set([sceneId]);
      let current = sceneId;
      while (current) {
        const position = sceneIds.indexOf(current), parent = String(record(scenes[position]).baseSceneId || "").trim();
        if (!parent) break;
        if (visited.has(parent)) { issues.push(`场景${position + 1}父子关系循环`); break; }
        visited.add(parent);
        current = parent;
      }
    }
  }
  if (kind === "shots") {
    const shots = Array.isArray(value.shots) ? value.shots : [];
    if (!shots.length) issues.push("shots 为空");
    shots.forEach((raw, index) => {
      const item = record(raw), prompt = String(item.imagePrompt || "");
      if (!prompt) issues.push(`镜头${index + 1}.imagePrompt 为空`);
      if (prompt.length > 320) issues.push(`镜头${index + 1}.imagePrompt ${prompt.length}>320`);
      const scenePrompt = String(item.scenePrompt || "");
      if (!scenePrompt) issues.push(`镜头${index + 1}.scenePrompt 为空`);
      if (scenePrompt.length > 160) issues.push(`镜头${index + 1}.scenePrompt ${scenePrompt.length}>160`);
      if (!normalizeComicDialogue(item.dialogue)) issues.push(`镜头${index + 1}.dialogue 无法识别`);
      const videoPrompt = String(item.videoPrompt || "").trim();
      if (!videoPrompt) issues.push(`镜头${index + 1}.videoPrompt 为空`);
      if (videoPrompt.length > 125) issues.push(`镜头${index + 1}.videoPrompt 超过125字`);
      const duration = Math.max(3, Math.min(8, Number(item.duration) || 5));
      const speech = estimateComicSpeechDuration(item.dialogue);
      if (speech.minimumSeconds > 8)
        issues.push(`镜头${index + 1}.dialogue 预计至少需要 ${speech.minimumSeconds} 秒，必须拆成连续镜头`);
      else if (duration < speech.minimumSeconds)
        issues.push(`镜头${index + 1}.duration=${duration} 秒，最终对白与停顿至少需要 ${speech.minimumSeconds} 秒`);
      for (const field of ["transition", "continuity", "storyBeat"] as const)
        if (!String(item[field] || "").trim()) issues.push(`镜头${index + 1}.${field} 为空`);
      if (typeof item.hasAnonymousCrowd !== "boolean") issues.push(`镜头${index + 1}.hasAnonymousCrowd 必须为布尔值`);
      const crowdPrompt = String(item.crowdPrompt || "").trim();
      if (item.hasAnonymousCrowd === true && !crowdPrompt) issues.push(`镜头${index + 1}.crowdPrompt 为空`);
      if (item.hasAnonymousCrowd === false && crowdPrompt) issues.push(`镜头${index + 1}无匿名人群但 crowdPrompt 非空`);
      const frames = Array.isArray(item.frames) ? item.frames : [];
      if (!frames.length) issues.push(`镜头${index + 1}.frames 为空`);
      frames.forEach((rawFrame, frameIndex) => {
        const frame = record(rawFrame), framePrompt = String(frame.imagePrompt || "");
        if (!framePrompt) issues.push(`镜头${index + 1}.frames[${frameIndex}].imagePrompt 为空`);
        if (framePrompt.length > 0 && framePrompt.length < 100)
          issues.push(`镜头${index + 1}.frames[${frameIndex}].imagePrompt ${framePrompt.length}<100，缺少完整分镜约束`);
        if (framePrompt.length > 320)
          issues.push(`镜头${index + 1}.frames[${frameIndex}].imagePrompt ${framePrompt.length}>320`);
        if (!["start", "middle", "end"].includes(String(frame.keyframe)))
          issues.push(`镜头${index + 1}.frames[${frameIndex}].keyframe 无效`);
        for (const field of ["inherit", "change", "lock"] as const)
          if (!String(frame[field] || "").trim()) issues.push(`镜头${index + 1}.frames[${frameIndex}].${field} 为空`);
      });
    });
  }
  return issues;
}
