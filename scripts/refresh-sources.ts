/**
 * Refresh every source, then regenerate the feed.
 *
 *   bun run refresh                          # the real thing
 *   bun run refresh --dry-run                # plan only, no requests, no writes
 *   bun run refresh --only genshin-game8-events
 *   bun run refresh --assume-robots-on-403   # see § the flag, below
 *   bun run refresh --force --only nikki-fandom-events   # ignore the 6h floor
 *
 * This is the scheduled half of the pipeline (docs/INGESTION.md stages 1-2).
 * The rules it enforces are etiquette obligations, not preferences:
 *
 *   - robots.txt is read once per host per run and obeyed; unreadable means
 *     "do not fetch", never "assume yes". `--assume-robots-on-403` is the one
 *     opt-in exception, for a host that will not serve us the file at all while
 *     serving us the page: it stands in for rules a person read in a browser
 *     and wrote into AGENTS.md. It covers 403 only, never overrides a
 *     robots.txt we could read, is refused under CI, and names every host it
 *     touched. Nothing else about being a guest relaxes with it.
 *   - at most ONE request per source per cycle, and never sooner than six hours
 *     after the last attempt. There is deliberately no retry: a retry is a
 *     second request, and the next cycle is minutes-cheap compared to being a
 *     bad guest. `--force` is the one way past the six hours, interactive-only
 *     and refused under CI, and it sets aside the interval and nothing else —
 *     conditional headers, per-host spacing, robots and the no-retry rule all
 *     still apply, and every source asked early is named in the summary.
 *   - requests to one host are spaced, honouring its `Crawl-delay`. Eight of the
 *     twelve sources are game8.co pages, so without this one cycle is eight
 *     back-to-back requests to a single site — inside the per-source floor and
 *     still the behaviour an edge network throttles.
 *   - conditional requests always, so an unchanged page costs the wiki a 304.
 *   - a descriptive User-Agent carrying a contact URL.
 *
 * Failure policy has two tiers, because they want opposite things from CI:
 *
 *   - One wiki being down is a warning and exit 0. The previous snapshot stays
 *     in place and the feed keeps its events — a source outage must never blank
 *     the calendar, and the sources that did answer must still be committed.
 *   - A source failing `BROKEN_AFTER_FAILURES` cycles in a row is not "down",
 *     it is broken, and the feed has been quietly serving a stale fixture for a
 *     day and a half. That is reported as `broken` and annotated, and the
 *     workflow turns the run red *after* committing what did work. Exiting
 *     non-zero here instead would skip the commit and throw the good pages away.
 *   - Hard failures (bad arguments, every source failing, a feed that will not
 *     rebuild) exit non-zero so CI stops before committing anything.
 */
import { appendFile } from "node:fs/promises";
import {
  ADAPTERS,
  adapterById,
} from "../src/ingest/adapters/index.ts";
import { SIX_HOURS_MS } from "../src/ingest/adapters/types.ts";
import type { Adapter } from "../src/ingest/adapters/types.ts";
import { RobotsCache, type FetchLike } from "../src/ingest/robots.ts";
import { decodeBody, SnapshotStore } from "../src/ingest/snapshots.ts";

const DEFAULT_CONTACT =
  "https://github.com/StereotypicalCat/gacha-event-tracker";

export const DEFAULT_USER_AGENT = `gacha-event-tracker/1.0 (+${process.env["REFRESH_CONTACT_URL"] ?? DEFAULT_CONTACT})`;

/** How a single source's cycle ended. */
export type RefreshResult =
  | "fetched" // 200 with new bytes, parsed, stored
  | "unchanged" // 304, or 200 whose bytes matched what we had
  | "skipped_interval" // fetched too recently to ask again
  | "skipped_robots" // robots.txt says no, or could not be read
  | "rejected" // fetched, but the body parsed worse than what we hold
  | "failed" // unreachable or an error status
  | "planned"; // --dry-run

export interface SourceOutcome {
  sourceId: string;
  result: RefreshResult;
  note: string;
  status: number | null;
  eventCount: number | null;
}

