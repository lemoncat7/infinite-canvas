/**
 * Honest fallback for providers that expose only a coarse running state.
 * The estimate is deliberately capped below completion and must be labelled
 * as estimated by every consumer.
 */
export function estimatedVideoProgress(
  startedAt: number,
  expectedMs: number,
  now = Date.now(),
) {
  const elapsed = Math.max(0, now - startedAt);
  const duration = Math.max(30_000, expectedMs);
  return Math.min(95, Math.max(1, Math.floor(5 + 90 * (1 - Math.exp(-elapsed / duration)))));
}

export function expectedVideoDuration(model: string) {
  return /2\.5.*flash|flash.*2\.5/i.test(model) ? 240_000 : 180_000;
}

export function timestampMilliseconds(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value))
    return value > 10_000_000_000 ? value : value * 1000;
  if (typeof value === "string" && value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric))
      return numeric > 10_000_000_000 ? numeric : numeric * 1000;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function exactProgress(value: unknown) {
  if (value === null || value === undefined || value === "") return undefined;
  const progress = Number(value);
  return Number.isFinite(progress)
    ? Math.max(0, Math.min(100, progress))
    : undefined;
}
