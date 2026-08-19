/**
 * Deterministic date parsing for adapter sources.
 *
 * Every function here returns null rather than guessing. A source that does not
 * state a year, a month, or an end does not get one invented — see
 * docs/PRD.md § Quality bar. Returning null is a correct outcome.
 */

import type { Precision } from "../shared/schema.ts";

export interface ParsedInstant {
  /** UTC ISO 8601. */
  iso: string;
  precision: Extract<Precision, "exact" | "day">;
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  // Game8 abbreviates in some tables ("Apr. 29 - May 13, 2026"). Without these
  // such rows parse as null and the events vanish silently, which is a worse
  // failure than a wrong date because nothing surfaces it.
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7,
  aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function monthNumber(name: string): number | null {
  return MONTHS[name.toLowerCase().replace(/\.$/, "")] ?? null;
}

function iso(
  y: number,
  m: number,
  d: number,
  hh = 0,
  mm = 0,
  ss = 0,
): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || hh > 23 || mm > 59 || ss > 59) {
    return null;
  }
  const date = new Date(Date.UTC(y, m - 1, d, hh, mm, ss, 0));
  // Rejects impossible calendar dates such as February 30.
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString();
}

/** "August 12, 2026" → 2026-08-12T00:00:00.000Z, day precision. */
export function parseMonthDayYear(input: string): ParsedInstant | null {
  const m = /([A-Za-z]+)\.?\s+(\d{1,2}),\s*(\d{4})/.exec(input);
  if (!m) return null;
  const month = monthNumber(m[1] ?? "");
  if (month === null) return null;
  const value = iso(Number(m[3]), month, Number(m[2]));
  return value === null ? null : { iso: value, precision: "day" };
}

/**
 * "2026-08-04" → 2026-08-04T00:00:00.000Z, day precision.
 *
 * A whole cell, anchored at both ends, because this is the least distinctive
 * shape here: unanchored it would find a date inside a version string or an
 * article slug. Blue Archive's wiki gives each boundary its own column and
 * writes it as a bare ISO date, so unlike every range above there is nothing to
 * split and no field order to infer.
 *
 * Rejects an impossible calendar date (`2026-02-30`) through `iso`, and states
 * `day` rather than `exact` because the source publishes no time of day.
 */
export function parseIsoDay(input: string): ParsedInstant | null {
  const m = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})\s*$/.exec(input);
  if (!m) return null;
  const value = iso(Number(m[1]), Number(m[2]), Number(m[3]));
  return value === null ? null : { iso: value, precision: "day" };
}

/**
 * "August 12 - September 21, 2026" → both instants, year taken from the end.
 * A range whose end carries no year is unresolvable and returns null.
 */
export function parseMonthDayRange(
  input: string,
): { start: ParsedInstant; end: ParsedInstant } | null {
  const m =
    /([A-Za-z]+)\.?\s+(\d{1,2})\s*[-–—]\s*([A-Za-z]+)\.?\s+(\d{1,2}),\s*(\d{4})/.exec(
      input,
    );
  if (!m) return null;
  const startMonth = monthNumber(m[1] ?? "");
  const endMonth = monthNumber(m[3] ?? "");
  if (startMonth === null || endMonth === null) return null;

  const year = Number(m[5]);
  // A range that crosses New Year renders as "December 28 - January 4, 2027",
  // where the stated year belongs to the end. Roll the start back a year.
  const startYear = startMonth > endMonth ? year - 1 : year;

  const startIso = iso(startYear, startMonth, Number(m[2]));
  const endIso = iso(year, endMonth, Number(m[4]));
  if (startIso === null || endIso === null) return null;

  return {
    start: { iso: startIso, precision: "day" },
    end: { iso: endIso, precision: "day" },
  };
}

/**
 * "Aug. 14, 2026 - Aug. 24, 2026" → both instants.
 *
 * Distinct from parseMonthDayRange, where the single stated year belongs to the
 * end. Here both sides carry their own year, so nothing has to be inferred.
 * Trailing prose after the range is ignored.
 */
