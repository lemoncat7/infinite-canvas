import { readFileSync } from "node:fs";
import initSqlJs from "sql.js";

const databasePath = process.argv[2];
if (!databasePath) throw new Error("usage: node scripts/audit-comic-plans.mjs <sqlite-file>");

const SQL = await initSqlJs();
const database = new SQL.Database(readFileSync(databasePath));
const result = database.exec(`
  SELECT id, project_id, plan, updated_at
  FROM comic_sessions
  WHERE generation_status='succeeded' AND plan IS NOT NULL
  ORDER BY updated_at DESC
`)[0];

const rows = result
  ? result.values.map((values) => Object.fromEntries(result.columns.map((column, index) => [column, values[index]])))
  : [];

const crowdTerm = "(?:匿名(?:背景)?(?:人物|人群|群众)|背景(?:人物|人群|群众)|路人群众|围观群众|群众|人群|路人|围观者|修士们?|弟子们?)";
const negativeCrowd = new RegExp(`(?:无|禁止|不得|不出现|没有|不包含)[^。；,，]{0,20}${crowdTerm}`, "g");
const positiveCrowd = /(?:匿名背景(?:人物|人群)|背景人群|围观群众|路人群|修士人群|众修士|弟子们)|(?:群众|人群|路人|围观者|修士们|弟子们)[^。；,，]{0,16}(?:聚集|围观|分散|站立|奔跑|后退|惊呼|交谈|涌入)/;

function visibleCrowd(evidence) {
  const normalized = String(evidence)
    .replace(negativeCrowd, "")
    .replace(/无人物|无人画面|单人|只出现[^。；,，]{0,18}/g, "")
    .replace(negativeCrowd, "");
  return positiveCrowd.test(normalized);
}

const audits = [];
for (const row of rows) {
  let plan;
  try { plan = JSON.parse(String(row.plan)); } catch { continue; }
  const shots = Array.isArray(plan.shots) ? plan.shots : [];
  const characters = Array.isArray(plan.characters) ? plan.characters : [];
  const props = Array.isArray(plan.props) ? plan.props : [];
  const issues = [];
  let expectedCrowds = 0;
  let storedCrowds = 0;
  let crowdMismatches = 0;
  for (const [shotIndex, shot] of shots.entries()) {
    const number = Number(shot.number) || shotIndex + 1;
    const frames = Array.isArray(shot.frames) ? shot.frames : [];
    const evidence = frames.map((frame) => `${frame.title || ""} ${frame.imagePrompt || ""} ${frame.inherit || ""} ${frame.change || ""}`).join(" ");
    const expectedCrowd = visibleCrowd(evidence);
    const storedCrowd = shot.hasAnonymousCrowd === true;
    if (expectedCrowd) expectedCrowds++;
    if (storedCrowd) storedCrowds++;
    if (expectedCrowd !== storedCrowd) {
      crowdMismatches++;
      issues.push(`镜头${number}: 群众保存值=${storedCrowd}，可见证据=${expectedCrowd}`);
    }
    if (expectedCrowd && !String(shot.crowdPrompt || "").trim()) issues.push(`镜头${number}: 群众镜头缺少 crowdPrompt`);
    if (!expectedCrowd && String(shot.crowdPrompt || "").trim()) issues.push(`镜头${number}: 无群众镜头残留 crowdPrompt`);
    if (String(shot.imagePrompt || "").length > 100) issues.push(`镜头${number}: imagePrompt 超过100字`);
    if (String(shot.videoPrompt || "").length > 125) issues.push(`镜头${number}: videoPrompt 超过125字`);
    if (String(shot.scenePrompt || "").length > 160) issues.push(`镜头${number}: scenePrompt 超过160字`);
    const duration = Math.max(0, Number(shot.duration) || 0);
    const dialogue = String(shot.dialogue || "");
    const spoken = dialogue === "无对白" ? "" : dialogue.replace(/[^\u3400-\u9fff]/g, "");
    const speechCapacity = Math.max(0, (duration - 1.2) * 3.6);
    if (spoken.length > speechCapacity + 2) issues.push(`镜头${number}: 对白约${spoken.length}字，${duration}秒容量不足`);
    if (!/(?:禁止字幕|无字幕|No subtitles)/i.test(String(shot.videoPrompt || ""))) issues.push(`镜头${number}: 视频提示词缺少字幕禁令`);
    for (const [frameIndex, frame] of frames.entries()) {
      const characterIndexes = Array.isArray(frame.characterIndexes) ? frame.characterIndexes : [];
      const propIndexes = Array.isArray(frame.propIndexes) ? frame.propIndexes : [];
      if (characterIndexes.some((index) => !Number.isInteger(index) || index < 1 || index > characters.length)) issues.push(`镜头${number}.${frameIndex + 1}: 人物索引越界`);
      if (propIndexes.some((index) => !Number.isInteger(index) || index < 1 || index > props.length)) issues.push(`镜头${number}.${frameIndex + 1}: 道具索引越界`);
      if (String(frame.imagePrompt || "").length > 100) issues.push(`镜头${number}.${frameIndex + 1}: 帧提示词超过100字`);
    }
    if (shotIndex > 0 && !String(shot.transition || "").trim()) issues.push(`镜头${number}: 缺少转场`);
    if (shotIndex > 0 && !String(shot.continuity || "").trim()) issues.push(`镜头${number}: 缺少连续性说明`);
  }
  audits.push({
    id: row.id,
    title: String(plan.title || "未命名"),
    updatedAt: row.updated_at,
    shots: shots.length,
    storedCrowds,
    expectedCrowds,
    crowdMismatches,
    issueCount: issues.length,
    issues: issues.slice(0, 20),
  });
}

console.log(JSON.stringify(audits, null, 2));
