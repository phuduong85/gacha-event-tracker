# Ingestion Pipeline

Six stages, run per source. Every stage writes its outcome to `ingest_runs` so a failure two days
ago can be diagnosed without re-running.

```
fetch → parse → merge → validate → reconcile → gate and publish
         │                                            │
    (sanitize)                                        └──► quarantine
```

Sanitizing is stage 2.5 rather than a stage of its own: it is wired into the adapter seam, so it
runs on every source without the pipeline arranging it.

## No LLM

Event data is extracted by deterministic code only. There is no model call anywhere in this
pipeline, no API key, and no per-run cost.

This is a deliberate constraint, not an omission:

- A source that cannot be parsed deterministically **does not get an adapter.** Report it rather
  than reaching for inference.
- Parser output is reproducible — the same fixture always yields the same events, which is what
  makes the fixture tests meaningful.
- Iterating is free and offline: `bun run parse <adapter-id> <fixture>`.

If a source's markup is too unstable to parse, the answer is a different source, not a model.

## Three layers: parsers, adapters, merge

The layering is what makes a second, third, or tenth source cheap.

| Layer | Answers | Lives in | Scope |
|---|---|---|---|
| **Parser** | "How is this *site* laid out?" | `src/ingest/parsers/` | One site template, many games |
| **Adapter** | "Which URL, for which game, via which parser?" | `src/ingest/adapters/index.ts` | One page |
| **Merge** | "These sources disagree — now what?" | `src/ingest/merge.ts` | One game, many sources |

Consequences worth internalising:

- Adding a source for a site already parsed = **one entry in `SOURCES`**. No new parsing code.
- Adding a new *site* = one parser module + its `PARSERS` entry, then adapters as above.
- A game may have any number of sources. `parseGame(game, documents, now)` runs them all and
  merges.

### Parsers in the tree

| Parser | Site | Sources using it |
|---|---|---|
| `game8` | game8.co article calendars | Genshin, Star Rail, Wuthering Waves, ZZZ, Endfield, NTE, Persona 5: The Phantom X, Chaos Zero Nightmare, Umamusume |
| `wikigg` | wiki.gg MediaWiki `mp-event` templates | Endfield |
| `akwiki` | arknights.wiki.gg's `mrfz-wtable` "Ongoing/upcoming" table | Arknights |
| `fandom` | Fandom wikis via the MediaWiki `action=parse` API — four page templates: `Event \| Time Period \| Version` wikitables, FGO's picture-fenced `ONGOING EVENTS` blocks, Nikke's `Event \| Start(UTC+9) \| End(UTC+9)` tables, and Infinity Nikki's `Event \| Duration \| Description \| Type` article-tables | Reverse: 1999, Fate/Grand Order, Nikke, Infinity Nikki |
| `bawiki` | bluearchive.wiki's rendered `/wiki/Events` — a JP/Global tabber over `Name (EN) \| Start date \| End date \| Notes` wikitables | Blue Archive |
| `holodoriwiki` | holodori.wiki's rendered `/wiki/Events` — `Current Events` and `Past Events` wikitables over `Event \| Type \| Start Date \| End Date` | hololive Dreams |
| `iopwiki` | iopwiki.com's `gf-table event-period` tables — `Title \| Period (start/end) \| Server \| Type \| Comment`, one table per event and one row per server | Girls' Frontline 2 |
| `stellasorawiki` | stellasora.miraheze.org's front-page `Current Banners` module — `<time datetime>` pairs inside `stellasora-home-banner` blocks | Stella Sora |

`wikigg` is the better shape by a distance: it emits ISO timestamps with one timer per server
region, so its events carry exact precision and real `regionEnds`. Prefer a source like that over a
prose wiki when both exist, and give it a higher `priority`.

