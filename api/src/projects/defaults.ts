import { randomUUID } from "node:crypto";
import { database } from "../storage/database.js";

export function emptyCanvas() {
  return JSON.stringify({
    nodes: [],
    links: [],
    camera: { x: 0, y: 0, zoom: 1 },
  });
}

export function createDefaultProject(
  userId: string,
  now = new Date().toISOString(),
) {
  const id = randomUUID();
  database.run(
    "INSERT INTO projects (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    [id, userId, "未命名项目", now, now],
  );
  database.run(
    "INSERT INTO project_canvases (project_id, document, updated_at) VALUES (?, ?, ?)",
    [id, emptyCanvas(), now],
  );
  return id;
}
