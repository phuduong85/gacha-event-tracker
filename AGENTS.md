# AGENTS.md

This file provides guidance to coding agents working in this repository. It is the working
agreement: what this project is, the constraints it holds to, and the rules that are not visible
from the code alone. Read it before changing anything.

`CLAUDE.md` points here, so Claude Code picks it up too — keep the guidance in this file and leave
that one a pointer.

## Read the docs before changing the thing they describe

This file is the working agreement, not the specification. `docs/` holds the reasoning, and it is
written for whoever touches that area next — reading the relevant one first is the difference
between repairing a rule and rediscovering it the expensive way.

| Doc | What it settles | Read it before |
|---|---|---|
| `docs/PRD.md` | What the product is for, feature by feature (F1–F14), and the quality bar for dates | Changing behaviour a reader can see, or arguing something is out of scope |
| `docs/DATA-MODEL.md` | `GachaEvent`, the SQLite tables, every `localStorage` key space, the export format | Touching `src/shared/schema.ts`, an ID scheme, a stored key, or the game/reset table |
| `docs/INGESTION.md` | The six pipeline stages, the parser/adapter/merge layering, date formats, the review gate | Adding a source, writing or repairing a parser, or changing the fetch runner |
| `docs/ARCHITECTURE.md` | Process shape, file layout, request paths, offline and update mechanics | Moving files, adding a route, or changing the service worker |
| `docs/FEEDBACK.md` | What readers actually said about the first release, and the work it argues for | Deciding what to build next |
| `docs/SOURCES.md` | Which sites publish a usable schedule for the games we still do not cover, and what is wrong with the ones that do not | Picking the next game to add, or assessing a source request |

Two rules that follow from that:

- **The docs are part of the change.** A change that makes a sentence in `docs/` false is not
  finished until that sentence is fixed. They are the only record of *why*, so drift costs the next
  agent the whole reasoning, not just a detail.
- **When this file and a doc disagree, that is a bug — say so.** Neither one silently wins. This
  file summarises; the doc holds the argument, so fix whichever is actually wrong rather than
  reconciling them in your head and moving on.

## What this is

A web app that aggregates live and upcoming events across popular gacha games, plots them on a
calendar, sorts them by end date or by what the reader is partway through, tracks day-by-day
progress on events that repeat daily, and lets a user mark events completed.

**Status: working app, refreshing itself on a schedule.** Schema, eight parsers, nineteen sources across
eighteen games, the full interface, offline support, a static server, a Docker image and CI all exist and
are tested. The refresh runner (`bun run refresh`) fetches, caches raw snapshots and rebuilds the
feed; `.github/workflows/refresh.yml` runs it twice a day and commits only when a page actually
changed. The SQLite layer and the review queue are still specified in `docs/` but not built, so the
feed is a static JSON file built from snapshots, falling back to checked-in fixtures.

## Three constraints that shape everything

1. **No accounts, no logins, no user records.** Completion state lives in the browser's
   `localStorage`, keyed by event ID. There is no user table and no session. Any request implying
   "sync across devices" is solved with export/import JSON, not a server-side user.
2. **No LLM in the pipeline.** Event data is extracted by deterministic code-based parsers only.
   There is no Anthropic dependency, no API key, and no per-run inference cost. A source that
   cannot be parsed deterministically does not get an adapter — see `docs/INGESTION.md` § No LLM.
3. **A server is allowed** (Bun) and owns fetching, parsing, and SQLite. The client only ever calls
   this app's own `/api/*`.

## Stack

| Layer | Choice |
|---|---|
| Runtime / server / bundler / test runner | Bun 1.3 (`Bun.serve`, `bun:sqlite`, `bun test`, `bun build`) |
| UI | React 19 + TypeScript (strict) + Tailwind |
| Storage | SQLite via `bun:sqlite` (gitignored — `*.sqlite`) |
| Validation | Zod — one schema module shared by server and client |

The only runtime dependency is `zod`. Do not add a bundler, test runner, HTTP client, or HTML
parsing library — Bun covers all four. `tsconfig.json` runs `strict` plus
`noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.

## Commands

```bash
bun install
bun test                      # full suite, offline, no network, no build needed
bun run typecheck             # tsc --noEmit
bun run dev                   # build then serve on :3000
bun run build                 # feed + css + js + static into public/

# Fetch sources and refresh the snapshots. Makes real requests — see § Scraping
# conduct before running it, and prefer --dry-run.
bun run refresh --dry-run
bun run refresh --only genshin-game8-events

# Run one source against its fixture (offline, free)
bun run parse genshin-game8-events fixtures/genshin/game8-events-2026-08-14.html
bun run parse endfield-wikigg-events fixtures/endfield/wikigg-events-2026-08-15.html --json

# Single test file / single test
bun test test/dates.test.ts
bun test --test-name-pattern "year-less"

# Hosting under a subpath (GitHub Pages)
BASE_PATH=/gacha-event-tracker/ bun run build
```

**Tests must never need build output.** They run before `bun run build` in CI; anything reading
`public/` must create its own fixture tree instead.

`bun run parse ... --json` is also how `.expected.json` fixtures are regenerated after an
intentional parser change. Regenerating them makes the test self-consistent, not correct — always
re-verify a sample against the live page afterward.

## Current state of the code

```
src/shared/       schema.ts (the contract), time.ts, daily.ts, effort.ts, games.ts, feed.ts
                  custom.ts — reader-authored games and events, and their key spaces
src/ingest/       html.ts, dates.ts (sixteen formats), merge.ts, sanitize.ts, robots.ts, snapshots.ts
  parsers/        game8.ts, wikigg.ts, akwiki.ts, fandom.ts, bawiki.ts, holodori.ts, iopwiki.ts,
                  stellasora.ts — keyed by SITE, not game
  adapters/       index.ts — SOURCES registry binding url+game+parser, and the sanitize seam
src/client/       React app, service worker, manifest
  state/          progress, daily log, ignores, prefs, sort — all localStorage
                  useCustom.ts — the reader's own games and events (PRD F13)
                  lens.ts — who sees which rows (focus, outstanding, next-to-expire); pure
                  zoom.ts — the timeline's scale ladder; pure
                  lanes.ts — how the timeline stacks: a lane per game, or one deadline queue; pure
                  theme.ts — dark or light, and what a game hue reads as on each
