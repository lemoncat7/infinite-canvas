import assert from "node:assert/strict";
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
