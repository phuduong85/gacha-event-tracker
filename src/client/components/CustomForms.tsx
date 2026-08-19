import { useState } from "react";
import {
  isCustomGameId,
  type CustomEvent,
  type CustomGames,
  type LaneId,
} from "../../shared/custom.ts";
import { EventType } from "../../shared/schema.ts";
import { useGameMeta } from "../state/gameMeta.tsx";
import { readerInstant, type EventDraft } from "../state/useCustom.ts";

/**
 * Entering a game and an event yourself (PRD F13).
 *
 * The forms deliberately mirror what a parser is allowed to produce rather than
 * what a database column will accept — most of all, **"I don't know" is a
 * first-class answer for the end date.** A form that made the end mandatory
 * would force a reader to invent one, which is the single failure this whole
 * product is built to avoid; it just happens to be the reader inventing it
 * instead of us.
 */

/**
 * Enough hues to tell lanes apart, none of them colliding with a tracked game.
 *
 * Stored raw, as picked. What a light-mode reader sees is a darkened reading of
 * these (`readableHue`), for the same reason the tracked games get one — the
 * palette was struck against the dark ground.
 */
export const CUSTOM_HUES = [
  "#C74B50",
  "#E08A3C",
  "#D9C34A",
  "#5FBF6A",
  "#4FB3C4",
  "#5C7CE0",
  "#9B6FD1",
  "#D46FA8",
];

const TYPES = EventType.options;

function labelClass(): string {
  return "block text-xs font-medium text-muted";
}

function inputClass(): string {
  return "mt-1 w-full rounded-lg border border-hairline bg-ground px-3 py-2 text-sm text-ink outline-none focus:border-faint";
}