scripts/          build-feed.ts, build-static.ts, parse-fixture.ts (offline), refresh-sources.ts (fetches)
serve.ts          static server + /api/health
test/             732 tests
fixtures/<game>/  raw HTML + .expected.json per source — pinned, kept forever
snapshots/        current page per source, rewritten by refresh — see its README
```

Not yet built: the SQLite layer and the review UI. Everything upstream of them runs as files on
disk.

## Domain rules that are not obvious from the code

These come from how gacha games actually schedule things, and they cause most bugs here:

- **Store every timestamp as UTC ISO 8601.** Sources publish in a mix of UTC+8, server-local, and
  "after maintenance".
- **Banner ends are usually global and simultaneous; event ends are usually per-region.** Character
  banners end at one instant worldwide; story/login events end at each region's daily reset (Asia /
  America / Europe differ by hours). `regionScoped` and `regionEnds` exist for this — do not
  collapse them into one timestamp.
- **`endsAt: null` is a correct, expected value.** An event whose end is genuinely unannounced gets
  `endsAt: null` and `endPrecision: "unknown"`. **Never invent a plausible date to satisfy a
  non-null type.** This is the worst failure mode this codebase has, because the user's entire
  reason for visiting is trusting the end date.
- **A date with no time of day is stored as 00:00Z, and that is a placeholder, not an instant.**
  Most sources print `August 19, 2026` and nothing else, so `dates.ts` returns `precision: "day"` at
  UTC midnight because it has to return something. Counting down to it literally turns the
  placeholder into a claim the source never made — that the day opens in UTC — and retires an event
  up to nine hours before the game does, while the reader is standing in the game watching a longer
  timer. So `clockFor` (`src/shared/time.ts`) resolves a day-precision boundary to the reset that
  opens that game-day on the reader's server, via `dayStartMs`: the same clock `daily.ts` keys every
  tick by, and the only fact we hold about a game's day. Two boundaries are never re-anchored — a
  `regionEnds` value, which exists precisely because the source stated an instant per server, and an
  event the reader typed in, which `readerInstant` already resolved in their own timezone. This is a
  *reading* of the printed date, not an invented time, and it changes nothing stored: the feed,
  every event ID and the parsers are untouched, so it is one resolution at the point where the
  region is finally known.
  The same clock governs the *other* end of the pipeline. A parser whose page has no trustworthy
  "ongoing" heading decides currency against `ctx.now` itself, and comparing the 00:00Z placeholder
  to `now` retires a row hours before `clockFor` calls it over for anybody — the reader watches a
  deadline they were counting down to vanish on its last day. So `latestBoundaryMs` answers the same
  question for the *last* region, and `bawiki.ts` and two branches of `fandom.ts` ask it. Nothing
  stored changes: it is one comparison, not a resolved boundary written to the feed.
- **Patch cycles are ~6 weeks.** Any event over 180 days is a parse error, not a long event. The
  validator and the tests both reject it.

## Working on parsers

- **Parsers are pure.** No network, no `Date.now()`, no randomness — time arrives as `ctx.now`.
  This is what makes fixture tests meaningful; a parser that reads the clock cannot be tested.
- **Skip, never guess.** Every function in `dates.ts` returns `null` rather than inferring a missing
  year, month, or end. `readColumnTable` drops a row it cannot date. An omitted event is a
  recoverable disappointment; a confidently wrong date is the failure this product exists to prevent.
- **Parsers are keyed by site, not game.** One `game8` parser serves nine sources and `fandom` four;
  `wikigg`, `akwiki`, `bawiki`, `holodoriwiki`, `iopwiki` and `stellasorawiki` serve one each — the first two share a host family
  and have entirely different templates, and the last two are both Miraheze wikis whose page
  templates have nothing in common. Adding a source for a known site is one `SOURCES` entry; a new
  site is a parser module.
- **A source may publish more than one region's schedule.** Arknights' wiki lists CN and Global on
  every row, five months apart. Publish the one our readers are on and skip the row that lacks it —
  a CN date on a Global calendar is a confidently wrong date, not a near miss.
- **Game8 has no single template.** Eight shapes are known and a page may mix them: label/value
  detail tables, column tables, image-grid schedules (unsupportable), combined label+range+blurb
  cells, rowspan Start/End pairs, labelled `Start: … End: …` cells, `<hr>`-separated date pairs, and
  two schedules laid side by side in one `<table>` under a spanning label row.
  Full table in `docs/INGESTION.md`. Before assuming a new
  Game8 page will work, dump its structure and check **every** table — Endfield was written off as
  undatable on a pass that only inspected its `Duration` rows, and its real events were further
  down the page.
- **The header row is the row that dates rows, not the first one.** Game8's banner pages put the
  Standard and Paid schedules side by side inside one `<table>` and label the pair
  `Standard Banners | Banner | Rating | Availability | Paid Banners | …`. That row is not merely
  unhelpful, it is *plausible* — it contains both column words, so it resolves and puts the range at
  an index no data row has, and the whole table yields nothing with no error anywhere. So
  `readColumnTable` falls back to row 1 **only when row 0 produced nothing**, which is what keeps
  every page that parses today parsing identically. Verified rather than assumed: the change was
  diffed across all pinned fixtures and every live snapshot, and moved no existing event.
- **Some Game8 wikis schedule banners, not events**, and head their sections accordingly —
  `List of All Banners`, `All Current Banners`, and a `Previous Banners` back catalogue that
  `previous events` does not match. All three are in the section vocabulary now. The finished rows
  sit directly below the live ones and are dated identically, so that exclusion is the only thing
  between the calendar and a year of expired banners.
- **Check what fences a section off.** Inclusion is decided by headings, and the level varies: Persona
  5 hides fifty finished events behind nothing but an `<h4>Finished Events</h4>` in a collapsed
  accordion, while Genshin uses `h4` for sub-headings *inside* one event. So `h4` gates sections but
  never names one — an unrecognised `h4` must leave the current event title alone.
- **Prefer a source that states machine-readable times.** wiki.gg emits ISO timestamps with a timer
  per server region, which is the only reason `regionEnds` carries real data anywhere.
- **Silent drops are the dangerous failure.** A date format the parser does not recognise makes
  events vanish with no error. Abbreviated months (`Apr. 29 - May 13, 2026`) are supported for
  exactly this reason. When adding a source, compare the parser's event count against an
  independent count of the page.

## Event IDs are localStorage keys

```
`${game}:${slugify(title)}:${startsAt.slice(0, 10)}`
→ "genshin:mutual-aid-in-bloom-into-the-frostlands:2026-08-12"
```

Changing `slugify` or `eventId` in `src/shared/schema.ts` — including seemingly cosmetic changes to
the slug rules — **silently orphans every completion mark every user has, with no server-side
recovery**, because the server never had the data. If it must change, ship a client-side migration
that remaps old keys and keep it for at least a year. Use the **schema-guardian** agent on any such
change.

Two more key spaces have the same property, for the same reason:

- **`dailies:<game>`** (`dailiesId` in `src/shared/daily.ts`) keys a game's standing daily chore.
  Two segments, so it cannot collide with an event ID.
- **Game-day keys** (`dayKey`) are `YYYY-MM-DD` in *server-reset space*, not UTC — the day rolls at
  04:00 local server time. They are storage keys *and* they are compared with `<` and sorted, so the
  format is fixed. Changing the reset hour or the offsets moves every reader's streak by a day.
  The clock those keys are cut on — `RESET_HOUR_LOCAL`, `serverOffsetUtc`, `resetHourFor`,
  `resetShiftMs` — lives in `time.ts`, not `daily.ts`, because the countdown resolves day-precision
  boundaries on the same grid (§ Domain rules). Ticks are no longer its only caller, so a change
  there now moves a reader's streak **and** every undated end date at once.
  A game whose server map differs lists the affected regions in `resetOffsets` (`games.ts`) —
  Endfield serves Europe off the Americas machine, so `europe` is UTC-5 there and its reset is
  09:00 UTC, not 03:00. Keep that override **per region**: a blanket per-game offset drags the
  regions that do have their own server onto someone else's clock.
  A game that rolls on a different *hour* says so in `resetHourLocal` instead — Reverse: 1999 resets
  at 05:00, not 04:00, so its day rolls at 10:00 UTC on its single UTC-5 server. Do not encode that
  as a bent `resetOffsets` value: shifting a game's stated server offset to land the right instant
  would misreport the server clock to everything else that asks for it. Both fields are absent for
  every game that takes the default, which is why adding the second one moved nobody's day keys.
  Neither field can express a server whose offset *shifts*: Fate/Grand Order's English server runs
  on US Pacific, which observes daylight saving, and one fixed number is wrong for half the year in
  either direction — so `fgo` takes the default and `games.ts` says why. Reaching for a value anyway
  would re-label day keys twice a year, which is the one thing this whole section exists to prevent.
  Every day-key function takes an optional `game` — **anything reading or writing a tick must pass
  it**, or it writes under one clock and reads under another. A day that drops out of `dailyDays`
  renders no pip, so a tick on it becomes unreachable; check real fixture windows before changing an
  offset.

The sanitizer at the ingest boundary recomputes an event ID only when a sanitized title actually
changed *and* the ID was minted the standard way. If a change to it starts moving IDs on real
fixtures, that is a data-loss bug, not a diff to regenerate.

## Scraping conduct

Sources are community wikis. Treat them as a guest would:

- Honor `robots.txt`; set a descriptive `User-Agent` with a contact URL.
- One request per source per refresh cycle, minimum 6 hours apart. **`--force` sets that floor
  aside for one run, and only a person at a keyboard may pass it** — it is refused under CI, because
  a schedule that forces every cycle is just a shorter interval with extra steps, and the interval is
  the obligation. What makes it defensible is what it does *not* change: conditional headers still go
  out, so a page that has not moved costs the host a `304` rather than a re-serve, and per-host
  spacing, robots, the one-request-per-source rule and the no-retry rule all still apply. Prefer it
  with `--only`: forcing nineteen sources to re-ask a question they answered an hour ago is the
  behaviour this bullet exists to prevent, whatever flag authorised it. The run names every source it
  asked early, and a run that was due anyway is never reported as forced.
- **Space requests to one host**, honouring its `Crawl-delay` and defaulting to 2s. Nine of the
  nineteen sources are game8.co pages, so the per-source floor alone still permits one cycle to arrive
  as nine back-to-back requests to a single site — which is the shape an edge network throttles, and
  what a burst looks like from the far end regardless of our intent.
- Send `If-None-Match` / `If-Modified-Since`; treat `304` as "skip, unchanged".
- Cache raw snapshots so re-parsing never re-fetches. **Iterate against fixtures, not the network.**
- Record `sourceUrl` on every event and surface attribution in the UI.

Note that game8.co disallows `GPTBot` and `Google-Extended` in `robots.txt` — it has opted out of
AI-training crawlers. Our use is a low-rate personal aggregator with attribution and no model
training, and no `User-agent: *` rule applies to our paths. Keep it that way: do not raise the fetch
rate, and do not add an LLM that consumes page content.

**game8.co does not answer a GitHub Actions runner** (confirmed 2026-08-17). Its edge returns
`202 Accepted` with a bot-management body to every one of the nine game8 sources, from the first
scheduled cycle onward — `last confirmed: never` — while the same URLs return `200` and parse
cleanly from a normal address. So `robots.txt` permits us and the network does not, and those nine
games have only ever been built from checked-in fixtures in CI.

The per-host spacing above does not fix this and was not meant to: a 202 on the very first request
of a cycle is address reputation, not rate. **Do not work around it.** Browser-shaped headers, a
proxy, or a residential egress would each be defeating a deliberate access control, which is the
same reason `uma.moe` was declined below — and unlike `uma.moe` we would be doing it to a host whose
`robots.txt` was welcoming, which makes it worse, not better. The legitimate options are to run the
refresh from an address game8 will serve, or to find those games another source.

A source whose ToS forbids automated access does not get an adapter. Flag it and ask.

**Sources assessed and declined** (2026-08-17, extended 2026-08-19), so these are not
re-litigated each pass:

| Source | Verdict |
|---|---|
| `azurlane.koumakan.jp` | **Declined.** `Content-Signal: ai-input=no` — an explicit refusal of collecting content as model input, which is what capturing a fixture to read amounts to. Stronger than game8's or wiki.gg's signal. Find Azur Lane another source |
| `uma.moe` | **Declined.** Data comes from an API behind a Cloudflare Turnstile proof header; an adapter would mean defeating a deliberate access control. The `robots.txt` is permissive, but the gate is not in `robots.txt` |
| `reverse1999.fandom.com` | **Built** (2026-08-17), via `api.php`, not the wiki page — see § Fandom below |
| `bluearchive.fandom.com` | **Declined.** Fetches and parses fine; the page is the problem. Its `Event/Event_List` is a JP-server archive whose newest entry ended 2026-02-18, so all 88 rows are history and it yields **zero** live or upcoming events. An adapter would put an empty lane on the calendar and, because the runner rejects a body that parses to nothing, report a broken source forever. Same failure as the Infinity Nikki Game8 page, further along |
| `bluearchive.wiki` | **Built** (2026-08-17), from the rendered `/wiki/Events` page — see § Blue Archive below |
| `fategrandorder.fandom.com` | **Built** (2026-08-18), via `api.php` like Reverse: 1999 — but off `Event_List_(US)`, **not** `Event_List`, which is the Japanese server. See § Fandom below |
| `holodori.wiki` | **Built** (2026-08-18), from the rendered `/wiki/Events` page. Miraheze again, so the same call as Blue Archive; CC BY-SA 4.0, no `Content-Signal`, no `Crawl-delay` for `*` |
| `prydwen.gg`, `gametora.com` | **Cleared, unbuilt.** `User-agent: *` allows the paths we would want. prydwen sets `Crawl-delay: 10`, far below our one-per-6h |
| `iopwiki.com` | **Built** (2026-08-19), Girls' Frontline 2 — see § IOP Wiki below. `robots.txt` is two lines, `User-agent: *` and `Crawl-Delay: 20`, no `Disallow` anywhere |
| `stellasora.miraheze.org` | **Built** (2026-08-19), from the front page's `Current Banners` module and **not** `/wiki/Banner_List` — see § Stella Sora below |
| `game8.co/games/Chaos-Zero-Nightmare` | **Built** (2026-08-19). Zero parser work — the existing `game8` parser reads it. The ninth game8 source, so fixture-backed in CI from day one |
| `game8.co/games/Umamusume-Pretty-Derby` | **Built** (2026-08-19), off the stable `List of All Banners` page, not the monthly release-schedule pages whose URL changes every month. Cost a widening of `game8.ts`'s section and column vocabulary — see § Working on parsers |
| `nikke-…-international.fandom.com` | **Built** (2026-08-19), via `api.php` like Reverse: 1999 and FGO. Its `robots.txt` was read in a browser and is the standard Fandom file — see § Fandom below. Richest schedule of anything added in this pass: story events *and* dated pickup banners, with the reset clock evidenced on the page |
| `infinity-nikki.fandom.com` | **Built** (2026-08-19), replacing the Game8 page for Infinity Nikki, which had been stale since August 2025. Same standard Fandom `robots.txt`. Published at **day precision**: the page states a wall clock and no zone for it — see § Fandom |
| `infinitynikki.miraheze.org` | **Declined.** Exists and serves `robots.txt`, but the wiki is abandoned — front page last edited 11 February 2025 and `/wiki/Events` returns a permission error. Checked as a replacement for the stale Infinity Nikki Game8 page |
| `prydwen.gg/infinity-nikki` | **Declined.** 404 — prydwen does not cover Infinity Nikki |
| `grayravens.com` (Punishing: Gray Raven) | **Declined.** Conduct is fine; the data is not. The whole 626 KB `/wiki/Events` page contains exactly one date range, written as prose, one event per six-week patch |
| `guardian-tales.fandom.com` | **Declined.** Parses fine and contains no 2026 date at all — newest dated entry is 2025. The `bluearchive.fandom.com` failure again: parses cleanly to nothing live |
| `blhx.fandom.com`, `azurlane-archive.fandom.com` | **Declined.** The two Fandom alternatives to the declined koumakan wiki are dead archives — `Event_Calendar` stops in **2021**, and the archive wiki's headings have nothing under them. Azur Lane still has no source |
| Aether Gazer | **Do not build.** The developer confirmed no further content updates after 23 July 2026, with store listings removed 17 October 2026. The wiki dates nothing anyway — `Event_Guide_List` is an image gallery. A lane that will be empty by winter |
| `marisaimpact.com` (Honkai Impact 3rd) | **Declined** (2026-08-19). Conduct is clear — its `robots.txt` is comments only, with no directive and no `Content-Signal`, and the page answers our own `User-Agent` with a `200`. The data is the problem: the schedule is a grid of week columns headed `Estimated date for Regional Servers` under a page that says `Based on CN server`, it states **no year anywhere**, and it lives at a per-version URL — `/calendar89` is v8.9 and expires on 20 August, with no stable route to the current one. `docs/SOURCES.md` § 13 |
| game8.co hubs for Black Beacon, Brawl Stars, Destiny: Rising, Diablo Immortal, Epic Seven, Fire Emblem Shadows, Gundam UC Engage, Mongil: Star Dive, Pokémon Champions, Pokémon UNITE, Tower of Fantasy | **Declined** (2026-08-19). All thirteen hubs in that sweep exist and answer `200`; these eleven have no usable schedule. Six are abandoned wikis whose newest page is 2021–2025 — the Infinity Nikki failure mode, a source that parses perfectly and publishes history. Gundam's calendar prints ends with no starts, so no event ID; Pokémon UNITE is fresh but its template fails `canParse`, which is the check working. Per-game evidence in `docs/SOURCES.md` § 12 |
| `game8.co/games/MementoMori`, `game8.co/games/fire-emblem-heroes` | **Assessed, not yet built** (2026-08-19) — the two live finds of that sweep, and proposals rather than decisions. MementoMori parses today with no parser change; FEH has the freshest page of any source here and needs a ninth Game8 column shape plus a ruling on the 180-day rule, which one real seven-month banner breaks. See `docs/SOURCES.md` §§ 12a–12b |

**The Infinity Nikki lane was rebuilt on a live source, and its Game8 source was retired.**
`game8.co/games/Infinity-Nikki/archives/487445` stopped being updated on 31 August 2025 — it
mentions the year 2026 zero times — and had been publishing five year-old events with
`endsAt: null`, which the app renders as live-with-unknown-end indefinitely. That is worse than an
empty lane and it is the failure this product exists to prevent, arriving through a source that
looks perfectly healthy to the runner, because **a stale page is not a broken one**: no failure
streak, no annotation, no `broken` tier. Nothing in the pipeline catches this. When adding a source,
check when the page was last updated, not only whether it parses.

The lane now comes from `infinity-nikki.fandom.com` at day precision (§ Fandom above), and the Game8
entry is gone from `SOURCES` rather than kept as a second opinion — a source whose every row is
wrong is not corroboration. Its fixture stays in `fixtures/nikki/`, because it is the only page here
carrying Game8's labelled `Start: … End: Permanent` shape and `test/adapters` still drives it
through the parser directly as a regression test.

`.github/ISSUE_TEMPLATE/feature_request.yml` points readers at that table by heading, so a source
request can be checked against it before anyone writes it up — the loudest feedback on the first
release was "not enough games" (`docs/FEEDBACK.md`), which makes this the request that arrives most.
Keep the heading if the section moves.

wiki.gg hosts (`arknights`, `endfield`) carry `Content-Signal: search=yes, ai-train=no, use=reference`
with `Allow: /`, and disallow `ClaudeBot` and other AI crawlers by name. Our fetcher is neither: it
trains nothing, and no LLM reads the page content — constraint 2 is what keeps that true, so it is
load-bearing here and not only a cost decision. Note also that Reverse: 1999, Blue Archive,
Umamusume and Nikke have **no wiki.gg wiki** — those subdomains 401.

**Fandom: read the API, never the page.** `reverse1999.fandom.com/wiki/Events` answers a non-browser
client with a Cloudflare managed challenge — HTTP 403, `Just a moment…`, "Enable JavaScript" — and so
does `/robots.txt` itself, from a datacenter address. Browser-shaped headers or a JS-executing client
would get past both and **must not be used**: that is defeating a deliberate access control, the same
reason `uma.moe` was declined above.

What makes this source legitimate anyway is that the wiki publishes a second, sanctioned surface. Its
`robots.txt` — read in a browser, where it serves fine — has no `Disallow: /` for `*` and explicitly
**allows** `/api.php?action=`, and that endpoint answers our real `User-Agent` with a `200` and a JSON
body. So the adapter fetches `api.php?action=parse&page=Events`, with no impersonation anywhere: our
own headers, on a path the site put in writing. The only namespaces `*` is refused are `Special:`,
`User:`, `Template:` and `Help:`, none of which we want; `parsers/fandom.ts` skips `Special:` links
for that reason.

**Fandom's posture tightened on 2026-08-19, and it now covers every wiki.** On 2026-08-18 the
standard `robots.txt` was still readable from a plain address — `blhx.fandom.com` served it `200`,
which is how the permission above was confirmed. As of 2026-08-19 **every** Fandom wiki tried
(`reverse1999`, `fategrandorder`, `nikke-…-international`, `infinitynikki`, `blhx`) answers `403`
to our fetcher, and a real headless browser gets a Cloudflare managed challenge that never resolves.
Two consequences, and neither is a licence to work around it:

- **All four** built Fandom sources report `skipped_robots` on **every** run, from any address we
  have, so `r1999`, `fgo`, `nikke` and `nikki` only ever move when someone refreshes them from an
  address Fandom serves. All four have a snapshot as of 2026-08-19 and every one of them was taken
  by hand. That is not a source being down — nothing is broken — but nothing will ever update these
  four on a schedule either, so their freshness is exactly as old as the last person who ran
  `bun run refresh` themselves. `--assume-robots-on-403` below is what makes that run possible.
- A **new** Fandom source can still be added, but only once someone reads that wiki's `robots.txt`
  from an address Fandom serves and records it here. That is exactly how Nikke was cleared on
  2026-08-19: the file was read in a browser, is the standard Fandom file — no `Disallow: /` for
  `*`, `/api.php?action=` explicitly allowed, only `Special:`, `User:`, `User_talk:`, `Template:`,
  `Template_talk:`, `Help:` and `UserProfile:` refused — and the named AI crawlers it blocks
  (`GPTBot`, `CCBot`, `OAI-SearchBot`, `ImagesiftBot`) are not us.

**The 403 is on `robots.txt`, not on the API.** Worth separating, because it decides what is
possible: `api.php?action=parse` answers our own User-Agent with a `200` from here, on all four
Fandom wikis we read. Only the robots file is challenged. So an adapter can be *written and
fixture-backed* from any address; what it cannot do is pass the robots gate at refresh time, which
fails closed and skips. The permission is therefore a thing a human records once, and the freshness
is a thing that needs an address Fandom serves.

`--assume-robots-on-403` is the one concession to that, and it is deliberately the narrowest thing
that helps: `bun run refresh --assume-robots-on-403` treats a `403` **on `/robots.txt` itself** as
the permission recorded above rather than failing closed. It is not a workaround for a host that
turned us away — it never overrides a `robots.txt` we could read, so a file that disallows us still
says no, and it does nothing at all for game8.co, whose robots.txt reads fine and welcomes us while
its edge refuses the pages. It is refused under CI, because what it stands in for is a person having
read a file in a browser, and there is no person on a runner. Every host it applied to is named in
the run's warnings, so it stays a thing somebody decided this morning rather than a default. Nothing
else relaxes: one request per source, six hours apart, spaced per host, no retries.

One consequence to keep in mind: because `/robots.txt` is unreadable from a challenged address, the
robots gate **fails closed there and the source is skipped**. That is a warning line rather than a
broken build — `skipped_robots` does not touch the failure streak, and the run only hard-fails if
*every* source is blocked — so the scheduled refresh simply never updates this game, and the feed
falls back to the checked-in fixture. Refreshing it means running `bun run refresh` from an address
Fandom serves, which is how its first snapshot was taken.

**Four Fandom templates now, and the third states its zone in a column header.** The Nikke wiki's
`Event` page is `Event | Start(UTC+9) | End(UTC+9) | Archived(?)` for story events and
`Nikke | Start(UTC+9) | End(UTC+9)` for pickup banners. That header is the safety property, not a
convenience: no date in any cell carries an offset, so a table whose Start/End columns stop naming a
zone must be **refused** rather than read as UTC — the Blue Archive hazard, arriving one column to
the left, and `canParse` asserts the lookup. Two more things about it:

- **Every title is an image, and the newest row is the one without one.** Names come from the
  wrapping `<a title="Project Matis">`, but an event whose logo has not been uploaded yet renders as
  a red link reading `File:Persona on Frontline logo.png` — so a reader that only understood
  `<a title>` would silently drop *today's live event* and publish a calendar missing what is on
  now. The file name is the fallback, and a test pins that exact row.
- **A start with no clock keeps the day the page printed.** Story events state a bare date on the
  start and a clock on the end; converting the bare one from UTC+9 would move it to the previous
  calendar day, and the start's day is half an event ID. That is the Fate/Grand Order rule below,
  applied to the opposite gap — there, a zone with no clock; here, a clock on only one side.

**The fourth is Infinity Nikki, and it is published at day precision on purpose.**
`infinity-nikki.fandom.com` (the unhyphenated name 301s to it) heads its `Current Events` and
`Upcoming Events` tables `Event | Duration | Description | Type`, and every duration reads
`July 20, 2026 04:00 – August 10, 2026 03:49` — a full date and a wall clock on both sides, and **no
zone anywhere on the page** for that column. The only zone statements are prose elsewhere dating
version launches `(UTC-7)` and a note that rewards reset at `04:00 (Server Time)`; the durations do
run `04:00 → 03:59`, which only lands on a reset boundary if the column is server-local. Strong, and
circumstantial.

So `parseZonelessClockRange` reads the clock and throws it away, publishing the printed date at day
precision. That invents nothing and treats these cells exactly as every Game8 date is already
treated. Converting instead would mean picking an offset, and the offset moves the *day*:
`July 16, 2026 20:00` read as UTC-7 is `2026-07-17T03:00Z`, and the start's day is half of every
event ID this game will ever have. If the wiki's editors ever state the zone on that column, this
source can carry exact instants and should.

Two shapes to know: `Permanent Events` and `Past Events` share the page and are fenced off by
heading, and titles come from a link's `title` attribute — which means they must be **entity-decoded
by hand**, because an attribute never passes through `text()` and `Alison&#39;s Travel Shop` would
otherwise become a slug, and a slug is a localStorage key. The sanitiser catches exactly that, and a
parser needing repair on its own fixture is a parser with a bug.

