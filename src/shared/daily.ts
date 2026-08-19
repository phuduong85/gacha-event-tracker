import type { LaneId } from "./custom.ts";
import type { GachaEvent, GameId, Region } from "./schema.ts";
import { DAY, resetShiftMs } from "./time.ts";

/**
 * Events you have to come back to every day.
 *
 * A login campaign is not one job with a deadline — it is twenty small jobs on
 * twenty separate deadlines, and missing one is unrecoverable in a way that
 * being late on a story chapter is not. The rest of the app measures a single
 * window shrinking; this measures a repeating one, and counts how many are
 * left.
 *
 * Everything here is pure and takes its clock as an argument, for the same
 * reason the parsers do: a function that reads `Date.now()` cannot be tested
 * against a fixed instant.
 */

/**
 * A 180-day event is already a parse error (see AGENTS.md § Domain rules), so
 * this only ever fires on data that is wrong; it exists so a bad end date
 * cannot make the client allocate an unbounded array.
 */
const MAX_DAYS = 200;

/**
 * Phrases a source uses for "come back every day". Deliberately narrow: a
 * false positive puts a checklist on an event that does not want one, which is
 * noise the reader has to work out and dismiss.
 */
const DAILY_PHRASES = [
  /\bdaily\b/i,
  /\bdailies\b/i,
  /\bevery day\b/i,
  /\beach day\b/i,
  /\bcheck[- ]?in\b/i,
  /\bsign[- ]?in\b/i,
  /\blog[- ]?in (?:bonus|reward|event|campaign)/i,
  /\b7[- ]day\b/i,
  /\bconsecutive days?\b/i,
];

/** The fields dailiness is decided from — everything else is irrelevant. */
export type DailyCandidate = Pick<GachaEvent, "type" | "title" | "summary">;

/**
 * Whether an event wants a daily checklist.
 *
 * Read off the event as published. Nothing is inferred from a game's habits or
 * an event's length: a source that never says "daily" gets no checklist, which
 * is the same skip-rather-than-guess rule the parsers follow.
 */
export function isDaily(event: DailyCandidate): boolean {
  if (event.type === "login") return true;
  const text = `${event.title} ${event.summary ?? ""}`;
  return DAILY_PHRASES.some((re) => re.test(text));
}

/**
 * Key for a game's standing daily chore — commissions, sanity, the routine
 * that exists whether or not an event is running.
 *
 * No source publishes these, so they are not feed events and never will be;
 * they are a fixed list the client knows about. The two-segment shape cannot
 * collide with an event ID, which is always `game:slug:date`, and like every
 * other ID here it is a localStorage key: changing it drops a reader's streak
 * with nothing server-side to restore from.
 */
export function dailiesId(game: GameId): string {
  return `dailies:${game}`;
}

/**
 * Whether to treat an event as repeating, given what the reader said about it.
 *
 * Detection reads the source's wording, which is right most of the time and
 * wrong in both directions: a grind event whose page never prints the word
 * "daily" still wants a checklist, and a banner whose blurb mentions "daily
 * login rewards" does not. The reader's own answer is the better evidence, so
 * it wins outright — `undefined` means they have not said, so detection stands.
 *
 * `detect` is the reader's standing preference for guessing at all. Switching
 * it off leaves only the events they marked themselves; it never touches a
 * mark or a logged day, so switching it back on restores exactly what was
 * there.
 */
export function resolveDaily(
  event: DailyCandidate,
  override: boolean | undefined,
  detect = true,
): boolean {
  if (override !== undefined) return override;
  return detect && isDaily(event);
}

/**
 * What to store when the reader asks for `desired`.
 *
 * Agreeing with detection stores nothing: an override that merely repeats what
 * the parser already worked out would freeze today's guess into the reader's
 * data, so a later parser improvement could never reach that event.
 */
export function dailyOverride(
  desired: boolean,
  detected: boolean,
): boolean | undefined {
  return desired === detected ? undefined : desired;
}

/**
 * Which game-day an instant falls in, as `YYYY-MM-DD`.
 *
 * These are storage keys, and they are compared with `<` elsewhere in this
 * module, so the format is fixed and sortable on purpose.
 *
 * `game` is optional because a caller that has no particular game in hand — a
 * generic "what day is it here?" — still gets the regional answer. Anything
 * that reads or writes a tick should pass it.
 */
