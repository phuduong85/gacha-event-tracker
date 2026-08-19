/**
 * robots.txt: parsing, matching, and a per-host cache.
 *
 * Sources are community wikis and this project's standing rule is to behave as
 * a guest would (AGENTS.md § Scraping conduct). That starts with actually
 * reading robots.txt rather than assuming a path is fair game.
 *
 * Parsing is a pure function over text, deliberately separated from fetching,
 * so every matching rule below is unit-testable offline. Only `RobotsCache`
 * touches the network, and it takes its `fetch` by injection.
 *
 * Follows RFC 9309: user-agent groups, Allow/Disallow with `*` and `$`
 * wildcards, longest-match-wins with Allow winning a tie, and `*` as the
 * fallback group used only when no named group matches.
 */

export interface RobotsRule {
  /** true for `Allow:`, false for `Disallow:`. */
  readonly allow: boolean;
  /** The raw path pattern; may contain `*` and a trailing `$`. */
  readonly pattern: string;
}

export interface RobotsGroup {
  /** Lowercased user-agent tokens this group applies to. `*` is the fallback. */
  readonly agents: readonly string[];
  readonly rules: readonly RobotsRule[];
  readonly crawlDelaySeconds: number | null;
}

export interface RobotsTxt {
  readonly groups: readonly RobotsGroup[];
  readonly sitemaps: readonly string[];
}

/** A robots.txt that restricts nothing — what an absent file means. */
export const ALLOW_ALL: RobotsTxt = { groups: [], sitemaps: [] };

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

interface MutableGroup {
  agents: string[];
  rules: RobotsRule[];
  crawlDelaySeconds: number | null;
}

/**
 * Parse robots.txt text.
 *
 * Unknown directives are ignored rather than treated as errors — a file we do
 * not fully understand must still yield the rules we do understand.
 */
export function parseRobots(text: string): RobotsTxt {
  const groups: MutableGroup[] = [];
  const sitemaps: string[] = [];

  let current: MutableGroup | null = null;
  // Consecutive `User-agent:` lines share one group; the first rule line after
  // them closes the agent list, so the next `User-agent:` starts a new group.
  let acceptingAgents = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (line === "") continue;

    const colon = line.indexOf(":");
    if (colon === -1) continue;

    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    switch (key) {
      case "user-agent": {
        if (value === "") break;
        if (current === null || !acceptingAgents) {
          current = { agents: [], rules: [], crawlDelaySeconds: null };
          groups.push(current);
          acceptingAgents = true;
        }
        current.agents.push(value.toLowerCase());
        break;
      }
      case "allow":
      case "disallow": {
        if (current === null) break;
        acceptingAgents = false;
        // `Disallow:` with an empty value is the documented way to say
        // "nothing is disallowed", so it must not become a match-everything
        // rule. An empty `Allow:` is equally inert.
        if (value === "") break;
        current.rules.push({ allow: key === "allow", pattern: value });
        break;
      }
      case "crawl-delay": {
        if (current === null) break;
        acceptingAgents = false;
        const seconds = Number(value);
        if (Number.isFinite(seconds) && seconds >= 0) {
          current.crawlDelaySeconds = seconds;
        }
        break;
      }
      case "sitemap": {
        if (value !== "") sitemaps.push(value);
        break;
      }
      default:
        break;
    }
  }

  return {
    groups: groups.map((g) => ({
      agents: g.agents,
      rules: g.rules,
      crawlDelaySeconds: g.crawlDelaySeconds,
    })),
    sitemaps,
  };
}

function stripComment(line: string): string {
  const hash = line.indexOf("#");
  return hash === -1 ? line : line.slice(0, hash);
}

/**
 * The product token of a User-Agent header.
 *
 * `"gacha-event-tracker/1.0 (+https://example.test)"` → `"gacha-event-tracker"`.
 */
export function agentToken(userAgent: string): string {
  const first = userAgent.trim().split(/[\s/]/, 1)[0] ?? "";
  return first.toLowerCase();
}

/**
 * Does a `User-agent:` value in robots.txt name us?
 *
 * RFC 9309 § 2.2.1 matches the *product token* — the header up to the first
 * `/` — not the header text. Matching anywhere in the header is actively
 * dangerous here: our contact URL contains the string `StereotypicalCat`, so a
 * `User-agent: cat` group elsewhere in the file would be treated as naming us,
 * and because a named group replaces the `*` group outright, that unrelated
 * group's rules would *discard* every rule the site actually wrote for us.
 * Erring towards obeying more rules means never letting a coincidence take a
 * `*` group away.
 *
 * A robots.txt that names us with a version (`gacha-event-tracker/1.0`) is
 * still honoured: the group's own product token is compared too.
 */
function agentNames(agent: string, token: string): boolean {
  if (agent === "*") return false;
  return agent === token || agentToken(agent) === token;
}