/**
 * A source that has stopped answering for long enough that the feed is now
 * knowingly stale for that game.
 */
export interface BrokenSource {
  sourceId: string;
  consecutiveFailures: number;
  lastStatus: number | null;
  lastConfirmedAt: string | null;
}

export interface RefreshSummary {
  outcomes: SourceOutcome[];
  /** Sources whose stored bytes changed — the only reason to commit. */
  changed: number;
  /** Sources we actually sent a request to. */
  attempted: number;
  /** Sources that answered (200 or 304). */
  confirmed: number;
  warnings: string[];
  /**
   * Sources failing for `BROKEN_AFTER_FAILURES` cycles running. Not a hard
   * failure — the workflow reports it after the commit, so a broken source
   * cannot cost a working one its snapshot.
   */
  broken: BrokenSource[];
  /** Set when the run should exit non-zero. */
  hardFailure: string | null;
  /**
   * Hosts fetched under `--assume-robots-on-403`. Empty on every normal run,
   * and on every CI run — the flag is refused there.
   */
  assumedRobots: string[];
  /**
   * Sources asked before their interval was up, under `--force`. Empty on every
   * normal run, and on every CI run — the flag is refused there.
   */
  forced: string[];
}

export interface RobotsGate {
  allows(url: string): Promise<{
    allowed: boolean;
    reason: string;
    /** From the host's `Crawl-delay`, when it states one. */
    crawlDelayMs?: number | null;
    /** True when `--assume-robots-on-403` is what opened this host. */
    assumedOnForbidden?: boolean;
  }>;
}

export interface RefreshOptions {
  adapters: readonly Adapter[];
  store: SnapshotStore;
  robots: RobotsGate;
  fetchImpl: FetchLike;
  userAgent: string;
  /** Injected clock — the runner is testable, like the parsers it drives. */
  now: () => Date;
  /**
   * Injected timer, for the same reason as the clock: the per-host gap is real
   * seconds on a runner and must cost a test nothing.
   */
  sleep: (ms: number) => Promise<void>;
  dryRun: boolean;
  only: string | null;
  /**
   * Ignore the per-source interval floor for this run. Interactive only — see
   * `--force` in USAGE, and AGENTS.md § Scraping conduct, which the flag amends
   * rather than quietly contradicts.
   */
  force: boolean;
  timeoutMs: number;
  log: (line: string) => void;
  /** Called once when something changed. Null skips the rebuild (tests). */
  rebuildFeed: (() => Promise<void>) | null;
}

/** A drop this steep means the page changed shape, not that events ended. */
const DROP_WARNING_RATIO = 0.5;

/**
 * Cycles of failure that separate "the wiki is down" from "this source is
 * broken". At two cycles a day, three is a day and a half of a game's calendar
 * silently coming from a checked-in fixture — long enough to be certain, short
 * enough to still be worth hearing about.
 */
export const BROKEN_AFTER_FAILURES = 3;

/**
 * Gap between two requests to the same host when its robots.txt names none.
 * The per-source floor is six hours, but eight sources share game8.co, so
 * without this they arrive as one burst.
 */
export const DEFAULT_HOST_GAP_MS = 2_000;

/** Per-cycle state shared across sources: which hosts we have already asked. */
interface Cycle {
  requestedHosts: Set<string>;
  /** Hosts fetched on `--assume-robots-on-403` rather than on a file we read. */
  assumedRobots: Set<string>;
  /** Sources asked before their interval was up, under `--force`. */
  forced: Set<string>;
}

