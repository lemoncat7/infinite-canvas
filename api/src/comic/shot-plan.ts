import { comicShotCapacity } from "../comic-validation.js";
import { normalizePlannedShot } from "./pipeline-policy.js";
import { estimateComicSpeechDuration } from "./validation.js";

type Item = Record<string, unknown>;
const compact = (value: unknown, max: number) => String(value || "").trim().slice(0, max);

export function compactComicFoundation(foundation: Item) {
  const records = (value: unknown) => Array.isArray(value) ? value : [];
  return {
    title: foundation.title, logline: foundation.logline, duration: foundation.duration,
    aspectRatio: foundation.aspectRatio, outline: foundation.outline,
    characters: records(foundation.characters).map((raw, index) => {
      const item = raw && typeof raw === "object" ? raw as Item : {};
      return { index:index + 1, name:item.name, description:item.description, voiceProfile:item.voiceProfile };
    }),
    props: records(foundation.props).map((raw, index) => {
      const item = raw && typeof raw === "object" ? raw as Item : {};
      return { index:index + 1, name:item.name, description:item.description };
    }),
    scenes: records(foundation.scenes).map((raw) => {
      const item = raw && typeof raw === "object" ? raw as Item : {};
      return { sceneId:item.sceneId || item.id, baseSceneId:item.baseSceneId, variantType:item.variantType,
        name:item.name, description:item.description || item.scene, propIndexes:item.propIndexes,
        environmentAnchors:item.environmentAnchors, imagePrompt:item.imagePrompt || item.scenePrompt };
    }),
  };
}

export function normalizeComicShotPlan(value: Item, outlineParts: readonly unknown[]) {
  const planned = Array.isArray(value.plannedShots) ? value.plannedShots : [];
  const normalized: Item[] = [];
  planned.forEach((raw, index) => {
    const item = raw && typeof raw === "object" ? { ...(raw as Item) } : {};
    const existingOutline = Number(item.outlineIndex);
    const outlineIndex = Number.isInteger(existingOutline) && existingOutline >= 1 && existingOutline <= outlineParts.length
      ? existingOutline
      : Math.min(Math.max(1, outlineParts.length), Math.floor(index * Math.max(1, outlineParts.length) / Math.max(1, planned.length)) + 1);
    const outline = outlineParts[outlineIndex - 1] as Item | undefined;
    const dialogue = String(item.dialogue || "").trim() || "无对白";
    const requestedDuration = Number(item.duration);
    item.number = index + 1; item.outlineIndex = outlineIndex;
    item.title = String(item.title || "").trim() || String(item.storyBeat || outline?.content || `镜头 ${index + 1}`).trim().slice(0, 18);
    item.storyBeat = compact(item.storyBeat, 38) || compact(outline?.content, 38);
    item.dialogue = dialogue;
    item.duration = Math.max(3, Math.min(8, Math.ceil(Math.max(Number.isFinite(requestedDuration) ? requestedDuration : 3, estimateComicSpeechDuration(dialogue).minimumSeconds))));
    item.transition = compact(item.transition, 12) || (index === 0 ? "黑场淡入" : "承接上一镜连续切入");
    const previous = normalized[index - 1];
    item.entryState = index > 0 ? compact(previous?.exitState, 30) || "承接上一镜结束状态" : compact(item.entryState || item.continuity, 30) || "故事开场状态";
    item.exitState = compact(item.exitState || item.storyBeat, 30);
    item.transitionAnchor = compact(item.transitionAnchor || item.transition, 18);
    Object.assign(item, normalizePlannedShot(item, index, previous));
    item.sceneView = ["main","reverse","left","right","top"].includes(String(item.sceneView)) ? String(item.sceneView) : "main";
    item.continuity = `入：${item.entryState}；出：${item.exitState}`;
    const changes = (Array.isArray(item.stateChanges) ? item.stateChanges : []).map((change) => compact(change, 18)).filter(Boolean).slice(0, 3);
    const evidence = `${item.storyBeat} ${item.transition} ${item.entryState} ${item.exitState}`;
    const complex = /变身|爆发|交锋|追逐|坠落|跃起|连续攻击|挥斩|对决|破裂|崩塌|建筑倒塌|状态连续变化/.test(evidence);
    const visible = /走向|走近|移动|起身|站起|坐下|跪下|落地|转身|抬起|抬手|拾起|推开|打开|关闭|拔出|递出|交给|击中|斩下|冲向|俯冲|切换地点|时间跳转|由.+变为/.test(evidence);
    const rawLevel = ["static","simple","complex"].includes(String(item.motionLevel)) ? String(item.motionLevel) : complex ? "complex" : visible ? "simple" : "static";
    const level = changes.length === 0 ? "static" : changes.length >= 3 || rawLevel === "complex" && changes.length >= 2 ? "complex" : changes.length >= 2 || rawLevel === "simple" ? "simple" : "static";
    item.motionLevel = level; item.stateChanges = changes;
    item.frameCount = level === "complex" ? Number(item.frameCount) === 4 && changes.length >= 3 ? 4 : 3 : level === "simple" ? 2 : 1;
    if (!Array.isArray(item.characterIndexes)) item.characterIndexes = [];
    if (!Array.isArray(item.propIndexes)) item.propIndexes = [];
    normalized.push(item);
  });
  return { ...value, plannedShots: normalized };
}

