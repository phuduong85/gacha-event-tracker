import {
  eventId,
  type EventType,
  type GachaEvent,
} from "../../shared/schema.ts";
import {
  parseAdjacentFullRange,
  parseFullRange,
  parseLabelledStartEnd,
  parseMonthDayRange,
  parseMonthDayYear,
  parseOpenRange,
  parseShortSlashRange,
  parseSlashDateTimeRange,
  type ParsedInstant,
} from "../dates.ts";
import { assertFlatTables, scanDocument, type DocNode } from "../html.ts";
import type { ParseContext } from "../adapters/types.ts";
import type { SourceParser } from "./types.ts";

/**
 * Shared parsing for Game8 event-calendar pages.
 *
 * Game8 does not use one template. Across games there are (at least) three:
 *
 *  1. Label/value detail tables — `Event Start` / `Event End` rows under a
 *     per-event `h3`. Full dates with year. (Genshin Impact)
 *  2. Column tables — `Event | Duration | Event Details | Rewards`, one row per
 *     event, under a section heading. (Neverness to Everness)
 *  3. Image-grid schedules with a bare `MM/DD` and no end date. Unsupportable
 *     without inventing a year and an end, so it yields nothing. (Endfield)
 *
 * Shapes 1 and 2 are both handled here; a page may contain either or both.
 * Anything undated is skipped rather than guessed — see docs/PRD.md § Quality
 * bar.
 */

/** Section headings whose events belong on the calendar. */
const INCLUDED_SECTIONS = [
  /current events/i,
  /upcoming events/i,
  /recurring events/i,
  /events? schedule/i,
  /featured events/i,
  /list of (all )?events/i,
  /all available events/i,
  /ongoing events/i,
  // Some Game8 wikis schedule banners rather than events, and head their
  // sections accordingly — Umamusume's page is `List of All Banners` →
  // `All Current Banners`. Kept as separate patterns rather than making
  // "events?" optional above, so "Banner Guides" (a nav table) still matches
  // nothing.
  /list of (all )?banners/i,
  /current banners/i,
];

/**
 * Sections deliberately skipped. Permanent events have no end and are not
 * time-boxed; past events are over and would bury what is live.
 */
const EXCLUDED_SECTIONS = [
  /permanent events/i,
  /past events/i,
  /previous events/i,
  /ended events/i,
  /finished events/i,
  // The banner-scheduling pages need their own back-catalogue heading for the
  // same reason: Umamusume's finished rows sit under `Previous Banners`, which
  // `previous events` does not match, and they are dated exactly like the live
  // ones directly above them.
  /previous banners/i,
  /past banners/i,
];

/**
 * Label/value rows carrying a single boundary instant.
 *
 * The qualifier is optional because Persona 5 labels these `Start Date` /
 * `End Date` where Genshin writes `Event Start`. Anchored at both ends, so a
 * cell that merely mentions a start is not mistaken for one.
 */
const START_LABEL = /^(event|test run|banner)?\s*start(\s+date)?$/i;
const END_LABEL = /^(event|test run|banner)?\s*end(\s+date)?$/i;
/** Label/value rows carrying a whole range in one cell. */
const RANGE_LABEL = /^(availability period|event period|duration|period|dates)$/i;

/** Column-table header matchers. */
const COL_TITLE = /^(.*\b)?(events?|banners?)$/i;
const COL_RANGE =
  /^(event |all )?(duration|dates?|event date|period|availability(?: period)?(?: \(utc\))?|schedule)( ?& ?summary| and summary)?$/i;
const COL_START = /^start$/i;
const COL_END = /^end$/i;
const COL_SUMMARY = /^(event )?(details?|description|overview)$/i;

interface Candidate {
  title: string;
  summary: string | null;
  start: ParsedInstant;
  end: ParsedInstant | null;
}

