import { isCustomEventId, type DisplayEvent } from "../../shared/custom.ts";
import type { GameId } from "../../shared/schema.ts";
import { useGameIconUrl } from "../state/gameIcon.tsx";
import { useGameMeta } from "../state/gameMeta.tsx";
import {
  formatRemaining,
  windowCaption,
  type EventClock,
} from "../../shared/time.ts";
import { EFFORT, pressure, type Effort } from "../../shared/effort.ts";
import type { Status } from "../state/useProgress.ts";
import type { Prefs } from "../state/usePrefs.ts";
import { Meter, URGENCY_COLOR } from "./Meter.tsx";

export interface RowEvent {
  event: DisplayEvent;
  clock: EventClock;
}

/** What a repeating event needs to say in a list: today, and how many left. */
export interface DailyBadge {
  doneToday: boolean;
  /** Days left including today. Null when the end is unannounced. */
  remaining: number | null;
}

interface EventRowProps {
  row: RowEvent;
  completed: boolean;
  status?: Status | undefined;
  effort?: Effort | undefined;
  /** Present only on events that repeat daily. */
  daily?: DailyBadge | undefined;
  /** Only ever true when the reader has chosen to reveal ignored events. */
  ignored?: boolean | undefined;
  onRestore?: ((id: string) => void) | undefined;
  onOpen: (id: string) => void;
  meterMode: Prefs["meterMode"];
}

