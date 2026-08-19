# SOURCES.md — event sources for the games still missing

A source assessment for the games named in `docs/FEEDBACK.md` § P1 that still have no adapter,
plus § 12, a sweep of thirteen Game8 hubs, and § 13, one URL offered for Honkai Impact 3rd —
both asked for separately on 2026-08-19.
Written 2026-08-18. **Acted on 2026-08-19**: four of the games below were built, one turned out to be
blocked rather than merely awkward, and the rest were declined. Each section keeps its original
reconnaissance and carries its outcome at the top, because the reasoning is what stops the next pass
re-deriving it.

What changed on 2026-08-19, in one paragraph. **Built:** Girls' Frontline 2 (`iopwiki`, new parser),
Stella Sora (`stellasorawiki`, new parser), Chaos Zero Nightmare (`game8`, no parser work) and
Umamusume (`game8`, after widening its section and column vocabulary). **Built on 2026-08-19 after the
permission was read in a browser:** Nikke, whose `robots.txt` turned out to be the standard Fandom
file. **Declined:** Punishing: Gray Raven, Guardian Tales, Azur Lane and
Aether Gazer, all as proposed. One thing not on the original list also came out of the pass: the
**Infinity Nikki source is stale** and has no reachable replacement — see § 11. Later the same day a
second, unrelated request added § 12: thirteen Game8 hubs checked for a schedule page, of which
**MementoMori** needs no parser work at all and **Fire Emblem Heroes** has the best data in that
sweep behind a shape the parser does not read. The other eleven are declines.

Verdicts here are proposals. Once one is acted on — built or declined — the *decision* belongs in
`AGENTS.md` § Scraping conduct, whose table exists so a source is not re-litigated every pass and
which `.github/ISSUE_TEMPLATE/feature_request.yml` points readers at. This file is the working, not
the ruling.

## Method

Every page below was fetched from this machine with the refresh runner's own `User-Agent`
(`gacha-event-tracker/1.0 (+https://github.com/StereotypicalCat/gacha-event-tracker)`), one or two
requests per host, `robots.txt` first. No browser-shaped headers, no proxy, no JS execution —
anything that only answers a browser is treated as closed, per the `uma.moe` precedent. Where an
existing parser could plausibly read a page, it was run against the fetched bytes offline
(`src/ingest/parsers/index.ts`) rather than guessed at.

Two things this method cannot tell you, and both matter:

- **Whether a host answers the GitHub Actions runner.** game8.co does not (`AGENTS.md` § Scraping
  conduct). The only hard evidence we hold is what CI has actually committed: `git log` on
  `snapshots/` shows `github-actions[bot]` landing **arknights.wiki.gg**, **endfield.wiki.gg** and
  **bluearchive.wiki** (Miraheze). Fandom sources have never refreshed in CI, because `robots.txt`
  itself is challenged from a datacentre address and the gate fails closed — and as of 2026-08-19
  that challenge covers every Fandom wiki from *any* address tried here, not just CI's.
  Of the 2026-08-19 additions, **Stella Sora** is Miraheze and so is the one likely to refresh in CI;
  **IOP Wiki** is permissive but unproven; **Chaos Zero Nightmare** and **Umamusume** are game8 and
  therefore blind in CI by construction.
- **Whether a page will still look like this in six weeks.** Each recommendation below names the
  assertion `canParse` should make, so a redesign fails the source loudly instead of emptying a lane.

## Where P1 stands

| Game | Status |
|---|---|
| Arknights, Reverse: 1999, Blue Archive, Persona 5X | **Built** (2026-08-17/18) |
| **Girls' Frontline 2, Stella Sora, Chaos Zero Nightmare, Umamusume** | **Built** (2026-08-19) |
| Nikke | **Built** (2026-08-19), once the `robots.txt` was read in a browser — see § 3 |
| Azur Lane | Declined on conduct (`azurlane.koumakan.jp` `ai-input=no`), and both Fandom alternatives are dead archives |
| Punishing: Gray Raven, Guardian Tales, Aether Gazer | Declined — see §§ 6, 7, 9 |
| Infinity Nikki | **Rebuilt** (2026-08-19) on `infinity-nikki.fandom.com` at day precision, replacing a Game8 page stale since August 2025 — see § 11 |
| Silver Palace | Unreleased |

## Summary of findings

| Game | Best source found | Parser | Refreshes in CI? | Verdict |
|---|---|---|---|---|
| Girls' Frontline 2 | `iopwiki.com/wiki/GFL2_Events` | new (`iopwiki`) | likely (permissive robots, unproven) | **BUILT** 2026-08-19 — best data quality of anything here |
| Stella Sora | `stellasora.miraheze.org/wiki/Main_Page` | new (`stellasorawiki`) | yes (Miraheze proven) | **BUILT** 2026-08-19 — banners only, from the main page |
| Nikke | `nikke-…-international.fandom.com/api.php?…page=Event` | `fandom`, third template | **no** — Fandom robots fails closed | **BUILT** 2026-08-19 — story events *and* dated pickup banners, with an evidenced reset clock |
| Chaos Zero Nightmare | `game8.co/games/Chaos-Zero-Nightmare/archives/559899` | **existing** `game8` | **no** — game8 202s the runner | **BUILT** 2026-08-19 — no parser work, fixture-only lane |
| Umamusume | `game8.co/games/Umamusume-Pretty-Derby/archives/536311` | `game8` + section and column vocabulary | **no** | **BUILT** 2026-08-19 — cost more than "two header words"; see § 5 |
| Punishing: Gray Raven | `grayravens.com/wiki/Events` | — | — | **Decline for now** — one dated string on the whole page |
| Guardian Tales | `guardian-tales.fandom.com/wiki/Events` | — | — | **Decline** — wiki stopped dating events in 2025 |
| Azur Lane | none | — | — | **Still declined** — the Fandom alternatives are 2021 archives |
| Aether Gazer | — | — | — | **Do not build. The game is shutting down.** |
| Silver Palace | — | — | — | Unreleased; beta only |

---

## 1. Girls' Frontline 2: Exilium — BUILT 2026-08-19

