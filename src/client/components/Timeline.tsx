import { Fragment, useLayoutEffect, useRef } from "react";
import { useGameMeta } from "../state/gameMeta.tsx";
import { DAY } from "../../shared/time.ts";
import type { RowEvent } from "./EventRow.tsx";
import { URGENCY_COLOR } from "./Meter.tsx";
import {
  timelineLanes,
  TIMELINE_GROUPS,
  type TimelineGroup,
} from "../state/lanes.ts";
import { canStep, stepDayWidth, weekLabelStep } from "../state/zoom.ts";

/**
 * How far in from the left edge of the board a pinned label sits.
 *
 * Both the lane names and the event names stick here rather than riding off
 * with their own start dates. A six-week event begins weeks off-screen, and a
 * bar whose name scrolled away with its start date is a coloured rectangle.
 */
const PIN = 8;

/**
 * A sliver of time before now, so the "now" rule reads as a line in the view
 * rather than merging with the border.
 */
const HALF_DAY_LEAD = 12 * 60 * 60 * 1000;

/**
 * How far back the view can be scrolled beyond the oldest running event, so
 * "when did this start?" is answerable without the window being unbounded.
 */
const PAST_LEAD = 7 * DAY;

/**
 * The oldest date the board will draw, however long an event has been running.
 *
 * A standing login campaign can have started half a year ago, and the window
 * was drawn from the earliest start — so one such event bought months of empty
 * calendar to the left of everything else, which nobody scrolls back through
 * and which the reader pays for in every bar being pushed off to the right.
 * Two months is a patch cycle and a half: enough that a running event's start
 * is usually still on the board, and past the point where the answer stops
 * changing what anyone does today. A bar that begins before this keeps its
 * faded left edge, which is the same honesty the mask already carried — the
 * event is older than the board, not newly started at its edge.
 */
const PAST_LIMIT = 60 * DAY;

/** Where the now rule sits when the board opens: a little in from the edge. */
const OPEN_INSET = 28;

/** The narrowest a bar is drawn, so a two-day event is still a target. */
const MIN_BAR = 34;

/**
 * How wide a bar has to be before the merged board tags it with its game.
 *
 * The tag is what replaces the lane heading, so it wants to be on every bar —
 * but a bar narrower than this has no room for the tag *and* a title, and what
 * a reader gets is a truncated game name reading as a broken word. Below the
 * threshold the hue and the tooltip carry it, which is what a two-day bar could
 * say about itself anyway.
 */
const TAG_FROM = 96;

/**
 * How far apart two start markers have to be before both are drawn.
 *
 * Games ship on their own patch days, so at a wide scale several clumps land
 * within a few pixels of each other and their labels overlap into an unreadable
 * smear. Below this the later clump is folded into the earlier marker's count,
 * which is the honest reading anyway: "eleven things start around here".
 *
 * Sized to the widest label the marker draws rather than to a gridline, since
 * what collides is the text and not the rule. A merged marker says the span it
 * covers, so nothing is claimed about a date the board is not ruling.
 */
const MARKER_GAP = 104;

/**
 * One lane per game, bars spanning start→end, today pinned as a rule.
 *
 * The quiet view. The ending-soon list carries the page's boldness, so this
 * stays flat and legible: no gradients, no rounded chrome, just position and
 * length doing the work.
 *
 * It is a board rather than a stretch of page — its own pane, scrolling in both
 * directions, with the date axis pinned to the top and every name pinned to the
 * left. All three used to scroll away together, which is what made a wide
 * window worse rather than better: more calendar on screen, and nothing left
 * saying which day, whose game, or which event you were looking at.
 */
