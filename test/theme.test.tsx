import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Controls } from "../src/client/components/Controls.tsx";
import { GameMetaProvider } from "../src/client/state/gameMeta.tsx";
import type { Prefs } from "../src/client/state/usePrefs.ts";
import { metaFor } from "../src/shared/games.ts";

function prefs(theme: Prefs["theme"]): Prefs {
  return {
    region: "america",
    hiddenGames: [],
    focusGame: null,
    sort: "ending",
    view: "soon",
    timelineDayWidth: 32,
    timelineGroup: "game",
    showUpcoming: false,
    timelineSplitUpcoming: true,
    detectDaily: false,
    showCompleted: true,
    showIgnored: false,
    regionConfirmed: true,
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
          iconUpload={{ games: [], iconUrl: () => null, onUploaded: noop }}
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
    // Order in THEMES is Dark, Light, System.
    expect(pressed).toEqual(["false", "true", "false"]);
  });
});
