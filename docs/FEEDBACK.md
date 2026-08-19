# Community feedback — first public release

Source: `FEEDBACK.HTML`, a saved copy of the r/gachagaming thread
*"[PROMO] I made an event tracker for those playing multiple gacha games at the same time, to know
which events to prioritize."* — 26 comments from 15 accounts (20 comments from 14 readers, 6 replies
from OP). Read 2026-08-17, two days after the first Pages deploy.

Every quote below is from that thread. Every "what the code does today" note was checked against the
tree at `6fc3c0b`.

---

## The one-paragraph read

The idea landed and the execution did not get in the way: multiple people called it useful
unprompted, one bookmarked it, and **nobody questioned a single date** — which is the thing this
codebase spends most of its rules protecting. Two criticisms recur, and only two. First and loudest:
**the game list is too short to be someone's tracker.** Every reader who did not already play one of
the six covered games bounced off, politely. Second: **the visual design reads as unfinished**, and
one reader judged it from the screenshot alone and never opened the site. A third, narrower note is
already coming true — with two games selected the list is long enough to lose the point of the app.

Nobody asked for accounts, sync, or a login. Nobody complained about mobile. Nobody mentioned the
daily-checklist feature at all, in either direction.

---

## What works

**The premise is the product.** Four separate readers described the problem in the app's own terms
before saying anything about the app:

> "hmm this is actually what I need right now playing 4 games (3 hoyo + wuwa)."

> "It's helpful for me at least since I play so many games and looks like I have to catch up with
> some of them."

> "AI slop or not, this makes prioritizing across games much easier."

The cross-game-prioritisation framing needs no explaining to this audience. Keep it as the headline.

**Date accuracy drew zero complaints.** In 26 comments nobody said an end date was wrong, nobody
said an event was missing from a covered game, and nobody said a countdown looked off. For a
two-day-old scraper over six games that is the single best signal in the thread. The skip-never-guess
rule and the `endsAt: null` discipline are earning their keep — and this is also the thing that will
silently stop being true if the refresh pipeline stalls (see P0).

**No one asked for an account.** Not one reader asked to log in, sync across devices, or save to a
profile — including the reader juggling ten games, who asked for *customisation*, not sync. The
no-accounts constraint costs nothing with this audience.

**The AI-slop self-deprecation was forgiven, not shared.** Two readers went out of their way to say
it did not matter:

> "I don't typically like the way AI is used these days, but I've always thought it had the potential
> to actually help us out. This is one of those cases, thanks for this man."

That framing is a net negative to keep using, though — see P3.

**The reader who wanted a specific interface wanted the one that already exists.** Asked what would
improve the UI, the one reader who criticised the design answered "i really like paimon.moe timeline
for GI." That is a horizontal Gantt per game with today pinned — which is exactly
`src/client/components/Timeline.tsx`, already built, already the shape the PRD specifies as F1. The
feature is done. Its discoverability is not.

---

## What needs work, in priority order

### P0 — Confirm the live site is serving live data

**Why first:** the entire value proposition is that the dates are right *today*. Everything else in
this document is worthless if this is broken.

**What I can see:** `snapshots/` contains exactly one page — `endfield-wikigg-events.html` — against
seven registered sources in `src/ingest/adapters/index.ts`. Snapshots are tracked in git on purpose
(`snapshots/README.md`), and `scripts/build-feed.ts` falls back to `fixtures/` when a source has no
snapshot. So the deployed feed is being built from **pinned fixture bytes captured 2026-08-14** for
Genshin, HSR, ZZZ, WuWa, NTE and the Game8 Endfield source — five of six games. Those fixtures were
correct when captured; a patch cycle is six weeks, so they will start being wrong within days, and
they will be wrong *confidently*, which is the exact failure mode the PRD calls the one to prevent.

I cannot tell from a local checkout whether the six Game8 fetches are failing (robots check failing
closed, a 403, a template-mismatch throw) or simply have not committed a change yet. That is the
first thing to find out.

**Steps:**

1. Read the last few **Refresh sources** runs in Actions. The runner does not retry and fails closed
   on an unreadable `robots.txt`, so a systematic Game8 failure would be visible per source there.
2. `bun run refresh --dry-run` locally to see the plan and the robots verdict per source without
   making a request.
3. If Game8 is being refused, that is a scraping-conduct question before it is a code question —
   re-read `AGENTS.md` § Scraping conduct and decide, rather than working around it.
