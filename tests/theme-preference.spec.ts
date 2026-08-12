import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

test("automatic theme follows local daytime boundaries", () => {
  const source = readFileSync("src/services/theme-preference.ts", "utf8");
  expect(source).toContain("hour >= DAY_START_HOUR && hour < NIGHT_START_HOUR");
  expect(source).toContain("const DAY_START_HOUR = 7");
  expect(source).toContain("const NIGHT_START_HOUR = 19");
});

test("theme preference supports auto and persistent manual overrides", () => {
  const source = readFileSync("src/services/theme-preference.ts", "utf8");
  expect(source).toContain('export type ThemePreference = "auto" | Theme');
  expect(source).toContain('const STORAGE_KEY = "flow-theme-preference"');
  expect(source).toContain('localStorage.setItem(STORAGE_KEY, preference)');
  expect(source).toContain('const order: ThemePreference[] = ["auto", "light", "dark"]');
  expect(source).toContain('document.addEventListener("visibilitychange"');
});

test("home and workspace share the resolved theme without randomization", () => {
  const source = readFileSync("src/services/theme-preference.ts", "utf8");
  const route = readFileSync("src/app/workspace-route-controller.ts", "utf8");
  expect(source).toContain("document.body.dataset.theme = next");
  expect(source).toContain("document.body.dataset.homeTheme = next");
  expect(route).not.toContain("randomizeTheme");
});
