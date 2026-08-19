# Gacha Event Tracker — Product Spec

## The problem

A player of three or four gacha games is tracking a dozen concurrent, overlapping, time-boxed
events across as many different in-game calendars. The information exists — on wikis, in patch
notes, in-game — but never in one place and never sorted by the thing that actually matters:
**what expires next.** The failure mode is missing a limited event by a day.

## What this app is

A single-page web app that answers three questions:

1. What is running right now, across all my games?
2. What ends soonest?
3. Which of these have I already finished?

## What this app is not

- Not an account system. There is no login, no profile, no cloud sync.
- Not a wiki. It does not explain how to complete an event, only that it exists and when it ends.
- Not a notification service. No push, no email, no background alerts. (A browser-local reminder
  is a plausible v2; it is out of scope for v1.) F14 is not an exception to this: it is the open page
  disclosing something about *itself*, in the tab, while the reader is looking at it — nothing is
  delivered anywhere, and the app is never told to wake anybody up.
- Not a damage calculator, build planner, or pull tracker.

## Users

One persona: a player of 2–5 gacha games who checks in a few times a week, most often on mobile.

Most often is not only, and the desktop layout is not the phone layout stretched. Past `lg` the page
splits: what it is *telling* the reader to do — the next deadlines, tonight's dailies — pins to a
rail on the left and stays put, while the lists it is *showing* them scroll beside it. The focus bar
(F4a) rides at the top of that rail, because it narrows what is in it. Below that breakpoint the same
split produces the same answer in one column: instructions first.
They care about accuracy of end dates above everything else — a wrong date is worse than a missing
event, because a missing event sends them to a wiki while a wrong one makes them miss content.

## Scope — v1

### Games at launch

| Game | ID |
|---|---|
| Genshin Impact | `genshin` |
| Honkai: Star Rail | `hsr` |
| Zenless Zone Zero | `zzz` |
| Wuthering Waves | `wuwa` |
| Arknights | `arknights` |
| Arknights: Endfield | `endfield` |
| Neverness to Everness | `nte` |

Added since launch, on the strength of the release thread (`docs/FEEDBACK.md` § P1): Infinity Nikki
(`nikki`), Persona 5: The Phantom X (`p5x`), Reverse: 1999 (`r1999`), Blue Archive (`ba`),
Fate/Grand Order (`fgo`), hololive Dreams (`holodori`).
**`GameId` in `src/shared/schema.ts` is the live answer** and `SOURCES` says which of them actually
have a source — this table is the launch scope, not a roster to keep in sync.

Adding a game must require no change to `GachaEvent` — only a `GameId` entry, its `games.ts`
metadata, and a source registration. That is the test of whether the data model is right, and it has
held: the eighteen games here have cost the event schema nothing. Per-game *metadata* does occasionally
grow (Reverse: 1999 needed `resetHourLocal` for a 05:00 reset), which is a different file and moves
no stored key. A game may have several sources; see `docs/INGESTION.md` § Three layers.

### Features

**F1 — Timeline view.**
A horizontal timeline, by default one lane per game, spanning a scrollable date range with "today"
pinned as a vertical marker. Each event is a bar from `startsAt` to `endsAt`. Bars are colored by game, and
completed events render at reduced opacity with a check. Clicking a bar opens a detail panel with
title, type, exact start/end in the user's local timezone, source link, and a completion toggle.

An event with `endsAt: null` renders as a bar with a frayed right edge and the label "end date
unknown" — it must be visually distinct from an event that ends far in the future.

It is a board rather than a stretch of page: its own pane, scrolling in both directions, with the
date axis pinned to the top and every name — the lane's and the event's — pinned to the left.
Those three used to scroll away together, which made a wide window worse rather than better: more
calendar on screen, and nothing left saying which day, whose game, or which event was being read. A
six-week bar starts weeks off-screen, so a name that rides off with its own start date leaves a
coloured rectangle behind.

**The reader chooses how it stacks.** Lanes keep a game's events adjacent and comparable, which is
what makes the board readable for someone playing four of them — but that reader also has one queue
of deadlines, and lanes scatter it: what ends tonight sits three lanes below what ends next month,
and no scroll position puts them side by side. So a pair of pills in the board's header switches
between **By game** and **Ending soonest**, and the choice is remembered (`prefs.timelineGroup`,
default `"game"` — the board every existing reader already has). Merged, the order is
`endingSoonestFirst`, the same comparator behind the list's "Ending soonest" (F2), so the two views
cannot mean different things by the same words and an unannounced end still sorts behind every dated
one rather than claiming a place in the queue. Merged there is also no lane heading to say whose
event a bar is, and hue alone cannot answer that once eighteen games share a stack — so each bar
carries its game's short name, with the full name in its tooltip. A bar too narrow for a tag and a
title both keeps the title: a chopped game name reads as a broken word, and the hue and the tooltip
still answer it.