**The second Fandom source's page is chosen, not obvious.**
`fategrandorder.fandom.com` publishes two schedules: `Event_List` opens "This page lists all Events
in Fate/Grand Order Japan", and `Event_List_(US)` is the English server. They run months apart, each
links the other, and reading the Japanese one on an English calendar is the `akwiki` CN column again
— it was how this source first landed, and every date it published was a JP date. The adapter is
pointed at `page=Event_List_(US)` and a test asserts it; `parsers/fandom.ts` carries the reasoning.

Three more things about that page, all of them ways to publish or lose a date:

- **Its sections are fenced by pictures.** `ONGOING EVENTS`, `FUTURE EVENTS` and `PAST EVENTS` are
  banner images with the label drawn in a positioned `<div>` over them — no heading, no id. Only the
  ongoing section is parsed, and `canParse` asserts both of the dividers that bound it, so a
  redesign fails the source rather than emptying the lane.
- **The other two sections cannot be dated, and that is the whole reason they are skipped.**
  `FUTURE EVENTS` gives an ETA of `August 2026` — a month with no day, and a day is half an event
  ID. `PAST EVENTS` is 111 monthly tables that state no year anywhere; the *Japanese* page's
  equivalents carry it in a `MMYYYY` table id, which is a difference easily assumed away.
