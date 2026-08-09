import assert from "node:assert/strict";
import { comicAssetNameMentioned, finalizeComicSceneDependencies, hasVisibleAnonymousCrowd } from "../dist/comic-validation.js";

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
];

const failures = cases.filter(([expected, evidence]) => hasVisibleAnonymousCrowd(evidence) !== expected);
if (failures.length) {
  console.error(JSON.stringify(failures, null, 2));
  process.exit(1);
}
console.log(`comic crowd validation: ${cases.length}/${cases.length} passed`);

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
console.log("comic multi-scene dependency validation: 4/4 passed");
