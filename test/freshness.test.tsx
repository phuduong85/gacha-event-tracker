import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Freshness } from "../src/client/components/Freshness.tsx";

/**
 * Moved out of Colophon's own tests when the freshness note moved out of the
 * footer and into the sidebar under the game list (Freshness.tsx) — same
 * behavior, same assertions, new home.
 */
describe("Freshness notice (PRD F7)", () => {
  const NOW = Date.parse("2026-08-17T12:00:00.000Z");
  const HOUR = 60 * 60 * 1000;

  const fresh = {
    sourceId: "genshin-game8-events",
    game: "genshin" as const,
    url: "https://game8.co/games/Genshin-Impact/archives/301601",
    lastSuccessAt: new Date(NOW - 3 * HOUR).toISOString(),
    eventCount: 9,
  };

  test("states when the data was refreshed, unprompted", () => {
    // Always rendered, not only on a problem: a note that says nothing about
    // its own age reads as current.
    const html = renderToStaticMarkup(<Freshness sources={[fresh]} now={NOW} />);
    expect(html).toContain("Event data last refreshed");
    expect(html).toContain("3h 0m ago");
    // The machine-readable instant is there for anyone checking the claim.
    // Matched case-insensitively: React emits the JSX spelling verbatim, and
    // HTML attribute names are case-insensitive, so either is correct.
    expect(html).toMatch(
      new RegExp(`<time [^>]*datetime="${fresh.lastSuccessAt}"`, "i"),
    );
    expect(html).not.toContain("not refreshed in over two days");
  });

  test("names the games that are behind, with how far", () => {
    const html = renderToStaticMarkup(
      <Freshness
        sources={[
          fresh,
          { ...fresh, sourceId: "p5x-game8-events", game: "p5x", lastSuccessAt: new Date(NOW - 80 * HOUR).toISOString() },
        ]}
        now={NOW}
      />,
    );
    // A count cannot be acted on; a name tells the reader which source page to
    // go and check.
    expect(html).toContain("Persona 5: The Phantom X");
    expect(html).toContain("not refreshed in over two days");
    expect(html).toContain("3d 8h ago");
    // The headline still reports the freshest confirmation.
    expect(html).toContain("3h 0m ago");
  });

  test("summarises instead of listing when every game is behind", () => {
    // What a refresh that stopped running looks like. Ten names each repeating
    // the same age is less readable than the count this replaced.
    const behind = (["genshin", "hsr", "zzz"] as const).map((game, i) => ({
      ...fresh,
      sourceId: `${game}-src`,
      game,
      lastSuccessAt: new Date(NOW - (80 + i) * HOUR).toISOString(),
    }));
    const html = renderToStaticMarkup(<Freshness sources={behind} now={NOW} />);
    expect(html).toContain("Nothing has refreshed in over two days");
    expect(html).not.toContain("Genshin Impact (");
  });

  test("caps the list and counts the remainder", () => {
    const behind = (["hsr", "zzz", "wuwa", "nte", "r1999", "p5x"] as const).map(
      (game, i) => ({
        ...fresh,
        sourceId: `${game}-src`,
        game,
        lastSuccessAt: new Date(NOW - (80 + i) * HOUR).toISOString(),
      }),
    );
    // `fresh` is Genshin, a game absent from the list above — otherwise its
    // sibling source would drag Genshin stale too and every game would be
    // behind, which is the other branch.
    const html = renderToStaticMarkup(
      <Freshness sources={[...behind, fresh]} now={NOW} />,
    );
    expect(html).toContain("and 2 other games");
    // Oldest first, so the two dropped are the *least* overdue, not an
    // arbitrary pair: P5X at 85h is named, Star Rail at 80h is summarised.
    expect(html).toContain("Persona 5: The Phantom X (");
    expect(html).not.toContain("Honkai: Star Rail (");
  });

  test("says so plainly when nothing has ever been fetched", () => {
    // A fresh checkout with no fixtures. The headline must not format a null,
    // and with every game unfetched the list collapses to the sentence.
    const html = renderToStaticMarkup(
      <Freshness sources={[{ ...fresh, lastSuccessAt: null }]} now={NOW} />,
    );
    expect(html).toContain("no source has been fetched yet");
    expect(html).toContain("Nothing has refreshed in over two days");
  });

  test("marks a never-fetched source as never, beside games that have", () => {
    const html = renderToStaticMarkup(
      <Freshness
        sources={[fresh, { ...fresh, sourceId: "r1999-src", game: "r1999", lastSuccessAt: null }]}
        now={NOW}
      />,
    );
    expect(html).toContain("Reverse: 1999 (never)");
  });
});
