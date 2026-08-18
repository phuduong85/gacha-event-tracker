/**
 * A game's uploaded icon, or nothing.
 *
 * Deliberately renders nothing rather than a placeholder when there is no
 * icon: every game already has its hue for identity (games.ts), so an empty
 * icon slot is not a broken image, it's just a game nobody has uploaded one
 * for yet.
 */
export function GameIcon({
  url,
  name,
  size = 16,
}: {
  url: string | null;
  name: string;
  size?: number;
}) {
  if (url === null) return null;
  return (
    <img
      src={url}
      alt=""
      // Decorative: the name is already carried by the text this sits next
      // to, and a screen reader announcing a redundant "Genshin Impact icon"
      // on every chip would be noise, not information.
      aria-hidden
      title={name}
      width={size}
      height={size}
      className="shrink-0 rounded-[3px] object-cover"
      style={{ width: size, height: size }}
      // A file that fails to load (deleted from disk after the manifest was
      // fetched, corrupt, etc.) disappears rather than showing the browser's
      // broken-image glyph next to every chip.
      onError={(e) => {
        e.currentTarget.style.display = "none";
      }}
    />
  );
}
