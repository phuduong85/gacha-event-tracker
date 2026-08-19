import { describe, expect, test } from "bun:test";
import {
  parseAdjacentFullRange,
  parseFullRange,
  parseIsoDay,
  parseLabelledStartEnd,
  parseMonthDayRange,
  parseMonthDayYear,
  parseOpenRange,
  parseOrdinalDateTimeRange,
  parseSlashClockZone,
  parseSlashDateTimeRange,
  parseYearFirstSlashRange,
  parseIsoClockRangeUtc,
  parseIsoOffsetInstant,
} from "../src/ingest/dates.ts";

describe("parseMonthDayYear", () => {
  test("parses a full date at day precision", () => {
    expect(parseMonthDayYear("August 12, 2026")).toEqual({
      iso: "2026-08-12T00:00:00.000Z",
      precision: "day",
    });
  });

  test("accepts abbreviated months with and without a period", () => {
    expect(parseMonthDayYear("Apr. 29, 2026")?.iso).toBe(
      "2026-04-29T00:00:00.000Z",
    );
    expect(parseMonthDayYear("Sept 3, 2026")?.iso).toBe(
      "2026-09-03T00:00:00.000Z",
    );
  });

  test("returns null rather than guessing a missing year", () => {
    expect(parseMonthDayYear("August 12")).toBeNull();
  });

  test("rejects impossible calendar dates", () => {
    expect(parseMonthDayYear("February 30, 2026")).toBeNull();
  });

  test("rejects an unknown month name", () => {
    expect(parseMonthDayYear("Smarch 3, 2026")).toBeNull();
  });
});

describe("parseMonthDayRange", () => {
  test("applies the stated year to both ends", () => {
    expect(parseMonthDayRange("August 12 - September 21, 2026")).toEqual({
      start: { iso: "2026-08-12T00:00:00.000Z", precision: "day" },
      end: { iso: "2026-09-21T00:00:00.000Z", precision: "day" },
    });
  });

  test("rolls the start back a year when the range crosses New Year", () => {
    // "December 28 - January 4, 2027" — the stated year belongs to the end.
    const r = parseMonthDayRange("December 28 - January 4, 2027");
    expect(r?.start.iso).toBe("2026-12-28T00:00:00.000Z");
    expect(r?.end.iso).toBe("2027-01-04T00:00:00.000Z");
  });

  test("handles en dash and abbreviated months", () => {
    const r = parseMonthDayRange("Apr. 29 – May 13, 2026");
    expect(r?.start.iso).toBe("2026-04-29T00:00:00.000Z");
    expect(r?.end.iso).toBe("2026-05-13T00:00:00.000Z");
  });

  test("returns null for a year-less range", () => {
    // Game8 summary tables render "08/12 - 08/24". Guessing the year here is
    // exactly the failure the product exists to prevent.
    expect(parseMonthDayRange("08/12 - 08/24")).toBeNull();
  });
});

describe("parseSlashDateTimeRange", () => {
  test("parses a timed range at exact precision", () => {
    expect(
      parseSlashDateTimeRange("2021/01/16 04:00 - 2021/01/31 03:59"),
    ).toEqual({
      start: { iso: "2021-01-16T04:00:00.000Z", precision: "exact" },
      end: { iso: "2021-01-31T03:59:00.000Z", precision: "exact" },
    });
  });

  test("ignores trailing prose after the range", () => {
    const r = parseSlashDateTimeRange(
      "2021/01/16 04:00 - 2021/01/31 03:59 Currently Unavailable",
    );
    expect(r?.end.iso).toBe("2021-01-31T03:59:00.000Z");
  });

  test("returns null for non-date prose", () => {
    expect(parseSlashDateTimeRange("Permanently Available")).toBeNull();
  });
});

describe("parseFullRange", () => {
  test("reads a year from each side", () => {
    expect(parseFullRange("Aug. 14, 2026 - Aug. 24, 2026")).toEqual({
      start: { iso: "2026-08-14T00:00:00.000Z", precision: "day" },
      end: { iso: "2026-08-24T00:00:00.000Z", precision: "day" },
    });
  });

  test("ignores prose trailing the range", () => {
    const r = parseFullRange(
      "July 30, 2026 - August 13, 2026 Reach Union Level 8 to unlock",
    );
    expect(r?.end.iso).toBe("2026-08-13T00:00:00.000Z");
  });

  test("does not fire on a range with the year only at the end", () => {
    // That shape belongs to parseMonthDayRange, which rolls the start year.
    expect(parseFullRange("August 12 - September 21, 2026")).toBeNull();
  });
});