**The reader sets the scale.** A patch cycle is six weeks and a login campaign can run for months,
so no single density answers both "what am I in the middle of this week?" and "how do the next three
months line up?". A pair of controls steps through a ladder of day widths, and the choice is
remembered (`prefs.timelineDayWidth`) — the same argument as the view tabs: a reader who has said how
they want to read this should not have to say it again on the next load. Two things it has to get
right. Zooming holds the middle of the view still, because rescaling around the left edge of a
three-month board throws away whatever the reader had scrolled to. And the dated ticks thin out as
the scale shrinks, since a week is 42px at the widest setting and the dates would sit on top of one
another; the gridlines stay weekly either way, because they carry the rhythm rather than the reading.

The close end of the ladder goes to a day being wider than a fingertip (108px). That is not a
flourish: events routinely end within a day of each other, and at a scale where their bar ends are a
few pixels apart the board is being asked the one question it exists to answer and telling the
reader to squint. It also gives a one-day event a bar to read and to tap rather than the 34px
minimum every short bar collapses to.

**What has not started yet is off by default, and the reader can switch it on** — `prefs.showUpcoming`,
which governs **both views**: the board plots them, and the checklist keeps its "Not started yet"
section (F2). One question, asked once, because they are the same events. It defaults to `false`
because this app answers *what expires next*, and a reader with fourteen lanes has a next patch
queued behind every one of them.

On the board that is structural as well as editorial: the window is drawn from what is plotted, so
showing the future stretches the right edge weeks past today and squeezes the running bars the
reader came for down to nothing.

**Held back is never merely absent.** A section that simply is not there is indistinguishable from a
quiet fortnight, and this app does not leave a reader to infer what it is not showing them. So the
page header states `N live · N upcoming` whatever the setting says, and either view left with
nothing to show says so in words and names the setting rather than rendering an empty column.

The switch is in settings (F4), with the two other answers to *what am I allowed to look at* —
`showCompleted` and `showIgnored` — and **not** in the board's own header beside the stacking and
scale controls. That is the line those two draw: they reshape what is already on the board, which is
why they are reached for while reading it, and this one decides what is on it at all.

**Switched on, the board says in words where they begin.** A bar drawn to the right of the "now"
rule is only *implicitly* in the future, and implicitly is not a standard this product holds itself
to anywhere else a date is involved. Gacha schedules are not a smooth stream of start dates either —
a game ships a patch and six things open at once — so the honest unit is the clump: a dashed rule at
each group of starts, labelled `5 start Aug 24–Aug 27`, in its own band under the `now` chip. Two
clumps that land within a label's width of each other merge and the label states the span it covers,
rather than claiming one date the board is not ruling at. The bars themselves take a dashed left
edge and a thinner wash of their game's hue, so what is running and what is merely scheduled
separate at a glance without reading a single date.

**And the boundary itself is named.** A dashed edge says *this bar* has not started; it does not say
where the running ones stopped, and a board read at a glance should not have to be decoded bar by
bar to answer the question the reader opened it with. So the line between the two gets a label —
`Not started yet`, the same object as a lane's name: a small eyebrow pinned to the left edge, in
muted ink rather than a hue, since a hue on this board means *whose event is this*. One per lane,
because "where does this stop running?" is a different answer for each of them.

**Two readings of that board, and the reader picks** — the board's alone, since the checklist splits
these into a section with a heading of its own either way (`prefs.timelineSplitUpcoming`, default
`true` — the board as it was before the choice existed). Split keeps the unstarted events in their
own block under that heading, and answers "what is on now, and what is queued behind it" — the shape
of a patch. **Mixed in** drops the block for one deadline order, started or not, and answers "what
runs out first", which is the question a Gantt chart is for: an event opening on Friday and closing
on Sunday is a nearer deadline than one running now until October, and the split order can never
show it. Mixed is therefore *not* the heading switched off — every order this board can be handed
holds unstarted rows behind running ones, so dropping the label alone would leave the same block
with nothing explaining it. `timelineLanes` re-sorts on `byDeadline`, which is `endingSoonestFirst`
with exactly that clause removed, and it is the one case where lane mode is allowed to reorder
inside a lane.