export function parseGame8EventsPage(
  html: string,
  ctx: ParseContext,
): GachaEvent[] {
  // The table reader assumes flat tables. Assert rather than mis-parse silently.
  if (!assertFlatTables(html)) {
    throw new Error(
      `${ctx.sourceId}: source contains nested tables; the flat-table reader cannot parse it safely`,
    );
  }

  const nodes = scanDocument(html);
  const candidates: Candidate[] = [];

  let sectionIncluded = false;
  let currentTitle: string | null = null;

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (node === undefined) continue;

    // Sections are marked by h2 on some pages, h3 or h4 on others, so inclusion
    // is tracked at whichever level actually names the section — Persona 5's
    // finished-events table is fenced off by nothing but an h4. A heading
    // matching neither list leaves the current state alone — it is an event
    // name.
    if (node.kind === "h2" || node.kind === "h3" || node.kind === "h4") {
      const heading = node.text;
      if (EXCLUDED_SECTIONS.some((re) => re.test(heading))) {
        sectionIncluded = false;
        currentTitle = null;
      } else if (INCLUDED_SECTIONS.some((re) => re.test(heading))) {
        sectionIncluded = true;
        currentTitle = null;
      } else if (node.kind !== "h4") {
        // An unrecognised h2/h3 names an event. An unrecognised h4 does not —
        // Genshin uses them for sub-headings *within* one event ("Availability
        // Period", "Characters & Rewards for this Test Run"), so letting one
        // claim the title would rename "Character Test Runs" to the label above
        // its own date table.
        currentTitle = heading;
      }
      continue;
    }

    if (!sectionIncluded || node.kind !== "table") continue;

    const fromStartEnd = readStartEndTable(node.headers, node.rows);
    if (fromStartEnd.length > 0) {
      candidates.push(...fromStartEnd);
      continue;
    }

    const fromColumns = readColumnTable(node.rows);
    if (fromColumns.length > 0) {
      candidates.push(...fromColumns);
      continue;
    }

    if (currentTitle === null) continue;
    const dates = readLabelledDates(node.pairs);
    if (dates === null) continue;

    candidates.push({
      title: currentTitle,
      // Detail tables carry no description column, but the page follows them
      // with a sentence of prose. That sentence is the event blurb.
      summary: summaryAfter(nodes, i),
      ...dates,
    });
    // One dated table per heading; ignore follow-on reward tables until the
    // next heading.
    currentTitle = null;
  }

  return dedupe(candidates.map((c) => toEvent(c, ctx)));
}

/**
 * The event blurb that follows a detail table.
 *
 * Scans forward only to the next heading or table, so a description never
 * leaks from one event onto another. Call-to-action paragraphs ("… Event
 * Guide") are skipped — they are navigation, not description.
 */
function summaryAfter(nodes: DocNode[], from: number): string | null {
  for (let i = from + 1; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (node === undefined) break;
    if (node.kind !== "p") break;
    if (node.isButton || node.text.length === 0) continue;
    return isRequirementOnly(node.text) ? null : node.text.slice(0, 500);
  }
  return null;
}

/** Shape 1: `Event Start` / `Event End` / `Availability Period` rows. */
function readLabelledDates(
  pairs: Array<{ label: string; value: string }>,
): { start: ParsedInstant; end: ParsedInstant | null } | null {
  let start: ParsedInstant | null = null;
  let end: ParsedInstant | null = null;

  for (const { label, value } of pairs) {
    if (RANGE_LABEL.test(label)) {
      const range = parseRange(value);
      if (range) return range;
      // "Permanently Available", "TBD" — not an error, just not datable.
      continue;
    }
    if (START_LABEL.test(label)) start ??= parseMonthDayYear(value);
    if (END_LABEL.test(label)) end ??= parseMonthDayYear(value);
  }

  return start === null ? null : { start, end };
}

