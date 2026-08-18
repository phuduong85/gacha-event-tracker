import { describe, expect, test } from "bun:test";
import { adapterById } from "../../src/ingest/adapters/index.ts";
import type { Adapter } from "../../src/ingest/adapters/types.ts";
import { parseOrdinalDateTimeRange } from "../../src/ingest/dates.ts";
import { fandomParser, renderedHtml } from "../../src/ingest/parsers/fandom.ts";
import { inferType } from "../../src/ingest/parsers/game8.ts";
import { GachaEvent, type EventType } from "../../src/shared/schema.ts";

/**
 * Pinned clock. Parsers take `now` from context and never read it themselves,
 * so a fixture captured months ago still asserts byte-identical output.
 */
const NOW = "2026-08-14T00:00:00.000Z";

function adapter(id: string): Adapter {
  const found = adapterById(id);
  if (found === undefined) throw new Error(`no adapter '${id}'`);
  return found;
}

const genshinGame8 = adapter("genshin-game8-events");
const nteGame8 = adapter("nte-game8-events");

const CASES: Array<{ adapter: Adapter; fixture: string }> = [
  { adapter: genshinGame8, fixture: "fixtures/genshin/game8-events-2026-08-14" },
  { adapter: nteGame8, fixture: "fixtures/nte/game8-events-2026-08-14" },
  { adapter: adapter("hsr-game8-events"), fixture: "fixtures/hsr/game8-events-2026-08-14" },
  { adapter: adapter("wuwa-game8-events"), fixture: "fixtures/wuwa/game8-events-2026-08-14" },
  { adapter: adapter("zzz-game8-events"), fixture: "fixtures/zzz/game8-events-2026-08-14" },
  { adapter: adapter("endfield-game8-events"), fixture: "fixtures/endfield/game8-events-2026-08-14" },
  { adapter: adapter("endfield-wikigg-events"), fixture: "fixtures/endfield/wikigg-events-2026-08-14" },
  { adapter: adapter("p5x-game8-events"), fixture: "fixtures/p5x/game8-events-2026-08-17" },
  // A `.html` fixture holding JSON, deliberately: this source is the MediaWiki
  // action API, and `snapshots/` names every stored body `<id>.html` whatever
  // its content type. The fixture is the bytes the fetcher would store.
  { adapter: adapter("r1999-fandom-events"), fixture: "fixtures/r1999/fandom-events-2026-08-17" },
  { adapter: adapter("fgo-fandom-events"), fixture: "fixtures/fgo/fandom-events-2026-08-18" },
];

async function runAdapter(adapter: Adapter, fixture: string) {
  const html = await Bun.file(`${fixture}.html`).text();
  return adapter.parse(html, {
    now: NOW,
    sourceUrl: adapter.url,
    sourceId: adapter.id,
    game: adapter.game,
  });
}

describe.each(CASES)("$adapter.id", ({ adapter, fixture }) => {
  test("matches the checked-in expected output", async () => {
    const events = await runAdapter(adapter, fixture);
    const expected = await Bun.file(`${fixture}.expected.json`).json();
    expect(events).toEqual(expected);
  });

  test("every event satisfies the schema", async () => {
    for (const event of await runAdapter(adapter, fixture)) {
      expect(() => GachaEvent.parse(event)).not.toThrow();
    }
  });

  test("is deterministic across runs", async () => {
    const a = await runAdapter(adapter, fixture);
    const b = await runAdapter(adapter, fixture);
    expect(a).toEqual(b);
  });

  test("never emits an end before its start", async () => {
    for (const e of await runAdapter(adapter, fixture)) {
      if (e.endsAt !== null) expect(e.endsAt > e.startsAt).toBe(true);
    }
  });

  test("no event runs longer than 180 days", async () => {
    // Patch cycles are ~6 weeks. A longer span means a misread year, which is
    // the failure mode most likely to reach a user as a confident wrong date.
    for (const e of await runAdapter(adapter, fixture)) {
      if (e.endsAt === null) continue;
      const days =
        (Date.parse(e.endsAt) - Date.parse(e.startsAt)) / 86_400_000;
      expect(days).toBeLessThanOrEqual(180);
    }
  });

  test("event IDs are unique and stable in shape", async () => {
    const events = await runAdapter(adapter, fixture);
    const ids = events.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of events) {
      expect(e.id).toBe(
        `${e.game}:${e.id.split(":")[1]}:${e.startsAt.slice(0, 10)}`,
      );
    }
  });

  test("excludes permanent and past sections", async () => {
    const titles = (await runAdapter(adapter, fixture)).map((e) => e.title);
    // Permanent entries carry no dates; past entries ended before the fixture
    // date. Neither belongs on a "what's live / what's next" calendar.
    for (const t of titles) expect(t).not.toMatch(/permanent/i);
  });
});