**The board draws at most two months of past.** A standing login campaign can have been running for
half a year, and drawing from the earliest start bought months of empty calendar that nobody scrolls
back through and that pushed every other bar off to the right. An event older than the board keeps
its faded left edge rather than being redrawn as though it started at the edge — the same honesty
the frayed right edge carries for an unannounced end.

**F2 — Checklist (the ends-soonest list).**
A flat list of all *currently running* events sorted ascending by end date, with a relative
countdown ("ends in 2 days", "ends in 4 hours"). Under 24 hours, the row is emphasized. This is the
view that justifies the app, and it is one tap from the timeline.

**"Not started yet" is a second section, and it is off by default** (`prefs.showUpcoming`, F1 — the
same switch the board reads). Running events are the list's whole claim; what has not opened is
context, and on fourteen lanes it is more rows than the thing the reader came for. Split into its
own section rather than mixed into the order, because that is what the list *is*: a queue of jobs
you can do now, and one you cannot do yet does not belong among them. The board offers the mixed
reading instead, where a nearer deadline genuinely is a nearer deadline (F1).

The tab reads **Checklist**, which is what a reader with four games is doing with it: working down a
list of jobs with deadlines. Its stored id stays `"soon"` — that value is in `prefs.view` on real
devices, and renaming a label must never move a reader to the other view.

**Which view opens is the reader's answer, not ours.** This spec said "calendar (default)" and the
app shipped opening on the list; both were a decision made on the reader's behalf and then forgotten
on every reload. So the first run asks (F8) and the answer is stored in `prefs.view`. The list is
what the question ships pre-answered with — a reader cannot choose between two layouts they have
not seen, and it is the view that answers "what expires next" in one look.

**The list is capped and offers the rest.** Two games already run to twenty-one live events, and a
reader who tried exactly that said the list stopped being usable. Each section shows a handful with
an explicit "show all N". This truncates the *view* only: the order is untouched, and the rows below
the cut are still counted in the header, still on the timeline, and one tap away.

**F3 — Mark completed.**
A toggle on every event, in both views. State is written to `localStorage` immediately and
optimistically — there is no server round trip and no failure case. Completed events stay visible
but de-emphasized; a filter toggles them out entirely.

**F4 — Filters.**
Filter by game (multi-select, persisted) and by event type. Hiding a game hides it from both views.
Preferences persist in `localStorage`.

**F4a — Focus one game at a time.**
Switching games on and off says *which games the reader plays*, and is set once. It is the wrong
tool for the thing a player of four games actually does while reading: clear one game, move to the
next. Doing that with the on/off switches costs two taps per game and leaves the settings panel no
longer describing what they play.

So focus is a **lens over the filter, not a second filter**: a bar above everything it affects,
narrowing every view — headline, dailies, lists, calendar and counts — to one game, with a "next
game" control that steps through them and ends by returning to all. "Above everything it affects" is
the top of the page on a phone and on the timeline, and past `lg` it is the top of the checklist's
rail: there the bar pins with the deadlines and dailies it narrows, rather than spending the full
width of a wide screen on a row of chips and pushing "next to expire" — the answer the reader opened
the page for — below the fold to make room. It never
changes `hiddenGames`, "All" is always one tap away, and a focus on a game that is switched off or
has left the feed is ignored rather than obeyed, so it can never strand the reader on a blank page
whose cause is elsewhere. Each chip carries that game's outstanding count, so a game with nothing
waiting says so before it is visited.

**F5 — Region selection.**
A user picks Asia / America / Europe once. For events where `regionScoped` is true, all displayed
end times resolve to that region's server reset. This is stored in `localStorage` and defaults to a
guess from the browser timezone, shown as a dismissible "showing America server times — change".

**F6 — Export / import.**
Because there are no accounts, moving between devices is manual: download a JSON file of completed
IDs and preferences, upload it elsewhere. Import merges rather than replaces, and never removes a
completion the user already has.

**F12 — Record your own progress and effort.**
Three states, not two: untouched, doing it, done. Plus an optional effort estimate — quick, short,
long, grind — and a free-text note.

Three states need three targets. A single control cycling untouched → doing → done makes a button
labelled "Mark done" produce "doing it", which is the control lying about itself; the detail sheet
has an explicit control per state, and its primary action goes straight to done and back.

Effort is not decoration. Combined with the time remaining it answers the question the calendar
can't: *can I still finish this?* The same two days is comfortable for a quick event and hopeless
for a grind, so an event carrying an effort estimate gets a "tight" or "running out of time" flag
when the remaining time no longer covers it.