/** Shape 2: one row per event, with a title column and a range column. */
function readColumnTable(rows: string[][]): Candidate[] {
  // Usually row 0 heads the table. Where it does not, row 1 does: Game8 lays
  // two schedules side by side inside one `<table>` and gives the pair a
  // spanning label row — Umamusume's current banners are headed
  // `Standard Banners | Banner | Rating | Availability | Paid Banners | …`,
  // with the real header on the row below and three-cell data rows under that.
  //
  // That label row is not merely unhelpful, it is *plausible*: it contains the
  // word "Banners" and the word "Availability", so it resolves both columns and
  // puts the range at index 3, which no data row has. Every row then fails to
  // date and the table yields nothing at all. So the header is decided by what
  // it produces rather than by where it sits — and row 0 still wins whenever it
  // produces anything, which is what keeps every page that parses today parsing
  // exactly as it did.
  const fromFirst = readRowsUnder(rows, 0);
  return fromFirst.length > 0 ? fromFirst : readRowsUnder(rows, 1);
}

/** Read `rows`, treating row `headerIdx` as the header and the rest as data. */
function readRowsUnder(rows: string[][], headerIdx: number): Candidate[] {
  if (rows.length < headerIdx + 2) return [];
  const layout = columnLayout(rows[headerIdx]);
  if (layout === null) return [];
  const { titleIdx, rangeIdx, summaryIdx } = layout;

  const out: Candidate[] = [];
  for (const row of rows.slice(headerIdx + 1)) {
    const title = row[titleIdx]?.trim();
    const rangeCell = row[rangeIdx];
    if (!title || rangeCell === undefined) continue;

    const range = parseRange(rangeCell);
    // A row we cannot date is skipped, not guessed. This is also what keeps
    // year-less summary tables ("08/12 - 08/24") from producing events.
    if (range === null) continue;

    // Some templates fold the schedule and the blurb into one cell
    // ("Period: 08/09/26 - 08/30/26 During the event, gather..."). With no
    // separate column, recover the prose from what follows the dates.
    const summaryCell =
      summaryIdx === -1 ? proseAfterDates(rangeCell) : row[summaryIdx];
    const summary =
      summaryCell && summaryCell.length > 0 && !isRequirementOnly(summaryCell)
        ? summaryCell.slice(0, 500)
        : null;

    out.push({ title, summary, start: range.start, end: range.end });
  }
  return out;
}

interface ColumnLayout {
  titleIdx: number;
  rangeIdx: number;
  summaryIdx: number;
}

/** Where the columns sit, if this row is a header row at all. */
function columnLayout(header: string[] | undefined): ColumnLayout | null {
  if (header === undefined) return null;

  const titleIdx = header.findIndex((h) => COL_TITLE.test(h));
  const rangeIdx = header.findIndex((h) => COL_RANGE.test(h));
  if (titleIdx === -1 || rangeIdx === -1) return null;

  return {
    titleIdx,
    rangeIdx,
    summaryIdx: header.findIndex((h) => COL_SUMMARY.test(h)),
  };
}

/**
 * Try every known range shape, most specific first. `parseOpenRange` is last
 * because it is the most permissive — it accepts any leading full date and
 * reports no end.
 */
/**
 * Shape 4: a `Event | Duration | Start | End` table where the event name spans
 * two rows and each row carries one labelled boundary:
 *
 *   | Summer Waves Rolls In | Start | July 29, 2026      |
 *   |                       | End   | September 7, 2026  |
 *
 * The rowspan is invisible to a flat cell reader, so the shape is recovered
 * from cell counts: a row that introduces a title, then a continuation row.
 */
function readStartEndTable(headers: string[], rows: string[][]): Candidate[] {
  if (!headers.some((h) => COL_START.test(h)) || !headers.some((h) => COL_END.test(h))) {
    return [];
  }

  const out: Candidate[] = [];
  for (const row of rows) {
    const cells = row.map((c) => c.trim());

    // [title, "Start", date] — begins an event.
    if (cells.length >= 3 && COL_START.test(cells[1] ?? "")) {
      const title = cells[0] ?? "";
      const start = parseMonthDayYear(cells[2] ?? "");
      if (title.length > 0 && start !== null) {
        out.push({ title, summary: null, start, end: null });
      }
      continue;
    }

    // ["End", date] — completes the event opened above.
    if (cells.length >= 2 && COL_END.test(cells[0] ?? "")) {
      const current = out.at(-1);
      if (current !== undefined && current.end === null) {
        current.end = parseMonthDayYear(cells[1] ?? "");
      }
    }
  }
  return out;
}

