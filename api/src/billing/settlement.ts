import { database, getOne } from "../storage/database.js";

export function settleJobCredits(jobId: string, succeeded: boolean) {
  const job = getOne(
      "SELECT user_id, credit_cost, credit_settled FROM jobs WHERE id = ?",
      [jobId],
    ),
    cost = Number(job?.credit_cost ?? 0);
  if (!job || !cost || Boolean(job.credit_settled)) return;
  database.run(
    "UPDATE users SET reserved_credits = MAX(0,reserved_credits - ?), credits = MAX(0,credits - ?) WHERE id = ?",
    [cost, succeeded ? cost : 0, String(job.user_id)],
  );
  database.run("UPDATE jobs SET credit_settled = 1 WHERE id = ?", [jobId]);
}
