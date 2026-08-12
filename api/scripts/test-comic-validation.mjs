import assert from "node:assert/strict";
import { comicAssetNameMentioned, comicCharacterStateTransitionIssues, comicPostureTransitionIssue, comicShotCapacity, finalizeComicSceneDependencies, hasVisibleAnonymousCrowd, normalizeComicAssetIndexes, normalizeComicCharacterStates, normalizeComicSceneHierarchy, resolveVisibleAnonymousCrowd } from "../dist/comic-validation.js";
import { COMIC_SHOT_BATCH_SIZE, comicBatchWindow, comicContinuityAuditIndexes, comicShotBatches, completedShotCount, normalizePlannedShots } from "../dist/comic/pipeline-policy.js";
import { restoreComicCheckpoint, updateComicCheckpoint } from "../dist/comic/checkpoint-store.js";
import { comicGenerationErrorMessage, comicGenerationIssue } from "../dist/comic/error-policy.js";
import { estimateComicSpeechDuration, normalizeComicDialogue, validateComicStage } from "../dist/comic/validation.js";
import { repairComicStageUntilValid } from "../dist/comic/stage-repair.js";
import { compactComicFoundation, comicShotPlanIssues, normalizeComicShotPlan } from "../dist/comic/shot-plan.js";
import { comicAssetPrompt, comicAuditPrompt, comicSceneViewPrompt, comicShotExpansionPrompt, comicShotPlanPrompt, comicStoryPrompt } from "../dist/comic/prompts.js";
import { parseFirstJsonObject } from "../dist/comic/json.js";
import { ComicStreamState } from "../dist/comic/stream-state.js";
import { applyComicAuditRepairs, comicAuditSubset } from "../dist/comic/audit.js";

assert.equal(normalizeComicDialogue({ speaker:"Narrator", text:"夜幕降临" }), "旁白：夜幕降临");
assert.equal(normalizeComicDialogue([{ character:"林夜", line:"走。" }, { role:"苏晚", words:"好。" }]), "林夜：走。\n苏晚：好。");
assert.equal(estimateComicSpeechDuration("无对白，以脚步推进").minimumSeconds, 3);
assert.ok(estimateComicSpeechDuration("林夜：这是一段需要自然停顿并完整说出的中文对白。伏笔已经出现，我们必须立刻离开这里。苏晚：明白。小心身后。").minimumSeconds > 8);
assert.deepEqual(validateComicStage({ characters:[{ visualAsset:true, imagePrompt:"x".repeat(421) }], props:[] }, "assets"), ["角色1.imagePrompt 421>420"]);
assert.ok(validateComicStage({ scenes:[{ sceneId:"hall", variantType:"area", imagePrompt:"大厅" }] }, "scenes").includes("场景1变体缺少 baseSceneId"));
const invalidShotIssues = validateComicStage({ shots:[{ imagePrompt:"画面", scenePrompt:"场景", dialogue:"林夜：这段对白很短。", videoPrompt:"动作", hasAnonymousCrowd:false, crowdPrompt:"群众", frames:[] }] }, "shots");
assert.ok(invalidShotIssues.includes("镜头1无匿名人群但 crowdPrompt 非空"));
assert.ok(invalidShotIssues.includes("镜头1.frames 为空"));
console.log("comic stage validation behavior: 8/8 passed");

const repairEvents = [];
let repairCalls = 0;
const repaired = await repairComicStageUntilValid({
  stage:"资产",
  value:{ characters:[{ visualAsset:true, imagePrompt:"" }], props:[] },
  kind:"assets",
  system:"system",
  contextText:"context",
  progress:25,
  maxTokens:100,
  emit:(event) => repairEvents.push(event),
  readStage:async (_stage, _system, content) => {
    repairCalls++;
    assert.match(content, /角色1\.imagePrompt 为空/);
    return { characters:[{ visualAsset:true, imagePrompt:"完整设定" }], props:[] };
  },
});
assert.equal(repairCalls, 1);
assert.equal(repairEvents.length, 1);
assert.equal(repaired.characters[0].imagePrompt, "完整设定");
await assert.rejects(() => repairComicStageUntilValid({
  stage:"资产", value:{ characters:[{ visualAsset:true, imagePrompt:"" }], props:[] }, kind:"assets",
  system:"system", contextText:"context", progress:25, maxTokens:100, emit:()=>{}, maxRewrites:1,
  readStage:async () => ({ characters:[{ visualAsset:true, imagePrompt:"" }], props:[] }),
}), /资产复检仍有 1 项不合格/);
console.log("comic targeted stage repair: 4/4 passed");

