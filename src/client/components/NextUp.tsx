import { useGameMeta } from "../state/gameMeta.tsx";
import { formatRemaining } from "../../shared/time.ts";
import type { RowEvent } from "./EventRow.tsx";
import { Meter, URGENCY_COLOR } from "./Meter.tsx";

/**
 * The thesis of the page: this app is a clock, so the first thing you see is
 * the event closest to expiring, at a size nothing else competes with.
 *
 * The two behind it are listed under it, small. A reader asked for the three
 * next deadlines and he was right that one is too few — finishing the headline
 * event used to leave the panel pointing at something with no context — but
 * three equal panels is a stat grid, and the reader arrives with one question.
 * So the shape is one answer and two follow-ups, not three answers.
 */
export function NextUp({
  rows,
  focused,
  onOpen,
  collapsed,
  onToggleCollapsed,
}: {
  /**
   * The soonest-expiring events the reader has neither finished nor ignored,
   * closest first. A panel headed "next to expire" is a list of deadlines they
   * still have to meet, so events they already ticked off do not belong in it
   * however visible they have chosen to keep them elsewhere.
   */
  rows: RowEvent[];
  /** Name of the game being focused on, when the page is narrowed to one. */
  focused: string | null;
  onOpen: (id: string) => void;
  /** Whether the panel is shrunk down to just its own heading. */
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const gameMeta = useGameMeta();
  const [lead, ...rest] = rows;

  const toggle = (
    <button
      type="button"
      onClick={onToggleCollapsed}
      aria-expanded={!collapsed}
      className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-faint transition-colors duration-150 hover:text-ink"
    >
      <EyeIcon open={!collapsed} />
      {collapsed ? "Show" : "Hide"}
    </button>
  );

  if (lead === undefined) {
    return (
      <section className={`border-b border-hairline px-4 ${collapsed ? "py-3" : "py-8"}`}>
        <div className="flex items-center justify-between gap-3">
          <p className="eyebrow">Nothing running</p>
          {toggle}
        </div>
        {!collapsed && (
          <p className="mt-2 max-w-sm text-sm text-muted">
            {focused === null
              ? "Nothing live and unfinished in the games you have switched on. Turn a game back on below, or check again after the next patch."
              : `Nothing live and unfinished in ${focused}. Move to the next game, or show all of them.`}
          </p>
        )}
      </section>
    );
  }

  const { event, clock } = lead;
  const game = gameMeta(event.game);
  const heat = URGENCY_COLOR[clock.urgency];
  const known = clock.msRemaining !== null;

  return (
    <section
      className={`relative overflow-hidden border-b border-hairline px-4 pt-5 ${
        collapsed ? "pb-3" : "pb-6"
      }`}
    >
      {/* A wash of the urgency colour, so the panel itself changes temperature
          as the deadline closes in. */}
      {!collapsed && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-24 h-48 opacity-[0.16] blur-2xl"
          style={{ background: `radial-gradient(60% 100% at 50% 100%, ${heat}, transparent)` }}
        />
      )}

      <div className="relative flex items-center justify-between gap-3">
        <p className="eyebrow">Next to expire</p>
        {toggle}
      </div>

      {!collapsed && (
        <div className="relative">
          {/* The one thing on the page a reader is most likely to tap, and it was
              the only clickable text here that did not answer the cursor — the
              queued rows under it brighten, the row list brightens, and this sat
              inert and read as a heading rather than a way in. */}
          <button
            type="button"
            onClick={() => onOpen(event.id)}
            className="group mt-2 block max-w-full text-left"
          >
            <h1 className="font-display text-[1.75rem] font-semibold leading-[1.15] tracking-tight transition-colors duration-150 group-hover:text-ink-strong">
              {event.title}
            </h1>
            <p className="mt-1 text-sm" style={{ color: game.hue }}>
              {game.name}
            </p>
          </button>

          <div className="mt-5 flex items-end justify-between gap-4">
            <p
              className="tnum font-display text-[2.75rem] font-bold leading-none tracking-tight"
              style={{ color: known ? heat : "var(--color-faint)" }}
            >
              {known ? formatRemaining(clock.msRemaining ?? 0) : "unknown"}
            </p>
            <p className="pb-1 text-right text-xs leading-tight text-muted">
              {known ? "left" : "no end date"}
              <br />
              {known ? "to finish it" : "announced"}
            </p>
          </div>

          <div className="mt-4">
            <Meter
              progress={clock.progress}
              urgency={clock.urgency}
              label={`${event.title} time remaining`}
            />
          </div>

          {rest.length > 0 && (
            <div className="mt-5 border-t border-hairline pt-3">
              <p className="eyebrow">Then</p>
              <ul className="mt-1.5">
                {rest.map((row) => (
                  <QueuedRow key={row.event.id} row={row} onOpen={onOpen} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** An open or closed eye, for the collapse toggle. */
function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="size-3.5 shrink-0">
      <path
        d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
      {!open && (
        <line x1="2" y1="13" x2="14" y2="3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      )}
    </svg>
  );
}

/**
 * A deadline waiting behind the headline.
 *
 * Deliberately a different object from an `EventRow`: no meter, no summary, no
 * badges. Its whole job is "what is after this one, and how long have I got" —
 * anything more turns the panel into a second copy of the list it sits above.
 */
function QueuedRow({
  row,
  onOpen,
}: {
  row: RowEvent;
  onOpen: (id: string) => void;
}) {
  const gameMeta = useGameMeta();
  const { event, clock } = row;
  const game = gameMeta(event.game);
  const known = clock.msRemaining !== null;

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(event.id)}
        className="group flex w-full items-baseline gap-2.5 py-1.5 text-left"
      >
        <span
          aria-hidden
          className="size-1.5 shrink-0 translate-y-[-1px] rounded-full"
          style={{ background: game.hue }}
        />
        <span className="min-w-0 flex-1 truncate text-[0.8125rem] leading-snug text-muted transition-colors duration-150 group-hover:text-ink">
          <span className="sr-only">{game.name}: </span>
          {event.title}
        </span>
        <span
          className="tnum shrink-0 font-display text-xs font-semibold"
          style={{
            color: known ? URGENCY_COLOR[clock.urgency] : "var(--color-faint)",
          }}
        >
          {known ? formatRemaining(clock.msRemaining ?? 0) : "no end date"}
        </span>
      </button>
    </li>
  );
}
