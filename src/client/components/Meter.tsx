import type { Urgency } from "../../shared/time.ts";
import type { Prefs } from "../state/usePrefs.ts";

const TICKS = 24;
const DAY_MS = 24 * 60 * 60 * 1000;

export const URGENCY_COLOR: Record<Urgency, string> = {
  expired: "var(--color-faint)",
  critical: "var(--color-critical)",
  soon: "var(--color-soon)",
  near: "var(--color-near)",
  calm: "var(--color-calm)",
};

interface MeterProps {
  /** 0–1 through the event's own window. Null when the end is unannounced. */
  progress: number | null;
  /**
   * Raw time remaining, read only in `"days"` mode — `mode="percentage"`
   * callers may pass this as `null` even on an event with a known end, since
   * it goes unused. Null always means "unknown end" regardless of mode; the
   * two are never null independently of each other for the same event.
   */
  msRemaining: number | null;
  mode: Prefs["meterMode"];
  urgency: Urgency;
  /** Suppresses the entry animation for long lists. */
  animate?: boolean | undefined;
  label: string;
}

/**
 * The depletion meter — this interface's signature element.
 *
 * A discrete tick-strip rather than a smooth bar, borrowed from the stamina
 * meters these games all use. Ticks read as a countable resource in a way a
 * continuous bar does not, which is the right metaphor: what is left is
 * finite and visibly draining.
 *
 * An event with no announced end gets a hatched strip instead of a filled one.
 * It must not look like a full meter — "we don't know" and "loads of time" are
 * different facts and conflating them is the failure this product avoids.
 *
 * Two readings of the same 24 ticks (`Prefs["meterMode"]`, picked in the
 * Theme sheet). `"percentage"` slices the event's own window into 24 equal
 * shares, so what one tick means differs from event to event — a 5-day and a
 * 30-day event both drain across the same strip. `"days"` fixes what a tick
 * means instead — one literal day left — capped at 24: past that cap every
 * event just reads as a full bar, the same way it would if a countdown froze
 * at "24+" rather than ticking up forever, and it only starts counting down
 * once the real number drops inside the strip it has to show it in.
 */
export function Meter({
  progress,
  msRemaining,
  mode,
  urgency,
  animate = true,
  label,
}: MeterProps) {
  const unknown = mode === "days" ? msRemaining === null : progress === null;
  const remainingTicks = unknown
    ? 0
    : mode === "days"
      ? Math.max(0, Math.min(TICKS, Math.ceil((msRemaining as number) / DAY_MS)))
      : Math.max(0, Math.round((1 - (progress as number)) * TICKS));

  return (
    <div
      className="meter"
      role="img"
      aria-label={label}
      style={{ ["--tick" as string]: URGENCY_COLOR[urgency] }}
    >
      {Array.from({ length: TICKS }, (_, i) => {
        // Ticks drain from the right, so the surviving run sits at the left
        // edge and rows align into a readable ramp down the list.
        const live = i < remainingTicks;
        return (
          <span
            key={i}
            className="meter-tick"
            data-live={live}
            data-unknown={unknown}
            style={
              animate ? { animationDelay: `${Math.min(i, 12) * 14}ms` } : undefined
            }
          />
        );
      })}
    </div>
  );
}
