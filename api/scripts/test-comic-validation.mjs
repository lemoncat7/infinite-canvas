import assert from "node:assert/strict";
import { comicAssetNameMentioned, comicCharacterStateTransitionIssues, comicPostureTransitionIssue, comicShotCapacity, finalizeComicSceneDependencies, hasVisibleAnonymousCrowd, normalizeComicAssetIndexes, normalizeComicCharacterStates, normalizeComicSceneHierarchy, resolveVisibleAnonymousCrowd } from "../dist/comic-validation.js";

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