`fandom` is the only parser whose body is not HTML: it reads an `action=parse` JSON envelope and
takes the rendered wikitext out of `parse.text`. That is not a preference — the rendered page is
behind a Cloudflare challenge and the API is the surface the wiki's `robots.txt` allows, so the
adapter's URL is an API call and the stored snapshot is JSON despite its `.html` name (every body
`snapshots/` keeps is named `<id>.html`, whatever its content type). Its `canParse` therefore checks
the envelope as well as the table, because an error payload or a challenge page must fail loudly
rather than parse to zero events. Two page facts drive the rest of it:

- **The title is the row's `<b>`, never the cell text.** The cell leads with a banner image, and a
  missing image renders as a red link reading `File:<Event> Banner.png` — which a cell-text reader
  publishes as the event's name.
- **These pages are archives, not schedules.** All five tables list every event since version 1.1
  (154 rows, six of them unfinished when the fixture was captured), with no "ongoing" section to
  anchor on. Inclusion is therefore decided against `ctx.now`, the one parser here that does so;
  `akwiki` and `game8` can gate on a heading instead, and should where one exists.

The second Fandom source, Fate/Grand Order, shares the envelope and nothing else, so `fandom` is one
parser over two templates the way `game8` is one over seven. `canParse` and the parse branch both
route on the same check, and the differences are worth knowing before touching either:

- **The page is a choice.** `fategrandorder.fandom.com` publishes `Event_List` (Japanese server) and
  `Event_List_(US)` (English), months apart and cross-linked. The adapter reads the `(US)` one; a
  test asserts the URL, because this source shipped once off the Japanese page and every date it
  published was wrong by a server. AGENTS.md § Fandom has the rest.
- **Sections are fenced by pictures, not headings.** `ONGOING EVENTS`, `FUTURE EVENTS` and
  `PAST EVENTS` are banner images with the label in a positioned `<div>`. Only the ongoing section
  is read, and `canParse` asserts both dividers bounding it.
- **The other two sections are undatable, which is why they are skipped rather than filtered.**
  Upcoming rows give a month and no day; the 111 past tables state no year at all — unlike the
  Japanese page's, which carry it in a `MMYYYY` table id.
- **Durations name a zone but no clock** (`August 12, 2026 ~ August 26, 2026 PDT`), so the stated
  calendar day is kept as-is: there is no time of day for a UTC conversion to anchor to, and the
  start's day is half the event ID.
- **`(US)` is stripped from the title and kept in the URL.** It disambiguates the English article
  from the Japanese one, so it belongs to the article's name and not to the event's.

`bawiki` is the mirror image of `fandom`: same MediaWiki software, opposite conclusion about which
surface to read. bluearchive.wiki is Miraheze, whose `robots.txt` disallows `/w/` and `/*?action=`,
so the API is closed and the rendered `/wiki/Events` page is what `*` is allowed — and it serves our
own `User-Agent` a `200`. Three page facts drive the parser (all three in AGENTS.md § Blue Archive):

- **JP and Global are separate tabs, months apart**, so only Global is published — the `akwiki`
  hazard. The Global tab's nav *button* precedes both panels, so slicing from the first matching id
  reads the Japanese schedule.
- **Three tabs are named Global**, the schedule plus Mini-Event and Joint Firing Drill. The schedule
  is identified by its `Name (EN)` header rather than by position, and `canParse` runs the same
  lookup so a rename fails the run rather than emptying the lane.
- **Nothing on the page states a time of day or a timezone.** The schedule's bare ISO dates are day
  precision; the five tables that do carry a wall clock name no zone for it and are left unparsed
  rather than read as UTC.

`akwiki` shares a host family with `wikigg` and nothing else — arknights.wiki.gg has no `mp-event`
cards, so the two are separate modules rather than one parser with a branch. Two things about that
page shape are worth knowing before touching it:

- **Every row states two schedules, CN and Global, about five months apart.** Only Global is
  published. A row with no Global line yields no event rather than borrowing the CN one.
