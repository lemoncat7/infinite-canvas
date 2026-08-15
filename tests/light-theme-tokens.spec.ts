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
  expect(theme).toContain('--ui-bg:#05090f');
  expect(theme).toContain('--ui-chrome-material:');
  expect(theme).toContain('radial-gradient(ellipse 66% 52% at 86% -10%');
});

test("workspace chrome and dialogue materials can evolve independently", () => {
  const theme = readFileSync("src/styles/theme.css", "utf8");
  const chrome = readFileSync("src/styles/workspace-chrome.css", "utf8");
  const inspiration = readFileSync("src/styles/inspiration.css", "utf8");
  const comic = readFileSync("src/styles/comic-studio.css", "utf8");
  for (const token of ["--ui-chrome-material", "--ui-inspiration-material", "--ui-comic-menu-material"])
    expect(theme).toContain(token);
  expect(chrome.match(/background-image:var\(--ui-chrome-material\)/g)).toHaveLength(2);
  expect(inspiration).toContain("background-image:var(--ui-inspiration-material)");
  expect(comic).toContain("background-image:var(--ui-comic-menu-material)");
  expect(comic).not.toContain("--comic-menu:");
  expect(chrome).not.toMatch(/--chrome-glass\s*:/);
});

test("comic studio owns one exact light and dark palette", () => {
  const comic = readFileSync("src/styles/comic-studio.css", "utf8");
  expect(comic).toContain('--comic-panel:rgba(238,244,249,.72)');
  expect(comic).toContain('body[data-theme="dark"]');
  expect(comic).toContain('--comic-panel:rgba(11,25,38,.95)');
  expect(comic).toContain('--comic-composer-surface:linear-gradient(145deg,rgba(47,70,90,.82),rgba(20,38,54,.88))');
  expect(comic).not.toContain('--comic-panel:color-mix');
});

test("legacy stylesheet no longer owns home or workspace theme systems", () => {
  const legacy = readFileSync("src/style.css", "utf8");
  expect(legacy).not.toContain("Randomized dark home");
  expect(legacy).not.toContain("Canvas workspace — shared Viora mist / graphite theme");
  expect(legacy).not.toContain("--ws-bg:#0b1113");
  expect(legacy).not.toContain("--ws-bg:#eef3ef");
  expect(legacy).toContain('.agent-capsule > article:not(.inspiration-result)');
  expect(legacy).not.toContain('.agent-capsule > article,.agent-capsule > select');
});

test("light theme explicitly covers every major product surface", () => {
  const theme = readFileSync("src/styles/theme.css", "utf8");
  const chrome = readFileSync("src/styles/workspace-chrome.css", "utf8");
  const comic = readFileSync("src/styles/comic-studio.css", "utf8");
  for (const selector of [
    ".topbar", ".flow-node", ".context-menu", ".workspace-panel",
    ".project-card", ".asset-library-panel",
    ".feedback-modal", ".notification-modal", ".voice-config-panel", ".tts-config-panel",
    ".prompt-agent-panel", "#workspace-user-menu", "body[data-theme] .home-page",
  ]) expect(theme).toContain(selector);
  expect(chrome).toContain(".canvas-dock");
  for (const selector of [".comic-chat-studio", ".comic-plan-side"]) expect(comic).toContain(selector);
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
  const renderer = readFileSync("src/canvas/thumbnail-surface-renderer.ts", "utf8");
  const style = readFileSync("src/style.css", "utf8");
  expect(renderer).toContain("target.style.backgroundImage");
  expect(style).toContain(".node-media-surface");
  expect(style).toContain("background-size:cover");
});