export function Timeline({
  rows,
  now,
  dayWidth,
  onZoom,
  group,
  onGroup,
  showUpcoming,
  splitUpcoming,
  onOpen,
  isDone,
}: {
  rows: RowEvent[];
  now: number;
  /** How wide one day is, in px. Snapped to the ladder in `state/zoom.ts`. */
  dayWidth: number;
  onZoom: (dayWidth: number) => void;
  /** How the bars are stacked: a lane per game, or one deadline queue. */
  group: TimelineGroup;
  onGroup: (group: TimelineGroup) => void;
  /**
   * Whether events that have not started yet are plotted.
   *
   * Off by default (`prefs.showUpcoming`, which governs the checklist's own
   * "Not started yet" section too). The board is asked "how does the time I am
   * in lay out?", and every lane has a next patch queued behind it — plotting
   * those unasked stretches the window weeks past today and squeezes the
   * running bars the reader came for.
   *
   * Read-only here: the switch lives in settings with the other two answers to
   * "what am I allowed to look at" (`Controls`), not in the board's own header
   * beside the stacking and scale controls. Those two reshape what is already
   * on the board, which is why they are reached for while reading it; this one
   * decides what is on it at all.
   */
  showUpcoming: boolean;
  /**
   * Whether those unstarted events keep to their own block under a heading, or
   * sit in one deadline order with the running ones
   * (`prefs.timelineSplitUpcoming`, and the switch is in settings beside the
   * one above).
   *
   * Mixed is not merely the heading switched off: the orders this board is
   * given all hold unstarted rows behind running ones, so dropping the label
   * alone would leave the same block with nothing explaining it. `lanes.ts`
   * re-sorts instead, and this only decides whether the heading is drawn.
   */
  splitUpcoming: boolean;
  onOpen: (id: string) => void;
  /**
   * Asked rather than derived from the progress store: an entry exists there
   * the moment a reader records an effort or a note, and dimming a bar for
   * that would say "finished" about something they have not started.
   */
  isDone: (id: string) => boolean;
}) {
  const gameMeta = useGameMeta();
  const scroller = useRef<HTMLDivElement>(null);

  // Held back rather than filtered away by the caller, so the control can say
  // how many there are — a board that silently drops a third of the schedule is
  // the same failure as a stale date, arriving as an absence.
  const waiting = rows.filter((r) => r.clock.upcoming);
  const plotted = showUpcoming ? rows : rows.filter((r) => !r.clock.upcoming);

  const ends = plotted.map((r) => r.clock.endsMs ?? r.clock.startsMs + 14 * DAY);
  const starts = plotted.map((r) => r.clock.startsMs);
  const { min, max } = boardWindow(starts, ends, now);
  const totalDays = Math.ceil((max - min) / DAY);
  const chartWidth = totalDays * dayWidth;
  /** One coordinate space for everything: bars, gridlines and the now rule. */
  const x = (ms: number) => ((ms - min) / DAY) * dayWidth;

  // Open at today rather than at the far past, with a little of the past week
  // still on screen — an event that began three days ago is context, not
  // history. Keyed on the rounded offset so it runs when the range changes,
  // not every second: re-scrolling on each tick would fight the reader.
  const openAt = Math.round(Math.max(0, x(now - HALF_DAY_LEAD) - OPEN_INSET));
  const jumpToNow = (behavior: ScrollBehavior) =>
    scroller.current?.scrollTo({ left: openAt, behavior });

  /**
   * A moment in time to hold still through the next re-render, and where in the
   * pane to hold it. Set when the reader zooms: rescaling around the left edge
   * of the scroll area would throw whatever they were reading off the screen,
   * and re-opening at today would undo the scrolling they did to get there.
   */
  const hold = useRef<{ ms: number; px: number } | null>(null);

  const zoom = (by: 1 | -1) => {
    const el = scroller.current;
    if (el !== null) {
      // The middle of the view is what a reader is looking at, so that is what
      // stays put.
      const px = el.clientWidth / 2;
      hold.current = { ms: min + ((el.scrollLeft + px) / dayWidth) * DAY, px };
    }
    onZoom(stepDayWidth(dayWidth, by));
  };

  // Before paint, so a zoom never shows a frame at the wrong offset.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el === null) return;
    const anchor = hold.current;
    if (anchor !== null) {
      hold.current = null;
      el.scrollLeft = Math.max(0, x(anchor.ms) - anchor.px);
      return;
    }
    // Open at today rather than at the far past: it is what they came for.
    // Keyed on the rounded offset so it runs when the range changes, not every
    // second — re-scrolling on each tick would fight the reader's own scrolling.
    el.scrollTo({ left: openAt, behavior: "instant" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openAt]);

  if (rows.length === 0) {
    return (
      <p className="px-4 py-10 text-sm text-muted">
        Nothing to plot. Switch a game back on to see its schedule.
      </p>
    );
  }

  const lanes = timelineLanes(plotted, group, splitUpcoming);
  const marks = startMarkers(plotted, x);

  const months = monthBoundaries(min, max);
  const weeks = weekBoundaries(min, max);
  // Every Monday is right at the default scale and illegible at the widest zoom
  // out, where the dates would sit on top of each other.
  const labelEvery = weekLabelStep(dayWidth);

  return (
    <>
      {/* The board's own header. The jump control lives out here rather than
          floating over the chart: pinned inside, it would sit on top of the
          calendar and cover the very dates it sends you back to. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-hairline px-4 py-2.5">
        <StackControl value={group} onChange={onGroup} />

        <div className="flex items-center gap-3">
          <div role="group" aria-label="Scale" className="flex items-center gap-1">
            <ScaleButton
              label="Show a longer stretch of time"
              disabled={!canStep(dayWidth, -1)}
              onClick={() => zoom(-1)}
            >
              −
            </ScaleButton>
            <ScaleButton
              label="Show a shorter stretch of time in more detail"
              disabled={!canStep(dayWidth, 1)}
              onClick={() => zoom(1)}
            >
              +
            </ScaleButton>
          </div>

          <button
            type="button"
            onClick={() => jumpToNow("smooth")}
            className="text-[0.6875rem] font-medium text-faint transition-colors duration-150 hover:text-ink"
          >
            Jump to today
          </button>
        </div>
      </div>

      {plotted.length === 0 ? (
        /* Not the same emptiness as no rows at all: everything the reader can
           see is still ahead of them, and the board is hiding it on purpose.
           Say which, or the control above reads as broken. */
        <p className="px-4 py-10 text-sm leading-relaxed text-muted">
          Nothing is running right now.{" "}
          {waiting.length === 1
            ? "One event has not started yet"
            : `${waiting.length} events have not started yet`}{" "}
          — switch on “Show events that haven't started” below to see when they
          begin.
        </p>
      ) : (
      <div
        ref={scroller}
        /*
         * The pane scrolls, not the page — which is what lets the axis stay
         * put. Capped rather than fixed: three lanes take the height they need
         * and nothing scrolls vertically at all.
         */
        className="scroll-pane relative max-h-[72vh] overflow-auto overscroll-x-contain"
      >
        <div className="relative" style={{ width: chartWidth, minWidth: "100%" }}>
          {/* Gridlines first, so everything else paints over them. */}
          <div aria-hidden className="pointer-events-none absolute inset-0">
            {weeks.map((ms) => (
              <span
                key={ms}
                className="absolute bottom-0 top-10 w-px bg-hairline/40"
                style={{ left: x(ms) }}
              />
            ))}
            {months.slice(1).map((m) => (
              <span
                key={m.ms}
                className="absolute bottom-0 top-10 w-px bg-hairline"
                style={{ left: x(m.ms) }}
              />
            ))}
          </div>

          {/* Now: the one rule that has to be findable from anywhere. */}
          <div
            aria-hidden
            className="pointer-events-none absolute bottom-0 top-10 z-10 w-px bg-critical/80"
            style={{ left: x(now) }}
          >
            <span className="eyebrow absolute top-1 -translate-x-1/2 rounded-[3px] bg-critical px-1 py-px text-[0.5625rem] leading-none text-ground">
              now
            </span>
          </div>

          {/* Where the not-yet-started events begin, said in words.
              A bar drawn to the right of the now rule is the only thing saying
              "this has not started", and that reads as a fact about the layout
              rather than about the event — so each clump of starts gets a
              dashed rule and a label counting what opens there. Below the now
              rule in the stack: today is the one mark that has to win. */}
          {marks.map((mark) => (
            <div
              key={mark.ms}
              aria-hidden
              className="pointer-events-none absolute bottom-0 top-10 z-[5] w-px border-l border-dashed border-faint/60"
              style={{ left: x(mark.ms) }}
            >
              {/* Its own band under the `now` chip rather than beside it: at a
                  wide scale the first clump is a few pixels from today, and
                  sharing a line cost the label its first character to a chip
                  that is deliberately drawn on top of everything. */}
              <span className="tnum absolute top-5 whitespace-nowrap rounded-[3px] border border-hairline bg-ground px-1 py-px text-[0.5625rem] leading-none text-muted">
                {markerLabel(mark)}
              </span>
            </div>
          ))}

          {/* The axis: months above, week dates below, pinned to the top. */}
          <div className="sticky top-0 z-30 h-10 border-b border-hairline bg-ground/95 backdrop-blur">
            {months.map((m) => (
              <span
                key={m.ms}
                className="eyebrow absolute top-1 whitespace-nowrap pl-1.5 text-faint"
                style={{ left: x(m.ms) }}
              >
                {m.label}
              </span>
            ))}
            {weeks.map((ms, i) =>
              i % labelEvery === 0 ? (
                <span
                  key={ms}
                  className="tnum absolute bottom-1 whitespace-nowrap pl-1.5 text-[0.625rem] leading-none text-faint"
                  style={{ left: x(ms) }}
                >
                  {dayLabel(ms)}
                </span>
              ) : null,
            )}
          </div>

          {/* The top padding is the marker band's room — see the start markers
              above, which hang in it. */}
          <div className="space-y-7 pb-10 pt-9">
            {lanes.map((lane) => {
              const heading = lane.game === null ? null : gameMeta(lane.game);
              // Where this lane stops running and starts being scheduled.
              // Mixed in, there is no such place — the rows are one deadline
              // queue and a heading would be pointing at the middle of it.
              const breakAt = splitUpcoming ? splitAt(lane.rows) : -1;
              return (
                <div key={lane.id}>
                  {/* On its own line and pinned to the left edge, so the lane
                      keeps its name at any scroll position without a frozen
                      column standing on top of the calendar. Absent on the
                      merged board, where there is no one game to name — each
                      bar carries its own instead. */}
                  {heading !== null && (
                    <p
                      className="eyebrow sticky left-0 z-20 mb-2.5 w-fit bg-ground pr-2 text-[0.625rem]"
                      style={{ color: heading.hue, paddingLeft: PIN }}
                      title={heading.name}
                    >
                      {heading.short}
                    </p>
                  )}

                  <div className="relative space-y-2">
                    {lane.rows.map(({ event, clock }, i) => {
                      const game = gameMeta(event.game);
                      const unknownEnd = clock.endsMs === null;
                      const notStarted = clock.upcoming;
                      // Only clipped if it began before the rendered window,
                      // which reaches a week past the oldest running event — so
                      // in practice bars show their real start and the fade is
                      // reserved for genuinely truncated ones.
                      const clippedStart = clock.startsMs < min;
                      const left = Math.max(x(clock.startsMs), 0);
                      const right = x(clock.endsMs ?? clock.startsMs + 14 * DAY);
                      const width = Math.max(right - left, MIN_BAR);
                      const done = isDone(event.id);
                      return (
                        <Fragment key={event.id}>
                        {i === breakAt && <NotStarted />}
                        <button
                          type="button"
                          onClick={() => onOpen(event.id)}
                          // The game is in the tooltip on the merged board
                          // because the bar can be too narrow to show the tag
                          // it carries, and colour alone is not an answer once
                          // thirteen games share one stack.
                          title={
                            (heading === null
                              ? `${game.name} — ${event.title}`
                              : event.title) +
                            (notStarted
                              ? ` — not started yet, begins ${dayLabel(clock.startsMs)}`
                              : "")
                          }
                          className={`relative flex h-9 items-center gap-2 rounded-[5px] px-3 text-left text-[0.75rem] font-medium transition-opacity hover:opacity-100 ${
                            done ? "opacity-35" : "opacity-90"
                          }`}
                          style={{
                            marginLeft: left,
                            width,
                            // Thinner wash on an event nobody can play yet, so
                            // a glance at the board separates what is running
                            // from what is merely scheduled without reading a
                            // single date.
                            background: `color-mix(in srgb, ${game.hue} ${
                              notStarted ? 11 : 22
                            }%, var(--color-surface))`,
                            // No start edge to draw when the bar begins before
                            // the view does. Dashed when the event has not
                            // started: the edge is a date in the future, not a
                            // thing that has happened.
                            borderLeft: clippedStart
                              ? undefined
                              : `3px ${notStarted ? "dashed" : "solid"} ${game.hue}`,
                            // Frayed right = end unannounced; faded left =
                            // started before the window. Both are honest about
                            // what is not shown.
                            maskImage: edgeMask(clippedStart, unknownEnd),
                            color: "var(--color-ink)",
                          }}
                        >
                          {/* Sticky clamps to the bar's own box, so a name can
                              never wander outside the event it belongs to. */}
                          <span
                            className="sticky flex min-w-0 items-center gap-1.5 truncate"
                            style={{ left: PIN }}
                          >
                            {heading === null && width >= TAG_FROM && (
                              <span
                                className="eyebrow shrink-0 text-[0.5625rem]"
                                style={{ color: game.hue }}
                              >
                                {game.short}
                              </span>
                            )}
                            <span className="min-w-0 truncate">{event.title}</span>
                            {notStarted && (
                              /* The dashed edge and the labelled rule above it
                                 say this to a reader looking at the board; a
                                 screen reader gets neither, and a bar that has
                                 not started is not a bar that is running. */
                              <span className="sr-only">
                                {" "}
                                — not started yet, begins{" "}
                                {dayLabel(clock.startsMs)}
                              </span>
                            )}
                          </span>
                          <span
                            aria-hidden
                            className="ml-auto size-1.5 shrink-0 rounded-full"
                            style={{ background: URGENCY_COLOR[clock.urgency] }}
                          />
                        </button>
                        </Fragment>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      )}
    </>
  );
}

/**
 * The span of time the board draws.
 *
 * It covers the past too, so a reader can scroll back to see when a running
 * event began — but it *opens* scrolled to now, because that is what they came
 * for. Rendering from the earliest start alone buried today off-screen; clamping
 * to now made the past unreachable; and an event that has been running for half
 * a year bought months of empty calendar that pushed everything else right.
 * `PAST_LIMIT` is the floor under that last case.
 *
 * Pure, and separate from the component, because it decides what a reader can
 * and cannot see — which is worth a test rather than a rendering.
 */
export function boardWindow(
  starts: readonly number[],
  ends: readonly number[],
  now: number,
): { min: number; max: number } {
  const earliest = Math.min(...starts, now) - PAST_LEAD;
  return {
    min: Math.max(earliest, now - PAST_LIMIT),
    max: Math.max(...ends, now) + 2 * DAY,
  };
}

/**
 * Lanes, or one queue.
 *
 * Sits in the board's own header rather than down in settings, for the reason
 * the list's sort control does: it is something a reader reaches for while
 * looking at the board, not a preference they go and configure. It reads as a
 * pair of pills rather than the view tabs' segmented control, because it
 * reshapes the thing below it instead of replacing it.
 */
function StackControl({
  value,
  onChange,
}: {
  value: TimelineGroup;
  onChange: (group: TimelineGroup) => void;
}) {
  return (
    <div role="group" aria-label="Stack the timeline" className="flex gap-1">
      {TIMELINE_GROUPS.map((mode) => {
        const on = value === mode.id;
        return (
          <button
            key={mode.id}
            type="button"
            onClick={() => onChange(mode.id)}
            aria-pressed={on}
            title={mode.hint}
            className={`rounded-full border px-2.5 py-1 text-[0.6875rem] font-medium transition-colors ${
              on
                ? "border-ink/60 text-ink"
                : "border-transparent text-faint hover:text-muted"
            }`}
          >
            {mode.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The line between what is running and what is only scheduled.
 *
 * The same object as a lane's name — a small label pinned to the left edge so
 * it survives any scroll position — because it is doing the same job: saying
 * what the bars under it are. A dashed edge and a thinner wash tell a reader
 * that *this* bar has not started; they do not tell them where the running
 * ones stopped, and a board read at a glance should not need the difference
 * decoded per bar.
 *
 * In muted ink rather than a game's hue, since a hue on this board means "whose
 * event is this" and this label is not about a game.
 */
function NotStarted() {
  return (
    <p
      className="eyebrow sticky left-0 z-20 w-fit bg-ground pb-0.5 pr-2 pt-2 text-[0.625rem] text-faint"
      style={{ paddingLeft: PIN }}
    >
      Not started yet
    </p>
  );
}

/**
 * The index of the first row that has not started, or -1 when none has.
 *
 * A single index rather than a per-row test, because the label marks a
 * *boundary* and there is only one: every sort this board can be given puts
 * live rows before upcoming ones — `endingSoonestFirst` on the merged board,
 * and both list modes in the lanes, which say so explicitly. If that ever
 * stopped holding, the honest repair is to fix the order rather than to scatter
 * the label wherever the sequence flips.
 *
 * Exported so the guarantee is a test rather than a comment.
 */
export function splitAt(
  rows: readonly { clock: { upcoming: boolean } }[],
): number {
  return rows.findIndex((r) => r.clock.upcoming);
}

/**
 * One step of the scale control.
 *
 * Labelled by what it does to the board rather than "zoom in" and "zoom out",
 * which say what happens to the picture and leave the reader to work out what
 * that means for the dates.
 */
function ScaleButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="grid size-6 place-items-center rounded-md border border-hairline text-xs font-semibold leading-none text-muted transition-colors duration-150 hover:border-faint hover:text-ink disabled:cursor-not-allowed disabled:border-hairline/60 disabled:text-faint/50 disabled:hover:text-faint/50"
    >
      {children}
    </button>
  );
}

/**
 * Fade a bar's edge where the truth extends past what is drawn: the left when
 * the event began before the view opens, the right when its end is unannounced.
 */
function edgeMask(clippedStart: boolean, unknownEnd: boolean): string | undefined {
  if (clippedStart && unknownEnd) {
    return "linear-gradient(90deg, transparent 0%, #000 14%, #000 60%, transparent 100%)";
  }
  if (clippedStart) return "linear-gradient(90deg, transparent 0%, #000 14%)";
  if (unknownEnd) return "linear-gradient(90deg, #000 60%, transparent 100%)";
  return undefined;
}

/** `18 Aug`, in the reader's own locale, for the week ticks. */
function dayLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

/**
 * Every Monday in range.
 *
 * Weeks are the unit these schedules are actually written in — a patch is six
 * of them — and a tick every seven days is the densest grid that still leaves
 * room for a date on it.
 */
function weekBoundaries(min: number, max: number): number[] {
  const d = new Date(min);
  d.setUTCHours(0, 0, 0, 0);
  // 0 is Sunday; step forward to the next Monday.
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7));
  const out: number[] = [];
  while (d.getTime() <= max) {
    out.push(d.getTime());
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
}

function monthBoundaries(min: number, max: number) {
  const short = (ms: number) =>
    new Date(ms).toLocaleDateString(undefined, { month: "short" });

  // The window opens mid-month, so the first real boundary can be weeks away.
  // Label the left edge with the current month or the opening stretch has no
  // date context at all.
  const out: Array<{ ms: number; label: string }> = [
    { ms: min, label: short(min) },
  ];

  const d = new Date(min);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCMonth(d.getUTCMonth() + 1);
  while (d.getTime() <= max) {
    out.push({ ms: d.getTime(), label: short(d.getTime()) });
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

/**
 * Where the not-yet-started events begin, and how many begin there.
 *
 * Gacha schedules are not a smooth stream of start dates: a game ships a patch
 * and six things open at once, so the honest unit is the clump, not the event.
 * Grouped by day and then merged again by *distance on screen*, because two
 * clumps a week apart are the same mark at six pixels a day and two separate
 * marks at a hundred and eight — and a merged one says the range it covers
 * rather than the first date in it, which would be a date the board is not
 * drawing a rule at.
 *
 * Pure and exported because it decides what a reader is told about the future,
 * which is worth a test rather than a rendering.
 */
export function startMarkers<
  T extends { clock: { upcoming: boolean; startsMs: number } },
>(
  rows: readonly T[],
  x: (ms: number) => number,
): Array<{ ms: number; through: number; count: number }> {
  const byDay = new Map<number, { ms: number; through: number; count: number }>();
  for (const row of rows) {
    if (!row.clock.upcoming) continue;
    const day = Math.floor(row.clock.startsMs / DAY);
    const at = byDay.get(day);
    if (at === undefined) {
      byDay.set(day, {
        ms: row.clock.startsMs,
        through: row.clock.startsMs,
        count: 1,
      });
    } else {
      at.ms = Math.min(at.ms, row.clock.startsMs);
      at.through = Math.max(at.through, row.clock.startsMs);
      at.count += 1;
    }
  }

  const out: Array<{ ms: number; through: number; count: number }> = [];
  for (const day of [...byDay.values()].sort((a, b) => a.ms - b.ms)) {
    const last = out[out.length - 1];
    if (last !== undefined && x(day.ms) - x(last.ms) < MARKER_GAP) {
      last.through = Math.max(last.through, day.through);
      last.count += day.count;
      continue;
    }
    out.push({ ...day });
  }
  return out;
}

/**
 * What a start marker says out loud.
 *
 * The whole reason the markers exist: a bar drawn to the right of the now rule
 * is only implicitly in the future, and "implicitly" is not a standard this app
 * holds itself to anywhere else a date is involved.
 */
export function markerLabel(mark: {
  ms: number;
  through: number;
  count: number;
}): string {
  const from = dayLabel(mark.ms);
  const to = dayLabel(mark.through);
  if (mark.count === 1) return `starts ${from}`;
  return from === to
    ? `${mark.count} start ${from}`
    : `${mark.count} start ${from}–${to}`;
}
