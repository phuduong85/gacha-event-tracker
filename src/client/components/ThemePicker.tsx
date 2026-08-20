import { HEAT_RAMPS, type HeatRampId, type Theme, type ThemeChoice } from "../state/theme.ts";
import type { Prefs } from "../state/usePrefs.ts";
import { Modal } from "./Modal.tsx";

/**
 * Dark first, because that is what the app is and what this control is offered
 * *from*; `System` last, because it is the answer that defers rather than
 * decides. Glass sits beside Light rather than after System — it is a
 * deliberate pick like Light is, not a variant System can ever resolve to
 * (see `ThemeChoice` in state/theme.ts).
 */
const THEMES: Array<{ id: ThemeChoice; label: string }> = [
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
  { id: "glass", label: "Glass" },
  { id: "system", label: "System" },
];

/**
 * Percentage first: it's the default, and the one that scales to an event of
 * any length without the strip ever needing to say "24+".
 */
const METER_MODES: Array<{ id: Prefs["meterMode"]; label: string }> = [
  { id: "percentage", label: "Percentage" },
  { id: "days", label: "Per day" },
];

/**
 * Sunset first: it's the default, and every reader has already seen it.
 * Dark Sunset sits right beside it rather than off with Ocean and Mono — it
 * is that same ramp, not a different one, just worn on every ground instead
 * of dimmed for the ones that need it.
 */
const HEAT_RAMP_OPTIONS: Array<{ id: HeatRampId; label: string }> = [
  { id: "sunset", label: "Sunset" },
  { id: "sunsetDark", label: "Dark Sunset" },
  { id: "ocean", label: "Ocean" },
  { id: "mono", label: "Mono" },
];

export function ThemePicker({
  theme,
  resolvedTheme,
  meterMode,
  heatRamp,
  onUpdate,
  onClose,
}: {
  theme: Prefs["theme"];
  /**
   * What `theme` actually resolves to right now — `"system"` isn't a ground
   * to preview swatches against, so the ramp swatches below need the answer
   * `useTheme` already computed rather than the raw choice.
   */
  resolvedTheme: Theme;
  meterMode: Prefs["meterMode"];
  heatRamp: Prefs["heatRamp"];
  onUpdate: (p: Partial<Prefs>) => void;
  onClose: () => void;
}) {
  const ground = resolvedTheme === "dark" ? "dark" : "paper";
  return (
    <Modal label="Theme" onClose={onClose}>
      <p className="eyebrow text-ink">Theme</p>
      <div role="group" aria-label="Theme" className="mt-4 flex gap-1.5">
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onUpdate({ theme: t.id })}
            aria-pressed={theme === t.id}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              theme === t.id
                ? "border-ink/70 text-ink"
                : "border-hairline text-faint hover:text-muted"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* What a tick of the depletion meter counts — see Prefs["meterMode"]
          for the full "percentage of the event" vs "one literal day" split.
          A theme choice, not a checklist option: like Theme, it only changes
          how something already shown is drawn, never what is shown, sorted,
          or counted. */}
      <p className="eyebrow mt-5 text-ink">Meter</p>
      <div role="group" aria-label="Meter" className="mt-4 flex gap-1.5">
        {METER_MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onUpdate({ meterMode: m.id })}
            aria-pressed={meterMode === m.id}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              meterMode === m.id
                ? "border-ink/70 text-ink"
                : "border-hairline text-faint hover:text-muted"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* calm/near/soon/critical, colour rather than what a tick counts —
          see HeatRampId (state/theme.ts) for what each option is and why.
          Swatches are the current ground's actual values, live: a colour
          choice is exactly the kind of thing to see before picking, not
          read a name for. */}
      <p className="eyebrow mt-5 text-ink">Heat ramp</p>
      <div role="group" aria-label="Heat ramp" className="mt-4 flex flex-col gap-1.5">
        {HEAT_RAMP_OPTIONS.map((r) => {
          const palette = HEAT_RAMPS[r.id][ground];
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => onUpdate({ heatRamp: r.id })}
              aria-pressed={heatRamp === r.id}
              className={`flex items-center justify-between gap-3 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                heatRamp === r.id
                  ? "border-ink/70 text-ink"
                  : "border-hairline text-faint hover:text-muted"
              }`}
            >
              {r.label}
              <span className="flex items-center gap-1" aria-hidden>
                {[palette.calm, palette.near, palette.soon, palette.critical].map(
                  (c, i) => (
                    <span
                      key={i}
                      className="size-2.5 rounded-full"
                      style={{ background: c }}
                    />
                  ),
                )}
              </span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
