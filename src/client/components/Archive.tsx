import type { Effort } from "../../shared/effort.ts";
import type { Prefs } from "../state/usePrefs.ts";
import { EventRow, type RowEvent } from "./EventRow.tsx";

/**
 * Everything the reader has marked done, browsable on its own.
 *
 * `showCompleted` still decides whether a finished event lingers in the main
 * list — that preference is about the one list it filters. This is the second
 * place: switching it off does not lose anything, because a done event's real
 * home is here regardless.
 */
export function Archive({
  rows,
  effortFor,
  onOpen,
  meterMode,
}: {
  /** Done events only, already sorted by when each was marked done. */
  rows: RowEvent[];
  effortFor: (id: string) => Effort | undefined;
  onOpen: (id: string) => void;
  meterMode: Prefs["meterMode"];
}) {
  if (rows.length === 0) {
    return (
      <p className="px-4 py-12 text-sm leading-relaxed text-muted">
        Nothing finished yet. Mark an event done and it moves here.
      </p>
    );
  }

  return (
    <ul className="border-t border-hairline">
      {rows.map((row) => (
        <EventRow
          key={row.event.id}
          row={row}
          completed
          status="done"
          effort={effortFor(row.event.id)}
          onOpen={onOpen}
          meterMode={meterMode}
        />
      ))}
    </ul>
  );
}