- **Only the next boundary is machine-readable.** The countdown sits on the end while an event runs
  and on the start while it is still upcoming, so one side is exact and the other is the table's
  date — and which is which flips when the event goes live. An exact instant is therefore accepted
  only when it falls on the same UTC day as the date beside it, because `startsAt.slice(0, 10)` is
  part of the event ID and a start that moved a day would orphan every completion mark on the
  morning the event began.

### Date formats understood

All live in `src/ingest/dates.ts`, each returning null rather than inferring anything:

| Function | Shape | Seen on |
|---|---|---|
| `parseMonthDayYear` | `August 12, 2026` | Genshin detail rows |
| `parseMonthDayRange` | `August 12 - September 21, 2026` (year on the end only) | Genshin, NTE |
| `parseFullRange` | `Aug. 14, 2026 - Aug. 24, 2026` (a year each side) | Star Rail, Wuthering Waves, Fate/Grand Order |
| `parseShortSlashRange` | `08/09/26 - 08/30/26` | Endfield |
| `parseSlashDateTimeRange` | `2021/01/16 04:00 - 2021/01/31 03:59` | Genshin past events |
| `parseLabelledStartEnd` | `Start: January 24, 2025 End: Permanent` | Infinity Nikki |
| `parseAdjacentFullRange` | `July 30, 2026 August 13, 2026` (halves split by an `<hr>`) | Persona 5: The Phantom X |
| `parseYearFirstSlashRange` | `2026/07/30 – 2026/08/20` (year first, so field order is not inferred) | Arknights |
| `parseOrdinalDateTimeRange` | `November 9th, 05:00 - December 4th, 2023, 04:59 (UTC-5)` (ordinal days, stated offset) | Reverse: 1999 |
| `parseIsoDay` | `2026-08-04` (one boundary per column, so nothing to split) | Blue Archive |
| `parseSlashClockZone` | `08/17/2026 8:00PM (JST)` (one boundary per column, 12-hour clock, **named** zone) | hololive Dreams |
| `parseIsoClockRangeUtc` | `2026-08-06 13:00 - 2026-08-26 22:59 (UTC)` (whole range in one cell, **zone required**, nothing converted) | Girls' Frontline 2 |
| `parseIsoOffsetInstant` | `2026-08-03T21:00-07:00` (a machine-readable `<time datetime>` attribute; **offset required**) | Stella Sora |
| `parseDayMonthYearClock` | `12 August 2026`, `10 September 202604:59:59` (day-first; the offset comes from the **column header**, and a clockless boundary keeps its printed day) | Nikke |
| `parseZonelessClockRange` | `July 20, 2026 04:00 – August 10, 2026 03:49` (reads the clock and **discards** it — the page states no zone, so only the printed day is publishable) | Infinity Nikki |
| `parseOpenRange` | `Jul. 24, 2026 - End of 4.6`, `July 10, 2026 - Permanent` | Star Rail, Wuthering Waves |

**A day-precision result is 00:00Z, and that is a placeholder rather than a time.** Every reader
above returns `precision: "day"` when the source printed no clock, and stores the date at UTC
midnight because it has to store *something*. It is not a statement that the event begins or ends
then, and nothing may count down to it literally: `clockFor` resolves a day-precision boundary to
that game-day's server reset for the reader's region (`docs/DATA-MODEL.md` § Field notes).

**No parser may store a resolved boundary, and three of them must read one to decide inclusion.**
The stored value stays the printed day at 00:00Z: resolving it here would need a region the parser
does not have, and would bake one reader's server into the feed everybody downloads. But a parser
whose page carries no "ongoing" heading it can trust decides currency against `ctx.now` itself —
`bawiki.ts`, and the Fate/Grand Order and Infinity Nikki branches of `fandom.ts` — and comparing the
placeholder to `now` retires a row at UTC midnight, hours before `clockFor` calls it over for
anybody. The reader does not see a stale row; they watch the deadline they were counting down to
disappear on its last day, which is the silent drop AGENTS.md § Working on parsers calls the
dangerous failure. So those three ask `latestBoundaryMs` (`src/shared/time.ts`) when the boundary is
day-precision: the last region's reset, and therefore the instant the row is history for every
reader rather than for the earliest of them. Being generous by nine hours costs one expired row at
the bottom of a list; being strict costs a live one.

