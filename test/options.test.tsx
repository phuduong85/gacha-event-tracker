import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Controls } from "../src/client/components/Controls.tsx";
import { GameMetaProvider } from "../src/client/state/gameMeta.tsx";
import { metaFor } from "../src/shared/games.ts";
import type { Prefs } from "../src/client/state/usePrefs.ts";

/**
 * The settings panel's view filters.
 *
 * Three rows answer the same question — *what am I allowed to look at?* — and
 * they are the only place two of them can be reached from, so what they are
 * bound to is worth pinning. A checkbox wired to the wrong preference is
 * invisible in a diff and obvious only to the reader it happens to.
 */

const PREFS: Prefs = {
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
  theme: "dark",
  regionConfirmed: true,
};

function render(prefs: Prefs, ignoredCount = 0): string {
  return renderToStaticMarkup(
    <GameMetaProvider value={(id) => metaFor(id, {})}>
      <Controls
        games={["genshin", "hsr"]}
        prefs={prefs}
        onToggleGame={() => {}}
        onUpdate={() => {}}
        ignoredCount={ignoredCount}
        own={{
          games: {},
          events: {},
          lanes: ["genshin", "hsr"],
          onAddGame: () => {},
          onEditGame: () => {},
          onRemoveGame: () => ({ removed: true, blockedBy: 0 }),
          onAddEvent: () => {},
        }}
      />
    </GameMetaProvider>,
  );
}

/** The nth checkbox's `checked` attribute, in document order. */
function checkboxes(html: string): boolean[] {
  return [...html.matchAll(/<input type="checkbox"[^>]*>/g)].map((m) =>
    m[0].includes('checked=""'),
  );
}

describe("Controls: what am I allowed to look at", () => {
  test("the unstarted-events switch is here, in the reader's words", () => {
    // It used to be a pill in the board's own header, next to the stacking and
    // scale controls. Those two reshape what is already on the board; this one
    // decides what is on it at all, which is the question the two rows beside
    // it answer.
    const html = render(PREFS);
    expect(html).toContain("Show events that haven&#x27;t started");
    expect(html).toContain("Show events I&#x27;ve finished");
  });

  test("it names both views, because it reaches both", () => {
    // It began as the board's alone. Sitting between two app-wide filters, a
    // row that still said "on the timeline" would understate what a tick does.
    const html = render(PREFS);
    expect(html).toContain("Not started yet");
    expect(html).toContain("timeline");
  });

  test("the split pills say they are the board's alone", () => {
    // Unlike the row above them, these really are one view — the checklist
    // splits unstarted events into a section of their own either way.
    const html = render({ ...PREFS, showUpcoming: true });
    expect(html).toContain("On the timeline.");
  });

  test("it reads its own preference and not a neighbour's", () => {
    // Both neighbours are on and this one is off, so a checkbox bound to the
    // wrong key shows up as the wrong count of ticks.
    const off = checkboxes(render(PREFS));
    const on = checkboxes(render({ ...PREFS, showUpcoming: true }));
    expect(off.filter(Boolean)).toHaveLength(1);
    expect(on.filter(Boolean)).toHaveLength(2);
  });

  test("how unstarted events sit on the board is offered only when they are", () => {
    // A choice about arranging them is unanswerable with none on the board,
    // and a control that changes nothing visible is worse than none.
    expect(render(PREFS)).not.toContain("Mixed in");
    const on = render({ ...PREFS, showUpcoming: true });
    expect(on).toContain("In their own group");
    expect(on).toContain("Mixed in");
  });

  test("it is a pair of answers, not one answer and its absence", () => {
    // "Mixed in" is a different order, not a heading switched off, so both
    // states name themselves and the panel says which is on.
    const split = render({ ...PREFS, showUpcoming: true });
    const mixed = render({
      ...PREFS,
      showUpcoming: true,
      timelineSplitUpcoming: false,
    });
    const pressed = (html: string) =>
      [...html.matchAll(/aria-pressed="true"[^>]*>([^<]+)</g)].map((m) => m[1]);
    expect(pressed(split)).toContain("In their own group");
    expect(pressed(mixed)).toContain("Mixed in");
    // And the line under them describes the answer that is actually on.
    expect(mixed).toContain("One deadline order");
    expect(split).not.toContain("One deadline order");
  });

  test("the ignored row appears only once something is ignored", () => {
    // Nothing to restore means nothing to offer — the row would be a filter
    // over an empty set.
    expect(render(PREFS)).not.toContain("I&#x27;m ignoring");
    expect(render(PREFS, 3)).toContain("Show the 3 events I&#x27;m");
  });
});
