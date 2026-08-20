import { useCallback, useEffect, useState } from "react";
import { isCustomGameId, type LaneId } from "../../shared/custom.ts";
import type { Region } from "../../shared/schema.ts";
import { guessRegion } from "../../shared/time.ts";
import type { SortMode } from "./sort.ts";
import { KEYS, readJson, writeJson } from "./storage.ts";
import type { TimelineGroup } from "./lanes.ts";
import { DEFAULT_THEME_CHOICE, type ThemeChoice } from "./theme.ts";
import { DEFAULT_DAY_WIDTH } from "./zoom.ts";

/**
 * Which of the two views the reader is looking at.
 *
 * Lives here rather than in `App` because it is the reader's answer to "how do
 * I read this?", and component state loses it on every reload — a reader who
 * prefers the timeline was being put back on the list each time they opened the
 * page, with nothing to blame but the app forgetting.
 */
export type View = "soon" | "timeline" | "archive";

export interface Prefs {
  region: Region;
  /**
   * Games the reader has switched off.
   *
   * Still stored as the inverse, but no longer because a new game should
   * appear by default — see `knownGames`, which is what decides that now. It
   * stays the inverse because it is what every existing device has written
   * down, and rewriting a live key space to say the same thing differently
   * costs a migration and buys nothing.
   */
  hiddenGames: LaneId[];
  /**
   * Every lane this reader has been offered.
   *
   * A game we add is a game they never asked for. Turning eleven lanes into
   * fourteen under someone who plays two is not a feature arriving, it is
   * their calendar filling with events they will never open — so a lane that
   * is new *to them* arrives switched off, and the games chips in settings are
   * where they take it up.
   *
   * Absent means "never recorded", which is not the same as "has been offered
   * nothing": every existing reader is in that state, and seeding it from
   * what is on screen is what stops this from switching their games off the
   * first time they load a build that has it. Their own games (`mygame:`) are
   * recorded here too but never auto-hidden — they asked for those by typing
   * them in.
   */
  knownGames?: LaneId[];
  /**
   * One game to look at right now, or null for all of them.
   *
   * A lens, not a setting: it never changes `hiddenGames`, and a focus on a
   * game that is switched off or has left the feed is ignored rather than
   * obeyed (`resolveFocus`), so it can never leave the reader on a blank page
   * with no visible cause.
   */
  focusGame: LaneId | null;
  /** How the list is ordered. Deadline order is the default and the fallback. */
  sort: SortMode;
  /**
   * The view they were last reading. The list is the default: the page's whole
   * claim is answering "what expires next" in one look, and the timeline
   * answers "when is everything" — a slower question. One tap moves between
   * them and the choice is remembered from then on.
   */
  view: View;
  /**
   * How wide one day is on the timeline, in px.
   *
   * Stored as the measurement rather than a step number, so the ladder in
   * `state/zoom.ts` can change without silently rescaling boards that were set
   * before it did. Read through `snapDayWidth`, which is what makes a value
   * from an older export — or a corrupted one — land on something renderable.
   */
  timelineDayWidth: number;
  /**
   * How the timeline stacks its bars: a lane per game, or every game together
   * in deadline order.
   *
   * Remembered for the same reason `view` and `timelineDayWidth` are — it is
   * the reader's answer to "how do I read this?", and a board that went back to
   * lanes on every reload would make them say it again each time.
   *
   * Defaults to `"game"`, which is the board every existing reader already has.
   * A stored pref wins, so shipping this moves nobody's view.
   */
  timelineGroup: TimelineGroup;
  /**
   * Whether events that have not started yet are shown at all — the board
   * plots them, and the checklist keeps its "Not started yet" section.
   *
   * Off by default, and that is a claim about what this app is for: it answers
   * *what expires next*, and a reader with fourteen lanes has a next patch
   * queued behind every one of them. On the board it is also structural, since
   * the window is drawn from what is plotted — showing the future pushes the
   * right edge weeks past today and shrinks every running bar to make room.
   *
   * It sits with `showCompleted` and `showIgnored` because it is the same
   * question: what is the reader allowed to look at. It was called
   * `timelineUpcoming` while it governed only the board — see `adoptRenamed`,
   * which carries a reader's stored answer across rather than resetting it.
   */
  showUpcoming: boolean;
  /**
   * Whether those unstarted events keep to their own block on the board, under
   * a "Not started yet" heading, or sit in one deadline order with everything
   * else.
   *
   * Two readings of the same board, and both are right for somebody. Split
   * answers "what is on now, and what is queued behind it" — the shape of a
   * patch. Mixed answers "what runs out first", full stop, which is the
   * question a Gantt chart is for: an event opening on Friday and closing on
   * Sunday is a nearer deadline than one running now until October, and the
   * split order can never show that.
   *
   * The board only: the checklist splits them structurally, into a section with
   * a heading of its own, and always has.
   *
   * Defaults to `true`, the board as it was before this existed. Only read when
   * `showUpcoming` is on — with nothing unstarted plotted there is no block to
   * keep apart — but stored either way, so switching the parent back on
   * restores the answer they gave rather than a default.
   */
  timelineSplitUpcoming: boolean;
  /**
   * Whether to guess which events repeat daily from what the source printed.
   * Off leaves only the ones the reader marked themselves; it never discards a
   * mark or a logged day, so it is reversible.
   *
   * Off by default: the guess reads source wording and is wrong in both
   * directions, so a reader starts with only the dailies they chose. Readers
   * who already switched it on keep it — stored prefs win over this default.
   */
  detectDaily: boolean;
  showCompleted: boolean;
  /** Reveal events the reader has ignored, so they can be restored. */
  showIgnored: boolean;
  /**
   * Which ground the app is drawn on: `dark`, `light`, or `system` to follow
   * the device.
   *
   * Dark is the default and not a placeholder — see `DEFAULT_THEME_CHOICE`. The
   * value only decides colour: nothing about what is shown, sorted, counted or
   * stored changes with it, which is why it can be flipped mid-read with
   * nothing to save.
   */
  theme: ThemeChoice;
  /** False until the reader confirms or changes the guessed region. */
  regionConfirmed: boolean;
  /**
   * Whether the "Next to expire" panel is expanded. A reader who does not
   * lean on the headline deadline can collapse it down to its own heading,
   * and the answer is remembered rather than asked again every visit.
   */
  showNextUp: boolean;
  /**
   * What each tick of the depletion meter counts.
   *
   * `percentage` (the default) slices every event's own window into 24 equal
   * ticks regardless of how long that window is — a 5-day event and a
   * 30-day event both drain across the same 24 ticks, so what a filled tick
   * means differs event to event. `days` makes a tick mean one literal day
   * remaining instead, capped at 24: an event with more than 24 days left
   * shows a full bar until it actually crosses under 24, then counts down
   * one tick per day like the rest.
   */
  meterMode: "percentage" | "days";
}

