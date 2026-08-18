import { describe, expect, test } from "bun:test";
import type { GachaEvent } from "../src/shared/schema.ts";
import {
  clockFor,
  DAY,
  endingSoonestFirst,
  formatRemaining,
  HOUR,
  urgency,
} from "../src/shared/time.ts";

const NOW = Date.parse("2026-08-15T12:00:00.000Z");

function event(overrides: Partial<GachaEvent> = {}): GachaEvent {
  return {
    id: "genshin:x:2026-08-10",
    game: "genshin",
    title: "X",
    type: "other",
    summary: null,
    startsAt: "2026-08-10T00:00:00.000Z",
    startPrecision: "day",
    endsAt: "2026-08-20T00:00:00.000Z",
    endPrecision: "day",
    regionScoped: false,
    regionEnds: null,
    sourceUrl: "https://example.test/a",
    sourceId: "s",
    status: "published",
    confidence: 0.9,
    extractionMethod: "parser",
    version: 1,
    firstSeenAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("formatRemaining", () => {
  test("drops to a finer unit as the deadline closes", () => {
    // Days are useless once minutes decide whether you make it.
    expect(formatRemaining(9 * DAY + 3 * HOUR)).toBe("9d 3h");
    expect(formatRemaining(4 * HOUR + 12 * 60_000)).toBe("4h 12m");
    expect(formatRemaining(90_000)).toBe("1m 30s");
    expect(formatRemaining(0)).toBe("ended");
    expect(formatRemaining(-5)).toBe("ended");
  });
});

describe("urgency", () => {
  test("is driven by absolute time left, not proportion", () => {
    expect(urgency(2 * HOUR)).toBe("critical");
    expect(urgency(2 * DAY)).toBe("soon");
    expect(urgency(5 * DAY)).toBe("near");
    expect(urgency(40 * DAY)).toBe("calm");
    expect(urgency(-1)).toBe("expired");
  });
});

describe("clockFor", () => {
  test("reports progress through the window", () => {
    const c = clockFor(event(), "america", NOW);
    expect(c.live).toBe(true);
    expect(c.progress).toBeCloseTo(0.55, 2);
    expect(c.msRemaining).toBe(Date.parse("2026-08-20T00:00:00.000Z") - NOW);
  });

  test("an unannounced end is never urgent and has no progress", () => {
    // "We don't know" and "loads of time" are different facts. Treating an
    // unknown end as a deadline would be inventing one.
    const c = clockFor(
      event({ endsAt: null, endPrecision: "unknown" }),
      "america",
      NOW,
    );
    expect(c.msRemaining).toBeNull();
    expect(c.progress).toBeNull();
    expect(c.urgency).toBe("calm");
    expect(c.ended).toBe(false);
  });

  test("resolves a region-scoped end to the reader's region", () => {
    const c = clockFor(
      event({
        regionScoped: true,
        regionEnds: {
          asia: "2026-08-20T00:00:00.000Z",
          america: "2026-08-20T13:00:00.000Z",
        },
      }),
      "america",
      NOW,
    );
    expect(c.endsMs).toBe(Date.parse("2026-08-20T13:00:00.000Z"));
  });

  test("marks an event that has not started as upcoming", () => {
    const c = clockFor(
      event({ startsAt: "2026-09-01T00:00:00.000Z", endsAt: "2026-09-10T00:00:00.000Z" }),
      "america",
      NOW,
    );
    expect(c.upcoming).toBe(true);
    expect(c.live).toBe(false);
  });
});

describe("endingSoonestFirst", () => {
  test("live before upcoming, soonest end first, unknown ends last", () => {
    const rows = [
      { key: "upcoming", clock: clockFor(event({ startsAt: "2026-09-01T00:00:00.000Z", endsAt: "2026-09-10T00:00:00.000Z" }), "america", NOW) },
      { key: "unknown", clock: clockFor(event({ endsAt: null, endPrecision: "unknown" }), "america", NOW) },
      { key: "later", clock: clockFor(event({ endsAt: "2026-08-25T00:00:00.000Z" }), "america", NOW) },
      { key: "soonest", clock: clockFor(event({ endsAt: "2026-08-16T00:00:00.000Z" }), "america", NOW) },
    ];
    expect([...rows].sort(endingSoonestFirst).map((r) => r.key)).toEqual([
      "soonest",
      "later",
      "unknown",
      "upcoming",
    ]);
  });
});
