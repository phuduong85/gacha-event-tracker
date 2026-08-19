import { eventId, type EventType, type GachaEvent } from "../../shared/schema.ts";
import { parseIsoClockRangeUtc } from "../dates.ts";
import { scanDocument, type DocNode, type TableNode } from "../html.ts";
import type { ParseContext } from "../adapters/types.ts";
import { inferType } from "./game8.ts";
import type { SourceParser } from "./types.ts";

/**
 * IOP Wiki's Girls' Frontline 2 event schedule (`iopwiki.com/wiki/GFL2_Events`).
 *
 * The page is an `<h3>` per event, each followed by one
 * `<table class="gf-table event-period">` whose rows are that event's runs on
 * each server:
 *
 *   Title | Period (start/end) | Server | Type | Comment
 *   Amidst Wings of Gray | 2025-01-16 17:00 - 2025-02-06 02:59 (UTC) | EN | …
 *
 * Three things about it decide the code below.
 *
 * **The Server column is the whole safety story.** CN, EN and JP rows sit in
 * the same table, and the Chinese schedule runs roughly a year ahead of ours.
 * This is the `akwiki` CN-column hazard verbatim and gets the same answer:
 * publish `EN` and skip every other row. A CN date on a Global calendar is a
 * confidently wrong date, not a near miss — and here it would be wrong by
 * months, on a row that otherwise looks perfect.
 *
 * **The zone is stated on every row**, which is what makes this the best date
 * material in the project after wiki.gg: `exact` precision on both boundaries
 * with nothing converted or assumed. `parseIsoClockRangeUtc` requires the
 * `(UTC)` marker rather than defaulting to it, so a row that ever loses it
 * drops out instead of landing hours off.
 *
 * **`Betas` is a section, not an event type.** The page's `<h2>`s are
 * `Main Events`, `Minor Events`, `Betas` and `References`; closed beta rows are
 * dated exactly like everything else and would parse cleanly onto a calendar of
 * things nobody can do. Inclusion is fenced on the heading, as it is in
 * `holodori.ts`.
 *
 * **This is an archive, not a schedule.** 145 rows go back to 2023, 51 of them
 * ours, of which one had not ended when the fixture was captured. So inclusion
 * is decided against `ctx.now` exactly as it is in `bawiki.ts` — there is no
 * "ongoing" heading to gate on, and nothing downstream drops a finished event.
 * That makes the lane thin by design: the wiki publishes a patch when it is
 * announced, so a quiet week is one live event, which is the truth rather than
 * a gap.
 *
 * Titles come from the row's own `Title` cell and never from the `<h3>` above
 * it: those headings carry the CN and EN names as one slash pair
 * ("Exotic Cadence/Amidst Wings of Gray"), so a parser that took the heading
 * would publish both names for every event on the calendar. The row cell is
 * already localised to its own server.
 *
 * The period cell also carries an ICS export widget — a `<script>` restating
 * the same two instants as `icsStart`/`icsEnd`. That is a useful independent
 * check when verifying a fixture by hand, but it is script text rather than
 * content, so it is stripped before reading rather than parsed: `html.ts`'s
 * `text()` strips tags without stripping what a `<script>` contains, and a
 * date reader anchored at the start of the cell would otherwise be reading the
 * range with a page of JavaScript stuck to the end of it.
 */

/** Script and style bodies are markup we never want as text. */
const SCRIPTS = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;

/** Sections whose rows are dated but not playable. */
const EXCLUDED_SECTIONS = new Set(["betas", "references"]);

/**
 * The source's own event taxonomy, mapped onto ours.
 *
 * Reading the stated `Type` beats inferring one from the title: "Moonshroud
 * Requiem" says nothing about being a character banner, and the page says so
 * outright. Anything unlisted falls back to `inferType` over the title and the
 * stated type together, so a new value the wiki invents gets word-inferred
 * rather than silently flattened to "other".
 */
const TYPES: Record<string, EventType> = {
  "character event": "banner",
  "main story event": "story",
  "combat event": "challenge",
  "missions event": "other",
  "special event": "other",
  "warm-up event": "other",
  "popularity contest": "other",
};

interface Columns {
  title: number;
  period: number;
  server: number;
  type: number;
  comment: number | undefined;
}

/**
 * Where each column sits, read off the header row rather than counted.
 *
 * Returns null for every table that is not an event period table, which is what
 * keeps the page's layout tables — and its navigation — from being read as a
 * schedule. It is also the check `canParse` makes: if the header row is ever
 * renamed the source fails loudly instead of emptying the lane.
 */