`parseOpenRange` is tried last because it is the most permissive — it accepts any leading full date
and reports no end.

`parseAdjacentFullRange` and `parseYearFirstSlashRange` are anchored at both ends and require a year
on each half, which is what keeps them from eating prose. `August 12, 2026 Day 3 rewards are doubled`
would otherwise read "Day 3" as an end, and
`June 25, 2026 July 16/30, 2026` names *two* candidate ends — so it takes neither, and the leftover is
not shown as a summary either (a date the parser refused to trust must not reappear dressed as
information).

### The parser interface

```ts
export interface SourceParser {
  id: string;                                   // "game8"
  label: string;                                // "Game8"
  canParse(html: string): boolean;              // structural sanity check
  parse(html: string, ctx: ParseContext): GachaEvent[];
}
```

`canParse` is the redesign tripwire. Without it, a site rewrite makes every selector miss and the
parser returns zero events — which reads downstream as "this game has no events" rather than as a
failure. The adapter throws when `canParse` is false, so the run fails loudly and the previously
published events stay put.

Keep `canParse` structural, not content-based, and **do not over-fit it**. Game8's own pages differ
in attribute quote style (`class="a-table"` on Genshin, `class='a-table'` on NTE), which is exactly
the kind of variation a naive check gets wrong. Every regex in `html.ts` is attribute-agnostic for
the same reason.

### The adapter registry

```ts
const SOURCES: SourceSpec[] = [
  { id: "genshin-game8-events", game: "genshin",
    url: "https://game8.co/games/Genshin-Impact/archives/301601", parserId: "game8" },
  { id: "nte-game8-events", game: "nte",
    url: "https://game8.co/games/Neverness-to-Everness/archives/592073", parserId: "game8" },
];
```

`priority` (default 0) breaks ties when two sources disagree and neither is clearly better — give
official feeds a higher number than community wikis. Adapter ids are `"<game>-<site>-<page>"` and
are recorded on every event as `sourceId`, so any row in the feed traces back to the source that
produced it.

### Assessing a new source

| Source shape | Verdict |
|---|---|
| JSON API, or an HTML table with consistent headers | Good — write the adapter |
| Label/value or column tables with full dates including a year | Good — an existing parser may already handle it |
| Dates without a year, or no end date at all | **Unsupportable** — yields nothing rather than guessing |
| Free-form prose with no table structure | Find a different source |
| One wiki, two servers' schedules | **Read which one before writing anything.** Three sources here publish both: `akwiki` in a CN column, `bawiki` in a JP tab, `fategrandorder.fandom.com` on a whole separate page that says so in its first sentence. Every one of them parses cleanly and every one of them is months wrong for our readers |
| A clean table whose newest row is months old | **Not a source, an archive.** Check the *latest* date before writing anything: `bluearchive.fandom.com` parses perfectly and yields zero live events, which shows up as an empty lane and a permanently rejected snapshot rather than as an error |

Game8 uses at least seven page templates, a game's page may use any of them, and one page may mix
several:

1. **Label/value detail tables** — `Event Start` / `Event End` rows under a per-event `h3`, full
   dates with year. *(Genshin Impact)*
2. **Column tables** — `Event | Duration | Event Details | Rewards`, one row per event, under a
   section heading. *(Neverness to Everness)*
3. **Image-grid schedules** — a bare `MM/DD`, no year, no end date. **Unsupportable.**
4. **Combined cells** — one cell holding label, range and blurb
   (`Period: 08/09/26 - 08/30/26 During the event...`). *(Arknights: Endfield)*