export async function runRefresh(
  options: RefreshOptions,
): Promise<RefreshSummary> {
  const summary: RefreshSummary = {
    outcomes: [],
    changed: 0,
    attempted: 0,
    confirmed: 0,
    warnings: [],
    broken: [],
    hardFailure: null,
    assumedRobots: [],
    forced: [],
  };

  const cycle: Cycle = {
    requestedHosts: new Set(),
    assumedRobots: new Set(),
    forced: new Set(),
  };

  const selected =
    options.only === null
      ? [...options.adapters]
      : options.adapters.filter((a) => a.id === options.only);

  if (selected.length === 0) {
    summary.hardFailure = `unknown source '${options.only ?? ""}'`;
    return summary;
  }

  for (const adapter of selected) {
    // One source can never take the cycle down with it. Everything inside
    // refreshOne that can fail is handled there; this is the backstop that
    // keeps an unforeseen throw from costing every source after this one its
    // turn — the sources are independent, and a run that stops halfway leaves
    // no summary and no record of what was already asked.
    let outcome: SourceOutcome;
    try {
      outcome = await refreshOne(adapter, options, cycle);
    } catch (error) {
      outcome = {
        sourceId: adapter.id,
        result: "failed",
        note: `unexpected error: ${String(error)}`,
        status: null,
        eventCount: null,
      };
    }
    summary.outcomes.push(outcome);

    if (outcome.result === "fetched") {
      summary.changed += 1;
      summary.attempted += 1;
      summary.confirmed += 1;
    } else if (outcome.result === "unchanged") {
      summary.attempted += 1;
      summary.confirmed += 1;
    } else if (outcome.result === "failed" || outcome.result === "rejected") {
      summary.attempted += 1;
      summary.warnings.push(`${adapter.id}: ${outcome.note}`);
    } else if (outcome.result === "skipped_robots") {
      summary.warnings.push(`${adapter.id}: ${outcome.note}`);
    }

    options.log(
      `  ${adapter.id.padEnd(24)} ${outcome.result.padEnd(17)} ${outcome.note}`,
    );

    // Read from the store rather than from this cycle's outcome: the streak is
    // the point, and a source that has failed for days and is now skipped for
    // the interval is still broken. A successful fetch resets it to zero, so
    // this reports a standing condition, not one bad afternoon.
    if (!options.dryRun) {
      const health = await options.store.readState(adapter.id);
      if (health.consecutiveFailures >= BROKEN_AFTER_FAILURES) {
        summary.broken.push({
          sourceId: adapter.id,
          consecutiveFailures: health.consecutiveFailures,
          lastStatus: health.lastStatus,
          lastConfirmedAt: health.lastConfirmedAt,
        });
      }
    }
  }

  // Named in the summary rather than only in the per-source log, so it survives
  // into the job summary and cannot be scrolled past.
  summary.forced = [...cycle.forced].sort();
  if (summary.forced.length > 0) {
    summary.warnings.push(
      `--force: asked ${summary.forced.length} source(s) before their interval ` +
        `was up (${summary.forced.join(", ")})`,
    );
  }

  summary.assumedRobots = [...cycle.assumedRobots].sort();
  for (const host of summary.assumedRobots) {
    summary.warnings.push(
      `${host}: fetched on --assume-robots-on-403 — its robots.txt was NOT read ` +
        `this run. Re-read it in a browser and confirm AGENTS.md § Scraping ` +
        `conduct still describes it.`,
    );
  }

  // Every source failing is not "a wiki is down", it is us: no network, a bad
  // User-Agent, a proxy. That should stop the pipeline rather than look green.
  if (summary.attempted > 0 && summary.confirmed === 0) {
    summary.hardFailure = `all ${summary.attempted} attempted sources failed`;
    return summary;
  }

  // Likewise, being turned away everywhere is news. Left as a warning it would
  // read as a quiet, successful, permanently empty refresh.
  if (summary.outcomes.every((o) => o.result === "skipped_robots")) {
    summary.hardFailure = `robots.txt blocked all ${summary.outcomes.length} sources`;
    return summary;
  }

  if (summary.changed > 0 && options.rebuildFeed !== null) {
    try {
      await options.rebuildFeed();
    } catch (error) {
      // New snapshots are on disk but do not produce a feed. Exiting non-zero
      // keeps CI from committing them.
      summary.hardFailure = `feed rebuild failed: ${String(error)}`;
    }
  }

  return summary;
}

