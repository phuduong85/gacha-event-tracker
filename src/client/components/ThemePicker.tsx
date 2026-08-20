import type { ThemeChoice } from "../state/theme.ts";
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

export function ThemePicker({
  theme,
  meterMode,
  onUpdate,
  onClose,
}: {
  theme: Prefs["theme"];
  meterMode: Prefs["meterMode"];
  onUpdate: (p: Partial<Prefs>) => void;
  onClose: () => void;
}) {
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
    </Modal>
  );
}
