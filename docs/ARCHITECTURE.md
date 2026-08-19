# Architecture

## Shape

One Bun process serves the static React build, exposes a read-only JSON API, and runs the
ingestion scheduler on a timer. SQLite is the only datastore. There is no auth layer because there
are no users.

```
                    ┌──────────────────────────────────────────────┐
   game wikis  ───► │  Bun process                                 │
   news pages       │                                              │
                    │   scheduler (every 6h)                       │
                    │        │                                     │
                    │        ▼                                     │
                    │   ingest pipeline                            │
                    │   fetch → parse → merge → validate           │
                    │        → reconcile → gate and publish        │
                    │        │                    │                │
                    │        │                    └──► quarantine  │
                    │        ▼                          │          │
                    │   ┌─────────────┐                 │          │
                    │   │  SQLite     │◄────────────────┘          │
                    │   └─────────────┘      /review (127.0.0.1)   │
                    │        │                                     │
                    │        ▼                                     │
                    │   GET /api/events        static React build  │
                    └────────┬─────────────────────────┬───────────┘
                             │                         │
                             ▼                         ▼
                        browser fetch            browser render
                                  │
                                  ▼
                        localStorage: progress, daily, ignored,
                        prefs, the reader's own games and events
                                         ← never leaves the device
```

**That is the design, and the scheduler half of it is not built yet.** What runs today is
`scripts/refresh-sources.ts` on a GitHub Actions cron, writing snapshots to disk, and a feed built
from those files rather than from SQLite — see § Today. The stages, the layering and the review gate
are unchanged by that; only what wakes them up and where they land is.

The pipeline makes no third-party API calls beyond fetching source pages. There is no inference
anywhere, at ingest time or in a request path.

## Layout