export function GameForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: { name: string; hue: string } | undefined;
  onSave: (name: string, hue: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [hue, setHue] = useState(initial?.hue ?? CUSTOM_HUES[0]!);
  const valid = name.trim().length > 0 && name.trim().length <= 40;

  return (
    <form
      className="mt-3 rounded-xl border border-hairline p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSave(name, hue);
      }}
    >
      <label className={labelClass()}>
        Game name
        <input
          autoFocus
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          placeholder="Limbus Company"
          className={inputClass()}
        />
      </label>

      <p className={`${labelClass()} mt-3`}>Lane colour</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {CUSTOM_HUES.map((h) => (
          <button
            key={h}
            type="button"
            aria-label={`Use colour ${h}`}
            aria-pressed={hue === h}
            onClick={() => setHue(h)}
            className={`size-7 rounded-full border-2 transition-transform ${
              hue === h ? "scale-110 border-ink" : "border-transparent"
            }`}
            style={{ background: h }}
          />
        ))}
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={!valid}
          className="rounded-lg border border-transparent bg-ink px-3 py-1.5 text-xs font-medium text-ground transition-colors disabled:opacity-40"
        >
          Save game
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-hairline px-3 py-1.5 text-xs text-muted transition-colors hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Split a stored instant back into the date and time a form field wants. */
function fields(iso: string | null): { date: string; time: string } {
  if (iso === null) return { date: "", time: "" };
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

export function EventForm({
  lanes,
  customGames,
  initial,
  onSave,
  onCancel,
}: {
  /** Every lane an event can belong to — a source can miss an event too. */
  lanes: LaneId[];
  customGames: CustomGames;
  initial?: CustomEvent | undefined;
  onSave: (draft: EventDraft) => void;
  onCancel: () => void;
}) {
  const gameMeta = useGameMeta();
  const start = fields(initial?.startsAt ?? null);
  const end = fields(initial?.endsAt ?? null);

  // The reader's own games first, and so the default too. Someone filling this
  // in by hand is usually doing it *because* the game isn't tracked; making
  // them scroll past nine that are gets the common case backwards. Stable
  // within each group, so the tracked ones keep their feed order.
  const ordered = [...lanes].sort(
    (a, b) => Number(isCustomGameId(b)) - Number(isCustomGameId(a)),
  );

  const [game, setGame] = useState<LaneId>(
    initial?.game ?? ordered[0] ?? Object.keys(customGames)[0] ?? "",
  );
  const [title, setTitle] = useState(initial?.title ?? "");
  const [type, setType] = useState<EventType>(initial?.type ?? "other");
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [startDate, setStartDate] = useState(start.date);
  const [startTime, setStartTime] = useState(
    initial?.startPrecision === "exact" ? start.time : "",
  );
  // Separate from an empty end date so "I don't know" is a thing the reader
  // states, not a field they leave blank and hope about.
  const [endKnown, setEndKnown] = useState(initial ? initial.endsAt !== null : true);
  const [endDate, setEndDate] = useState(end.date);
  const [endTime, setEndTime] = useState(
    initial?.endPrecision === "exact" ? end.time : "",
  );

  const startsAt = startDate === "" ? null : readerInstant(startDate, startTime, "start");
  const endsAt =
    !endKnown || endDate === "" ? null : readerInstant(endDate, endTime, "end");

  const endMissing = endKnown && endDate !== "" && endsAt === null;
  const backwards = startsAt !== null && endsAt !== null && endsAt <= startsAt;
  const valid =
    title.trim().length > 0 &&
    game !== "" &&
    startsAt !== null &&
    !backwards &&
    !endMissing &&
    (!endKnown || endDate !== "");

  return (
    <form
      className="mt-3 rounded-xl border border-hairline p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid || startsAt === null) return;
        onSave({
          game,
          title,
          type,
          summary,
          startsAt,
          startHasTime: startTime !== "",
          endsAt,
          endHasTime: endTime !== "",
        });
      }}
    >
      <label className={labelClass()}>
        Game
        <select
          value={game}
          onChange={(e) => setGame(e.target.value)}
          className={inputClass()}
        >
          {ordered.map((id) => (
            <option key={id} value={id}>
              {gameMeta(id).name}
              {isCustomGameId(id) ? " (yours)" : ""}
            </option>
          ))}
        </select>
      </label>

      {/* Otherwise the list is eleven games we track and no sign of why none of
          them is theirs — the reader who came here to add a game we don't cover
          has no way of knowing they need to make it first. */}
      {Object.keys(customGames).length === 0 && (
        <p className="mt-1.5 text-xs leading-relaxed text-faint">
          These are the games we track. To file this under a game of your own,
          cancel and add the game first.
        </p>
      )}

      <label className={`${labelClass()} mt-3`}>
        What is it
        <input
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Walpurgisnacht"
          className={inputClass()}
        />
      </label>

      <label className={`${labelClass()} mt-3`}>
        Kind
        <select
          value={type}
          onChange={(e) => setType(e.target.value as EventType)}
          className={inputClass()}
        >
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className={labelClass()}>
          Starts
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className={inputClass()}
          />
        </label>
        <label className={labelClass()}>
          Time (optional)
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className={inputClass()}
          />
        </label>
      </div>

      {/* The end is allowed to be unknown, and says so out loud. Making it
          mandatory would push the reader into inventing a date, which is
          exactly the failure the parsers are forbidden from committing. */}
      <label className="mt-3 flex cursor-pointer select-none items-center gap-2 text-xs text-muted">
        <input
          type="checkbox"
          checked={!endKnown}
          onChange={(e) => setEndKnown(!e.target.checked)}
          className="size-4 accent-[var(--color-near)]"
        />
        I don't know when it ends
      </label>

      {endKnown && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className={labelClass()}>
            Ends
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className={inputClass()}
            />
          </label>
          <label className={labelClass()}>
            Time (optional)
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className={inputClass()}
            />
          </label>
        </div>
      )}

      <label className={`${labelClass()} mt-3`}>
        Note (optional)
        <input
          value={summary}
          maxLength={500}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="What you want to remember about it"
          className={inputClass()}
        />
      </label>

      {!endKnown && (
        <p className="mt-2 text-xs leading-relaxed text-faint">
          It'll show with no countdown and no daily checklist, the same as an
          event whose source hasn't announced an end.
        </p>
      )}
      {backwards && (
        <p className="mt-2 text-xs text-critical">
          That ends before it starts.
        </p>
      )}
      {endMissing && (
        <p className="mt-2 text-xs text-critical">That end date isn't a real date.</p>
      )}
      {startTime === "" && startDate !== "" && (
        <p className="mt-2 text-xs leading-relaxed text-faint">
          No time given, so this counts from the start of the day where you are —
          and to the end of the day it finishes on.
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={!valid}
          className="rounded-lg border border-transparent bg-ink px-3 py-1.5 text-xs font-medium text-ground transition-colors disabled:opacity-40"
        >
          {initial === undefined ? "Add event" : "Save changes"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-hairline px-3 py-1.5 text-xs text-muted transition-colors hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