describe("genshin fixture specifics", () => {
  test("yields the nine dated events on the page", async () => {
    const events = await runAdapter(
      genshinGame8,
      "fixtures/genshin/game8-events-2026-08-14",
    );
    expect(events).toHaveLength(9);

    const byTitle = new Map(events.map((e) => [e.title, e]));
    const mutual = byTitle.get("Mutual Aid in Bloom: Into the Frostlands");
    expect(mutual?.startsAt).toBe("2026-08-12T00:00:00.000Z");
    expect(mutual?.endsAt).toBe("2026-08-24T00:00:00.000Z");
    expect(mutual?.startPrecision).toBe("day");

    // Sourced from a one-cell "Availability Period" range rather than
    // Start/End rows — the other table shape on the same page.
    expect(byTitle.get("Battle Pass - Frostfarer")?.endsAt).toBe(
      "2026-09-21T00:00:00.000Z",
    );
  });

  test("year-less summary rows produce no events", async () => {
    // The page's summary tables show "08/12 - 08/24" with no year. Those must
    // be skipped, not year-guessed — and they must not duplicate the detail
    // tables that carry the same events with real years.
    const events = await runAdapter(
      genshinGame8,
      "fixtures/genshin/game8-events-2026-08-14",
    );
    const dupes = events.filter(
      (e) => e.title === "Mutual Aid in Bloom: Into the Frostlands",
    );
    expect(dupes).toHaveLength(1);
  });
});

describe("nte fixture specifics", () => {
  test("yields current and upcoming events only", async () => {
    const events = await runAdapter(
      nteGame8,
      "fixtures/nte/game8-events-2026-08-14",
    );
    expect(events).toHaveLength(13); // 9 current + 4 upcoming

    const titles = events.map((e) => e.title);
    expect(titles).toContain("Market Opening Rehearsal"); // current
    expect(titles).toContain("Fons Rush"); // upcoming
    expect(titles).not.toContain("Login Gift"); // permanent
    expect(titles).not.toContain("Tiger Perks"); // previous
  });

  test("carries the summary column through", async () => {
    const events = await runAdapter(
      nteGame8,
      "fixtures/nte/game8-events-2026-08-14",
    );
    const circleGift = events.find((e) => e.title === "Circle Gift");
    expect(circleGift?.summary).toContain("Log in");
  });
});

describe("inferType", () => {
  const cases: Array<[string, EventType]> = [
    ["Overflowing Abundance Rerun", "rerun"],
    ["Stygian Onslaught", "challenge"],
    ["Character Test Runs", "challenge"],
    ["Gold Clash", "challenge"],
    ["Seize the Day Login Bonus", "login"],
    ["Epitome Invocation Banner", "banner"],
    ["Mutual Aid in Bloom: Into the Frostlands", "other"],
  ];
  test.each(cases)("%s → %s", (title, expected) => {
    expect(inferType(title)).toBe(expected);
  });
});

describe("new source shapes", () => {
  test("zzz recovers events from rowspan Start/End rows", async () => {
    // The event name spans two rows, so a flat cell reader sees
    // [title, "Start", date] then ["End", date]. Losing the pairing would
    // silently halve the calendar.
    const events = await runAdapter(
      adapter("zzz-game8-events"),
      "fixtures/zzz/game8-events-2026-08-14",
    );
    const summer = events.find((e) => e.title === "Summer Waves Rolls In");
    expect(summer?.startsAt).toBe("2026-07-29T00:00:00.000Z");
    expect(summer?.endsAt).toBe("2026-09-07T00:00:00.000Z");
    expect(events.every((e) => e.endsAt !== null)).toBe(true);
  });

  test("hsr keeps events whose end is not announced", async () => {
    // "Jul. 24, 2026 - End of 4.6" has a real start and no knowable end.
    // Publishing it with a guessed end would be the worst possible outcome.
    const events = await runAdapter(
      adapter("hsr-game8-events"),
      "fixtures/hsr/game8-events-2026-08-14",
    );
    const open = events.filter((e) => e.endsAt === null);
    expect(open.length).toBeGreaterThan(0);
    for (const e of open) expect(e.endPrecision).toBe("unknown");
  });

  test("wuwa parses ranges carrying a year on both sides", async () => {
    const events = await runAdapter(
      adapter("wuwa-game8-events"),
      "fixtures/wuwa/game8-events-2026-08-14",
    );
    const jade = events.find((e) => e.title === "In Search of Lost Jade");
    expect(jade?.startsAt).toBe("2026-07-30T00:00:00.000Z");
    expect(jade?.endsAt).toBe("2026-08-13T00:00:00.000Z");
  });
});