async function refreshOne(
  adapter: Adapter,
  options: RefreshOptions,
  cycle: Cycle,
): Promise<SourceOutcome> {
  const { store } = options;
  const now = options.now();
  const nowIso = now.toISOString();
  const meta = await store.readMeta(adapter.id);
  const state = await store.readState(adapter.id);
  const headers = store.conditionalHeaders(meta);

  const due = store.isDue(state, now.getTime(), adapter.minIntervalMs);
  if (!due && !options.force) {
    const dueAt = new Date(store.dueAt(state, adapter.minIntervalMs));
    return {
      sourceId: adapter.id,
      result: "skipped_interval",
      note: `checked ${state.lastCheckedAt ?? "?"}, next due ${dueAt.toISOString()}`,
      status: null,
      eventCount: meta?.eventCount ?? null,
    };
  }
  // Asking early is the one obligation `--force` sets aside, and only for a
  // source that would otherwise have been skipped — a run that was due anyway
  // is an ordinary run and must not be reported as forced.
  if (!due) cycle.forced.add(adapter.id);

  if (options.dryRun) {
    const conditional = Object.keys(headers);
    return {
      sourceId: adapter.id,
      result: "planned",
      note: `would GET ${adapter.url}${
        conditional.length > 0 ? ` with ${conditional.join(", ")}` : " (no validators cached)"
      }`,
      status: null,
      eventCount: meta?.eventCount ?? null,
    };
  }

  const decision = await options.robots.allows(adapter.url);
  if (!decision.allowed) {
    return {
      sourceId: adapter.id,
      result: "skipped_robots",
      note: decision.reason,
      status: null,
      eventCount: meta?.eventCount ?? null,
    };
  }
  // Fetching on a permission nobody can re-read is a thing the run has to say
  // out loud, every time and per source. An override that reports nothing is an
  // override that quietly becomes the default.
  if (decision.assumedOnForbidden === true) {
    cycle.assumedRobots.add(new URL(adapter.url).host);
  }

  // Space requests to a host we have already asked this cycle. This sits after
  // the interval and robots gates on purpose: waiting on behalf of a source we
  // then skip would buy the host nothing and cost the run a minute.
  const host = new URL(adapter.url).host;
  if (cycle.requestedHosts.has(host)) {
    await options.sleep(decision.crawlDelayMs ?? DEFAULT_HOST_GAP_MS);
  }
  cycle.requestedHosts.add(host);

  let response: Response;
  try {
    response = await options.fetchImpl(adapter.url, {
      headers: {
        "User-Agent": options.userAgent,
        Accept: "text/html,application/xhtml+xml",
        ...headers,
      },
      signal: AbortSignal.timeout(options.timeoutMs),
      redirect: "follow",
    });
  } catch (error) {
    await store.recordCheck(adapter.id, { at: nowIso, status: null, ok: false });
    return {
      sourceId: adapter.id,
      result: "failed",
      note: `unreachable: ${String(error)}`,
      status: null,
      eventCount: meta?.eventCount ?? null,
    };
  }

  if (response.status === 304) {
    await store.recordCheck(adapter.id, { at: nowIso, status: 304, ok: true });
    return {
      sourceId: adapter.id,
      result: "unchanged",
      note: "304 not modified",
      status: 304,
      eventCount: meta?.eventCount ?? null,
    };
  }

  // 200 is the only status that means "here is the page". `response.ok` also
  // admits the rest of the 2xx range, and that cost us the diagnosis: game8.co's
  // edge answers a GitHub runner with **202 Accepted** and a bot-management
  // body, which sailed through this gate as a document, reached the parser,
  // yielded no events and was reported as "kept previous snapshot" — describing
  // the symptom while the status that explained it went unmentioned. 202 means
  // the request was accepted for processing; 204 has no body and 206 is a
  // fragment. None of them is a wiki page.
  if (response.status !== 200) {
    await store.recordCheck(adapter.id, {
      at: nowIso,
      status: response.status,
      ok: false,
    });
    return {
      sourceId: adapter.id,
      result: "failed",
      note: `HTTP ${response.status}${describeRejection(response)}`,
      status: response.status,
      eventCount: meta?.eventCount ?? null,
    };
  }

  // Reading the body is a second chance to fail — a reset connection, a
  // truncated response, or the timeout firing mid-stream. Left outside the try
  // this rejection escapes refreshOne, aborts the whole cycle, and leaves the
  // sources after this one unfetched and this one's `lastCheckedAt` unwritten:
  // one bad body would both blank the run and lose the record that we had
  // already spent this source's request.
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    await store.recordCheck(adapter.id, {
      at: nowIso,
      status: response.status,
      ok: false,
    });
    return {
      sourceId: adapter.id,
      result: "failed",
      note: `body unreadable: ${String(error)}`,
      status: response.status,
      eventCount: meta?.eventCount ?? null,
    };
  }

  // Decode with the charset the server declared. Storing the raw bytes keeps
  // the snapshot re-decodable; decoding before parsing keeps mojibake out of
  // titles, and therefore out of the event IDs that are localStorage keys.
  const { text: html, charset } = decodeBody(
    bytes,
    response.headers.get("Content-Type"),
  );

  // The parse gate. A body that no longer parses, or that yields nothing where
  // it used to yield events, is a source that changed shape — publishing it
  // would empty a game's calendar silently, which is the failure this pipeline
  // exists to avoid. Keep what we hold and warn.
  let events: number;
  try {
    events = adapter.parse(html, {
      now: nowIso,
      sourceUrl: adapter.url,
      sourceId: adapter.id,
      game: adapter.game,
    }).length;
  } catch (error) {
    await store.recordCheck(adapter.id, {
      at: nowIso,
      status: response.status,
      ok: false,
    });
    return {
      sourceId: adapter.id,
      result: "rejected",
      note: `kept previous snapshot; new body did not parse: ${String(error)}`,
      status: response.status,
      eventCount: meta?.eventCount ?? null,
    };
  }

  // Zero events is never a useful snapshot: every source in the registry
  // yields events by construction, so an empty parse means the page changed
  // shape. Refusing it keeps the previous snapshot — or, on a first run, the
  // checked-in fixture — as the thing the feed is built from.
  const previousCount = meta?.eventCount ?? null;
  if (events === 0) {
    await store.recordCheck(adapter.id, {
      at: nowIso,
      status: response.status,
      ok: false,
    });
    return {
      sourceId: adapter.id,
      result: "rejected",
      note:
        previousCount === null
          ? "did not store; body yielded 0 events"
          : `kept previous snapshot; new body yielded 0 events (had ${previousCount})`,
      status: response.status,
      eventCount: previousCount,
    };
  }

  const saved = await store.save(adapter.id, {
    url: adapter.url,
    body: bytes,
    charset,
    etag: response.headers.get("ETag"),
    lastModified: response.headers.get("Last-Modified"),
    at: nowIso,
    eventCount: events,
  });
  await store.recordCheck(adapter.id, {
    at: nowIso,
    status: response.status,
    ok: true,
  });

  if (!saved.changed) {
    return {
      sourceId: adapter.id,
      result: "unchanged",
      note: `200 but identical bytes (${events} events)`,
      status: response.status,
      eventCount: events,
    };
  }

  const dropped =
    previousCount !== null &&
    previousCount > 0 &&
    events < previousCount * DROP_WARNING_RATIO;

  return {
    sourceId: adapter.id,
    result: "fetched",
    note: dropped
      ? `${events} events — down from ${previousCount}, check the page shape`
      : `${events} events`,
    status: response.status,
    eventCount: events,
  };
}