function defaults(): Prefs {
  return {
    region: guessRegion(),
    hiddenGames: [],
    focusGame: null,
    sort: "ending",
    view: "soon",
    timelineDayWidth: DEFAULT_DAY_WIDTH,
    timelineGroup: "game",
    showUpcoming: false,
    timelineSplitUpcoming: true,
    detectDaily: false,
    showCompleted: true,
    showIgnored: false,
    theme: DEFAULT_THEME_CHOICE,
    regionConfirmed: false,
    showNextUp: true,
    meterMode: "percentage",
  };
}

/**
 * What to record and what to switch off when the set of lanes changes.
 *
 * Pure and separate from the hook because it decides whether a reader's games
 * get switched off, which is the kind of thing that should be provable rather
 * than watched for. Returns `null` when there is nothing to do, so the caller
 * writes to storage only when something actually changed.
 *
 * Two cases it must not get wrong:
 *
 * - **`known` absent.** Every reader who installed before this existed is in
 *   that state, and it means "unrecorded", not "has been offered nothing".
 *   Seeding records what is already on their screen and switches nothing off.
 * - **A lane they invented.** `mygame:` lanes are the reader asking for a game
 *   by typing it in, so they are recorded but never hidden. Only a lane that
 *   arrived because we added a source turns up switched off.
 */
export function adoptNewLanes(
  lanes: readonly LaneId[],
  known: readonly LaneId[] | undefined,
  hidden: readonly LaneId[],
): Partial<Prefs> | null {
  // An empty list is a feed that has not arrived, not a reader with no games.
  if (lanes.length === 0) return null;
  if (known === undefined) return { knownGames: [...lanes] };

  const fresh = lanes.filter((lane) => !known.includes(lane));
  if (fresh.length === 0) return null;

  const unasked = fresh.filter(
    (lane) => !isCustomGameId(lane) && !hidden.includes(lane),
  );
  return {
    knownGames: [...known, ...fresh],
    hiddenGames: [...hidden, ...unasked],
  };
}

/**
 * A stored `prefs` object with the one renamed field carried across.
 *
 * `timelineUpcoming` became `showUpcoming` when it stopped being about the
 * board alone. Dropping the old name would not lose data — this is one blob
 * under one key, not a key space — but it would silently reset the answer of
 * every reader who had switched the future on, and they would have to find the
 * setting again to say a thing they already said.
 *
 * A stored new name always wins, so this can never overwrite a fresher answer
 * with a stale one; and once written back under the new name the old one is
 * simply an unread leftover. Pure and exported so that is a test rather than a
 * claim.
 */
export function adoptRenamed(
  stored: Partial<Prefs> & { timelineUpcoming?: boolean },
): Partial<Prefs> {
  const { timelineUpcoming, ...rest } = stored;
  if (timelineUpcoming === undefined || rest.showUpcoming !== undefined) {
    return rest;
  }
  return { ...rest, showUpcoming: timelineUpcoming };
}

export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs>(() => ({
    ...defaults(),
    ...adoptRenamed(readJson<Partial<Prefs>>(KEYS.prefs, {})),
  }));

  useEffect(() => {
    writeJson(KEYS.prefs, prefs);
  }, [prefs]);

  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((prev) => ({ ...prev, ...patch }));
  }, []);

  const toggleGame = useCallback((game: LaneId) => {
    setPrefs((prev) => ({
      ...prev,
      hiddenGames: prev.hiddenGames.includes(game)
        ? prev.hiddenGames.filter((g) => g !== game)
        : [...prev.hiddenGames, game],
    }));
  }, []);

  return { prefs, update, toggleGame };
}