describe("endfield", () => {
  test("reads MM/DD/YY ranges from a combined schedule cell", async () => {
    // This page hides its only dated events in an "Event | Schedule & Summary"
    // table, where one cell holds the label, the range and the blurb.
    const events = await runAdapter(
      adapter("endfield-game8-events"),
      "fixtures/endfield/game8-events-2026-08-14",
    );
    expect(events).toHaveLength(2);
    const rooted = events.find((e) => e.title === "The Rooted Realm");
    expect(rooted?.startsAt).toBe("2026-08-09T00:00:00.000Z");
    expect(rooted?.endsAt).toBe("2026-08-30T00:00:00.000Z");
    // The prose after the dates becomes the blurb, without the label.
    expect(rooted?.summary).not.toBeNull();
    expect(rooted?.summary).not.toMatch(/^Period:/);
  });
});

describe("p5x", () => {
  const fixture = "fixtures/p5x/game8-events-2026-08-17";

  test("reads a range whose halves are separated by an <hr>", async () => {
    const events = await runAdapter(adapter("p5x-game8-events"), fixture);
    const beach = events.find((e) =>
      e.title.startsWith("Haunted Beach Shack Summer Event"),
    );
    expect(beach?.startsAt).toBe("2026-07-30T00:00:00.000Z");
    expect(beach?.endsAt).toBe("2026-08-13T00:00:00.000Z");
  });

  test("keeps the finished-events back catalogue off the calendar", async () => {
    // Fifty-odd past events sit in a table fenced off by nothing but an
    // <h4>Finished Events</h4> inside a collapsed accordion. A reader blind to
    // h4 sees one uninterrupted run of tables and publishes the lot.
    const events = await runAdapter(adapter("p5x-game8-events"), fixture);
    expect(events).toHaveLength(3);
    const titles = events.map((e) => e.title);
    expect(titles).not.toContain("Tycoon Season 1"); // finished
    expect(titles).not.toContain("New Year's Gifts"); // finished
  });

  test("skips a row whose duration states no date at all", async () => {
    // "Take Your Heart" ends 30 days after each player makes an account, so it
    // has no calendar date and no honest place on a calendar.
    const events = await runAdapter(adapter("p5x-game8-events"), fixture);
    expect(events.map((e) => e.title)).not.toContain("Take Your Heart");
  });

  test("takes no end from an ambiguous one, and does not show it as prose", async () => {
    // "June 25, 2026 July 16/30, 2026" names two candidate ends. Picking either
    // would be a guess, and echoing the leftover into the summary would dress
    // the same guess up as information.
    const events = await runAdapter(adapter("p5x-game8-events"), fixture);
    const login = events.find((e) => e.title === "Login Campaigns");
    expect(login?.startsAt).toBe("2026-06-25T00:00:00.000Z");
    expect(login?.endsAt).toBeNull();
    expect(login?.summary).toBeNull();
  });

  test("recovers the blurb from the event's own section", async () => {
    // The event is listed twice: once in a bare Event|Duration table, and again
    // under its own heading with a paragraph of prose. Deduping by ID must not
    // throw the prose away.
    const events = await runAdapter(adapter("p5x-game8-events"), fixture);
    const anniversary = events.find(
      (e) => e.title === "1st Anniversary Celebration",
    );
    expect(anniversary?.summary).toContain("first anniversary");
  });
});

describe("wiki.gg parser", () => {
  test("reads exact per-region timers", async () => {
    // The first source that states region-scoped ends. Asia and the Americas
    // differ by hours, which is precisely what regionEnds exists to carry.
    const events = await runAdapter(
      adapter("endfield-wikigg-events"),
      "fixtures/endfield/wikigg-events-2026-08-14",
    );
    expect(events).toHaveLength(6);

    const heat = events.find((e) => e.title === "HEAT RAGE! MEGA ARENA!");
    expect(heat?.startPrecision).toBe("exact");
    expect(heat?.regionScoped).toBe(true);
    expect(heat?.regionEnds?.asia).toBe("2026-08-12T20:00:00.000Z");
    expect(heat?.regionEnds?.america).toBe("2026-08-13T09:00:00.000Z");
    // endsAt is the fallback for a region the source did not list, so it takes
    // the earliest — never promise more time than some region actually gets.
    expect(heat?.endsAt).toBe("2026-08-12T20:00:00.000Z");
  });

  test("links each event to its own wiki page", async () => {
    const events = await runAdapter(
      adapter("endfield-wikigg-events"),
      "fixtures/endfield/wikigg-events-2026-08-14",
    );
    for (const e of events) {
      expect(e.sourceUrl).toStartWith("https://endfield.wiki.gg/wiki/");
    }
  });
});