/**
 * The few header words that tell a wiki being down from an edge network turning
 * us away.
 *
 * `HTTP 403` alone cannot be acted on: it reads the same whether the page moved
 * behind a login or whether a CDN has decided the runner's address is a bot
 * farm. Naming the server in the note means the answer is in the run log and
 * the step summary rather than in a request someone has to reproduce by hand.
 */
function describeRejection(response: Response): string {
  // A header value is a string from a host we do not control, and this one ends
  // up inside a `::warning::` workflow command and a markdown table cell. HTTP
  // forbids a bare newline in a value, so this is belt and braces rather than a
  // live hole — but a note is not worth trusting a stranger's bytes over.
  const tidy = (value: string | null): string | null => {
    if (value === null) return null;
    const clean = value.replace(/[^\x20-\x7e]+/g, " ").trim().slice(0, 40);
    return clean === "" ? null : clean;
  };

  const parts: string[] = [];
  const server = tidy(response.headers.get("Server"));
  if (server !== null) parts.push(server);
  if (response.headers.get("CF-Ray") !== null) parts.push("cf-ray");
  const retryAfter = tidy(response.headers.get("Retry-After"));
  if (retryAfter !== null) parts.push(`retry-after ${retryAfter}`);
  return parts.length === 0 ? "" : ` (${parts.join(", ")})`;
}

