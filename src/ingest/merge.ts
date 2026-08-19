import type { GachaEvent } from "../shared/schema.ts";

/**
 * Combine events for one game from several sources.
 *
 * Two sources covering the same game will disagree: different titles for the
 * same event, dates that differ by a day, one listing something the other
 * misses. This decides what the feed shows.
 *
 * The rules, in order:
 *   1. Same event ID  → same event. Keep the higher-confidence copy.
 *   2. Near match     → same event under different titles. Keep the
 *                       higher-confidence copy and record corroboration.
 *   3. Otherwise      → distinct events; keep both.
 *
 * Corroboration is the point of running multiple sources: two independent
 * sources agreeing on a date is much stronger evidence than one asserting it,
 * and that shows up as a confidence bump. Two sources *disagreeing* on an end
 * date is flagged rather than silently resolved — see `conflicts`.
 */

export interface MergeResult {
  events: GachaEvent[];
  /**
   * Pairs that look like the same event but disagree on an end date by more
   * than the tolerance. These are the cases a human should look at; the
   * pipeline routes them to quarantine.
   */
  conflicts: Array<{
    kept: GachaEvent;
    rejected: GachaEvent;
    field: "endsAt" | "startsAt";
    deltaHours: number;
  }>;
}

export interface MergeOptions {
  /** How far two boundaries may differ and still count as agreement. */
  toleranceHours?: number;
  /** Title similarity above which two events are considered the same. */
  titleThreshold?: number;
  /** Confidence added when an independent source agrees. */
  corroborationBonus?: number;
}

const DEFAULTS = {
  toleranceHours: 24,
  /**
   * 0.8, not higher: a two-word title with one extra decorative token
   * ("Stygian Onslaught" vs "Stygian Onslaught Event") scores exactly 0.8, and
   * failing to merge those puts duplicate rows in front of the user. The real
   * guard against false positives is start-date proximity, not this number — a
   * rerun reuses the name but starts months later.
   */
  titleThreshold: 0.8,
  corroborationBonus: 0.1,
} as const;

export function mergeEvents(
  groups: GachaEvent[][],
  options: MergeOptions = {},
): MergeResult {
  const toleranceHours = options.toleranceHours ?? DEFAULTS.toleranceHours;
  const titleThreshold = options.titleThreshold ?? DEFAULTS.titleThreshold;
  const bonus = options.corroborationBonus ?? DEFAULTS.corroborationBonus;

  const kept: GachaEvent[] = [];
  const conflicts: MergeResult["conflicts"] = [];

  for (const incoming of groups.flat()) {
    const matchIndex = kept.findIndex(
      (existing) =>
        existing.game === incoming.game &&
        isSameEvent(existing, incoming, titleThreshold, toleranceHours),
    );

    if (matchIndex === -1) {
      kept.push(incoming);
      continue;
    }

    const existing = kept[matchIndex];
    if (existing === undefined) continue;

    const conflict = findConflict(existing, incoming, toleranceHours);
    const [winner, loser] =
      incoming.confidence > existing.confidence
        ? ([incoming, existing] as const)
        : ([existing, incoming] as const);

    if (conflict !== null) {
      // Independent sources disagree on when this ends. Do not average, do not
      // silently prefer one — surface it. A wrong end date is the failure this
      // product exists to prevent.
      conflicts.push({ kept: winner, rejected: loser, ...conflict });
      kept[matchIndex] = winner;
      continue;
    }

    // Agreement from a different source is real evidence; from the same source
    // it is just the same row seen twice.
    const corroborated =
      winner.sourceId !== loser.sourceId
        ? { ...winner, confidence: Math.min(1, winner.confidence + bonus) }
        : winner;

    kept[matchIndex] = corroborated;
  }

  kept.sort((a, b) =>
    a.startsAt === b.startsAt
      ? a.id.localeCompare(b.id)
      : a.startsAt.localeCompare(b.startsAt),
  );

  return { events: kept, conflicts };
}

function isSameEvent(
  a: GachaEvent,
  b: GachaEvent,
  titleThreshold: number,
  toleranceHours: number,
): boolean {
  if (a.id === b.id) return true;

  // Near-match fusion reconciles two *sources* describing one event under
  // different titles. Within one source it has no such job to do: the page has
  // already told us these are two rows, the parser has already dropped repeats
  // of the same id, and fusing them here overrules a distinction the publisher
  // made on purpose. Game8's Umamusume page is the case that surfaced it — its
  // `3 Star Guaranteed 1.5 Anniversary Scout (Character)` and `(Support)` are
  // two concurrent banners whose titles differ by one parenthetical, which
  // scores far above any workable threshold and starts on the same day. Fusing
  // them dropped a real banner off the calendar with nothing reporting it,
  // which is the silent drop this codebase treats as the dangerous failure.
  if (a.sourceId === b.sourceId) return false;

  // Overlap alone misses a source that appends a qualifier: "Bedazzling
  // Dawnstar" vs "Bedazzling Dawnstar Sign-In" scores 0.67, well under any
  // safe threshold, yet is plainly one event.
  const similar =
    titleSimilarity(a.title, b.title) >= titleThreshold ||
    titleExtends(a.title, b.title);
  if (!similar) return false;

  // Similar titles are not enough — reruns reuse names. Require the start dates
  // to be close before treating two entries as one event.
  return hoursBetween(a.startsAt, b.startsAt) <= toleranceHours;
}

/**
 * True when one title is the other with words appended — the shape a source
 * qualifier actually takes ("Bedazzling Dawnstar" → "… Sign-In").
 *
 * Deliberately a prefix test, not a subset test. Subset matching would also
 * fuse "Gold Clash" with "Gold Rush Clash Royale", which are different events.
 * Two words is the floor: a one-word title would swallow half the calendar.
 */
export function titleExtends(a: string, b: string): boolean {
  const ta = tokenList(a);
  const tb = tokenList(b);
  const [small, large] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (small.length < 2 || small.length === large.length) return false;
  return small.every((word, i) => large[i] === word);
}

function findConflict(
  a: GachaEvent,
  b: GachaEvent,
  toleranceHours: number,
): { field: "endsAt" | "startsAt"; deltaHours: number } | null {
  if (a.endsAt !== null && b.endsAt !== null) {
    const delta = hoursBetween(a.endsAt, b.endsAt);
    if (delta > toleranceHours) return { field: "endsAt", deltaHours: delta };
  }
  const startDelta = hoursBetween(a.startsAt, b.startsAt);
  if (startDelta > toleranceHours) {
    return { field: "startsAt", deltaHours: startDelta };
  }
  return null;
}

function hoursBetween(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 3_600_000;
}

/**
 * Token-overlap (Dice) similarity on normalised titles. Deliberately simple:
 * it only needs to catch "Stygian Onslaught" vs "Stygian Onslaught (Event)",
 * not to do fuzzy natural-language matching.
 */
export function titleSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return (2 * shared) / (ta.size + tb.size);
}

function tokenList(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

function tokens(title: string): Set<string> {
  return new Set(tokenList(title));
}
