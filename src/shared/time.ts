import type { DisplayEvent } from "./custom.ts";
import type { Region } from "./schema.ts";

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
  "endsAt" | "regionScoped" | "regionEnds"
>;

/** The end instant to show this user, honouring a region-scoped event. */
export function effectiveEnd(
  event: EndBearing,
  region: Region,
): string | null {
  if (event.endsAt === null) return null;
  if (!event.regionScoped || event.regionEnds === null) return event.endsAt;
  return event.regionEnds[region] ?? event.endsAt;
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

/** Absolute date for the detail view, in the reader's own timezone. */
export function formatAbsolute(iso: string, withTime: boolean): string {
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
  event: EndBearing & Pick<DisplayEvent, "startsAt">,
  region: Region,
  now: number,
): EventClock {
  const startsMs = Date.parse(event.startsAt);
  const end = effectiveEnd(event, region);
  const endsMs = end === null ? null : Date.parse(end);

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
