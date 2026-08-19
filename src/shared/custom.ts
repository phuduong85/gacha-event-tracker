import { z } from "zod";
import { EventType, GachaEvent, Precision, slugify } from "./schema.ts";

/**
 * Games and events the reader entered themselves (PRD F13).
 *
 * No source publishes these, nothing fetches them, and they never enter the
 * ingest pipeline — `sanitize.ts` and `merge.ts` exist for pages we do not
 * control, and a reader's own typing is neither untrusted markup nor a second
 * opinion to reconcile. What they *do* share with scraped events is everything
 * downstream: the same lists, the same clock, the same progress, ignore and
 * daily-checklist stores, keyed by the ids below.
 */

/**
 * Reserved first segments. None of these may ever become a `GameId`.
 *
 * Every id in this app is colon-separated and the first segment decides which
 * space it belongs to: `dailies:<game>` is a standing chore, `mygame:` and
 * `myevent:` are the reader's own, and anything else is `<game>:<slug>:<date>`
 * from a source. The day one of these becomes a game id is the day two key
 * spaces merge silently, so a test pins it against `GameId.options`.
 */
export const RESERVED_ID_SEGMENTS = ["dailies", "mygame", "myevent"] as const;

const GAME_PREFIX = "mygame";
const EVENT_PREFIX = "myevent";

export const CustomGameId = z.string().regex(/^mygame:[a-z0-9-]{1,60}$/);
export const CustomEventId = z.string().regex(/^myevent:[a-z0-9]{6,32}$/);

/**
 * Anything that can key a lane: a tracked game or one the reader defined.
 *
 * Deliberately a plain string rather than a union — it is read by filters,
 * focus, counts and day keys, none of which care which kind it is, and a union
 * would push a narrowing at every one of those call sites for no safety.
 */
export type LaneId = string;

export function isCustomGameId(id: string): boolean {
  return id.startsWith(`${GAME_PREFIX}:`);
}

/**
 * Whether this event is the reader's own.
 *
 * The id is the authority, not `extractionMethod` — that says a human entered
 * the value, which is also true of an event approved through the review gate.
 * This says *this* reader entered it, which is what the UI must not get wrong:
 * their own date is never attributed to a source.
 */
export function isCustomEventId(id: string): boolean {
  return id.startsWith(`${EVENT_PREFIX}:`);
}

export const CustomGame = z.object({
  id: CustomGameId,
  name: z.string().min(1).max(40),
  /**
   * Reaches a `style` attribute, and an imported file is not necessarily one
   * this reader wrote — so the shape is checked rather than trusted.
   */
  hue: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  at: z.string().datetime(),
});
export type CustomGame = z.infer<typeof CustomGame>;

