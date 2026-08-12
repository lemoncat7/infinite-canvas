export type Theme = "light" | "dark";
export type ThemePreference = "auto" | Theme;

const STORAGE_KEY = "flow-theme-preference";
const DAY_START_HOUR = 7;
const NIGHT_START_HOUR = 19;

export function automaticTheme(date = new Date()): Theme {
  const hour = date.getHours();
  return hour >= DAY_START_HOUR && hour < NIGHT_START_HOUR ? "light" : "dark";
}

export function storedThemePreference(storage: Pick<Storage, "getItem"> = localStorage): ThemePreference {
  const value = storage.getItem(STORAGE_KEY);
  return value === "light" || value === "dark" ? value : "auto";
}

export function resolveTheme(preference: ThemePreference, date = new Date()): Theme {
  return preference === "auto" ? automaticTheme(date) : preference;
}

export class ThemePreferenceController {
  private timer = 0;
  private listeners = new Set<(theme: Theme, preference: ThemePreference) => void>();
  preference = storedThemePreference();
  theme = resolveTheme(this.preference);

  constructor() {
    this.apply(false);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    window.addEventListener("storage", this.onStorage);
    this.schedule();
  }

  setPreference(preference: ThemePreference) {
    this.preference = preference;
    localStorage.setItem(STORAGE_KEY, preference);
    this.apply(true);
    this.schedule();
  }

  cycle() {
    const order: ThemePreference[] = ["auto", "light", "dark"];
    this.setPreference(order[(order.indexOf(this.preference) + 1) % order.length]);
  }

  subscribe(listener: (theme: Theme, preference: ThemePreference) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private apply(notify: boolean) {
    const next = resolveTheme(this.preference);
    this.theme = next;
    document.body.dataset.theme = next;
    document.body.dataset.homeTheme = next;
    document.querySelector<HTMLElement>("#home-page")?.setAttribute("data-home-theme", next);
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      "content", next === "dark" ? "#090d12" : "#f1f4f7",
    );
    if (notify)
      this.listeners.forEach((listener) => listener(next, this.preference));
  }

  private schedule() {
    window.clearTimeout(this.timer);
    if (this.preference !== "auto") return;
    const now = new Date();
    const next = new Date(now);
    next.setHours(now.getHours() < DAY_START_HOUR ? DAY_START_HOUR : now.getHours() < NIGHT_START_HOUR ? NIGHT_START_HOUR : DAY_START_HOUR + 24, 0, 0, 0);
    this.timer = window.setTimeout(() => { this.apply(true); this.schedule(); }, Math.max(1000, next.getTime() - now.getTime()));
  }

  private readonly onVisibilityChange = () => {
    if (!document.hidden && this.preference === "auto") { this.apply(true); this.schedule(); }
  };
  private readonly onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    this.preference = storedThemePreference(); this.apply(true); this.schedule();
  };
}

export const themePreference = new ThemePreferenceController();
