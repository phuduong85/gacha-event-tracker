import { z } from "zod";

export const GameId = z.enum([
  "genshin",
  "hsr",
  "zzz",
  "wuwa",
  "endfield",
  "nte", // Neverness to Everness
  "p5x", // Persona 5: The Phantom X
  "r1999", // Reverse: 1999
  "ptn", // Path to Nowhere
]);
export type GameId = z.infer<typeof GameId>;

export const EventType = z.enum([
  "banner", // limited character/weapon rate-up
  "story", // main or side story chapter, limited-time
  "rerun", // returning event
  "challenge", // combat/endgame cycle (Abyss, Onslaught, Trial, ...)
  "login", // login rewards / check-in
  "shop", // limited shop or exchange window
  "maintenance", // server downtime
  "other",
]);
export type EventType = z.infer<typeof EventType>;

export const Region = z.enum(["asia", "america", "europe"]);
export type Region = z.infer<typeof Region>;

/**
 * How much we actually know about a boundary timestamp.
 * - "exact"   sourced to the minute
 * - "day"     date known, time-of-day not stated by the source
 * - "unknown" not announced; the paired timestamp is null
 */
export const Precision = z.enum(["exact", "day", "unknown"]);
export type Precision = z.infer<typeof Precision>;

export const GachaEvent = z
  .object({
    id: z.string(),
    game: GameId,
    title: z.string().min(1).max(200),
    type: EventType,
    summary: z.string().max(500).nullable(),

    startsAt: z.string().datetime(),
    startPrecision: Precision,
    endsAt: z.string().datetime().nullable(),
    endPrecision: Precision,

    regionScoped: z.boolean(),
    regionEnds: z.record(Region, z.string().datetime()).nullable(),

    sourceUrl: z.string().url(),
    sourceId: z.string(),

    status: z.enum(["published", "delisted"]),
    confidence: z.number().min(0).max(1),
    extractionMethod: z.enum(["parser", "manual"]),

    version: z.number().int().positive(),
    firstSeenAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  // These invariants are cheap here and prevent a whole class of wrong-date bugs
  // reaching the feed. See docs/INGESTION.md § Stage 4.
  .refine((e) => (e.endsAt === null) === (e.endPrecision === "unknown"), {
    message: "endsAt null must pair with endPrecision 'unknown'",
    path: ["endPrecision"],
  })
  .refine((e) => (e.regionEnds === null) === !e.regionScoped, {
    message: "regionEnds must be populated exactly when regionScoped is true",
    path: ["regionEnds"],
  })
  .refine((e) => e.endsAt === null || e.endsAt > e.startsAt, {
    message: "endsAt must be after startsAt",
    path: ["endsAt"],
  });

export type GachaEvent = z.infer<typeof GachaEvent>;

/**
 * Stable, deterministic event ID.
 *
 * WARNING: these are localStorage keys on the client. Changing this function —
 * including the slug rules — orphans every completion mark every user has, with
 * no server-side recovery. See docs/DATA-MODEL.md § ID stability.
 */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['‘’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function eventId(
  game: GameId,
  title: string,
  startsAt: string,
): string {
  return `${game}:${slugify(title)}:${startsAt.slice(0, 10)}`;
}