5. **Rowspan Start/End pairs** — the event name spans two rows, so a flat cell reader sees
   `[title, "Start", date]` then `["End", date]`. *(Zenless Zone Zero)*
6. **Labelled cells** — one cell holding `Start: <date>` and `End: <date>` split by a `<br>`, where
   the end half is often the word `Permanent`. *(Infinity Nikki)*
7. **`<hr>`-separated pairs** — a `Event | Duration` table whose two dates are divided by a rule
   rather than a dash, so a tag-stripping reader sees only whitespace between them. The same page
   repeats each live event under its own `h3` with `Start Date` / `End Date` rows and a paragraph of
   prose; those corroborate the dates and supply the blurb the flat table lacks.
   *(Persona 5: The Phantom X)*
8. **Two schedules side by side in one `<table>`**, under a spanning label row —
   `Standard Banners | Banner | Rating | Availability | Paid Banners | Banner | …`, with the real
   header on the row below and three-cell data rows under that. The label row is *plausible*: it
   contains both column words, resolves, and puts the range at an index no data row has, so the
   table yields nothing at all with no error. `readColumnTable` therefore decides the header by what
   it produces — row 1 is tried **only when row 0 produced nothing**. *(Umamusume)*

Shapes 1, 2, 4, 5, 6, 7 and 8 are handled. Before assuming a new Game8 page will work, dump its heading/table
structure and check which shape it uses — and check **every** table, not just the obvious one.
Endfield was written off as undatable on a first pass that only inspected its `Duration` rows; its
two real events were in a table further down.

**Check what ends a section, too.** Headings decide inclusion and the level is not consistent: Persona
5 puts its whole finished back catalogue behind an `<h4>Finished Events</h4>` inside a collapsed
accordion, so a reader that ignores `h4` publishes fifty dead events. Genshin uses `h4` the opposite
way — for sub-headings *within* one event ("Availability Period") — so an unrecognised `h4` gates the
section but must never claim the event title.

## Stage 1 — fetch

- Send `If-None-Match` / `If-Modified-Since` from `sources.etag` / `last_modified`. A `304` ends
  the run as `skipped_unchanged`.
- `User-Agent: gacha-event-tracker/1.0 (+https://github.com/<owner>/gacha-event-tracker)`.
- Honor `robots.txt`; cache parsed robots per host for 24h. **Fail closed** — a `robots.txt` that
  5xxs or times out means "do not fetch", because a permission we could not read is not a
  permission we have. A 404 means no restrictions.
- **`--force` sets the 6h floor aside for one run**, and nothing else: conditional headers still go
  out (so an unchanged page is a `304`, not a re-serve), per-host spacing still applies, robots still
  decides, and there are still no retries. A source that was not due and is *also* disallowed stays
  skipped, for the reason that actually matters. Refused under CI — a schedule that forces every
  cycle is a shorter interval with extra steps. Every source asked early is listed in
  `summary.forced` and warned about; a run that was due anyway is never reported as forced, because a
  summary that cried "forced" on an ordinary run would train the reader to ignore the word.
- **One narrow exception, opt-in per run: `--assume-robots-on-403`.** Fandom answers a datacentre
  address `403` on `/robots.txt` itself while `api.php?action=parse` answers our own User-Agent with
  a `200`, so the gate fails closed and four sources can never refresh — even though their rules are
  known, because a person read them in a browser and wrote them into AGENTS.md § Scraping conduct.
  The flag makes the run proceed on that recorded permission. Three things bound it: it applies to
  `403` **only** (a 401, a 5xx or a soft 404 are still "we do not know"); it never overrides a
  `robots.txt` we *could* read, so a file that disallows us still says no; and it is refused under
  CI, because it stands in for a human and there is none on a runner. Every host it applied to is
  named in the run's warnings and in `summary.assumedRobots` — an override that reports nothing is
  one nobody withdraws. It changes no other obligation: still one request per source, still six
  hours apart, still spaced per host.
