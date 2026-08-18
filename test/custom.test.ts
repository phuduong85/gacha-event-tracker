import { describe, expect, test } from "bun:test";
import {
  asDisplayEvent,
  CustomEvent,
  CustomGame,
  isCustomEventId,
  isCustomGameId,
  knownLane,
  mintCustomEventId,
  mintCustomGameId,
  precisionOf,
  RESERVED_ID_SEGMENTS,
  type CustomGames,
} from "../src/shared/custom.ts";
import { metaFor } from "../src/shared/games.ts";
import { dailiesId } from "../src/shared/daily.ts";
import { eventId, GameId } from "../src/shared/schema.ts";
import { clockFor } from "../src/shared/time.ts";
import { readerInstant, validRecords } from "../src/client/state/useCustom.ts";

const AT = "2026-08-17T12:00:00.000Z";

function ownEvent(over: Partial<CustomEvent> = {}): CustomEvent {
  return CustomEvent.parse({
    id: "myevent:k3f9qa2m01",
    game: "mygame:limbus-company",
    title: "Walpurgisnacht",
    type: "banner",
    summary: null,
    startsAt: "2026-08-20T00:00:00.000Z",
    startPrecision: "day",
    endsAt: "2026-09-03T00:00:00.000Z",
    endPrecision: "day",
    at: AT,
    updatedAt: AT,
    ...over,
  });
}

describe("reserved id segments", () => {
  test("no game id can ever occupy a reserved first segment", () => {
    // Every id in the app is colon-separated and the first segment decides
    // which key space it belongs to. The day a GameId is called "mygame" is the
    // day two spaces merge silently, and localStorage has no other copy.
    for (const reserved of RESERVED_ID_SEGMENTS) {
      expect(GameId.options as readonly string[]).not.toContain(reserved);
    }
  });

  test("the three spaces cannot produce the same key", () => {
    const feed = eventId("genshin", "Walpurgisnacht", "2026-08-20T00:00:00.000Z");
    const chore = dailiesId("genshin");
    const own = mintCustomEventId(() => 0.5);
    const ownGame = mintCustomGameId("Limbus Company");

    const keys = [feed, chore, own, ownGame];
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(key.split(":").length).toBeGreaterThanOrEqual(2);
    }
  });

  test("a reader's event never collides with the scraped event it names", () => {
    // The whole reason for a random suffix: they can type a tracked event's
    // exact title and date. Under the feed's scheme that is byte-identical.
    const scraped = eventId("genshin", "Windblume Festival", "2026-03-14T00:00:00.000Z");
    const mine = mintCustomEventId(() => 0.123456);
    expect(mine).not.toBe(scraped);
    expect(isCustomEventId(mine)).toBe(true);
    expect(isCustomEventId(scraped)).toBe(false);
  });
});

describe("minting ids", () => {
  test("a game id is slug-derived and disambiguated rather than overwritten", () => {
    expect(mintCustomGameId("Limbus Company")).toBe("mygame:limbus-company");
    // Two games called Nikke are two games.
    expect(mintCustomGameId("Nikke", ["mygame:nikke"])).toBe("mygame:nikke-2");
    expect(mintCustomGameId("Nikke", ["mygame:nikke", "mygame:nikke-2"])).toBe(
      "mygame:nikke-3",
    );
  });

  test("a game whose name slugifies to nothing still gets an id", () => {
    expect(mintCustomGameId("???")).toBe("mygame:game");
  });

  test("event ids match their schema and vary with the source of randomness", () => {
    const a = mintCustomEventId(() => 0.1);
    const b = mintCustomEventId(() => 0.9);
    expect(a).toMatch(/^myevent:[a-z0-9]{10}$/);
    expect(b).toMatch(/^myevent:[a-z0-9]{10}$/);
    expect(a).not.toBe(b);
    expect(isCustomGameId(a)).toBe(false);
  });
});

