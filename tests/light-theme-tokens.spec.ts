import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

test("one theme source owns both cold neutral token systems", () => {
  const entry = readFileSync("src/main.ts", "utf8");
  const theme = readFileSync("src/styles/theme.css", "utf8");
  expect(entry).toContain('import "./styles/theme.css"');
  for (const token of ["--ui-bg", "--ui-surface", "--ui-text", "--ui-muted", "--ui-border", "--ui-accent"])
    expect(theme).toContain(token);
  expect(theme).toContain("--ws-bg:var(--ui-bg)");
  expect(theme).toContain("body[data-theme]");
  expect(theme).toContain('body[data-theme="dark"]');
});

test("legacy stylesheet no longer owns home or workspace theme systems", () => {
  const legacy = readFileSync("src/style.css", "utf8");
  expect(legacy).not.toContain("Randomized dark home");
  expect(legacy).not.toContain("Canvas workspace — shared Viora mist / graphite theme");
  expect(legacy).not.toContain("--ws-bg:#0b1113");
  expect(legacy).not.toContain("--ws-bg:#eef3ef");
});

test("light theme explicitly covers every major product surface", () => {
  const theme = readFileSync("src/styles/theme.css", "utf8");
  for (const selector of [
    ".topbar", ".canvas-dock", ".flow-node", ".context-menu", ".workspace-panel",
    ".project-card", ".asset-library-panel", ".comic-chat-studio", ".comic-plan-side",
    ".feedback-modal", ".notification-modal", ".voice-config-panel", ".tts-config-panel",
    ".prompt-agent-panel", "#workspace-user-menu", "body[data-theme] .home-page",
  ]) expect(theme).toContain(selector);
});

test("light theme source contains no warm legacy palette", () => {
  const theme = readFileSync("src/styles/theme.css", "utf8").toLowerCase();
  for (const color of ["#f4f2ed", "#f7f7f4", "#fafaf9", "#e7e5df", "#fff0cf", "#e7ff70", "#d9ed70", "#dce96c"])
    expect(theme).not.toContain(color);
});

test("all node composers share the themed gradient and explicit selection contract", () => {
  const theme = readFileSync("src/styles/theme.css", "utf8");
  const imageSync = readFileSync("src/nodes/image-node-sync.ts", "utf8");
  const voiceSync = readFileSync("src/nodes/voice-node-sync.ts", "utf8");
  for (const selector of [
    ".image-config-panel", ".video-config-panel", ".voice-config-panel",
    ".tts-config-panel", ".node-config-panel",
  ]) expect(theme).toContain(selector);
  expect(theme).toContain("background-image:var(--ui-gradient-surface)!important");
  expect(theme).toContain('button[aria-pressed="true"]');
  expect(theme).toContain('button[aria-selected="true"]');
  expect(theme).toContain("user-select:none");
  expect(theme).toContain("button:not(.active):not([aria-selected=\"true\"]) > i");
  expect(theme).toContain('button:is(.active,[aria-selected="true"]) > i');
  expect(imageSync).toContain('button.setAttribute("aria-selected", String(selected))');
  expect(voiceSync).toContain('aria-selected="${item.id === voice.value}"');
});

test("the theme owns every visible card subcomponent", () => {
  const theme = readFileSync("src/styles/theme.css", "utf8");
  for (const selector of [
    ".node-floating-tools", ".image-empty-state", ".video-reference-slot",
    ".image-settings-popover", ".video-settings-popover", ".voice-settings-popover",
    ".video-result-prompt", ".model-price.free", ".audio-track-wave > i",
  ]) expect(theme).toContain(selector);
  expect(theme).toContain("Complete card component theme boundary");
  expect(theme).toContain("#node-layer :is(.image-config-panel");
  expect(theme).toContain(")[open] > summary.node-composer-option");
});

test("home and workspace boot status use the resolved body theme", () => {
  const theme = readFileSync("src/styles/theme.css", "utf8");
  const legacy = readFileSync("src/style.css", "utf8");
  expect(theme).toContain("body[data-theme] .workspace-boot-status");
  expect(theme).toContain("body[data-theme] .workspace-boot-status i");
  expect(legacy).not.toContain('.home-page[data-home-theme="dark"] .workspace-boot-status');
});

test("legacy stylesheet cannot theme the image composer or model picker", () => {
  const legacy = readFileSync("src/style.css", "utf8");
  for (const selector of [
    'body[data-theme="dark"] .image-config-panel {',
    'body[data-theme="dark"] .image-config-panel.image-composer-v2',
    'body[data-theme="dark"] .image-composer-v2 .image-model-picker',
    'body[data-theme="dark"] .image-composer-v2 .image-model-menu',
    'body[data-theme="dark"] .image-model-menu {',
  ]) expect(legacy).not.toContain(selector);
  expect(legacy).not.toContain('body[data-theme="dark"] .image-original-prompt');
  expect(readFileSync("src/styles/theme.css", "utf8")).toContain(
    "body:not(.home-mode)[data-theme] .image-original-prompt",
  );
});

test("image card thumbnails cover the card without theme-colored letterboxing", () => {
  const renderer = readFileSync("src/canvas/node-media-renderer.ts", "utf8");
  const draw = renderer.slice(renderer.indexOf("private drawImage"));
  expect(draw).toContain("const scale = Math.max(");
  expect(draw).not.toContain("const scale = Math.min(");
});