The heuristic assumes about an hour of play a day and says so. It never hides or reorders anything —
it adds a flag the reader can ignore. **An event with no recorded effort never gets a warning**,
because inferring an estimate in order to warn about it would be fabricating their input.

**F13 — Your own games and your own events.**
No feasible adapter set covers everyone. Fourteen games were named in the first release thread and
the reader with the largest collection asked for exactly one thing — *"can you add a custom game
option, we can input our own event description and time frames?"* — and, separately, said they would
wait until "more are added **or we are able to customise it**." That is the tail no source list
reaches, and it needs no scraping, no ToS question and no server.

So a reader can define a game (a name and a lane colour) and enter events against it, or against a
game the app already tracks when a source missed something. Their events sit in the same lists,
timeline, sort and filters as scraped ones, and everything they can do to a scraped event — done,
doing, effort, note, ignore, daily checklist — works identically.

Four constraints, each protecting something that already exists:

- **Their events are visibly theirs.** A hand-entered date is never attributed to a source and never
  carries a source link. The reader must be able to tell, at a glance, which dates the app went and
  found and which ones they typed.
- **Their events never touch the ingest pipeline.** `sanitize.ts` and `merge.ts` exist for pages we
  do not control; a reader's own typing is neither untrusted markup nor a second opinion to
  reconcile. Nothing they enter is fetched, parsed, merged, scored or quarantined.
- **Their IDs live in their own key space.** Never `${game}:${slug}:${date}` — see
  `docs/DATA-MODEL.md` § Reader-authored key spaces.
- **They are in the backup.** An export that omitted hand-entered events would be a lossy backup,
  which is the same argument the code already makes for streaks. This is the *only* copy — there is
  no server to restore from.

**F8 — First-run setup.**
Before any events are shown, the reader picks which games they play, and how they want to read
them. A calendar full of games they
don't play is worse than an empty one — it buries the thing they came for. Nothing is preselected
and the button stays disabled until something is chosen; guessing on their behalf and hoping they
notice is worse than asking. The choice is stored as *hidden* games, the inverse — which is a storage
shape, not a policy: what happens to a game added later is decided separately, below.

**A game added later arrives switched off.** Adding a source is our decision, not the reader's, and
someone who plays two games did not ask for the other twelve; a calendar that fills itself up is the
thing this screen exists to prevent. `prefs.knownGames` records every lane a reader has been offered,
and a lane missing from it is recorded and hidden on sight. The games chips in settings list every
lane, on or off, which is where they take a new one up — and the cost of this is real and worth
stating: a reader whose game finally arrives is not told, so the roadmap line in the colophon
(`docs/FEEDBACK.md` P1c) matters more, not less.

An absent `knownGames` means *unrecorded*, never *offered nothing* — every reader who installed
before it existed is in that state, and reading it the other way would switch off every game they
already read. The first pass records what is already on their screen and changes nothing else.
Lanes the reader invented (`mygame:`) are recorded but never hidden: typing a game in is asking for
it.

The view question (F2) sits under it, with each option drawn rather than only described — the words
"list" and "timeline" mean nothing until you have seen this app's version of them. Unlike the games,
it arrives already answered, and the screen says where to change it afterwards: the tabs are small
text in a corner, which is the one control a first-time reader will not find on their own.

**F9 — Ignore an event.**
Distinct from completing one. "Done" keeps an event visible and counted; "not interested" removes it
from both views entirely. Ignored events stay recoverable: a count and a reveal toggle appear in
settings once there is something to reveal.

**F10 — Works offline.**
The reader's question is answered entirely by data already on the device, and countdowns run off the
local clock, so losing signal should not lose the app. A service worker caches the shell and serves
the last feed it downloaded. Offline is disclosed in the header and above the footer — see F7; stale
data must never be presented as current.

**F11 — Credit and disclaimer.**
The sources that compile these calendars, and the studios that make the games, are named on the same
screen as the data rather than one navigation step away. The page states plainly that it is
unofficial and unaffiliated, and that the source page is the authority when the two disagree.

**F14 — Say when a new version of the app is ready.**
F10 caches the shell so the app survives losing signal, and the same cache is why a reader who never
closes the tab keeps running the version they first loaded. A new game, a repaired parser or a
corrected date then reaches their device and sits there unused, with the page looking unchanged and
nothing saying why. **Presenting an old app as current is the same failure as presenting old events
as current** (F7), so it is disclosed the same way: a notice on any screen, with one action that
reloads into the new version.

It is an offer, not a swap. The app never reloads itself — doing so mid-sentence while someone types
in their own event (F13) would cost them work to save the app a tap. It says what a reload costs
(their place on the page) and what it does not (everything they have marked, typed or ticked lives in
`localStorage`, not in the bundle). Dismissing is free and the offer returns on the next load, which
is also why it need not nag.