/**
 * The group that applies to a user agent, with every group naming the same
 * agent merged, as RFC 9309 requires.
 *
 * A named group beats `*` outright: a site that disallows everything for `*`
 * but names us explicitly is telling us we may fetch. Longest agent name wins
 * among several matches, so `googlebot-news` beats `googlebot`.
 */
export function groupFor(
  robots: RobotsTxt,
  userAgent: string,
): RobotsGroup | null {
  const token = agentToken(userAgent);

  let bestName: string | null = null;
  for (const group of robots.groups) {
    for (const agent of group.agents) {
      if (!agentNames(agent, token)) continue;
      if (bestName === null || agent.length > bestName.length) bestName = agent;
    }
  }

  const name = bestName ?? "*";
  const matching = robots.groups.filter((g) => g.agents.includes(name));
  if (matching.length === 0) return null;

  return {
    agents: [name],
    rules: matching.flatMap((g) => g.rules),
    crawlDelaySeconds:
      matching.reduce<number | null>(
        (acc, g) =>
          g.crawlDelaySeconds === null
            ? acc
            : Math.max(acc ?? 0, g.crawlDelaySeconds),
        null,
      ) ?? null,
  };
}

/** Does a robots path pattern match this path? Supports `*` and a final `$`. */
export function patternMatches(pattern: string, path: string): boolean {
  if (pattern === "") return false;

  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;

  let regex = "";
  for (const char of body) {
    if (char === "*") {
      regex += "[\\s\\S]*";
    } else {
      regex += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }

  return new RegExp(`^${regex}${anchored ? "$" : ""}`).test(path);
}

/**
 * May `userAgent` fetch `path`?
 *
 * `path` is the request target — pathname plus query string, e.g. `/wiki/Event`.
 * Longest matching pattern wins; a tie goes to Allow; no match means allowed.
 */
export function isAllowed(
  robots: RobotsTxt,
  userAgent: string,
  path: string,
): boolean {
  const group = groupFor(robots, userAgent);
  if (group === null) return true;

  const target = path.startsWith("/") ? path : `/${path}`;

  let bestLength = -1;
  let allowed = true;
  for (const rule of group.rules) {
    if (!patternMatches(rule.pattern, target)) continue;
    const length = rule.pattern.length;
    if (length > bestLength || (length === bestLength && rule.allow)) {
      bestLength = length;
      allowed = rule.allow;
    }
  }

  return allowed;
}

/** The crawl delay this agent should honour, in ms, if the file states one. */
export function crawlDelayMs(
  robots: RobotsTxt,
  userAgent: string,
): number | null {
  const group = groupFor(robots, userAgent);
  if (group === null || group.crawlDelaySeconds === null) return null;
  return Math.round(group.crawlDelaySeconds * 1000);
}

/** The path-and-query a robots rule is matched against. */
export function requestTarget(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

export interface RobotsDecision {
  readonly allowed: boolean;
  /** Human-readable why, for the run log. */
  readonly reason: string;
  readonly crawlDelayMs: number | null;
  /**
   * True when this host was opened by `assumeAllowedWhenForbidden` rather than
   * by a robots.txt we actually read. The caller is expected to say so out
   * loud — an override nobody sees is an override nobody withdraws.
   */
  readonly assumedOnForbidden?: boolean;
}

export interface RobotsCacheOptions {
  userAgent: string;
  fetchImpl: FetchLike;
  /** How long a parsed robots.txt stays good. Defaults to 24h, per docs. */
  ttlMs?: number;
  now?: () => number;
  timeoutMs?: number;
  /**
   * Treat a `403` on **robots.txt itself** as permission, instead of failing
   * closed. Off by default and never set from CI — see `--assume-robots-on-403`
   * in `scripts/refresh-sources.ts` for the whole argument.
   *
   * The narrowness is the point. This covers exactly one situation: a host that
   * will not serve us `/robots.txt` from this address, whose rules a human has
   * therefore read in a browser and written down (AGENTS.md § Scraping conduct
   * records Fandom's, verbatim). It does **not** touch a robots.txt we did read
   * and that disallows us — `isAllowed` still decides that, and still says no.
   * A file we can read and that refuses us is an answer; this is the case where
   * there is no answer and one has been obtained by hand.
   */
  assumeAllowedWhenForbidden?: boolean;
}

interface CacheEntry {
  robots: RobotsTxt;
  /** False when robots.txt could not be read; the host is then off limits. */
  usable: boolean;
  reason: string;
  at: number;
  /** True when `assumeAllowedWhenForbidden` is what made this entry usable. */
  assumedOnForbidden?: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * One robots.txt fetch per host per run (cached 24h), reused by every source on
 * that host — six Game8 adapters must not mean six robots requests.
 *
 * Fails closed. A 5xx, a timeout, a network error, a body that dies mid-read
 * or a body that is plainly not robots.txt all mean we do not know what the
 * site permits, and "unknown" is not permission. Only two answers open the
 * host: a parsed robots.txt, and a 404/410 saying there is none.
 */
export class RobotsCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly userAgent: string;
  private readonly fetchImpl: FetchLike;
  private readonly ttlMs: number;
  private readonly nowMs: () => number;
  private readonly timeoutMs: number;
  private readonly assumeAllowedWhenForbidden: boolean;

  constructor(options: RobotsCacheOptions) {
    this.userAgent = options.userAgent;
    this.fetchImpl = options.fetchImpl;
    this.ttlMs = options.ttlMs ?? DAY_MS;
    this.nowMs = options.now ?? (() => Date.now());
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.assumeAllowedWhenForbidden =
      options.assumeAllowedWhenForbidden ?? false;
  }

  /** Number of robots.txt requests made, for tests and the run log. */
  fetches = 0;

  async allows(url: string): Promise<RobotsDecision> {
    const origin = new URL(url).origin;
    const entry = await this.entryFor(origin);

    if (!entry.usable) {
      return { allowed: false, reason: entry.reason, crawlDelayMs: null };
    }

    const allowed = isAllowed(entry.robots, this.userAgent, requestTarget(url));
    return {
      allowed,
      reason: allowed ? entry.reason : `disallowed by ${origin}/robots.txt`,
      crawlDelayMs: crawlDelayMs(entry.robots, this.userAgent),
      ...(entry.assumedOnForbidden === true
        ? { assumedOnForbidden: true }
        : {}),
    };
  }

  private async entryFor(origin: string): Promise<CacheEntry> {
    const cached = this.entries.get(origin);
    if (cached !== undefined && this.nowMs() - cached.at < this.ttlMs) {
      return cached;
    }

    const entry = await this.load(origin);
    this.entries.set(origin, entry);
    return entry;
  }

  private async load(origin: string): Promise<CacheEntry> {
    const at = this.nowMs();
    this.fetches += 1;

    let response: Response;
    try {
      response = await this.fetchImpl(`${origin}/robots.txt`, {
        headers: { "User-Agent": this.userAgent, Accept: "text/plain" },
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: "follow",
      });
    } catch (error) {
      return {
        robots: ALLOW_ALL,
        usable: false,
        reason: `robots.txt unreachable (${String(error)})`,
        at,
      };
    }

    if (response.status === 404 || response.status === 410) {
      // No robots.txt is the site saying nothing, which means no restrictions.
      return {
        robots: ALLOW_ALL,
        usable: true,
        reason: "no robots.txt",
        at,
      };
    }

    // A host that will not serve us the file at all, only when an operator has
    // asked for this. `usable: true` with no rules is not a guess about what
    // the site permits — it is standing in for rules a human read in a browser
    // and wrote into AGENTS.md. Everything else about being a guest still
    // applies: one request per source, six hours apart, spaced per host.
    if (response.status === 403 && this.assumeAllowedWhenForbidden) {
      return {
        robots: ALLOW_ALL,
        usable: true,
        reason:
          `robots.txt returned 403; proceeding on a permission recorded by ` +
          `hand (--assume-robots-on-403)`,
        at,
        assumedOnForbidden: true,
      };
    }

    if (response.status >= 400) {
      return {
        robots: ALLOW_ALL,
        usable: false,
        reason: `robots.txt returned ${response.status}`,
        at,
      };
    }

    // Reading the body is a second chance to fail: the connection can reset or
    // the timeout can fire mid-stream, long after the headers arrived. Outside
    // the try that rejection would escape as an exception rather than as "we
    // could not read robots.txt", which is the one answer this class exists to
    // give.
    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      return {
        robots: ALLOW_ALL,
        usable: false,
        reason: `robots.txt body unreadable (${String(error)})`,
        at,
      };
    }

    // A soft 404 — an HTML "not found" page served with status 200 — is the
    // commonest robots.txt misconfiguration there is, and it parses to zero
    // groups, which is indistinguishable from "everything is permitted". We do
    // not know what the site allows, and unknown is not permission.
    if (looksLikeHtml(text)) {
      return {
        robots: ALLOW_ALL,
        usable: false,
        reason: "robots.txt returned HTML, not a robots.txt (soft 404?)",
        at,
      };
    }

    return { robots: parseRobots(text), usable: true, reason: "robots.txt ok", at };
  }
}

/**
 * Is this body markup rather than robots.txt?
 *
 * An empty body is *valid* robots.txt meaning "no restrictions", so emptiness
 * is deliberately not a failure. Only markup is — no robots.txt directive can
 * begin with `<`.
 */
export function looksLikeHtml(text: string): boolean {
  const head = text.trimStart().slice(0, 512).toLowerCase();
  if (head === "") return false;
  if (head.startsWith("<")) return true;
  return /<!doctype html|<html[\s>]|<head[\s>]|<body[\s>]/.test(head);
}