const foundationSummary = compactComicFoundation({ title:"片名", characters:[{name:"林夜", imagePrompt:"很长提示"}], props:[{name:"古剑"}], scenes:[{sceneId:"hall", imagePrompt:"大厅"}] });
assert.deepEqual(foundationSummary.characters, [{ index:1, name:"林夜", description:undefined, voiceProfile:undefined }]);
assert.equal(foundationSummary.scenes[0].sceneId, "hall");
const normalizedPlan = normalizeComicShotPlan({ plannedShots:[
  { outlineIndex:1, storyBeat:"林夜停步", dialogue:"无对白", sceneId:"hall", stateChanges:[], exitState:"林夜站定" },
  { outlineIndex:2, storyBeat:"林夜走近古剑", dialogue:"林夜：剑在这里。", sceneId:"hall", stateChanges:["走近古剑"], exitState:"林夜站在剑旁" },
] }, [{content:"开场"},{content:"发现"}]);
assert.equal(normalizedPlan.plannedShots[0].frameCount, 1);
assert.equal(normalizedPlan.plannedShots[1].frameCount, 2);
assert.equal(normalizedPlan.plannedShots[1].entryState, "林夜站定");
assert.equal(normalizedPlan.plannedShots[1].cameraAxis, "保持左右关系与180度轴线");
assert.deepEqual(comicShotPlanIssues(normalizedPlan, 2, "30秒"), []);
const uncovered = comicShotPlanIssues({ plannedShots:[normalizedPlan.plannedShots[0]] }, 2, "30秒");
assert.ok(uncovered.includes("剧情段落 2/2 未被镜头覆盖"));
console.log("comic shot-plan domain behavior: 7/7 passed");

assert.match(comicStoryPrompt(), /禁止返回人物、道具、场景和 shots/);
assert.match(comicAssetPrompt(), /三视图/);
assert.match(comicSceneViewPrompt(), /main、reverse、top/);
assert.match(comicShotPlanPrompt(), /stateChanges/);
assert.match(comicShotExpansionPrompt(), /100–320字/);
assert.match(comicAuditPrompt(), /只修复确有硬错误/);
console.log("comic prompt builders: 6/6 passed");

assert.deepEqual(parseFirstJsonObject('```json\n{"text":"} inside","nested":{"ok":true}}\n```', "测试").value, { text:"} inside", nested:{ok:true} });
assert.equal(parseFirstJsonObject('{"ok":true} trailing', "测试").trailingLength, 8);
assert.throws(() => parseFirstJsonObject('{"ok":', "测试"), /不完整/);
console.log("comic JSON extraction: 3/3 passed");

const streamState = new ComicStreamState("primary");
streamState.addContent("中文");
assert.equal(streamState.receivedBytes, 6);
assert.equal(streamState.advance(12), 12);
assert.equal(streamState.advance(8), 12);
streamState.usedModel = "fallback";
assert.equal(streamState.usedModel, "fallback");
console.log("comic single stream state: 4/4 passed");

const auditShots = [{number:1,sceneId:"a",frames:[{title:"旧"}]},{number:2,sceneId:"a"},{number:3,sceneId:"a"},{number:4,sceneId:"b"}];
assert.deepEqual(comicAuditSubset(auditShots, 3), auditShots);
assert.deepEqual(applyComicAuditRepairs(auditShots, [{shotNumber:2,sceneId:"fixed",frames:[{title:"新"}]},{shotNumber:99,sceneId:"bad"}]), [2]);
assert.equal(auditShots[1].sceneId, "fixed");
assert.equal(auditShots[1].frames[0].title, "新");
console.log("comic audit repair behavior: 4/4 passed");

