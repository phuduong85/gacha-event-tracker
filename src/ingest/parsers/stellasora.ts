import { eventId, type GachaEvent } from "../../shared/schema.ts";
import { parseIsoOffsetInstant } from "../dates.ts";
import { text } from "../html.ts";
import type { ParseContext } from "../adapters/types.ts";
import type { SourceParser } from "./types.ts";

/**
 * The Stella Sora wiki's `Current Banners` module (`stellasora.miraheze.org`).
 *
 * Miraheze again, so the same call every Miraheze source here makes: `/wiki/`
 * is the surface `*` is allowed, `/w/` and `?action=` are disallowed, and this
 * page answers our own User-Agent with a 200 under CC BY-SA 4.0.
 *
 * **The front page, and not the article — which is the opposite of the usual
 * call, so the reasoning matters.** This wiki publishes the same schedule twice:
 *
 * - `/wiki/Banner_List` has two clean `Image | Name | Start | End` tables, 28
 *   and 27 rows, with full wall clocks: `2026-08-18 03:00:00`. It states **no
 *   timezone anywhere** — not in a header, not in a footnote, not once on the
 *   page.
 * - The front page's `Current Banners` module emits the same instants as real
 *   `<time datetime="2026-08-17T20:00-07:00">` elements. Zone stated,
 *   machine-readable, nothing to interpret.
 *
 * The two agree exactly — `2026-08-17T20:00-07:00` is `2026-08-18T03:00Z`, and
 * `Banner_List` prints `2026-08-18 03:00:00` for that banner — which is strong
 * evidence the table is UTC and still only evidence. Reading a bare wall clock
 * as UTC invents the fact that matters most, and rounding it to a day does not
 * save it, because a boundary near midnight lands either side of it depending on
 * the offset assumed and the start's day is half an event ID
 * (`AGENTS.md` § Blue Archive). So we read the surface that says what it means,
 * and pay for it in coverage: four live banners instead of 55 rows of history.
 *
 * If the wiki's editors ever state the zone on `Banner_List`, that page becomes
 * the better source immediately — full coverage, no dependency on a front-page
 * template. Until then this is the honest half.
 *
 * Two things about the markup decide the code below.
 *
 * **The class names arrive HTML-escaped.** The template writes its BEM
 * underscores as `&#95;&#95;`, so the container is
 * `stellasora-home-current&#95;&#95;banners` in the bytes and
 * `stellasora-home-current__banners` only after decoding. A selector written
 * against the name a browser shows finds nothing at all — a silent empty lane,
 * which is the failure mode this codebase treats as worse than a loud one.
 *
 * **Banner names are red links.** `A Breezy Romance` links to
 * `/wiki/A_Breezy_Romance/2026-08-03?action=edit&redlink=1` — a create-page
 * form, and a `?action=` URL this wiki's robots.txt disallows. So a href
 * carrying a query is refused and the module's own page stands in; the
 * banners whose articles do exist link normally and get linked.
 *
 * Banners only. This wiki dates no story events — `/wiki/Events` is a list of
 * names with no dates at all — so the lane is a banner calendar, and that is
 * what the source has rather than a choice made here.
 */

/** The module, with its underscores however the template escaped them. */
const CONTAINER = /stellasora-home-current(?:&#95;|_){2}banners/i;
/** One banner inside it. */
const BANNER = /<div class="stellasora-home-banner">([\s\S]*?)(?=<div class="stellasora-home-banner">|$)/gi;
const NAME = /banner(?:&#95;|_){2}name">([\s\S]*?)<\/div>/i;
const TIME = /<time\b[^>]*datetime="([^"]+)"/gi;
/** The same probe without `g`: `.test()` on a global regex carries state. */
const HAS_TIME = /<time\b[^>]*datetime="/i;
/**
 * The banner's own article. A href with a query is refused: on this wiki those
 * are `?action=edit&redlink=1` create-page forms, which robots.txt disallows and
 * which are the wrong page to send a reader to.
 */
const ARTICLE_LINK = /<a\b[^>]*href="(\/wiki\/(?!Special:)[^"#?]+)"/i;

/**
 * The `Current Banners` card, bounded at the next card.
 *
 * Bounding matters even though the card is the first on the page: the front page
 * carries five more (`Recent Trekkers`, `Recent Discs`, `Navigation`,
 * `Birthdays`, `Links`), and an unbounded slice would start reading whichever of
 * them grows a `<time>` element next.
 */
function module_(html: string): string | null {
  const start = CONTAINER.exec(html);
  if (start === null) return null;

  const from = start.index;
  const next = html.indexOf("stellasora-home-card--", from + 1);
  return next < 0 ? html.slice(from) : html.slice(from, next);
}

export function parseStellaSoraMainPage(
  html: string,
  ctx: ParseContext,
): GachaEvent[] {
  const section = module_(html.replace(/\s+/g, " "));
  if (section === null) return [];

  const nowMs = Date.parse(ctx.now);
  const out: GachaEvent[] = [];
  const seen = new Set<string>();

  for (const block of section.matchAll(BANNER)) {
    const body = block[1] ?? "";

    const nameCell = NAME.exec(body)?.[1] ?? "";
    const title = text(nameCell);
    if (title.length === 0) continue;

    // Two `<time>` elements per banner, in source order: the window's start and
    // its end. Both or neither — a module that emits one is a shape this parser
    // does not understand, and a start with an end read off the next banner
    // would be a confidently wrong date.
    const stamps = [...body.matchAll(TIME)].map((m) => m[1] ?? "");
    if (stamps.length < 2) continue;

    const start = parseIsoOffsetInstant(stamps[0] ?? "");
    const end = parseIsoOffsetInstant(stamps[1] ?? "");
    if (start === null || end === null) continue;
    if (end.iso <= start.iso) continue;

    // The module is titled "Current", and it is maintained by hand like every
    // other wiki section — so currency is checked against `ctx.now` rather than
    // taken on trust, as it is everywhere else here.
    if (Date.parse(end.iso) < nowMs) continue;

    const id = eventId(ctx.game, title, start.iso);
    if (seen.has(id)) continue;
    seen.add(id);

    const href = ARTICLE_LINK.exec(nameCell)?.[1];

    out.push({
      id,
      game: ctx.game,
      title,
      // Every row in this module is a gacha rate-up window. The wiki labels
      // none of them, and inferring from the name would only ever guess wrong:
      // "A Breezy Romance" carries no vocabulary at all.
      type: "banner",
      summary: null,
      startsAt: start.iso,
      startPrecision: start.precision,
      endsAt: end.iso,
      endPrecision: end.precision,
      // One worldwide banner window, stated once with an offset. The page draws
      // no per-region distinction, so there is nothing region-scoped to report.
      regionScoped: false,
      regionEnds: null,
      sourceUrl:
        href === undefined
          ? ctx.sourceUrl
          : new URL(href, ctx.sourceUrl).toString(),
      sourceId: ctx.sourceId,
      status: "published",
      // Both boundaries exact, both carrying their own offset in the markup.
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

export const stellaSoraWikiParser: SourceParser = {
  id: "stellasorawiki",
  label: "Stella Sora Wiki",
  canParse(html: string): boolean {
    // Sourcing a wiki's front page is more fragile than sourcing an article, so
    // this asserts both halves of what the parser depends on: the module is
    // still there, and it still holds `<time datetime>` children. Either one
    // going is a redesign, and a redesign should fail the source rather than
    // report that Stella Sora has no banners on.
    const section = module_(html.replace(/\s+/g, " "));
    return section !== null && HAS_TIME.test(section);
  },
  parse: parseStellaSoraMainPage,
};