describe("parseOpenRange", () => {
  test("keeps a real start when the end is not a date", () => {
    // "End of 4.6" and "Permanent" are honest unknowns, not parse failures.
    for (const input of [
      "Jul. 24, 2026 - End of 4.6",
      "July 10, 2026 - Permanent",
      "August 3, 2026",
    ]) {
      const r = parseOpenRange(input);
      expect(r?.end).toBeNull();
      expect(r?.start.iso.slice(0, 4)).toBe("2026");
    }
  });

  test("returns null when there is no full date at all", () => {
    expect(parseOpenRange("08/12 - 08/24")).toBeNull();
    expect(parseOpenRange("Releases in Version 3.6")).toBeNull();
  });
});

describe("parseAdjacentFullRange", () => {
  test("reads two dates separated by nothing but whitespace", () => {
    // Persona 5 separates the halves of a duration cell with an <hr>, which a
    // tag-stripping reader flattens to a single space.
    expect(parseAdjacentFullRange("July 30, 2026 August 13, 2026")).toEqual({
      start: { iso: "2026-07-30T00:00:00.000Z", precision: "day" },
      end: { iso: "2026-08-13T00:00:00.000Z", precision: "day" },
    });
  });

  test("requires a year on both halves", () => {
    expect(parseAdjacentFullRange("July 30, 2026 August 13")).toBeNull();
  });

  test("refuses a second half that is only partly a date", () => {
    // "July 16/30" names two candidate ends. Reading either as the end would
    // be a coin flip presented as a fact.
    expect(parseAdjacentFullRange("June 25, 2026 July 16/30, 2026")).toBeNull();
  });

  test("is anchored, so prose after a date is not read as an end", () => {
    // Without the anchors, "Day 3" parses as a month and a day.
    expect(
      parseAdjacentFullRange("August 12, 2026 Day 3 rewards are doubled"),
    ).toBeNull();
    expect(parseAdjacentFullRange("Starts August 12, 2026")).toBeNull();
  });

  test("rejects an impossible calendar date rather than rolling it over", () => {
    expect(parseAdjacentFullRange("February 30, 2026 March 4, 2026")).toBeNull();
  });
});

describe("parseLabelledStartEnd", () => {
  test("reads a labelled cell", () => {
    expect(
      parseLabelledStartEnd("Start: April 28, 2025 End: June 12, 2025"),
    ).toEqual({
      start: { iso: "2025-04-28T00:00:00.000Z", precision: "day" },
      end: { iso: "2025-06-12T00:00:00.000Z", precision: "day" },
    });
  });

  test("reports no end when the end half is not a date", () => {
    // "Permanent" is the source telling us there is no deadline. Inventing one
    // is the failure this codebase exists to prevent.
    const permanent = parseLabelledStartEnd(
      "Start: January 24, 2025 End: Permanent",
    );
    expect(permanent?.start.iso).toBe("2025-01-24T00:00:00.000Z");
    expect(permanent?.end).toBeNull();

    expect(parseLabelledStartEnd("Start: January 24, 2025 End: TBD")?.end).toBeNull();
    expect(parseLabelledStartEnd("Start: January 24, 2025")?.end).toBeNull();
  });

  test("returns null when the start half is not a date", () => {
    expect(parseLabelledStartEnd("Start: After maintenance End: TBD")).toBeNull();
    expect(parseLabelledStartEnd("Ends after 30 days of making your account.")).toBeNull();
  });

  test("requires the colons, so prose containing 'end' does not split", () => {
    // Without them, any sentence mentioning an end would look like a boundary.
    expect(
      parseLabelledStartEnd("Start the quest before August 12, 2026 to end the arc"),
    ).toBeNull();
  });
});

