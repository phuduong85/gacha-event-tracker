# Data Model

`src/shared/schema.ts` is the single source of truth. TypeScript types are derived with
`z.infer<>` — never hand-write an interface that duplicates a schema.

## The Event

```ts
import { z } from "zod";

export const GameId = z.enum([
  "genshin", "hsr", "zzz", "wuwa", "arknights", "endfield", "nte", "nikki", "p5x", "r1999",
  "ba", "fgo", "holodori", "gfl2", "stellasora", "czn", "uma", "nikke",
]);

export const EventType = z.enum([
  "banner",       // limited character/weapon rate-up
  "story",        // main or side story chapter, limited-time
  "rerun",        // returning event
  "challenge",    // combat/endgame cycle (Abyss, Memory of Chaos, ...)
  "login",        // login rewards / check-in
  "shop",         // limited shop or exchange window
  "maintenance",  // server downtime
  "other",
]);

export const Region = z.enum(["asia", "america", "europe"]);

/** How much we actually know about a boundary timestamp. */
export const Precision = z.enum([
  "exact",        // sourced to the minute
  "day",          // date known, time-of-day inferred from the game's reset
  "unknown",      // genuinely not announced — endsAt is null
]);

export const GachaEvent = z.object({
  id: z.string(),                       // `${game}:${slug}:${YYYY-MM-DD}` — see Stability below
  game: GameId,
  title: z.string().min(1).max(200),
  type: EventType,
  summary: z.string().max(500).nullable(),

  startsAt: z.string().datetime(),      // UTC ISO 8601, always
  startPrecision: Precision,
  endsAt: z.string().datetime().nullable(),
  endPrecision: Precision,

  /** True when the end time follows each region's daily reset rather than a global instant. */
  regionScoped: z.boolean(),
  /** Populated only when regionScoped; per-region resolved UTC instants. */
  regionEnds: z.record(Region, z.string().datetime()).nullable(),

  sourceUrl: z.string().url(),
  sourceId: z.string(),                 // which adapter/source produced this

  status: z.enum(["published", "delisted"]),
  confidence: z.number().min(0).max(1),
  extractionMethod: z.enum(["parser", "manual"]),

  version: z.number().int().positive(),
  firstSeenAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type GachaEvent = z.infer<typeof GachaEvent>;
```

### Field notes that matter

**`endsAt: null` is a first-class state, not an error.** Many events are announced with "duration
TBD" or "until the next version update". The correct representation is `endsAt: null` with
`endPrecision: "unknown"`. The extractor is instructed to produce this and the UI renders it
distinctly (PRD F1). Filling in a plausible date instead is the single worst bug this codebase can
ship.

