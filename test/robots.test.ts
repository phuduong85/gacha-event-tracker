import { describe, expect, test } from "bun:test";
import {
  agentToken,
  crawlDelayMs,
  groupFor,
  isAllowed,
  parseRobots,
  patternMatches,
  requestTarget,
  RobotsCache,
} from "../src/ingest/robots.ts";

const UA = "gacha-event-tracker/1.0 (+https://example.test/contact)";

describe("parseRobots", () => {
  test("groups consecutive user-agent lines together", () => {
    const robots = parseRobots(`
User-agent: alpha
User-agent: beta
Disallow: /private

User-agent: *
Disallow: /
`);
    expect(robots.groups).toHaveLength(2);
    expect(robots.groups[0]?.agents).toEqual(["alpha", "beta"]);
    expect(robots.groups[1]?.agents).toEqual(["*"]);
  });

  test("ignores comments, blank lines and unknown directives", () => {
    const robots = parseRobots(
      "# a comment\r\nUser-agent: *  # trailing\r\nHost: example.test\r\nDisallow: /x\r\nSitemap: https://example.test/sitemap.xml\r\n",
    );
    expect(robots.groups[0]?.rules).toEqual([{ allow: false, pattern: "/x" }]);
    expect(robots.sitemaps).toEqual(["https://example.test/sitemap.xml"]);
  });

  test("an empty Disallow restricts nothing", () => {
    const robots = parseRobots("User-agent: *\nDisallow:\n");
    expect(robots.groups[0]?.rules).toEqual([]);
    expect(isAllowed(robots, UA, "/anything")).toBe(true);
  });

  test("reads crawl-delay", () => {
    const robots = parseRobots("User-agent: *\nCrawl-delay: 10\nDisallow: /x\n");
    expect(crawlDelayMs(robots, UA)).toBe(10_000);
  });
});

describe("group selection", () => {
  test("takes the product token out of a full User-Agent header", () => {
    expect(agentToken(UA)).toBe("gacha-event-tracker");
  });

  test("a named group beats the wildcard group", () => {
    const robots = parseRobots(`
User-agent: *
Disallow: /

User-agent: gacha-event-tracker
Disallow: /admin
`);
    expect(isAllowed(robots, UA, "/games/Genshin-Impact/archives/301601")).toBe(
      true,
    );
    expect(isAllowed(robots, UA, "/admin/panel")).toBe(false);
  });

  test("falls back to the wildcard group when nothing names us", () => {
    const robots = parseRobots("User-agent: *\nDisallow: /games/\n");
    expect(isAllowed(robots, UA, "/games/x")).toBe(false);
  });

  test("no applicable group at all means allowed", () => {
    const robots = parseRobots("User-agent: gptbot\nDisallow: /\n");
    expect(groupFor(robots, UA)).toBeNull();
    expect(isAllowed(robots, UA, "/games/x")).toBe(true);
  });

  test("an unrelated named group cannot steal the wildcard group", () => {
    // Our contact URL contains "StereotypicalCat". Matching a group name
    // anywhere in the header made `User-agent: cat` look like our group, and
    // because a named group replaces `*`, that coincidence *discarded* the
    // rules the site actually wrote for everyone.
    const ua =
      "gacha-event-tracker/1.0 (+https://github.com/StereotypicalCat/gacha-event-tracker)";
    const robots = parseRobots(`
User-agent: *
Disallow: /games/

User-agent: cat
Disallow: /litter
`);
    expect(groupFor(robots, ua)?.agents).toEqual(["*"]);
    expect(isAllowed(robots, ua, "/games/x")).toBe(false);
    expect(isAllowed(robots, ua, "/litter")).toBe(true);
  });

  test("a substring of the product token does not name us either", () => {
    const robots = parseRobots(`
User-agent: *
Disallow: /games/

User-agent: gacha
Allow: /
`);
    expect(isAllowed(robots, UA, "/games/x")).toBe(false);
  });

  test("a group naming us with a version still binds", () => {
    const robots = parseRobots(`
User-agent: *
Disallow: /

User-agent: gacha-event-tracker/1.0
Disallow: /admin
`);
    expect(isAllowed(robots, UA, "/games/x")).toBe(true);
    expect(isAllowed(robots, UA, "/admin/panel")).toBe(false);
  });

  test("the longest matching agent name wins", () => {
    const robots = parseRobots(`
User-agent: googlebot
Disallow: /

User-agent: googlebot-news
Allow: /
`);
    expect(isAllowed(robots, "Googlebot-News/1.0", "/anything")).toBe(true);
    expect(isAllowed(robots, "Googlebot/2.1", "/anything")).toBe(false);
  });

  test("merges rules from several groups naming the same agent", () => {
    const robots = parseRobots(`
User-agent: gacha-event-tracker
Disallow: /a

User-agent: gacha-event-tracker
Disallow: /b
`);
    expect(isAllowed(robots, UA, "/a")).toBe(false);
    expect(isAllowed(robots, UA, "/b")).toBe(false);
    expect(isAllowed(robots, UA, "/c")).toBe(true);
  });
});

