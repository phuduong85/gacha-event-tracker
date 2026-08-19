import type { DisplayEvent, LaneId } from "./custom.ts";
import { GAMES } from "./games.ts";
import { Region } from "./schema.ts";
import type { GameId, Precision } from "./schema.ts";

/**
 * Time is this product's entire subject, so the vocabulary lives in one place:
 * how long is left, how far through a window we are, and how alarmed to be.
 */

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/**
 * Server reset offsets from UTC. Gacha regions reset at 04:00 local, which lands
 * on different UTC instants — collapsing them loses up to 13 hours of accuracy.
 */
export const REGION_RESET_UTC_OFFSET: Record<Region, number> = {
  asia: 8, // UTC+8
  america: -5,
};

/**
 * No `europe` region: every game in this fork that ever distinguished it
 * (Endfield, Reverse: 1999) already resolved it to the exact same instant as
 * `america` — see `games.ts` § resetOffsets — so a timezone in Europe's range
 * lands on `america` here too rather than on a region with no distinct
 * behavior of its own.
 */

/** What a region is called when the reader is shown one. */
export const REGION_LABEL: Record<Region, string> = {
  america: "America",
  asia: "Asia",
};

/**
 * Gacha servers roll the day at 04:00 local server time, not midnight — a
 * player finishing at 02:00 is still on the previous day's dailies. Getting
 * this wrong ticks the wrong box for four hours every night.
 */
export const RESET_HOUR_LOCAL = 4;

/**
 * The UTC offset of the server clock a reader's day rolls on.
 *
 * The reader's region is always the question; a game can just answer it
 * differently. Most run a server per region and take the default. A game that
 * runs one worldwide server on a fixed offset lists every region it differs
 * from in `resetOffsets` — Reverse: 1999 runs one server on UTC-5, so both
 * `asia` and `america` resolve to UTC-5 there rather than to their own
 * regional defaults.
 *
 * A blanket per-game offset would be the wrong shape: it would drag the regions
 * that *do* have their own server onto somebody else's clock, which is a
 * different bug in the same place.
 */
export function serverOffsetUtc(region: Region, game?: LaneId): number {
  // A lane the reader invented (PRD F13) has no server map to know about, and
  // neither does an id that has outlived its game, so both take the regional
  // default rather than being looked up and crashing.
  const override =
    game === undefined ? undefined : GAMES[game as GameId]?.resetOffsets?.[region];
  return override ?? REGION_RESET_UTC_OFFSET[region];
}

/**
 * The hour of its own server day a game rolls over on.
 *
 * Almost always `RESET_HOUR_LOCAL`. A game that resets on a different hour says
 * so in `resetHourLocal` (`games.ts`) — Reverse: 1999 rolls at 05:00 — and that
 * cannot be folded into `serverOffsetUtc`: shifting a game's stated offset to
 * land the right reset instant would misreport the server clock to everything
 * else that asks for it.
 *
 * A lane the reader invented has no server to know about and takes the default,
 * for the same reason `serverOffsetUtc` does.
 */
export function resetHourFor(game?: LaneId): number {
  const override =
    game === undefined ? undefined : GAMES[game as GameId]?.resetHourLocal;
  return override ?? RESET_HOUR_LOCAL;
}

/**
 * Offset from UTC midnight to this game's reset instant.
 *
 * `dayKey` and everything downstream of it is a **localStorage key**. Moving the
 * reset hour, a region offset, or a game's own override re-labels the game-day
 * some already-logged ticks fall in — at most by one day, and never by deleting
 * one, but it is still the reader's streak moving under them. Treat a change
 * here as a data change, not a constant.
 */
export function resetShiftMs(region: Region, game?: LaneId): number {
  return serverOffsetUtc(region, game) * HOUR - resetHourFor(game) * HOUR;
}

/**
 * The instant the game-day labelled `day` (`YYYY-MM-DD`) opens on — the inverse
 * of `dayKey`.
 */
export function dayStartMs(day: string, region: Region, game?: LaneId): number {
  return Date.parse(`${day}T00:00:00.000Z`) - resetShiftMs(region, game);
}

export function guessRegion(
  timeZoneOffsetMinutes: number = -new Date().getTimezoneOffset(),
): Region {
  const hours = timeZoneOffsetMinutes / 60;
  if (hours >= 5) return "asia";
  return "america";
}

/**
 * The boundary fields these helpers read.
 *
 * Structural rather than `GachaEvent` so a reader's own event (PRD F13) runs on
 * exactly the same clock as a scraped one — there is no second countdown
 * implementation to keep honest.
 */
export type EndBearing = Pick<
  DisplayEvent,
  "endsAt" | "endPrecision" | "regionScoped" | "regionEnds"
>;

/**
 * The end to show this user, honouring a region-scoped event, with the
 * precision that boundary was actually stated to.
 *
 * A `regionEnds` value is read as `exact` whatever `endPrecision` says about the
 * fallback: the map only exists because the source published a timer per server
 * (wiki.gg does; see AGENTS.md § Working on parsers), so there is a real instant
 * in it and nothing left to resolve.
 */