describe("parseYearFirstSlashRange", () => {
  test("reads a year-first range at day precision", () => {
    expect(parseYearFirstSlashRange("2026/07/30 – 2026/08/20")).toEqual({
      start: { iso: "2026-07-30T00:00:00.000Z", precision: "day" },
      end: { iso: "2026-08-20T00:00:00.000Z", precision: "day" },
    });
  });

  test("accepts a hyphen as well as an en dash", () => {
    expect(parseYearFirstSlashRange("2026/07/30 - 2026/08/20")?.end.iso).toBe(
      "2026-08-20T00:00:00.000Z",
    );
  });

  test("ignores an ISO timestamp sitting beside the range", () => {
    // The Arknights wiki prints the countdown target in the same cell:
    // "2026/07/30 – 2026/08/20; ends in 2026-08-20T10:59:59+00:00". The dashes
    // in the ISO half must not be read as a second range.
    const r = parseYearFirstSlashRange(
      "2026/07/30 – 2026/08/20; ends in 2026-08-20T10:59:59+00:00",
    );
    expect(r?.start.iso).toBe("2026-07-30T00:00:00.000Z");
    expect(r?.end.iso).toBe("2026-08-20T00:00:00.000Z");
  });

  test("rejects an impossible calendar date rather than rolling it over", () => {
    expect(parseYearFirstSlashRange("2026/02/30 – 2026/03/17")).toBeNull();
  });

  test("returns null when either side is missing its year", () => {
    expect(parseYearFirstSlashRange("07/30 – 2026/08/20")).toBeNull();
    expect(parseYearFirstSlashRange("2026/07/30 – 08/20")).toBeNull();
  });
});

describe("parseOrdinalDateTimeRange", () => {
  test("reads ordinal days, times and a stated offset", () => {
    const range = parseOrdinalDateTimeRange(
      "August 13th, 05:00 - September 21st, 2026, 04:59 (UTC-5)",
    );
    // 05:00 at UTC-5 is 10:00Z. Reading the wall clock as UTC — which is all
    // parseSlashDateTimeRange can do, because its source states no offset —
    // would put both boundaries five hours early.
    expect(range?.start.iso).toBe("2026-08-13T10:00:00.000Z");
    expect(range?.end.iso).toBe("2026-09-21T09:59:00.000Z");
    expect(range?.start.precision).toBe("exact");
    expect(range?.end.precision).toBe("exact");
  });

  test("takes the year from the end when the start omits it", () => {
    const range = parseOrdinalDateTimeRange(
      "November 9th, 05:00 - December 4th, 2023, 04:59 (UTC-5)",
    );
    expect(range?.start.iso).toBe("2023-11-09T10:00:00.000Z");
    expect(range?.end.iso).toBe("2023-12-04T09:59:00.000Z");
  });

  test("rolls the start year back across New Year", () => {
    const range = parseOrdinalDateTimeRange(
      "December 28th, 05:00 - January 18th, 2024, 04:59 (UTC-5)",
    );
    expect(range?.start.iso).toBe("2023-12-28T10:00:00.000Z");
    expect(range?.end.iso).toBe("2024-01-18T09:59:00.000Z");
  });

  test("honours a year stated on both halves", () => {
    const range = parseOrdinalDateTimeRange(
      "December 28th, 2023, 05:00 - January 18th, 2024, 04:59 (UTC-5)",
    );
    expect(range?.start.iso).toBe("2023-12-28T10:00:00.000Z");
    expect(range?.end.iso).toBe("2024-01-18T09:59:00.000Z");
  });

  test("returns null when no year is stated at all", () => {
    // The one row on the Reverse: 1999 page in this shape. There is no year to
    // infer from and inventing one is the failure this module exists to avoid.
    expect(
      parseOrdinalDateTimeRange("February 20th, 05:00 - March 27th, 04:59 (UTC-5)"),
    ).toBeNull();
  });

  test("returns null when the offset is not stated", () => {
    // A missing timezone is a missing fact. Defaulting it to UTC would be a
    // guess dressed as data.
    expect(
      parseOrdinalDateTimeRange("August 13th, 05:00 - September 21st, 2026, 04:59"),
    ).toBeNull();
  });

  test("requires the ordinal suffix that anchors the format", () => {
    expect(
      parseOrdinalDateTimeRange("August 13, 05:00 - September 21, 2026, 04:59 (UTC-5)"),
    ).toBeNull();
  });

  test("does not match a range buried in prose", () => {
    expect(
      parseOrdinalDateTimeRange(
        "Runs August 13th, 05:00 - September 21st, 2026, 04:59 (UTC-5) for everyone",
      ),
    ).toBeNull();
  });

  test("rejects an impossible date in the timezone it was written in", () => {
    // Validating after the offset shift would turn this into a real instant in
    // March instead of rejecting it.
    expect(
      parseOrdinalDateTimeRange(
        "February 30th, 05:00 - March 27th, 2026, 04:59 (UTC-5)",
      ),
    ).toBeNull();
  });

  test("signs the minutes of a half-hour offset with the hours", () => {
    // -3:30 is three and a half hours behind UTC, not three behind and thirty
    // ahead: 05:00 at UTC-3:30 is 08:30Z.
    const range = parseOrdinalDateTimeRange(
      "August 13th, 05:00 - September 21st, 2026, 04:59 (UTC-3:30)",
    );
    expect(range?.start.iso).toBe("2026-08-13T08:30:00.000Z");
  });

  test("accepts a tilde separator", () => {
    const range = parseOrdinalDateTimeRange(
      "August 13th, 05:00 ~ September 21st, 2026, 04:59 (UTC-5)",
    );
    expect(range?.start.iso).toBe("2026-08-13T10:00:00.000Z");
  });
});

