import {
  eventId,
  Region,
  type GachaEvent,
  type Precision,
} from "../../shared/schema.ts";
import { text } from "../html.ts";
import type { ParseContext } from "../adapters/types.ts";
import { inferType } from "./game8.ts";
import type { SourceParser } from "./types.ts";

/**
 * wiki.gg event pages (MediaWiki with the `mp-event` template).
 *
 * A markedly better source than a prose wiki: each event carries machine
 * readable ISO timestamps, one timer per server region:
 *
 *   <div class="mp-event">
 *     <div class="mp-event-header">[<span class="mp-event-name">TITLE</span>]
 *       <span class="mp-event-type">Challenge Event</span></div>
 *     <div class="mp-event-image"><a href="/wiki/SLUG" …></div>
 *     <ul class="mp-event-timers">
 *       <li data-start="…Z" data-end="…Z"><span class="mp-server-name">Asia:</span>…
 *
 * This is the first source that states region-scoped ends, which is what
 * `regionScoped` / `regionEnds` exist for — the difference is up to 13 hours.
 */

const EVENT_BLOCK = /<div class="mp-event">([\s\S]*?)<ul class="mp-event-timers">([\s\S]*?)<\/ul>/gi;
const NAME = /<span class="mp-event-name">([\s\S]*?)<\/span>/i;
const TYPE = /<span class="mp-event-type">([\s\S]*?)<\/span>/i;
const LINK = /<a href="(\/wiki\/[^"]+)"/i;
const TIMER =
  /<li[^>]*class="[^"]*mp-event-timer[^"]*"[^>]*data-start="([^"]+)"[^>]*data-end="([^"]+)"[\s\S]*?<span class="[^"]*mp-server-name[^"]*">([\s\S]*?)<\/span>/gi;

/**
 * Server labels vary in wording ("Americas / Europe:", "Asia:"), so match on
 * the words present rather than expecting one label per region. A single timer
 * can legitimately cover two regions.
 *
 * A "Europe" word in the label maps to `america`, not to a `europe` region —
 * this fork has none (see `time.ts` § guessRegion) — and every label this
 * source has ever printed pairs "Europe" with "Americas" on the same timer
 * anyway, so the instant is identical either way.
 */
function regionsFor(label: string): Region[] {
  const l = label.toLowerCase();
  const out: Region[] = [];
  if (/asia/.test(l)) out.push("asia");
  if (/america|europe|eu\b/.test(l)) out.push("america");
  return [...new Set(out)];
}

interface Timer {
  regions: Region[];
  start: number;
  end: number;
}

export function parseWikiGgEventsPage(
  html: string,
  ctx: ParseContext,
): GachaEvent[] {
  const flat = html.replace(/\s+/g, " ");
  const out: GachaEvent[] = [];

  for (const block of flat.matchAll(EVENT_BLOCK)) {
    const head = block[1] ?? "";
    const timersHtml = block[2] ?? "";

    const title = text(NAME.exec(head)?.[1] ?? "");
    if (title.length === 0) continue;

    const timers: Timer[] = [];
    for (const t of timersHtml.matchAll(TIMER)) {
      const start = Date.parse(t[1] ?? "");
      const end = Date.parse(t[2] ?? "");
      if (Number.isNaN(start) || Number.isNaN(end) || end <= start) continue;
      timers.push({ regions: regionsFor(text(t[3] ?? "")), start, end });
    }
    if (timers.length === 0) continue;

    const regionEnds: Partial<Record<Region, string>> = {};
    for (const timer of timers) {
      for (const region of timer.regions) {
        regionEnds[region] = new Date(timer.end).toISOString();
      }
    }

    const covered = Object.keys(regionEnds).length;
    // Region-scoped only when the source actually distinguishes regions and
    // they genuinely differ. One timer for everyone is a global instant.
    const distinctEnds = new Set(Object.values(regionEnds)).size;
    const regionScoped = covered > 0 && distinctEnds > 1;

    // Canonical start is the earliest any region sees it; the canonical end is
    // the earliest any region loses it. `endsAt` is only a fallback for a
    // region the source did not list, so the conservative choice is right.
    const startsAt = new Date(
      Math.min(...timers.map((t) => t.start)),
    ).toISOString();
    const endsAt = new Date(Math.min(...timers.map((t) => t.end))).toISOString();

    const href = LINK.exec(block[0] ?? "")?.[1];
    const typeLabel = text(TYPE.exec(head)?.[1] ?? "");
    const precision: Precision = "exact";

    out.push({
      id: eventId(ctx.game, title, startsAt),
      game: ctx.game,
      title,
      type: inferType(`${title} ${typeLabel}`),
      summary: typeLabel.length > 0 ? typeLabel : null,
      startsAt,
      startPrecision: precision,
      endsAt,
      endPrecision: precision,
      regionScoped,
      regionEnds: regionScoped ? (regionEnds as Record<Region, string>) : null,
      sourceUrl: href === undefined ? ctx.sourceUrl : new URL(href, ctx.sourceUrl).toString(),
      sourceId: ctx.sourceId,
      status: "published",
      // Exact timestamps straight from the source, no inference anywhere.
      confidence: 0.95,
      extractionMethod: "parser",
      version: 1,
      firstSeenAt: ctx.now,
      updatedAt: ctx.now,
    });
  }

  return out.sort((a, b) =>
    a.startsAt === b.startsAt
      ? a.id.localeCompare(b.id)
      : a.startsAt.localeCompare(b.startsAt),
  );
}

export const wikiGgParser: SourceParser = {
  id: "wikigg",
  label: "wiki.gg",
  canParse(html: string): boolean {
    return /class="mp-event"/.test(html) && /mp-event-timer/.test(html);
  },
  parse: parseWikiGgEventsPage,
};
