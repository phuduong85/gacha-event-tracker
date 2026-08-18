import { describe, expect, test } from "bun:test";
import {
  dailiesId,
  dailyDays,
  dailyOverride,
  dailySummary,
  dayKey,
  isDaily,
  msUntilReset,
  nextResetMs,
  resetHourFor,
  RESET_HOUR_LOCAL,
  resolveDaily,
  streakOf,
} from "../src/shared/daily.ts";
import { DAY, HOUR } from "../src/shared/time.ts";

const at = (iso: string) => Date.parse(iso);

describe("isDaily", () => {
  const base = { type: "other" as const, title: "", summary: null };

  test("a login campaign always repeats", () => {
    expect(isDaily({ ...base, type: "login", title: "Traveler's Log" })).toBe(true);
  });

  test("reads the phrasing sources actually use", () => {
    for (const title of [
      "Daily Check-In Rewards",
      "Sign-in Event",
      "7-Day Login Bonus",
      "Log-in Campaign: Frostlands",
    ]) {
      expect(isDaily({ ...base, title })).toBe(true);
    }
  });

  test("finds it in the summary when the title is a codename", () => {
    expect(
      isDaily({
        ...base,
        title: "Mutual Aid in Bloom",
        summary: "Complete a task each day to earn Primogems.",
      }),
    ).toBe(true);
  });

  test("an ordinary event gets no checklist", () => {
    // A false positive puts a twenty-box checklist on a story chapter, which
    // the reader then has to work out and dismiss.
    expect(
      isDaily({
        ...base,
        type: "banner",
        title: "Mutual Aid in Bloom",
        summary: "Limited character banner rerun.",
      }),
    ).toBe(false);
    expect(isDaily({ ...base, type: "challenge", title: "Spiral Abyss" })).toBe(false);
  });
});

describe("resolveDaily", () => {
  const detected = { type: "login" as const, title: "Daily Check-In", summary: null };
  const plain = { type: "story" as const, title: "Chapter Three", summary: null };

  test("detection stands until the reader says otherwise", () => {
    expect(resolveDaily(detected, undefined)).toBe(true);
    expect(resolveDaily(plain, undefined)).toBe(false);
  });

  test("the reader can mark an event the source never called daily", () => {
    // The case this exists for: a grind whose page never prints the word, but
    // which the player knows resets every day.
    expect(resolveDaily(plain, true)).toBe(true);
  });

  test("detection can be switched off entirely", () => {
    // The preference only silences the guess. Nothing the reader marked is
    // affected, and no logged day is touched, so it is reversible.
    expect(resolveDaily(detected, undefined, false)).toBe(false);
    expect(resolveDaily(detected, true, false)).toBe(true);
    expect(resolveDaily(plain, true, false)).toBe(true);
    expect(resolveDaily(detected, undefined, true)).toBe(true);
  });

  test("the reader can unmark a false positive", () => {
    // A banner whose blurb happens to mention "daily login rewards" should not
    // be stuck with a twenty-box checklist the reader cannot dismiss.
    expect(resolveDaily(detected, false)).toBe(false);
  });
});

describe("dailyOverride", () => {
  test("agreeing with detection records nothing", () => {
    // Storing "yes" on an event already detected as daily would freeze today's
    // guess into the reader's data, so a later parser fix could never reach it.
    expect(dailyOverride(true, true)).toBeUndefined();
    expect(dailyOverride(false, false)).toBeUndefined();
  });

  test("disagreeing with detection records the disagreement", () => {
    expect(dailyOverride(true, false)).toBe(true);
    expect(dailyOverride(false, true)).toBe(false);
  });

  test("round-trips: overriding then changing back leaves no trace", () => {
    const detectedDaily = false;
    const on = dailyOverride(true, detectedDaily);
    expect(resolveDaily({ type: "story", title: "x", summary: null }, on)).toBe(true);
    const off = dailyOverride(false, detectedDaily);
    expect(off).toBeUndefined();
  });
});