describe("path matching", () => {
  test("prefix match, wildcards and the end anchor", () => {
    expect(patternMatches("/games/", "/games/Genshin")).toBe(true);
    expect(patternMatches("/*.json", "/data/events.json")).toBe(true);
    expect(patternMatches("/x$", "/x")).toBe(true);
    expect(patternMatches("/x$", "/x/y")).toBe(false);
    expect(patternMatches("", "/x")).toBe(false);
  });

  test("longest matching rule wins", () => {
    const robots = parseRobots(`
User-agent: *
Disallow: /wiki/
Allow: /wiki/Event
`);
    expect(isAllowed(robots, UA, "/wiki/Special:Random")).toBe(false);
    expect(isAllowed(robots, UA, "/wiki/Event")).toBe(true);
  });

  test("allow wins a tie of equal length", () => {
    const robots = parseRobots("User-agent: *\nDisallow: /page\nAllow: /page\n");
    expect(isAllowed(robots, UA, "/page")).toBe(true);
  });

  test("the query string is part of the matched target", () => {
    const robots = parseRobots("User-agent: *\nDisallow: /*?action=edit\n");
    expect(requestTarget("https://x.test/wiki/Event?action=edit")).toBe(
      "/wiki/Event?action=edit",
    );
    expect(isAllowed(robots, UA, "/wiki/Event?action=edit")).toBe(false);
    expect(isAllowed(robots, UA, "/wiki/Event")).toBe(true);
  });

  test("a path is matched with a leading slash even if given without one", () => {
    const robots = parseRobots("User-agent: *\nDisallow: /x\n");
    expect(isAllowed(robots, UA, "x")).toBe(false);
  });
});

describe("the sources we actually fetch", () => {
  // Game8 opts out of AI-training crawlers by name and leaves everyone else
  // alone (AGENTS.md § Scraping conduct). If that ever changes, this is where
  // it should be noticed.
  const game8 = parseRobots(`
User-agent: GPTBot
Disallow: /

User-agent: Google-Extended
Disallow: /

User-agent: *
Disallow: /admin/
Disallow: /*?utm_source=
`);

  test("our agent may fetch a Game8 article page", () => {
    expect(
      isAllowed(game8, UA, "/games/Genshin-Impact/archives/301601"),
    ).toBe(true);
  });

  test("the AI-training opt-outs still bind those crawlers", () => {
    expect(isAllowed(game8, "GPTBot/1.2", "/games/x")).toBe(false);
    expect(isAllowed(game8, "Google-Extended", "/games/x")).toBe(false);
  });

  test("the wildcard rules that do exist are obeyed", () => {
    expect(isAllowed(game8, UA, "/admin/")).toBe(false);
    expect(isAllowed(game8, UA, "/games/x?utm_source=y")).toBe(false);
  });
});

