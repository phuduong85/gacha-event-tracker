import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NextUp } from "../src/client/components/NextUp.tsx";
import {
  boardWindow,
  markerLabel,
  splitAt,
  startMarkers,
  Timeline,
} from "../src/client/components/Timeline.tsx";
import { timelineLanes } from "../src/client/state/lanes.ts";
import { GameMetaProvider } from "../src/client/state/gameMeta.tsx";
import { metaFor } from "../src/shared/games.ts";
import { clockFor } from "../src/shared/time.ts";
import { GachaEvent, type GameId } from "../src/shared/schema.ts";

/**
 * Static-render checks on the surfaces a reader meets first.
 *
 * Not a substitute for using the thing, but they pin the claim each one makes:
 * the headline carries the deadlines behind the closest one.
 */

const NOW = Date.parse("2026-08-17T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(
    <GameMetaProvider value={(id) => metaFor(id, {})}>{node}</GameMetaProvider>,
  );
}

function row(title: string, game: GameId, endsInHours: number | null) {
  // Through the schema rather than cast into shape: it is the single source of
  // truth for this type, and it is what would catch a fixture that no longer
  // resembles a real event.
  const event = GachaEvent.parse({
    id: `${game}:${title.toLowerCase().replace(/\W+/g, "-")}:2026-08-10`,
    game,
    title,
    type: "story",
    summary: null,
    startsAt: "2026-08-10T00:00:00.000Z",
    startPrecision: "day",
    endsAt:
      endsInHours === null
        ? null
        : new Date(NOW + endsInHours * HOUR).toISOString(),
    endPrecision: endsInHours === null ? "unknown" : "exact",
    regionScoped: false,
    regionEnds: null,
    sourceUrl: "https://example.invalid/events",
    sourceId: "example-events",
    status: "published",
    confidence: 1,
    extractionMethod: "parser",
    version: 1,
    firstSeenAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
  });
  return { event, clock: clockFor(event, "america", NOW) };
}

/**
 * An event whose start is still ahead of `NOW`.
 *
 * Its own helper rather than a flag on `row`, because everything about it is
 * different: the start is what places it, the id is cut from the start's date,
 * and it is the case the board deliberately withholds.
 */
function upcoming(
  title: string,
  game: GameId,
  startsInHours: number,
  runsForHours = 240,
) {
  const startsAt = new Date(NOW + startsInHours * HOUR).toISOString();
  const event = GachaEvent.parse({
    id: `${game}:${title.toLowerCase().replace(/\W+/g, "-")}:${startsAt.slice(0, 10)}`,
    game,
    title,
    type: "banner",
    summary: null,
    startsAt,
    startPrecision: "exact",
    endsAt: new Date(NOW + (startsInHours + runsForHours) * HOUR).toISOString(),
    endPrecision: "exact",
    regionScoped: false,
    regionEnds: null,
    sourceUrl: "https://example.invalid/events",
    sourceId: "example-events",
    status: "published",
    confidence: 1,
    extractionMethod: "parser",
    version: 1,
    firstSeenAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
  });
  return { event, clock: clockFor(event, "america", NOW) };
}

describe("NextUp", () => {
  const rows = [
    row("Closing Ceremony", "genshin", 6),
    row("Second Wind", "hsr", 30),
    row("Third Rail", "zzz", 100),
  ];

  test("leads with the closest deadline and lists the ones behind it", () => {
    // A reader asked for the next three, and was right that one is too few:
    // finishing the headline event left the panel pointing at nothing.
    const html = render(<NextUp rows={rows} focused={null} onOpen={() => {}} collapsed={false} onToggleCollapsed={() => {}} />);
    expect(html).toContain("Closing Ceremony");
    expect(html).toContain("Second Wind");
    expect(html).toContain("Third Rail");
    // The lead keeps the big countdown; the rest are a queue under it.
    expect(html.indexOf("Closing Ceremony")).toBeLessThan(html.indexOf("Then"));
    expect(html.indexOf("Then")).toBeLessThan(html.indexOf("Second Wind"));
  });

  test("one deadline is a headline with nothing behind it", () => {
    const html = render(
      <NextUp rows={rows.slice(0, 1)} focused={null} onOpen={() => {}} collapsed={false} onToggleCollapsed={() => {}} />,
    );
    expect(html).toContain("Closing Ceremony");
    expect(html).not.toContain(">Then<");
  });

  test("no deadlines says so rather than rendering an empty panel", () => {
    const html = render(<NextUp rows={[]} focused={null} onOpen={() => {}} collapsed={false} onToggleCollapsed={() => {}} />);
    expect(html).toContain("Nothing running");
  });

  test("an unannounced end is never dressed up as a countdown", () => {
    // The rule the whole product rests on, at the largest type size it has.
    const html = render(
      <NextUp rows={[row("Unknown End", "wuwa", null)]} focused={null} onOpen={() => {}} collapsed={false} onToggleCollapsed={() => {}} />,
    );
    expect(html).toContain("unknown");
    expect(html).toContain("no end date");
  });
});

