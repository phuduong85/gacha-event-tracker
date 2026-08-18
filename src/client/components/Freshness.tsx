import { gameMeta } from "../../shared/games.ts";
import { freshness, type SourceHealth } from "../../shared/feed.ts";
import { formatAbsolute, formatRemaining } from "../../shared/time.ts";

/**
 * How many lagging games to name before summarising the rest.
 *
 * Naming them is the point — a reader can act on a name — but past a handful the
 * list stops being read, and every extra entry repeating the same age crowds out
 * the sentence that matters.
 */
const STALE_NAMES = 4;

/**
 * How current the calendar is, next to the game list rather than at the foot of
 * the page — this is the thing a reader has to be able to answer before
 * trusting a countdown (PRD F7), so it lives somewhere seen on every visit
 * rather than somewhere scrolled past.
 */
export function Freshness({
  sources,
  now,
}: {
  sources: SourceHealth[];
  now: number;
}) {
  const games = [...new Set(sources.map((s) => s.game))];
  const { refreshedAt, stale } = freshness(sources, now);
  const ago =
    refreshedAt === null ? null : formatRemaining(now - Date.parse(refreshedAt));

  return (
    <div className="mt-4 border-t border-hairline pt-3 text-[0.6875rem] leading-relaxed text-faint lg:mt-4 lg:pt-3">
      <p>
        <span className="text-muted">Event data last refreshed</span>{" "}
        {refreshedAt === null ? (
          "— no source has been fetched yet."
        ) : (
          <>
            <time dateTime={refreshedAt} className="text-muted">
              {formatAbsolute(refreshedAt, true)}
            </time>
            {` — ${ago} ago.`}
          </>
        )}
      </p>

      {stale.length > 0 && (
        // Named per game rather than counted, because a count is not something a
        // reader can act on: knowing *which* lane is behind tells them which
        // source page to go and check, which is the whole remedy on offer.
        //
        // Except when the answer is "all of them", which is what a refresh that
        // stopped running looks like. Ten names each repeating the same age is
        // less readable than the count this replaced, and the headline above
        // already gives the date — so that case gets a sentence, not a list.
        <p className="mt-1.5 text-soon">
          {stale.length === games.length ? (
            `Nothing has refreshed in over two days, so any end date here may have moved.`
          ) : (
            <>
              {stale.length === 1 ? "This game has" : "These games have"} not
              refreshed in over two days, so some of their end dates may have
              moved:{" "}
              {stale.slice(0, STALE_NAMES).map((s, i, shown) => (
                <span key={s.game}>
                  {i > 0 && (i === shown.length - 1 && stale.length <= STALE_NAMES ? " and " : ", ")}
                  {gameMeta(s.game).name}
                  {s.lastSuccessAt === null
                    ? " (never)"
                    : ` (${formatRemaining(now - Date.parse(s.lastSuccessAt))} ago)`}
                </span>
              ))}
              {stale.length > STALE_NAMES &&
                ` and ${stale.length - STALE_NAMES} other game${
                  stale.length - STALE_NAMES > 1 ? "s" : ""
                }`}
              {"."}
            </>
          )}
        </p>
      )}
    </div>
  );
}