- **Every duration names a zone and no clock** — `August 12, 2026 ~ August 26, 2026 PDT`. So the
  boundaries stay on the day the page states rather than being shifted into UTC: there is no time of
  day to anchor a conversion to, and the start's day is part of the event ID. That `PDT` is also the
  evidence that the English server is one machine on US Pacific — see `games.ts`, where it does
  *not* become a `resetOffsets` entry, because Pacific observes daylight saving and that field holds
  one fixed number.

**Blue Archive: the page, never the API — the opposite call to Fandom.** `bluearchive.wiki` is a
Miraheze wiki, and Miraheze's `robots.txt` **disallows** `/w/` and `/*?action=`. So the route
`parsers/fandom.ts` takes is the one that is closed here, and the rendered `/wiki/Events` page is the
surface `*` is allowed — it answers our own `User-Agent` with a `200`, no `Content-Signal`, and no
`Crawl-delay` for us. `Special:` is disallowed too, which is why `parsers/bawiki.ts` skips those links
exactly as the Fandom one does.

Three things about that page are worth knowing before touching it, all of them ways to publish a
confidently wrong date:

- **It states JP and Global in separate tabs, and the Japanese one runs four to nine months ahead.**
  Same hazard as the CN column on `akwiki`, same answer: publish Global only. The tab's *nav button*
  carries the id `tabber-Global_version-label` and sits above **both** panels, so a reader that slices
  from the first id match reads the Japanese schedule while believing it read ours.