assert.equal(COMIC_SHOT_BATCH_SIZE, 3);
assert.deepEqual(comicShotBatches([1,2,3,4,5,6,7]), [[1,2,3],[4,5,6],[7]]);
assert.equal(completedShotCount(2, 7), 6);
assert.equal(completedShotCount(3, 7), 7);
const cinematic = normalizePlannedShots([
  { sceneId:"hall", cameraAxis:"A左B右", cameraMovement:"慢推", effectState:"剑光开始", shotPurpose:"环境建立" },
  { sceneId:"hall", cameraMovement:"任意飞行", effectState:"" },
  { sceneId:"yard", cameraMovement:"横移", effectState:"" },
]);
assert.equal(cinematic[1].cameraAxis, "A左B右");
assert.equal(cinematic[1].cameraMovement, "固定镜头");
assert.equal(cinematic[1].effectState, "剑光开始");
assert.equal(cinematic[2].effectState, "无特效");
assert.equal(cinematic[2].shotPurpose, "环境建立");
assert.throws(() => comicShotBatches([1], 0), RangeError);
assert.deepEqual(comicBatchWindow([1,2,3,4,5,6,7], 1), { expected:[4,5,6], neighbors:[3,4,5,6,7], start:3, end:6 });
assert.deepEqual(comicContinuityAuditIndexes(7), [0,1,2,3,4,5,6]);
assert.deepEqual(comicContinuityAuditIndexes(10, 3, [7]), [4,5,6,7,8]);
console.log("comic stable batching and cinematic locks: 13/13 passed");

const emptyCheckpoint = restoreComicCheckpoint("not-json", "current");
assert.deepEqual(emptyCheckpoint, { fingerprint:"current" });
assert.deepEqual(restoreComicCheckpoint(JSON.stringify({ fingerprint:"old", completedBatches:2 }), "current"), { fingerprint:"current" });
const restoredCheckpoint = restoreComicCheckpoint(JSON.stringify({ fingerprint:"current", completedBatches:2, shots:[1,2,3,4,5,6] }), "current");
assert.equal(restoredCheckpoint.completedBatches, 2);
const updatedCheckpoint = updateComicCheckpoint(restoredCheckpoint, { completedBatches:3 }, "current", "2026-08-12T00:00:00.000Z");
assert.equal(updatedCheckpoint.completedBatches, 3);
assert.equal(updatedCheckpoint.updatedAt, "2026-08-12T00:00:00.000Z");
console.log("comic checkpoint behavior: 5/5 passed");

assert.equal(comicGenerationIssue(new Error("对白时长超限"), 42, true).code, "E101");
assert.equal(comicGenerationIssue(new Error("场景引用丢失"), 72, true).code, "E301");
assert.equal(comicGenerationIssue(new Error("跨段连续性错误"), 95, true).code, "E401");
assert.match(comicGenerationErrorMessage(new SyntaxError("JSON损坏"), comicGenerationIssue(new SyntaxError("JSON损坏"), 20, false)), /已保留通过校验的阶段/);
console.log("comic error policy: 4/4 passed");


assert.equal(comicShotCapacity("约60秒"), 24);
assert.equal(comicShotCapacity("约2～3分钟"), 45);
assert.equal(comicShotCapacity("约8～10分钟"), 150);
assert.ok(comicShotCapacity("约8～10分钟") >= 100);
assert.ok(comicShotCapacity("约8～10分钟") > 51);
console.log("comic duration-aware shot capacity: 5/5 passed");