- 20s timeout. **No retries**: a retry is a second request, and AGENTS.md § Scraping conduct says
  one per source per cycle. A failed source waits for the next cycle instead.
- **Only `200` is a page** (plus `304` for "unchanged"). Not `response.ok` — that admits the whole
  2xx range, and `202 Accepted` is what an edge bot-manager answers with while it serves a challenge
  instead of the wiki. Admitting it fed that challenge page to the parser, which reported "yielded 0
  events" — the symptom, with the status that explained it unmentioned. `204` has no body and `206`
  is a fragment; none of them is a document.
- **Space requests to a host we have already asked this cycle** — the host's `Crawl-delay` if it
  states one, else `DEFAULT_HOST_GAP_MS` (2s). The wait is taken after the interval and robots gates,
  so a source we then skip costs nothing.
- Store raw bytes in `snapshots/<source-id>.html`, with hash/ETag/Last-Modified alongside it.

On failure: increment the failure streak, leave published events untouched, end as `failed`. A
source being down never mutates the feed. A non-`ok` status also records what turned us away — the
`Server` header, whether a `CF-Ray` was present, any `Retry-After` — because a bare `HTTP 403` reads
identically whether the page moved behind a login or a CDN decided the runner is a bot farm.

**The failure streak is read, not just written.** `consecutiveFailures` reaching
`BROKEN_AFTER_FAILURES` (3, so ~36h at two cycles a day) promotes a source from "down" to `broken`:
annotated on the run page, listed in the job summary with its status code, and counted in the
`broken` step output that `refresh.yml` fails on *after* committing. See AGENTS.md § Scraping
conduct for why that ordering is load-bearing.

**Built: `scripts/refresh-sources.ts`** (`bun run refresh`), scheduled by
`.github/workflows/refresh.yml`. It takes its adapters, store, robots gate, fetch and clock by
injection, so the whole runner is tested offline against a fake fetch. A fetched body is *rejected*
— the previous snapshot survives — when it fails `canParse`, throws, or yields zero events; storing
an empty parse would make the feed build prefer it over the fixture and silently empty a game's
calendar. One source down is a warning and exit 0; every source failing is exit 1, so CI never
commits a cycle that learned nothing.

## Stage 2 — parse

Hash the raw body (sha256) → `content_hash`. **If it matches `sources.content_hash`, end as
`skipped_unchanged`** and do no further work.

Otherwise call `adapter.parse(html, ctx)`, which runs `canParse` and then the parser. Because
parsers are pure, this stage is fully reproducible offline against the stored snapshot:

```
bun run parse <adapter-id> fixtures/<game>/<source>-<date>.html
```

**Watch the event count.** A source that changes date format or table shape makes events vanish with
no error — the parser simply matches nothing. Compare each run's `events_seen` against the previous
run and flag a large drop. A source that went from 13 events to 2 has broken, not quieted down.
This is the most likely real failure mode of a parser-only pipeline, and nothing else surfaces it.

### Stage 2.5 — sanitize

Everything a parser returns came from a page we do not control, and it is about to become React
text, JSON on disk, a `localStorage` key and eventually a SQLite row. `src/ingest/sanitize.ts` is
the trust boundary, applied in `toAdapter()`'s `parse` wrapper in `src/ingest/adapters/index.ts` —
the one seam every source passes through, so a source added tomorrow is sanitized without its
author doing anything and no parser can opt out. It runs after `canParse` and before validation.

What it does: removes script/style/comment content and residual tags; decodes entities **to a fixed
point** so `&amp;lt;script&amp;gt;` cannot resurrect as markup in a later decoder; NFKC-normalizes;
strips control, zero-width and bidi-override characters (an RTL override visually spoofs a title);
collapses whitespace; truncates to the schema's own caps at a word boundary; and requires
`sourceUrl` to be absolute http(s), falling back to the source's registered URL rather than
dropping the event.