/**
 * One date, in any shape this parser understands.
 */
const ONE_DATE =
  String.raw`(?:\d{1,2}/\d{1,2}/\d{2,4}|[A-Za-z]+\.?\s+\d{1,2}(?:,\s*\d{4})?)`;

/**
 * A date that carries its own year. Required of the second half when nothing
 * but whitespace separates the two \u2014 "August 12, 2026 Day 3 rewards" would
 * otherwise read "Day 3" as the end and eat the description.
 */
const DATED_YEAR = String.raw`(?:\d{1,2}/\d{1,2}/\d{2,4}|[A-Za-z]+\.?\s+\d{1,2},\s*\d{4})`;

/**
 * A leading range, whose end may be a date or a stated non-date such as
 * "Permanent" or "End of 4.6". Those words are listed rather than matched
 * loosely, so a real description is never mistaken for a range end.
 */
const RANGE_PREFIX = new RegExp(
  String.raw`^\s*` +
    ONE_DATE +
    String.raw`(?:\s*[-\u2013\u2014]\s*(?:` +
    ONE_DATE +
    String.raw`|permanent|tbd|ongoing|end of [\d.]+)|\s+` +
    DATED_YEAR +
    String.raw`)?\s*`,
  "i",
);

/**
 * Prose that only states how to qualify for an event, not what it is.
 *
 * Several templates put unlock conditions where a description would go
 * ("Reach Union Level 8", "Unlocked by default"). Showing that as the summary
 * fills the slot with something that never answers "what is this event?", so
 * it is dropped in favour of no summary at all.
 */
function isRequirementOnly(text: string): boolean {
  return /^(reach|unlock|unlocks|unlocked|require|requires|required|complete|completing|clear|clearing|obtain|available|becomes available|must |need |finish)\b/i.test(
    text.trim(),
  );
}

/** Strip a leading label and date range, leaving any description behind it. */
function proseAfterDates(cell: string): string | null {
  // A fully labelled "Start: … End: …" cell is structure end to end. Stripping
  // the leading half would leave "End: Permanent" standing where a description
  // belongs — a date masquerading as a blurb.
  if (parseLabelledStartEnd(cell) !== null) return null;

  const rest = cell
    .replace(/^\s*(period|duration|schedule|dates?)\s*[:：]\s*/i, "")
    .replace(RANGE_PREFIX, "")
    .trim();
  // Too short to be a description — probably leftover punctuation.
  if (rest.length < 12) return null;
  // What is left still looks like a date, so the cell was a range shape we only
  // partly understood ("June 25, 2026 July 16/30, 2026" — two candidate ends,
  // which is why no end was taken). Showing the leftover as the blurb would
  // present a date the parser deliberately refused to trust as if it were
  // information about the event.
  if (/^(?:\d{1,2}[/.]|[A-Za-z]+\.?\s+\d)/.test(rest)) return null;
  return isRequirementOnly(rest) ? null : rest;
}

function parseRange(
  value: string,
): { start: ParsedInstant; end: ParsedInstant | null } | null {
  return (
    parseSlashDateTimeRange(value) ??
    parseFullRange(value) ??
    parseShortSlashRange(value) ??
    parseMonthDayRange(value) ??
    parseLabelledStartEnd(value) ??
    parseAdjacentFullRange(value) ??
    parseOpenRange(value)
  );
}

/**
 * Type is inferred from the title by keyword. This is presentation metadata
 * used for filtering, not a date, so a conservative "other" default beats a
 * confident mislabel.
 */
