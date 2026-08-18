import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Archive } from "../src/client/components/Archive.tsx";
import { GameMetaProvider } from "../src/client/state/gameMeta.tsx";
import { GachaEvent } from "../src/shared/schema.ts";
import { metaFor } from "../src/shared/games.ts";
import { clockFor } from "../src/shared/time.ts";
import type { RowEvent } from "../src/client/components/EventRow.tsx";

const AT = "2026-08-17T12:00:00.000Z";

function row(overrides: Partial<GachaEvent> = {}): RowEvent {
  const event = GachaEvent.parse({
    id: "genshin:windblume-festival:2026-03-14",
    game: "genshin",
    title: "Windblume Festival",
    type: "banner",
    summary: null,
    startsAt: "2026-03-14T00:00:00.000Z",
    startPrecision: "day",
    endsAt: "2026-03-28T00:00:00.000Z",
    endPrecision: "day",
    regionScoped: false,
    regionEnds: null,
    confidence: 0.9,
    sourceId: "genshin-game8-events",
    sourceUrl: "https://game8.co/games/Genshin-Impact/archives/301601",
    status: "published",
    extractionMethod: "parser",
    version: 1,
    firstSeenAt: AT,
    updatedAt: AT,
    ...overrides,
  });
  return { event, clock: clockFor(event, "america", Date.parse(AT)) };
}

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(
    <GameMetaProvider value={(id) => metaFor(id, {})}>{node}</GameMetaProvider>,
  );
}

describe("Archive", () => {
  test("says so when nothing has been finished yet", () => {
    const html = render(
      <Archive rows={[]} effortFor={() => undefined} onOpen={() => {}} />,
    );
    expect(html).toContain("Nothing finished yet");
  });

  test("renders every finished event, marked complete", () => {
    const html = render(
      <Archive
        rows={[row(), row({ id: "hsr:trailblaze-anniversary:2026-04-01", game: "hsr" })]}
        effortFor={() => undefined}
        onOpen={() => {}}
      />,
    );
    expect(html).toContain("Windblume Festival");
    // EventRow's own "completed" styling: struck-through title, filled check.
    expect(html).toContain("line-through");
    expect(html).toContain("is-complete");
  });

  test("renders rows in whatever order the caller already sorted them", () => {
    // Sorting by progress.at rather than deadline is App.tsx's job — this
    // component trusts the order it is handed rather than re-sorting by
    // clock, which is what would happen if it reused the deadline sort.
    const first = row({ id: "genshin:a:2026-01-01", title: "Finished First" });
    const second = row({ id: "genshin:b:2026-06-01", title: "Finished Second" });
    const html = render(
      <Archive rows={[second, first]} effortFor={() => undefined} onOpen={() => {}} />,
    );
    expect(html.indexOf("Finished Second")).toBeLessThan(
      html.indexOf("Finished First"),
    );
  });
});
