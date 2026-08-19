import { useState } from "react";
import type { CustomEvents, CustomGames, LaneId } from "../../shared/custom.ts";
import { useGameMeta } from "../state/gameMeta.tsx";
import type { EventDraft } from "../state/useCustom.ts";
import { EventForm, GameForm } from "./CustomForms.tsx";

/**
 * The reader's own games and events, in the settings panel (PRD F13).
 *
 * Their events are managed from the event itself — open it and the detail sheet
 * offers edit and delete, exactly where you would look for them. What has no
 * other home is the list of games they invented, and the way in to adding the
 * first event, so both live here.
 */
export function YourOwn({
  games,
  events,
  lanes,
  onAddGame,
  onEditGame,
  onRemoveGame,
  onAddEvent,
}: {
  games: CustomGames;
  events: CustomEvents;
  /** Every lane an event may be filed under, tracked games included. */
  lanes: LaneId[];
  onAddGame: (name: string, hue: string) => void;
  onEditGame: (id: string, name: string, hue: string) => void;
  onRemoveGame: (id: string) => { removed: boolean; blockedBy: number };
  onAddEvent: (draft: EventDraft) => void;
}) {
  const gameMeta = useGameMeta();
  const [adding, setAdding] = useState<"game" | "event" | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const list = Object.values(games);

  return (
    <>
      <p className="eyebrow text-ink">Your own games and events</p>
      <p className="mt-4">
        Track something this app doesn't cover, or an event a source missed. Your
        dates are yours — they're never presented as coming from a wiki, and they
        travel in your export.
      </p>

      {list.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {list.map((game) => {
            const held = Object.values(events).filter(
              (e) => e.game === game.id,
            ).length;
            return (
              <li key={game.id}>
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: game.hue }}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">{game.name}</span>
                  <span className="shrink-0 text-xs text-faint">
                    {held === 0
                      ? "no events yet"
                      : `${held} event${held > 1 ? "s" : ""}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(editing === game.id ? null : game.id);
                      setRefusal(null);
                    }}
                    className="shrink-0 text-xs text-faint transition-colors hover:text-ink"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const result = onRemoveGame(game.id);
                      // Refused rather than cascading: deleting a lane should
                      // not quietly take a fortnight of events with it.
                      setRefusal(
                        result.removed
                          ? null
                          : `${game.name} still has ${result.blockedBy} event${
                              result.blockedBy > 1 ? "s" : ""
                            }. Delete those first.`,
                      );
                    }}
                    className="shrink-0 text-xs text-faint transition-colors hover:text-critical"
                  >
                    Delete
                  </button>
                </div>

                {editing === game.id && (
                  <GameForm
                    initial={{ name: game.name, hue: game.hue }}
                    onSave={(name, hue) => {
                      onEditGame(game.id, name, hue);
                      setEditing(null);
                    }}
                    onCancel={() => setEditing(null)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {refusal !== null && (
        <p className="mt-2 text-xs leading-relaxed text-critical">{refusal}</p>
      )}

      {adding === "game" && (
        <GameForm
          onSave={(name, hue) => {
            onAddGame(name, hue);
            setAdding(null);
          }}
          onCancel={() => setAdding(null)}
        />
      )}

      {adding === "event" && (
        <EventForm
          lanes={lanes}
          customGames={games}
          onSave={(draft) => {
            onAddEvent(draft);
            setAdding(null);
          }}
          onCancel={() => setAdding(null)}
        />
      )}

      {adding === null && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => setAdding("game")}
            className="rounded-lg border border-hairline px-3 py-1.5 text-xs text-muted transition-colors hover:text-ink"
          >
            Add a game
          </button>
          <button
            type="button"
            onClick={() => setAdding("event")}
            disabled={lanes.length === 0}
            className="rounded-lg border border-hairline px-3 py-1.5 text-xs text-muted transition-colors hover:text-ink disabled:opacity-40"
          >
            Add an event
          </button>
        </div>
      )}
    </>
  );
}
