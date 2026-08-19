import { useEffect } from "react";

/**
 * The bottom-sheet-on-mobile, centered-sheet-on-desktop shell every dialog on
 * this page shares — Credits was first, Backup and the icon manager followed
 * it rather than each carrying their own copy of the backdrop, the Escape
 * handler, and the dialog frame.
 */
export function Modal({
  label,
  onClose,
  children,
}: {
  /** Both the visible heading a caller renders and the dialog's aria-label. */
  label: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label={`Close ${label.toLowerCase()}`}
        onClick={onClose}
        className="absolute inset-0 bg-ground/80 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="relative max-h-[88vh] w-full overflow-y-auto rounded-t-2xl border border-hairline bg-surface p-5 text-xs leading-relaxed text-faint sm:max-w-lg sm:rounded-2xl"
      >
        {children}
      </div>
    </div>
  );
}
