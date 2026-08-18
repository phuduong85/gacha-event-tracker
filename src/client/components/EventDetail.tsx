import { useEffect, useState } from "react";
import { useGameMeta } from "../state/gameMeta.tsx";
import { useGameIconUrl } from "../state/gameIcon.tsx";
import {
  isCustomEventId,
  type CustomEvent,
  type CustomGames,
  type LaneId,
} from "../../shared/custom.ts";
import type { EventDraft } from "../state/useCustom.ts";
import { EventForm } from "./CustomForms.tsx";
import { formatAbsolute, formatRemaining } from "../../shared/time.ts";
import type { RowEvent } from "./EventRow.tsx";
import { pressure, pressureReason, type Effort } from "../../shared/effort.ts";
import type { Status } from "../state/useProgress.ts";
import { ProgressControls } from "./ProgressControls.tsx";
import { DailyChecklist } from "./DailyChecklist.tsx";
import { dailyOverride } from "../../shared/daily.ts";
import type { GameId, Region } from "../../shared/schema.ts";
import { GameIcon } from "./GameIcon.tsx";
import { Meter, URGENCY_COLOR } from "./Meter.tsx";

export function EventDetail({
  row,
  completed,
  ignored,
  status,
  effort,
  note,
  region,
  now,
  daily,
  detectedDaily,
  dailyDays,
  onDaily,
  onToggleDay,
  onIgnore,
  onStatus,
  onEffort,
  onNote,
  onClose,
  own,
}: {
  row: RowEvent;
  completed: boolean;
  ignored: boolean;
  status: Status | undefined;
  effort: Effort | undefined;
  note: string;
  region: Region;
  now: number;
  /** Whether to treat this as repeating, the reader's answer included. */
  daily: boolean;
  /** What the source's wording implies, so an override can fall back to it. */
  detectedDaily: boolean;
  /** Days already ticked off, for events that repeat. */
  dailyDays: string[];
  onDaily: (id: string, daily: boolean | undefined) => void;
  onToggleDay: (id: string, day: string) => void;
  onIgnore: (id: string) => void;
  onStatus: (id: string, s: Status | undefined) => void;
  onEffort: (id: string, e: Effort | undefined) => void;
  onNote: (id: string, n: string) => void;
  onClose: () => void;
  /**
   * Present only when this is an event the reader entered themselves, in which
   * case they can change it or take it back — this sheet is where anyone would
   * look for that, rather than a list in settings.
   */
  own?:
    | {
        record: CustomEvent;
        lanes: LaneId[];
        games: CustomGames;
        onSave: (id: string, draft: EventDraft) => void;
        onDelete: (id: string) => void;
      }
    | undefined;
}) {
  const gameMeta = useGameMeta();
  const iconUrl = useGameIconUrl();
  const [editing, setEditing] = useState(false);
  const { event, clock } = row;
  const game = gameMeta(event.game);
  const heat = URGENCY_COLOR[clock.urgency];
  const risk = status === "done" ? "fine" : pressure(effort, clock.msRemaining);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close details"
        onClick={onClose}
        className="absolute inset-0 bg-ground/80 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={event.title}
        className="relative max-h-[88vh] w-full overflow-y-auto rounded-t-2xl border border-hairline bg-surface p-5 sm:max-w-lg sm:rounded-2xl"
      >
        <p className="eyebrow flex items-center gap-1.5" style={{ color: game.hue }}>
          <GameIcon url={iconUrl(event.game as GameId)} name={game.name} size={16} />
          {game.name}
        </p>
        <h2 className="mt-1.5 font-display text-xl font-semibold leading-snug">
          {event.title}
        </h2>
        {/* Stated plainly, next to the title rather than buried at the bottom:
            a reader has to be able to tell which dates the app went and found
            and which ones they typed in themselves. */}
        {isCustomEventId(event.id) && (
          <p className="mt-1 text-xs text-faint">
            You added this. The dates are yours, not a source's.
          </p>
        )}
        {event.summary !== null && (
          <p className="mt-2 text-sm leading-relaxed text-muted">{event.summary}</p>
        )}

        <div className="mt-4">
          <Meter
            progress={clock.progress}
            urgency={clock.urgency}
            label="Time remaining"
            animate={false}
          />
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <Field label="Starts">
            {formatAbsolute(event.startsAt, event.startPrecision === "exact")}
          </Field>
          <Field label="Ends">
            {event.endsAt === null ? (
              <span className="text-faint">Not announced</span>
            ) : (
              formatAbsolute(event.endsAt, event.endPrecision === "exact")
            )}
          </Field>
          <Field label="Remaining">
            <span className="tnum font-display" style={{ color: heat }}>
              {clock.msRemaining === null
                ? "unknown"
                : formatRemaining(clock.msRemaining)}
            </span>
          </Field>
          <Field label="Type">{event.type}</Field>
        </dl>

        {risk !== "fine" && effort !== undefined && clock.msRemaining !== null && (
          <p
            className="mt-4 rounded-lg border px-3 py-2 text-xs leading-relaxed"
            style={{
              borderColor:
                risk === "unlikely"
                  ? "color-mix(in srgb, var(--color-critical) 40%, transparent)"
                  : "color-mix(in srgb, var(--color-soon) 40%, transparent)",
              color:
                risk === "unlikely" ? "var(--color-critical)" : "var(--color-soon)",
            }}
          >
            {pressureReason(effort, clock.msRemaining)} It is a rough guide, not a
            verdict — you know your own schedule.
          </p>
        )}

        {/* A repeating event gets the checklist instead of nothing but a
            "mark done" — its work is spread over every day of the run, and one
            tick cannot express that.

            Detection reads the source's wording and is wrong in both
            directions, so the reader can say. The control sits where the
            checklist goes, which is the one place the answer visibly matters. */}
        {daily ? (
          <>
            <DailyChecklist
              startsMs={clock.startsMs}
              endsMs={clock.endsMs}
              region={region}
              game={event.game}
              now={now}
              logged={dailyDays}
              onToggleDay={(day) => onToggleDay(event.id, day)}
            />
            <button
              type="button"
              onClick={() => onDaily(event.id, dailyOverride(false, detectedDaily))}
              className="mt-2 text-xs text-faint transition-colors hover:text-muted"
            >
              This isn't a daily event
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => onDaily(event.id, dailyOverride(true, detectedDaily))}
            className="mt-5 flex w-full items-center gap-2.5 rounded-xl border border-dashed border-hairline px-4 py-3 text-left transition-colors hover:border-faint"
          >
            <span aria-hidden className="text-base leading-none text-faint">＋</span>
            <span>
              <span className="block text-sm font-medium">
                It repeats daily
              </span>
              <span className="block text-xs leading-relaxed text-faint">
                Track it day by day, and tick today off as you go.
              </span>
            </span>
          </button>
        )}

        <ProgressControls
          status={status}
          effort={effort}
          note={note}
          onStatus={(s) => onStatus(event.id, s)}
          onEffort={(e) => onEffort(event.id, e)}
          onNote={(n) => onNote(event.id, n)}
        />

        {own !== undefined && (
          <div className="mt-4 border-t border-hairline pt-4">
            {editing ? (
              <EventForm
                lanes={own.lanes}
                customGames={own.games}
                initial={own.record}
                onSave={(draft) => {
                  own.onSave(event.id, draft);
                  setEditing(false);
                }}
                onCancel={() => setEditing(false)}
              />
            ) : (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="rounded-lg border border-hairline px-3 py-1.5 text-xs text-muted transition-colors hover:text-ink"
                >
                  Edit this event
                </button>
                <button
                  type="button"
                  onClick={() => {
                    own.onDelete(event.id);
                    onClose();
                  }}
                  className="rounded-lg border border-hairline px-3 py-1.5 text-xs text-muted transition-colors hover:text-critical"
                >
                  Delete
                </button>
              </div>
            )}
            {/* Their marks and logged days are not swept up with it: reaching
                into three other stores on one tap is how a misclick costs
                somebody a streak. */}
            <p className="mt-2 text-xs leading-relaxed text-faint">
              Deleting removes the event. Anything you ticked off stays.
            </p>
          </div>
        )}

        {event.endPrecision === "day" && event.endsAt !== null && (
          <p className="mt-3 text-xs leading-relaxed text-faint">
            The source gave a date but no time of day, so this end is accurate to
            the day only. Check in-game before the last hours.
          </p>
        )}

        {/* Says what it does and does what it says.

            It used to advance one step round the untouched → doing → done
            cycle, so a reader pressing a button labelled "Mark done" on a fresh
            event got "doing it" and had to press it again — and the second
            press from "done" silently wiped the status rather than undoing
            anything. Three states need three targets, which is what the control
            above is; this one is the commit, so it goes straight to done and
            back. */}
        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => onStatus(event.id, completed ? undefined : "done")}
            className={`flex-1 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
              completed
                ? "border-hairline text-muted hover:text-ink"
                : "border-transparent bg-ink text-ground hover:bg-white"
            }`}
          >
            {completed ? "Mark not done" : "Mark done"}
          </button>
          {/* Nothing to link to when the reader typed this themselves, and a
              dead "Source" button would imply somebody else vouched for the
              date. Provenance is stated above instead. */}
          {event.sourceUrl !== null && (
            <a
              href={event.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-lg border border-hairline px-4 py-2.5 text-sm text-muted transition-colors hover:text-ink"
            >
              Source
            </a>
          )}
        </div>

        {/* Ignoring is not completing. "Done" keeps an event visible and
            counted; "not interested" removes it from both views entirely. */}
        <button
          type="button"
          onClick={() => {
            onIgnore(event.id);
            if (!ignored) onClose();
          }}
          className="mt-3 w-full rounded-lg px-4 py-2 text-xs text-faint transition-colors hover:text-muted"
        >
          {ignored
            ? "Stop ignoring this event"
            : "Not interested — hide this event"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
