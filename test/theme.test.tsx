import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ThemePicker } from "../src/client/components/ThemePicker.tsx";
import type { Prefs } from "../src/client/state/usePrefs.ts";

describe("the theme control", () => {
  function render(theme: Prefs["theme"]): string {
    return renderToStaticMarkup(
      <ThemePicker theme={theme} onUpdate={() => {}} onClose={() => {}} />,
    );
  }

  test("offers all four choices", () => {
    const html = render("system");
    expect(html).toContain("System");
    expect(html).toContain("Dark");
    expect(html).toContain("Light");
    expect(html).toContain("Glass");
  });

  test("marks the reader's stored choice as pressed, not the other three", () => {
    const html = render("light");
    const group = /<div role="group" aria-label="Theme"[^]*?<\/div>/.exec(html);
    expect(group).not.toBeNull();
    const pressed = [...group![0].matchAll(/aria-pressed="(true|false)"/g)].map(
      (m) => m[1],
    );
    // Order in THEMES is Dark, Light, Glass, System.
    expect(pressed).toEqual(["false", "true", "false", "false"]);
  });
});