describe("Timeline window", () => {
  const DAY = 86_400_000;

  test("reaches a week past the oldest running event", () => {
    // So "when did this start?" is answerable without the reader hunting for
    // an edge, and so a bar that began days ago shows its real start.
    const started = NOW - 20 * DAY;
    const { min } = boardWindow([started], [NOW + 5 * DAY], NOW);
    expect(min).toBe(started - 7 * DAY);
  });

  test("stops two months back however long something has been running", () => {
    // A standing login campaign can have started half a year ago. Drawing from
    // its start bought months of empty calendar that nobody scrolls through and
    // pushed every other bar off to the right.
    const ancient = NOW - 200 * DAY;
    const { min } = boardWindow([ancient, NOW - 3 * DAY], [NOW + 5 * DAY], NOW);
    expect(min).toBe(NOW - 60 * DAY);
    // The bar is then older than the board, which is what the faded left edge
    // says — it must not be redrawn as though it started at the edge.
    expect(ancient).toBeLessThan(min);
  });

  test("today is on the board even when everything is still to come", () => {
    const { min, max } = boardWindow([NOW + 30 * DAY], [NOW + 40 * DAY], NOW);
    expect(min).toBeLessThan(NOW);
    expect(max).toBeGreaterThan(NOW);
  });
});

describe("timelineLanes", () => {
  // Deliberately not in deadline order, and with a game interleaved, so the
  // two modes cannot both pass by accident.
  const rows = [
    row("Closing Ceremony", "genshin", 100),
    row("Second Wind", "hsr", 6),
    row("Third Rail", "genshin", 30),
    row("Open Ended", "zzz", null),
  ];

  test("by game: a lane each, and the order inside one is left alone", () => {
    // The rows arrive sorted by whatever the reader chose in the list.
    // Grouping them is not a licence to re-sort within a game.
    const lanes = timelineLanes(rows, "game");
    expect(lanes.map((l) => l.game)).toEqual(["genshin", "hsr", "zzz"]);
    expect(lanes[0]?.rows.map((r) => r.event.title)).toEqual([
      "Closing Ceremony",
      "Third Rail",
    ]);
  });

  test("ending soonest: every game in one stack, deadline order", () => {
    const lanes = timelineLanes(rows, "ending");
    expect(lanes).toHaveLength(1);
    // No heading to name the game, so the renderer has to say it per bar.
    expect(lanes[0]?.game).toBeNull();
    expect(lanes[0]?.rows.map((r) => r.event.title)).toEqual([
      "Second Wind",
      "Third Rail",
      "Closing Ceremony",
      // An unannounced end is still on the board, behind every dated one — it
      // is real, but it is not a deadline.
      "Open Ended",
    ]);
  });

  test("neither mode loses a row", () => {
    for (const mode of ["game", "ending"] as const) {
      const plotted = timelineLanes(rows, mode).flatMap((l) => l.rows);
      expect(plotted).toHaveLength(rows.length);
    }
  });

  test("an empty board is no lanes, not one empty lane", () => {
    expect(timelineLanes([], "ending")).toEqual([]);
    expect(timelineLanes([], "game")).toEqual([]);
  });
});

