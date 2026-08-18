import { useEffect } from "react";
import type { Prefs } from "./usePrefs.ts";

export type ResolvedTheme = "dark" | "light";

/**
 * What the reader's pref actually renders as.
 *
 * Pure so it can be tested without a DOM: `system` is the only case that
 * needs an outside answer, and the caller supplies it rather than this
 * function reaching for `matchMedia` itself.
 */
export function resolveTheme(
  theme: Prefs["theme"],
  system: ResolvedTheme,
): ResolvedTheme {
  return theme === "system" ? system : theme;
}

function systemTheme(): ResolvedTheme {
  return matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

/**
 * Applies the reader's theme choice to the page.
 *
 * Resolves "system" here rather than in CSS, so `styles.css` only ever has to
 * carry one light palette under `:root[data-theme="light"]` instead of the
 * same values duplicated into a `@media (prefers-color-scheme)` block too —
 * one place to edit, nothing to keep in sync by hand.
 *
 * Also keeps the `theme-color` meta tag honest: without it, switching to
 * light leaves the browser chrome (address bar, task switcher card) tinted
 * for a page that no longer matches.
 */
export function useTheme(theme: Prefs["theme"]): void {
  useEffect(() => {
    const root = document.documentElement;

    const apply = () => {
      const resolved = resolveTheme(theme, systemTheme());
      root.dataset["theme"] = resolved;
      const meta = document.querySelector('meta[name="theme-color"]');
      const ground = getComputedStyle(root).getPropertyValue("--color-ground").trim();
      if (meta !== null && ground !== "") meta.setAttribute("content", ground);
    };

    apply();
    if (theme !== "system") return;

    // Only "system" needs to keep listening — an explicit choice does not
    // move when the OS theme does.
    const mql = matchMedia("(prefers-color-scheme: light)");
    mql.addEventListener("change", apply);
    return () => mql.removeEventListener("change", apply);
  }, [theme]);
}
