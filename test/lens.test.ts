import { describe, expect, test } from "bun:test";
import {
  advanceFocus,
  countByGame,
  firstToExpire,
  nextToExpire,
  outstanding,
  resolveFocus,
} from "../src/client/state/lens.ts";
import type { GameId } from "../src/shared/schema.ts";

const row = (id: string, game: GameId, msRemaining: number | null) => ({
  event: { id, game },
  clock: { msRemaining },
});

const none = () => false;

describe("outstanding", () => {
  const rows = [
    row("a", "genshin", 1000),
    row("b", "hsr", 2000),
    row("c", "zzz", 3000),
  ];

  test("drops what the reader has finished", () => {
    // The headline and the dailies strip both tell the reader what to do, and
    // pointing at a job they already ticked off is the app arguing with them.
    expect(outstanding(rows, (id) => id === "b", none).map((r) => r.event.id)).toEqual(
      ["a", "c"],
    );
  });

  test("drops what they have ignored", () => {
    expect(outstanding(rows, none, (id) => id === "a").map((r) => r.event.id)).toEqual(
      ["b", "c"],
    );
  });

  test("done and ignored at once is still just gone", () => {
    expect(outstanding(rows, (id) => id === "a", (id) => id === "a")).toHaveLength(2);
  });

  test("nothing outstanding is an empty list, not a null", () => {
    expect(outstanding(rows, () => true, none)).toEqual([]);
  });
});

describe("firstToExpire", () => {
  test("takes the soonest, not the first row", () => {
    // The list arrives sorted by whatever mode the reader chose. Under "doing
    // first" its head is what they are partway through, which is not what a
    // panel headed "next to expire" claims to be showing.
    const rows = [
      row("mid-run", "genshin", 9 * 86_400_000),
      row("tonight", "hsr", 3 * 3_600_000),
    ];
    expect(firstToExpire(rows)?.event.id).toBe("tonight");
  });

  test("an unannounced end is never the deadline while a real one exists", () => {
    const rows = [row("unknown", "zzz", null), row("real", "wuwa", 5000)];
    expect(firstToExpire(rows)?.event.id).toBe("real");
  });

  test("falls back to an unknown end when it is all there is", () => {
    // It is still a live event and still worth showing; it is just not a
    // countdown. Showing nothing would be worse.
    expect(firstToExpire([row("unknown", "zzz", null)])?.event.id).toBe("unknown");
  });

  test("no rows is null rather than a crash", () => {
    expect(firstToExpire([])).toBeNull();
  });
});

describe("nextToExpire", () => {
  test("orders by deadline, whatever order it was handed", () => {
    // Same argument as firstToExpire, three rows deep: the reader asked for the
    // three closest deadlines, not the first three rows of a list they had
    // sorted by what they are partway through.
    const rows = [
      row("mid-run", "genshin", 9 * 86_400_000),
      row("tomorrow", "hsr", 30 * 3_600_000),
      row("tonight", "zzz", 3 * 3_600_000),
    ];
    expect(nextToExpire(rows, 3).map((r) => r.event.id)).toEqual([
      "tonight",
      "tomorrow",
      "mid-run",
    ]);
  });

  test("takes only as many as asked for", () => {
    const rows = [
      row("a", "genshin", 1000),
      row("b", "hsr", 2000),
      row("c", "zzz", 3000),
    ];
    expect(nextToExpire(rows, 2).map((r) => r.event.id)).toEqual(["a", "b"]);
  });

  test("asking for more than there is returns what there is", () => {
    expect(nextToExpire([row("a", "genshin", 1000)], 3)).toHaveLength(1);
    expect(nextToExpire([], 3)).toEqual([]);
  });

  test("unannounced ends sort behind every real deadline", () => {
    // A panel of deadlines that leads with "unknown" is not a panel of
    // deadlines. They still appear once the dated ones run out, because the
    // event is real — it just is not a countdown.
    const rows = [
      row("unknown", "zzz", null),
      row("late", "wuwa", 90 * 86_400_000),
    ];
    expect(nextToExpire(rows, 2).map((r) => r.event.id)).toEqual([
      "late",
      "unknown",
    ]);
  });

  test("leaves the list it was given alone", () => {
    // It is handed the same array the list on screen is rendering from, and
    // sorting that in place would reorder the reader's list from under them.
    const rows = [row("b", "hsr", 2000), row("a", "genshin", 1000)];
    nextToExpire(rows, 2);
    expect(rows.map((r) => r.event.id)).toEqual(["b", "a"]);
  });
});

describe("resolveFocus", () => {
  const enabled: GameId[] = ["genshin", "hsr"];

  test("a focus on a game they still play stands", () => {
    expect(resolveFocus("hsr", enabled)).toBe("hsr");
  });

  test("a focus on a game they switched off is ignored, not obeyed", () => {
    // Obeying it leaves a blank page whose cause is a setting in a panel at the
    // bottom. The stored value is left alone, so switching the game back on
    // puts them back where they were.
    expect(resolveFocus("zzz", enabled)).toBeNull();
  });

  test("no focus is all games", () => {
    expect(resolveFocus(null, enabled)).toBeNull();
  });
});

describe("advanceFocus", () => {
  const enabled: GameId[] = ["genshin", "hsr", "zzz"];

  test("all games leads into the first one", () => {
    expect(advanceFocus(null, enabled)).toBe("genshin");
  });

  test("steps through in order", () => {
    expect(advanceFocus("genshin", enabled)).toBe("hsr");
    expect(advanceFocus("hsr", enabled)).toBe("zzz");
  });

  test("the last game leads back out to all of them", () => {
    // Not a wrap to the first: a rotation with no exit means the only way back
    // to everything is finding the "All" chip, which is the thing the rotation
    // was meant to save them.
    expect(advanceFocus("zzz", enabled)).toBeNull();
  });

  test("a focus that is no longer enabled restarts the rotation", () => {
    expect(advanceFocus("wuwa", enabled)).toBe("genshin");
  });

  test("no games to rotate through", () => {
    expect(advanceFocus(null, [])).toBeNull();
  });
});

describe("countByGame", () => {
  test("counts per game and omits games with nothing", () => {
    const counts = countByGame([
      row("a", "genshin", 1),
      row("b", "genshin", 2),
      row("c", "hsr", 3),
    ]);
    expect(counts).toEqual({ genshin: 2, hsr: 1 });
    expect(counts.zzz).toBeUndefined();
  });
});