A first install is not an update and is not announced — nothing is being replaced, and telling a
first-time reader a new version is available would be false. Neither is a feed refresh: new events
arrive without a reload, and calling that a new version would train readers to dismiss the notice
unread.

**F7 — Freshness disclosure.**
The footer shows when the feed was last updated, per game. If a game's data is more than 48 hours
stale, its lane carries a warning badge. Never present stale data as current — the whole value
proposition is trust in the dates.

**F15 — Light mode, with dark still the default.**
The app is a lit instrument panel and that is what it should be on first sight, but it is also read
on a train in daylight and by people who find a dark UI harder rather than moodier. A public fork
worked a theme toggle out first and is credited for the idea in the colophon. So the ground is
the reader's choice: **Dark**, **Light**, or **System** to follow the device, in settings next to the
region — both are "how do I read this?" and neither changes what the page knows.

Dark is what it ships as, and deliberately not `System`. A reader whose laptop is in light mode has
said something about their laptop, not about this page; defaulting to the device would also move
every existing reader the first time they loaded a build that had this, which is the `knownGames`
mistake in a different costume (F8). Choosing `System` is one tap, and from then on it *is* their
answer.

Three things the light theme has to get right, because they are what a second palette usually gets
wrong:

- **It is a re-strike, not an inversion.** Every colour in the UI is a token, and light redefines the
  tokens rather than adding a second set of rules to components. Nothing in the app asks which theme
  it is in, so a new component cannot forget to support one.
- **Urgency still reads.** The heat ramp carries meaning, and the dark theme's amber is 1.9:1 on
  paper — an urgency the reader cannot read is not urgency. Every step is re-struck to clear 4.5:1
  against the light ground, keeping its order and its meaning.
- **A game keeps its colour.** The hues are identity (F1) and were all picked against a near-black
  ground; on paper the bright ones vanish. They are darkened until they read, along the same hue, so
  Wuthering Waves is still the green one — including the hues a reader picked for a game they
  invented (F13).

Switching is instant, costs nothing and saves nothing: no reload, and nothing marked, typed or
ticked is touched. And it survives the load it is chosen on — the shell sets the theme before first
paint, so a reader on light is never shown a dark page while the bundle downloads.

## Out of scope for v1

Accounts and sync; push notifications; in-game resource or pull tracking; native mobile apps (the
web app installs to a home screen, which is enough); localization beyond English.

Two entries left this list after v1 shipped and readers used it. Per-event checklists became F12 and
the daily strip; **user-submitted events became F13**, on the strength of the release thread — the
reader juggling ten games asked for it twice and asked for nothing else, and no adapter roadmap
answers them. The decision is recorded here rather than left implicit in the code.

## Success criteria

- A user can identify their next expiring event within **5 seconds** of load, on mobile.
- Published end dates are correct for **99%+** of events. This is a data-quality target, and it is
  what the review gate in `docs/INGESTION.md` exists to protect. Prefer publishing nothing to
  publishing a guess.
- Adding a new game is an adapter plus a fixture plus a test — no schema migration, no client
  change.

## Quality bar for dates — the core product rule

The app's entire value is that the dates are right. Therefore:

- An event with an uncertain end date is published with `endsAt: null`, **not** with a plausible
  guess.
- An event whose confidence is below threshold, or whose sources disagree, is not published at all
  until a human approves it.
- Every event links to its source so a skeptical user can verify in one click.
- **A date with no time is resolved on the game's clock, never on UTC's.** Most sources print
  "August 19, 2026" and no time of day, which is stored as 00:00Z — a placeholder, not an instant.
  The countdown reads it as that game-day's server reset for the reader's region, because a literal
  reading retires an event up to nine hours before the game does and the reader is standing in the
  game while we say it. This is a reading of the date the source printed, not a time invented for
  it, and the detail sheet says as much.

An empty calendar is a recoverable disappointment. A confidently wrong end date is the failure this
product exists to prevent.

## Open questions

- Does the calendar need a month/grid view, or is the timeline enough? (Assumption: timeline is
  enough for v1; revisit after use.)
- Should an ignored event still count toward the "N live" header total? (Assumption: no — ignoring
  means gone.)
- Should events the user has hidden by game filter still count toward "ends soonest"?
  (Assumption: no — the filter is global.)
- Is 6 hours the right refresh cadence? (Assumption: yes; events are announced days ahead, so
  sub-hourly refresh buys nothing and is rude to the sources.)
