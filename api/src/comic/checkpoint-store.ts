export type ComicGenerationCheckpoint = {
  fingerprint: string;
  story?: Record<string, unknown>;
  assets?: Record<string, unknown>;
  sceneBible?: Record<string, unknown>;
  shotPlan?: Record<string, unknown>;
  shots?: unknown[];
  completedBatches?: number;
  updatedAt?: string;
};

export function restoreComicCheckpoint(raw: unknown, fingerprint: string): ComicGenerationCheckpoint {
  try {
    const stored = JSON.parse(String(raw || "{}")) as ComicGenerationCheckpoint;
    if (stored.fingerprint === fingerprint) return stored;
  } catch {
    // A malformed checkpoint is isolated from the next production run.
  }
  return { fingerprint };
}

export function updateComicCheckpoint(
  current: ComicGenerationCheckpoint,
  patch: Partial<ComicGenerationCheckpoint>,
  fingerprint: string,
  updatedAt = new Date().toISOString(),
) {
  return { ...current, ...patch, fingerprint, updatedAt };
}