4. ~~Regardless of cause: surface it in the UI.~~ **Done.** The footer now states the data's age on
   every load rather than only when something is wrong — `freshness()` in `src/shared/feed.ts`, read
   by `Colophon.tsx`. Two things it settles, both of which were the "claiming more freshness than it
   has" worry in concrete form: the age comes from the newest `lastSuccessAt` and never from
   `generatedAt`, which is a build stamp that would call a fixture-backed calendar minutes old; and a
   game is only as fresh as its *oldest* source, so Endfield's live wiki cannot vouch for its stalled
   Game8 page. Lagging games are named rather than counted, because a count tells a reader nothing
   they can act on — except when every game is behind, which collapses to one sentence.
5. Add a CI assertion that fails the build when a source has neither a snapshot nor a fixture newer
   than N days. A silent fallback to stale bytes should not be able to deploy.

### P1 — Games: the only thing standing between this and daily use

**The signal.** This is not one comment, it is the shape of the whole thread.

> "Sadly I don't play any of those gacha games (despite juggling 10 games atm), will wait till more
> are added or we are able to customise it."

> "This is awesome, bookmarked it. Hope it gets some more games added, like Reverse: 1999."

> "Would there be option to add more games?"

Named across the thread, excluding the six already covered:

| Game | Mentions | Notes |
|---|---|---|
| Arknights | 2 | **`GameId`, hue and `dailyTasks` already exist in `games.ts` with no source registered.** Cheapest possible win. |
| Reverse: 1999 | 1 | Named as the one thing between a bookmark and a habit. |
| Azur Lane | 1 | OP judged doable |
| Blue Archive | 1 | OP judged doable. **Done** (2026-08-17) — `bluearchive.wiki`, not the Fandom wiki, which is a JP archive yielding nothing live |
| Umamusume | 1 | OP judged doable |
| Persona 5X | 1 | OP judged doable |
| Nikke | 1 | |
| Stella Sora | 1 | |
| Aether Gazer | 1 | |
| Chaos Zero Nightmare | 1 | |
| Girls' Frontline 2 | 1 | |
| Punishing: Gray Raven | 1 | |
| Guardian Tales | 1 | |
| Silver Palace | 1 | Unreleased — no schedule to scrape yet |

**Steps:**

1. **Arknights first.** Half the work is already committed: the `GameId` exists, so this is a
   `SOURCES` entry, a fixture, and a test — no schema change, which is the PRD's own test of whether
   the data model is right. It is also the most-named game in the thread.
2. Then work down the list **by source quality, not by mention count.** Prefer a page that publishes
   machine-readable timestamps: `wikigg.ts` exists and is the only reason `regionEnds` carries real
   data anywhere, so a wiki.gg or MediaWiki event page for a requested game is a `SOURCES` entry
   against an existing parser. A Game8 page is a second choice; anything image-only is not a source.
3. Use the **add-game-source** skill per game — it covers the ToS/robots check, fixture capture,
   registration and the test. One source per pass, verified against the live page, then commit.
4. Do not batch six games into one commit. Each adapter is a fixture and a test that has to prove
   itself; a bad one publishes wrong dates for a game nobody was asking to be wrong about.
5. Say the roadmap out loud in the app. A reader who does not see their game currently sees no reason
   to come back. A line in the colophon listing what is being worked on converts "will wait till more
   are added" into a return visit.

### P1 — The list gets long fast, and the default view should not be the long one

**The signal.** The most specific, most actionable comment in the thread:

> "I just selected Genshin and ZZZ and the list became really long. Once more games are in it's going
> to be a problem to try and focus in one specific game even with the filters. I feel it would be
> easier in the eyes if the current interface became a sort of 'Detailed' list view while the default
> interface focused on the three next closest events to their deadlines and it's on the user to check
> out these so they get filtered out as the player finish them."

**He is measurably right.** Genshin's fixture holds 9 events and ZZZ's 12 — 21 rows for the
two-game case he tried, out of ~50 across six games. Doubling the game count doubles that.

**What the code does today.** More of this is built than the comment assumes, which is good news:

- `NextUp.tsx` already singles out the next event to expire — but exactly **one**, where he asked
  for three.
- `GameFocus.tsx` (shipped 2026-08-16, after the thread) is precisely the "focus one specific game"
  control he predicted needing.
- `outstanding()` in `state/lens.ts` already drops done and ignored events from the instruction
  surfaces, which is the "they get filtered out as the player finish them" half.

So this is a **default and framing problem**, not a missing-feature problem.

**Steps:**

1. Widen `NextUp` from one row to the next **three** outstanding deadlines. Keep it fed by
   `outstanding` + `firstToExpire`'s ordering so it never points at finished work, and keep reading
   the minimum end date rather than the head of the list — under "doing first" those differ.
2. Cap the "Running now" section at a handful of rows with an explicit "show all N" expander, rather
   than rendering 21. Grouping stays as-is; this is truncation of the view, not a re-sort, so the
   deadline-order guarantee in `AGENTS.md` § Conventions is untouched.
