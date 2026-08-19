import type { LaneId } from "../../shared/custom.ts";

/**
 * Which rows each part of the page gets to see.
 *
 * These decisions used to sit inline in `App`, where they were untestable and
 * quietly inconsistent with each other — the "next to expire" headline counted
 * events the reader had finished or ignored, and the dailies strip listed a
 * repeating event they had already marked done. They are the same question
 * asked twice, so they are one function asked twice, and pure so a test can
 * pin them down.
 */

/** The shape every lens here needs. Structural so this module stays cheap. */
interface Row {
  event: { id: string; game: LaneId };
  clock: { msRemaining: number | null };
}

/**
 * Rows the reader still has something to do with.
 *
 * "Done" and "ignored" mean different things everywhere else in the app —
 * a done event stays visible and counted, an ignored one disappears — but to
 * anything answering *what is still on your plate?* they are the same answer:
 * not this one. The headline and the dailies strip are both that question.
 *
 * Note this is deliberately not the same as the main list's filters, which
 * honour `showCompleted` / `showIgnored`. Those preferences control what the
 * reader can *look at*; this controls what the app *tells them to do*, and
 * being reminded of a job you already finished is the bug either way.
 */
export function outstanding<T extends Row>(
  rows: readonly T[],
  isDone: (id: string) => boolean,
  isIgnored: (id: string) => boolean,
): T[] {
  return rows.filter((r) => !isDone(r.event.id) && !isIgnored(r.event.id));
}

/**
 * The rows closest to expiring, soonest first.
 *
 * Ordered here rather than taken off the top of the list, because the list it
 * is given is sorted by whatever mode the reader chose — under "doing first"
 * the head of the list is what they are partway through, which is not what a
 * panel headed "next to expire" is claiming to show.
 *
 * An event with no announced end sorts behind every dated one however long it
 * has been running: it is real, but it is not a deadline, and it can only
 * surface here once the deadlines run out.
 */
export function nextToExpire<T extends Row>(
  rows: readonly T[],
  count: number,
): T[] {
  const dated = rows
    .filter((r) => r.clock.msRemaining !== null)
    .sort((a, b) => (a.clock.msRemaining ?? 0) - (b.clock.msRemaining ?? 0));
  const undated = rows.filter((r) => r.clock.msRemaining === null);
  return [...dated, ...undated].slice(0, Math.max(0, count));
}

/**
 * The single row closest to expiring — the headline's own event.
 *
 * One definition, asked for one row, so the big countdown and the lines under
 * it can never disagree about which deadline is next.
 */
export function firstToExpire<T extends Row>(rows: readonly T[]): T | null {
  return nextToExpire(rows, 1)[0] ?? null;
}

/**
 * The focused game, if it is still a game the reader can see.
 *
 * A focus on a game they have since switched off, or that has dropped out of
 * the feed, is ignored rather than obeyed — the alternative is an empty page
 * whose reason is a setting two screens away.
 */
export function resolveFocus(
  focus: LaneId | null,
  enabled: readonly LaneId[],
): LaneId | null {
  return focus !== null && enabled.includes(focus) ? focus : null;
}

/**
 * The next game in the rotation: all → first → … → last → all.
 *
 * Working through games one at a time is a loop, and it ends by coming back to
 * everything rather than silently starting over — otherwise there is no way out
 * of the rotation except finding the "all" chip again.
 */
export function advanceFocus(
  focus: LaneId | null,
  enabled: readonly LaneId[],
): LaneId | null {
  if (enabled.length === 0) return null;
  const at = focus === null ? -1 : enabled.indexOf(focus);
  // An unknown focus (switched-off game) restarts the rotation rather than
  // jumping to index 0 of nowhere.
  return enabled[at + 1] ?? null;
}

/** How many rows each game still has outstanding, for the focus chips. */
export function countByGame<T extends Row>(
  rows: readonly T[],
): Partial<Record<LaneId, number>> {
  const out: Partial<Record<LaneId, number>> = {};
  for (const row of rows) {
    out[row.event.game] = (out[row.event.game] ?? 0) + 1;
  }
  return out;
}
