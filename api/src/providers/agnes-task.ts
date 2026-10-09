/** Normalize task identity, including data-wrapped responses, without coercing malformed IDs. */
export type AgnesTask = {
  id?: string; task_id?: string; video_id?: string; status?: string; progress?: number;
  url?: string; seconds?: string; size?: string;
  created_at?: number | string; started_at?: number | string; completed_at?: number | string;
  internal_progress?: number; internal_status?: string;
  metadata?: { url?: string; size_mapping?: Record<string, unknown> };
  error?: { message?: string; code?: string } | string | null;
  message?: string; code?: string; data?: { param?: string };
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const taskId = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,255}$/.test(value.trim()) ? value.trim() : undefined;

export async function readAgnesTask(response: Response): Promise<AgnesTask> {
  let raw: unknown;
  try { raw = await response.json() } catch { return {} }
  const outer = object(raw), nested = object(outer.data);
  const payload = response.ok && !outer.error && (nested.status || nested.video_id || nested.task_id || nested.id)
    ? { ...outer, ...nested } : outer;
  return { ...payload, id: taskId(payload.id), task_id: taskId(payload.task_id), video_id: taskId(payload.video_id) } as AgnesTask;
}

export function agnesTaskIdentity(task: AgnesTask) {
  if (task.error) return undefined;
  const id = task.video_id || task.task_id || task.id;
  return id ? { id, taskId: task.task_id || task.id || id } : undefined;
}
