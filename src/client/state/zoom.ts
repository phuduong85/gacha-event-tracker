/**
 * How far the timeline is zoomed in, expressed as the width of one day.
 *
 * A patch cycle is six weeks and a login campaign can run for months, so no
 * single scale answers both "what am I in the middle of this week?" and "how do
 * the next three months line up?". The reader picks.
 *
 * Pure, and its own module rather than a constant inside `Timeline`, because
 * `prefs` stores the chosen value and the two must agree on what is valid.
 */

/**
 * The ladder, in px per day. Roughly half again wider at each step.
 *
 * It runs from a quarter of calendar on one screen to a single day being wider
 * than a finger. The close end is not decoration: several events routinely end
 * within a day of each other, and at 48px a day their bar ends are a few pixels
 * apart — which is the moment a reader is asking the board the one question it
 * exists to answer, and being told to squint. Going in further separates them,
 * and gives a one-day event a bar wide enough to read and to tap.
 */
export const DAY_WIDTHS = [6, 9, 13, 20, 32, 48, 72, 108] as const;

/**
 * The scale the board opens at for a reader who has never touched the control.
 *
 * Two steps up from where it used to sit. Thirteen px/day opened on about a
 * quarter of calendar, and a quarter is more time than these schedules are
 * written in: a patch is six weeks, so most bars were short enough that the
 * length stopped reading as a duration and the title stopped fitting inside the
 * bar it belonged to. Thirty-two opens on roughly a patch cycle on a laptop —
 * bars long enough to compare by eye, and wide enough to carry their own name.
 * The longer view is one press of − away, and that answer is remembered.
 *
 * This moves new readers only: `prefs` is written on every load, so anyone who
 * has opened the app has a `timelineDayWidth` of their own and keeps it.
 */
export const DEFAULT_DAY_WIDTH = 32;

/**
 * The nearest valid scale to a stored number.
 *
 * `prefs` is a file on someone's device that an export/import round trip can
 * carry between versions, so the ladder is allowed to change and a value off
 * it must not render a board one pixel wide. Anything unusable falls back to
 * the default rather than to the nearest edge — a corrupt value is not a
 * preference.
 */
export function snapDayWidth(px: number): number {
  if (!Number.isFinite(px) || px <= 0) return DEFAULT_DAY_WIDTH;
  // `<=` over an ascending ladder means a value sitting exactly between two
  // steps takes the wider one. Ties go to the more legible board.
  return DAY_WIDTHS.reduce((best, step) =>
    Math.abs(step - px) <= Math.abs(best - px) ? step : best,
  );
}

/** One step in or out, stopping at the ends of the ladder. */
export function stepDayWidth(px: number, by: 1 | -1): number {
  const at = DAY_WIDTHS.indexOf(snapDayWidth(px) as (typeof DAY_WIDTHS)[number]);
  return DAY_WIDTHS[Math.min(Math.max(at + by, 0), DAY_WIDTHS.length - 1)] ?? DEFAULT_DAY_WIDTH;
}

/** Whether there is anywhere further to go in that direction. */
export function canStep(px: number, by: 1 | -1): boolean {
  return stepDayWidth(px, by) !== snapDayWidth(px);
}

/**
 * How many weeks apart the dated ticks on the axis are.
 *
 * Every Monday is right at the default scale and unreadable at the widest zoom
 * out, where a week is 42px and the labels would sit on top of each other. The
 * gridlines stay weekly either way — they are hairlines and they carry the
 * rhythm; it is only the dates that have to thin out.
 */
export function weekLabelStep(dayWidth: number): number {
  const MIN_LABEL_GAP = 64;
  return Math.max(1, Math.ceil(MIN_LABEL_GAP / (7 * dayWidth)));
}
