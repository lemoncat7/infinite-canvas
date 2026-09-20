import { gunzipSync, gzipSync } from "node:zlib";
import { database, getAll } from "../storage/database.js";

export function encodeCanvasBatchResponse(value: unknown) {
  const json = typeof value === "string" ? value : JSON.stringify(value);
  if (json.length < 1024 || json.startsWith("gz:")) return json;
  return `gz:${gzipSync(Buffer.from(json), { level: 6 }).toString("base64")}`;
}

export function decodeCanvasBatchResponse(value: string) {
  const json = value.startsWith("gz:")
    ? gunzipSync(Buffer.from(value.slice(3), "base64")).toString("utf8")
    : value;
  return JSON.parse(json);
}

export function compactCanvasSyncHistory(onlyProjectId?: string) {
  let changed = 0;
  const projects = onlyProjectId
    ? getAll(
        "SELECT project_id AS projectId,version FROM project_canvases WHERE project_id=?",
        [onlyProjectId],
      )
    : getAll(
        "SELECT project_id AS projectId,version FROM project_canvases",
        [],
      );
  for (const row of projects) {
    const projectId = String(row.projectId),
      cutoff = Math.max(1, (Number(row.version) || 1) - 200);
    database.run(
      "UPDATE project_canvases SET reset_version=MAX(reset_version,?) WHERE project_id=? AND reset_version<?",
      [cutoff, projectId, cutoff],
    );
    changed += database.getRowsModified();
    database.run(
      "DELETE FROM canvas_operations WHERE project_id=? AND version<?",
      [projectId, cutoff],
    );
    changed += database.getRowsModified();
    database.run(
      `DELETE FROM canvas_operation_batches WHERE rowid IN (
      SELECT rowid FROM (
        SELECT rowid,ROW_NUMBER() OVER(PARTITION BY project_id ORDER BY created_at DESC,rowid DESC) AS position
        FROM canvas_operation_batches WHERE project_id=?
      ) WHERE position>12
    )`,
      [projectId],
    );
    changed += database.getRowsModified();
  }
  return changed;
}
