import assert from "node:assert/strict";
import test from "node:test";
import { applyTheme, cycleTheme, readThemeMode, resolvedTheme, themeLabel } from "./theme.ts";

test("cycleTheme rotates system → light → dark → system", () => {
  assert.equal(cycleTheme("system"), "light");
  assert.equal(cycleTheme("light"), "dark");
  assert.equal(cycleTheme("dark"), "system");
});

test("themeLabel is Chinese UI copy", () => {
  assert.equal(themeLabel("light"), "浅色");
  assert.equal(themeLabel("dark"), "深色");
  assert.equal(themeLabel("system"), "跟随系统");
});

test("readThemeMode and resolvedTheme honour storage and prefers-color-scheme", () => {
  const store = new Map<string, string>();
  let prefersDark = true;
  const meta = {
    content: "",
    setAttribute(name: string, value: string) {
      if (name === "content") {
        this.content = value;
      }
    },
  };
  const docEl = {
    dataset: {} as Record<string, string>,
    style: { colorScheme: "" },
  };

  const previousWindow = (globalThis as { window?: unknown }).window;
  const previousDocument = (globalThis as { document?: unknown }).document;

  (globalThis as { window: unknown }).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    },
    matchMedia: () => ({ matches: prefersDark }),
  };
  (globalThis as { document: unknown }).document = {
    documentElement: docEl,
    querySelector: (sel: string) => (sel.includes("theme-color") ? meta : null),
  };

  try {
    assert.equal(readThemeMode(), "dark", "missing storage defaults to dark");
    store.set("nearbox.theme", "light");
    assert.equal(readThemeMode(), "light");
    store.set("nearbox.theme", "nope");
    assert.equal(readThemeMode(), "dark");

    assert.equal(resolvedTheme("light"), "light");
    assert.equal(resolvedTheme("dark"), "dark");
    prefersDark = true;
    assert.equal(resolvedTheme("system"), "dark");
    prefersDark = false;
    assert.equal(resolvedTheme("system"), "light");

    const resolved = applyTheme("system");
    assert.equal(resolved, "light");
    assert.equal(docEl.dataset.theme, "light");
    assert.equal(docEl.dataset.themeMode, "system");
    assert.equal(docEl.style.colorScheme, "light");
    assert.equal(store.get("nearbox.theme"), "system");
    assert.equal(meta.content, "#f4f4f4");

    applyTheme("dark");
    assert.equal(meta.content, "#141414");
  } finally {
    if (previousWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window: unknown }).window = previousWindow;
    }
    if (previousDocument === undefined) {
      delete (globalThis as { document?: unknown }).document;
    } else {
      (globalThis as { document: unknown }).document = previousDocument;
    }
  }
});