- **There are three Global tabs, not one** — the schedule, plus Mini-Event and Joint Firing Drill
  further down, whose ids are the same name with `_2` and `_3`. The parser finds the schedule by its
  `Name (EN)` header rather than by position, and `canParse` asserts that lookup, so a renamed tab or
  column fails the run instead of quietly emptying the lane.
- **The page states no time of day and no timezone anywhere.** The schedule's dates are bare
  `YYYY-MM-DD`, which is honest day precision. Its five other tables (Mini-Event, Reward campaigns,
  Attendance bonuses, Guide missions, Joint Firing Drill) *do* carry a wall clock — `08/12/2026 11:00`
  — but name no zone for it, and **three of the five do not say which server they describe**. Those
  are deliberately unparsed, and that second clause is the whole reason: a clock whose server is
  unknown cannot even be labelled with a day, because you do not know whose day it is. Attendance
  bonuses would be a real dailies source if a zone is ever stated. For the same reason `ba` has no
  `resetOffsets`: Blue Archive Global does run one worldwide server, but nothing in this source says
  on what clock.

  **This rule governs a clock with no known server, not a clock with no stated zone** — a
  distinction worth drawing precisely, because it was drawn the wrong way once. As first written it
  said rounding such a cell to a day "does not save it", which would also have condemned every Game8
  date in this repository: those state no zone either, and are published at day precision without
  anyone minding. The Infinity Nikki wiki (§ Fandom) is the case that forced the correction — one
  worldwide service, a clock, no zone — and it is read at day precision on the printed date, which
  invents nothing. What is still forbidden is *converting* an unzoned clock by picking an offset,
  because the offset moves the day and the start's day is half an event ID.

