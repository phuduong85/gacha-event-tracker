import { eventId, type EventType, type GachaEvent } from "../../shared/schema.ts";
import { parseSlashClockZone, type ParsedInstant } from "../dates.ts";
import { text } from "../html.ts";
import type { ParseContext } from "../adapters/types.ts";
import { inferType } from "./game8.ts";
import type { SourceParser } from "./types.ts";

/**
 * The hololive Dreams wiki's event schedule (`holodori.wiki`, a Miraheze wiki).
 *
 * The rendered page, not the API — the same call `bawiki.ts` makes and for the
 * same reason: this is Miraheze, whose `robots.txt` disallows `/w/` and
 * `/*?action=` while allowing `/wiki/`, so the route `fandom.ts` takes is the
 * one that is closed here. `/wiki/Events` answers our own User-Agent with a
 * `200`, carries no `Content-Signal`, and the wiki is CC BY-SA 4.0.
 *
 * The page is two `wikitable`s under two `<h2>`s:
 *
 *   <h2>Current Events</h2>
 *   <table class="wikitable">
 *     <tr><th>Logo<th>Event<th>Type<th>Start Date<th>End Date<th>Featured Members
 *     <tr><td><img><td>Ultimate Summer For Me?<td>Spotlight
 *         <td>08/17/2026 8:00PM (JST)<td>08/27/2026 7:59PM (JST)<td>…
 *   <h2>Past Events</h2>
 *   <table class="wikitable"> … same columns …
 *
 * Four things about it decide the code below.
 *
 * **The page states its timezone, on every single cell.** All eight boundaries
 * in the captured fixture end `(JST)`, which is why this is the only wiki source
 * here publishing `exact` precision on both sides without a per-region timer.
 * It is worth guarding rather than assuming: `parseSlashClockZone` requires the
 * zone, so a row that ever loses it drops out instead of quietly landing nine
 * hours off.
 *
 * **A section is fenced by its `<h2>`, and only `Current Events` is ours.**
 * Unlike `bluearchive.wiki`, this page says outright which rows it considers
 * live, and the two tables are otherwise identical — a reader that took every
 * `wikitable` would put the whole back catalogue on the calendar. Rows are still
 * checked against `ctx.now` on top of that, because the heading is maintained by
 * hand and "Current" goes stale a few days before someone moves the row.
 *
 * **Not every row is datable, and that is the page being honest.** `Beginner
 * Mission` runs from `Game Launch` to `Unknown` — a permanent tutorial chore
 * with no schedule. Its start is what decides it: an event ID is built from a
 * start date, so a row without one cannot be published at all, and inventing
 * launch day to fill the hole would put a permanent fixture on a calendar of
 * deadlines. An `Unknown` *end* is different and is kept — that is `endsAt:
 * null`, the honest answer this codebase exists to preserve.
 *
 * **The Type column is a controlled vocabulary, so it beats the title.**
 * `Spotlight` is this game's word for a rate-up banner — the row carries a
 * `Featured Members` column to prove it — and no amount of reading
 * "Ultimate Summer For Me?" would ever produce that. See `TYPES` below.
 */

const HEADING = /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi;
const TABLE = /<table\b[^>]*>([\s\S]*?)<\/table>/i;
const ROW = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
const CELL = /<t([dh])\b[^>]*>([\s\S]*?)<\/t\1>/gi;
/** Non-global deliberately: `.exec` on `ROW` would advance a shared `lastIndex`. */
const FIRST_ROW = /<tr\b[^>]*>([\s\S]*?)<\/tr>/i;
/**
 * The event's own article, when it has one.
 *
 * `Special:` is excluded because Miraheze's robots.txt disallows it, exactly as
 * in `bawiki.ts`. Excluding a query string matters more here than it does there,
 * though, and not as a nicety: **every title on this page is currently a red
 * link.** The wiki has no article for any of these events yet, so it writes
 * `/wiki/Ultimate_Summer_For_Me%3F?action=edit&redlink=1` — a *create this
 * page* form, which is both the wrong place to send a reader and a `?action=`
 * URL that this wiki's robots.txt disallows outright. Refusing a href with a
 * query is what keeps one out of the feed, and the fallback to the events page
 * is the right answer until the articles exist.
 */
