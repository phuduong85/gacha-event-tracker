import type { LaneId } from "../../shared/custom.ts";
import type { GameId } from "../../shared/schema.ts";
import { useGameIconUrl } from "../state/gameIcon.tsx";
import { useGameMeta } from "../state/gameMeta.tsx";
import type { Prefs } from "../state/usePrefs.ts";
import { GameIcon } from "./GameIcon.tsx";
import { YourOwn } from "./YourOwn.tsx";

export function Controls({
  games,
  prefs,
  onToggleGame,
  own,
}: {
  games: LaneId[];
  prefs: Prefs;
  onToggleGame: (g: LaneId) => void;
  /** Everything the reader entered themselves, and the ways to change it. */
  own: React.ComponentProps<typeof YourOwn>;
}) {
  const gameMeta = useGameMeta();
  const iconUrl = useGameIconUrl();
  return (
    <section className="border-t border-hairline px-4 py-5">
      {/* Which games and how they are read on one side, what the reader has
          added and what they can take away with them on the other. Two short
          columns beat one tall one here: settings are scanned for the one row
          you came to change. */}
      <div className="lg:grid lg:grid-cols-2 lg:gap-x-10">
        <div>
          <p className="eyebrow">Games</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {games.map((id) => {
              const game = gameMeta(id);
              const on = !prefs.hiddenGames.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onToggleGame(id)}
                  aria-pressed={on}
                  className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors"
                  style={{
                    borderColor: on ? game.hue : "var(--color-hairline)",
                    color: on ? game.hue : "var(--color-faint)",
                    background: on
                      ? `color-mix(in srgb, ${game.hue} 12%, transparent)`
                      : "transparent",
                  }}
                >
                  <GameIcon url={iconUrl(id as GameId)} name={game.name} size={14} />
                  {game.short}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <YourOwn {...own} />
        </div>
      </div>
    </section>
  );
}
