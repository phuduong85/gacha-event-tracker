import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { EventForm } from "../src/client/components/CustomForms.tsx";
import { YourOwn } from "../src/client/components/YourOwn.tsx";
import { EventRow } from "../src/client/components/EventRow.tsx";
import { Colophon } from "../src/client/components/Colophon.tsx";
import { GameMetaProvider } from "../src/client/state/gameMeta.tsx";
import {
  asDisplayEvent,
  CustomEvent,
  type CustomEvents,
  type CustomGames,
} from "../src/shared/custom.ts";
import { metaFor } from "../src/shared/games.ts";
import { clockFor } from "../src/shared/time.ts";

/**
 * Static-render checks on the F13 surfaces.
 *
 * Not a substitute for using the thing, but they pin the two claims the feature
 * makes to a reader: their event is marked as theirs, and the end date is
 * allowed to be unknown.
 */

const AT = "2026-08-17T12:00:00.000Z";

const GAMES: CustomGames = {
  "mygame:limbus-company": {
    id: "mygame:limbus-company",
    name: "Limbus Company",
    hue: "#C74B50",
    at: AT,
  },
};

const OWN = CustomEvent.parse({
  id: "myevent:k3f9qa2m01",
  game: "mygame:limbus-company",
  title: "Walpurgisnacht",
  type: "banner",
  summary: null,
  startsAt: "2026-08-20T00:00:00.000Z",
  startPrecision: "day",
  endsAt: "2026-09-03T00:00:00.000Z",
  endPrecision: "day",
  at: AT,
  updatedAt: AT,
});

const EVENTS: CustomEvents = { [OWN.id]: OWN };

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(
    <GameMetaProvider value={(id) => metaFor(id, GAMES)}>{node}</GameMetaProvider>,
  );
}

describe("YourOwn", () => {
  const noop = () => {};
  const props = {
    games: GAMES,
    events: EVENTS,
    lanes: ["genshin", "mygame:limbus-company"],
    onAddGame: noop,
    onEditGame: noop,
    onRemoveGame: () => ({ removed: true, blockedBy: 0 }),
    onAddEvent: noop,
  };

  test("lists a reader's game with the events it holds", () => {
    const html = render(<YourOwn {...props} />);
    expect(html).toContain("Limbus Company");
    expect(html).toContain("1 event");
    expect(html).toContain("#C74B50");
  });

  test("shows a game with nothing in it rather than hiding it", () => {
    // A game they just made has to appear before it holds anything, or adding
    // one looks like it did nothing.
    const html = render(<YourOwn {...props} events={{}} />);
    expect(html).toContain("no events yet");
  });
});

describe("EventForm", () => {
  test("offers an unknown end rather than demanding a date", () => {
    // The whole point: a form that made the end mandatory would push the reader
    // into inventing one, which is the failure the parsers are forbidden from.
    const html = render(
      <EventForm
        lanes={["genshin", "mygame:limbus-company"]}
        customGames={GAMES}
        onSave={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(html).toContain("I don&#x27;t know when it ends");
  });

  test("puts the reader's own games at the top of the picker, and defaults to one", () => {
    // Someone entering an event by hand is usually doing it because the game
    // isn't tracked. Two of theirs to prove the group order, not just a swap.
    const twoOfMine: CustomGames = {
      ...GAMES,
      "mygame:silver-palace": {
        id: "mygame:silver-palace",
        name: "Silver Palace",
        hue: "#5C7CE0",
        at: AT,
      },
    };
    const html = renderToStaticMarkup(
      <GameMetaProvider value={(id) => metaFor(id, twoOfMine)}>
        <EventForm
          lanes={["genshin", "hsr", "mygame:limbus-company", "mygame:silver-palace"]}
          customGames={twoOfMine}
          onSave={() => {}}
          onCancel={() => {}}
        />
      </GameMetaProvider>,
    );

    // The game picker is the first select; the second is the event kind.
    const picker = html.slice(0, html.indexOf("</select>"));
    const order = [...picker.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
    expect(order).toEqual([
      "mygame:limbus-company",
      "mygame:silver-palace",
      // Tracked games keep their feed order behind them — the sort groups, it
      // does not reshuffle.
      "genshin",
      "hsr",
    ]);
    // The default follows the top of the list rather than staying on Genshin.
    expect(html).toContain('value="mygame:limbus-company" selected');
  });

  test("lets an event be filed under a tracked game too", () => {
    // A source can miss an event in a game we do cover.
    const html = render(
      <EventForm
        lanes={["genshin", "mygame:limbus-company"]}
        customGames={GAMES}
        onSave={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(html).toContain("Genshin Impact");
    expect(html).toContain("Limbus Company (yours)");
  });
});

describe("EventRow provenance", () => {
  const row = (id: string) => {
    const event = { ...asDisplayEvent(OWN), id };
    return { event, clock: clockFor(event, "america", Date.parse(AT)) };
  };

  test("marks the reader's own event as theirs", () => {
    const html = render(
      <ul>
        <EventRow row={row(OWN.id)} completed={false} onOpen={() => {}} />
      </ul>,
    );
    expect(html).toContain("yours");
  });

  test("does not mark a scraped event as theirs", () => {
    const html = render(
      <ul>
        <EventRow
          row={row("genshin:windblume-festival:2026-03-14")}
          completed={false}
          onOpen={() => {}}
        />
      </ul>,
    );
    expect(html).not.toContain(">yours<");
  });
});

describe("Colophon freshness notice (PRD F7)", () => {
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
    // Always rendered, not only on a problem: a footer that says nothing about
    // its own age reads as current.
    const html = renderToStaticMarkup(<Colophon sources={[fresh]} now={NOW} />);
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
      <Colophon
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
    const html = renderToStaticMarkup(<Colophon sources={behind} now={NOW} />);
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
      <Colophon sources={[...behind, fresh]} now={NOW} />,
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
      <Colophon sources={[{ ...fresh, lastSuccessAt: null }]} now={NOW} />,
    );
    expect(html).toContain("no source has been fetched yet");
    expect(html).toContain("Nothing has refreshed in over two days");
  });

  test("marks a never-fetched source as never, beside games that have", () => {
    const html = renderToStaticMarkup(
      <Colophon
        sources={[fresh, { ...fresh, sourceId: "r1999-src", game: "r1999", lastSuccessAt: null }]}
        now={NOW}
      />,
    );
    expect(html).toContain("Reverse: 1999 (never)");
  });
});
