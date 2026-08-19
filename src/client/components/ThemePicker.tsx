import type { ThemeChoice } from "../state/theme.ts";
import type { Prefs } from "../state/usePrefs.ts";
import { Modal } from "./Modal.tsx";

/**
 * Dark first, because that is what the app is and what this control is offered
 * *from*; `System` last, because it is the answer that defers rather than
 * decides.
 */
const THEMES: Array<{ id: ThemeChoice; label: string }> = [
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
  { id: "system", label: "System" },
];

export function ThemePicker({
  theme,
  onUpdate,
  onClose,
}: {
  theme: Prefs["theme"];
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
    </Modal>
  );
}
