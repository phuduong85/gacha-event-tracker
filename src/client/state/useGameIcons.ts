import { useCallback, useEffect, useState } from "react";
import type { GameId } from "../../shared/schema.ts";

export type IconManifest = Partial<Record<GameId, string>>;

/**
 * Which tracked games have an icon on disk, and the filename to show.
 *
 * Server state, not client state: `game-icons/manifest.json` is written by
 * `serve.ts`'s upload endpoint, not by anything in the browser, so this is a
 * fetch-and-cache rather than a `usePrefs`-style localStorage hook. A missing
 * manifest (nobody has uploaded anything yet) is not an error — `serve.ts`
 * 404s it deliberately rather than falling back to the app shell, and that
 * 404 just means "no icons yet" here.
 */
export function useGameIcons() {
  const [icons, setIcons] = useState<IconManifest>({});

  const refresh = useCallback(() => {
    // Resolved against <base>, same reasoning as fetchFeed: correct at a
    // domain root, under a subpath, and on a deep link alike.
    const url = new URL("game-icons/manifest.json", document.baseURI);
    fetch(url, { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<IconManifest>) : {}))
      .then(setIcons)
      // Offline, or the fetch itself failed — icons just don't show, which
      // is the same "not there yet" state as a fresh install.
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /** The URL for a game's icon, or null if it doesn't have one. */
  const iconUrl = useCallback(
    (game: GameId): string | null => {
      const file = icons[game];
      if (file === undefined) return null;
      return new URL(`game-icons/${file}`, document.baseURI).toString();
    },
    [icons],
  );

  return { icons, iconUrl, refresh };
}
