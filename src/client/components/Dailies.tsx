import { useEffect, useRef, useState } from "react";
import { dailiesId, dayKey, msUntilReset, streakOf } from "../../shared/daily.ts";
import { useGameMeta } from "../state/gameMeta.tsx";
import type { DisplayEvent, LaneId } from "../../shared/custom.ts";
import type { GameId, Region } from "../../shared/schema.ts";
import { formatRemaining } from "../../shared/time.ts";
import { Fireworks } from "./Fireworks.tsx";

/**
 * The chores no source publishes.
 *
 * Commissions, sanity, daily training — the routine that runs whether or not
 * an event is on. They are the most-missed thing in every one of these games
 * and they appear on no wiki page, so they are a fixed client-side list rather
 * than feed data. Ticking one is stored in exactly the same day log an event's
 * checklist uses, so streaks and exports work the same way for both.
 *
 * Running events that repeat sit here too, so ticking today off never means
 * opening a sheet to find the checklist. The checklist is still where the whole
 * run lives — this is just today's line of it.
 *
 * Sits above the event list because it is the one part of the page that is
 * answerable in ten seconds and expires tonight.
 */
export function Dailies({
  games,
  events,
  region,
  now,
  daysFor,
  onToggleDay,
}: {
  games: LaneId[];
  /**
   * Live events that repeat daily — detected, or marked by the reader — and
   * that the reader has not already finished or ignored. An event they marked
   * done has no line left to tick, and listing it is the app arguing with them.
   */
  events: DisplayEvent[];
  region: Region;
  now: number;
  daysFor: (id: string) => string[];
  onToggleDay: (id: string, day: string) => void;
}) {
  const gameMeta = useGameMeta();
  // Each game rolls on its own server clock, so "today" is asked per game
  // rather than once for the section — Reverse: 1999's day can still be
  // yesterday's while every HoYo game has already turned over.
  // Only tracked games have a standing chore — a lane the reader invented has
  // no routine we could name for them (docs/DATA-MODEL.md § Reader-authored key
  // spaces), so App passes tracked lanes here and this stays a total mapping.
  const chores = games.map((id) => ({
    key: dailiesId(id as GameId),
    game: gameMeta(id),
    today: dayKey(now, region, id),
    resetsIn: msUntilReset(now, region, id),
  }));
  const repeating = events.map((event) => ({
    key: event.id,
    event,
    game: gameMeta(event.game),
    today: dayKey(now, region, event.game),
    resetsIn: msUntilReset(now, region, event.game),
  }));

  const items = [...chores, ...repeating];
  const total = items.length;
  const complete = items.filter((i) => daysFor(i.key).includes(i.today)).length;
  const allDone = total > 0 && complete === total;

  const [burst, setBurst] = useState(0);
  // Null until the first render has been seen, so arriving at a page where
  // everything is already ticked is not treated as having just finished it.
  const previous = useRef<{ total: number; complete: number } | null>(null);

  useEffect(() => {
    const was = previous.current;
    previous.current = { total, complete };
    if (was === null || !allDone) return;
    // Celebrate finishing the last one, and only that. The list also gets
    // shorter when the reader focuses a single game or marks a repeating event
    // done, which can land on "all complete" without them having ticked
    // anything — a burst there is the app congratulating them for filtering.
    if (was.total === total && complete > was.complete) setBurst((n) => n + 1);
  }, [total, complete, allDone]);

  useEffect(() => {
    if (burst === 0) return;
    const id = setTimeout(() => setBurst(0), 1400);
    return () => clearTimeout(id);
  }, [burst]);

  if (total === 0) return null;

  // With mixed reset clocks there is no single "resets in", so the header
  // reports the next one to land and says that it is the next one.
  const soonest = Math.min(...items.map((i) => i.resetsIn));
  const mixed = new Set(items.map((i) => i.resetsIn)).size > 1;

  return (
    <section className="relative border-b border-hairline px-4 py-4">
      {burst > 0 && <Fireworks key={burst} />}

      <div className="relative flex items-baseline justify-between gap-3">
        <h2 className="eyebrow">
          Today's dailies · {complete}/{total}
        </h2>
        <p className="tnum text-[0.6875rem] text-faint">
          {mixed ? "next reset in " : "resets in "}
          {formatRemaining(soonest)}
        </p>
      </div>

      <ul className="relative mt-2.5 flex flex-wrap gap-1.5">
        {chores.map((chore) => (
          <li key={chore.key}>
            <TickChip
              label={chore.game.short}
              hue={chore.game.hue}
              title={chore.game.dailyTasks}
              ariaLabel={`${chore.game.name} dailies — ${chore.game.dailyTasks}`}
              days={daysFor(chore.key)}
              today={chore.today}
              onToggle={() => onToggleDay(chore.key, chore.today)}
            />
          </li>
        ))}

        {repeating.map((row) => (
          <li key={row.key}>
            <TickChip
              label={row.event.title}
              hue={row.game.hue}
              title={`${row.game.name} — ${row.event.title}`}
              ariaLabel={`${row.event.title} (${row.game.name})`}
              days={daysFor(row.key)}
              today={row.today}
              onToggle={() => onToggleDay(row.key, row.today)}
            />
          </li>
        ))}
      </ul>

      <p className="relative mt-2 text-[0.6875rem] leading-relaxed text-faint">
        {allDone
          ? "All done. Nothing else expires tonight."
          : `${waiting(total - complete)} still waiting on you today.`}
      </p>
    </section>
  );
}

