import { useState } from "react";
import type { GameId } from "../../shared/schema.ts";
import { useGameMeta } from "../state/gameMeta.tsx";
import { GameIcon } from "./GameIcon.tsx";

/** Kept in sync with serve.ts's own cap — this is only a courtesy early
 * rejection so a reader isn't left waiting on a round trip for a file the
 * server was always going to refuse; the server's check is the real one. */
const MAX_ICON_BYTES = 2 * 1024 * 1024;

/**
 * Upload an icon for one tracked game, password-gated.
 *
 * The password is asked for per game the first time within this page load,
 * then kept in memory (component state, not localStorage) so uploading
 * several games in a row doesn't mean retyping it each time — cleared on
 * reload, same as never having been entered. There is no account here to
 * remember it for; this is the one control on the whole page that isn't
 * purely local, and it stays that narrow.
 */
export function IconUpload({
  games,
  iconUrl,
  onUploaded,
}: {
  /** Tracked games only — custom (reader-invented) lanes have no GameId to
   * upload against. */
  games: GameId[];
  iconUrl: (id: GameId) => string | null;
  onUploaded: () => void;
}) {
  const gameMeta = useGameMeta();
  const [editing, setEditing] = useState<GameId | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(gameId: GameId, file: File) {
    if (file.size > MAX_ICON_BYTES) {
      setError(`${file.name} is over ${MAX_ICON_BYTES / (1024 * 1024)}MB.`);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const url = new URL(`api/game-icon/${gameId}`, document.baseURI);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "X-Upload-Password": password,
          "Content-Type": file.type || "application/octet-stream",
        },
        body: file,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(body?.error ?? `Upload failed (${res.status}).`);
        return;
      }
      setEditing(null);
      onUploaded();
    } catch {
      setError("Upload failed — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  if (games.length === 0) return null;

  return (
    <>
      <p className="eyebrow text-ink">Game icons</p>
      <p className="mt-4">
        Shown next to a game's title wherever it appears. Password-gated —
        only someone who knows it can add or replace one.
      </p>

      <ul className="mt-3 flex flex-col gap-1.5">
        {games.map((id) => {
          const game = gameMeta(id);
          const url = iconUrl(id);
          const isEditing = editing === id;
          return (
            <li key={id} className="flex items-center gap-2">
              <GameIcon url={url} name={game.name} size={20} />
              <span className="flex-1 truncate text-xs" style={{ color: game.hue }}>
                {game.name}
              </span>
              {isEditing ? (
                <div className="flex items-center gap-1.5">
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                    autoFocus
                    className="w-24 rounded-md border border-hairline bg-transparent px-2 py-1 text-xs text-ink"
                  />
                  <label
                    className={`rounded-md border border-hairline px-2 py-1 text-xs text-muted transition-colors hover:text-ink ${
                      busy || password.length === 0
                        ? "pointer-events-none opacity-50"
                        : "cursor-pointer"
                    }`}
                  >
                    {busy ? "Uploading…" : "Choose file"}
                    <input
                      type="file"
                      accept="image/png,image/webp,image/jpeg,image/gif"
                      className="sr-only"
                      disabled={busy || password.length === 0}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (file) void upload(id, file);
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(null);
                      setError(null);
                    }}
                    className="text-xs text-faint transition-colors hover:text-ink"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setEditing(id);
                    setError(null);
                  }}
                  className="rounded-md border border-hairline px-2 py-1 text-xs text-muted transition-colors hover:text-ink"
                >
                  {url === null ? "Upload" : "Replace"}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {error !== null && (
        <p className="mt-2 text-xs text-critical" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