**Source:** `https://iopwiki.com/wiki/GFL2_Events` (IOP Wiki, the Girls' Frontline universe wiki)

**Conduct.** `robots.txt` is two lines — `User-agent: *` / `Crawl-Delay: 20` — with no `Disallow`
anywhere and no named-agent block. No `Content-Signal` header. Our 6-hour floor is three orders of
magnitude inside a 20s crawl delay. The response carries `Last-Modified`, so `If-Modified-Since`
will do real work here.

**Shape.** An `<h3>` per event, each followed by `<table class="gf-table event-period">`. All 46 of
those tables share one header row, exactly:

```
Title | Period (start/end) | Server | Type | Comment
```

Cells look like this, and this is the best date material in the project after wiki.gg:

```
Amidst Wings of Gray | 2025-01-16 17:00 - 2025-02-06 02:59 (UTC) | EN | Character Event | …
```

Explicit UTC, exact precision on **both** boundaries, no timezone inference anywhere. Each period
cell also carries an ICS widget with `icsStart` / `icsEnd` in `YYYYMMDDTHHMMSS` — a second,
independently generated copy of the same instants, useful for cross-checking a parser rather than as
the primary read.

**Coverage.** 145 rows, of which 51 are `Server: EN`. A naive regex parsed **every** EN period cell —
zero unparsed, which is the count check `AGENTS.md` § Silent drops asks for. Latest EN rows:

| Event | Start | End |
|---|---|---|
| Dawnforger — Part 2 | 2026-07-16 13:00 | 2026-08-05 22:59 |
| Unto the Radiance | 2026-07-16 13:00 | 2026-08-05 22:59 |
| **Moonshroud Requiem** | **2026-08-06 13:00** | **2026-08-26 22:59** (live today) |

**Hazards, and what to do about them.**

- **CN and JP rows sit in the same tables as EN.** This is the `akwiki` CN-column problem verbatim:
  the Chinese schedule runs a year ahead and a CN date on a Global calendar is a confidently wrong
  date. The `Server` column decides — publish `EN`, skip everything else. Servers seen on the page:
  `CN`, `EN`, `JP`.
- **`Betas` is a section, not an event type.** The page's `<h2>`s are `Main Events`, `Minor Events`,
  `Betas`, `References`. Closed beta rows are dated and would parse cleanly into a calendar of things
  nobody can do. Fence on the heading.
- **Titles are localised per row.** The `Title` cell on a CN row is Chinese; on the EN row it is the
  English name. Because we only take EN rows this resolves itself, but a parser that took the section
  heading as the title would inherit the CN/EN slash pair (`Exotic Cadence/Amidst Wings of Gray`).
  Take the title from the EN row's own cell.
- **`canParse` should assert the header row** — `Title` + `Period (start/end)` + `Server` — so a
  template change fails the source rather than emptying the lane.

**Work:** new parser module `src/ingest/parsers/iopwiki.ts`, a `gfl2` `GameId`, a `GAMES` entry, one
`SOURCES` entry, a fixture and a test. `Type` maps onto our `EventType` reasonably —
`Character Event` → banner, `Combat Event` / `Special Event` / `Main Story Event` → event,
`Popularity Contest` → other.

---

## 2. Stella Sora — BUILT 2026-08-19, from the main page and not the banner list

**Source:** `https://stellasora.miraheze.org/` — a Miraheze wiki, so the same call as Blue Archive and
hololive Dreams: `/wiki/` is the surface `*` is allowed, `/w/` and `/*?action=` are disallowed. CC
BY-SA 4.0, no `Content-Signal`, no `Crawl-delay` for us. Miraheze is the one host family we have
proof answers the CI runner.

Three pages, and the difference between them is the whole finding:

- **`/wiki/Events`** — a list of event names with **no dates at all**. Useless on its own.
- **`/wiki/Banner_List`** — two clean tables, `Image | Name | Start | End`, with full wall clocks:
  `2026-08-18 03:00:00` → `2026-09-08 02:59:00`. 28 and 29 rows, current. **But the page states no
  timezone anywhere** — no `UTC`, no offset, nothing. This is the `bluearchive.wiki` hazard exactly
  (`AGENTS.md` § Blue Archive, third bullet): reading a bare wall clock as UTC invents the fact that
  matters, and rounding to a day does not save it because the start's day is half an event ID.
- **`/wiki/Main_Page`** — a `Current Banners` module that emits the same instants as real
  `<time datetime="2026-08-03T21:00-07:00">` elements. Zone stated, machine-readable, `exact`
  precision.

The two agree: `2026-08-03T21:00-07:00` is `2026-08-04T04:00Z`, and `Banner_List` prints exactly
`2026-08-04 04:00:00` for that banner. That is strong evidence the list is UTC — and it is still an
inference, not a statement, so the honest source is the **main page module**, at the cost of covering
only the four live banners instead of the full history.

**Caveats.** Banners only; the wiki dates no story events. Sourcing a wiki's main page is more fragile
than sourcing an article, so `canParse` should assert the `stellasora-home-current__banners` container
and the presence of `<time datetime>` children, and fail loudly if either goes. Note also that some
banner names link to red links (`/wiki/A_Breezy_Romance/2026-08-03?action=edit&redlink=1`) — a
`?action=` URL this wiki's robots.txt disallows, so the same rule `holodori.ts` follows applies:
refuse a href with a query and fall back to the page URL.

**Worth asking:** if the wiki's editors state the zone on `Banner_List`, that page becomes the better
source immediately — full coverage, no template dependency.

---

## 3. Nikke — BUILT 2026-08-19

> **Outcome: built.** The precondition this section set — read the wiki's `robots.txt` in a browser —
> was met on 2026-08-19, and it is the standard Fandom file: no `Disallow: /` for `*`,
> `/api.php?action=` explicitly allowed, and only `Special:`, `User:`, `User_talk:`, `Template:`,
> `Template_talk:`, `Help:` and `UserProfile:` refused. The AI crawlers it names (`GPTBot`, `CCBot`,
> `OAI-SearchBot`, `ImagesiftBot`) are not us. Recorded in `AGENTS.md` § Fandom.
>
> Three notes for whoever touches it next, all of them corrections or additions to what follows:
>
> - **The 403 is on `robots.txt` only.** `api.php?action=parse` answers our own User-Agent with a
>   `200` from a datacentre address; it is the robots file that is challenged. So the adapter could
>   be written and fixture-backed from here, and what it cannot do is pass the gate at refresh time.
> - **The zone is in the column header, not the cell** — `Start(UTC+9)` / `End(UTC+9)`. That makes
>   the header load-bearing: a table that stops naming its zone is refused rather than read as UTC.
> - **Story-event starts carry no clock, only their ends do.** The start keeps the day the page
>   printed rather than being shifted nine hours into the previous one, which is the FGO rule applied
>   to the opposite gap. Pickup banners carry a clock on both sides and convert fully.
>
> The `resetOffsets` / `resetHourLocal` win this section predicted was real and shipped with the
> game: UTC+9 for every region, rolling at 05:00.

## 4. Chaos Zero Nightmare — BUILT 2026-08-19; the cheapest adapter available, and a ninth blind source

**Source:** `https://game8.co/games/Chaos-Zero-Nightmare/archives/559899` ("List of All Events")

Among the games still missing, **only Umamusume and CZN have a Game8 wiki hub at all** — probes of
`game8.co/games/{Goddess-of-Victory-Nikke, Nikke, Girls-Frontline-2-Exilium, Punishing-Gray-Raven,
Azur-Lane, Guardian-Tales, Stella-Sora, Aether-Gazer}` all returned 404. Those games exist on Game8
only as news article hubs, which are not schedules.

**The existing parser already reads it.** Run offline against the fetched bytes:

```
parser game8 canParse: true
events: 4
 - Following the Fox's Footsteps      2026-05-27 → 2026-06-17  (day/day)
 - Beach Cafe Festival                2026-07-29 → 2026-09-30  (day/day)
 - Chasing the Remanants of Light     2026-07-29 → 2026-09-08  (day/day)
 - Virtual Tactical Simulation Hilde  2026-07-29 → 2026-08-19  (day/day)
```

The page lists six current events; the two the parser skips (`Full-Scale Offensive Season 3`,
`Virtual Tactical Simulation - Yuki`) both print `Start Date: -`. No start means no event ID, so
skipping them is the rule working, not a silent drop. Page last updated 2026-08-11.

So this is a `SOURCES` entry, a `czn` `GameId`, a fixture and a test — no parser work at all.

**The cost is honest and should be stated in the commit:** it becomes the ninth game8 source, and
game8 returns `202` with a bot-management body to the Actions runner, so this lane will be built from
a checked-in fixture in CI from day one and will go stale within a patch cycle unless the user runs
`bun run refresh` themselves. `freshness()` will say so in the footer, which is what that disclosure
is for — but adding a game that can only ever be as fresh as someone's last manual run is a decision,
not a detail. It also worsens the per-host arithmetic in § Scraping conduct: nine game8 pages per
cycle to one host.

Alternatives checked and worse: `gamewith.net/chaoszeronightmare/71099` has the right table shape but
is stale (its "latest events" are April–May 2026); `czn.gg` is a WordPress site whose
`/category/current-events/` is a blog feed, not a schedule, and whose `robots.txt` disallows
`anthropic-ai` and `Claude-Web` by name (not us, but a signal about the site's posture).

---

## 5. Umamusume — built, and the estimate below was wrong

> **Outcome (2026-08-19): BUILT**, off the stable `List of All Banners` page as recommended. Two
> corrections to what follows, both worth having before the next Game8 page is assessed:
>
> - **"A few characters" was wrong.** Teaching `COL_TITLE` the word `Banner` and `COL_RANGE` the word
>   `Availability` gets you **zero events**. The page's schedule sits under `List of All Banners` →
>   `All Current Banners`, which the *section* vocabulary did not match either, and its back
>   catalogue sits under `Previous Banners`, which `previous events` does not match — so without
>   that exclusion the finished rows would have gone straight onto the calendar. Beyond that, the
>   current-banners table lays the Standard and Paid schedules side by side inside one `<table>`
>   under a spanning label row, and that row is *plausible* enough to resolve both columns at
>   indices no data row has. `readColumnTable` now decides the header by what it produces, trying
>   row 1 only when row 0 produced nothing.
> - **The blast radius was measurable, and it was zero.** The worry below — that widening a parser
>   eight sources share starts matching tables it currently ignores — is right in principle and was
>   settled by measurement rather than by regenerating `.expected.json` until the tests agreed: every
>   pinned fixture *and* every live snapshot was parsed before and after, and no existing source's
>   output changed by a single event. Do that diff on any future change to `game8.ts`; it costs one
>   script and it is the only thing that distinguishes a safe widening from a silent one.



`uma.moe` stays declined; nothing about the Turnstile gate has changed. Two other surfaces exist.

**gametora.com** (`/umamusume/events/story-events`) — cleared in `AGENTS.md` already. The page embeds
`__NEXT_DATA__` with a clean per-server dataset:

```json
{"id":1018,"url_name":"story-event-18","name_en":"Days Flying By","start_en":1787090400, …}
```

53 events, `start_en` epoch seconds, current through **2026-08-18** (today's event). Deterministic,
no HTML parsing at all. But there is **no end timestamp in the payload** — every event would land
`endsAt: null`, `endPrecision: "unknown"`. That is a correct value, not a wrong one, but a lane of
start-only events answers none of the questions this app exists for.

**game8.co/games/Umamusume-Pretty-Derby/archives/536311** ("List of All Banners") is a stable URL —
unlike the monthly `August 2026 Release Schedule` pages (`613161`), whose URL changes every month and
which a static `SOURCES` registry cannot follow. It carries:

```
Banner | Rating | Availability
Seeking the Pearl (Rocket☆Star) | ★★★★☆ | 8/12/2026 - 8/21/2026
```

Our `game8` parser returns **0 events** from it, and the reason is narrow: `COL_TITLE` is
`/^(.*\b)?events?$/i` so `Banner` misses, and `COL_RANGE` knows `availability period` but not bare
`Availability` or `Availability (UTC)`. Teaching it those two words is a few characters — but
`game8.ts` serves eight live sources, so widening its column vocabulary can start matching tables on
Genshin, HSR, ZZZ, WuWa, NTE, Nikki, P5X and Endfield that it currently ignores. If it is done, it is
its own commit, with every existing `.expected.json` regenerated **and re-verified against the live
pages**, not just regenerated to make the tests agree with the new behaviour.

Add the game8 CI blindness on top and this is a "yes, but not next" — worth doing after GFL2 and
Stella Sora, and worth doing as two commits (parser vocabulary, then the source).

---

## 6. Punishing: Gray Raven — decline for now

`grayravens.com` is a Miraheze wiki and the community's officially supported fansite; conduct is fine
(`/wiki/` allowed, `/w/` and `?action=` disallowed, `Crawl-delay` only for named bots). The data is
the problem.

`/wiki/Events` is a single patch guide — "Ongoing Events" is one version's content, written as prose.
Stripped of markup, the **entire 626 KB page contains exactly one date range**:

```
Duration: July 17th to August 18th 2026.
```

Ordinal day, year on the second boundary only, one event per six-week patch. `/wiki/PGR_Roadmap` adds
a `Patch | Est. Release | …` table — an estimate, and a start with no end. The Fandom wiki is worse:
`Events` does not exist, `Upcoming Content` is 2025-era and says its dates are "ESTIMATED", and the
search API returns nothing for `intitle:Event`.

An adapter here would publish one guessed-ish event per patch. Decline, and recheck if grayravens
ever puts the schedule in a table.

---

## 7. Guardian Tales — decline

`guardian-tales.fandom.com/wiki/Events` fetches and parses fine. It contains **no 2026 date at all** —
the newest dated entry across `Events` and `Guardian_Tales/Version_history` is 2025, and the wiki's
own front page advertises 8 active users. This is the `bluearchive.fandom.com` failure in
`AGENTS.md` § Scraping conduct: a source that parses cleanly to nothing live, which would put an
empty lane on the calendar and report a broken source forever.

The official site (`guardiantales.com`) serves no `robots.txt` (404, so no restriction) but is a
Next.js SPA carrying `<meta name="robots" content="noindex">` with no schedule surface in the HTML.

---

## 8. Azur Lane — still no source

The two Fandom wikis the community points at as alternatives to the declined `azurlane.koumakan.jp`
are both dead:

- **`blhx.fandom.com`** ("the authoritative database on Azur Lane's EN server"). `robots.txt` served
  `200` and allows `/api.php?action=`, so conduct is clear — but `Event_Calendar` and
  `Event_Information` both stop in **2021**. The newest event on the calendar is "Ying Swei's Spring
  Travels, Feb 04 2021".
- **`azurlane-archive.fandom.com/wiki/Events`** has `Current Events` / `Upcoming Events` /
  `Previous Events` headings with nothing under any of them.

The live schedule is on koumakan, which said `ai-input=no`. Nothing found here changes that verdict —
worth a row in `AGENTS.md` recording that the Fandom alternatives were checked and are archives, so
the next person does not check them again.

---

## 9. Aether Gazer — do not build; the game is ending

Game8, published 2026-07-09, reporting the developer's own Bilibili statement:

> Aether Gazer developer YongShi shared an official statement on Bilibili confirming that the game
> will receive no further content updates once Version 5.2 rolls out on July 23, 2026.

with a dated wind-down: refunds for unused Transfer Flowers 6 Aug – 6 Sep 2026, a final "With You"
update 17 Sep 2026, and **store listings and download access removed 17 Oct 2026**. Global keeps
updating only until it catches up with CN.

The wiki matches. `aethergazer.miraheze.org/wiki/Event_Guide_List` is an image gallery of guide links
with **no dates on it at all** — the unsupportable image-grid shape — the site was last edited 12 July
2026, and its main page carries a note from the owner about the wiki's uncertain future.

A lane that will be empty by winter, built on a wiki that does not publish dates. Skip it, and record
why so the request does not come back.

---

## 10. Silver Palace — unchanged

Still unreleased. The Dichotomy Beta ran 23 July – 13 August 2026; no launch date announced;
projections point at late 2026 / early 2027. Nothing to scrape, as `docs/FEEDBACK.md` already says.

---

## 11. Infinity Nikki — BUILT 2026-08-19, at day precision, replacing a stale source

> **Outcome: option (b), chosen by the repository owner.** The lane now reads
> `infinity-nikki.fandom.com` and the Game8 entry has been removed from `SOURCES` — a source whose
> every row is wrong is not a second opinion. Seven current 2026 events replace five year-old ones
> that had `endsAt: null` and rendered as live indefinitely. The Game8 fixture stays in
> `fixtures/nikki/` as the only regression test for that parser's labelled `Start: … End: Permanent`
> shape, driven through the parser directly now that no adapter routes it.
>
> The clock is read and discarded; the printed date is published at day precision. That invents
> nothing and treats these cells exactly as every Game8 date already is. **The Blue Archive rule in
> `AGENTS.md` has been narrowed to match**, because as written it forbade this: it now governs a
> clock whose *server* is unknown — which is what those Blue Archive tables actually were, three of
> five not saying which server they described — rather than any clock without a stated zone. What
> remains forbidden is converting an unzoned clock by picking an offset, since the offset moves the
> day and the start's day is half an event ID.

This game already had an adapter, which is why it was not assessed on 2026-08-18. It should have
been. `game8.co/games/Infinity-Nikki/archives/487445` fetched, parsed, and passed every test — and
the page itself said `Last updated on: August 31, 2025`, with **zero** occurrences of the string
`2026`. That is the lesson worth keeping from this section: **a stale page is not a broken one**, so
nothing in the pipeline flags it. Check when a page was last updated, not only whether it parses.

**The replacement.** `infinitynikki.fandom.com` 301s to `infinity-nikki.fandom.com`, whose
`robots.txt` was read in a browser and is the standard Fandom file — same permission as Nikke (§ 3).
The wiki is maintained: pages edited as recently as 2026-08-17, and its `Event` page mentions 2026
seven hundred and thirty-one times.

```
Current Events / Upcoming Events / Permanent Events / Past Events   (h2 headings)
<table class="article-table">  Event | Duration | Description | Type
   Deep Breakthrough    July 20, 2026 04:00 – August 10, 2026 03:49   ...   Double Rewards
```

**The missing fact was the timezone.** The Duration column names no zone. What the page *does* say,
elsewhere and in prose: version launches dated `(UTC-7)`; `Rewards reset daily at 04:00 (Server
Time)`; and durations running `04:00 → 03:59`, which only lands on a reset boundary if the column is
server-local. Strong circumstantial evidence for UTC-7, and still circumstantial — which is why the
clock is dropped rather than converted.

Two shapes the parser handles, both of which would otherwise lose or corrupt a row:

- **Titles come from a link's `title` attribute**, so they need entity-decoding by hand — an
  attribute never passes through `text()`, and `Alison&#39;s Travel Shop` would otherwise become the
  slug `alison-39-s-travel-shop`, which is a localStorage key. The ingest sanitiser catches exactly
  this, and a parser that needs repairing on its own fixture has a bug.
- **Recurring events live on dated subpages**, so a title arrives as `Deep Breakthrough/2026-07-20`
  or, behind a red link, as the file name `Alison's Travel Shop 2026-08-06.png`. That date names the
  run rather than the event and is stripped; the start date already keys the runs apart.

Asking the wiki's editors to state the zone on the Duration column would upgrade this source to
exact instants, and remains the cheapest improvement available to it.

## 12. Thirteen Game8 hubs, swept on 2026-08-19 — two are worth building, eleven are not

Not a P1 game between them: this section answers a direct request to check a list of Game8 game
hubs for a schedule page we could add. All thirteen hubs exist and returned `200` (unlike the
2026-08-18 probe, where eight of the games looked at had no Game8 hub at all), so the question was
never whether the wiki exists — it was whether the wiki is *alive* and whether its schedule is in a
table.

**Two things about the method, both of which cost time here.**

- **A hub's navigation is not an index of its pages.** Reading only the links on
  `game8.co/games/<Name>` found no schedule page for Pokémon UNITE, Pokémon Champions, Gundam UC
  Engage or Black Beacon. All four have one. They were found by web search instead, and one of them
  — UNITE's — is among the freshest pages in this sweep. Do not conclude "no such page" from the hub
  alone.
- **`Last updated on:` is the cheapest check there is**, and it separated the two live candidates
  from the ones still publishing last year's schedule in a single grep. It is the check that was missing when Infinity Nikki went
  a year stale behind a source that parsed perfectly (§ 11). Run it before parsing anything.

| Game | Best page found | Last updated | `game8` parser today | Verdict |
|---|---|---|---|---|
| **MementoMori** | `/MementoMori/archives/436644` | **2026-08-13** | **7 events from 7 rows** | **Build.** Zero parser work — the cheapest adapter since Chaos Zero Nightmare |
| **Fire Emblem Heroes** | `/fire-emblem-heroes/archives/272468` | **2026-08-18** | 0 (shape unsupported) | **Build second.** Best data in the sweep, but a new column shape and one rule collision — see below |
| Pokémon UNITE | `/Pokemon-UNITE/archives/337574` | 2026-08-16 | `canParse` **false** | Decline — fresh page, two dated rows, and a template the parser refuses by design |
| Gundam UC Engage | `/gundam-uce/archives/521684` | 2026-07-13 | 0 | Decline — ends without starts |
| Pokémon Champions | `/Pokemon-Champions/archives/596103` | 2026-04-22 | 0 | Decline — a tournament calendar, four months stale |
| Mongil: Star Dive | `/Mongil-Star-Dive/archives/595311` | 2026-05-27 | 0 | Decline — image grid, and the wiki stopped in June |
| Destiny: Rising | `/Destiny-Rising/archives/546191` | 2025-10-09 | 5 events, newest ended 2025-11-06 | Decline — parses cleanly to nothing live |
| Black Beacon | `/Black-Beacon/archives/515801` | 2025-05-14 | 1 event, from May 2025 | Decline — the Infinity Nikki failure mode |
| Tower of Fantasy | `/Tower-of-Fantasy/archives/384442` | 2022-11-01 | 0 | Decline — both pages are four years old |
| Epic Seven | — | 2022-01 | — | Decline — hub's newest content is January 2022 |
| Diablo Immortal | — | 2022-09 | — | Decline — abandoned, and zone events are a daily rotation, not a calendar |
| Brawl Stars | — | 2021-11 | — | Decline — abandoned five years ago |
| Fire Emblem Shadows | — | — | — | Decline — the whole wiki is fourteen pages and none is a schedule |
| Chaos Zero Nightmare | — | — | — | Already built, 2026-08-19 — see § 4 |

**One cost applies to both builds and should be in the commit message, not discovered later.** Both
candidates are game8.co, which does not answer the Actions runner (`AGENTS.md` § Scraping conduct).
Nine of the nineteen sources are game8 pages today, now that Infinity Nikki has moved to Fandom
(§ 11); these would make ten and eleven. Each is a lane fixture-backed in CI from day one and only
ever as fresh as someone's last manual `bun run refresh`, and one more request to a single host every
cycle — the per-host arithmetic § Scraping conduct already calls uncomfortable.

### 12a. MementoMori — the whole adapter is a `SOURCES` entry

**Source:** `https://game8.co/games/MementoMori/archives/436644` ("List of All Current Events"),
last updated 13 August 2026.

The existing parser reads it as-is. Run offline against the fetched bytes:

```
parser game8 canParse: true
events: 7
 - NijiSanji x MementoMori Special Collaboration        2026-07-28 → 2026-08-24
 - NijiSanji x MementoMori Special Title Screen         2026-07-28 → 2026-08-24
 - NijiSanji x MementoMori: Invocation of the Lucky Draw 2026-07-28 → 2026-08-24
 - NijiSanji x MementoMori In-Game MV                   2026-07-28 → 2026-08-24
 - NijiSanji x MementoMori X Repost Campaign            2026-07-28 → 2026-08-10
 - Invite a Friend Campaign                             2026-07-28 → 2026-08-24
 - Twilight Florence Celebration Missons Event          2026-08-13 → (unknown)
```

Seven events out of a seven-row table under `List of Current Limited-Time Events`, headed
`Current Events | Duration` — the count check `AGENTS.md` § Silent drops asks for, with nothing
dropped. Six are live today. The seventh states `Part 1 Start Date: August 13, 2026 Part 2 Start
Date: August 31, 2026` and no end, so it lands `endsAt: null`, which is the correct reading of a cell
that names two starts and no finish. `List of Upcoming Events` currently holds one sentence saying
there are none, and `List of Past Events` is fenced off by its heading.

**Two latent hazards, and they are about this page more than most.**

- **`Recurring Events Schedule` is an *included* section here.** It is an `<h3>` and it matches
  `/recurring events/i` in `INCLUDED_SECTIONS`. Its table is `Event List | Latest Dates` and its rows
  are months stale — `Guild Missions … April 27, 2026 4:00 - May 17, 2026 3:59 (UTC+1)`. Nothing
  fences it off; the only thing keeping those rows off the calendar is that `COL_TITLE` does not
  know the words `Event List` and `COL_RANGE` does not know `Latest Dates`. That is column
  vocabulary standing in for a section rule, which is exactly the arrangement the Umamusume commit
  warned about.
- **The gacha page's back catalogue is not excluded by anything.** `archives/436056` heads its
  168-row history `List of Previous Invocation (Gacha) Banners`, and `EXCLUDED_SECTIONS` matches
  `previous banners` — which that string does not contain. So **do not** add the gacha page as a
  second source, and treat any future widening of `game8.ts`'s vocabulary as dangerous for this game
  specifically. Its current banners are unusable anyway: the dates sit inside an
  `Info and Duration` prose cell (`Rarity Banner Duration: August …`), not a column.

**No `resetOffsets`.** The current-events table names no timezone, which is honest day precision and
what `clockFor` exists to resolve. The rest of the page is worse than silent — it is *inconsistent*:
recurring rows carry `(UTC+1)`, others carry `(UTC-7)`, on the same page. Nothing there evidences one
clock for the game, so this is the Blue Archive call — no offset, and say why in `games.ts`.

**Work:** a `mmori` `GameId`, a `GAMES` entry, one `SOURCES` entry, a fixture and a test. No parser
change. `canParse` already asserts the Game8 structural markers; the test should additionally pin
the `Current Events | Duration` header, so a redesign fails the source rather than emptying the lane.

### 12b. Fire Emblem Heroes — the best data here, and it costs a ninth Game8 shape

**Source:** `https://game8.co/games/fire-emblem-heroes/archives/272468` ("FEH Calendar & Banner
Schedule"), **last updated 18 August 2026** — yesterday, and the freshest page found anywhere in this
sweep. A nine-year-old article ID that has been maintained the whole time, which is the stable-URL
property Umamusume's monthly pages lack (§ 5).

Three tables under `List of Current and Upcoming Events`, all one shape:

```
Event Name                        | Availability   | End
Binding Worlds                    | 08/12/2026     | 08/21/2026
Hall of Forms (Revival)           | 08/14/2026     | 08/20/2026
CYL 10: Grand Festival            | 08/17/2026     | 09/18/2026
A Blissful Soak                   | 08/07/2026     | 09/06/2026
Weekly Revival                    | Weekly         |
Free Summon                       | Date of Installation |
```

Eight datable rows today (two events, six summons), plus four rows reading `Daily`, `Weekly`,
`Monthly` or `Date of Installation`, which are genuinely undatable and skipped — the rule working,
not a silent drop. Both boundaries carry a year. No timezone anywhere on the page, so day precision
on both sides, resolved on the reader's server by `clockFor`; no `resetOffsets` claim to make.

**The parser returns zero, and the reason is a shape, not two header words.**

- `COL_TITLE` is `/^(.*\b)?(events?|banners?)$/i`, so `Event Name` misses.
- There is no range column at all. `Availability` holds a *start*, and the end is its own column.
  `readStartEndTable` looks like the answer and is not: it wants headers matching `^start$` and
  `^end$` and reads the rowspan shape where each event spans two rows, one boundary each. This is
  one row per event with two date columns — a ninth Game8 shape, and the one shape that is trivial
  everywhere else.
- `dates.ts` has no reader for a single `MM/DD/YYYY` boundary. `parseShortSlashRange` wants both
  halves in one cell; `parseMonthDayYear` wants `August 12, 2026`. One small function, and it should
  refuse a two-digit year rather than guess a century.

**One row breaks a rule this repository holds on purpose, and it is not a parse error.**

```
Summer Celebration: Guaranteed 4★SHSR | 08/02/2026 | 03/01/2027
```

That is 211 days. `AGENTS.md` § Domain rules says any event over 180 days is a parse error, and
`test/adapters/game8.test.ts` asserts it across every fixture — a rule that exists because a span
that long is normally a misread year. Here it is real: FEH runs a seven-month new-player banner. So
building this source means choosing, **before the fixture is written, because the fixture is the
test**: drop rows over 180 days at the adapter and lose a real banner while the guard keeps its
meaning, or carve a stated exception and weaken the guard for the eight sources that share it. The
first is the safer default and the second needs an argument.

**And the widening is the Umamusume question again.** `COL_TITLE` is shared by every live game8
source. Teaching it `Event Name` may start matching tables on pages it currently ignores, so parse
every pinned fixture *and* every live snapshot before and after and diff the output. That measurement
is what distinguished a safe widening from a silent one last time, and it costs one script.

### 12c. The eleven declines, grouped by how they fail

**Abandoned wikis** — the Infinity Nikki failure mode (§ 11), where a source parses perfectly and
publishes last year. Each of these would put a lane on the calendar that is history or empty:

| Game | Evidence |
|---|---|
| Black Beacon | Three pages checked — `500805` News & Events (15 May 2025), `515801` Events Schedule and Calendar (14 May 2025), `500801` banners (5 May 2025). The events page parses **one** event, 5–29 May 2025 |
| Destiny: Rising | `546191` (9 Oct 2025) parses five events whose newest ended 6 November 2025; `546176` banners (14 Oct 2025) parses none. The hub's newest article is dated November 2025. `bluearchive.fandom.com` verbatim |
| Mongil: Star Dive | `595311` (27 May 2026) is the image-grid shape — an `<h3>` per event and no date in any table. `592077` banners (6 May 2026) hides `Availability: Apr. 29 - May 26, 2026` inside a `Details` cell, and every banner listed as current ended three months ago |
| Tower of Fantasy | Both pages last updated 1 November 2022. A search summary also reports Game8 saying it stopped covering the game at Update 2.0 — second-hand, and the two `Last updated on:` stamps are the first-hand evidence |
| Epic Seven | Hub's newest content is January 2022. A search summary reports a Game8 notice ending coverage; not read on a page fetched here, and not needed — the stamps say it |
| Brawl Stars | Newest content October–November 2021 |
| Diablo Immortal | Newest content September 2022. Its "events" are zone rotations on a time of day — `Ancient Arena … Tuesday, Thursday, Saturday and Sunday at 9:30 PM server time` — which is a daily chore, not a dated event |

**Alive, but the schedule is not in a datable table:**

- **Gundam UC Engage** is the frustrating one. The wiki is *very* active — a weekly
  `<Month> <Day> Update Details and Summary` article, newest dated 18 August 2026. But the calendar
  page `521684` was last updated 13 July 2026 and prints **ends without starts**:
  `2.5th Anniv. Login Bonus Until October 28, 2026`, two events per cell, no header row. No start
  means no event ID, so the whole page yields nothing by the rule rather than by accident. The banner
  page `443747` (28 May 2026) does the same — `Period: Until June 3, 2026`. The dates that *are*
  current live in the weekly update articles, whose URL changes every week, which a static `SOURCES`
  registry cannot follow — the Umamusume monthly-page problem, one cadence faster.
- **Pokémon Champions** (`596103`, 22 April 2026) lists two in-game events, one of them
  `April 8, 2026 - TBD`, and otherwise schedules online competitions and regional championships. A
  tournament calendar for a competitive title, not a gacha schedule.
- **Fire Emblem Shadows** has fourteen article links in its entire hub — `Disciples` and
  `Season Passes` are the only two structured pages. There is nothing to parse yet. Worth one look
  again if the game gets a content cadence.

**And one that is fresh, and still no**: **Pokémon UNITE** (`337574`, 16 August 2026). Two findings
worth keeping:

- **`game8.canParse` returns `false` on it** — the page carries 25 `a-table` matches and **zero**
  `a-header--3`. That is the structural check doing precisely its job: a Game8 page in a different
  template refuses the source rather than silently returning nothing. Pointing a `SOURCES` entry at
  it would fail the run, which is the correct outcome and the reason not to.
- The data is thin regardless. `Current Seasons` fuses the name and the range into one cell —
  `Ranked Season 38 8/1/2026 - 9/1/2026` — under a header reading `Event Name / Duration | Rewards`,
  and only two rows are dated at all; everything else is recurring or permanent. The back catalogue
  under `List of Past Events` is the rowspan Start/End shape and is correctly fenced by its heading.

## 13. Honkai Impact 3rd — assessed 2026-08-19 on request; decline

**Source:** `https://marisaimpact.com/calendar89` — Marisa Impact, a fan site for HI3, whose
`Supply and Boss Timeline` is the only calendar this game has been offered here. Not a P1 game: this
section answers a direct request to add that URL, and HI3 has no `GameId` today.

**Conduct is clear, and it is the only part of this that is.** `robots.txt` answers our own
`User-Agent` with a `200`, and its 1248 bytes are **entirely comments** — Cloudflare's
content-signals preamble with no `User-agent` line, no `Disallow` and no `Content-Signal` at all. By
clause (c) of the text it ships with, a use with no signal is "neither granted nor restricted", so
nothing here refuses us the way `koumakan`'s `ai-input=no` does. There is no `Crawl-delay`. The site
is Cloudflare-fronted but serves us the page itself with a plain `200`, so this is not the Fandom
challenge or the `uma.moe` gate either. The page is server-rendered SvelteKit and the whole schedule
is in the HTML; the route's `__data.json` carries an `ogImage` and nothing else, so the rendered page
is the only surface and there is no API to prefer.

**Four things kill it, and the first two on their own are enough.**

- **The dates are estimates, and the page says so twice.** Under the title: *"Based on CN server.
  Schedule might be different for Regional servers."* And the first column of both grids is headed
  *"Estimated date for Regional Servers"*. This is the `akwiki` CN-column hazard with nothing to fall
  back to — there is no Global row to publish and a CN row to skip, there is one CN schedule with an
  estimate drawn over it. Putting that behind a countdown is the confidently wrong date this product
  exists to prevent, and it would be wrong on the honest side of the page's own disclaimer.
- **No year appears anywhere.** Weeks read `Jun 25 - July 3`, `Aug 14 - 20`; stripping the tags from
  either version's page and grepping for `20\d\d` returns nothing at all. `dates.ts` infers a missing
  year for no source and must not start here, and the start's day is half of every event ID this game
  would ever have.
- **The unit is a week column, not an event boundary.** A bar spans whole weeks, so its end is the
  end of a bucket rather than a date anyone published. That is *not* the day-precision reading Game8
  and Infinity Nikki get: there we publish the date the page printed, and here the page printed a
  week.
- **The URL is per-version and there is no stable route to the current one.** `/calendar89` is
  version 8.9, `Jun 25 - Aug 20` — it expires the day after this was written. Version 9.0 is at
  `/calendar90` and runs `Aug 20 - Oct 22`. The version picker is client-side, the nav links only
  *earlier* versions (`/calendar88`, `/calendar89`), and the page's own `og:url` and canonical
  (`/valk/calendar89`) is a scheme that already 404s at `/valk/calendar90`. A `SOURCES` entry pinned
  to `calendar89` would be publishing history inside a day — § 11's failure mode on a six-week clock —
  and nothing on the site names the live version at a fixed address.

**The markup is fine, which is worth recording so nobody re-derives it.** Each row is a
`<div class="relative grid grid-cols-N">`; cell 1 is the row label (`BATTLESUIT SUPPLY A`, `EVENT 3`)
and every bar carries `col-span-N`, with bare `<div class="col-span-N"></div>` spacers standing in for
an offset start. So a bar's start week is `1 + Σ` the spans before it and its length is its own span,
and the week columns are in the header row. A parser would be positional rather than textual and is
perfectly writable. The blocker is what the numbers mean, not how to read them.

**What would change this:** the site stating a year, and stating a real regional schedule rather than
an estimate over the CN one — plus a stable URL for the current version, or an index page naming it.
Any two of the three still leaves the other. No alternative HI3 source was looked for in this pass, so
the game is unsourced rather than declined outright.

## What every one of these costs, beyond the source

Adding a game is never only a `SOURCES` entry:

- a `GameId` in `src/shared/schema.ts` — an enum value that becomes the first segment of every
  completion key for that game, forever;
- a `GAMES` entry in `src/shared/games.ts` (name, short, hue, studio, `dailyTasks`), plus
  `resetOffsets` / `resetHourLocal` **only where the source states the clock** — Nikke's is evidenced,
  Stella Sora's is not stated on the page we would read;
- a fixture in `fixtures/<game>/` and a test asserting parsed output, one commit per game
  (`docs/FEEDBACK.md` P1 step 4);
- the lane arriving switched off for existing readers via `adoptNewLanes`, which is automatic but
  worth remembering when checking the app after a build.

## Recommended order

Steps 1 through 5 were done on 2026-08-19, and step 6's declines are now written into `AGENTS.md`
§ Scraping conduct. Every game assessed in the § P1 pass is now built or declined with its reasoning
recorded, and the two decisions it raised — Nikke's permission and Infinity Nikki's timezone — have
both been made. What is queued is the two live finds of the § 12 sweep:

1. **MementoMori** (§ 12a) — the cheapest adapter available today: a `GameId`, a `GAMES` entry, one
   `SOURCES` entry, a fixture and a test, with no parser change. Seven events parse out of a
   seven-row table and six of them are live.
2. **Fire Emblem Heroes** (§ 12b) — better data and a real cost: a ninth Game8 column shape, a
   single-date `MM/DD/YYYY` reader, and a decision about the 180-day rule, which one legitimate
   seven-month banner breaks. Two commits, parser then source, with the vocabulary widening diffed
   across every fixture and snapshot as Umamusume's was.

Below that, in descending order of value: re-check `grayravens.com` if it ever puts its schedule in
a table, re-check Azur Lane if `koumakan` ever drops `ai-input=no`, and re-check `marisaimpact.com`
if it ever prints a year (§ 13). None is worth a pass until something changes upstream.

## Appendix — reproducing the checks

```bash
UA='gacha-event-tracker/1.0 (+https://github.com/StereotypicalCat/gacha-event-tracker)'

# conduct
curl -sS -A "$UA" https://iopwiki.com/robots.txt
curl -sS -A "$UA" -D - -o /dev/null https://stellasora.miraheze.org/wiki/Main_Page   # Content-Signal?

# the pages
curl -sS -A "$UA" https://iopwiki.com/wiki/GFL2_Events                > gfl2.html
curl -sS -A "$UA" https://stellasora.miraheze.org/wiki/Main_Page      > stellasora.html
curl -sS -A "$UA" 'https://nikke-goddess-of-victory-international.fandom.com/api.php?action=parse&page=Event&prop=text&formatversion=2&format=json' > nikke.json
curl -sS -A "$UA" https://game8.co/games/Chaos-Zero-Nightmare/archives/559899 > czn.html
curl -sS -A "$UA" https://marisaimpact.com/robots.txt                 # comments only, no directive
curl -sS -A "$UA" https://marisaimpact.com/calendar90                 > hi3-v90.html

# the § 12 sweep: hubs first, then the schedule page each one turned out to have.
# `--rate 30/m` keeps one request every 2s to a single host, per AGENTS.md § Scraping conduct.
for g in Black-Beacon Brawl-Stars Destiny-Rising Diablo-Immortal Epic-Seven \
         fire-emblem-heroes Fire-Emblem-Shadows gundam-uce MementoMori \
         Mongil-Star-Dive Pokemon-Champions Pokemon-UNITE Tower-of-Fantasy; do
  args+=(-o "hub-$g.html" "https://game8.co/games/$g")
done
curl -sS --rate 30/m -A "$UA" --compressed -w '%{http_code} %{url_effective}\n' "${args[@]}"

# how stale is it? — the first question, and the cheapest
grep -o 'Last updated on:[^<]*' mmori.html

# does an existing parser read it? (offline, once a source id exists)
bun run parse czn-game8-events czn.html --json
```

Facts stated above that a future reader may want to re-check, with how they were established:

| Claim | How it was checked |
|---|---|
| game8 has no wiki hub for Nikke, GFL2, PGR, Azur Lane, Guardian Tales, Stella Sora, Aether Gazer | `HEAD https://game8.co/games/<Name>` → 404 for each, 200 for Umamusume-Pretty-Derby and Chaos-Zero-Nightmare |
| The `game8` parser already reads the CZN page | ran `game8Parser.parse` against the fetched bytes: 4 events, 2 correctly skipped for a missing start |
| `fandom.ts`, `akwiki`, `wikigg`, `bawiki`, `holodori` cannot read the new pages | `canParse` returned `false` for every combination tried |
| CI can fetch wiki.gg and Miraheze | `git log --name-only -- snapshots/` — `github-actions[bot]` commits carry `arknights-akwiki`, `endfield-wikigg`, `ba-bawiki` |
| A Fandom `robots.txt` 403 means the source is skipped, not failed | `src/ingest/robots.ts` `RobotsCache.load` — `status >= 400` other than 404/410 → `usable: false` |
| All thirteen § 12 hubs exist | `GET https://game8.co/games/<Name>` → `200` for every one |
| The `game8` parser already reads the MementoMori events page | ran `game8Parser.parse` against the fetched bytes: 7 events from the 7 data rows of `Current Events \| Duration` |
| The FEH page is unreadable by shape, not by two header words | `columnLayout` finds no range column at all — `Availability` is a start and `End` is its own column, and `readStartEndTable` wants the rowspan `Start`/`End` pair |
| Game8's structural check rejects the Pokémon UNITE page | `game8Parser.canParse` → `false`; the page has 25 `a-table` matches and zero `a-header--3` |
| A hub's nav is not an index of its pages | the UNITE, Champions, Gundam and Black Beacon schedule pages exist and are linked from none of the hub navigation scanned; found by web search |
| `marisaimpact.com` states no year on any calendar | stripped tags from `/calendar89` and `/calendar90` and grepped the text for `20\d\d` — zero matches on either |
| Its calendar URL is per-version, with no stable alias | `/calendar90` is `200` and covers `Aug 20 - Oct 22`; `/valk/calendar90` — the scheme its own `og:url` uses — is `404`; the nav links only `/calendar88` and `/calendar89` |
| Its schedule is not behind an API | `GET /calendar90/__data.json` returns 144 bytes: an `ogImage` URL and nothing else |