**hololive Dreams: the same Miraheze call as Blue Archive, and the opposite data.** `holodori.wiki`
is Miraheze too, so `/wiki/Events` is the surface `*` is allowed and `/w/` and `?action=` are closed
— `parsers/holodori.ts` takes the route `bawiki.ts` takes, for the reason it takes it. What differs
is the quality of what is there, and three things are worth knowing:

- **It states its timezone on every cell.** Every boundary is `08/17/2026 8:00PM (JST)`, which makes
  this the only wiki source here publishing `exact` precision on both sides without a per-region
  timer. `parseSlashClockZone` **requires** the zone rather than defaulting to UTC, so a row that
  ever loses it drops out instead of landing nine hours off. That is also where `holodori`'s
  `resetOffsets` of UTC+9 comes from — evidenced, not assumed; see docs/DATA-MODEL.md.
- **Inclusion is fenced by an `<h2>`, and the two tables are identical.** `Current Events` and
  `Past Events` have the same columns, so a reader that took every `wikitable` would put the back
  catalogue on the calendar with nothing to mark it. Rows are checked against `ctx.now` on top of
  the heading, because "Current" is maintained by hand and goes stale before anyone moves a row.
- **Every event title is still a red link.** The wiki has no article for any of them yet, so each
  links to `?action=edit&redlink=1` — a create-page form, and a `?action=` URL this wiki's
  robots.txt disallows. The parser refuses a href with a query and falls back to the events page;
  when the articles exist, they get linked with no change.

Two rows on the page are not events and are meant to be missing. `Beginner Mission` runs
`Game Launch` → `Unknown`: no start means no event ID, and a permanent tutorial chore is not what a
calendar of deadlines is for. An `Unknown` **end** is kept, though — that is `endsAt: null`, and
unlike `bawiki.ts` this parser does not drop a started-but-undated row, because the heading has
already said the event is running.

**IOP Wiki: the Server column is the whole safety story.** `iopwiki.com/wiki/GFL2_Events` is the
best date material here after wiki.gg — every row states an exact instant on both boundaries *and*
names the zone (`2026-08-06 13:00 - 2026-08-26 22:59 (UTC)`), so `parseIsoClockRangeUtc` converts
nothing and both sides are `exact`. Three things about it:

- **CN, EN and JP rows share one table**, and the Chinese schedule runs about a year ahead. This is
  the `akwiki` CN-column hazard verbatim and gets the same answer: publish `EN`, skip the rest. It
  would be wrong by *months* on a row that otherwise looks perfect.
- **`Betas` is a section, not an event type.** Closed beta rows are dated exactly like everything
  else and would parse cleanly onto a calendar of things nobody can play. Fenced on the `<h2>`.
- **The page is an archive**, 145 rows back to 2023, so inclusion is decided against `ctx.now` as in
  `bawiki.ts`. The lane is therefore thin by design — one live event on a quiet week is the truth,
  not a gap.

The zone requirement is deliberate: `parseIsoClockRangeUtc` refuses a row that loses its `(UTC)`
rather than assuming it, exactly as `parseSlashClockZone` does. GFL2 takes no `resetOffsets`: its EN
boundaries land on three different clocks (22:59, 08:59 and 02:59 UTC), which is a patch window
rather than a reset hour — Arknights and Reverse: 1999 each earned an override from a single
boundary their whole page agreed on.

**Stella Sora: the front page, not the article — the opposite call to Blue Archive.** Miraheze
again, so `/wiki/` is open and `/w/` and `?action=` are closed. But this wiki publishes its schedule
twice, and the fuller surface is the worse one:

- `/wiki/Banner_List` has 55 clean rows with full wall clocks and states **no timezone anywhere**.
- The front page's `Current Banners` module emits the same instants as real
  `<time datetime="2026-08-17T20:00-07:00">` elements.

The two agree exactly, which is strong evidence the table is UTC and is still only evidence — so we
read the surface that says what it means and pay for it in coverage: four live banners instead of a
full history. If an editor ever states the zone on `Banner_List`, that page becomes the better
source immediately. Two traps in the markup: the template writes its BEM underscores as `&#95;&#95;`,
so a selector written against the name a browser shows finds **nothing at all**; and banner names are
red links to `?action=edit&redlink=1`, which robots.txt disallows, so a href with a query is refused
and the page URL stands in — the `holodori.ts` rule.

Stella Sora takes no `resetOffsets` either, and for the opposite reason to most: it states an offset
outright, and the offset is `-07:00` — US Pacific, which shifts by an hour twice a year. That is the
Fate/Grand Order problem arriving through a source that looks like it answered the question.