export function inferType(title: string): EventType {
  const t = title.toLowerCase();
  if (/\brerun\b/.test(t)) return "rerun";
  // Every game names its gacha something else — "Summoning Campaign" is the
  // Fate/Grand Order one, and it is the whole of that page's banner vocabulary.
  if (/\b(banner|wish|warp|convene|gacha|summon(?:ing)?)\b/.test(t)) {
    return "banner";
  }
  if (/\b(login|log-in|sign-in|check-in|daily bonus)\b/.test(t)) return "login";
  if (/\b(challenge|trial|onslaught|abyss|tower|test runs?|clash|combat)\b/.test(t))
    return "challenge";
  if (/\b(shop|exchange|store)\b/.test(t)) return "shop";
  if (/\bmaintenance\b/.test(t)) return "maintenance";
  if (/\b(story|chapter|quest|act)\b/.test(t)) return "story";
  return "other";
}

function toEvent(c: Candidate, ctx: ParseContext): GachaEvent {
  // Confidence reflects how much the source actually pinned down. Day precision
  // and unknown ends are legitimate and common, but they are weaker evidence
  // than an exact range and the gate should be able to see that.
  let confidence = 0.95;
  if (c.start.precision === "day") confidence -= 0.05;
  if (c.end === null) confidence -= 0.15;
  else if (c.end.precision === "day") confidence -= 0.05;

  return {
    id: eventId(ctx.game, c.title, c.start.iso),
    game: ctx.game,
    title: c.title,
    type: inferType(c.title),
    summary: c.summary,
    startsAt: c.start.iso,
    startPrecision: c.start.precision,
    endsAt: c.end?.iso ?? null,
    endPrecision: c.end?.precision ?? "unknown",
    // Game8 does not state whether an end follows per-region reset, so these
    // are recorded as global rather than guessing a region split. A source that
    // does state it should populate these properly.
    regionScoped: false,
    regionEnds: null,
    sourceUrl: ctx.sourceUrl,
    sourceId: ctx.sourceId,
    status: "published",
    confidence: Math.round(confidence * 100) / 100,
    extractionMethod: "parser",
    version: 1,
    firstSeenAt: ctx.now,
    updatedAt: ctx.now,
  };
}

/** Same event listed in two shapes on one page — keep the better-dated one. */
function dedupe(events: GachaEvent[]): GachaEvent[] {
  const byId = new Map<string, GachaEvent>();
  for (const e of events) {
    const existing = byId.get(e.id);
    if (existing === undefined || e.confidence > existing.confidence) {
      // The loser can still carry a blurb the winner lacks: Persona 5 lists an
      // event in a bare `Event | Duration` table and again under its own
      // heading with a paragraph of prose. Dates are taken wholesale from the
      // better-dated copy and never blended — only a *missing* summary is
      // filled, so this can add information but never contradict any.
      byId.set(
        e.id,
        e.summary === null && existing?.summary != null
          ? { ...e, summary: existing.summary }
          : e,
      );
    } else if (existing.summary === null && e.summary !== null) {
      byId.set(e.id, { ...existing, summary: e.summary });
    }
  }
  return [...byId.values()].sort((a, b) =>
    a.startsAt === b.startsAt
      ? a.id.localeCompare(b.id)
      : a.startsAt.localeCompare(b.startsAt),
  );
}

/**
 * Game8 as a pluggable source parser. Registered in `parsers/index.ts`; bound
 * to concrete URLs by the adapters in `adapters/index.ts`.
 */
export const game8Parser: SourceParser = {
  id: "game8",
  label: "Game8",
  canParse(html: string): boolean {
    // Structural markers, not content: if Game8 redesigns, this goes false and
    // the run fails loudly instead of quietly returning zero events.
    //
    // Quote style varies between Game8 pages — the Genshin page emits
    // class="a-table", the NTE page class='a-table' — so match either. Every
    // regex in html.ts is attribute-agnostic for the same reason.
    return (
      /class=['"][^'"]*a-table/.test(html) &&
      /class=['"][^'"]*a-header--3/.test(html)
    );
  },
  parse: parseGame8EventsPage,
};