```
src/
  server/
    index.ts            Bun.serve entry: static + API + scheduler bootstrap
    routes/
      events.ts         GET /api/events, /api/events.json
      games.ts          GET /api/games
      review.ts         /review UI + approve/reject (localhost-bound)
      health.ts         GET /api/health
    db/
      client.ts         bun:sqlite handle, WAL, pragmas
      migrations/       NNN-name.sql, applied in order at boot
      queries.ts        all SQL lives here — no SQL in route handlers
  ingest/
    scheduler.ts        timer + jitter + per-source lock          [not built]
    pipeline.ts         the 6 stages, orchestration only          [not built]
    html.ts             flat-table HTML reader (no dependency)    ✓ built
    dates.ts            ten deterministic date formats            ✓ built
    merge.ts            cross-source dedupe, corroboration        ✓ built
    sanitize.ts         the trust boundary — stage 2.5            ✓ built
    robots.ts           robots.txt parsing, matching, host cache  ✓ built
    snapshots.ts        raw snapshot cache + conditional headers  ✓ built
    validate.ts         zod parse + calendar sanity rules         [not built]
    reconcile.ts        diff vs published, confidence, conflicts  [not built]
    parsers/
      types.ts          SourceParser interface                    ✓ built
      game8.ts          game8.co article calendars                ✓ built
      wikigg.ts         wiki.gg mp-event templates                ✓ built
      akwiki.ts         arknights.wiki.gg mrfz-wtable             ✓ built
      fandom.ts         Fandom via the action=parse API           ✓ built
      bawiki.ts         bluearchive.wiki JP/Global tabber         ✓ built
      holodori.ts       holodori.wiki Current/Past Events tables   ✓ built
      index.ts          parser registry                           ✓ built
    adapters/
      types.ts          Adapter interface, ParseContext           ✓ built
      index.ts          SOURCES registry, parseGame(), sanitize   ✓ built
  shared/
    schema.ts           zod schemas — the contract, both sides    ✓ built
    time.ts             clocks, urgency, region resets, captions  ✓ built
    games.ts            per-game name, hue, and reset clock       ✓ built
    daily.ts            which events repeat, and game-day keys    ✓ built
    effort.ts           effort estimates and the runway heuristic ✓ built
    custom.ts           the reader's own games and events (F13)   ✓ built
    feed.ts             the /api/events.json wire contract        ✓ built
  client/                                                         ✓ all built
    main.tsx            render + service worker registration
    App.tsx             shell, views, filters, onboarding gate
    api.ts              typed feed fetch, schemaVersion refusal
    sw.js               offline: shell cache, feed fallback
    manifest.webmanifest, icon.svg
    components/
      NextUp.tsx        the next three deadlines    (PRD F2)
      EventRow.tsx      row + meter + caption       (F2, F3)
      Meter.tsx         the depletion meter
      Legend.tsx        what the bars and colours mean
      Timeline.tsx      the board: pinned axis, lanes, bars   (F1)
      EventDetail.tsx   detail sheet, ignore action (F9)
      ProgressControls  status, effort, note        (F12)
      Dailies.tsx       today's strip, per-game reset clocks
      DailyChecklist    one repeating event's whole run
      Fireworks.tsx     the burst when the last daily lands
      GameFocus.tsx     one game at a time          (F4a)
      Controls.tsx      games, region, export/import(F4, F5, F6)
      Welcome.tsx       first-run games and view    (F8)
      Toast.tsx         undo an ignore
      UpdateNotice      a newer app is installed and waiting  (F14)
      YourOwn.tsx       the reader's own games, in settings   (F13)
      CustomForms.tsx   the game and event forms behind it    (F13)
      Colophon.tsx      credit, disclaimer, repo link
    state/
      storage.ts        namespaced, versioned localStorage
      useMarkSet.ts     ignores (and the superseded completions shape)
      useProgress.ts    status, effort, note, daily override  (F12)
      useDailyLog.ts    which game-days are ticked off
      usePrefs.ts       region, filters, focus, view, theme, onboarding flags
      theme.ts          dark/light: resolving it, applying it, hues on paper
      useCustom.ts      the reader's own games and events     (F13)
      gameMeta.tsx      lane id → name, label, hue; resolves custom lanes too
      sort.ts           deadline order, or what you're partway through
      lens.ts           who sees which rows — focus, outstanding, next-to-expire
      zoom.ts           the timeline's scale ladder; pure
      lanes.ts          how the timeline stacks — lanes, or one deadline queue; pure
      useAppUpdate.ts   is a newer build waiting, and taking it   (F14)
serve.ts                static server + /api/health              ✓ built
scripts/
  build-feed.ts         fixtures → public/data/events.v1.json     ✓ built
  build-static.ts       shell + worker into public/, build-stamped ✓ built
  parse-fixture.ts      run one adapter offline                   ✓ built
  refresh-sources.ts    fetch, cache, rebuild — the only network   ✓ built
fixtures/<game>/        checked-in raw HTML + expected parse output
snapshots/              the current page per source, rewritten by refresh
```

## Request paths

| Route | Purpose | Notes |
|---|---|---|
| `GET /` + assets | React SPA | Served from the `bun build` output |
| `GET /api/events?from&to&game` | Filtered feed | `ETag` + `Cache-Control: public, max-age=300` |
| `GET /api/events.json` | Whole published feed | Cheap; the client mostly uses this and filters locally |
| `GET /api/games` | Game metadata: id, name, color, lastUpdatedAt | Drives the freshness badges (F7) |
| `GET /api/health` | Per-source last-success, quarantine depth | For an operator, not the UI |
| `GET /review` | Quarantine review UI | **Bound to `127.0.0.1` only** |
| `POST /api/review/:id/approve` \| `/reject` | Promote or discard a quarantined event | Same binding |

### Why `/review` needs no auth

`Bun.serve` runs two listeners: the public one on `0.0.0.0:PORT` with the SPA and `/api/*`, and a
second on `127.0.0.1:ADMIN_PORT` with `/review` and `/api/review/*`. The review routes are not
registered on the public listener at all — they are unreachable from off-box, so there is nothing
to authenticate. This is the mechanism that satisfies "no logins" without leaving an open admin
endpoint on the internet.

