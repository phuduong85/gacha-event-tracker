import { Modal } from "./Modal.tsx";

/**
 * Export/import, in a sheet rather than the settings panel — the same move
 * Credits already made. There is no account and no server-side copy of
 * anything a reader marks or types, so this file is the only way any of it
 * survives a cleared browser or moves to another device.
 */
export function Backup({
  onExport,
  onImport,
  onClose,
}: {
  onExport: () => void;
  onImport: (file: File) => void;
  onClose: () => void;
}) {
  return (
    <Modal label="Backup" onClose={onClose}>
      <p className="eyebrow text-ink">Backup</p>
      <p className="mt-4">
        What you've finished, and every daily you've ticked off, are saved in
        this browser only — there is no account. Anything you added yourself
        is in there too. Move it all to another device with a file.
      </p>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onExport}
          className="rounded-lg border border-hairline px-3 py-1.5 text-xs text-muted transition-colors hover:text-ink"
        >
          Export
        </button>
        <label className="cursor-pointer rounded-lg border border-hairline px-3 py-1.5 text-xs text-muted transition-colors hover:text-ink">
          Import
          <input
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onImport(file);
              e.target.value = "";
            }}
          />
        </label>
      </div>
    </Modal>
  );
}