describe("Timeline stacking", () => {
  const rows = [
    row("Closing Ceremony", "genshin", 100),
    row("Second Wind", "hsr", 6),
  ];

  const board = (group: "game" | "ending") =>
    render(
      <Timeline
        rows={rows}
        now={NOW}
        dayWidth={13}
        onZoom={() => {}}
        group={group}
        onGroup={() => {}}
        showUpcoming={false}
        splitUpcoming
        onOpen={() => {}}
        isDone={() => false}
      />,
    );

  test("mixed in, lane mode re-sorts rather than keeping the block", () => {
    // The one place `timelineLanes` is allowed to reorder a lane. Leaving the
    // given order alone would draw exactly the block it was told not to, minus
    // the heading that explained it.
    // Given live-first, as every sort this board can be handed produces. B has
    // the nearer end (48h against 100h) but has not opened yet.
    const given = [row("A", "hsr", 100), upcoming("B", "hsr", 24, 24)];
    expect(timelineLanes(given, "game", true)[0]?.rows[0]?.event.title).toBe("A");
    expect(timelineLanes(given, "game", false)[0]?.rows[0]?.event.title).toBe("B");
  });

  test("both stackings plot every event", () => {
    for (const group of ["game", "ending"] as const) {
      const html = board(group);
      expect(html).toContain("Closing Ceremony");
      expect(html).toContain("Second Wind");
    }
  });

  test("the merged board names each bar's game, since no heading does", () => {
    // Colour cannot carry it once every game shares one stack, and a reader
    // who cannot tell whose event is ending tonight has not been told the
    // thing they came for.
    const html = board("ending");
    expect(html).toContain(metaFor("hsr", {}).short);
    expect(html).toContain(metaFor("genshin", {}).short);
    // Deadline order, across games.
    expect(html.indexOf("Second Wind")).toBeLessThan(
      html.indexOf("Closing Ceremony"),
    );
  });

  test("the reader can see which stacking they are on", () => {
    // The control is the only thing on the board saying which of the two
    // shapes they are reading, so it has to say it, not just accept a tap.
    const pressed = (group: "game" | "ending") =>
      /aria-pressed="true"[\s\S]*?>([^<]+)</.exec(board(group))?.[1];
    expect(pressed("game")).toBe("By game");
    expect(pressed("ending")).toBe("Ending soonest");
  });
});

describe("Timeline: events that have not started", () => {
  const rows = [
    row("Closing Ceremony", "genshin", 100),
    upcoming("Frost Parade", "hsr", 3 * 24),
    upcoming("Second Coming", "zzz", 3 * 24 + 2),
    upcoming("Long Way Round", "wuwa", 30 * 24),
  ];

  const board = (
    showUpcoming: boolean,
    all = rows,
    group: "game" | "ending" = "ending",
    splitUpcoming = true,
  ) =>
    render(
      <Timeline
        rows={all}
        now={NOW}
        dayWidth={32}
        onZoom={() => {}}
        group={group}
        onGroup={() => {}}
        showUpcoming={showUpcoming}
        splitUpcoming={splitUpcoming}
        onOpen={() => {}}
        isDone={() => false}
      />,
    );

  test("the board holds them back by default", () => {
    // Off is the default because the board answers "how does the time I am in
    // lay out?", and it draws its span from what it plots — so a next patch on
    // every lane pushes the running bars the reader came for off to the left.
    const html = board(false);
    expect(html).toContain("Closing Ceremony");
    expect(html).not.toContain("Frost Parade");
    expect(html).not.toContain("Long Way Round");
  });

  test("switching it on plots them", () => {
    const html = board(true);
    expect(html).toContain("Frost Parade");
    expect(html).toContain("Long Way Round");
  });

  test("a board with only future events says so rather than reading empty", () => {
    // Otherwise the reader is looking at "nothing to plot" while three events
    // are scheduled, and an absence nobody mentioned is indistinguishable from
    // a quiet fortnight. It names the setting, since the switch is not on the
    // board any more.
    const html = board(false, rows.slice(1));
    expect(html).toContain("Nothing is running right now");
    expect(html).toContain("3 events have not started yet");
    expect(html).toContain("Show events that haven&#x27;t started");
  });

  test("one waiting event is counted in words, not as \"1 events\"", () => {
    const html = board(false, [rows[1]!]);
    expect(html).toContain("One event has not started yet");
  });

  test("each clump of starts is marked in words", () => {
    const html = board(true);
    // Two of them open on the same day, so that is one mark saying two.
    expect(html).toContain("2 start");
    // And the far one is its own mark, singular.
    expect(html).toContain("starts ");
  });

  test("start markers are absent while the events are held back", () => {
    expect(board(false)).not.toContain("2 start");
  });

  test("a heading marks where the running bars stop", () => {
    // The dashed edge says "this bar has not started"; it does not say where
    // the running ones ended, which is what a board read at a glance needs.
    const html = board(true);
    const at = html.indexOf("Not started yet");
    expect(at).toBeGreaterThan(html.indexOf("Closing Ceremony"));
    expect(at).toBeLessThan(html.indexOf("Frost Parade"));
  });

  test("every lane gets its own, since every lane has its own boundary", () => {
    // Stacked by game, "where does this game stop running?" is a different
    // answer per lane — one heading for the board would be in the wrong place
    // for all but one of them.
    const html = board(true, rows, "game");
    expect(html.split("Not started yet")).toHaveLength(4);
  });

  test("mixed in, there is no block to head and no heading", () => {
    // Not the heading switched off: the rows are one deadline queue, so a
    // label would be pointing at the middle of it.
    const html = board(true, rows, "ending", false);
    expect(html).toContain("Frost Parade");
    expect(html).not.toContain("Not started yet");
  });

  test("mixed in, a nearer deadline wins whether or not it has opened", () => {
    // The whole point of the option, and the one thing the split order can
    // never show. Frost Parade opens in 3 days and closes 10 days after that;
    // Closing Ceremony is running now until 100 hours from now — so it is
    // still the nearer deadline, and Frost Parade sits under it rather than
    // behind every running row.
    const near = upcoming("Quick Turnaround", "hsr", 24, 24);
    const html = board(true, [row("Closing Ceremony", "genshin", 100), near], "ending", false);
    expect(html.indexOf("Quick Turnaround")).toBeLessThan(
      html.indexOf("Closing Ceremony"),
    );
    // Split, the same two rows go the other way round.
    const kept = board(true, [row("Closing Ceremony", "genshin", 100), near], "ending", true);
    expect(kept.indexOf("Closing Ceremony")).toBeLessThan(
      kept.indexOf("Quick Turnaround"),
    );
  });

  test("no heading where nothing is waiting", () => {
    // A label with nothing under it is a section that does not exist.
    expect(board(true, [row("Closing Ceremony", "genshin", 100)])).not.toContain(
      "Not started yet",
    );
    expect(board(false)).not.toContain("Not started yet");
  });
});