Three constraints it holds:

- **It never touches a date.** Not a timestamp, not a precision, not `regionEnds`. Dates are the
  product's promise and the sanitizer's job stops at prose and URLs.
- **It cleans rather than drops.** The only drop is a title that sanitizes to nothing, and every
  repair and drop emits a note whose default sink is `console.warn` — silence is not something a
  future caller gets for free (§ Silent drops).
- **It does not move event IDs.** An ID is recomputed only when sanitizing actually changed the
  title *and* the incoming ID was minted the standard way. All eleven fixtures pass through with
  zero repairs and byte-identical output, which is the regression guard: IDs are localStorage keys
  and moving one orphans a reader's marks with no server-side recovery.

## Stage 3 — merge

Only meaningful when a game has more than one source; a single-source game passes straight through.

`mergeEvents(groups)` compares events across sources:

1. **Same ID** → same event; keep the higher-confidence copy. Applies within a source as well as
   across sources — an identical id is the same row seen twice, whatever it is called.
2. **Near match** — **different sources**, same game, title similarity ≥ 0.80, starts within 24h —
   → same event under different titles; keep the higher-confidence copy.
3. **Otherwise** → distinct events; keep both.

Title similarity alone would merge a rerun with its original, since reruns reuse the name. The
start-date proximity check is the actual guard; the title threshold is deliberately loose (0.80) so
that "Stygian Onslaught" and "Stygian Onslaught Event" collapse into one row rather than showing
the user a duplicate.

**Near matching is cross-source only, and that restriction is load-bearing** (2026-08-19). Fusing
two rows from *one* page overrules a distinction the publisher made on purpose, and the loose
threshold that makes rule 2 useful across sources makes it actively wrong within one: Game8's
Umamusume banner list runs `3 Star Guaranteed 1.5 Anniversary Scout (Character)` and `(Support)`
concurrently, titles differing by a single parenthetical and starting the same day. That scores far
above 0.80, and fusing them dropped a live banner off the calendar with nothing anywhere reporting
it — a silent drop, which § Silent drops ranks as the dangerous failure. Rule 1 still fuses repeats
within a source, so nothing is duplicated; the parsers dedupe by id before merge is reached anyway.

**Agreement raises confidence (+0.10) only across different `sourceId`s.** The same row seen twice
in one document is not corroboration.

**Disagreement is surfaced, never averaged.** Two sources whose `endsAt` differ by more than 24
hours produce a `conflicts` entry; the pipeline routes those to quarantine. Splitting the difference
between two dates would produce a value neither source asserts — the worst possible answer for a
product whose promise is date accuracy.

## Stage 4 — validate

Zod parse against `GachaEvent`, then calendar sanity rules. Anything failing a hard rule goes to
quarantine with `reason: 'sanity_failed'` — never to the feed.

**Hard rules (reject):**

| Rule | Rationale |
|---|---|
| `endsAt` after `startsAt` when both present | A backwards interval is always a parse error |
| Duration under 180 days | Patch cycles are ~6 weeks; longer means a misread year |
| `startsAt` within [now − 2y, now + 1y] | Catches century typos and relative-date misreads |
| `endsAt` null exactly when `endPrecision` is `"unknown"` | The two fields must agree |
| `regionEnds` non-null exactly when `regionScoped` | Same |
| All `regionEnds` values within 24h of each other | Region resets differ by hours, not days |
| `title` non-empty, ≤ 200 chars, not a placeholder | Catches header rows scraped as events |

Rules 1, 4, and 5 are enforced by `GachaEvent` itself in `src/shared/schema.ts`, so they cannot be
bypassed by constructing an event object directly.

**Soft rules (reduce confidence, do not reject):**

- Duration under 1 hour or over 60 days → −0.2
- Title very similar to another event in the same batch → −0.15 (likely a duplicate row)