export function parseFullRange(
  input: string,
): { start: ParsedInstant; end: ParsedInstant } | null {
  const re =
    /([A-Za-z]+)\.?\s+(\d{1,2}),\s*(\d{4})\s*[-–—]\s*([A-Za-z]+)\.?\s+(\d{1,2}),\s*(\d{4})/;
  const m = re.exec(input);
  if (!m) return null;

  const startMonth = monthNumber(m[1] ?? "");
  const endMonth = monthNumber(m[4] ?? "");
  if (startMonth === null || endMonth === null) return null;

  const startIso = iso(Number(m[3]), startMonth, Number(m[2]));
  const endIso = iso(Number(m[6]), endMonth, Number(m[5]));
  if (startIso === null || endIso === null) return null;

  return {
    start: { iso: startIso, precision: "day" },
    end: { iso: endIso, precision: "day" },
  };
}

/**
 * "08/09/26 - 08/30/26" → both instants. Also accepts a four-digit year.
 *
 * Month-first ordering is not assumed lightly: Game8 writes long dates
 * US-style ("August 12, 2026"), and Endfield's own version grid reads 01/22,
 * 04/17, 07/16 for versions 1.0, 1.2 and 1.4 — chronological only if the month
 * comes first. A day-first reading would make 04/17 an invalid month.
 *
 * Two-digit years pivot at 70: 26 → 2026. The validator's sanity window
 * (start within [now-2y, now+1y]) catches anything this gets wrong.
 */