describe("CustomEvent", () => {
  test("an unannounced end is expressible, and must pair with unknown", () => {
    // A reader entering an event nobody has dated must not be forced to invent
    // one — that is the failure this whole product is built against.
    const open = ownEvent({ endsAt: null, endPrecision: "unknown" });
    expect(open.endsAt).toBeNull();

    expect(() =>
      CustomEvent.parse({ ...ownEvent(), endsAt: null, endPrecision: "day" }),
    ).toThrow();
    expect(() =>
      CustomEvent.parse({
        ...ownEvent(),
        endsAt: "2026-09-03T00:00:00.000Z",
        endPrecision: "unknown",
      }),
    ).toThrow();
  });

  test("rejects an end before its start", () => {
    expect(() =>
      CustomEvent.parse({ ...ownEvent(), endsAt: "2026-08-19T00:00:00.000Z" }),
    ).toThrow();
  });

  test("rejects an empty or oversized title", () => {
    expect(() => CustomEvent.parse({ ...ownEvent(), title: "" })).toThrow();
    expect(() =>
      CustomEvent.parse({ ...ownEvent(), title: "x".repeat(201) }),
    ).toThrow();
  });
});

describe("CustomGame", () => {
  test("a hue must be a hex colour, because it reaches a style attribute", () => {
    // An imported file is not necessarily one this reader wrote.
    const ok = CustomGame.parse({
      id: "mygame:limbus-company",
      name: "Limbus Company",
      hue: "#C74B50",
      at: AT,
    });
    expect(ok.hue).toBe("#C74B50");

    for (const hue of ["red", "url(javascript:alert(1))", "#fff", "#12345g", ""]) {
      expect(() =>
        CustomGame.parse({ id: "mygame:x", name: "X", hue, at: AT }),
      ).toThrow();
    }
  });

  test("rejects an id from another key space", () => {
    expect(() =>
      CustomGame.parse({ id: "genshin", name: "Genshin", hue: "#4EA8DE", at: AT }),
    ).toThrow();
  });
});

describe("asDisplayEvent", () => {
  test("carries no source and claims no region split", () => {
    const shown = asDisplayEvent(ownEvent());
    // Never attributed to a source: there is no page to send a sceptic to.
    expect(shown.sourceUrl).toBeNull();
    // One instant was entered, so inventing three would fabricate two of them.
    expect(shown.regionScoped).toBe(false);
    expect(shown.regionEnds).toBeNull();
    expect(shown.extractionMethod).toBe("manual");
    expect(shown.status).toBe("published");
  });

  test("runs on the same clock as a scraped event", () => {
    // Not a second countdown implementation — the identical one.
    const clock = clockFor(
      asDisplayEvent(ownEvent()),
      "america",
      Date.parse("2026-08-27T00:00:00.000Z"),
    );
    expect(clock.live).toBe(true);
    expect(clock.msRemaining).toBe(7 * 24 * 60 * 60 * 1000);
  });

  test("an unannounced end yields no countdown, exactly as the feed's does", () => {
    const clock = clockFor(
      asDisplayEvent(ownEvent({ endsAt: null, endPrecision: "unknown" })),
      "america",
      Date.parse("2026-08-27T00:00:00.000Z"),
    );
    expect(clock.msRemaining).toBeNull();
    expect(clock.urgency).toBe("calm");
  });
});

describe("precisionOf", () => {
  test("a date with no time of day is day precision", () => {
    // So the detail sheet's "accurate to the day only" note is honest about
    // the reader's input too, rather than presenting midnight as their choice.
    expect(precisionOf(false)).toBe("day");
    expect(precisionOf(true)).toBe("exact");
  });
});

