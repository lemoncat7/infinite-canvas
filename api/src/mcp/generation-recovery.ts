import type { McpJob } from './generation-canvas.js';

/** Recovery is advisory: querying a job must never resubmit a paid generation. */
export function generationRecovery(job: McpJob) {
  if (['queued', 'running'].includes(job.status)) return {
    terminal: false, nextAction: 'poll_same_job', jobId: job.id, pollAfterMs: 5000,
    mayResubmit: false,
  };
  if (job.status === 'succeeded') return {
    terminal: true, nextAction: job.result_url ? 'retrieve_asset' : 'inspect_missing_result',
    jobId: job.id, mayResubmit: false,
  };
  if (['failed', 'canceled', 'cancelled'].includes(job.status)) return {
    terminal: true, nextAction: 'inspect_failure_before_retry', jobId: job.id, mayResubmit: false,
    message: 'Stop polling this terminal job. Keep its jobId and error as task evidence. Fix the reported cause and confirm upstream acceptance/billing before an explicitly authorized new attempt. A new requestId may create another paid job; replaying the old requestId does not restart this failed job. Never retry dependent jobs to repair this prerequisite.',
  };
  return { terminal: false, nextAction: 'inspect_unknown_status', jobId: job.id, mayResubmit: false };
}