**This is load-bearing.** If someone later puts a reverse proxy in front of the admin port, or
merges the two listeners "to simplify", the review UI becomes a public write endpoint. Any change
in that area needs an explicit auth story first.

## Data flow, concretely

1. **Scheduler** wakes every 6h (± jitter). For each source not fetched within its `minIntervalMs`,
   it acquires a per-source lock row and enqueues a run.
2. **Pipeline** executes the six stages in `docs/INGESTION.md`. Every stage writes to
   `ingest_runs` so a failure is diagnosable after the fact without re-running.
3. **Publish** upserts into `events` by stable ID, bumping `version` and `updatedAt` when any field
   changed. Events that vanish from a source are *not* deleted — they are marked
   `status = 'delisted'` so a source outage cannot silently empty the calendar.
4. **Client** fetches the feed, joins it against `localStorage` by event ID — progress, ticked
   days, ignores, and the reader's own events — and renders. That join is client-side only; the
   server never learns what the reader completed, skipped, or typed in.

## Concurrency and failure

- One in-flight run per source, enforced by a lock row with a stale-lock timeout of 15 minutes.
- A source that fails keeps its previously published events. A failed run never deletes or blanks
  data — worst case, the game's lane goes stale and gets a warning badge (F7).
- Three consecutive failures for one source raises its `health` to `failing` in `/api/health`, and
  is what the refresh runner reports as `broken`. It never stops the schedule or the commit — a wiki
  being down for an afternoon is normal — but it does fail the run afterwards, because at two cycles
  a day that game's calendar has been served from a checked-in fixture for a day and a half.
- Raw snapshots are cached by content hash, so a parser change is always evaluated offline against
  stored pages rather than by re-fetching.

## Deployment

Single process, single SQLite file, no external services at all.

```
PORT=3000
ADMIN_PORT=3001            # bound to 127.0.0.1
DATABASE_PATH=./data/events.sqlite
INGEST_INTERVAL_MS=21600000
INGEST_ENABLED=true        # false for local UI work — never touches the network
CONFIDENCE_THRESHOLD=0.8
BASE_PATH=/               # trailing slash; set when hosting under a subpath
```

`INGEST_ENABLED=false` is the default for local development. Frontend work should run against a
seeded SQLite file and cost nothing.

### Today

`serve.ts` serves `public/` plus `/api/health`, and the feed is generated offline by
`bun run build:feed` from `snapshots/`, falling back to `fixtures/` for a source with no snapshot. It
emits exactly the shape `/api/events.json` will, so the real server slots in without the client
changing. Reads are confined to `public/` by resolving the path and checking it stays inside the root
— string-matching `..` is not enough, because encodings and URL normalisation both change what the
string looks like.

`scripts/refresh-sources.ts` (`bun run refresh`) is what fills `snapshots/`, and it is the only code
here that touches the network. `.github/workflows/refresh.yml` runs it at 05:27 and 17:27 UTC and
commits only when a page actually changed. It stands in for the unbuilt scheduler and enforces the
same conduct in code — the 6h floor, one request, no retries, conditional headers, per-host spacing,
robots failing closed. A source that has failed `BROKEN_AFTER_FAILURES` (3) cycles running is
reported as `broken` and fails the run *after* the commit; see `AGENTS.md` § Scraping conduct for why
that ordering is load-bearing.

`Dockerfile` builds and serves this; the image runs typecheck and tests during build, ships no source
or toolchain, and runs unprivileged. `.github/workflows/ci.yml` and `.gitlab-ci.yml` run the same
gates and publish it.

### Hosting under a subpath

Assets resolve against a `<base href>` substituted at build time, the feed URL resolves against
`document.baseURI` so deep links work, and the service worker derives its paths from its own
registration scope. `BASE_PATH=/gacha-event-tracker/ bun run build` for GitHub Pages; without it a
subpath deploy 404s on every asset.