describe("metaFor", () => {
  const mine: CustomGames = {
    "mygame:limbus-company": {
      id: "mygame:limbus-company",
      name: "Limbus Company",
      hue: "#C74B50",
      at: AT,
    },
  };

  test("answers for a tracked game unchanged", () => {
    expect(metaFor("genshin", mine).name).toBe("Genshin Impact");
    expect(metaFor("genshin", mine).studio).toBe("HoYoverse");
  });

  test("answers for one the reader defined, with no studio or chore", () => {
    const meta = metaFor("mygame:limbus-company", mine);
    expect(meta.name).toBe("Limbus Company");
    expect(meta.hue).toBe("#C74B50");
    // Nothing to credit in the colophon and no routine we could name for them.
    expect(meta.studio).toBe("");
    expect(meta.dailyTasks).toBe("");
  });

  test("is total, so a lane that outlived its game cannot blank the page", () => {
    // An import can carry an event whose game did not come with it.
    const meta = metaFor("mygame:deleted", mine);
    expect(meta.name).toBe("Unknown game");
    expect(meta.hue).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  test("shortens a long name rather than overflowing a chip", () => {
    const long: CustomGames = {
      "mygame:x": { id: "mygame:x", name: "Chaos Zero Nightmare", hue: "#123456", at: AT },
    };
    expect(metaFor("mygame:x", long).short.length).toBeLessThanOrEqual(12);
  });
});

describe("knownLane", () => {
  test("a tracked lane is always known; a reader's lane must still exist", () => {
    const mine: CustomGames = {
      "mygame:a": { id: "mygame:a", name: "A", hue: "#123456", at: AT },
    };
    expect(knownLane("genshin", mine)).toBe(true);
    expect(knownLane("mygame:a", mine)).toBe(true);
    expect(knownLane("mygame:gone", mine)).toBe(false);
  });
});

describe("readerInstant", () => {
  // Timezone-independent assertions on purpose: the point of this helper is
  // that it reads a typed date in the *reader's* zone, so the tests check the
  // relationships that must hold in any of them rather than pinning UTC.
  const localDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-CA"); // YYYY-MM-DD in local time

  test("a typed date comes back as that same date where the reader is", () => {
    // Someone who types 20 August means the 20th where they are, and has to see
    // the 20th back — not the 19th because a server is five hours behind.
    for (const boundary of ["start", "end"] as const) {
      const iso = readerInstant("2026-08-20", null, boundary);
      expect(iso).not.toBeNull();
      expect(localDate(iso!)).toBe("2026-08-20");
    }
  });

  test("a bare start is the beginning of the day and a bare end is the end of it", () => {
    // Which is how a person reads "20 Aug – 3 Sep": through the 3rd, not up to
    // the first second of it.
    const start = readerInstant("2026-08-20", null, "start")!;
    const end = readerInstant("2026-08-20", null, "end")!;
    expect(Date.parse(end) - Date.parse(start)).toBe(86_399_000);
  });

  test("a stated time is kept", () => {
    const iso = readerInstant("2026-08-20", "18:30", "start")!;
    const d = new Date(iso);
    expect(d.getHours()).toBe(18);
    expect(d.getMinutes()).toBe(30);
  });

  test("returns null for a date it cannot read, rather than a wrong one", () => {
    expect(readerInstant("", null, "start")).toBeNull();
    expect(readerInstant("not-a-date", null, "start")).toBeNull();
    expect(readerInstant("2026-02-30", null, "start")).toBeNull();
  });
});

describe("validRecords — the import gate", () => {
  test("keeps the good records and drops only the bad ones", () => {
    // A partly-corrupt file must not cost the reader the parts that are fine.
    const kept = validRecords(
      {
        "mygame:a": { id: "mygame:a", name: "A", hue: "#123456", at: AT },
        "mygame:b": { id: "mygame:b", name: "B", hue: "not-a-colour", at: AT },
        "mygame:c": "nonsense",
      },
      CustomGame,
    );
    expect(Object.keys(kept)).toEqual(["mygame:a"]);
  });

  test("refuses a hue that is not a hex colour", () => {
    // It reaches a style attribute, and an import is not necessarily a file
    // this reader wrote.
    const kept = validRecords(
      {
        "mygame:x": {
          id: "mygame:x",
          name: "X",
          hue: "red; background:url(javascript:alert(1))",
          at: AT,
        },
      },
      CustomGame,
    );
    expect(kept).toEqual({});
  });

  test("an export written before F13 simply has none", () => {
    // Not an error — a file from a device that had nothing of its own.
    expect(validRecords(undefined, CustomEvent)).toEqual({});
    expect(validRecords(null, CustomEvent)).toEqual({});
  });

  test("drops an event whose dates contradict themselves", () => {
    const kept = validRecords(
      {
        "myevent:aaaaaaaaaa": {
          ...ownEvent(),
          id: "myevent:aaaaaaaaaa",
          endsAt: "2026-08-01T00:00:00.000Z",
        },
      },
      CustomEvent,
    );
    expect(kept).toEqual({});
  });
});