3. **Persist the view.** `const [view, setView] = useState<View>("soon")` in `App.tsx:68` is
   component state, so every reload throws the reader back to the list even if they chose the
   timeline last time. It belongs in `prefs` next to `sort` and `focusGame`.
4. Adopt his vocabulary. "Detailed" is a better name for the full list than the current split
   implies, and it tells the reader the short view is the intended one.

### P2 — The visual design is the only thing anyone criticised

**The signal.**

> "but from the screenshot the UI looks very bad :("

> "probably the colour or design style. It's true that I wasn't able to check out the whole site and
> only judged from the screenshot (as I said in the beginning)."

Two things are true at once here: it is one person's opinion, and it was formed **entirely from the
promo screenshot** — the reader said so twice. That makes it partly a first-impression problem you
control completely, and it cost a visit from someone who was otherwise the exact target user.

**Steps:**

1. **Rename the "Calendar" tab to "Timeline."** The one reader who told you what good looks like
   named paimon.moe's timeline, and OP had to *ask* him whether he had found the view — "Have you
   checked out the calender view? :)" A reader hunting for a timeline does not read "Calendar" as
   one, and the tabs are 12px text in the top-right corner.
2. **Consider making the timeline the default view.** `docs/PRD.md` F1 specifies the calendar view as
   the default; the shipped app defaults to `"soon"`. The timeline is also the better screenshot and
   the thing that reads as "designed" rather than "a list." If P1's three-deadline view lands, that
   becomes a genuine three-way call — decide it deliberately rather than by inheritance.
3. **Reshoot the promo screenshot** before the next post: timeline view, three or four games with
   overlapping bars, today's rule visible. The current one apparently showed the dense list.
4. Take one focused pass on colour. The palette carries two orthogonal axes on purpose — game hue
   (`games.ts`) and urgency (`time.ts` / `URGENCY_COLOR`) — and seven saturated hues next to three
   urgency colours is where "AI-generated default" reads from. The **frontend-design** skill is the
   right tool; the constraint to hand it is that the two axes must stay separable at a glance,
   because that separation is what lets one look answer both "whose event is this?" and "how long
   have I got?"
5. Do not rebuild the interface. One person disliked the colours from a screenshot; several others
   used the app and said it was helpful. This is a polish pass, not a rewrite.

### P2 — Custom events and custom games: the tail no adapter list will ever cover

**The signal.** Asked twice, independently, and it is the *only* feature request from the reader with
the largest collection of games:

> "Or can you add a custom game option, we can input out own event description and time frames?"

> "will wait till more are added **or we are able to customise it**"

Fourteen games were named in one thread. No feasible adapter set covers a ten-game juggler, so this
is the feature that makes the app usable for readers you will never scrape for — and it needs no
scraping, no ToS question, and no server.

**Steps, and the constraints they must respect:**

1. Store user-authored events in `localStorage` alongside `progress` / `daily` / `ignored`, and add
   them to `exportProgress` — a backup that silently omits hand-entered events is a lossy backup, the
   same argument the code already makes for streaks.
2. **Never mint a user event's ID the standard way.** `${game}:${slug}:${date}` and `dailies:<game>`
   are live key spaces and a collision corrupts real marks. Give user events their own prefix, and
   run the **schema-guardian** agent on the change — this is exactly the class of change
   `AGENTS.md` § Event IDs flags.
3. **Mark provenance in the UI.** A hand-entered date must be visibly the reader's own, never
   attributed to a source, and must not flow into merge or sanitisation. The trust boundary at
   `src/ingest/sanitize.ts` is for pages we do not control; this is a different path entirely.
4. A custom *game* needs a name and a colour but no adapter, and must not appear as a scraped game
   with an empty feed. Note that `games` in `App.tsx:154` is derived from feed rows, so a custom game
   needs threading through deliberately rather than added to `GAMES`.
5. This is currently **out of scope in `docs/PRD.md`** ("user-submitted events"). The thread is an
   argument to change that decision — make the change in the PRD first, with the reasoning, rather
   than letting the code drift from the spec.

### P3 — Smaller notes worth acting on

- **Drop the "AI-SLOP" framing from the next post.** It was volunteered, not extracted — and the one
  criticism the thread produced was about visual polish, which is precisely what that framing invites
  a reader to look for. The one reader who criticised the design judged the screenshot harshly
  having been told in advance it was slop. The work stands on its own.
- **A non-English reader turned up on day one.** "Por fin algo que de verdad me sirve" — *finally
  something that's actually useful to me*. Localisation is explicitly out of scope in the PRD and
  should stay there for now; note only that dates and countdowns already localise through `Intl`, so
  the copy is the whole cost when it becomes worth paying.