describe("fandom parser", () => {
  const fixture = "fixtures/r1999/fandom-events-2026-08-17";
  const r1999 = adapter("r1999-fandom-events");

  test("publishes only the events that have not ended", async () => {
    // The page is an archive: 154 rows spanning every version since 1.1, of
    // which six had not ended at the pinned clock. Counted independently off
    // the fixture before this expectation was written — the count is the guard
    // against a shape change making events vanish silently.
    const events = await runAdapter(r1999, fixture);
    expect(events).toHaveLength(6);
    for (const e of events) {
      expect(e.endsAt).not.toBeNull();
      expect(Date.parse(e.endsAt!)).toBeGreaterThanOrEqual(Date.parse(NOW));
    }
  });

  test("converts the stated UTC-5 offset rather than reading it as UTC", async () => {
    // "August 13th, 05:00 - September 21st, 2026, 04:59 (UTC-5)". Reading the
    // wall clock as UTC would put every boundary five hours early — and a start
    // that crossed a UTC midnight would move the event's ID with it.
    const events = await runAdapter(r1999, fixture);
    const version = events.find((e) => e.title === "On Another's Sorrow");
    expect(version?.startsAt).toBe("2026-08-13T10:00:00.000Z");
    expect(version?.endsAt).toBe("2026-09-21T09:59:00.000Z");
    expect(version?.startPrecision).toBe("exact");
    expect(version?.endPrecision).toBe("exact");
  });

  test("takes the title from the <b>, not the cell text", async () => {
    // A missing banner image renders as a red link whose visible text is
    // "File:A Stranger to Memory Lane Banner.png". A cell-text reader publishes
    // that filename as the event's name.
    const events = await runAdapter(r1999, fixture);
    const titles = events.map((e) => e.title);
    expect(titles).toContain("A Stranger to Memory Lane");
    for (const t of titles) {
      expect(t).not.toMatch(/^File:/);
      expect(t).not.toMatch(/\.png/i);
    }
  });

  test("carries the section heading as the summary and types from it", async () => {
    const events = await runAdapter(r1999, fixture);
    const story = events.find((e) => e.title === "The You That's Meant to Be");
    // The title alone says nothing about what kind of event it is; the section
    // it sits under does.
    expect(story?.summary).toBe("Character Story Events");
    expect(story?.type).toBe("story");
    // The [edit] link MediaWiki renders inside every heading is not part of it.
    for (const e of events) expect(e.summary).not.toMatch(/edit/i);
  });

  test("states one global end, not per-region ends", async () => {
    // Every row reads (UTC-5) and the page draws no regional distinction.
    for (const e of await runAdapter(r1999, fixture)) {
      expect(e.regionScoped).toBe(false);
      expect(e.regionEnds).toBeNull();
    }
  });

  test("rejects a body that is not an action=parse response", async () => {
    // The plain wiki page answers a non-browser client with a Cloudflare
    // interstitial. Feeding that to the parser must fail loudly rather than
    // report zero events, which reads downstream as "nothing is on".
    const interstitial = "<html><head><title>Just a moment...</title></head></html>";
    expect(fandomParser.canParse(interstitial)).toBe(false);
    expect(fandomParser.canParse('{"error":{"code":"missingtitle"}}')).toBe(false);
    expect(() =>
      r1999.parse(interstitial, {
        now: NOW,
        sourceUrl: r1999.url,
        sourceId: r1999.id,
        game: r1999.game,
      }),
    ).toThrow(/redesigned/);
  });

  test("a row stating no year on either half yields no event", async () => {
    // "February 20th, 05:00 - March 27th, 04:59 (UTC-5)" — the fixture has
    // exactly one, and there is no honest year to give it.
    const body = await Bun.file(`${fixture}.html`).text();
    const rendered = renderedHtml(body);
    expect(rendered).not.toBeNull();
    expect(rendered!).toContain("February 20th, 05:00 - March 27th, 04:59");
    expect(parseOrdinalDateTimeRange("February 20th, 05:00 - March 27th, 04:59 (UTC-5)")).toBeNull();
  });
});