describe("dayKey", () => {
  test("the game day rolls at 04:00 server time, not midnight", () => {
    // Asia is UTC+8, so its 04:00 reset is 20:00 UTC the day before. Someone
    // playing at 02:00 local is still on the previous day's dailies, and a
    // naive UTC date would tick the wrong box for four hours every night.
    expect(dayKey(at("2026-08-15T19:59:00Z"), "asia")).toBe("2026-08-15");
    expect(dayKey(at("2026-08-15T20:00:00Z"), "asia")).toBe("2026-08-16");
  });

  test("each region rolls at its own instant", () => {
    const instant = at("2026-08-16T02:00:00Z");
    // Europe (UTC+1) resets at 03:00 UTC, so 02:00 is still the 15th there,
    // while Asia rolled over six hours earlier.
    expect(dayKey(instant, "europe")).toBe("2026-08-15");
    expect(dayKey(instant, "asia")).toBe("2026-08-16");
  });

  test("survives a UTC month boundary", () => {
    expect(dayKey(at("2026-09-01T00:30:00Z"), "america")).toBe("2026-08-31");
  });
});

describe("a game whose server map differs from the default", () => {
  // Endfield has two server groups, not three: Europe is served off the
  // Americas machine on a fixed UTC-5, so a European player's 04:00 reset is
  // 09:00 UTC — six hours after the HoYo/Kuro Europe pattern. Asia has its own
  // server and is unaffected.
  const morning = at("2026-08-16T08:00:00Z");

  test("the override beats the regional default for that region", () => {
    expect(dayKey(morning, "europe", "endfield")).toBe("2026-08-15");
    expect(dayKey(morning, "europe", "genshin")).toBe("2026-08-16");
  });

  test("rolls exactly on 09:00 UTC in Europe", () => {
    expect(dayKey(at("2026-08-16T08:59:59Z"), "europe", "endfield")).toBe(
      "2026-08-15",
    );
    expect(dayKey(at("2026-08-16T09:00:00Z"), "europe", "endfield")).toBe(
      "2026-08-16",
    );
    expect(nextResetMs(morning, "europe", "endfield")).toBe(
      at("2026-08-16T09:00:00Z"),
    );
  });

  test("a region with its own server keeps the answer it always had", () => {
    // The override is per region on purpose. A blanket per-game offset would
    // drag Asia — which genuinely has its own Endfield server — onto the
    // Americas clock, moving a reader's already-logged day keys by eleven
    // hours to fix a bug they never had.
    for (const region of ["asia", "america"] as const) {
      for (const hour of [0, 6, 9, 14, 20, 23]) {
        const t = at(`2026-08-16T${String(hour).padStart(2, "0")}:30:00Z`);
        expect(dayKey(t, region, "endfield")).toBe(dayKey(t, region));
      }
    }
  });

  test("a game with no override still follows its region", () => {
    // Europe is UTC+1, so 03:00 UTC. Asia rolled six hours before that.
    const instant = at("2026-08-16T02:00:00Z");
    expect(dayKey(instant, "europe", "genshin")).toBe("2026-08-15");
    expect(dayKey(instant, "asia", "genshin")).toBe("2026-08-16");
    // …and matches the answer given with no game at all.
    expect(dayKey(instant, "europe", "genshin")).toBe(dayKey(instant, "europe"));
  });

  test("the checklist counts days on the clock that reader is actually on", () => {
    const start = at("2026-08-16T09:00:00Z"); // an endfield europe reset
    expect(dailyDays(start, start + 3 * DAY, "europe", "endfield")).toEqual([
      "2026-08-16",
      "2026-08-17",
      "2026-08-18",
    ]);

    const summary = dailySummary({
      startsMs: start,
      endsMs: start + 3 * DAY,
      region: "europe",
      game: "endfield",
      now: at("2026-08-17T08:00:00Z"), // still the 16th on a UTC-5 server
      logged: [],
    });
    expect(summary.today).toBe("2026-08-16");
    expect(summary.msUntilReset).toBe(HOUR);
  });

  test("an Asia reader's checklist is byte-identical to before the override", () => {
    // The regression this guards: an Endfield event whose end lands between the
    // two candidate resets loses its final claimable day if the wrong clock is
    // used, and a day that leaves `dailyDays` can never be ticked or untucked
    // again — the pip is simply not rendered.
    const start = at("2026-08-06T04:00:00Z");
    const end = at("2026-08-19T22:00:00Z");
    expect(dailyDays(start, end, "asia", "endfield")).toEqual(
      dailyDays(start, end, "asia"),
    );
    expect(dailyDays(start, end, "asia", "endfield")).toContain("2026-08-20");
  });
});