## Stage 5 — reconcile

Diff validated candidates against currently published events.

1. **Exact ID match** → compare fields. Unchanged: no-op. Changed: update.
2. **Near match** → update the existing event, **keeping the existing ID**. This is what survives a
   wiki renaming an event without orphaning every user's completion mark.
3. **No match** → new event.
4. **Published event absent from this run** → mark `status = 'delisted'`. Never delete.

**Conflict detection.** A candidate moving an already-published `endsAt` by more than 24 hours is a
`date_conflict`. The user may have planned around the old date, so route it to quarantine regardless
of confidence.

### Scoring

Confidence records how firmly the sources pinned an event down, so the gate can hold back weak
cases. The parser assigns a base score; merge and reconcile adjust it.

```
base                                          0.95
−0.05  a boundary is day-precision rather than exact
−0.15  the end date is unknown (endsAt null)
+0.10  an independent source corroborates
+0.15  identical event parsed in a previous run
−0.20  any soft rule fired
−0.30  a date_conflict against a published event
```

Clamp to [0, 1]. `CONFIDENCE_THRESHOLD` (default 0.8) is the gate. Under the current parser a
day-precision event with a known end scores 0.85 and publishes, while one with an unknown end
scores 0.75 and is held — the intended bias.

## Stage 6 — gate and publish

| Condition | Destination |
|---|---|
| Confidence at or above threshold, no conflict | publish |
| Confidence below threshold | quarantine, `low_confidence` |
| Cross-source or cross-run date disagreement | quarantine, `date_conflict` |
| Failed a hard rule | quarantine, `sanity_failed` |
| Shape the schema does not recognise | quarantine, `novel_shape` |

A quarantined event does not block its siblings — if eight pass and two are held, the eight publish.

Publish upserts by ID in a transaction. Bump `version` and `updatedAt` only when a field actually
changed, or the freshness badge (PRD F7) becomes meaningless. Update `sources.content_hash`,
`etag`, `last_success_at`, and reset `consecutive_failures`.

## The review gate

Quarantined events surface at `GET /review` on the admin listener (`127.0.0.1:ADMIN_PORT`). See
`docs/ARCHITECTURE.md` § Why `/review` needs no auth.

- `POST /api/review/:id/approve` — writes to `events` with `extraction_method: 'manual'`,
  `confidence: 1.0`. Approving with edits is supported; the corrected value publishes.
- `POST /api/review/:id/reject` — stamps resolution only. The candidate is held again next run if
  the source has not changed, which is intended.

**Quarantine depth is the pipeline's health signal.** A growing queue means a source changed shape.
`/api/health` exposes the count.

## Testing

Every adapter ships:

1. `fixtures/<game>/<source>-<YYYY-MM-DD>.html` — a real captured page.
2. `fixtures/<game>/<source>-<YYYY-MM-DD>.expected.json` — the exact `GachaEvent[]` it produces.
3. A test running `parse` against the fixture with a pinned `ctx.now`, asserting deep equality.

`bun test` must pass with no network access.

**Regenerating `.expected.json` from the parser makes the test self-consistent, not correct.** After
an intentional change, re-verify a sample against the live page — and ideally extract the same data
a second way (a throwaway script over the fixture) to confirm counts and dates independently. That
independent check is what pinned the exact event counts on every adapter here, and it is what caught
Endfield's real events sitting in a table the first pass never read.

When a source changes shape, capture a new fixture **alongside** the old one and keep both — the old
fixture is the regression test proving the parser still handles the previous format.

`test/dates.test.ts` covers the cases that matter most: a missing year returns null rather than
guessing, impossible calendar dates are rejected, ranges crossing New Year roll the start year back,
and abbreviated months parse. `test/merge.test.ts` covers cross-source agreement, disagreement, and
rerun disambiguation. These are the last line of defense before a wrong date reaches a user.
