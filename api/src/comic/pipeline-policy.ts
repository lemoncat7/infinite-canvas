export const COMIC_SHOT_BATCH_SIZE = 3;

export type PlannedShot = Record<string, unknown>;

export function comicShotBatches<T>(shots: readonly T[], size = COMIC_SHOT_BATCH_SIZE) {
  if (!Number.isInteger(size) || size < 1) throw new RangeError("镜头批次大小必须为正整数");
  const batches: T[][] = [];
  for (let index = 0; index < shots.length; index += size)
    batches.push(shots.slice(index, index + size));
  return batches;
}

export function normalizePlannedShot(
  raw: PlannedShot,
  index: number,
  previous?: PlannedShot,
) {
  const item = { ...raw }, compact = (value: unknown, max: number) => String(value || "").trim().slice(0, max),
    sameScene = Boolean(previous) && String(previous?.sceneId || "") === String(item.sceneId || ""),
    allowedMovements = ["固定镜头", "慢推", "慢拉", "横移", "跟拍", "摇镜", "升降"],
    requestedMovement = compact(item.cameraMovement, 8),
    previousEffect = compact(previous?.effectState, 24),
    requestedEffect = compact(item.effectState, 24);
  item.number = index + 1;
  item.cameraAxis = compact(item.cameraAxis, 20) ||
    (sameScene ? compact(previous?.cameraAxis, 20) : "") ||
    "保持左右关系与180度轴线";
  item.shotPurpose = compact(item.shotPurpose, 8) ||
    (index === 0 || !sameScene ? "环境建立" : "剧情推进");
  item.cameraMovement = allowedMovements.includes(requestedMovement)
    ? requestedMovement
    : "固定镜头";
  item.effectState = requestedEffect ||
    (sameScene && previousEffect !== "无特效" ? previousEffect : "无特效");
  return item;
}

export function normalizePlannedShots(shots: readonly PlannedShot[]) {
  const normalized: PlannedShot[] = [];
  shots.forEach((shot, index) => normalized.push(normalizePlannedShot(shot, index, normalized[index - 1])));
  return normalized;
}

export function completedShotCount(completedBatches: number, totalShots: number, batchSize = COMIC_SHOT_BATCH_SIZE) {
  return Math.min(totalShots, Math.max(0, completedBatches) * batchSize);
}

export function comicBatchWindow<T>(
  shots: readonly T[],
  batchIndex: number,
  batchSize = COMIC_SHOT_BATCH_SIZE,
) {
  const start = batchIndex * batchSize, end = Math.min(shots.length, start + batchSize);
  if (start < 0 || start >= shots.length) return { expected: [] as T[], neighbors: [] as T[], start, end };
  return {
    expected: shots.slice(start, end),
    neighbors: shots.slice(Math.max(0, start - 1), Math.min(shots.length, end + 1)),
    start,
    end,
  };
}

export function comicContinuityAuditIndexes(
  totalShots: number,
  batchSize = COMIC_SHOT_BATCH_SIZE,
  shotNumbers: readonly number[] = [],
) {
  const indexes = new Set<number>();
  if (shotNumbers.length) {
    for (const number of shotNumbers)
      for (let index = number - 3; index <= number + 1; index++)
        if (index >= 0 && index < totalShots) indexes.add(index);
  } else {
    [0, 1, totalShots - 2, totalShots - 1].forEach((index) => {
      if (index >= 0 && index < totalShots) indexes.add(index);
    });
    for (let boundary = batchSize; boundary < totalShots; boundary += batchSize)
      for (let index = boundary - 2; index <= boundary + 1; index++)
        if (index >= 0 && index < totalShots) indexes.add(index);
  }
  return [...indexes].sort((left, right) => left - right);
}