/**
 * Workflow-command lines for a GitHub runner.
 *
 * Warnings printed to stdout are invisible unless someone opens the log, which
 * is how six of seven sources failed every cycle for three days under a green
 * tick. An annotation shows on the run page itself. `::error::` annotates
 * without failing the step, which is what lets the commit still happen.
 */
export function annotations(summary: RefreshSummary): string[] {
  const lines: string[] = [];
  for (const b of summary.broken) {
    lines.push(
      `::error title=${b.sourceId} has stopped answering::` +
        `${b.consecutiveFailures} cycles failing in a row; ` +
        `last status ${b.lastStatus ?? "none"}; ` +
        `last confirmed ${b.lastConfirmedAt ?? "never"}. ` +
        `This game's calendar is being built from a checked-in fixture.`,
    );
  }
  for (const warning of summary.warnings) {
    lines.push(`::warning title=refresh::${warning}`);
  }
  return lines;
}

/** `$GITHUB_STEP_SUMMARY` markdown: one row per source, statuses included. */
export function stepSummary(summary: RefreshSummary): string {
  const cell = (text: string) => text.replaceAll("|", "\\|");
  const rows = summary.outcomes.map(
    (o) =>
      `| \`${o.sourceId}\` | ${o.result} | ${o.status ?? "—"} | ` +
      `${o.eventCount ?? "—"} | ${cell(o.note)} |`,
  );

  const head =
    `### Refresh: ${summary.changed} changed, ` +
    `${summary.confirmed}/${summary.attempted} confirmed, ` +
    `${summary.broken.length} broken\n\n` +
    `| source | result | status | events | note |\n` +
    `| --- | --- | --- | --- | --- |\n`;

  const tail =
    summary.hardFailure === null
      ? ""
      : `\n**Hard failure:** ${summary.hardFailure}\n`;

  return `${head}${rows.join("\n")}\n${tail}`;
}

/**
 * `$GITHUB_OUTPUT` values the workflow branches on.
 *
 * `broken` is deliberately an output rather than an exit code: the workflow has
 * to commit the sources that did work before it turns the run red.
 */
export function outputs(summary: RefreshSummary): string[] {
  return [
    `changed=${summary.changed}`,
    `attempted=${summary.attempted}`,
    `confirmed=${summary.confirmed}`,
    `broken=${summary.broken.length}`,
  ];
}

/** Append to a file named by an env var, if the runner set one. */
async function appendToEnvFile(name: string, text: string): Promise<void> {
  const path = process.env[name];
  if (path === undefined || path === "") return;
  try {
    await appendFile(path, text.endsWith("\n") ? text : `${text}\n`);
  } catch (error) {
    // Reporting is not the job. A read-only summary file must not turn a
    // successful refresh into a failed one.
    console.warn(`could not write ${name}: ${String(error)}`);
  }
}

