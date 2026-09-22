import { database, getOne, persist } from '../storage/database.js'
import { modelStore } from './config.js'
import { type AcceptedVideoTask, TrackingDeferred, TrackingStopped } from '../providers/task-tracking.js'

export function loadAcceptedTask(id: string) {
  const row = getOne('SELECT checkpoint FROM video_task_checkpoints WHERE job_id=?', [id])
  return row ? modelStore.secrets.open<AcceptedVideoTask>(String(row.checkpoint)) : undefined
}

export function saveAcceptedTask(id: string, task: AcceptedVideoTask) {
  database.run('INSERT OR REPLACE INTO video_task_checkpoints(job_id,checkpoint) VALUES (?,?)', [id, modelStore.secrets.seal(task)])
  persist()
}

export function checkTracking(id: string, stopping: boolean) {
  const status = getOne('SELECT status FROM jobs WHERE id=?', [id])?.status
  if (!status || !['queued', 'running'].includes(String(status))) throw new TrackingStopped()
  if (stopping) throw new TrackingDeferred()
}

/** A worker slice ended, not the upstream job. Keep credits reserved and release the slot. */
export function deferTracking(id: string, error: TrackingDeferred) {
  const row = getOne('SELECT retry_count FROM jobs WHERE id=?', [id])
  const retries = Number(row?.retry_count || 0) + 1
  const delay = Math.max(error.retryMs, Math.min(300000, 15000 * 2 ** Math.min(5, retries - 1)))
  database.run("UPDATE jobs SET status='running',error=?,retry_after=?,retry_count=?,updated_at=? WHERE id=? AND status IN ('queued','running')", [
    error.message, new Date(Date.now() + delay).toISOString(), retries, new Date().toISOString(), id,
  ])
  persist()
}

/** Only known accepted tasks are safe to resume. Never replay an ambiguous creation. */
export function recoverTracking() {
  database.run("UPDATE jobs SET retry_after=? WHERE status='running' AND id IN (SELECT job_id FROM video_task_checkpoints)", [new Date().toISOString()])
  persist()
}