export function EventRow({
  row,
  completed,
  status,
  effort,
  daily,
  ignored = false,
  onRestore,
  onOpen,
  meterMode,
}: EventRowProps) {
  const gameMeta = useGameMeta();
  const iconUrl = useGameIconUrl();
  const { event, clock } = row;
  const game = gameMeta(event.game);
  const icon = iconUrl(event.game as GameId);
  const heat = URGENCY_COLOR[clock.urgency];

  const caption = windowCaption(clock, Date.now());
  // Only ever a warning when the reader gave an estimate — inferring one to
  // justify the warning would be inventing their input.
  const risk = status === "done" ? "fine" : pressure(effort, clock.msRemaining);

  const countdown = clock.upcoming
    ? `starts in ${formatRemaining(clock.startsMs - Date.now())}`
    : clock.msRemaining === null
      ? "end date unknown"
      : formatRemaining(clock.msRemaining);

  return (
    <li
      className={`event-row relative overflow-hidden border-b border-hairline/70 ${
        completed ? "is-complete" : ""
      }`}
      style={{ ["--hue" as string]: game.hue }}
    >
      {/* The game's own icon, immense and faded, on the side the countdown
          already draws the eye to — identity without a second glance at the
          eyebrow label. Masked into the row rather than cropped square, so it
          reads as a watermark, not a second logo competing with the title. */}
      {icon !== null && (
        <img
          src={icon}
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 z-0 w-28 object-cover opacity-[0.32]"
          style={{
            maskImage: "linear-gradient(to right, transparent, black 55%)",
            WebkitMaskImage: "linear-gradient(to right, transparent, black 55%)",
          }}
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      )}

      {/* The whole row opens the event. A single full-bleed target gives a
          generous tap area on mobile and one unambiguous hover region — the
          content above it is pointer-transparent so clicks fall through. */}
      <button
        type="button"
        onClick={() => onOpen(event.id)}
        className="absolute inset-0 z-0 cursor-pointer"
      >
        <span className="sr-only">View {event.title} details</span>
      </button>

      <div className="pointer-events-none relative z-10 flex gap-3 px-4 py-3.5">
        {/* Game identity rail. Grows on hover — the cheapest possible signal
            that this row is live under the cursor. */}
        <span aria-hidden className="row-rail mt-0.5 w-[3px] shrink-0 rounded-full" />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <div className="min-w-0">
              <span className="eyebrow flex items-center gap-1.5 truncate">
                <span style={{ color: game.hue }}>{game.short}</span>
                {/* A date the reader typed is never allowed to look like one
                    a source published. */}
                {isCustomEventId(event.id) && (
                  <span className="rounded-[3px] border border-hairline px-1 py-px text-[0.5625rem] tracking-normal text-faint">
                    yours
                  </span>
                )}
                {ignored && (
                  <span className="rounded-[3px] bg-hairline px-1 py-px text-[0.5625rem] tracking-normal text-muted">
                    ignored
                  </span>
                )}
              </span>
              <span
                className={`row-title block truncate text-[0.9375rem] font-medium leading-snug ${
                  completed ? "line-through decoration-faint" : ""
                }`}
              >
                {event.title}
              </span>
            </div>

            <span
              className="tnum row-count shrink-0 font-display text-sm font-semibold"
              style={{
                color: clock.msRemaining === null ? "var(--color-faint)" : heat,
              }}
            >
              {countdown}
            </span>
          </div>

          {(status === "doing" ||
            effort !== undefined ||
            daily !== undefined ||
            risk !== "fine") && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {/* A repeating event's real deadline is tonight's reset, not the
                  end date the countdown shows, so the row says both. */}
              {daily !== undefined && (
                <span
                  className={`rounded-[3px] px-1.5 py-px text-[0.625rem] font-medium ${
                    daily.doneToday
                      ? "bg-near/15 text-near"
                      : "bg-soon/15 text-soon"
                  }`}
                >
                  {daily.doneToday
                    ? "daily · done today"
                    : daily.remaining === null
                      ? "daily · not today"
                      : `daily · ${daily.remaining} left`}
                </span>
              )}
              {status === "doing" && (
                <span className="rounded-[3px] bg-near/15 px-1.5 py-px text-[0.625rem] font-medium text-near">
                  doing
                </span>
              )}
              {effort !== undefined && (
                <span className="rounded-[3px] bg-hairline px-1.5 py-px text-[0.625rem] text-muted">
                  {EFFORT[effort].label.toLowerCase()}
                </span>
              )}
              {risk !== "fine" && (
                <span
                  className="rounded-[3px] px-1.5 py-px text-[0.625rem] font-medium"
                  style={{
                    background:
                      risk === "unlikely"
                        ? "color-mix(in srgb, var(--color-critical) 18%, transparent)"
                        : "color-mix(in srgb, var(--color-soon) 18%, transparent)",
                    color:
                      risk === "unlikely"
                        ? "var(--color-critical)"
                        : "var(--color-soon)",
                  }}
                >
                  {risk === "unlikely" ? "running out of time" : "tight"}
                </span>
              )}
            </div>
          )}

          {event.summary !== null && (
            <p className="row-summary mt-1 line-clamp-2 text-[0.8125rem] leading-snug text-muted">
              {event.summary}
            </p>
          )}

          <div className="mt-2.5">
            <Meter
              progress={clock.upcoming ? 1 : clock.progress}
              msRemaining={clock.upcoming ? 0 : clock.msRemaining}
              mode={meterMode}
              urgency={clock.urgency}
              label={`${event.title}: ${caption}`}
            />
            {/* Says what the bar is a proportion of. Without this the ticks
                are a shape the reader has to guess the meaning of. */}
            <p className="mt-1.5 text-[0.6875rem] leading-none text-faint">
              {caption}
            </p>
          </div>
        </div>

        {/* The trailing control used to tick an event done from the list. It
            does not any more: "done" was never the only thing a reader wants
            to say about an event, and a tick they can hit by accident on the
            way to opening it is a bad trade. The row opens the sheet, where
            status, effort, notes and a daily checklist all live; this is just
            the affordance saying so.

            The one exception is a revealed ignored row, where undo is a real
            action with nowhere better to sit. */}
        {ignored && onRestore !== undefined ? (
          <button
            type="button"
            onClick={() => onRestore(event.id)}
            aria-label={`Stop ignoring ${event.title}`}
            className="row-check pointer-events-auto relative z-20 grid size-7 shrink-0 cursor-pointer place-items-center self-center rounded-md border border-hairline text-faint"
          >
            <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
              <path
                d="M2.5 8a5.5 5.5 0 1 0 1.7-4M2.5 2.5V6H6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ) : (
          // Decorative: the full-bleed button behind the row is already the
          // control, and a second one with the same effect would just be an
          // extra stop for anyone tabbing or using a screen reader.
          <span
            aria-hidden
            className={`row-check row-open grid size-7 shrink-0 place-items-center self-center rounded-md ${
              completed ? "text-near" : "text-faint"
            }`}
          >
            {completed ? (
              <svg viewBox="0 0 16 16" className="size-3.5">
                <path
                  d="M2.5 8.5l3.5 3.5 7.5-8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" className="size-3.5">
                <path
                  d="M6 3l5 5-5 5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </span>
        )}
      </div>
    </li>
  );
}