/** Regenerate public/data/events.v1.json from whatever is now cached. */
export async function rebuildFeedViaScript(): Promise<void> {
  const proc = Bun.spawn(["bun", "run", "scripts/build-feed.ts"], {
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`build-feed exited ${code}`);
}

/**
 * Are we on a runner rather than at somebody's keyboard?
 *
 * Both variables, because `CI` is the convention every runner sets and
 * `GITHUB_ACTIONS` is the one this repo's workflow guarantees. Erring towards
 * "yes" is the safe direction: the only thing it costs is refusing an
 * interactive-only flag to a human whose shell exports `CI`.
 */
function isCi(): boolean {
  return (
    process.env["CI"] !== undefined && process.env["CI"] !== "" ||
    process.env["GITHUB_ACTIONS"] === "true"
  );
}

interface Args {
  dryRun: boolean;
  only: string | null;
  root: string;
  userAgent: string;
  rebuild: boolean;
  help: boolean;
  /** See `--assume-robots-on-403` in USAGE, and § Scraping conduct. */
  assumeRobotsOn403: boolean;
  /** See `--force` in USAGE, and § Scraping conduct. */
  force: boolean;
}

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    dryRun: false,
    only: null,
    root: process.env["SNAPSHOT_DIR"] ?? "snapshots",
    userAgent: process.env["REFRESH_USER_AGENT"] ?? DEFAULT_USER_AGENT,
    rebuild: true,
    help: false,
    assumeRobotsOn403: false,
    force: false,
  };

  // A flag whose value is missing is a mistake, never a default. `--only` with
  // nothing after it used to mean "every source", which is the opposite of
  // what the operator typed and one request per source more than they wanted.
  const value = (i: number, flag: string): string => {
    const next = argv[i];
    if (next === undefined || next.startsWith("-")) {
      throw new Error(`${flag} requires a value`);
    }
    return next;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--only":
        i += 1;
        args.only = value(i, "--only");
        break;
      case "--snapshots":
        i += 1;
        args.root = value(i, "--snapshots");
        break;
      case "--user-agent":
        i += 1;
        args.userAgent = value(i, "--user-agent");
        break;
      case "--no-feed":
        args.rebuild = false;
        break;
      case "--assume-robots-on-403":
        args.assumeRobotsOn403 = true;
        break;
      case "--force":
        args.force = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        if (arg !== undefined && arg.startsWith("-")) {
          throw new Error(`unknown flag '${arg}'`);
        }
        break;
    }
  }

  return args;
}

const USAGE = `usage: bun run refresh [--dry-run] [--only <sourceId>] [--snapshots <dir>]
                       [--user-agent <ua>] [--no-feed] [--assume-robots-on-403]
                       [--force]

  --dry-run       report what each source would do; no requests, no writes
  --only <id>     refresh a single source (${ADAPTERS.map((a) => a.id).join(", ")})
  --snapshots     snapshot cache directory (default: snapshots, env SNAPSHOT_DIR)
  --user-agent    override the User-Agent (env REFRESH_USER_AGENT)
  --no-feed       skip regenerating public/data/events.v1.json
  --assume-robots-on-403
                  temporary, interactive-only. When a host answers 403 to
                  /robots.txt itself, proceed on the permission recorded in
                  AGENTS.md instead of failing closed. Refused under CI.
                  Does NOT override a robots.txt we could read: a file that
                  disallows us still says no.
  --force         temporary, interactive-only. Ignore the 6h per-source floor
                  and ask now. Refused under CI. Everything else about being a
                  guest still holds: one request per source, per-host spacing,
                  conditional headers (so an unchanged page still costs a 304),
                  robots, no retries. Prefer it with --only.`;