describe("RobotsCache", () => {
  function cacheWith(
    responder: (url: string) => Response | Promise<Response>,
    calls: string[] = [],
  ) {
    return {
      calls,
      cache: new RobotsCache({
        userAgent: UA,
        fetchImpl: async (url) => {
          calls.push(url);
          return responder(url);
        },
      }),
    };
  }

  test("fetches robots.txt once per host and reuses it", async () => {
    const { cache, calls } = cacheWith(
      () => new Response("User-agent: *\nDisallow: /admin\n", { status: 200 }),
    );
    expect((await cache.allows("https://game8.co/games/a")).allowed).toBe(true);
    expect((await cache.allows("https://game8.co/games/b")).allowed).toBe(true);
    expect((await cache.allows("https://game8.co/admin")).allowed).toBe(false);
    expect(calls).toEqual(["https://game8.co/robots.txt"]);
    expect(cache.fetches).toBe(1);
  });

  test("fetches once per distinct host", async () => {
    const { cache, calls } = cacheWith(() => new Response("", { status: 200 }));
    await cache.allows("https://game8.co/a");
    await cache.allows("https://endfield.wiki.gg/wiki/Event");
    expect(calls).toEqual([
      "https://game8.co/robots.txt",
      "https://endfield.wiki.gg/robots.txt",
    ]);
  });

  test("a missing robots.txt means no restrictions", async () => {
    const { cache } = cacheWith(() => new Response("nope", { status: 404 }));
    const decision = await cache.allows("https://x.test/wiki/Event");
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("no robots.txt");
  });

  test("fails closed on a server error", async () => {
    const { cache } = cacheWith(() => new Response("", { status: 503 }));
    const decision = await cache.allows("https://x.test/wiki/Event");
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("503");
  });

  test("an empty 200 body is a valid robots.txt that restricts nothing", async () => {
    const { cache } = cacheWith(() => new Response("   \n", { status: 200 }));
    const decision = await cache.allows("https://x.test/wiki/Event");
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("robots.txt ok");
  });

  test("fails closed on a soft 404 — an HTML page served as 200", async () => {
    // The commonest robots.txt misconfiguration there is. It parses to zero
    // groups, which is indistinguishable from "nothing is restricted", so
    // reading it as permission is exactly the fail-open this class forbids.
    const { cache } = cacheWith(
      () =>
        new Response(
          "<!DOCTYPE html>\n<html><head><title>404 Not Found</title></head><body>Not found</body></html>",
          { status: 200, headers: { "Content-Type": "text/html" } },
        ),
    );
    const decision = await cache.allows("https://x.test/wiki/Event");
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("HTML");
  });

  test("fails closed when the body dies mid-read", async () => {
    const { cache } = cacheWith(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("User-agent: *\n"));
              controller.error(new Error("ECONNRESET"));
            },
          }),
          { status: 200 },
        ),
    );
    const decision = await cache.allows("https://x.test/wiki/Event");
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("unreadable");
  });

  test("fails closed when robots.txt is unreachable", async () => {
    const { cache } = cacheWith(() => {
      throw new Error("ECONNREFUSED");
    });
    const decision = await cache.allows("https://x.test/wiki/Event");
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("unreachable");
  });

  test("expires an entry after its TTL", async () => {
    const calls: string[] = [];
    let clock = 0;
    const cache = new RobotsCache({
      userAgent: UA,
      fetchImpl: async (url) => {
        calls.push(url);
        return new Response("User-agent: *\nDisallow:\n", { status: 200 });
      },
      ttlMs: 1000,
      now: () => clock,
    });

    await cache.allows("https://x.test/a");
    clock = 999;
    await cache.allows("https://x.test/a");
    expect(calls).toHaveLength(1);
    clock = 1001;
    await cache.allows("https://x.test/a");
    expect(calls).toHaveLength(2);
  });
});

describe("--assume-robots-on-403", () => {
  /**
   * Fandom answers a datacentre address 403 on `/robots.txt` itself, while
   * `api.php?action=parse` answers our own User-Agent with a 200. The gate
   * fails closed on the unreadable file, so four sources can never refresh —
   * even though their rules are known: a person read them in a browser and
   * wrote them into AGENTS.md § Scraping conduct.
   *
   * This option is that recorded permission, and nothing wider. The tests below
   * are mostly about what it must NOT do.
   */
  const forbidden = () => new Response("denied", { status: 403 });

  function cache(assume: boolean, responder = forbidden) {
    return new RobotsCache({
      userAgent: UA,
      fetchImpl: async () => responder(),
      assumeAllowedWhenForbidden: assume,
    });
  }

  test("without it, a 403 on robots.txt still fails closed", async () => {
    const d = await cache(false).allows("https://x.fandom.com/api.php?action=parse");
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain("403");
  });

  test("with it, the host is fetched and the run is told why", async () => {
    const d = await cache(true).allows("https://x.fandom.com/api.php?action=parse");
    expect(d.allowed).toBe(true);
    expect(d.assumedOnForbidden).toBe(true);
    expect(d.reason).toContain("--assume-robots-on-403");
  });

  test("does not override a robots.txt we could read", async () => {
    // The distinction the whole option rests on. A file that answers and
    // refuses us is an answer, and it still wins with the flag on.
    const refuses = () =>
      new Response("User-agent: *\nDisallow: /\n", { status: 200 });
    const d = await cache(true, refuses).allows("https://x.fandom.com/api.php");
    expect(d.allowed).toBe(false);
    expect(d.assumedOnForbidden).toBeUndefined();
  });

  test("covers 403 only, not every way robots.txt can fail", async () => {
    // A 500, a soft 404 and an unreachable host are "we do not know", and
    // unknown is still not permission. Only 403 is "we know, and were told by
    // hand" — see game8.co, whose robots.txt reads fine and welcomes us while
    // its edge refuses the pages; this flag is no use there and must not be.
    const cases: Array<[string, () => Response]> = [
      ["500", () => new Response("oops", { status: 500 })],
      ["401", () => new Response("nope", { status: 401 })],
      ["soft 404", () => new Response("<!doctype html><html>", { status: 200 })],
    ];
    for (const [label, responder] of cases) {
      const d = await cache(true, responder).allows("https://x.test/wiki/Event");
      expect(`${label}: ${d.allowed}`).toBe(`${label}: false`);
    }
  });

  test("is off unless asked for", async () => {
    const plain = new RobotsCache({ userAgent: UA, fetchImpl: async () => forbidden() });
    expect((await plain.allows("https://x.test/a")).allowed).toBe(false);
  });
});