function columns(headers: string[]): Columns | null {
  const at = (match: (h: string) => boolean) => {
    const i = headers.findIndex((h) => match(h.toLowerCase().trim()));
    return i < 0 ? undefined : i;
  };

  const title = at((h) => h === "title");
  // "Period (start/end)" — matched on the word rather than the whole string so
  // an editor adding or dropping the parenthetical does not empty the lane.
  const period = at((h) => h.startsWith("period"));
  const server = at((h) => h === "server");
  const type = at((h) => h === "type");
  if (
    title === undefined ||
    period === undefined ||
    server === undefined ||
    type === undefined
  ) {
    return null;
  }
  return { title, period, server, type, comment: at((h) => h === "comment") };
}

/** The server whose schedule our readers are on. */
const OUR_SERVER = "en";

export function parseIopWikiEventsPage(
  html: string,
  ctx: ParseContext,
): GachaEvent[] {
  const nodes: DocNode[] = scanDocument(html.replace(SCRIPTS, " "));
  const out: GachaEvent[] = [];
  const seen = new Set<string>();
  let section = "";

  for (const node of nodes) {
    if (node.kind === "h2") {
      section = node.text.toLowerCase();
      continue;
    }
    if (node.kind !== "table") continue;
    if (EXCLUDED_SECTIONS.has(section)) continue;

    const cols = columns(node.headers);
    if (cols === null) continue;

    for (const event of readRows(node, cols, ctx)) {
      // One event can be listed twice on the page — a run and its rerun share a
      // title, and the ID separates them by start date. Two rows that really do
      // agree on both are the same run stated twice, and the second is dropped
      // rather than merged: they are keyed identically downstream anyway, and
      // one completion mark for two rows is the collision the ID scheme exists
      // to avoid.
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      out.push(event);
    }
  }

  return out.sort((a, b) =>
    a.startsAt === b.startsAt
      ? a.id.localeCompare(b.id)
      : a.startsAt.localeCompare(b.startsAt),
  );
}

function readRows(
  table: TableNode,
  cols: Columns,
  ctx: ParseContext,
): GachaEvent[] {
  const out: GachaEvent[] = [];

  for (const row of table.rows) {
    const cell = (i: number | undefined) =>
      i === undefined ? "" : (row[i] ?? "").trim();

    // The header row comes back as cells like any other; it identifies itself.
    if (cell(cols.server).toLowerCase() === "server") continue;
    if (cell(cols.server).toLowerCase() !== OUR_SERVER) continue;

    const title = cell(cols.title);
    if (title.length === 0) continue;

    const range = parseIsoClockRangeUtc(cell(cols.period));
    if (range === null) continue;
    if (range.end.iso <= range.start.iso) continue;
    // Live and upcoming only. Everything above is history the wiki keeps and a
    // calendar of deadlines does not want — see the archive note above.
    if (Date.parse(range.end.iso) < Date.parse(ctx.now)) continue;

    const stated = cell(cols.type);
    const comment = cell(cols.comment);

    out.push({
      id: eventId(ctx.game, title, range.start.iso),
      game: ctx.game,
      title,
      type: TYPES[stated.toLowerCase()] ?? inferType(`${title} ${stated}`),
      summary: comment.length > 0 ? comment : null,
      startsAt: range.start.iso,
      startPrecision: range.start.precision,
      endsAt: range.end.iso,
      endPrecision: range.end.precision,
      // GFL2's EN build is a single worldwide server and this page states one
      // instant per run, in UTC, with no per-region column anywhere. There is
      // nothing region-scoped here to report — the Server column splits game
      // *releases* (CN/EN/JP), not our asia/america/europe regions.
      regionScoped: false,
      regionEnds: null,
      sourceUrl: ctx.sourceUrl,
      sourceId: ctx.sourceId,
      status: "published",
      // The strongest evidence this codebase accepts: both boundaries exact,
      // both stated in UTC by the source itself. Only wiki.gg scores here.
      confidence: 0.95,
      extractionMethod: "parser",
      version: 1,
      firstSeenAt: ctx.now,
      updatedAt: ctx.now,
    });
  }

  return out;
}

export const iopWikiParser: SourceParser = {
  id: "iopwiki",
  label: "IOP Wiki",
  canParse(html: string): boolean {
    // At least one event period table, found the same way `parse` finds it.
    // "A table exists" would prove nothing on a page with 47 of them, most of
    // them layout; asserting that the Title/Period/Server header row is still
    // findable is what turns a redesign into a failed source rather than a
    // silently empty lane.
    return scanDocument(html.replace(SCRIPTS, " ")).some(
      (n) => n.kind === "table" && columns(n.headers) !== null,
    );
  },
  parse: parseIopWikiEventsPage,
};