describe("parseIsoDay", () => {
  test("parses a bare ISO date at day precision", () => {
    expect(parseIsoDay("2026-08-04")).toEqual({
      iso: "2026-08-04T00:00:00.000Z",
      precision: "day",
    });
  });

  test("tolerates the whitespace a table cell carries", () => {
    expect(parseIsoDay(" 2026-09-15 ")?.iso).toBe("2026-09-15T00:00:00.000Z");
  });

  test("rejects an impossible calendar date", () => {
    expect(parseIsoDay("2026-02-30")).toBeNull();
    expect(parseIsoDay("2026-13-01")).toBeNull();
  });

  test("refuses a date embedded in anything else", () => {
    // Anchored at both ends because this is the least distinctive shape in this
    // module. Unanchored it finds dates in article slugs and version strings.
    expect(parseIsoDay("Rerun 2026-08-04")).toBeNull();
    expect(parseIsoDay("2026-08-04 - 2026-08-18")).toBeNull();
    // The page's other schedule tables write their boundaries this way, with a
    // wall clock and no timezone anywhere. Reading one as UTC would invent the
    // fact that matters most, so this reader takes none of them.
    expect(parseIsoDay("08/12/2026 11:00")).toBeNull();
  });

  test("does not accept a partial date", () => {
    expect(parseIsoDay("2026-08")).toBeNull();
    expect(parseIsoDay("2026")).toBeNull();
    expect(parseIsoDay("TBA")).toBeNull();
    expect(parseIsoDay("")).toBeNull();
  });
});

describe("parseSlashClockZone", () => {
  test("converts a stated JST wall clock to UTC", () => {
    expect(parseSlashClockZone("08/17/2026 8:00PM (JST)")).toEqual({
      iso: "2026-08-17T11:00:00.000Z",
      precision: "exact",
    });
  });

  test("a small-hours JST boundary lands on the previous UTC day", () => {
    // The shift that makes storing the source's own wall clock unusable.
    expect(parseSlashClockZone("08/30/2026 3:59AM (JST)")?.iso).toBe(
      "2026-08-29T18:59:00.000Z",
    );
  });

  test("12PM is noon and 12AM is midnight", () => {
    expect(parseSlashClockZone("08/20/2026 12:00PM (JST)")?.iso).toBe(
      "2026-08-20T03:00:00.000Z",
    );
    expect(parseSlashClockZone("08/21/2026 12:00AM (JST)")?.iso).toBe(
      "2026-08-20T15:00:00.000Z",
    );
  });

  test("an unstated or unknown zone is null, never UTC", () => {
    expect(parseSlashClockZone("08/20/2026 12:00PM")).toBeNull();
    // Not in the table, and deliberately: `CST` names three different zones.
    expect(parseSlashClockZone("08/20/2026 12:00PM (CST)")).toBeNull();
  });

  test("rejects a non-date and an impossible calendar day", () => {
    expect(parseSlashClockZone("Game Launch")).toBeNull();
    expect(parseSlashClockZone("Unknown")).toBeNull();
    // Validated on the stated local fields, before the offset shifts anything:
    // converting first would quietly turn Feb 30 into a real instant in March.
    expect(parseSlashClockZone("02/30/2026 12:00PM (JST)")).toBeNull();
    expect(parseSlashClockZone("08/20/2026 13:00PM (JST)")).toBeNull();
  });

  test("is a whole-cell reader, not a scanner", () => {
    // Anchored at both ends: letting this match mid-prose is how a reader
    // starts finding dates inside sentences.
    expect(
      parseSlashClockZone("Starts 08/20/2026 12:00PM (JST) after maintenance"),
    ).toBeNull();
  });
});