const standingShot = { number:1, characterIndexes:[1], frames:[{ imagePrompt:"江离停步立在黑棺旁", change:"江离停步警戒", lock:"江离站在左侧" }] };
const postureJump = { number:2, characterIndexes:[1,2], action:"江离靠近黑棺伸手按住棺盖", videoPrompt:"江离按住黑棺说话", frames:[{ imagePrompt:"江离在左侧俯身靠近", inherit:"江离立在棺旁", change:"准备伸手" }] };
assert.match(comicPostureTransitionIssue(standingShot, postureJump), /镜头 2.*缺少可见过渡动作/);
postureJump.action = "江离停步后走近黑棺，俯身伸手按住棺盖";
assert.equal(comicPostureTransitionIssue(standingShot, postureJump), "");
assert.equal(comicPostureTransitionIssue(standingShot, { ...postureJump, characterIndexes:[3] }), "");
console.log("comic posture continuity validation: 3/3 passed");

const state = (characterIndex, posture, positionAnchor, facingTarget, heldPropIndexes = [], transitionAction = "") => ({ characterIndex, posture, positionAnchor, facingTarget, heldPropIndexes, transitionAction });
const priorFrame = { characterStates:[state(1, "standing", "黑棺左侧", "prop:1", [1])] };
assert.match(comicCharacterStateTransitionIssues(priorFrame, { characterStates:[state(1, "crouching", "黑棺左侧", "prop:1", [1])] }, 2, 1)[0], /姿态.*transitionAction/);
assert.deepEqual(comicCharacterStateTransitionIssues(priorFrame, { characterStates:[state(1, "crouching", "黑棺左侧", "prop:1", [1], "停步后屈膝俯身")] }, 2, 1), []);
assert.match(comicCharacterStateTransitionIssues(priorFrame, { characterStates:[state(1, "standing", "黑棺左侧", "prop:1", [])] }, 2, 1)[0], /持有道具/);
assert.match(comicCharacterStateTransitionIssues(priorFrame, { characterStates:[state(1, "standing", "黑棺左侧", "character:2", [1])] }, 2, 1)[0], /朝向/);
assert.deepEqual(comicCharacterStateTransitionIssues(priorFrame, { characterStates:[state(2, "crouching", "院门", "camera")] }, 2, 1), []);
assert.deepEqual(normalizeComicCharacterStates([
  state(1, "STANDING", "黑棺左侧", "PROP:1", [1, 2, 2]),
  state(1, "crouching", "错误重复", "camera"),
  state(3, "standing", "画外", "camera"),
], [1, 2], [1]), [state(1, "standing", "黑棺左侧", "prop:1", [1])]);
assert.deepEqual(normalizeComicCharacterStates([
  [1, "WALKING", "黑棺左侧", "SCENE:院门", [1, 2], "停步后走近"],
], [1], [1]), [state(1, "walking", "黑棺左侧", "scene:院门", [1], "停步后走近")]);
console.log("comic structured character-state validation: 7/7 passed");

const cases = [
  [false, "古城空巷全景，无人物，禁止群众和路人。"],
  [false, "林渊单人站在石碑前，无路人群众。"],
  [false, "无人知道古老封印已经松动。"],
  [false, "白棠一人检查水渠，无群众无人物剪影。"],
  [false, "只出现林夜与萧烈，禁止背景人群。"],
  [false, "场景不包含围观者，远处只有残碑。"],
  [true, "匿名背景人群分散站立在练武场四周。"],
  [true, "数名路人围观残碑，随后向后退开。"],
  [true, "修士们聚集在山门外低声交谈。"],
  [true, "弟子们分散站立，看到剑光后惊呼。"],
  [true, "只生成苏尘、匿名修士观众与陨星黑色碎片相关展位。"],
  [true, "席间修士因灵压后退散开。"],
  [true, "拍卖厅观众席坐满各路买家。"],
];

const failures = cases.filter(([expected, evidence]) => hasVisibleAnonymousCrowd(evidence) !== expected);
if (failures.length) {
  console.error(JSON.stringify(failures, null, 2));
  process.exit(1);
}
console.log(`comic crowd validation: ${cases.length}/${cases.length} passed`);