**`regionScoped` + `regionEnds`.** Character banners end at one global instant — `regionScoped:
false`, `regionEnds: null`. Story and login events end at each region's daily reset — `regionScoped:
true`, with `regionEnds` carrying the three resolved UTC instants. The client picks one using the
user's stored region (PRD F5). Collapsing these into a single timestamp loses up to 13 hours of
accuracy and will make the countdown wrong for two thirds of users.

**`startPrecision` / `endPrecision`, and what 00:00Z means.** A source that prints a calendar date
and no time of day gets `"day"` precision, and the instant stored alongside it is that date at
00:00Z. That timestamp is a **placeholder for "somewhere in this day", not a claim that the day
begins at UTC midnight** — the parser has declined to invent a time, exactly as it declines to
invent a date. Nothing downstream may read it as an instant: `clockFor` in `src/shared/time.ts`
resolves a day-precision boundary to the reset that opens that game-day on the reader's server
(`dayStartMs`), which is the same clock `daily.ts` keys every tick by, and the countdown and the
detail sheet both run off that. Read literally instead, the stored value expires an event up to nine
hours early — the whole of Asia and Europe — which is how a Wuthering Waves event dated "August 19"
was called over three hours before the game ended it.

Two boundaries are exempt, for the same reason in both directions. A `regionEnds` value is taken
verbatim: that map only exists because a source published a timer per server, so it is already the
instant, and re-anchoring it would throw a stated fact away. And an event the reader typed in
(`extractionMethod: "manual"`) is taken verbatim too: `readerInstant` resolved it to the instant
*they* meant, in their own timezone, when they entered it.

**`confidence`** is assigned by the parser and adjusted during merge and reconciliation — see
`docs/INGESTION.md` § Scoring. It records how firmly the sources pinned the event down.

**`status: "delisted"`** means the event stopped appearing at its source. It is never deleted,
because a source outage would otherwise silently empty the calendar. Delisted events are excluded
from the API feed but retained for debugging and for the case where a source flickers.

### ID stability — read before changing

```
`${game}:${slugify(title)}:${startsAt.slice(0, 10)}`
→ "genshin:windblume-festival:2026-03-14"
```

**Event IDs are the localStorage keys for completion state.** Changing the scheme orphans every
completion mark every user has ever made, silently, with no error and no way to recover it
server-side (the server never had the data). If the scheme must change, ship a client-side
migration that reads the old keys and remaps them, and keep that migration for at least a year.

The date suffix disambiguates reruns of the same event. Title is slugified from the *source's*
title, so a wiki renaming an event creates a new ID — reconciliation detects this as a near-match
(same game, overlapping dates, high title similarity) and treats it as an update rather than a new
event, preserving the original ID.

## SQLite schema

```sql
-- Published feed. One row per event.
CREATE TABLE events (
  id                TEXT PRIMARY KEY,
  game              TEXT NOT NULL,
  title             TEXT NOT NULL,
  type              TEXT NOT NULL,
  summary           TEXT,
  starts_at         TEXT NOT NULL,
  start_precision   TEXT NOT NULL,
  ends_at           TEXT,
  end_precision     TEXT NOT NULL,
  region_scoped     INTEGER NOT NULL DEFAULT 0,
  region_ends       TEXT,               -- JSON object or NULL
  source_url        TEXT NOT NULL,
  source_id         TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'published',
  confidence        REAL NOT NULL,
  extraction_method TEXT NOT NULL,      -- 'parser' | 'manual'
  version           INTEGER NOT NULL DEFAULT 1,
  first_seen_at     TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX idx_events_ends   ON events (ends_at) WHERE status = 'published';
CREATE INDEX idx_events_game   ON events (game, starts_at);
CREATE INDEX idx_events_window ON events (starts_at, ends_at);

-- Candidates held back by the review gate. Same shape plus why.
CREATE TABLE events_quarantine (
  id             TEXT PRIMARY KEY,
  payload        TEXT NOT NULL,        -- full GachaEvent JSON
  reason         TEXT NOT NULL,        -- 'low_confidence' | 'date_conflict' | 'sanity_failed' | 'novel_shape'
  detail         TEXT NOT NULL,        -- human-readable explanation for the reviewer
  conflicts_with TEXT,                 -- events.id, when reason = 'date_conflict'
  run_id         TEXT NOT NULL REFERENCES ingest_runs(id),
  created_at     TEXT NOT NULL,
  resolved_at    TEXT,
  resolution     TEXT                  -- 'approved' | 'rejected' | NULL
);
CREATE INDEX idx_quarantine_open ON events_quarantine (created_at) WHERE resolved_at IS NULL;

-- One row per configured source.
CREATE TABLE sources (
  id               TEXT PRIMARY KEY,   -- '<game>-<site>-<page>', e.g. 'genshin-game8-events'
  game             TEXT NOT NULL,
  url              TEXT NOT NULL,
  parser_id        TEXT NOT NULL,      -- parser template id, e.g. 'game8'
  priority         INTEGER NOT NULL DEFAULT 0,
  min_interval_ms  INTEGER NOT NULL DEFAULT 21600000,
  etag             TEXT,
  last_modified    TEXT,
  content_hash     TEXT,               -- sha256 of cleaned content; the skip check
  last_success_at  TEXT,
  last_attempt_at  TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  health           TEXT NOT NULL DEFAULT 'ok',   -- 'ok' | 'degraded' | 'failing'
  lock_holder      TEXT,
  lock_expires_at  TEXT
);

-- One row per pipeline execution. The audit trail.
CREATE TABLE ingest_runs (
  id              TEXT PRIMARY KEY,
  source_id       TEXT NOT NULL REFERENCES sources(id),
  started_at      TEXT NOT NULL,
  finished_at     TEXT,
  outcome         TEXT,               -- 'published' | 'skipped_unchanged' | 'quarantined' | 'failed'
  stage_failed    TEXT,
  error           TEXT,
  events_seen     INTEGER DEFAULT 0,
  events_changed  INTEGER DEFAULT 0,
  events_held     INTEGER DEFAULT 0
);

-- Cached raw snapshots so re-parsing never re-fetches.
CREATE TABLE snapshots (
  content_hash TEXT PRIMARY KEY,
  source_id    TEXT NOT NULL,
  fetched_at   TEXT NOT NULL,
  raw          BLOB NOT NULL,
  cleaned      TEXT NOT NULL
);
```

`region_ends` and `payload` hold JSON as TEXT; parse them through the Zod schema on read so a
malformed row surfaces at the boundary rather than deep in the UI.

## Client-side storage

Namespaced, versioned, and small. Nothing here ever goes to the server.

```ts
"gacha-tracker:v1:progress"     // { [eventId]: { status?, effort?, note?, at } }
"gacha-tracker:v1:daily"        // { [id]: { days: ["2026-08-15", ...], at } }
"gacha-tracker:v1:ignored"      // { [eventId]: { at } }  — "stop showing me this"
"gacha-tracker:v1:prefs"        // { region, hiddenGames[], knownGames[]?, focusGame, sort, view,
                                //   timelineDayWidth, timelineGroup, showUpcoming,
                                //   timelineSplitUpcoming, detectDaily, showCompleted,
                                //   showIgnored, theme, regionConfirmed, onboarded }
                                // timelineDayWidth is px per day on the board, stored as the
                                // measurement rather than a step number and read through
                                // snapDayWidth — so a value from an older ladder still opens
                                // on something renderable.
                                // timelineGroup is "game" (a lane each) or "ending" (every game
                                // in one deadline queue). Defaults to "game", so shipping it
                                // moved nobody's board; see PRD F1.
                                // showUpcoming shows events that have not started yet, in
                                // BOTH views — the board plots them, the checklist keeps its
                                // "Not started yet" section. Defaults to false; set from
                                // settings alongside showCompleted / showIgnored, which is the
                                // same question. See PRD F1.
                                // It was named timelineUpcoming while it governed the board
                                // alone. `adoptRenamed` in usePrefs.ts carries a stored old
                                // value across on load — nothing is lost by dropping it, since
                                // this is one blob under one key rather than a key space, but
                                // resetting a reader's answer for them is not nothing either.
                                // A stored new name always wins, so it cannot overwrite a
                                // fresher answer with a stale one.
                                // timelineSplitUpcoming keeps those events in their own block
                                // under a "Not started yet" heading (true, the default) or puts
                                // them in one deadline order with the running ones (false).
                                // The board only: the checklist splits them into a section of
                                // its own either way. Read only when showUpcoming is on, but
                                // stored regardless, so switching that back on restores the
                                // answer given. PRD F1.
                                // knownGames is every lane the reader has been offered. Absent
                                // means unrecorded, not "offered nothing" — see PRD F8; a lane
                                // missing from it is new to them and arrives switched off.
                                // theme is "dark" | "light" | "system", defaulting to dark — see
                                // PRD F15. It is read by the app *and* by a pre-paint script in
                                // index.html, which is the only thing outside the client bundle
                                // that touches a key in this space.
"gacha-tracker:v1:completions"  // SUPERSEDED — read once to migrate, never written
```

`progress` is everything the reader says about an event themselves:

| Field | Values | Meaning |
|---|---|---|
| `status` | `"doing"` \| `"done"` \| absent | Where they are with it |
| `effort` | `"quick"` \| `"short"` \| `"long"` \| `"grind"` \| absent | How much work they reckon it is |
| `note` | free text | Anything worth remembering |
| `daily` | `true` \| `false` \| absent | Whether it repeats daily, overruling detection |

An entry with none of the three set is deleted rather than kept, so the store stays a set of things
the reader actually said something about.

**`effort` is load-bearing, not decorative.** Combined with the time remaining it answers "can I
still finish this?" — the same two days is comfortable for a `quick` event and hopeless for a
`grind`. See `src/shared/effort.ts`; the runway heuristic assumes about an hour of play a day, is
stated as a guess in the UI, and never hides or reorders anything.

**An event with no recorded effort never gets a warning.** Inferring an estimate in order to warn
about it would be fabricating the reader's own input.

Ignores stay in a separate store because they mean something different: a done event is dimmed and
still counted, an ignored one disappears from both views.

### Daily checklists

Some events are not one job with a deadline but twenty small jobs on twenty separate deadlines, and
a missed day is gone whatever you do afterwards. `daily` records which game-days the reader ticked
off, keyed by:

- an **event ID**, for a repeating event in the feed (`src/shared/daily.ts` § `isDaily`), or
- **`dailies:<game>`**, the standing per-game chore — commissions, sanity, daily training. No source
  publishes these, so they are a fixed client-side list, never feed data. The two-segment shape
  cannot collide with an event ID, which is always `game:slug:date`.

Day keys are `YYYY-MM-DD` in **game-day space, not UTC**: gacha servers roll the day at 04:00 local
server time, so a player finishing at 02:00 is still on the previous day's dailies, and the key is
computed against the reader's chosen region (`RESET_HOUR_LOCAL`, `dayKey`). Keys sort
lexicographically, which is what "how many days are left" and streak counting rely on.

**Not every game has a server per region.** `GameMeta.resetOffsets` records the regions where a
game's server clock differs from `REGION_RESET_UTC_OFFSET`. Endfield is the case this exists for: it
has two server groups rather than three, and Europe is served off the Americas machine on a fixed
UTC-5, so a European player's reset is 09:00 UTC — six hours after the HoYoverse/Kuro pattern.
Every day-key function takes an optional `game` for this reason, and **anything reading or writing a
tick must pass it**: a write under one clock and a read under another puts the tick on a day the
reader cannot see.

| Game | Reset (server local) | Server offset | Reset (UTC) | Copenhagen, summer / winter |
|---|---|---|---|---|
| Genshin, Star Rail, ZZZ, Wuwa, NTE | 04:00 | region (EU = UTC+1) | 03:00 | 05:00 / 04:00 |
| Infinity Nikki, P5X, Blue Archive | 04:00 | region (assumed) | 03:00 | 05:00 / 04:00 |
| Arknights, all regions | 04:00 | UTC-7 (one Global server) | 11:00 | 13:00 / 12:00 |
| Endfield, Europe | 04:00 | UTC-5 (on the Americas server) | 09:00 | 11:00 / 10:00 |
| Endfield, Asia / Americas | 04:00 | regional default | 20:00 / 09:00 | — |
| Reverse: 1999, all regions | **05:00** | UTC-5 (one global server) | 10:00 | 12:00 / 11:00 |
| hololive Dreams, all regions | 04:00 | UTC+9 (one worldwide server) | 19:00 | 21:00 / 20:00 |

Arknights and hololive Dreams are the games whose override covers **all three** regions, and neither
is a blanket per-game offset of the kind this section warns about below: both genuinely run a single
worldwide server for every region we model. Arknights' offset is read off the source rather than
assumed — every ending event on arknights.wiki.gg carries an exact end of `10:59:59Z`, which is
`03:59:59` at UTC-7, one second before a 04:00 reset.

hololive Dreams is read the same way and is the cleaner case of the two, because the source states
its zone outright: every boundary on holodori.wiki carries `(JST)`, the game launched worldwide
simultaneously on one service, and `Training Support Missions` ends at `3:59AM JST` — one minute
before a 04:00 local reset. Only the offset is overridden; the hour is the default. It also cost
nothing to add, which is the point worth carrying to the next game: an override that arrives with
the game moves nobody, while the same override added a year later re-labels every tick already
logged under the old clock. Get it right at introduction or accept a migration.

Nikke is the third game to earn one from the source rather than from habit, after Arknights and
Reverse: 1999, and it earns `resetHourLocal` too: every schedule column on its wiki is headed
`Start(UTC+9)` / `End(UTC+9)`, and the rows show where the day turns — a story event ends at
04:59:59 and the pickup banner replacing it starts at 05:00:00, one second later. So UTC+9 for every
region, rolling at 05:00 rather than 04:00. It shipped in the same commit as the game, which costs
nothing while no reader has a day key for it.

Note also that `nikke` and `nikki` are one letter apart and are different games — Goddess of Victory:
Nikke and Infinity Nikki. Both are the first segment of every completion key their game will ever
have, so a typo in either direction is silent data loss for real readers.

Infinity Nikki's source changed on 2026-08-19 and its silence changed shape with it: the Fandom wiki
states a wall clock on every boundary and no zone for it, so there is still nothing to read a server
map off — the clock is discarded at ingest and only the printed day is published. An offset invented
here would move real readers' day keys.

Infinity Nikki, P5X, Blue Archive, Chaos Zero Nightmare and Umamusume carry **no `resetOffsets`
entry**, so they take the regional default. That is an assumption, not a verified server map — none
of those sources states one. Two of the 2026-08-19 additions are worth separating out, because they
are silent for different reasons and neither is the usual one:

- **Girls' Frontline 2** states an exact UTC instant on every boundary, so the data is there and
  still settles nothing: its EN events end at 22:59 (33 of them), 08:59 (11) and 02:59 (5). Arknights
  and Reverse: 1999 each earned an override from a single boundary the whole page agreed on; three
  of them is a patch window, not a reset hour.
- **Stella Sora** states an offset outright — `-07:00` — and that is precisely why it gets no entry.
  `-07:00` is US Pacific in summer and `-08:00` in winter, so one fixed number is wrong for half the
  year in either direction. This is the Fate/Grand Order gap, arriving through a source that looks
  like it answered the question.


Blue Archive is the case where the assumption is most likely wrong and still the right entry: the
game does run one worldwide server, but `bluearchive.wiki` states no time of day and no timezone
anywhere on the page, so there is no offset to read off it. Confirm these against the games before
relying on them, and note that adding an override later re-labels the game-day of ticks readers have
already logged, which is the change this table warns about below.

**Reverse: 1999 is the one game that rolls on a different hour**, and it needs its own field rather
than a bent offset. It runs a single global server on UTC-5 and resets at **05:00**, so its day rolls
at 10:00 UTC. `resetOffsets` alone cannot say that: landing 10:00 UTC through the offset would mean
claiming a UTC-6 server, which is a lie every other reader of `serverOffsetUtc` would inherit. So
`GameMeta.resetHourLocal` overrides `RESET_HOUR_LOCAL` per game, and is absent — meaning 04:00 — for
everything else, which is why introducing it moved no existing day key. Both facts come off the
source: all 154 rows of the wiki's event list state `(UTC-5)`, and every one runs 05:00 → 04:59, an
event ending one minute before the reset the next one starts on.

These server offsets are **fixed and do not observe DST**, so the reader's local reset time moves by
an hour across the European clock change while the UTC instant stays put.

The override is deliberately **per region, not per game**. A blanket per-game offset is the wrong
shape: it drags the regions that do have their own server onto somebody else's clock, moving day
keys for readers who never had the bug. List only the regions that actually differ.

Changing a value in that table is a **data change, not a constant change**: it re-labels the
game-day some already-logged ticks fall in, for readers in that region. Two consequences to check
before shipping one, both of which are invisible at runtime:

- A tick logged inside the shifted window reads as the adjacent day, which can show as a one-day
  break in a streak. Recoverable — past days stay editable.
- If the shift moves a window's boundary, a day can drop out of `dailyDays` entirely. A day that is
  not in `dailyDays` renders no pip, so a tick on it is **unreachable**: not deleted, but with no UI
  path back to it and nothing server-side to recover from. Check the real fixture windows for the
  affected game and region before changing an offset.

Three rules this store keeps, for the same reason the rest of the client does — nothing else holds
a copy:

- **A tick is never removed except by the reader.** Ticks that fall outside the window the feed now
  claims still count; a source quietly moving a date must not erase a fortnight's streak.
- **An unannounced end yields no checklist**, not a checklist of guessed length. `dailyDays` returns
  null when `endsAt` is null, and the UI says how many days are ticked instead of how many are left.
- **Past days stay editable.** People log in and tick up later, and a checklist that cannot be
  corrected stops being trusted after the first mistake.

Dailiness is derived from the published event — `type: "login"`, or wording like "daily",
"check-in", "7-day" in the title or summary — and never from a game's habits or an event's length.
It adds no schema field, so nothing about the feed contract or the event ID changes.

**The reader overrules detection**, per event and globally. `progress.daily` records their answer
for one event and wins outright (`resolveDaily`); absent means they have not said, so detection
stands. `prefs.detectDaily` switches the guessing off altogether, leaving only events they marked
themselves — it silences detection rather than deleting anything, so every mark and every logged day
survives and switching it back on restores exactly what was there.

**Detection is off by default and labelled experimental in the UI.** Wording is a weak signal and it
is wrong in both directions, so a new reader starts with only the standing `dailies:<game>` chores
and whatever they mark themselves; opting in is one checkbox. The default applies to new readers
only — a stored `prefs` keeps whatever value it has, because turning it off under a reader who has
been ticking auto-detected checklists would pull those chips out of the strip with no explanation.
An override that merely
agrees with detection is **not stored** (`dailyOverride`) — freezing today's guess into their data
would stop a later parser improvement from ever reaching that event. This is the only field in
`progress` that changes what the app *shows* rather than recording what the reader did, which is
why it lives beside their other notes rather than in the feed.

### Reader-authored key spaces

PRD F13 lets a reader define their own game and enter their own events. Those records get their own
ID spaces, and the reason is the one this document keeps making:

```
mygame:<slug>        a game the reader defined      "mygame:limbus-company"
myevent:<random>     an event the reader entered    "myevent:k3f9qa2m"
```

**A reader's event is never minted as `${game}:${slug}:${date}`.** That space is derived from source
titles, and a reader can type a title identical to a scraped one — same game, same start date, same
slug, same key. Two records under one key means one completion mark, one note and one streak
silently belong to both, and the collision is invisible until someone notices their progress moving
on its own. A random suffix makes that impossible rather than unlikely.

The randomness buys a second property worth keeping: **renaming your own event does not move its
ID.** A feed event's ID follows its source title, so a wiki renaming an event mints a new ID and
reconciliation has to recognise the near-match to preserve marks. A reader's event has no source to
follow, so its ID is assigned once at creation and never derived from anything they can edit.

Three first segments are now reserved and **none of them may ever become a `GameId`**: `dailies`,
`mygame`, `myevent`. A test asserts this against `GameId.options`, because the day that stops being
true is the day two key spaces merge silently.

```ts
"gacha-tracker:v1:customGames"   // { [id]: { id, name, hue, at } }
"gacha-tracker:v1:customEvents"  // { [id]: { id, game, title, type, summary,
                                 //           startsAt, startPrecision,
                                 //           endsAt, endPrecision, at, updatedAt } }
```

Reader-authored events reuse `progress`, `daily` and `ignored` unchanged, keyed by their `myevent:`
id — everything the reader can say about a scraped event they can say about their own, with no
second set of stores to keep in sync.

Field rules mirror the feed's, because the reader deserves the same guarantees the parsers are held
to:

| Rule | Why |
|---|---|
| `endsAt` null pairs with `endPrecision: "unknown"` | The same invariant `GachaEvent` enforces. "I don't know when this ends" is a supported answer for a reader too, and a required one — otherwise entering an unannounced event forces them to invent a date |
| A date with no time is `"day"` precision, a date with one is `"exact"` | So the UI's existing "accurate to the day only" note is honest about their input as well. Their day-precision boundary is still *their* instant, though — `readerInstant` puts a start at 00:00 and an end at 23:59:59 in their own timezone, so unlike a parser's placeholder it is never re-anchored to a server reset |
| `endsAt` must be after `startsAt` | A backwards interval is a typo whoever made it |
| `hue` must match `#rrggbb` | It reaches a `style` attribute, and an imported file is not necessarily one the reader wrote |
| `regionScoped` is always false | They entered one instant, not a per-region map. Claiming otherwise would fabricate three timestamps out of one |

There is deliberately **no `dailyTasks` for a custom game**, so it contributes no standing
`dailies:<game>` chore. That list is the routine every player of a tracked game recognises; asking a
reader to invent one is a form to fill in for a reminder they already have. Their events can still be
marked as repeating, per event, like any other.

**Deleting.** Removing your own event leaves any marks and logged days behind rather than reaching
into three other stores on a single tap; they are inert, and the alternative is a misclick that
deletes a streak. Removing a game that still has events is refused and says how many, rather than
cascading.

### Migration from `completions`

`completions` used membership to mean "done", which cannot express "started". `progress` replaces it
and is seeded from it once, on first load, mapping each entry to `status: "done"`.

**The old key is never written to and never deleted.** Someone who last opened the app six months
ago still has their marks under it, these live only in the browser, and nothing else holds a copy to
restore from. Exports produced before the change are still accepted on import and mapped forward the
same way.

Offline caching is the service worker's job, not localStorage's — it caches the feed response
itself, so there is no second copy of the events to keep in sync.

The `v1` segment is the migration hook. On boot, the client checks for keys at older versions and
migrates them forward before reading. **Never delete an old-version key until the migration has
shipped and run** — a user who has not opened the app in six months still has their data under the
old key.

### Export format (PRD F6)

```json
{
  "format": "gacha-tracker-export",
  "version": 1,
  "exportedAt": "2026-08-14T12:00:00.000Z",
  "progress": {
    "genshin:windblume-festival:2026-03-14": { "status": "done", "at": "..." },
    "hsr:garden-of-plenty:2026-08-14": { "status": "doing", "effort": "grind", "at": "..." }
  },
  "daily": {
    "endfield:bedazzling-dawnstar:2026-08-12": { "days": ["2026-08-13", "2026-08-14"], "at": "..." },
    "dailies:genshin": { "days": ["2026-08-14", "2026-08-15"], "at": "..." }
  },
  "ignored": { "zzz:some-event-i-skip:2026-08-19": { "at": "..." } },
  "customGames": {
    "mygame:limbus-company": { "id": "mygame:limbus-company", "name": "Limbus Company",
                               "hue": "#c74b50", "at": "..." }
  },
  "customEvents": {
    "myevent:k3f9qa2m": { "id": "myevent:k3f9qa2m", "game": "mygame:limbus-company",
                          "title": "Walpurgisnacht", "type": "banner", "summary": null,
                          "startsAt": "2026-08-20T00:00:00.000Z", "startPrecision": "day",
                          "endsAt": "2026-09-03T00:00:00.000Z", "endPrecision": "day",
                          "at": "...", "updatedAt": "..." }
  },
  "prefs": { "region": "europe", "hiddenGames": [], "sort": "ending", "onboarded": true }
}
```

`customGames` and `customEvents` are additive keys, so a v1 export written before F13 simply lacks
them — not an error, just a file from a device that had none. They merge by id like everything else,
and because an event and the game it belongs to travel in the same file, an import never lands an
event whose lane is missing.

Import **merges** every set: a mark present in either the file or the current device survives, and
import never removes one. `daily` merges as a **union of days per ID** — every day either side
recorded is a day the reader actually played. An export written before daily checklists existed
simply has no `daily` key, which is not an error. Losing a user's marks to a bad import is unrecoverable, so the merge is
deliberately one-directional. A file whose `format` is unrecognised is refused outright rather than
partly applied.

## Schema versioning

`/api/events` responses carry `{ schemaVersion: 1, generatedAt, events: [...] }`. The client
refuses to render a `schemaVersion` it does not know and shows a "refresh the page" prompt instead
of guessing at unfamiliar fields. Additive fields do not bump the version; removing or retyping a
field does.