describe("nextResetMs", () => {
  test("is the next reset strictly after the instant given", () => {
    const reset = at("2026-08-15T20:00:00Z"); // asia
    expect(nextResetMs(reset - 1, "asia")).toBe(reset);
    // Standing exactly on a reset, the next one is tomorrow's — otherwise the
    // countdown would read "0s" for a whole tick.
    expect(nextResetMs(reset, "asia")).toBe(reset + DAY);
  });

  test("msUntilReset never exceeds a day", () => {
    for (const region of ["asia", "america", "europe"] as const) {
      const left = msUntilReset(at("2026-08-15T11:22:33Z"), region);
      expect(left).toBeGreaterThan(0);
      expect(left).toBeLessThanOrEqual(DAY);
    }
  });
});

describe("dailyDays", () => {
  const start = at("2026-08-12T20:00:00Z"); // an asia reset instant

  test("one entry per claimable day", () => {
    const days = dailyDays(start, start + 7 * DAY, "asia");
    expect(days).toEqual([
      "2026-08-13",
      "2026-08-14",
      "2026-08-15",
      "2026-08-16",
      "2026-08-17",
      "2026-08-18",
      "2026-08-19",
    ]);
  });

  test("an end landing on a reset gives you nothing that day", () => {
    // Ending at 04:00 means the final day was never claimable; listing it
    // would show a box that can only ever be a miss.
    const days = dailyDays(start, start + 3 * DAY, "asia");
    expect(days).toHaveLength(3);
    expect(days?.at(-1)).toBe("2026-08-15");
  });

  test("an unannounced end yields no checklist rather than a made-up one", () => {
    // This is the endsAt: null rule. Filling twenty boxes from a guessed end
    // date is exactly the fabrication the schema exists to prevent.
    expect(dailyDays(start, null, "asia")).toBeNull();
  });

  test("a nonsense window still returns something finite", () => {
    expect(dailyDays(start, start + 400 * DAY, "asia")).toHaveLength(200);
    expect(dailyDays(start, start - DAY, "asia")).toEqual(["2026-08-13"]);
  });
});

describe("dailySummary", () => {
  const start = at("2026-08-12T20:00:00Z");
  const week = { startsMs: start, endsMs: start + 7 * DAY, region: "asia" as const };

  test("counts what is left including today", () => {
    const s = dailySummary({
      ...week,
      now: at("2026-08-15T12:00:00Z"),
      logged: ["2026-08-13", "2026-08-15"],
    });
    expect(s.today).toBe("2026-08-15");
    expect(s.doneToday).toBe(true);
    expect(s.logged).toBe(2);
    expect(s.remaining).toBe(5); // 15th through 19th
    expect(s.missed).toBe(1); // the 14th
  });

  test("a day the reader missed is reported, not hidden", () => {
    const s = dailySummary({
      ...week,
      now: at("2026-08-16T12:00:00Z"),
      logged: [],
    });
    expect(s.doneToday).toBe(false);
    expect(s.missed).toBe(3);
    expect(s.remaining).toBe(4);
  });

  test("an unannounced end still counts the ticks", () => {
    const s = dailySummary({
      ...week,
      endsMs: null,
      now: at("2026-08-16T12:00:00Z"),
      logged: ["2026-08-14", "2026-08-15"],
    });
    expect(s.days).toBeNull();
    expect(s.remaining).toBeNull();
    expect(s.missed).toBeNull();
    expect(s.logged).toBe(2);
  });

  test("ticks outside the published window are never discarded", () => {
    // If a source quietly moves a date, the reader's own record of having
    // played still stands — nothing else holds a copy of it.
    const s = dailySummary({
      ...week,
      endsMs: null,
      now: at("2026-08-16T12:00:00Z"),
      logged: ["2020-01-01"],
    });
    expect(s.logged).toBe(1);
  });

  test("resets are reported against the reader's own region", () => {
    const evening = at("2026-08-15T21:00:00Z");
    expect(dailySummary({ ...week, now: evening, logged: [] }).msUntilReset).toBe(
      23 * HOUR,
    );
  });
});