assert.equal(resolveVisibleAnonymousCrowd(true, false, "六名竞拍修士分坐两侧", "近景压缩后未重复人群描述"), true);
assert.equal(resolveVisibleAnonymousCrowd(false, true, "匿名宾客错落落座", ""), true);
assert.equal(resolveVisibleAnonymousCrowd(false, false, "", "拍卖厅观众席坐满各路买家"), true);
assert.equal(resolveVisibleAnonymousCrowd(false, false, "", "无人知道苏尘已经抵达"), false);
console.log("comic crowd multi-signal resolution: 4/4 passed");

const props = [
  { name:"镇谷石碑" },
  { name:"祭坛火盆" },
  { name:"召唤后的天门与巨眼" },
  { name:"破碎后的封印核心" },
];
const scenes = [
  { sceneId:"valley", imagePrompt:"荒谷与镇谷石碑；天门位于上空。", propIndexes:[1,3], environmentAnchors:["镇谷石碑固定在左后方","天门位于正上空"] },
  { sceneId:"temple", imagePrompt:"地下神殿与祭坛火盆；封印核心悬浮中央。", propIndexes:[2,4], environmentAnchors:["祭坛火盆位于两侧","封印核心悬浮中央"] },
];
const shots = [
  { sceneId:"valley", scenePrompt:"旧", frames:[{ propIndexes:[1] }] },
  { sceneId:"temple", scenePrompt:"旧", frames:[{ propIndexes:[2] }] },
  { sceneId:"valley", scenePrompt:"旧", frames:[{ propIndexes:[1,3] }] },
  { sceneId:"temple", scenePrompt:"旧", frames:[{ propIndexes:[2,4] }] },
];
finalizeComicSceneDependencies(scenes, shots, props);
assert.deepEqual(scenes[0].propIndexes, [1]);
assert.deepEqual(scenes[1].propIndexes, [2]);
assert.doesNotMatch(scenes[0].imagePrompt, /天门|巨眼/);
assert.doesNotMatch(scenes[1].imagePrompt, /封印核心/);
assert.match(scenes[0].imagePrompt, /镇谷石碑/);
assert.match(scenes[1].imagePrompt, /祭坛火盆/);
assert.equal(shots[0].scenePrompt, scenes[0].imagePrompt);
assert.equal(shots[2].scenePrompt, scenes[0].imagePrompt);
assert.equal(shots[1].scenePrompt, scenes[1].imagePrompt);
assert.equal(shots[3].scenePrompt, scenes[1].imagePrompt);
assert.equal(comicAssetNameMentioned("青铜门与巨大眼睛首次开启", "远古青铜门与巨大眼睛"), true);
assert.deepEqual(normalizeComicAssetIndexes([3, 2, 3, 0, 8, "2"], 4), [3, 2]);
console.log("comic multi-scene dependency validation: 4/4 passed");

const hierarchy = [
  { sceneId:"city", variantType:"base", imagePrompt:"city", propIndexes:[], environmentAnchors:[] },
  { sceneId:"roof", baseSceneId:"city", variantType:"area", imagePrompt:"roof", propIndexes:[], environmentAnchors:[] },
  { sceneId:"ruins", baseSceneId:"city", variantType:"state", imagePrompt:"ruins", propIndexes:[], environmentAnchors:[] },
  { sceneId:"invalid", baseSceneId:"missing", variantType:"area", imagePrompt:"invalid", propIndexes:[], environmentAnchors:[] },
  { sceneId:"cycle-a", baseSceneId:"cycle-b", variantType:"area", imagePrompt:"a", propIndexes:[], environmentAnchors:[] },
  { sceneId:"cycle-b", baseSceneId:"cycle-a", variantType:"area", imagePrompt:"b", propIndexes:[], environmentAnchors:[] },
];
normalizeComicSceneHierarchy(hierarchy);
assert.equal(hierarchy[1].baseSceneId, "city");
assert.equal(hierarchy[2].variantType, "state");
assert.equal(hierarchy[3].baseSceneId, undefined);
assert.ok(!hierarchy[4].baseSceneId || !hierarchy[5].baseSceneId);
console.log("comic scene hierarchy validation: 4/4 passed");