describe("parseIsoClockRangeUtc", () => {
  test("reads both boundaries exact, converting nothing", () => {
    // IOP Wiki states the zone itself, so this is the one range reader here
    // that assumes no offset anywhere.
    const range = parseIsoClockRangeUtc(
      "2026-08-06 13:00 - 2026-08-26 22:59 (UTC)",
    );
    expect(range?.start.iso).toBe("2026-08-06T13:00:00.000Z");
    expect(range?.end.iso).toBe("2026-08-26T22:59:00.000Z");
    expect(range?.start.precision).toBe("exact");
    expect(range?.end.precision).toBe("exact");
  });

  test("accepts the en dash and the non-breaking spaces the page emits", () => {
    // The wiki writes `&#160;-&#160;`, which `text()` decodes to spaces.
    expect(
      parseIsoClockRangeUtc("2025-01-16 17:00 – 2025-02-06 02:59 (UTC)")?.end
        .iso,
    ).toBe("2025-02-06T02:59:00.000Z");
  });

  test("requires the stated zone rather than defaulting to UTC", () => {
    // The failure this prevents is silent and hours wide: a wall clock with no
    // zone is a missing fact, exactly as it is in `parseSlashClockZone`.
    expect(parseIsoClockRangeUtc("2026-08-06 13:00 - 2026-08-26 22:59")).toBeNull();
    expect(
      parseIsoClockRangeUtc("2026-08-06 13:00 - 2026-08-26 22:59 (UTC+8)"),
    ).toBeNull();
  });

  test("rejects an impossible calendar day", () => {
    expect(
      parseIsoClockRangeUtc("2026-02-30 13:00 - 2026-03-26 22:59 (UTC)"),
    ).toBeNull();
    expect(
      parseIsoClockRangeUtc("2026-08-06 25:00 - 2026-08-26 22:59 (UTC)"),
    ).toBeNull();
  });

  test("is anchored at the start, so it cannot find a range inside prose", () => {
    expect(
      parseIsoClockRangeUtc("Runs 2026-08-06 13:00 - 2026-08-26 22:59 (UTC)"),
    ).toBeNull();
  });

  test("tolerates the ICS widget's leftovers after the zone", () => {
    // The period cell also carries an export widget; the parser strips its
    // markup but the container survives as trailing whitespace.
    expect(
      parseIsoClockRangeUtc("2026-08-06 13:00 - 2026-08-26 22:59 (UTC)   ")
        ?.start.iso,
    ).toBe("2026-08-06T13:00:00.000Z");
  });
});

describe("parseIsoOffsetInstant", () => {
  test("converts a stated offset to UTC", () => {
    // Stella Sora's front page emits its banner window as real `<time datetime>`
    // attributes, so the offset is in the markup rather than printed for a
    // human to interpret.
    expect(parseIsoOffsetInstant("2026-08-03T21:00-07:00")?.iso).toBe(
      "2026-08-04T04:00:00.000Z",
    );
    expect(parseIsoOffsetInstant("2026-08-03T21:00-07:00")?.precision).toBe(
      "exact",
    );
  });

  test("accepts Z and seconds", () => {
    expect(parseIsoOffsetInstant("2026-08-03T21:00:00Z")?.iso).toBe(
      "2026-08-03T21:00:00.000Z",
    );
  });

  test("requires the offset rather than defaulting to UTC", () => {
    // The sibling `Banner_List` prints the same instants with no zone anywhere
    // on the page. Reading those as UTC is the assumption this reader exists to
    // refuse.
    expect(parseIsoOffsetInstant("2026-08-03T21:00")).toBeNull();
    expect(parseIsoOffsetInstant("2026-08-03 21:00-07:00")).toBeNull();
  });

  test("rejects an impossible calendar day, before the offset shifts it", () => {
    // Converting first would quietly turn February 30 into a real March instant.
    expect(parseIsoOffsetInstant("2026-02-30T21:00-07:00")).toBeNull();
  });

  test("is anchored, so it cannot read an instant out of prose", () => {
    expect(parseIsoOffsetInstant("Starts 2026-08-03T21:00-07:00")).toBeNull();
  });
});
