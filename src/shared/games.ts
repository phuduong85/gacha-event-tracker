import type { CustomGames, LaneId } from "./custom.ts";
import type { GameId, Region } from "./schema.ts";

export interface GameMeta {
  id: GameId;
  name: string;
  /** Short label for narrow lanes and chips. */
  short: string;
  /**
   * Hue identity. This axis encodes *which game* only — urgency is a separate
   * axis (see time.ts). Keeping them orthogonal is what lets a glance answer
   * "whose event is this?" and "how long have I got?" at the same time.
   */
  hue: string;
  /** Who makes it. Credited in the colophon, derived rather than hardcoded. */
  studio: string;
  /**
   * What the game's standing daily chore actually consists of, in the terms
   * the game itself uses. Deliberately the routine every player recognises —
   * this is a reminder, not a guide, and a wrong specific would be worse than
   * no hint at all.
   */
  dailyTasks: string;
  /**
   * Server clock offsets that differ from the regional default, per region.
   *
   * Not every game runs one server per region. Where a game serves two of our
   * regions off a single machine, the reader's region is still the right
   * question — it just gets a different answer for that game than
   * `REGION_RESET_UTC_OFFSET` gives.
   *
   * Deliberately a sparse override rather than a full table: listing only the
   * regions that actually differ keeps the diff to the fact that changed, and
   * a region absent here keeps the default answer it has always had.
   *
   * This feeds `dayKey`, which is a **localStorage key**. Adding or changing an
   * entry re-labels the game-day some already-logged ticks fall in, for readers
   * in that region only — see `src/shared/daily.ts` § shift and
   * docs/DATA-MODEL.md.
   */
  resetOffsets?: Partial<Record<Region, number>> | undefined;
  /**
   * The hour of the server's own day this game rolls over on, when it is not
   * `RESET_HOUR_LOCAL` (04:00).
   *
   * Most gacha servers reset at 04:00 local. Reverse: 1999 resets at 05:00, and
   * the difference is not cosmetic: `resetOffsets` alone cannot express it,
   * because bending a game's stated server offset to land the right instant
   * would put every other reader of that offset an hour out.
   *
   * Like `resetOffsets` this feeds `dayKey`, which is a **localStorage key**, so
   * the same warning applies — changing it for a game that already has readers
   * re-labels the game-day their logged ticks fall in. Absent means 04:00, which
   * is why adding this field moved no existing game.
   */
  resetHourLocal?: number | undefined;
}

export const GAMES: Record<GameId, GameMeta> = {
  genshin: { id: "genshin", name: "Genshin Impact", short: "Genshin", hue: "#4EA8DE" , studio: "HoYoverse", dailyTasks: "Commissions, resin" },
  hsr: { id: "hsr", name: "Honkai: Star Rail", short: "Star Rail", hue: "#7B8CFF" , studio: "HoYoverse", dailyTasks: "Daily training, Trailblaze Power" },
  zzz: { id: "zzz", name: "Zenless Zone Zero", short: "ZZZ", hue: "#F2A03D" , studio: "HoYoverse", dailyTasks: "Daily missions, battery" },
  wuwa: { id: "wuwa", name: "Wuthering Waves", short: "Wuwa", hue: "#3DD6A0" , studio: "Kuro Games", dailyTasks: "Daily activity, waveplate" },
  // Endfield has two server groups, not three: Europe is served off the same
  // machine as the Americas, on a fixed UTC-5. So a European player's day rolls
  // at 09:00 UTC — 11:00 in Copenhagen in summer, 10:00 in winter — six hours
  // after the HoYo/Kuro pattern above. Asia has its own server and is unchanged,
  // and `america` already resolves to -5, so Europe is the only real override.
  endfield: { id: "endfield", name: "Arknights: Endfield", short: "Endfield", hue: "#E8635A" , studio: "Hypergryph", dailyTasks: "Daily missions", resetOffsets: { europe: -5 } },
  nte: { id: "nte", name: "Neverness to Everness", short: "NTE", hue: "#C77DFF" , studio: "Hotta Studio", dailyTasks: "Daily tasks" },
  // No `resetOffsets`: nothing in the source states a server map that differs
  // from the regional default, and an offset invented here would move real
  // readers' day keys. Add one only against evidence — see games.ts § resetOffsets.
  p5x: { id: "p5x", name: "Persona 5: The Phantom X", short: "P5X", hue: "#D62246" , studio: "Perfect World", dailyTasks: "Daily missions, stamina" },
  // Reverse: 1999 runs one global server on a fixed UTC-5 and rolls its day at
  // **05:00**, not the 04:00 every other game here uses. Both facts come from
  // the source rather than from habit: all 154 rows on the wiki's event list
  // state `(UTC-5)`, and every one of them starts at 05:00 and ends at 04:59 —
  // an event ending one minute before the reset that the next one begins on.
  r1999: { id: "r1999", name: "Reverse: 1999", short: "R1999", hue: "#C9A227" , studio: "Bluepoch", dailyTasks: "Daily missions", resetOffsets: { asia: -5, america: -5, europe: -5 }, resetHourLocal: 5 },
  // No source registered yet: pathtonowhere.wiki.gg has no source for a live
  // or upcoming event anywhere on it (see CLAUDE.md § Path to Nowhere). Same
  // shape Arknights had in this file before its source existed.
  //
  // No `resetOffsets` or `resetHourLocal` either. Event pages on the wiki do
  // write `(Server Time)` on every date, and the handful still stating a full
  // range end one minute before what would be a 05:00 rollover — the same
  // shape as Reverse: 1999's evidence. But unlike r1999's `(UTC-5)`, nothing
  // on the wiki states what UTC offset "Server Time" actually is, so there is
  // no offset to encode — and that evidence predates the source's own most
  // recent edit by over a year, so it is not current either. Add both only
  // once a real source states the UTC offset.
  ptn: { id: "ptn", name: "Path to Nowhere", short: "PTN", hue: "#8FCC3D", studio: "Aisno Games", dailyTasks: "Daily Dispatch" },
};

export const GAME_LIST: GameMeta[] = Object.values(GAMES);

export function gameMeta(id: GameId): GameMeta {
  return GAMES[id];
}

/**
 * Meta for any lane, including one the reader invented (PRD F13).
 *
 * Pure, and total. Total matters: a lane id can outlive the game it names —
 * an import can carry an event whose game did not come with it, and a reader
 * can delete a game a stale render is still holding. Returning a neutral
 * placeholder keeps that a visible oddity rather than a blank screen, which is
 * the trade this codebase makes everywhere else in the client.
 */
export function metaFor(id: LaneId, custom: CustomGames): GameMeta {
  const tracked = GAMES[id as GameId];
  if (tracked !== undefined) return tracked;

  const own = custom[id];
  if (own !== undefined) {
    return {
      id: own.id as GameId,
      name: own.name,
      short: shortLabel(own.name),
      hue: own.hue,
      // Not credited in the colophon and contributing no standing chore: the
      // colophon lists the sources we fetch, and this game has none. See
      // docs/DATA-MODEL.md § Reader-authored key spaces.
      studio: "",
      dailyTasks: "",
    };
  }

  return {
    id: id as GameId,
    name: "Unknown game",
    short: "?",
    hue: "#9AA3B8",
    studio: "",
    dailyTasks: "",
  };
}

/** A name that still fits a narrow lane label or a chip. */
export function shortLabel(name: string): string {
  if (name.length <= 12) return name;
  const first = name.split(/\s+/)[0] ?? name;
  return first.length <= 12 ? first : `${name.slice(0, 11)}…`;
}