`scripts/refresh-sources.ts` enforces all of the above in code — the 6h floor (except under the
opt-in `--force` above), one request, no retries, conditional headers, per-host spacing, robots
(failing closed when `robots.txt` cannot be read, except under the opt-in `--assume-robots-on-403`
described in § Fandom). Both overrides are interactive-only, refused under CI, and reported by name
in the run's warnings — an override that reports nothing is one nobody withdraws. Anything that would make it fetch more often is a change to this section first.

**A source down is a warning; a source down for days is a broken build.** One wiki failing must
never blank a calendar or stop the sources that did answer from being committed — so a failure is
exit 0 and the previous snapshot stands. But a source that has failed `BROKEN_AFTER_FAILURES` (3)
cycles running is not having a bad afternoon: that game's calendar has been quietly built from a
checked-in fixture for a day and a half. The runner reports those as `broken` — a GitHub annotation,
a row in the job summary with the status code, and a `broken` step output — and `refresh.yml` fails
the run on it in a **final** step, after the commit and the CI dispatch. Exiting non-zero from the
runner instead would skip the commit and throw away the pages that did arrive. This tier exists
because six of seven sources failed every cycle for three days behind a green tick; a warning nobody
opens the log to read is not a signal.

## Untrusted input

Every string on an event came from a page we do not control. `src/ingest/sanitize.ts` is the trust
boundary and it is wired into `toAdapter()` in `src/ingest/adapters/index.ts`, which is the single
seam every source passes through — **do not sanitize inside a parser**, and do not add a code path
that reaches `parser.parse` directly. Parsers stay pure readers of one site's markup.

The sanitizer never touches a date, cleans rather than drops (a title that sanitizes to nothing is
the only drop), and logs every repair and drop by default. See `docs/INGESTION.md` § Stage 2.5.

## Events that repeat daily

Some events are twenty small jobs on twenty deadlines, not one job with an end date, and a missed
day is unrecoverable. `src/shared/daily.ts` decides dailiness from what the source published —
`type: "login"`, or "daily"/"check-in"/"7-day" wording — and never from a game's habits or an
event's length. It adds **no schema field**, so the feed contract is untouched.

- The day rolls at **04:00 server time** (`RESET_HOUR_LOCAL`), per region. Getting this wrong ticks
  the wrong box for four hours every night.
- **An unannounced end yields no checklist**, not a checklist of guessed length — the `endsAt: null`
  rule applies here exactly as it does to a countdown.
- **A tick is never removed except by the reader**, including ticks outside the window the feed now
  claims. A source quietly moving a date must not erase a fortnight's streak that exists nowhere
  else.
- **A repeating event the reader marked done leaves the strip.** They have said there is nothing
  left to do; keeping a tickable chip for it is the app arguing with them. Their logged days are
  untouched, so unmarking it brings the chip and the streak straight back.
- **Detection is a guess, not a verdict — and it ships off.** `prefs.detectDaily` defaults to
  `false` and the control is labelled experimental: wording is a weak signal and gets it wrong in
  both directions, so a new reader opts in rather than out. The default moves nothing for an
  existing reader, whose stored `prefs` wins. The reader can mark any event as repeating, or unmark
  one detection got wrong (`progress.daily`, resolved by `resolveDaily`), whether the guessing is
  on or off. Store an override only when it *disagrees* with detection —
  recording agreement would freeze today's guess and stop a better parser from ever reaching that
  event. Neither control ever deletes a mark or a logged day, so both are reversible.

## Events the reader entered themselves

No adapter list covers a ten-game player, so a reader can define a game and type in events
(PRD F13, `src/shared/custom.ts`, `src/client/state/useCustom.ts`). They join the same lists,
timeline, sort, filters, progress, ignore and daily stores as scraped events. Four rules:

- **Their ids live in their own spaces**: `mygame:<slug>` and `myevent:<random>`. Never
  `${game}:${slug}:${date}` — a reader can type a scraped event's exact title and date, and that
  collision would silently share one completion mark and one streak between two events. Random also
  means renaming their own event never moves its id. `dailies`, `mygame` and `myevent` are reserved
  first segments and **none may ever become a `GameId`**; a test pins this.
- **Nothing they type enters the ingest pipeline.** `sanitize.ts` and `merge.ts` are for pages we do
  not control. Their events are not fetched, parsed, merged, scored or quarantined.
- **A hand-entered date is never attributed to a source.** No `sourceUrl`, no source link, and the
  row and detail sheet both say it is theirs. `"I don't know when it ends"` is an offered answer, for
  the same reason the parsers are forbidden from guessing one.
- **They are in the export.** These exist in one browser and nowhere else, so an export without them
  is a lossy backup. Import merges by id and never removes.

A lane may now be a game the reader invented, so `gameMeta` is a context resolver (`metaFor`, pure
and total) rather than a direct lookup — a lane can outlive its game when an import carries an event
whose game did not come with it.

**Retiring a game, a source or a page must never cost the reader a row they typed.** We retire
things routinely — a source moves, a page goes stale, a game shuts down — and their events are the
only copy in existence. Nothing in the client deletes: no store prunes against the feed, `knownGames`
only ever appends, and `metaFor` renders a lane whose game is gone rather than dropping it. The one
place this could break is the load path. `useCustom` reads through `validRecords`, which **drops a
record that fails its schema**, and the survivors are what the next write persists — so a record that
stops parsing is not hidden pending a fix, it is deleted from the device by the act of opening the
app. That is why `CustomEvent.game` is `z.string()` and not `GameId`: narrowing it to the enum reads
like a tightening and would arm every future game removal to erase reader data on next launch.
`test/custom.test.ts` § retiring a game, a source or a page pins it.

## Shipping a new version

The shell is cached cache-first, so a reader with the tab open keeps the bundle they first loaded.
An old app presented as current is the same failure as old events presented as current, so a waiting
version is disclosed and reloaded on a tap (PRD F14, `docs/ARCHITECTURE.md` § Shipping a new version
to an open page). Four things hold it up:

- **`sw.js` must not `skipWaiting()` on install.** It activates only on the `skip-waiting` message
  the reader's tap sends. Claiming an open page unasked runs the old bundle against the new cache and
  says nothing.
- **`__BUILD__` must stay in `sw.js`.** `scripts/build-static.ts` substitutes a hash of the built
  shell for it, which is what makes a deploy's worker bytes differ and therefore detectable. It
  throws if the placeholder is gone — do not "fix" that by dropping the substitution. There is no
  `CACHE_VERSION` bump ritual any more; the cache name is a namespace, and per-build names would
  discard the stored feed an offline reader is reading.
- **The feed is not part of the build id.** It changes twice a day and needs no reload; announcing it
  as a new version teaches readers to dismiss the notice unread.
- **The app never reloads itself.** Someone may be mid-way through typing an event in.

## Conventions

- **Commit straight to `main`.** This is a solo repo and its history is a single line; do not open a
  branch for a change unless asked for one. Committing still waits to be asked.
