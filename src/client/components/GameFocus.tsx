import { useGameMeta } from "../state/gameMeta.tsx";
import { useGameIconUrl } from "../state/gameIcon.tsx";
import type { LaneId } from "../../shared/custom.ts";
import type { GameId } from "../../shared/schema.ts";
import type { SourceHealth } from "../../shared/feed.ts";
import { Freshness } from "./Freshness.tsx";
import { GameIcon } from "./GameIcon.tsx";

/**
 * One game at a time.
 *
 * The settings panel already lets a reader switch games on and off, but that is
 * a different job: it says which games they play, and it is set once. This is
 * the thing a reader does *while reading* — clear the deck down to one game,
 * finish it, move to the next. Doing that with the on/off switches means two
 * taps per game and a settings panel that no longer describes what they play.
 *
 * So focus is a lens, not a setting: it never changes which games are switched
 * on, "All" is always one tap away, and the rotation ends by returning to All
 * rather than looping forever.
 */
export function GameFocus({
  games,
  focus,
  counts,
  total,
  next,
  onFocus,
  onAdvance,
  sources,
  now,
  rail,
}: {
  /** Games the reader has switched on, in feed order. */
  games: LaneId[];
  focus: LaneId | null;
  /** Outstanding rows per game, so a chip says whether it is worth a visit. */
  counts: Partial<Record<LaneId, number>>;
  total: number;
  /** Where "next" goes — null means back to all games. */
  next: LaneId | null;
  onFocus: (game: LaneId | null) => void;
  onAdvance: () => void;
  /** For the freshness note under the list — see Freshness.tsx. */
  sources: SourceHealth[];
  now: number;
  /**
   * `true` inside App's narrow sidebar column at `lg:`, where a standing rail
   * of full-width chips fits the width it's given. `false` everywhere this
   * renders directly in the page instead — the timeline and archive views
   * have no sidebar, and a rail stretched across the whole page turned every
   * chip into its own full-width row, which is most of the screen before a
   * reader ever sees an event. Required rather than defaulted, so a new call
   * site has to say which one it means instead of silently inheriting the
   * rail meant for the sidebar.
   */
  rail: boolean;
}) {
  const gameMeta = useGameMeta();
  const iconUrl = useGameIconUrl();
  // With one game there is nothing to focus down to, and the picker would just
  // be a chip that does nothing — but the freshness note below still belongs
  // here regardless of how many games there are, so the section itself stays.
  const hasChoice = games.length >= 2;

  // Alphabetical by the label actually shown, not the underlying id or the
  // full name — sorting by a name the reader never sees ("Honkai: Star Rail")
  // would put the visible label ("Star Rail") somewhere that looks arbitrary.
  // "All" stays pinned first: it isn't a game being sorted, it's the way out
  // of focus entirely.
  const sorted = [...games].sort((a, b) =>
    gameMeta(a).short.localeCompare(gameMeta(b).short),
  );

  return (
    // Below `lg:`, always a horizontal strip that wraps as needed — the reach
    // a thumb already has on a phone, and the same shape `rail={false}` asks
    // for deliberately at every width. At `lg:` and up, `rail` decides
    // whether it becomes a standing left rail (the sidebar has the width to
    // spare for one) or stays a wrapped strip (everywhere else does not).
    //
    // No sticky/width/border of its own any more — the rail case sits inside
    // App's `<aside>`, which already owns those for the whole sidebar column
    // (this, NextUp, and Dailies together). Claiming them here too nested a
    // second sticky element inside an already-sticky, scrolling parent, which
    // is what overlapped this onto NextUp below it.
    <section className="border-b border-hairline px-4 py-3">
      {hasChoice && (
        <>
          <div
            className={`flex items-baseline justify-between gap-3 ${
              rail ? "lg:flex-col lg:items-start lg:gap-1" : ""
            }`}
          >
            <p className="eyebrow">Focus</p>
            <button
              type="button"
              onClick={onAdvance}
              className="shrink-0 text-[0.6875rem] font-medium text-faint transition-colors hover:text-ink"
            >
              {next === null ? "Show all games" : `Next: ${gameMeta(next).short}`}
              <span aria-hidden> →</span>
            </button>
          </div>

          <div
            role="group"
            aria-label="Focus on one game"
            className={
              rail
                ? "scroll-x -mx-4 mt-2 flex gap-1.5 px-4 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0 lg:pt-1"
                : "mt-2 flex flex-wrap gap-1.5"
            }
          >
            <Chip
              rail={rail}
              label="All"
              count={total}
              on={focus === null}
              hue="var(--color-ink)"
              onClick={() => onFocus(null)}
            />
            {sorted.map((id) => {
              const game = gameMeta(id);
              return (
                <Chip
                  rail={rail}
                  key={id}
                  label={game.short}
                  ariaLabel={game.name}
                  icon={iconUrl(id as GameId)}
                  count={counts[id] ?? 0}
                  on={focus === id}
                  hue={game.hue}
                  // Tapping the focused game backs out to all of them, so the
                  // chip that got you here is also the way back.
                  onClick={() => onFocus(focus === id ? null : id)}
                />
              );
            })}
          </div>
        </>
      )}

      <Freshness sources={sources} now={now} />
    </section>
  );
}

/**
 * A game chip.
 *
 * Carries its hue whether or not it is selected — dimmer when it is not — so
 * the row reads as a set of games at a glance rather than as one coloured chip
 * among a row of grey ones. The count is what makes it worth tapping: a game
 * with nothing outstanding says so before you visit it.
 */
function Chip({
  label,
  ariaLabel,
  icon,
  count,
  on,
  hue,
  onClick,
  rail,
}: {
  label: string;
  ariaLabel?: string | undefined;
  /** Null for "All", and for any game nobody has uploaded one for. */
  icon?: string | null | undefined;
  count: number;
  on: boolean;
  hue: string;
  onClick: () => void;
  /** See the `rail` prop on {@link GameFocus} — same sidebar-vs-standalone split. */
  rail: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={`${ariaLabel ?? label}, ${count} outstanding`}
      className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
        rail ? "lg:w-full lg:justify-between" : ""
      }`}
      style={{
        borderColor: on ? hue : `color-mix(in srgb, ${hue} 30%, transparent)`,
        color: on ? hue : "var(--color-muted)",
        background: on
          ? `color-mix(in srgb, ${hue} 14%, transparent)`
          : "transparent",
        // Nothing to do here — still reachable, just not competing for the eye.
        opacity: count === 0 && !on ? 0.5 : 1,
      }}
    >
      <span className="flex items-center gap-1.5">
        {icon !== null && icon !== undefined && (
          <GameIcon url={icon} name={ariaLabel ?? label} size={14} />
        )}
        {label}
      </span>
      <span className="tnum text-[0.625rem] opacity-70">{count}</span>
    </button>
  );
}