export function parseShortSlashRange(
  input: string,
): { start: ParsedInstant; end: ParsedInstant } | null {
  const re =
    /(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*[-–—]\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/;
  const m = re.exec(input);
  if (!m) return null;

  const year = (raw: string) => {
    const n = Number(raw);
    return raw.length <= 2 ? (n < 70 ? 2000 + n : 1900 + n) : n;
  };
  const n = (i: number) => Number(m[i]);

  const startIso = iso(year(m[3] ?? ""), n(1), n(2));
  const endIso = iso(year(m[6] ?? ""), n(4), n(5));
  if (startIso === null || endIso === null) return null;

  return {
    start: { iso: startIso, precision: "day" },
    end: { iso: endIso, precision: "day" },
  };
}

/**
 * "July 30, 2026 August 13, 2026" → both instants.
 *
 * Game8 separates the two halves of a duration cell with `<hr>` rather than a
 * dash on some templates, and a tag-stripping reader sees only whitespace
 * between them. Both anchors and both years are required: without the anchors
 * this would happily read "August 12, 2026 Day 3 rewards" as a range, and a
 * bare "Month D" second half could belong to any year.
 */
export function parseAdjacentFullRange(
  input: string,
): { start: ParsedInstant; end: ParsedInstant } | null {
  const re =
    /^\s*([A-Za-z]+)\.?\s+(\d{1,2}),\s*(\d{4})\s+([A-Za-z]+)\.?\s+(\d{1,2}),\s*(\d{4})\s*$/;
  const m = re.exec(input);
  if (!m) return null;

  const startMonth = monthNumber(m[1] ?? "");
  const endMonth = monthNumber(m[4] ?? "");
  if (startMonth === null || endMonth === null) return null;

  const startIso = iso(Number(m[3]), startMonth, Number(m[2]));
  const endIso = iso(Number(m[6]), endMonth, Number(m[5]));
  if (startIso === null || endIso === null) return null;

  return {
    start: { iso: startIso, precision: "day" },
    end: { iso: endIso, precision: "day" },
  };
}

/**
 * "Start: January 24, 2025 End: Permanent" → the start, and whatever the end
 * half turns out to be.
 *
 * A labelled cell rather than a range: the two halves are separated by a `<br>`
 * and each carries its own word. The colons are required, which is what stops
 * the word "end" inside a description from splitting a cell that is really
 * prose.
 *
 * An end half that is not a date ("Permanent", "TBD", "After maintenance")
 * yields a null end rather than an invented one — the same outcome as
 * `parseOpenRange`, and for the same reason.
 */
export function parseLabelledStartEnd(
  input: string,
): { start: ParsedInstant; end: ParsedInstant | null } | null {
  const m = /^\s*start\s*[:：]\s*(.+?)(?:\s+end\s*[:：]\s*(.*?))?\s*$/i.exec(
    input,
  );
  if (!m) return null;

  const start = parseMonthDayYear(m[1] ?? "");
  if (start === null) return null;

  const endHalf = m[2];
  return { start, end: endHalf === undefined ? null : parseMonthDayYear(endHalf) };
}

/**
 * A range whose start is a real date but whose end is not: "July 10, 2026 -
 * Permanent", "Jul. 24, 2026 - End of 4.6", or a lone start date.
 *
 * Returns a null end rather than inventing one. These are common and correct —
 * the source genuinely has not announced an end — and the UI renders them
 * distinctly from an event ending far in the future.
 *
 * Deliberately the last parser tried, because it is the most permissive.
 */
export function parseOpenRange(
  input: string,
): { start: ParsedInstant; end: null } | null {
  const start = parseMonthDayYear(input);
  return start === null ? null : { start, end: null };
}

/**
 * "2026/07/30 – 2026/08/20" → both instants, day precision.
 *
 * Year-first, unlike `parseShortSlashRange`'s MM/DD/YY, so there is nothing to
 * infer about field order: a four-digit leading number can only be the year.
 * The Arknights wiki writes its release windows this way, one line per server.
 *
 * Anchored on the four-digit year at both ends deliberately. Without it the
 * looser MM/DD/YY reader matches the tail of "2026/07/30" as "26/07/30" and
 * calls month 26 an invalid date — null either way, but by accident rather than
 * by rule.
 */
export function parseYearFirstSlashRange(
  input: string,
): { start: ParsedInstant; end: ParsedInstant } | null {
  const re =
    /(\d{4})\/(\d{1,2})\/(\d{1,2})\s*[-–—]\s*(\d{4})\/(\d{1,2})\/(\d{1,2})/;
  const m = re.exec(input);
  if (!m) return null;

  const n = (i: number) => Number(m[i]);
  const startIso = iso(n(1), n(2), n(3));
  const endIso = iso(n(4), n(5), n(6));
  if (startIso === null || endIso === null) return null;

  return {
    start: { iso: startIso, precision: "day" },
    end: { iso: endIso, precision: "day" },
  };
}

/**
 * "November 9th, 05:00 - December 4th, 2023, 04:59 (UTC-5)" → both instants,
 * exact precision, converted from the stated offset to UTC.
 *
 * The Reverse: 1999 wiki writes every window this way. Three things make it
 * worth its own reader rather than a variant of one above:
 *
 * - **Ordinal days** (`9th`, `23rd`, `04th`). Required on both halves, and they
 *   are what anchors this pattern: without them the looser readers above would
 *   have first claim on the text.
 * - **The offset is stated, so nothing is assumed.** `parseSlashDateTimeRange`
 *   has to read its wall-clock times as UTC and says so; here `(UTC-5)` is
 *   part of the format, and a cell without one returns null rather than being
 *   read as UTC. A missing timezone is a missing fact like any other.
 * - **The year sits on the end half**, and only sometimes on the start. A range
 *   crossing New Year reads "December 28th, 05:00 - January 18th, 2024, 04:59",
 *   so the start year rolls back exactly as in `parseMonthDayRange`.
 *
 * Anchored at both ends: this is a whole-cell format, and letting it match
 * mid-prose is how a reader starts finding ranges in sentences.
 */
export function parseOrdinalDateTimeRange(
  input: string,
): { start: ParsedInstant; end: ParsedInstant } | null {
  const re =
    /^\s*([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th),\s*(?:(\d{4}),\s*)?(\d{1,2}):(\d{2})\s*[-–—~]\s*([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th),\s*(\d{4}),\s*(\d{1,2}):(\d{2})\s*\(UTC\s*([+-]\d{1,2})(?::(\d{2}))?\)\s*$/;
  const m = re.exec(input);
  if (!m) return null;

  const startMonth = monthNumber(m[1] ?? "");
  const endMonth = monthNumber(m[6] ?? "");
  if (startMonth === null || endMonth === null) return null;

  const endYear = Number(m[8]);
  // The start states its own year only sometimes. Absent, it belongs to the same
  // year as the end unless the range crosses New Year.
  const startYear =
    m[3] !== undefined
      ? Number(m[3])
      : startMonth > endMonth
        ? endYear - 1
        : endYear;

  const offsetMs = offsetMilliseconds(m[11] ?? "", m[12]);
  if (offsetMs === null) return null;

  const startIso = offsetIso(
    startYear,
    startMonth,
    Number(m[2]),
    Number(m[4]),
    Number(m[5]),
    offsetMs,
  );
  const endIso = offsetIso(
    endYear,
    endMonth,
    Number(m[7]),
    Number(m[9]),
    Number(m[10]),
    offsetMs,
  );
  if (startIso === null || endIso === null) return null;

  return {
    start: { iso: startIso, precision: "exact" },
    end: { iso: endIso, precision: "exact" },
  };
}

/**
 * A stated `(UTC±H[:MM])` offset in milliseconds.
 *
 * The minutes are written unsigned, so `-3:30` means three and a half hours
 * behind UTC rather than three behind and thirty ahead. Signing the whole
 * magnitude is what gets that right, and `-0:30` — a sign with a zero hour —
 * only works because the sign is read from the text rather than from `Number`,
 * which cannot tell `-0` from `0`.
 */
function offsetMilliseconds(
  hours: string,
  minutes: string | undefined,
): number | null {
  const magnitude = Math.abs(Number(hours));
  const mins = minutes === undefined ? 0 : Number(minutes);
  if (!Number.isFinite(magnitude) || magnitude > 14 || mins > 59) return null;
  const sign = hours.trimStart().startsWith("-") ? -1 : 1;
  return sign * (magnitude * 60 + mins) * 60_000;
}

/**
 * A local wall-clock reading plus the offset it was stated in, as a UTC ISO
 * string.
 *
 * The calendar validation happens on the stated local fields, before the offset
 * shifts anything: "February 30th, 23:00 (UTC-5)" is an impossible date in the
 * timezone the source wrote it in, and converting first would quietly turn it
 * into a real instant in March.
 */
function offsetIso(
  y: number,
  m: number,
  d: number,
  hh: number,
  mm: number,
  offsetMs: number,
  ss = 0,
): string | null {
  const local = iso(y, m, d, hh, mm, ss);
  if (local === null) return null;
  return new Date(Date.parse(local) - offsetMs).toISOString();
}

/**
 * "2021/01/16 04:00 - 2021/01/31 03:59" → both instants, exact precision.
 * Trailing prose after the range (e.g. "Currently Unavailable") is ignored.
 *
 * NOTE: the source states a wall-clock time but not a timezone. These are read
 * as UTC. See the timezone caveat in the Genshin adapter.
 */
export function parseSlashDateTimeRange(
  input: string,
): { start: ParsedInstant; end: ParsedInstant } | null {
  const re =
    /(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/;
  const m = re.exec(input);
  if (!m) return null;

  const n = (i: number) => Number(m[i]);
  const startIso = iso(n(1), n(2), n(3), n(4), n(5));
  const endIso = iso(n(6), n(7), n(8), n(9), n(10));
  if (startIso === null || endIso === null) return null;

  return {
    start: { iso: startIso, precision: "exact" },
    end: { iso: endIso, precision: "exact" },
  };
}

/**
 * Named timezone abbreviations this file will convert from, in milliseconds.
 *
 * Deliberately only the ones a source actually states, and deliberately only
 * ones with a fixed offset. An abbreviation absent here parses to null, which
 * is the same answer this file gives every other missing fact — and the reason
 * the map is not pre-populated with the obvious candidates is that half of them
 * are not fixed: `CST` names three different zones and `PT` shifts by an hour
 * twice a year, so a plausible-looking entry is a wrong date waiting for the
 * source to use it.
 */
const NAMED_ZONE_OFFSET_MS: Record<string, number> = {
  // Japan observes no daylight saving, so UTC+9 holds all year.
  jst: 9 * 60 * 60 * 1000,
};

/**
 * "08/17/2026 8:00PM (JST)" → 2026-08-17T11:00:00.000Z, exact precision.
 *
 * One boundary, not a range: the hololive Dreams wiki gives Start Date and End
 * Date their own columns, so there is nothing to split and the whole cell is
 * anchored at both ends.
 *
 * Three things separate this from the readers above:
 *
 * - **A 12-hour clock**, which is the detail most likely to be got wrong
 *   silently. `12:00PM` is noon and `12:00AM` is midnight — the hour is not
 *   `12 + 12` in the first case and not `12` in the second — and a naive
 *   reading puts an event's start twelve hours out without ever failing.
 * - **The zone is named, not offset.** `parseOrdinalDateTimeRange` reads a
 *   stated `(UTC-5)`; here the source writes `(JST)`, so the abbreviation is
 *   resolved through `NAMED_ZONE_OFFSET_MS` and an unrecognised one returns
 *   null rather than being read as UTC.
 * - **The zone is required.** A cell stating a wall clock and no zone is a
 *   missing fact, and this page always states one — so the day a row loses it,
 *   that row should vanish rather than silently land nine hours off.
 *
 * Month-first, like `parseShortSlashRange`: the source is written for an
 * English-speaking audience and its own rows settle it — `08/17/2026` and
 * `08/27/2026` are both readable either way, but `08/30/2026` is not a day-first
 * date at all.
 */
export function parseSlashClockZone(input: string): ParsedInstant | null {
  const re =
    /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*([AP])M\s*\(([A-Za-z]+)\)\s*$/i;
  const m = re.exec(input);
  if (!m) return null;

  const offsetMs = NAMED_ZONE_OFFSET_MS[(m[7] ?? "").toLowerCase()];
  if (offsetMs === undefined) return null;

  const hour12 = Number(m[4]);
  if (hour12 < 1 || hour12 > 12) return null;
  const pm = (m[6] ?? "").toUpperCase() === "P";
  // Noon and midnight are the two readings a 12-hour clock gets wrong: 12PM is
  // hour 12 and 12AM is hour 0, so the wrap happens before the PM shift.
  const hour = (hour12 % 12) + (pm ? 12 : 0);

  const value = offsetIso(
    Number(m[3]),
    Number(m[1]),
    Number(m[2]),
    hour,
    Number(m[5]),
    offsetMs,
  );
  return value === null ? null : { iso: value, precision: "exact" };
}

/**
 * "2025-01-16 17:00 - 2025-02-06 02:59 (UTC)" → both instants, exact precision.
 *
 * IOP Wiki's GFL2 event tables put the whole period in one cell and — unusually
 * for a community wiki — state the zone on every one of them. That makes this
 * the only range reader here that converts nothing: the source has already done
 * it, so both boundaries are exact and no offset is assumed anywhere.
 *
 * **The zone is required**, for the reason `parseSlashClockZone` requires its
 * own: a cell that states a wall clock and no zone is a missing fact, not an
 * invitation to read it as UTC. All 145 rows on the page carry `(UTC)` today,
 * so the day one loses it that row should drop out rather than land hours off
 * on a boundary the reader is standing in the game watching.
 *
 * Anchored at the start so a range cannot be found inside prose or a slug; left
 * open at the end because the cell also carries an ICS export widget, whose
 * markup the caller strips but whose container survives as trailing whitespace.
 */
export function parseIsoClockRangeUtc(
  input: string,
): { start: ParsedInstant; end: ParsedInstant } | null {
  const re =
    /^\s*(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})\s*\(UTC\)/i;
  const m = re.exec(input);
  if (!m) return null;

  const n = (i: number) => Number(m[i]);
  const startIso = iso(n(1), n(2), n(3), n(4), n(5));
  const endIso = iso(n(6), n(7), n(8), n(9), n(10));
  if (startIso === null || endIso === null) return null;

  return {
    start: { iso: startIso, precision: "exact" },
    end: { iso: endIso, precision: "exact" },
  };
}

/**
 * `2026-08-03T21:00-07:00` → 2026-08-04T04:00:00.000Z, exact precision.
 *
 * A machine-readable instant, which is rare enough here to be worth naming:
 * the Stella Sora wiki's front page emits its banner window as real
 * `<time datetime>` elements, so the offset is stated in the markup rather than
 * printed for a human to interpret.
 *
 * **The offset is required.** `Z` or `±HH:MM` both pass; a bare local datetime
 * does not, and that is the same call every other reader here makes. It matters
 * more than usual on this source, because the page's sibling `Banner_List`
 * prints the identical instants with no zone anywhere — reading those as UTC
 * would be an assumption that happens to be right today and is unfalsifiable
 * from the page, which is exactly the kind of fact this file refuses to invent.
 *
 * Anchored at both ends: an attribute value is a whole cell, not prose.
 */
export function parseIsoOffsetInstant(input: string): ParsedInstant | null {
  const re =
    /^\s*(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?\s*(Z|[+-]\d{2}:?\d{2})\s*$/i;
  const m = re.exec(input);
  if (!m) return null;

  // Validated on the stated local fields before the offset shifts anything:
  // converting first would quietly turn February 30 into a real March instant.
  const local = iso(
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
  );
  if (local === null) return null;

  const value = Date.parse(input.trim());
  if (Number.isNaN(value)) return null;
  return { iso: new Date(value).toISOString(), precision: "exact" };
}

/**
 * "12 August 2026" → 2026-08-12T00:00:00.000Z, day precision.
 * "10 September 202604:59:59" → converted from `offsetMs`, exact precision.
 *
 * The Nikke wiki's schedule states its zone in the *column header*
 * (`Start(UTC+9)`), not in the cell, so the offset arrives as an argument here
 * rather than being read out of the text. A caller that cannot prove the zone
 * must not call this.
 *
 * **A boundary with no clock keeps the day the page printed, unconverted.**
 * That is the Fate/Grand Order rule (`AGENTS.md` § Fandom): there is no time of
 * day to anchor a conversion to, and shifting a bare date by nine hours would
 * move it to the previous calendar day — and the start's day is half an event
 * ID. A boundary that does state a clock is converted, because then there is
 * something real to convert.
 *
 * Day-first, unlike `parseMonthDayYear`: this wiki writes `12 August 2026`
 * where Game8 writes `August 12, 2026`. The date and the clock arrive with no
 * separator between them because they are separate elements in the markup, and
 * reference markers (`[1]`) trail some cells, so the tail is tolerated rather
 * than anchored.
 */
export function parseDayMonthYearClock(
  input: string,
  offsetMs: number,
): ParsedInstant | null {
  const re = /^\s*(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{4})\s*(?:(\d{1,2}):(\d{2})(?::(\d{2}))?)?/;
  const m = re.exec(input.replace(/\[\d+\]/g, " "));
  if (!m) return null;

  const month = monthNumber(m[2] ?? "");
  if (month === null) return null;

  const day = Number(m[1]);
  const year = Number(m[3]);

  if (m[4] === undefined) {
    // No clock: the printed day stands, exactly as it does on FGO's page.
    const value = iso(year, month, day);
    return value === null ? null : { iso: value, precision: "day" };
  }

  // Seconds matter here and are carried: this page ends its events at
  // 04:59:59 and starts the next banner at 05:00:00, one second apart, and
  // rounding that to the minute would make the two overlap.
  const value = offsetIso(
    year, month, day, Number(m[4]), Number(m[5]), offsetMs, Number(m[6] ?? 0),
  );
  return value === null ? null : { iso: value, precision: "exact" };
}

/**
 * "July 20, 2026 04:00 – August 10, 2026 03:49" → both days, day precision.
 *
 * **The clock is read and deliberately thrown away.** The Infinity Nikki wiki
 * states a wall clock on both boundaries and names no zone for it anywhere on
 * the page — only prose elsewhere dating version launches `(UTC-7)` and a note
 * that rewards reset at `04:00 (Server Time)`. Its durations do run 04:00 →
 * 03:59, which only lands on a reset boundary if the column is server-local, so
 * the case for UTC-7 is strong and it is still circumstantial.
 *
 * Publishing the clock would mean picking an offset, and the offset moves the
 * *day*: `July 16, 2026 20:00` read as UTC-7 is `2026-07-17T03:00Z`, and the
 * start's day is half of every event ID this game will ever have. So the
 * printed date stands on its own, at day precision, exactly as every Game8 date
 * does — Game8 states no zone either, and `clockFor` exists to resolve such a
 * boundary against the reader's own server reset.
 *
 * Matching the clock rather than ignoring it is the point: a cell whose shape
 * this reader does not fully recognise yields null instead of a half-read date.
 */
export function parseZonelessClockRange(
  input: string,
): { start: ParsedInstant; end: ParsedInstant } | null {
  const re =
    /^\s*([A-Za-z]+)\.?\s+(\d{1,2}),\s*(\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\s*[-–—]\s*([A-Za-z]+)\.?\s+(\d{1,2}),\s*(\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\s*$/;
  const m = re.exec(input);
  if (!m) return null;

  const startMonth = monthNumber(m[1] ?? "");
  const endMonth = monthNumber(m[4] ?? "");
  if (startMonth === null || endMonth === null) return null;

  const startIso = iso(Number(m[3]), startMonth, Number(m[2]));
  const endIso = iso(Number(m[6]), endMonth, Number(m[5]));
  if (startIso === null || endIso === null) return null;

  return {
    start: { iso: startIso, precision: "day" },
    end: { iso: endIso, precision: "day" },
  };
}