- **The "catching up" reader is a real second use case, but do not build for it yet.** Three readers
  described being behind rather than being busy: "I have to catch up with some of them,"
  "I haven't touched Wuwa, zzz, HSR and arknights in a long time," and a third reader's plan to play
  one gacha in concentrated bursts. The `status` ("partway through") and `effort` fields plus the
  "doing first" sort already serve this. Resist adding a "you haven't played X in N days" nudge:
  `AGENTS.md` draws a hard line between what the app *shows* and what it *tells you to do*, and
  nagging someone about a game they consciously dropped is the app arguing with them.
- **The daily-checklist feature got no signal at all** — not one comment, positive or negative, in 26.
  It shipped detection-off and experimental two days ago, which is the right posture. Do not invest
  further until someone mentions it; one reader's alternative was a notepad
  ("while i simply put mine in a notepad. i'm playing 6 games").

---

## Suggested order of work

1. **P0** — diagnose the refresh pipeline; make stale data loud and un-deployable. *Hours.*
2. **P1a** — Arknights adapter (`GameId` already exists). *One pass of `add-game-source`.*
3. **P1b** — three deadlines in `NextUp`, cap the long list, persist `view`, rename Calendar →
   Timeline. *Small, all in the client, all directly requested.*
4. **P1c** — two or three more games, best-source-first, one commit each. Publish the roadmap in the
   colophon.
5. **P2** — colour and screenshot pass; then decide the default view deliberately.
6. **P2** — custom events, starting with the PRD decision and a schema-guardian review.

Everything in P0 and P1b is a change to code that already exists. That is the cheapest half of this
list and it addresses the two loudest complaints in the thread.

### Where that list stands (2026-08-17)

The thread reading above is fixed at the date it was made; this is the only part that moves. The
diagnosis in each item still holds — what changed is whether it has been acted on.

| Item | Status |
|---|---|
| P0 refresh pipeline | **Diagnosed, half acted on.** game8.co answers a GitHub Actions runner with `202` and a bot-management body, so those eight sources have only ever built from fixtures in CI — see `AGENTS.md` § Scraping conduct, including why it is not to be worked around. The `broken` tier now makes a source failing three cycles fail the run. Step 5 (a build assertion on snapshot age) is **not built** |
| P1a Arknights | **Done.** `arknights-akwiki-events`, via the new `akwiki` parser |
| P1b `NextUp` → three | **Done** (2026-08-18). One headline and two behind it, off `nextToExpire` |
| P1b cap the long list | **Done** (2026-08-18). Both sections cap at six with "show all N" — truncation of the view, not a re-sort |
| P1b persist `view` | **Done** (2026-08-18). `prefs.view`, and the first run now asks which one to open on (PRD F8) |
| P1b Calendar → Timeline | **Done.** The tab reads "Timeline" |
| P1c more games | **Done, ten of them, and one rebuilt.** Infinity Nikki, Persona 5: The Phantom X, Reverse: 1999, Blue Archive, then Fate/Grand Order and hololive Dreams, then Girls' Frontline 2, Stella Sora, Chaos Zero Nightmare, Umamusume and Nikke (2026-08-19). Of the games named in this thread, **Umamusume is now built** — via Game8, not the declined `uma.moe` — and Azur Lane and Aether Gazer stay declined. **Nikke is built too** (2026-08-19), once its `robots.txt` was read in a browser and turned out to be the standard Fandom file. See `docs/SOURCES.md` § 3. **Infinity Nikki was rebuilt** on a live Fandom source the same day, its Game8 page having been stale since August 2025 — § 11 |
| P1c roadmap in the colophon | **Not done** |
| P1 games still unserved | Azur Lane, Punishing: Gray Raven, Guardian Tales, Aether Gazer (shutting down), Silver Palace (unreleased). Separately, **Infinity Nikki's source is stale** and has no reachable replacement — `docs/SOURCES.md` § 11 |
| P2 colour and screenshot | **Layout done** (2026-08-18), colour untouched. The palette was left alone deliberately — the two-axis system was not what made the screenshot read as unfinished, a dense single column on a wide screen was. Past `lg` the page is now a pinned deadline rail beside the lists, the timeline is a board with its axis and names pinned, and the footer and settings are columns. The screenshot still wants reshooting |
| P2 custom events | **Done.** PRD F13 first, then the code; `mygame:` / `myevent:` key spaces, in the export |

So the outstanding work is the colophon roadmap, P0's build assertion, and a reshoot of the promo
screenshot. P1b is closed. The colour pass is open in name only: the palette was examined and left
alone with the reasoning above, so what is left of P2 is the screenshot, which is now worth taking
from a wide window.