describe("streakOf", () => {
  test("counts back from yesterday when today is not done yet", () => {
    // Otherwise a fortnight's run reads as broken every morning, which is the
    // one time the number actually matters to the reader.
    expect(
      streakOf(["2026-08-10", "2026-08-11", "2026-08-12"], "2026-08-13"),
    ).toBe(3);
  });

  test("includes today once it is done", () => {
    expect(streakOf(["2026-08-12", "2026-08-13"], "2026-08-13")).toBe(2);
  });

  test("a gap ends the run", () => {
    expect(streakOf(["2026-08-09", "2026-08-11"], "2026-08-12")).toBe(1);
    expect(streakOf([], "2026-08-12")).toBe(0);
  });

  test("skips a month boundary correctly", () => {
    expect(streakOf(["2026-07-31", "2026-08-01"], "2026-08-01")).toBe(2);
  });
});

describe("dailiesId", () => {
  test("cannot collide with an event ID", () => {
    // Event IDs are `game:slug:date`; these are deliberately two segments.
    expect(dailiesId("genshin")).toBe("dailies:genshin");
    expect(dailiesId("genshin").split(":")).toHaveLength(2);
  });
});

describe("a game whose day rolls on a different hour", () => {
  // Reverse: 1999 runs one global server on UTC-5 and resets at 05:00 rather
  // than 04:00, so its day rolls at 10:00 UTC. Both facts are read off the
  // source: every row of its event list states (UTC-5) and runs 05:00 → 04:59.
  test("rolls on 10:00 UTC, not the 09:00 a UTC-5 game would", () => {
    expect(dayKey(at("2026-08-16T09:59:59Z"), "europe", "r1999")).toBe(
      "2026-08-15",
    );
    expect(dayKey(at("2026-08-16T10:00:00Z"), "europe", "r1999")).toBe(
      "2026-08-16",
    );
    expect(nextResetMs(at("2026-08-16T08:00:00Z"), "europe", "r1999")).toBe(
      at("2026-08-16T10:00:00Z"),
    );
  });

  test("every region gets the same answer, because there is one server", () => {
    const instant = at("2026-08-16T09:30:00Z");
    const keys = (["asia", "america", "europe"] as const).map((r) =>
      dayKey(instant, r, "r1999"),
    );
    expect(new Set(keys).size).toBe(1);
  });

  test("resetHourFor defaults to 04:00 for every other game", () => {
    // Adding the field must not have moved a single existing reader's day key,
    // which is why it is an override rather than a per-game table.
    expect(resetHourFor("r1999")).toBe(5);
    for (const game of ["genshin", "endfield", undefined] as const) {
      expect(resetHourFor(game)).toBe(RESET_HOUR_LOCAL);
    }
    // A lane the reader invented has no server map and takes the default too.
    expect(resetHourFor("mygame:my-own-game")).toBe(RESET_HOUR_LOCAL);
  });

  test("an event's checklist counts days on the 05:00 clock", () => {
    const start = at("2026-08-13T10:00:00Z"); // an r1999 reset
    expect(dailyDays(start, start + 3 * DAY, "europe", "r1999")).toEqual([
      "2026-08-13",
      "2026-08-14",
      "2026-08-15",
    ]);
  });
});
