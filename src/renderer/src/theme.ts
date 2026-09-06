export type ThemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "nearbox.theme";

export function readThemeMode(): ThemeMode {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") {
    return stored;
  }
  return "dark";
}

export function resolvedTheme(mode: ThemeMode): "light" | "dark" {
  if (mode !== "system") {
    return mode;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(mode: ThemeMode): "light" | "dark" {
  const resolved = resolvedTheme(mode);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.style.colorScheme = resolved;
  window.localStorage.setItem(STORAGE_KEY, mode);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", resolved === "dark" ? "#141414" : "#f4f4f4");
  }
  return resolved;
}

export function cycleTheme(mode: ThemeMode): ThemeMode {
  return mode === "system" ? "light" : mode === "light" ? "dark" : "system";
}

export function themeLabel(mode: ThemeMode): string {
  if (mode === "light") {
    return "浅色";
  }
  if (mode === "dark") {
    return "深色";
  }
  return "跟随系统";
}
