import { comicContinuityAuditIndexes } from "./pipeline-policy.js";

type Item = Record<string, unknown>;

export function comicAuditSubset(shots: readonly unknown[], batchSize: number, shotNumbers: readonly number[] = []) {
  return comicContinuityAuditIndexes(shots.length, batchSize, shotNumbers).map((index) => shots[index]);
}

export function applyComicAuditRepairs(shots: unknown[], repairs: readonly unknown[]) {
  const changed: number[] = [];
  for (const raw of repairs) {
    const repair = raw && typeof raw === "object" ? raw as Item : {};
    const number = Number(repair.shotNumber), target = shots[number - 1];
    if (!Number.isInteger(number) || !target || typeof target !== "object") continue;
    const shot = target as Item;
    for (const field of ["sceneId","scene","scenePrompt","imagePrompt","storyBeat","action","dialogue","videoPrompt","transition","continuity","exitState","transitionAnchor","cameraAxis"])
      if (String(repair[field] || "").trim()) shot[field] = String(repair[field]);
    for (const field of ["characterIndexes","characterForms","propIndexes"])
      if (Array.isArray(repair[field])) shot[field] = repair[field];
    if (Array.isArray(repair.frames) && repair.frames.length) shot.frames = repair.frames;
    changed.push(number);
  }
  return changed;
}