const ARTICLE_LINK = /<a\b[^>]*href="(\/wiki\/(?!Special:)[^"#?]+)"/i;

/**
 * The site's own event vocabulary, mapped onto our `EventType`.
 *
 * A fixed list rather than word-matching, because this column is a controlled
 * vocabulary: the wiki writes one of these four words and nothing else. Two of
 * them are not derivable from the title in any form —
 *
 * - **`Spotlight`** is the gacha. Rate-up banners are what the `Featured
 *   Members` column on the same row lists, and "spotlight" is the game's term
 *   for the window they run in.
 * - **`Point Rally`** and **`Score Challenge`** are the game's two ranked
 *   scoring formats — play the event's Set Pieces for points against a
 *   leaderboard. `challenge` is the bucket for a scored cycle you grind, and
 *   putting the two formats in different buckets would be describing a
 *   difference the game does not draw.
 *
 * `Mission` maps to nothing better than `other`, which is stated here rather
 * than left to the fallback so that a *new* word in this column is the only
 * thing that ever reaches `inferType` — that is the case worth noticing, and
 * the fallback is what keeps it from being a crash.
 */
const TYPES: Record<string, EventType> = {
  spotlight: "banner",
  "point rally": "challenge",
  "score challenge": "challenge",
  mission: "other",
};

interface Columns {
  title: number;
  type: number | undefined;
  start: number;
  end: number;
}

/**
 * Where each column sits, read off the header row rather than counted.
 *
 * Counting is how a silent drop starts here: the first column is a logo and the
 * last is a cast list, so a table that gains or loses one of those shifts every
 * date one place and every row fails to parse — an empty lane with no error
 * anywhere. Returning null is also what tells a `wikitable` that is not a
 * schedule from one that is.
 */
function columns(headers: string[]): Columns | null {
  const at = (name: string) => {
    const i = headers.indexOf(name);
    return i < 0 ? undefined : i;
  };

  const title = at("event");
  const start = at("start date");
  const end = at("end date");
  if (title === undefined || start === undefined || end === undefined) {
    return null;
  }
  return { title, start, end, type: at("type") };
}

/**
 * The schedule table under the `Current Events` heading, and where its columns
 * sit.
 *
 * Bounded by the next `<h2>`, which is what keeps `Past Events` — an identically
 * shaped table directly below — off the calendar. Matching the heading by its
 * text rather than by position is the same choice `bawiki.ts` makes about tabs:
 * position works today and starts reading the archive the day the page is
 * reordered.
 */
