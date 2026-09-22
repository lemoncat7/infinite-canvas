# Accepted video task tracking

Agnes and OpenAI-compatible video adapters distinguish a **failed query** from an
**explicitly failed upstream task**. Once an ID is accepted, network errors,
rate limits, HTTP errors and incomplete query responses defer tracking rather
than failing/refunding the generation. The existing adapter timeout is now a
worker slice limit, not an upstream task deadline.

- The queue keeps the job `running`, preserves progress and credits, and exposes
  a retry explanation in `error`. Retries back off from 15 seconds to 5 minutes;
  longer credential cooldowns are respected. Waiting jobs release their worker.
- Accepted ID, adapter and actual credential are encrypted with the existing
  model encryption key in `video_task_checkpoints`, separate from public job
  rows. Keep `model-config.key` together with database backups.
- Startup resumes checkpointed running jobs. Resume skips image preparation and
  submission, and restores the original credential even with multiple Keys.
- A completed video whose asset download fails also retains its checkpoint and
  is queried/downloaded again, without requesting another generation.
- Cancellation stops further polling. A request already in flight may finish,
  but cannot reactivate the canceled job.

No retry-count cutoff discards an accepted task. Persistent invalid credentials
or unavailable task endpoints remain pending until repaired or canceled.
Creation timeouts without a returned ID are still ambiguous and are **never
automatically resubmitted**. Old failed jobs lacking checkpoints are not migrated
or regenerated automatically. Existing confirmed image-download-failure fallback
is unchanged for an uninterrupted execution; resumed jobs conservatively do not
resubmit a failed task.

Regression command: `cd api && npm run test:tracking`.