export function dayKey(ms: number, region: Region, game?: LaneId): string {
  return new Date(ms + resetShiftMs(region, game)).toISOString().slice(0, 10);
}

/** The next reset instant strictly after `ms`. */
export function nextResetMs(ms: number, region: Region, game?: LaneId): number {
  const s = resetShiftMs(region, game);
  return Math.floor((ms + s) / DAY) * DAY + DAY - s;
}

/** How long the reader has left to do today's dailies. */
export function msUntilReset(ms: number, region: Region, game?: LaneId): number {
  return nextResetMs(ms, region, game) - ms;
}

/**
 * Every game-day the event is claimable on, oldest first.
 *
 * Returns null when the end is unannounced. A daily event with no end date has
 * an unknown number of days left, and inventing one to fill a checklist would
 * be exactly the fabrication `endsAt: null` exists to prevent.
 */
export function dailyDays(
  startsMs: number,
  endsMs: number | null,
  region: Region,
  game?: LaneId,
): string[] | null {
  if (endsMs === null) return null;

  const out: string[] = [];
  // The end instant belongs to the previous day when it lands exactly on a
  // reset: an event ending at 04:00 gives you nothing on that final day.
  const last = endsMs - 1;
  let cursor = startsMs;
  if (last < startsMs) return [dayKey(startsMs, region, game)];

  while (cursor <= last && out.length < MAX_DAYS) {
    out.push(dayKey(cursor, region, game));
    cursor = nextResetMs(cursor, region, game);
  }
  return out;
}

export interface DailySummary {
  /** Every claimable day, oldest first. Null when the end is unannounced. */
  days: string[] | null;
  /** Today's key, whether or not the event is running. */
  today: string;
  todayInWindow: boolean;
  doneToday: boolean;
  /** Days ticked off inside the window. */
  logged: number;
  /** Days still claimable, today included. Null when the end is unannounced. */
  remaining: number | null;
  /** Past days that went unticked. Null when the end is unannounced. */
  missed: number | null;
  /** Consecutive ticked days up to today (or up to yesterday, if today is untouched). */
  streak: number;
  msUntilReset: number;
}

/**
 * Where the reader is with a repeating event.
 *
 * `logged` is the reader's own record and is never second-guessed here: a day
 * they ticked stays ticked even if it falls outside the window the feed now
 * claims, because a source quietly moving a date must not silently erase what
 * somebody did.
 */
export function dailySummary(input: {
  startsMs: number;
  endsMs: number | null;
  region: Region;
  /** Whose reset clock this runs on. Omitted falls back to the region's. */
  game?: LaneId | undefined;
  now: number;
  logged: readonly string[];
}): DailySummary {
  const { startsMs, endsMs, region, game, now, logged } = input;
  const days = dailyDays(startsMs, endsMs, region, game);
  const today = dayKey(now, region, game);
  const ticked = new Set(logged);

  const inWindow = days === null ? logged.slice() : days.filter((d) => ticked.has(d));
  const todayInWindow = days === null ? now >= startsMs : days.includes(today);

  return {
    days,
    today,
    todayInWindow,
    doneToday: ticked.has(today),
    logged: inWindow.length,
    remaining: days === null ? null : days.filter((d) => d >= today).length,
    missed:
      days === null
        ? null
        : days.filter((d) => d < today && !ticked.has(d)).length,
    streak: streakOf(logged, today),
    msUntilReset: msUntilReset(now, region, game),
  };
}

/**
 * Consecutive ticked days ending today.
 *
 * Counts back from yesterday when today has not been done yet, so a run built
 * over a fortnight does not read as broken every morning before the reader has
 * logged in.
 *
 * Works on day keys rather than instants so the standing per-game chores and
 * an event's checklist can share one definition of a streak.
 */
export function streakOf(logged: readonly string[], today: string): number {
  const ticked = new Set(logged);
  const at = Date.parse(`${today}T00:00:00Z`);
  let cursor = ticked.has(today) ? at : at - DAY;
  let streak = 0;
  while (streak < MAX_DAYS && ticked.has(keyOf(cursor))) {
    streak += 1;
    cursor -= DAY;
  }
  return streak;
}

function keyOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