/**
 * One thing to tick off today.
 *
 * The same pill whether it is a game's standing chore or an event that repeats:
 * to the reader at 23:50 they are the same job, and the distinction between
 * "the app knows about this" and "a wiki published it" is ours, not theirs.
 *
 * The game's hue is on the border in both states — faintly while the job is
 * outstanding, fully once it is done. A chip that only takes its colour on
 * completion means the strip you actually scan, the unfinished one, is a row of
 * identical grey pills with no clue which game each belongs to.
 *
 * The outstanding tint is kept low enough to read as a hint rather than a
 * state: it has to say *which game* without competing with the tick, which is
 * the only thing on the chip that answers the question the reader came with.
 * Ticking one should be a visible jump, not a nudge.
 */
function TickChip({
  label,
  hue,
  title,
  ariaLabel,
  days,
  today,
  onToggle,
}: {
  label: string;
  hue: string;
  title: string;
  ariaLabel: string;
  days: string[];
  today: string;
  onToggle: () => void;
}) {
  const isDone = days.includes(today);
  const streak = streakOf(days, today);

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={isDone}
      aria-label={`${ariaLabel}${isDone ? ", done today" : ", not done today"}`}
      title={title}
      // `.hue-chip` is the shared hover: the chip's own colours are the game's
      // hue and arrive inline, which no rule can override, so it is drawn from
      // what inline does not own. `--hue` below is the only thing it needs;
      // pressed-ness it reads off `aria-pressed`, which is already up there.
      className="hue-chip flex max-w-[15rem] items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium"
      style={{
        ["--hue" as string]: hue,
        borderColor: isDone ? hue : `color-mix(in srgb, ${hue} 20%, transparent)`,
        // Colour identifies the game; done-ness is carried by the tick, the
        // full-strength border and the wash. Keeping the label readable matters
        // more than saturating it, so an outstanding chip stays on muted ink.
        color: isDone ? hue : "var(--color-muted)",
        background: isDone
          ? `color-mix(in srgb, ${hue} 14%, transparent)`
          : `color-mix(in srgb, ${hue} 3%, transparent)`,
      }}
    >
      <svg viewBox="0 0 16 16" aria-hidden className="size-3 shrink-0">
        <path
          d="M2.5 8.5l3.5 3.5 7.5-8"
          fill="none"
          stroke={isDone ? "currentColor" : hue}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={isDone ? 1 : 0.25}
        />
      </svg>
      <span className="hue-chip-label truncate">{label}</span>
      {streak > 1 && (
        <span className="tnum shrink-0 text-[0.625rem] opacity-70">{streak}d</span>
      )}
    </button>
  );
}

function waiting(n: number): string {
  return n === 1 ? "One thing" : `${n} things`;
}