export function comicShotPlanIssues(value: Item, outlineCount: number, duration: unknown) {
  const planned = Array.isArray(value.plannedShots) ? value.plannedShots : [], issues: string[] = [];
  if (!planned.length) issues.push("plannedShots 为空");
  const capacity = comicShotCapacity(duration);
  if (planned.length > capacity) issues.push(`镜头数量 ${planned.length}>当前时长的安全容量 ${capacity}`);
  planned.forEach((raw, index) => {
    const item = raw && typeof raw === "object" ? raw as Item : {}, n = index + 1;
    if (!String(item.title || "").trim()) issues.push(`镜头${n}.title 为空`);
    if (!String(item.storyBeat || "").trim()) issues.push(`镜头${n}.storyBeat 为空`);
    const dialogue = String(item.dialogue || "").trim(), durationValue = Number(item.duration), speech = estimateComicSpeechDuration(dialogue);
    if (!dialogue) issues.push(`镜头${n}.dialogue 为空`);
    if (!Number.isInteger(durationValue) || durationValue < 3 || durationValue > 8) issues.push(`镜头${n}.duration 必须为3–8秒整数`);
    const frameCount = Number(item.frameCount), level = String(item.motionLevel || ""), changes = Array.isArray(item.stateChanges) ? item.stateChanges.filter(Boolean) : [];
    if (!Number.isInteger(frameCount) || frameCount < 1 || frameCount > 4) issues.push(`镜头${n}.frameCount 必须为1–4整数`);
    if (!["static","simple","complex"].includes(level)) issues.push(`镜头${n}.motionLevel 无效`);
    if (level === "static" && changes.length > 1) issues.push(`镜头${n} 静态镜头包含 ${changes.length} 项可见变化，应升级或拆镜`);
    if (level === "simple" && (changes.length < 1 || changes.length > 2)) issues.push(`镜头${n} 简单动作必须包含1–2项可见变化`);
    if (level === "complex" && changes.length < 2) issues.push(`镜头${n} 复杂动作至少需要2项可见变化`);
    if (speech.minimumSeconds > 8) issues.push(`镜头${n}对白预计需${speech.minimumSeconds}秒，必须拆镜`);
    else if (durationValue < speech.minimumSeconds) issues.push(`镜头${n}时长${durationValue}秒不足，至少需${speech.minimumSeconds}秒`);
    for (const field of ["transition","entryState","exitState","transitionAnchor","cameraAxis","shotPurpose","cameraMovement","effectState"])
      if (!String(item[field] || "").trim()) issues.push(`镜头${n}.${field} 为空`);
    const outlineIndex = Number(item.outlineIndex);
    if (!Number.isInteger(outlineIndex) || outlineIndex < 1 || outlineIndex > outlineCount) issues.push(`镜头${n}.outlineIndex 无效`);
  });
  for (let index = 1; index <= outlineCount; index++)
    if (!planned.some((raw) => Number(raw && typeof raw === "object" ? (raw as Item).outlineIndex : 0) === index)) issues.push(`剧情段落 ${index}/${outlineCount} 未被镜头覆盖`);
  return issues;
}
