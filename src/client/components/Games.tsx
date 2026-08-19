import type { LaneId } from "../../shared/custom.ts";
import type { GameId } from "../../shared/schema.ts";
import { useGameIconUrl } from "../state/gameIcon.tsx";
import { useGameMeta } from "../state/gameMeta.tsx";
import { GameIcon } from "./GameIcon.tsx";
import { Modal } from "./Modal.tsx";

/** Which tracked and reader-invented games are switched on, in a sheet. */
export function Games({
  games,
  hiddenGames,
  onToggleGame,
  onClose,
}: {
  games: LaneId[];
  hiddenGames: LaneId[];
  onToggleGame: (g: LaneId) => void;
  onClose: () => void;
}) {
  const gameMeta = useGameMeta();
  const iconUrl = useGameIconUrl();
  return (
    <Modal label="Games" onClose={onClose}>
      <p className="eyebrow text-ink">Games</p>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {games.map((id) => {
          const game = gameMeta(id);
          const on = !hiddenGames.includes(id);
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
    </Modal>
  );
}
