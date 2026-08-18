# gacha-event-tracker (fork of StereotypicalCat/gacha-event-tracker)

Self-hosted gacha event calendar, deployed via `docker-compose.yml`, built
locally from source (no upstream image). Public at
`gachaevent.duongfamilylab.net` through Cloudflare Tunnel — **no Cloudflare
Access**, deliberately: this app has no login, no accounts, and no
server-side user data (everything a reader marks or types lives in their own
browser's localStorage), so there is nothing an Access policy would be
protecting that isn't already public by design. See `## Cloudflare Tunnel`
below before changing that.

For the coding conventions, domain rules and the three constraints this
codebase itself works under, see [AGENTS.md](AGENTS.md) — that file is
upstream's, untouched by this fork, and still applies exactly as written.
This file is this fork's *deployment* notes, in the same place every other
service under `~/selfhost/` keeps them.

## Port & routing

Host port `3020` (loopback only — `127.0.0.1:3020:3000`), container listens
on the image's default `3000` internally. Not `3000` on the host — that's
already held by `open-webui` on this Mac. Public hostname
`gachaevent.duongfamilylab.net`.

The `BASE_PATH=/` line in `docker-compose.yml`'s `environment:` is inert:
`serve.ts` (the runtime process) never reads it, and `scripts/build-static.ts`
(which does) only runs inside the Dockerfile's `build` stage — Compose's
`environment:` doesn't reach `docker build`, and the Dockerfile has no `ARG`
for it either. It happens to already equal that script's own default, so this
deployment behaves correctly regardless. Left in rather than removed, since
it costs nothing and documents the intent; if this app is ever mounted under
a subpath, wiring it through will need a Dockerfile `ARG`, not just this line.

## Games removed from this fork

Arknights, Infinity Nikki, Blue Archive, and Fate/Grand Order are gone
entirely — schema (`GameId`), `GAMES`, their sources in `SOURCES`, the
`akwiki`/`bawiki` parsers (nothing else referenced them), the
FGO-specific branch inside `parsers/fandom.ts` (`parseFgoEventsPage`
and friends — dead code once nothing fed it; the "standard" path r1999
uses is untouched), fixtures, snapshots, and test coverage. Reason: I
don't play them. Upstream's own docs (`docs/PRD.md`, `docs/DATA-MODEL.md`,
`docs/INGESTION.md`, `docs/ARCHITECTURE.md`, `docs/FEEDBACK.md`,
`AGENTS.md`) still describe all four as current, tracked games —
**deliberately left untouched** rather than edited to match, so
`git fetch upstream && git merge upstream/main` (see below) stays
low-friction. If a stale doc reference is ever confusing, that's the
trade-off; re-litigate it there, not by editing upstream's docs piecemeal.

## Path to Nowhere: registered, no source yet

`ptn` exists in `GameId`/`GAMES` (name, hue, studio "Aisno Games", daily
chore "Daily Dispatch" — verified against the wiki's own `/wiki/Dispatch`
page, not guessed) but **has no adapter, no parser, no source registered**.
Same shape Arknights had in `games.ts` before its source existed.

Why: the only wiki for this game, `pathtonowhere.wiki.gg`, has no current
event data anywhere on it, as of this fork's creation (2026-08-17):

- `Category:Events` is a bare navigation index — 37 links, no dates.
- `/wiki/Events`, the one central "Story Events" table
  (`Event | Time Period | Notable Reward`), carries real prose dates
  (`Date: Nov 10, 14:00 - Nov 23, 2022 04:59 (Server Time)`) — but only
  through **July 2024**. Every row after that has a blank `Time Period` cell.
- `/wiki/Patch_History` — the other plausible central listing — has table
  headers and zero rows.
- Individual event pages (checked `Chocolate_War`, `Crystalized_Reverie`) do
  carry the prose date format you'd expect (`■ Event Duration: <range>
  (Server Time)`, sometimes missing a year entirely). But per the sitemap,
  **all 37 event pages** were last touched in a single September 2025 bulk
  import batch (the page footer confirms: pages created before December
  2024 were adapted from the old Fandom wiki), with two touched again
  January 2026 in what looks like another mechanical batch edit, not new
  content. Nothing shows an organic per-event update past mid-2024.
- The original Fandom wiki it migrated from, `pathtonowhere.fandom.com`, no
  longer exists ("This wiki does not exist").

A parser here — however correctly it handled the date prose — would yield
zero live/upcoming events forever, the same failure `AGENTS.md` already
declines `bluearchive.fandom.com` for. **Before building one:** re-check
whether the wiki has picked back up (a live event on `/wiki/Events` or a
recently-touched event page in the sitemap would be the signal), or look for
a different source entirely. Don't reuse the "Server Time" evidence above to
invent a `resetOffsets`/`resetHourLocal` for `ptn` either — none of those
stale pages ever states what UTC offset "Server Time" actually is, so
there's nothing to encode even setting the staleness aside.

## Docker

`docker compose up -d --build` — the Dockerfile's build stage runs
`bun run typecheck && bun test` as its gate, so a broken build never ships.
`./public/data` is bind-mounted into the container so the refresh cron below
can update the served feed without a rebuild; a fresh `docker compose build`
still bakes in whatever `bun run build:feed` produced from fixtures/snapshots
at image-build time, which the mount then overlays at runtime.

After building, `docker system prune -f` — bitten before by stale cached
layers on other services here. Removes dangling images/networks/build cache
only; running containers and their images are untouched.

## Cloudflare Tunnel

This Mac's `cloudflared` is a **remotely-managed tunnel**
(`cloudflared tunnel run --token ...` via a host LaunchDaemon) — there is no
local `config.yml` with `ingress:` rules here. Routing lives in the Zero
Trust dashboard, and the `gachaevent.duongfamilylab.net → localhost:3020`
entry is documented in `~/selfhost/homepage/CLOUDFLARE_TUNNEL.md` (added
alongside this fork's setup) — that's where the exact dashboard steps live,
since editing that shared file is as close as this repo's own tooling can
get to actually wiring the route. **No Access policy on this hostname** —
see the top of this file for why; don't add one without deciding that's
actually changed (a login, an API that writes something, any server-side
per-reader state).

## Auto-update

**Cron** (`crontab -l`), installed 2026-08-17, fixed 2026-08-18, twice daily
at 5:17am/pm:

```
17 5,17 * * * cd /Users/richard.yamada/selfhost/gacha-event-tracker && git pull && bun run refresh && bun run build:feed && (git status --porcelain -- snapshots | grep -q . && git add -- snapshots && git commit -m "chore(data): refresh source snapshots" -m "Automated fetch via the local twice-daily cron." && git push; true) && docker compose restart event-clock >> /Users/richard.yamada/selfhost/gacha-event-tracker/refresh.log 2>&1
```

The `git status ... && git add ... && git commit ... && git push; true` part
was missing in the version installed 2026-08-17 — it ran `refresh` and
`build:feed` but never committed the result, so a night's worth of refreshed
snapshots just sat as uncommitted local changes instead of building the
"commit only when a page's bytes changed" audit trail `.github/workflows/
refresh.yml` keeps upstream. Fixed to match that workflow's own logic:
`git add -- snapshots` scopes the commit to snapshot changes only (never
picks up unrelated work-in-progress files sitting in the tree), and the
`; true` means "nothing changed" is not a failure that skips the container
restart — only `git commit`/`git push` are conditional on it.

`PATH` is set explicitly at the top of the crontab
(`/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`) — cron's own default PATH
is `/usr/bin:/bin`, which has neither `bun` (Homebrew, `/opt/homebrew/bin`)
nor `docker` (`/usr/local/bin`). Depends on OrbStack actually running (it's
a login item, so normally is) — if `refresh.log` shows the `docker compose
restart` step failing, check `orbctl status` first. If the job never seems
to run at all, check System Settings → Privacy & Security → Full Disk
Access for `cron`/`/usr/sbin/cron` — macOS has been known to silently
swallow cron jobs without it. `git push` needs the SSH key set up
2026-08-18 (see `## Auto-update` → Remotes below) — if pushes start failing
again, check `ssh -T git@github.com` first.

**Upstream sync** — deliberately *not* cronned, so a bad upstream change
can't silently break a running build. Run by hand, periodically:

```
git fetch upstream && git merge upstream/main
```

**Remotes:** `origin` → `git@github.com:phuduong85/gacha-event-tracker.git`
(this fork — `bun run refresh` needs somewhere to commit its snapshots, and
the cron job above both pulls from and pushes to it), `upstream` →
`https://github.com/StereotypicalCat/gacha-event-tracker` (the original,
fetch-only, for the merge above).

`origin` is SSH, not HTTPS, on purpose: this Mac had no GitHub credentials
at all when the fork was first set up 2026-08-17 (no `gh`, no cached HTTPS
token, no SSH key), which is why the very first `git push` failed with
"could not read Username" and every commit through that session sat local
until 2026-08-18. Fixed with a new ed25519 keypair
(`~/.ssh/id_ed25519`/`.pub`) added to the `phuduong85` GitHub account —
`ssh -T git@github.com` should answer `Hi phuduong85!`. If push ever starts
failing again with an auth error, that key (or its absence) is the first
thing to check, not the remote URL.

## Broader homelab context

Part of the `~/selfhost/` homelab running on a Mac Mini M4, Docker Compose
per-service, all public hostnames under `duongfamilylab.net` routed through
a single Cloudflare Tunnel (remotely-managed, host LaunchDaemon
`cloudflared`). Unlike most sibling services, this one has **no Cloudflare
Access** in front of it — see `## Cloudflare Tunnel` above. Sibling
services: Homepage, Dashy, Homarr (dashboards), Glance (feed/content
aggregator), Jotty (notes), ByteStash (snippets), Joplin (notes/sync), Game
Library, Task Tracker. Each service is its own git repo under
`~/selfhost/<name>/` with its own `CLAUDE.md`/`GEMINI.md`,
`docker-compose.yml`, and (where publicly routed) an entry in
`~/selfhost/homepage/CLOUDFLARE_TUNNEL.md`.