function currentSchedule(html: string): { cols: Columns; body: string } | null {
  let section: string | null = null;
  for (const m of html.matchAll(HEADING)) {
    if (text(m[1] ?? "").toLowerCase() !== "current events") continue;
    const from = m.index + m[0].length;
    const next = html.slice(from).search(/<h2\b/i);
    section = next < 0 ? html.slice(from) : html.slice(from, from + next);
    break;
  }
  if (section === null) return null;

  const body = TABLE.exec(section)?.[1];
  if (body === undefined) return null;

  // The header row only, rather than every `<th>` in the table. A row header
  // appearing further down would otherwise join the list and shift every
  // resolved index by one — which is the silent drop that reading columns by
  // name is supposed to rule out, arriving by a different door.
  const first = FIRST_ROW.exec(body)?.[1] ?? "";
  const headers = [...first.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((h) =>
    text(h[1] ?? "").toLowerCase(),
  );
  const cols = columns(headers);
  return cols === null ? null : { cols, body };
}

export function parseHolodoriWikiEventsPage(
  html: string,
  ctx: ParseContext,
): GachaEvent[] {
  const schedule = currentSchedule(html.replace(/\s+/g, " "));
  if (schedule === null) return [];

  const { cols } = schedule;
  const nowMs = Date.parse(ctx.now);
  const out: GachaEvent[] = [];

  for (const row of schedule.body.matchAll(ROW)) {
    const cells = [...(row[1] ?? "").matchAll(CELL)].map((c) => ({
      tag: c[1] ?? "",
      html: c[2] ?? "",
    }));
    if (cells.length === 0 || cells.some((c) => c.tag === "h")) continue;

    const titleCell = cells[cols.title]?.html ?? "";
    const title = text(titleCell);
    if (title.length === 0) continue;

    // No start, no event. `Game Launch` is the real value this drops, and it is
    // not a date the page failed to write down — it is a permanent tutorial
    // chore, which is not what a calendar of deadlines is for.
    const start = parseSlashClockZone(text(cells[cols.start]?.html ?? ""));
    if (start === null) continue;

    // `Unknown` lands here, and is kept rather than dropped. It is the whole
    // point of `endPrecision: "unknown"`: the heading has already said this
    // event is running, so the honest report is that it is live and its end has
    // not been announced. That differs from `bawiki.ts`, which drops a
    // started-but-undated row — it has to, because it is reading an archive
    // with no heading to tell a live row from a finished one.
    const end: ParsedInstant | null = parseSlashClockZone(
      text(cells[cols.end]?.html ?? ""),
    );

    if (end !== null) {
      if (end.iso <= start.iso) continue;
      // "Current Events" is maintained by hand and goes stale a few days before
      // anyone moves a row down to "Past Events". The dates are the fact; the
      // heading is someone's housekeeping.
      if (Date.parse(end.iso) < nowMs) continue;
    }

    const type = cols.type === undefined
      ? ""
      : text(cells[cols.type]?.html ?? "");

    const href = ARTICLE_LINK.exec(titleCell)?.[1];

    // Both boundaries are stated to the minute in a named zone, so there is no
    // day-precision penalty here — only the one an unannounced end carries.
    const confidence = end === null ? 0.95 - 0.15 : 0.95;

    out.push({
      id: eventId(ctx.game, title, start.iso),
      game: ctx.game,
      title,
      type: TYPES[type.toLowerCase()] ?? inferType(`${title} ${type}`),
      summary: type.length > 0 ? type : null,
      startsAt: start.iso,
      startPrecision: start.precision,
      endsAt: end === null ? null : end.iso,
      endPrecision: end === null ? "unknown" : end.precision,
      // hololive Dreams launched worldwide simultaneously on one service, and
      // every boundary on this page is stated once, in JST, with no per-region
      // column anywhere. So there is one global end instant and nothing
      // region-scoped to report — see `games.ts` for the server clock itself.
      regionScoped: false,
      regionEnds: null,
      sourceUrl:
        href === undefined
          ? ctx.sourceUrl
          : new URL(href, ctx.sourceUrl).toString(),
      sourceId: ctx.sourceId,
      status: "published",
      confidence: Math.round(confidence * 100) / 100,
      extractionMethod: "parser",
      version: 1,
      firstSeenAt: ctx.now,
      updatedAt: ctx.now,
    });
  }

  return out;
}

export const holodoriWikiParser: SourceParser = {
  id: "holodoriwiki",
  label: "hololive Dreams Wiki (holodori.wiki)",

  /**
   * Asserts the two things the parser navigates by: the `Current Events`
   * heading, and a table under it headed with the columns it reads. A renamed
   * heading or a renamed column fails the run loudly rather than emptying the
   * lane, which is the whole reason `canParse` is checked separately from a
   * zero-event parse.
   */
  canParse(html: string): boolean {
    return currentSchedule(html.replace(/\s+/g, " ")) !== null;
  },

  parse: parseHolodoriWikiEventsPage,
};