### Offline

The service worker caches the shell and webfonts (cache-first) and the feed (network-first, falling
back to the last copy seen). Countdowns run off the device clock, so the app stays useful with no
network. Offline state is surfaced in the header and above the footer — stale data must never be
presented as current.

### The theme, before the bundle arrives

The page is drawn dark by default and light when the reader has asked for it (PRD F15). Which one
is decided by one attribute on `<html>`: `styles.css` holds the dark tokens on `:root` and
re-strikes them under `:root[data-theme="light"]`, so nothing in React knows a theme exists and no
component holds a colour of its own.

Setting that attribute is the one part React cannot do in time. It mounts after the bundle has
downloaded and parsed, which on a cold cache is long enough to show a reader who chose light a
dark page, on every single load. So a small inline script in `index.html` reads the same
`localStorage` prefs key the app does, sets the same attribute, and updates `<meta
name="theme-color">` — before first paint, and with a `try`/`catch` so storage being unavailable
costs the reader the default theme rather than the page.

That makes the theme's ground colour a fact written in three files that cannot import each other:
the stylesheet, `state/theme.ts` (which needs it for the meta tag), and the shell. `test/theme.test.ts`
pins the three together rather than trusting them to be edited at the same time.

### Shipping a new version to an open page

A cache-first shell is what makes the offline story work and what makes a deploy invisible: the
reader this app is built for leaves the tab open for days, so a new game, a repaired parser or a
corrected date reaches their device and then sits there unused. Presenting an old app as current is
the same failure as presenting old events as current, so it is disclosed the same way.

```
build:static ──► sw.js stamped with a hash of the built shell
                        │
browser byte-compares sw.js on navigation, hourly, and when the tab is
revealed (registration.update)
                        │
   bytes differ ──► new worker installs, precaches, and WAITS
                        │
   registration.waiting ≠ null and a controller exists
                        │
   UpdateNotice: "A new version of Event Clock is ready."  [Reload] [×]
                        │
   Reload ──► postMessage {type:"skip-waiting"} ──► worker activates
          ──► controllerchange ──► location.reload()
```

Four properties this depends on, each of them load-bearing:

- **The worker never calls `skipWaiting()` on install.** Claiming an open page unasked leaves the
  running bundle and the cached shell on two different builds, with nothing on screen saying so. It
  activates only on the message the reader's tap sends. A first install has no worker to wait for and
  activates immediately regardless — and is deliberately *not* announced, since nothing is being
  replaced.
- **The build id is derived, not remembered.** `scripts/build-static.ts` hashes the built shell
  (`index.html`, `main.js`, `styles.css`, `sw.js` source) and substitutes it for `__BUILD__` in the
  worker, so any shell change alters the worker's bytes and is therefore offered. The predecessor was
  a hand-bumped `CACHE_VERSION`, which had already been forgotten once. The substitution **throws**
  if the placeholder is gone, because the failure mode is silent.
- **The feed is not part of the id.** It is rewritten twice a day and served network-first, so new
  events reach an open page without a reload. Calling that a new version would teach readers to
  dismiss the notice unread.
- **The cache name does not move with the build.** Everything in it is refetched (`cache: "reload"`,
  since none of these URLs are fingerprinted) on install, so a per-build bucket would buy nothing and
  would discard the stored feed — the copy an offline reader is reading.

`src/client/state/useAppUpdate.ts` holds the client half; `sw.js` and the hook cannot import each
other, so `test/update.test.tsx` pins both ends of the `skip-waiting` handshake and the placeholder.

## Deliberate non-choices

- **No ORM.** `bun:sqlite` plus hand-written SQL in `queries.ts`. The schema is five tables.
- **No Redis / job queue.** The scheduler is a timer and a lock row. Restarting the process resumes
  cleanly because state is in SQLite.
- **No server-side rendering.** The feed is small and cacheable; a static SPA is enough.
- **No websockets.** Events change on a scale of hours; a 5-minute cache is more than adequate.