- **Only ever commit your own work.** Stage the files you changed, by path, and nothing else. The
  working tree may already hold edits, untracked fixtures or a half-finished experiment that someone
  else — the user, or another agent — put there and has not decided about yet; `git add -A`, `git
  commit -a` and `git stash` all sweep those into your change or out of sight. Authorship in the log
  then says you wrote something you never read, and the commit stops being the one coherent change
  the bullet below asks for. If unrelated changes are in the way, say what you see and leave them
  alone.

  **Another agent may be working in this tree right now, not merely before you.** The index is
  shared and it moves under you: a `git status` that was clean when you started can hold four staged
  files by the time you commit, and none of them yours. So read `git status --porcelain` immediately
  before every commit and treat anything you did not touch as a stop sign, and when the index already
  holds someone else's staged work, commit with an explicit pathspec — `git commit -- <your paths>`,
  which takes the working-tree content of exactly those paths and leaves the rest of the index where
  its owner left it. This is not hypothetical: on 2026-08-19 a session ran a sweeping commit that
  swallowed a 64-line source assessment another session had just finished, and published it under a
  one-line message about snapshot freshness. Both changes were fine; the log stopped being true.

  **If you find your work inside someone else's commit, say so and ask before rewriting it.** The
  fix is a `reset --soft` and two pathspec commits, and it is quick — but the commit you would be
  rewriting is theirs, the session that wrote it may still be running, and racing it for `HEAD` costs
  more than the mixed message does. Ask, then split.
- **Commits are self-contained and succinct.** One coherent change per commit, typechecking and
  passing tests on its own — a feature spanning layers splits as model → store → UI → docs, each
  step green by itself, even when that means widening a type in the model commit that only the UI
  commit uses. `docs/FEEDBACK.md` makes the same argument for adapters specifically: do not batch
  six games into one commit, because each one is a fixture and a test that has to prove itself.
  Succinct is about the message, not the change: a one-line subject in plain English, and a body
  that says *why* — the reasoning a diff cannot show — rather than listing the files it touched.
  Never reformat code the change did not touch; a formatter the project does not run buries a
  100-line change in a 550-line diff.
- **Zod schemas are the single source of truth for types.** Derive with `z.infer<>`; never
  hand-write an interface that duplicates a schema.
- Every adapter ships a fixture in `fixtures/<game>/` and a test asserting parsed output. This is
  how a source silently changing shape gets caught.
- Keep old fixtures when a source changes shape — the old one is the regression test proving the
  parser still handles the previous format. Fixtures are pinned and permanent; `snapshots/` is the
  current page and gets overwritten. Do not conflate them.
- **Colour is a token, and every token has two answers.** The app ships dark and offers light
  (PRD F15), and the whole difference is a set of custom properties re-struck under
  `:root[data-theme="light"]` in `styles.css`. So a component names `ink`, `hairline` or `soon` and
  never a colour: a literal — `bg-white`, a hex, a hardcoded scrim — is a component that looks
  right in one theme and wrong in the other, and nothing will tell you which. The two things that
  genuinely cannot be tokens are the game hues, which are *data* (`games.ts`, and the reader's own),
  and the pre-paint script in `index.html`; both are handled in `src/client/state/theme.ts` and
  pinned by `test/theme.test.ts`.
  Two rules follow. **The heat ramp must stay readable on whichever ground it is on** — it carries
  meaning, and the dark theme's amber is 1.9:1 on paper, so each step is re-struck rather than
  reused. And **the dark theme does not move**: `readableHue` returns dark untouched by
  construction, because adding a theme is not a licence to redraw the one that shipped.
- **The page is two columns past `lg`, and the split is the one below.** What the page *tells* the
  reader to do — the next deadlines, tonight's dailies — pins to a rail on the left and stays put
  while the lists it *shows* them scroll beside it. Below that breakpoint it is one column in the
  same order. The focus bar goes at the top of that rail rather than full-width above both columns:
  it narrows what the rail holds, and a wide row of chips above everything pushes the headline
  deadline down the page. On a phone, and on the timeline, which has no rail, it is back at the top
  of the page — one render site per view, never both at once. The rail's rule belongs to the panel, not the column: the panel is short and the list
  is long, so a full-height divider would spend most of its length walling off a gap.
- **Truncating a list is not re-sorting it.** Each section shows `LIST_CAP` rows and offers "show
  all N". The rows below the cut keep their place in the order, stay counted in the header, and stay
  on the timeline — so the *sorting groups, it never reorders* rule below holds for what is hidden
  exactly as it does for what is shown. Expanding is per-visit state, not a stored preference: it is
  something a reader does while reading one list, not a statement about how the app should work.
- **A game we add arrives switched off, and `knownGames` absent means *unrecorded*.** Adding a
  source is our decision; a reader who plays two games did not ask for the other twelve. So a lane
  missing from `prefs.knownGames` is new *to them* and is hidden on sight (`adoptNewLanes`, PRD F8).
  The trap is the other reading: every install from before this existed has no `knownGames` at all,
  and treating that as "has been offered nothing" switches off every game they already read. Seeding
  records what is on their screen and changes nothing else. Lanes they invented (`mygame:`) are
  recorded but never hidden.
- **Which view opens is the reader's answer.** `prefs.view` is asked once on the first run (PRD F8)
  and written by the tabs from then on. It was component state, which meant a reader who preferred
  the timeline was put back on the list by every reload, with nothing to blame but the app
  forgetting. The stored answer is theirs; do not add a heuristic that overrides it.
- **A list row is one target.** The event row opens the event and does nothing else — status,
  effort, notes and the daily checklist all live in the detail sheet. A second control inside a
  full-bleed row target is a mis-tap waiting to happen, and a decorative chevron says "this opens"
  without adding a second stop for keyboard and screen-reader users.
- **Sorting groups, it never reorders within a group.** Every mode falls back to
  `endingSoonestFirst`, so choosing one can never cost the reader the deadline order the product
  exists for.
- **Telling the reader to do something is not the same as showing it to them.** `showCompleted` and
  `showIgnored` decide what they can *look at*; the "next to expire" headline and the dailies strip
  are *instructions*, so both drop anything done or ignored regardless (`outstanding` in
  `src/client/state/lens.ts`). Being pointed at a job you already finished is the bug either way.
  For the same reason "next to expire" reads the minimum end date rather than the head of the list,
  which under "doing first" is a different event entirely.
- **The page states its own age unprompted, and reads it off the data.** The footer says when event
  data last refreshed on every load, not only past the two-day threshold — a page silent about its age
  reads as current, and "how old is this?" has to be answerable before a countdown is worth trusting
  (PRD F7). `freshness()` in `src/shared/feed.ts` is the one definition: it takes the newest
  `lastSuccessAt` and **never `generatedAt`**, which is a build stamp that would call a
  fixture-backed calendar minutes old, and it treats a game as only as fresh as its *oldest* source,
  so one live wiki cannot vouch for a stalled sibling. Given that thirteen sources cannot be fetched
  from CI at all (§ Scraping conduct), this disclosure is the only thing standing between a reader and
  a confidently stale calendar — do not let a future change source it from the build clock.