function endBoundary(
  event: EndBearing,
  region: Region,
): { iso: string; precision: Precision } | null {
  const stated =
    event.regionScoped && event.regionEnds !== null
      ? event.regionEnds[region]
      : undefined;
  if (stated !== undefined && stated !== null) {
    return { iso: stated, precision: "exact" };
  }
  return event.endsAt === null
    ? null
    : { iso: event.endsAt, precision: event.endPrecision };
}

/** The end instant to show this user, honouring a region-scoped event. */
export function effectiveEnd(
  event: EndBearing,
  region: Region,
): string | null {
  return endBoundary(event, region)?.iso ?? null;
}

/** Everything the clock reads off an event. */
export type Clockable = EndBearing &
  Pick<
    DisplayEvent,
    "startsAt" | "startPrecision" | "game" | "extractionMethod"
  >;

/**
 * The instant a stated boundary actually falls on.
 *
 * An `exact` boundary is already an instant and is returned untouched. A `day`
 * one is not an instant at all: the source printed a calendar date and no time,
 * and `dates.ts` stores the only faithful reading of that — 00:00Z, a placeholder
 * for "somewhere in this day" rather than a claim about when the day starts.
 *
 * Counting down to that placeholder turns it into exactly the claim it was not:
 * that the day begins at UTC midnight, which is nobody's day. It is wrong for
 * every reader by their server's distance from UTC, and always in the direction
 * of expiring an event early for the two regions that run ahead of it. Wuthering
 * Waves events dated "August 19, 2026" were still running three hours after this
 * countdown had retired them, because a European player's day opens at 04:00 on
 * a UTC+1 server.
 *
 * So a day-precision boundary resolves to the reset that opens that game-day on
 * the clock the game actually rolls on — the one fact we do hold about a game's
 * day, and the same one `daily.ts` already keys every tick by. That is a reading
 * of the date the source printed, not a time invented for it: the calendar day
 * is still the source's, and an end whose day is genuinely unannounced is still
 * `null`.
 *
 * A reader's own event (PRD F13) is left alone even at day precision. Its
 * boundary is not a parser declining to guess — `readerInstant` resolved it to
 * the instant they meant, in their own timezone, when they typed it.
 */
function boundaryMs(
  iso: string,
  precision: Precision,
  event: Pick<Clockable, "game" | "extractionMethod">,
  region: Region,
): number {
  if (precision !== "day" || event.extractionMethod !== "parser") {
    return Date.parse(iso);
  }
  return dayStartMs(iso.slice(0, 10), region, event.game);
}

/**
 * The instant a printed boundary has passed for **every** reader, whatever
 * region they are on.
 *
 * `boundaryMs` above answers the question for one reader; this answers it for
 * the last of them. The two must agree, because they are read at opposite ends
 * of the same pipeline: an ingest parser deciding whether a row is still worth
 * publishing, and the countdown deciding whether to call it over.
 *
 * They did not. A parser comparing `Date.parse(endsAt)` against `now` retires a
 * day-precision end at UTC midnight — the placeholder, not an instant (§ Domain
 * rules) — while the app keeps the event live until the reset that opens that
 * game-day on the reader's own server. For a default server map that is 09:00Z
 * in the Americas, so the feed drops an event nine hours before the app, the
 * countdown and the game all agree it is over. The reader does not see a stale
 * row; they see the deadline they were counting down to vanish on its last day,
 * which is the silent drop AGENTS.md § Working on parsers calls the dangerous
 * failure.
 *
 * So a row is history only once it is history everywhere. Being generous by a
 * few hours costs an expired row at the bottom of a list; being strict costs a
 * live one.
 */
export function latestBoundaryMs(
  iso: string,
  precision: Precision,
  game?: LaneId,
): number {
  if (precision !== "day") return Date.parse(iso);
  const day = iso.slice(0, 10);
  return Math.max(...Region.options.map((r) => dayStartMs(day, r, game)));
}

export type Urgency = "expired" | "critical" | "soon" | "near" | "calm";

/**
 * Urgency is derived from absolute time remaining, deliberately independent of
 * how far through the window we are. A 90-day event with 3 hours left is just
 * as urgent as a 3-day event with 3 hours left.
 */
export function urgency(msRemaining: number): Urgency {
  if (msRemaining <= 0) return "expired";
  if (msRemaining < 24 * HOUR) return "critical";
  if (msRemaining < 3 * DAY) return "soon";
  if (msRemaining < 7 * DAY) return "near";
  return "calm";
}

/**
 * Compact countdown: "4h 12m", "9d 3h", "31m".
 *
 * Deliberately drops to a finer unit as the deadline approaches — days are
 * useless at the point where minutes decide whether you make it.
 */
