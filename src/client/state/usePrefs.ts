import { useCallback, useEffect, useState } from "react";
import type { LaneId } from "../../shared/custom.ts";
import type { Region } from "../../shared/schema.ts";
import { guessRegion } from "../../shared/time.ts";
import type { SortMode } from "./sort.ts";
import { KEYS, readJson, writeJson } from "./storage.ts";

export interface Prefs {
  region: Region;
  /** Games the reader has switched off. Stored as hidden so a newly added game shows up by default. */
  hiddenGames: LaneId[];
  /**
   * One game to look at right now, or null for all of them.
   *
   * A lens, not a setting: it never changes `hiddenGames`, and a focus on a
   * game that is switched off or has left the feed is ignored rather than
   * obeyed (`resolveFocus`), so it can never leave the reader on a blank page
   * with no visible cause.
   */
  focusGame: LaneId | null;
  /** How the list is ordered. Deadline order is the default and the fallback. */
  sort: SortMode;
  /**
   * Whether to guess which events repeat daily from what the source printed.
   * Off leaves only the ones the reader marked themselves; it never discards a
   * mark or a logged day, so it is reversible.
   *
   * Off by default: the guess reads source wording and is wrong in both
   * directions, so a reader starts with only the dailies they chose. Readers
   * who already switched it on keep it — stored prefs win over this default.
   */
  detectDaily: boolean;
  showCompleted: boolean;
  /** Reveal events the reader has ignored, so they can be restored. */
  showIgnored: boolean;
  /** False until the reader confirms or changes the guessed region. */
  regionConfirmed: boolean;
  /** False until the reader has picked their games on first run. */
  onboarded: boolean;
  /** Which palette to render. "system" follows prefers-color-scheme. */
  theme: "dark" | "light" | "system";
}

function defaults(): Prefs {
  return {
    region: guessRegion(),
    hiddenGames: [],
    focusGame: null,
    sort: "ending",
    detectDaily: false,
    showCompleted: true,
    showIgnored: false,
    regionConfirmed: false,
    onboarded: false,
    theme: "system",
  };
}

export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs>(() => ({
    ...defaults(),
    ...readJson<Partial<Prefs>>(KEYS.prefs, {}),
  }));

  useEffect(() => {
    writeJson(KEYS.prefs, prefs);
  }, [prefs]);

  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((prev) => ({ ...prev, ...patch }));
  }, []);

  const toggleGame = useCallback((game: LaneId) => {
    setPrefs((prev) => ({
      ...prev,
      hiddenGames: prev.hiddenGames.includes(game)
        ? prev.hiddenGames.filter((g) => g !== game)
        : [...prev.hiddenGames, game],
    }));
  }, []);

  return { prefs, update, toggleGame };
}