describe("splitAt", () => {
  const live = { clock: { upcoming: false } };
  const soon = { clock: { upcoming: true } };

  test("finds the boundary", () => {
    expect(splitAt([live, live, soon, soon])).toBe(2);
  });

  test("a lane that is all future breaks at the top", () => {
    // Not a divider then but a heading, which is the honest reading: nothing
    // in this lane has started.
    expect(splitAt([soon, soon])).toBe(0);
  });

  test("nothing waiting is no boundary at all", () => {
    expect(splitAt([live, live])).toBe(-1);
    expect(splitAt([])).toBe(-1);
  });
});

describe("startMarkers", () => {
  const DAY = 86_400_000;
  const at = (ms: number) => ({ clock: { upcoming: true, startsMs: ms } });

  /** A generous scale, so nothing merges unless the test asks it to. */
  const wide = (ms: number) => (ms / DAY) * 108;

  test("events starting the same day are one mark", () => {
    // A patch ships six things at once; six rules stacked on one date is not a
    // reading of that, it is a smear.
    const marks = startMarkers(
      [at(5 * DAY), at(5 * DAY + 3600_000), at(5 * DAY + 7200_000)],
      wide,
    );
    expect(marks).toHaveLength(1);
    expect(marks[0]?.count).toBe(3);
  });

  test("the mark sits at the earliest start in its day", () => {
    // So the rule lands on the leftmost bar of the clump rather than at a
    // midnight no event actually begins at.
    const marks = startMarkers([at(5 * DAY + 7200_000), at(5 * DAY)], wide);
    expect(marks[0]?.ms).toBe(5 * DAY);
  });

  test("separate days stay separate when the scale has room", () => {
    const marks = startMarkers([at(5 * DAY), at(9 * DAY)], wide);
    expect(marks).toHaveLength(2);
  });

  test("days closer than a label are merged, and the label says the range", () => {
    // At six pixels a day, four days apart is 24px — two labels on top of each
    // other. Merged, and honest about what it covers.
    const tight = (ms: number) => (ms / DAY) * 6;
    const marks = startMarkers([at(5 * DAY), at(9 * DAY)], tight);
    expect(marks).toHaveLength(1);
    expect(marks[0]?.count).toBe(2);
    expect(marks[0]?.ms).toBe(5 * DAY);
    expect(marks[0]?.through).toBe(9 * DAY);
  });

  test("events already running are not starts", () => {
    expect(
      startMarkers([{ clock: { upcoming: false, startsMs: 5 * DAY } }], wide),
    ).toEqual([]);
  });
});

describe("markerLabel", () => {
  const DAY = 86_400_000;

  test("one event says it starts", () => {
    expect(markerLabel({ ms: 5 * DAY, through: 5 * DAY, count: 1 })).toStartWith(
      "starts ",
    );
  });

  test("several on one day are counted", () => {
    expect(markerLabel({ ms: 5 * DAY, through: 5 * DAY, count: 4 })).toStartWith(
      "4 start ",
    );
  });

  test("a merged mark names the span it covers, not just its first day", () => {
    // Claiming one date for a mark that stands for eleven days is the kind of
    // small confident wrongness this codebase exists to avoid.
    const label = markerLabel({ ms: 5 * DAY, through: 9 * DAY, count: 2 });
    expect(label).toContain("–");
  });
});
