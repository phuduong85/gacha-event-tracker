import { createContext, useContext } from "react";
import type { GameId } from "../../shared/schema.ts";

/**
 * How a component turns a game id into its uploaded icon's URL, or null.
 *
 * A context for the same reason gameMeta.tsx's resolver is one: the data
 * (game-icons/manifest.json, fetched by useGameIcons) lives above wherever a
 * chip or a detail sheet wants to show an icon, and threading it through
 * every prop list in between would mean every intermediate component takes
 * a prop it has no use for itself.
 */
export type IconResolver = (id: GameId) => string | null;

const GameIconContext = createContext<IconResolver>(() => null);

export const GameIconProvider = GameIconContext.Provider;

export function useGameIconUrl(): IconResolver {
  return useContext(GameIconContext);
}
