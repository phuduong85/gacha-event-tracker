import type { Prefs } from "../state/usePrefs.ts";
import { Modal } from "./Modal.tsx";

/**
 * The two readings of a board with the future on it, and both are right for
 * somebody — see PRD F1.
 *
 * Kept as a pair of pills rather than a second checkbox because neither answer
 * is the absence of the other: "mixed in" is a different order, not a heading
 * switched off. A checkbox would name one of them and leave the other as
 * whatever is left over.
 */
const SPLITS: Array<{ split: boolean; label: string; hint: string }> = [
  {
    split: true,
    label: "In their own group",
    hint: "Each lane runs out, then a “Not started yet” heading and what is queued behind it — the shape the checklist has either way.",
  },
  {
    split: false,
    label: "Mixed in",
    hint: "One deadline order, started or not — so something opening Friday and closing Sunday sits above an event running until October.",
  },
];

/**
 * What the checklist and the board show, in a sheet rather than the settings
 * panel — the same move Backup and Icons already made. A reader reaches for
 * these rarely, and they do not need to cost room in the panel every visit.
 */
export function Options({
  prefs,
  onUpdate,
  ignoredCount,
  onClose,
}: {
  prefs: Pick<
    Prefs,
    | "showCompleted"
    | "showUpcoming"
    | "timelineSplitUpcoming"
    | "detectDaily"
    | "showIgnored"
  >;
  onUpdate: (p: Partial<Prefs>) => void;
  ignoredCount: number;
  onClose: () => void;
}) {
  return (
    <Modal label="Options" onClose={onClose}>
      <p className="eyebrow text-ink">Options</p>
      <div className="mt-4 flex flex-col gap-2">
        <label className="flex cursor-pointer select-none items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={prefs.showCompleted}
            onChange={(e) => onUpdate({ showCompleted: e.target.checked })}
            className="size-4 accent-[var(--color-near)]"
          />
          Show events I've finished
        </label>

        {/* One of the three "what am I allowed to look at" rows, and it
            reaches both views: the checklist's "Not started yet" section
            and the board's future bars are the same events answering the
            same question. Off is the default because this app answers
            *what expires next* — see PRD F1. */}
        <label className="flex cursor-pointer select-none items-start gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={prefs.showUpcoming}
            onChange={(e) => onUpdate({ showUpcoming: e.target.checked })}
            className="mt-px size-4 accent-[var(--color-near)]"
          />
          <span>
            Show events that haven't started
            <span className="mt-0.5 block max-w-xs leading-relaxed text-faint">
              Adds the checklist's "Not started yet" section, and plots
              them on the timeline — which draws its span from what it
              plots, so the board stretches weeks past today.
            </span>
          </span>
        </label>

        {/* Only while there is something to arrange. A choice about how
            unstarted events sit on the board is unanswerable when none
            are on it, and offering it anyway is a control that does
            nothing — the stored answer is kept either way, so switching
            the row above back on restores it rather than a default. */}
        {prefs.showUpcoming && (
          <div className="ml-6 flex flex-col gap-1.5">
            <div className="flex gap-1.5">
              {SPLITS.map((s) => (
                <button
                  key={String(s.split)}
                  type="button"
                  onClick={() => onUpdate({ timelineSplitUpcoming: s.split })}
                  aria-pressed={prefs.timelineSplitUpcoming === s.split}
                  className={`rounded-full border px-3 py-1 text-[0.6875rem] font-medium transition-colors ${
                    prefs.timelineSplitUpcoming === s.split
                      ? "border-ink/70 text-ink"
                      : "border-hairline text-faint hover:text-muted"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <p className="max-w-xs text-xs leading-relaxed text-faint">
              On the timeline.{" "}
              {SPLITS.find((s) => s.split === prefs.timelineSplitUpcoming)
                ?.hint}
            </p>
          </div>
        )}

        {/* Detection reads the source's wording and is wrong in both
            directions, so it ships off and says so. Off leaves only the
            events the reader marked, and discards nothing — every mark and
            logged day survives, so it can be switched back on. */}
        <label className="flex cursor-pointer select-none items-start gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={prefs.detectDaily}
            onChange={(e) => onUpdate({ detectDaily: e.target.checked })}
            className="mt-px size-4 accent-[var(--color-near)]"
          />
          <span>
            Spot daily events automatically
            <span className="ml-1.5 rounded-full border border-hairline px-1.5 py-0.5 align-[1px] text-[0.5625rem] font-medium uppercase tracking-wider text-faint">
              Experimental
            </span>
            <span className="mt-0.5 block max-w-xs leading-relaxed text-faint">
              Guessed from what the source wrote, so it misses some and
              invents others. Off, only events you mark yourself get a
              checklist. Your ticks and streaks are kept either way.
            </span>
          </span>
        </label>

        {ignoredCount > 0 && (
          <label className="flex cursor-pointer select-none items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={prefs.showIgnored}
              onChange={(e) => onUpdate({ showIgnored: e.target.checked })}
              className="size-4 accent-[var(--color-near)]"
            />
            Show the {ignoredCount} event{ignoredCount > 1 ? "s" : ""} I'm
            ignoring
          </label>
        )}
      </div>
    </Modal>
  );
}