export function formatRemaining(msRemaining: number): string {
  if (msRemaining <= 0) return "ended";

  const days = Math.floor(msRemaining / DAY);
  const hours = Math.floor((msRemaining % DAY) / HOUR);
  const minutes = Math.floor((msRemaining % HOUR) / MINUTE);
  const seconds = Math.floor((msRemaining % MINUTE) / 1000);

  if (days >= 1) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours >= 1) return `${hours}h ${minutes}m`;
  if (minutes >= 1) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * Absolute date for the detail view, in the reader's own timezone.
 *
 * Takes an instant rather than only an ISO string so a caller with a resolved
 * boundary can print the one the countdown is counting to. A day-precision date
 * read straight off the event says 00:00Z, which renders as the *previous* day
 * to every reader west of UTC — the sheet would then name one day while the
 * timer beside it ran to another.
 */
export function formatAbsolute(iso: string | number, withTime: boolean): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  if (!withTime) return date;
  return `${date}, ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

export interface EventClock {
  startsMs: number;
  endsMs: number | null;
  msRemaining: number | null;
  /** 0–1 through the event's own window. Null when the end is unknown. */
  progress: number | null;
  urgency: Urgency;
  live: boolean;
  upcoming: boolean;
  ended: boolean;
}

export function clockFor(
  event: Clockable,
  region: Region,
  now: number,
): EventClock {
  const startsMs = boundaryMs(event.startsAt, event.startPrecision, event, region);
  const end = endBoundary(event, region);
  const endsMs = end === null ? null : boundaryMs(end.iso, end.precision, event, region);

  const msRemaining = endsMs === null ? null : endsMs - now;
  const upcoming = now < startsMs;
  const ended = msRemaining !== null && msRemaining <= 0;

  let progress: number | null = null;
  if (endsMs !== null && endsMs > startsMs) {
    progress = Math.min(1, Math.max(0, (now - startsMs) / (endsMs - startsMs)));
  }

  return {
    startsMs,
    endsMs,
    msRemaining,
    progress,
    // An event with no announced end is never treated as urgent — we do not
    // know that it is ending, and pretending otherwise would be a guess.
    urgency: msRemaining === null ? "calm" : urgency(msRemaining),
    live: !upcoming && !ended,
    upcoming,
    ended,
  };
}

/** Sort key: live events by soonest end, then upcoming by soonest start. */
export function endingSoonestFirst(
  a: { clock: EventClock },
  b: { clock: EventClock },
): number {
  if (a.clock.upcoming !== b.clock.upcoming) return a.clock.upcoming ? 1 : -1;
  if (a.clock.upcoming) return a.clock.startsMs - b.clock.startsMs;
  // Unknown ends sort last among live events: they are real, but they are not
  // the thing the reader is here to worry about.
  if (a.clock.msRemaining === null) return b.clock.msRemaining === null ? 0 : 1;
  if (b.clock.msRemaining === null) return -1;
  return a.clock.msRemaining - b.clock.msRemaining;
}

/**
 * Sort key: soonest deadline first, and nothing else.
 *
 * The other half of the timeline's "put them all together" (PRD F1). Where
 * `endingSoonestFirst` holds every unstarted event behind every running one —
 * which is what a *checklist* wants, since you cannot do a thing that has not
 * opened — this asks the one question a Gantt board is for: what runs out
 * first. An event opening on Friday and closing on Sunday is a nearer deadline
 * than one running now until October, and a reader looking at a calendar rather
 * than a to-do list is entitled to see it in that order.
 *
 * The `endsAt: null` rule is the same in both: an unannounced end is real but is
 * not a deadline, so it sorts behind every dated row rather than claiming a
 * place in the queue.
 */
export function byDeadline(
  a: { clock: EventClock },
  b: { clock: EventClock },
): number {
  if (a.clock.msRemaining === null) return b.clock.msRemaining === null ? 0 : 1;
  if (b.clock.msRemaining === null) return -1;
  return a.clock.msRemaining - b.clock.msRemaining;
}

/**
 * A plain-language caption for an event's window.
 *
 * The meter shows a proportion; this says what the proportion is *of*. Without
 * it a reader has to infer that ticks mean remaining time, which is exactly the
 * kind of "obvious to the author" encoding that leaves everyone else guessing.
 */
export function windowCaption(clock: EventClock, now: number): string {
  const on = (ms: number) =>
    new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });

  if (clock.upcoming) {
    return clock.endsMs === null
      ? `starts ${on(clock.startsMs)}`
      : `${on(clock.startsMs)} – ${on(clock.endsMs)} · not started yet`;
  }

  if (clock.endsMs === null) {
    return `started ${on(clock.startsMs)} · no end date announced`;
  }

  const totalDays = Math.max(
    1,
    Math.round((clock.endsMs - clock.startsMs) / DAY),
  );
  const leftMs = Math.max(0, clock.endsMs - now);
  const leftDays = Math.ceil(leftMs / DAY);

  const left =
    leftMs < DAY
      ? `${Math.max(1, Math.floor(leftMs / HOUR))} of ${totalDays * 24} hours left`
      : `${leftDays} of ${totalDays} days left`;

  return `${on(clock.startsMs)} – ${on(clock.endsMs)} · ${left}`;
}