export const CustomEvent = z
  .object({
    id: CustomEventId,
    /**
     * A tracked game, or one of theirs — a source can miss an event too.
     *
     * **`z.string()` and not `GameId`, deliberately.** We retire games, sources
     * and pages routinely, and this field is the only thing standing between
     * that and a reader losing a row they typed: `useCustom` reads through
     * `validRecords`, which drops a record that fails this schema, and the
     * survivors are what the next write persists. Narrowing this to the enum
     * would read as a tightening and would arm every future removal to erase
     * reader data on next launch — silently, with no server-side recovery,
     * exactly as § Event IDs are localStorage keys describes for `slugify`.
     * `metaFor` is total so an id with no game behind it still renders.
     */
    game: z.string().min(1),
    title: z.string().min(1).max(200),
    type: EventType,
    summary: z.string().max(500).nullable(),

    startsAt: z.string().datetime(),
    startPrecision: Precision,
    endsAt: z.string().datetime().nullable(),
    endPrecision: Precision,

    at: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  // The same invariants the feed is held to. "I don't know when this ends" has
  // to be expressible here too, or entering an unannounced event would force
  // the reader to invent a date — the one thing this product refuses to do.
  .refine((e) => (e.endsAt === null) === (e.endPrecision === "unknown"), {
    message: "endsAt null must pair with endPrecision 'unknown'",
    path: ["endPrecision"],
  })
  .refine((e) => e.endsAt === null || e.endsAt > e.startsAt, {
    message: "endsAt must be after startsAt",
    path: ["endsAt"],
  });
export type CustomEvent = z.infer<typeof CustomEvent>;

export const CustomGames = z.record(z.string(), CustomGame);
export const CustomEvents = z.record(z.string(), CustomEvent);
export type CustomGames = z.infer<typeof CustomGames>;
export type CustomEvents = z.infer<typeof CustomEvents>;

/**
 * What every view in the client actually reads.
 *
 * A feed event satisfies this as-is; a reader's event is projected into it by
 * `asDisplayEvent`. Only two fields widen, and both for the same reason — the
 * reader's events are not from a source:
 *
 *   game       may be a lane they invented, so not a `GameId`
 *   sourceUrl  is null, because there is no page to send a sceptic to
 */
export type DisplayEvent = Omit<GachaEvent, "game" | "sourceUrl"> & {
  game: LaneId;
  sourceUrl: string | null;
};

/**
 * Project a reader's event into the shape the views read.
 *
 * `extractionMethod: "manual"` and `confidence: 1` are the existing vocabulary
 * for "a human asserted this", so nothing new is invented to describe it. The
 * region fields say false/null because the reader entered one instant, not a
 * per-region map — turning one timestamp into three would fabricate two of them.
 */
export function asDisplayEvent(event: CustomEvent): DisplayEvent {
  return {
    id: event.id,
    game: event.game,
    title: event.title,
    type: event.type,
    summary: event.summary,
    startsAt: event.startsAt,
    startPrecision: event.startPrecision,
    endsAt: event.endsAt,
    endPrecision: event.endPrecision,
    regionScoped: false,
    regionEnds: null,
    sourceUrl: null,
    sourceId: "you",
    status: "published",
    confidence: 1,
    extractionMethod: "manual",
    version: 1,
    firstSeenAt: event.at,
    updatedAt: event.updatedAt,
  };
}

/**
 * A stable id for a game the reader named, unique among the ones they have.
 *
 * Slug-derived so it reads in an export, and suffixed on collision rather than
 * overwriting — two games called "Nikke" are two games.
 */
export function mintCustomGameId(
  name: string,
  taken: Iterable<string> = [],
): string {
  const base = slugify(name).slice(0, 60) || "game";
  const used = new Set(taken);
  let id = `${GAME_PREFIX}:${base}`;
  for (let n = 2; used.has(id); n += 1) id = `${GAME_PREFIX}:${base}-${n}`;
  return id;
}

/**
 * A random id for an event the reader entered.
 *
 * Random, not derived from the title, for two reasons. It cannot collide with
 * `${game}:${slug}:${date}` even when they type a scraped event's exact name and
 * date — that collision would silently share one completion mark and one streak
 * between two events. And it does not move when they rename their own event, so
 * editing a typo in a title never costs them the marks attached to it.
 */
export function mintCustomEventId(random: () => number = Math.random): string {
  let token = "";
  while (token.length < 10) {
    token += Math.floor(random() * 36 ** 6)
      .toString(36)
      .padStart(6, "0");
  }
  return `${EVENT_PREFIX}:${token.slice(0, 10)}`;
}

/**
 * The precision a reader's boundary actually has.
 *
 * A date typed with no time of day is `"day"`, exactly as a source that printed
 * one would be — so the detail sheet's existing "accurate to the day only" note
 * is honest about their input too, rather than presenting midnight as a time
 * they chose.
 */
export function precisionOf(hasTime: boolean): Extract<Precision, "exact" | "day"> {
  return hasTime ? "exact" : "day";
}

/** True when `id` is a game this reader defined and still has. */
export function knownLane(id: LaneId, games: CustomGames): boolean {
  return !isCustomGameId(id) || games[id] !== undefined;
}
