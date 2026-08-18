import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Controls } from "../src/client/components/Controls.tsx";
import { GameMetaProvider } from "../src/client/state/gameMeta.tsx";
import { resolveTheme } from "../src/client/state/useTheme.ts";
import type { Prefs } from "../src/client/state/usePrefs.ts";
import { metaFor } from "../src/shared/games.ts";

/**
 * "system" is the only case `resolveTheme` cannot answer alone — it takes
 * what prefers-color-scheme says as an argument rather than reading
 * `matchMedia` itself, which is what makes it testable without a DOM.
 */
describe("resolveTheme", () => {
  test("an explicit choice ignores what the system says", () => {
    expect(resolveTheme("dark", "light")).toBe("dark");
    expect(resolveTheme("light", "dark")).toBe("light");
  });

  test("system takes whatever the system says", () => {
    expect(resolveTheme("system", "light")).toBe("light");
    expect(resolveTheme("system", "dark")).toBe("dark");
  });
});

function prefs(theme: Prefs["theme"]): Prefs {
  return {
    region: "america",
    hiddenGames: [],
    focusGame: null,
    sort: "ending",
    detectDaily: false,
    showCompleted: true,
    showIgnored: false,
    regionConfirmed: true,
    onboarded: true,
    theme,
  };
}

describe("the theme control", () => {
  const noop = () => {};
  const own = {
    games: {},
    events: {},
    lanes: [],
    onAddGame: noop,
    onEditGame: noop,
    onRemoveGame: () => ({ removed: false, blockedBy: 0 }),
    onAddEvent: noop,
  };

  function render(theme: Prefs["theme"]): string {
    return renderToStaticMarkup(
      <GameMetaProvider value={(id) => metaFor(id, {})}>
        <Controls
          games={["genshin"]}
          prefs={prefs(theme)}
          onToggleGame={noop}
          onUpdate={noop}
          ignoredCount={0}
          onExport={noop}
          onImport={noop}
          own={own}
        />
      </GameMetaProvider>,
    );
  }

  test("offers all three choices", () => {
    const html = render("system");
    expect(html).toContain("System");
    expect(html).toContain("Dark");
    expect(html).toContain("Light");
  });

  test("marks the reader's stored choice as pressed, not the other two", () => {
    const html = render("light");
    // The games and region groups render their own aria-pressed buttons too,
    // so scope to the theme group by its own aria-label rather than counting
    // positionally across the whole panel.
    const group = /<div role="group" aria-label="Theme"[^]*?<\/div>/.exec(html);
    expect(group).not.toBeNull();
    const pressed = [...group![0].matchAll(/aria-pressed="(true|false)"/g)].map(
      (m) => m[1],
    );
    // Order in THEMES is System, Dark, Light.
    expect(pressed).toEqual(["false", "false", "true"]);
  });
});
