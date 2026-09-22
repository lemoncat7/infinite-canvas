import assert from "node:assert/strict";
import { agnesResponseError } from '../dist/providers/agnes-errors.js';
import { safeModelError } from '../dist/models/errors.js';
import { createAgnes25Body } from '../dist/providers/agnes-video-v25.js';
import {
  createAgnesRequestBody,
  normalizeAgnesSettings,
} from "../dist/providers/agnes-video.js";

const vertical = normalizeAgnesSettings({
  seconds: 5,
  resolution: "480p",
  aspect_ratio: "9:16",
  seed: 42,
  num_inference_steps: 30,
  negative_prompt: "subtitle, watermark",
});
assert.deepEqual(vertical, {
  width: 448,
  height: 832,
  num_frames: 121,
  frame_rate: 24,
  seed: 42,
  num_inference_steps: 30,
  negative_prompt: "subtitle, watermark",
});

const portrait = normalizeAgnesSettings({ resolution: "720p", aspect_ratio: "3:4" });
assert.equal(portrait.width, 720);
assert.equal(portrait.height, 960);

const long1080p = normalizeAgnesSettings({ seconds:15, resolution:"1080p", aspect_ratio:"16:9" });
assert.equal(long1080p.num_frames, 241);
assert.equal(long1080p.frame_rate, 16);
assert.equal(long1080p.num_frames % 8, 1);

const input = {
  internalJobId: "test",
  projectId: "project",
  nodeId: 1,
  kind: "video",
  model: "agnes-video-v2.0",
  prompt: "Xiao Lie maintains spear pressure while Lin Yuan slides backward.",
};
const keyframes = JSON.parse(createAgnesRequestBody(
  input,
  ["https://cdn.test/1.png", "https://cdn.test/2.png"],
  vertical,
  "agnes-video-v2.0",
  "keyframes",
));
assert.equal(keyframes.mode, undefined);
assert.equal(keyframes.extra_body.mode, "keyframes");
assert.deepEqual(keyframes.extra_body.image, ["https://cdn.test/1.png", "https://cdn.test/2.png"]);
assert.match(keyframes.prompt, /Image 1 → Image 2/);
assert.doesNotMatch(keyframes.prompt, /Do not invent intermediate events/);
assert.equal(keyframes.negative_prompt, "subtitle, watermark");

const imageToVideo = JSON.parse(createAgnesRequestBody(
  input,
  ["https://cdn.test/1.png"],
  normalizeAgnesSettings({ seconds: 3 }),
  "agnes-video-v2.0",
  "references",
));
assert.equal(imageToVideo.mode, "ti2vid");
assert.equal(imageToVideo.image, "https://cdn.test/1.png");
assert.equal(imageToVideo.extra_body, undefined);

console.log("Agnes video adapter: official request mapping passed");

const forbidden = agnesResponseError(400, { code: 'invalid_request', message: 'width is a forbidden field (secret upstream body)', data: { param: 'width' } }, 'create');
assert.match(forbidden.message, /HTTP 400.*invalid_request.*width/);
assert.match(forbidden.message, /参数校验失败/);
assert.doesNotMatch(forbidden.message, /secret upstream/);
assert.equal(safeModelError(forbidden), forbidden);
assert.match(safeModelError(new Error('width is a forbidden field')).message, /参数校验失败/);
assert.match(safeModelError(new Error('auth_unavailable: no auth available')).message, /上游模型渠道/);
assert.match(agnesResponseError(500, { error: 'no auth available' }, 'create').message, /上游模型渠道/);
assert.match(agnesResponseError(403, { error: 'permission denied' }, 'create').message, /拒绝认证或权限/);
assert.doesNotMatch(agnesResponseError(422, { code: 'https://secret.test/key', data: { param: 'Bearer secret' } }, 'poll').message, /secret/);
assert.match(agnesResponseError(400, { code: 'invalid_request', message: 'invalid mode', data: { param: 'mode' } }, 'create').message, /字段 mode/);
console.log('Agnes errors: parameter rejection, upstream auth resources and secret redaction passed');

const flash = { ...input, model: 'agnes-video-2.5-flash', parameters: { seconds: 5, resolution: '720p', aspect_ratio: '16:9', reference_mode: 'references', negative_prompt: 'legacy field' } };
const modern = JSON.parse(createAgnesRequestBody(flash, ['data:image/png;base64,test'], vertical, 'agnes-video-v2.0', 'references'));
assert.equal(modern.mode, 'reference');
assert.deepEqual(modern.images, ['data:image/png;base64,test']);
assert.equal(modern.seconds, '5');assert.equal(modern.size, '720P');
for (const field of ['width', 'height', 'num_frames', 'frame_rate', 'image', 'negative_prompt', 'extra_body']) assert.equal(modern[field], undefined);
assert.equal(createAgnes25Body(flash, []).mode, 'text');
const frame = createAgnes25Body({ ...flash, parameters: { reference_mode: 'keyframes' } }, ['first', 'last']);
assert.equal(frame.mode, 'keyframe');assert.equal(frame.first_frame, 'first');assert.equal(frame.last_frame, 'last');assert.equal(frame.images, undefined);
assert.equal(createAgnes25Body({ ...flash, parameters: { reference_mode: 'keyframes' } }, ['first']).first_frame, 'first');
assert.equal(createAgnes25Body(flash, ['a','b','c','d','e']).images.length, 5);
assert.throws(() => createAgnes25Body(flash, ['a','b','c','d','e','f']), /最多 5/);
assert.throws(() => createAgnes25Body({ ...flash, parameters: { resolution: '1080p' } }, []), /仅支持 720p/);
assert.throws(() => createAgnes25Body({ ...flash, parameters: { seconds: 3 } }, []), /4–12/);
assert.throws(() => createAgnes25Body({ ...flash, parameters: { reference_mode: 'keyframes' } }, ['a','b','c']), /1–2/);
console.log('Agnes Video 2.5 Flash: official text/reference/keyframe contract and legacy field exclusion passed');