async function main(): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(Bun.argv.slice(2));
  } catch (error) {
    console.error(String(error));
    console.error(USAGE);
    return 2;
  }

  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  if (args.only !== null && adapterById(args.only) === undefined) {
    console.error(`unknown source '${args.only}'`);
    console.error(USAGE);
    return 2;
  }

  // The flag stands in for a human having read a robots.txt in a browser and
  // written it down. There is no human on a runner, and a scheduled job quietly
  // asserting a permission nobody re-checked is how "temporary" becomes
  // permanent — so CI is refused the option outright rather than trusted not to
  // pass it. AGENTS.md § Scraping conduct is the argument.
  // Same reasoning as the robots override: this is a person deciding, once,
  // that a page has moved and they want it now. A schedule deciding that every
  // run is just a shorter interval with extra steps, and the interval is the
  // obligation.
  if (args.force && isCi()) {
    console.error(
      "--force is interactive-only and refused under CI.\n" +
        "The 6h floor is what the scheduled runner is for; change the schedule, " +
        "not the floor.",
    );
    return 2;
  }

  if (args.assumeRobotsOn403 && isCi()) {
    console.error(
      "--assume-robots-on-403 is interactive-only and refused under CI.\n" +
        "It asserts a permission a person read by hand; run the refresh from a " +
        "machine the host serves instead.",
    );
    return 2;
  }

  const store = new SnapshotStore(args.root);
  const robots = new RobotsCache({
    userAgent: args.userAgent,
    fetchImpl: (input, init) => fetch(input, init),
    assumeAllowedWhenForbidden: args.assumeRobotsOn403,
  });

  if (args.force) {
    const n = args.only === null ? ADAPTERS.length : 1;
    console.warn(
      `  ! --force: ignoring the 6h floor for ${n} source${n === 1 ? "" : "s"}. ` +
        `Conditional headers still apply, so an unchanged page costs a 304.`,
    );
  }

  if (args.assumeRobotsOn403) {
    console.warn(
      "  ! --assume-robots-on-403: a host answering 403 to /robots.txt will be\n" +
        "    fetched anyway, on the permission recorded in AGENTS.md. Temporary,\n" +
        "    and every host it applies to is named at the end of this run.",
    );
  }

  console.log(
    `refresh: ${args.only ?? `${ADAPTERS.length} sources`}${args.dryRun ? " (dry run)" : ""}`,
  );
  console.log(`  user-agent: ${args.userAgent}`);
  console.log(`  snapshots:  ${args.root}`);
  console.log(`  interval:   ${SIX_HOURS_MS / 3_600_000}h minimum per source\n`);

  const summary = await runRefresh({
    adapters: ADAPTERS,
    store,
    robots,
    fetchImpl: (input, init) => fetch(input, init),
    userAgent: args.userAgent,
    now: () => new Date(),
    sleep: (ms) => Bun.sleep(ms),
    dryRun: args.dryRun,
    only: args.only,
    force: args.force,
    timeoutMs: 20_000,
    log: (line) => console.log(line),
    rebuildFeed: args.dryRun || !args.rebuild ? null : rebuildFeedViaScript,
  });

  console.log(
    `\n${summary.changed} changed, ${summary.confirmed}/${summary.attempted} confirmed, ` +
      `${summary.warnings.length} warnings, ${summary.broken.length} broken`,
  );
  // One line per warning, and every warning is in `summary.warnings` — printing
  // a category separately here once double-reported the assumed-robots hosts
  // and left the "N warnings" count above disagreeing with the lines under it.
  for (const warning of summary.warnings) console.warn(`  ! ${warning}`);
  for (const b of summary.broken) {
    console.error(
      `  !! ${b.sourceId} has failed ${b.consecutiveFailures} cycles running ` +
        `(last confirmed ${b.lastConfirmedAt ?? "never"})`,
    );
  }

  // Only on a runner: the `!` and `!!` lines above already said all of this to a
  // human, and `::warning title=…::` in a terminal is noise that reads as a bug.
  if (process.env["GITHUB_ACTIONS"] === "true") {
    for (const line of annotations(summary)) console.log(line);
  }
  await appendToEnvFile("GITHUB_STEP_SUMMARY", stepSummary(summary));
  await appendToEnvFile("GITHUB_OUTPUT", outputs(summary).join("\n"));

  // Kept for a human reading the log; `git status` is what the workflow trusts
  // to decide whether to commit.
  console.log(`changed=${summary.changed}`);

  if (summary.hardFailure !== null) {
    console.error(`\nrefresh failed: ${summary.hardFailure}`);
    return 1;
  }

  // Broken sources exit 0 on purpose. The workflow reads the `broken` output and
  // fails the run *after* committing, so one dead wiki cannot stop nine live
  // ones from reaching the site.
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
