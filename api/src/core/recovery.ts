import { settleJobCredits } from "../billing/settlement.js";
import {
  compactCanvasSyncHistory,
  encodeCanvasBatchResponse,
} from "../canvas/history.js";
import {
  availableUsername,
  database,
  getAll,
  newInviteCode,
  persist,
} from "../storage/database.js";
import { bootTime, developmentUserId } from "./config.js";

export function recoverApplication() {
  database.run(
    "UPDATE comic_sessions SET generation_status='interrupted', generation_stage='服务更新导致任务中断', generation_error='服务更新导致任务中断，请重新生成', updated_at=? WHERE generation_status='running'",
    [bootTime],
  );

  for (const job of getAll("SELECT id FROM jobs WHERE status = 'running'", []))
    settleJobCredits(String(job.id), false);

  database.run(
    "UPDATE jobs SET status = 'failed', progress = 0, error = ?, updated_at = ? WHERE status = 'running'",
    ["生成服务曾重启，任务已中断，请重新生成", bootTime],
  );

  database.run(
    "INSERT OR IGNORE INTO users (id, name, created_at) VALUES (?, ?, ?)",
    [developmentUserId, "开发用户", bootTime],
  );

  database.run(
    "UPDATE users SET username = ? WHERE id = ? AND (username IS NULL OR username = '')",
    ["mochen", developmentUserId],
  );

  database.run(
    "UPDATE users SET is_admin = 1 WHERE lower(username) = 'mochen'",
  );

  for (const user of getAll(
    "SELECT id, name FROM users WHERE username IS NULL OR username = ''",
    [],
  ))
    database.run("UPDATE users SET username = ? WHERE id = ?", [
      availableUsername(String(user.name || "user")),
      String(user.id),
    ]);

  for (const user of getAll(
    "SELECT id FROM users WHERE invite_code IS NULL OR invite_code = ?",
    [""],
  ))
    database.run("UPDATE users SET invite_code = ? WHERE id = ?", [
      newInviteCode(),
      String(user.id),
    ]);

  let compactedCanvasHistory = compactCanvasSyncHistory();

  for (const row of getAll(
    "SELECT rowid AS rowId,response FROM canvas_operation_batches WHERE length(response)>1024 AND response NOT LIKE 'gz:%'",
    [],
  )) {
    const encoded = encodeCanvasBatchResponse(String(row.response));
    if (encoded !== String(row.response)) {
      database.run(
        "UPDATE canvas_operation_batches SET response=? WHERE rowid=?",
        [encoded, Number(row.rowId)],
      );
      compactedCanvasHistory++;
    }
  }

  if (compactedCanvasHistory > 0) database.run("VACUUM");

  persist();
}
