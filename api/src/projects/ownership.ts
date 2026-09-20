import { getOne } from "../storage/database.js";

export function ownsProject(projectId: string, userId: string) {
  return Boolean(
    getOne("SELECT id FROM projects WHERE id = ? AND user_id = ?", [
      projectId,
      userId,
    ]),
  );
}
