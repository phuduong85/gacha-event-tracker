/**
 * Static file server for the built app, plus the one mutating route it has:
 * uploading a game's icon.
 *
 * A placeholder for the Bun server in docs/ARCHITECTURE.md: it serves what is
 * in public/ and nothing else besides that. When the real server lands it will
 * add the rest of /api/* and the ingest scheduler, and this file goes away.
 *
 * Deliberately minimal — no framework, no dependencies beyond Bun and Node's
 * built-in `crypto`/`fs` modules.
 */
import { timingSafeEqual, createHash } from "node:crypto";
import { mkdir, readdir, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";

const PORT = Number(process.env.PORT ?? 3000);
/** Overridable so tests can point at a fixture tree instead of the build. */
const ROOT = process.env.PUBLIC_DIR ?? "public";
const ROOT_DIR = resolve(ROOT);

/** Long-lived for fingerprint-free assets is wrong; keep it short and revalidate. */
const CACHE: Record<string, string> = {
  ".html": "public, max-age=0, must-revalidate",
  ".json": "public, max-age=300",
  ".js": "public, max-age=3600",
  ".css": "public, max-age=3600",
  ".svg": "public, max-age=86400",
  ".webmanifest": "public, max-age=3600",
};

function extname(path: string): string {
  const i = path.lastIndexOf(".");
  return i === -1 ? "" : path.slice(i);
}

/**
 * Kept as a plain list rather than imported from `src/shared/schema.ts`'s
 * `GameId`: the runtime image ships this file alone (Dockerfile's runtime
 * stage copies only `public/` and `serve.ts`, no `src/`, no `node_modules` —
 * so no zod either). `test/serve-icon-upload.test.ts` reads the real enum
 * and asserts the two agree, so this cannot drift silently.
 */
export const VALID_GAME_IDS = [
  "genshin",
  "hsr",
  "zzz",
  "wuwa",
  "endfield",
  "nte",
  "p5x",
  "r1999",
  "ptn",
  "holodori",
  "gfl2",
  "stellasora",
  "czn",
  "uma",
  "nikke",
] as const;

const ICON_UPLOAD_PASSWORD = process.env.ICON_UPLOAD_PASSWORD ?? null;
const MAX_ICON_BYTES = 2 * 1024 * 1024;
const RESERVED_ICON_NAMES = new Set(["manifest.json", "README.md"]);

/**
 * Recognised by their bytes, not by the `Content-Type` header a client sent —
 * a header is a claim, not a fact, and this is the one place on the whole
 * site that writes a file an outside caller chose the content of.
 */
function sniffImageExt(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return ".png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return ".jpg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return ".webp";
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return ".gif";
  }
  return null;
}

/**
 * Constant-time, and immune to the length check `timingSafeEqual` itself
 * would throw on: hashing both sides first means the buffers it compares are
 * always the same size, so a shorter guess is not distinguishable from a
 * same-length wrong one by timing.
 */
function passwordMatches(candidate: string, expected: string): boolean {
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Locks out repeated *wrong* passwords per caller, not repeated calls — a
 * reader legitimately uploading several games' icons in a row must not trip
 * the same limit built to slow down a guesser. In-memory and reset on
 * restart is fine here: this is a personal deployment, not a fleet, and the
 * password itself is the real defence — this only blunts brute force against
 * it on a hostname with no other gate in front.
 */
const MAX_FAILURES = 8;
const LOCKOUT_WINDOW_MS = 5 * 60_000;
const failures = new Map<string, { count: number; resetAt: number }>();

function isLockedOut(key: string): boolean {
  const entry = failures.get(key);
  return entry !== undefined && Date.now() < entry.resetAt && entry.count >= MAX_FAILURES;
}

function recordFailure(key: string): void {
  const now = Date.now();
  const entry = failures.get(key);
  if (entry === undefined || now >= entry.resetAt) {
    failures.set(key, { count: 1, resetAt: now + LOCKOUT_WINDOW_MS });
    return;
  }
  entry.count += 1;
}

function clearFailures(key: string): void {
  failures.delete(key);
}

/**
 * The caller identity the lockout above keys on.
 *
 * Not the TCP peer: this app runs behind a Cloudflare Tunnel proxying from
 * `localhost` on the same machine, so `server.requestIP` would return the
 * loopback address for every caller alike and the lockout would key on one
 * bucket for the whole internet. `CF-Connecting-IP` is the real one when the
 * tunnel is in front; falling back to the peer address keeps this correct for
 * local/dev use without it.
 */
function callerKey(request: Request, peerAddress: string | null): string {
  return request.headers.get("cf-connecting-ip") ?? peerAddress ?? "unknown";
}

/**
 * A response for a path that rejects before fully reading the body.
 *
 * `Connection: close` rather than trusting a cancelled stream to leave the
 * socket in a reusable state: an unread body left on a *kept-alive*
 * connection is not "gone" once the response is sent — the next request on
 * that same socket gets parsed starting wherever the abandoned body left
 * off, corrupting it. Closing the connection outright sidesteps the question
 * of how much Bun actually drained rather than depending on it. Every early
 * return below goes through this rather than a bare `Response.json`.
 */
function reject(error: string, status: number): Response {
  return Response.json(
    { error },
    { status, headers: { connection: "close" } },
  );
}

/**
 * Upload an icon for one game. Fails closed: no password configured means no
 * uploads accepted, not "anyone may write."
 */
export async function handleIconUpload(
  request: Request,
  gameIdRaw: string,
  peerAddress: string | null,
): Promise<Response> {
  if (ICON_UPLOAD_PASSWORD === null) {
    return reject("uploads are not configured", 503);
  }

  const key = callerKey(request, peerAddress);
  if (isLockedOut(key)) {
    return reject("too many wrong passwords — try again later", 429);
  }

  const password = request.headers.get("x-upload-password") ?? "";
  if (!passwordMatches(password, ICON_UPLOAD_PASSWORD)) {
    recordFailure(key);
    return reject("wrong password", 401);
  }
  clearFailures(key);

  let gameId: string;
  try {
    gameId = decodeURIComponent(gameIdRaw);
  } catch {
    return reject("malformed game id", 400);
  }
  if (!(VALID_GAME_IDS as readonly string[]).includes(gameId)) {
    return reject("unknown game", 400);
  }

  const contentLength = Number(request.headers.get("content-length") ?? "");
  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    return reject("missing file", 400);
  }
  // Deliberately not rejected here on a declared length over the cap: with
  // no body read yet, the response would have to force the connection
  // closed to stay safe (see `reject`'s own doc), and a size this small is
  // cheap to just read and check for real below instead — one fewer thing
  // that depends on Bun draining a cancelled stream correctly.

  const bytes = new Uint8Array(await request.arrayBuffer());
  // The header is a claim; this is the fact. A client that lied about
  // content-length is caught here rather than trusted.
  if (bytes.length > MAX_ICON_BYTES) {
    return Response.json(
      { error: `file must be under ${MAX_ICON_BYTES / (1024 * 1024)}MB` },
      { status: 413 },
    );
  }

  const ext = sniffImageExt(bytes);
  if (ext === null) {
    return Response.json(
      { error: "not a recognised image (png, jpg, webp or gif only)" },
      { status: 415 },
    );
  }

  const dir = resolve(ROOT_DIR, "game-icons");
  await mkdir(dir, { recursive: true });

  // Clear out any icon this game already had under a different extension —
  // otherwise re-uploading a .webp over an existing .png leaves both on disk,
  // and whichever the client's extension-guessing picks first wins by luck.
  const existing = await readdir(dir).catch(() => [] as string[]);
  for (const name of existing) {
    if (name.startsWith(`${gameId}.`) && !RESERVED_ICON_NAMES.has(name)) {
      await unlink(join(dir, name)).catch(() => {});
    }
  }

  const filename = `${gameId}${ext}`;
  await Bun.write(join(dir, filename), bytes);

  const manifestPath = join(dir, "manifest.json");
  const manifest = await Bun.file(manifestPath)
    .json()
    .catch(() => ({}) as Record<string, string>);
  manifest[gameId] = filename;
  await Bun.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return Response.json({ ok: true, file: filename });
}

const ICON_UPLOAD_PREFIX = "/api/game-icon/";

function startServer() {
  return Bun.serve({
  port: PORT,
  async fetch(request, server) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      const feed = Bun.file(resolve(ROOT_DIR, "data/events.v1.json"));
      const ok = await feed.exists();
      return Response.json(
        { status: ok ? "ok" : "no-feed", generatedAt: new Date().toISOString() },
        { status: ok ? 200 : 503 },
      );
    }

    if (request.method === "POST" && url.pathname.startsWith(ICON_UPLOAD_PREFIX)) {
      return handleIconUpload(
        request,
        url.pathname.slice(ICON_UPLOAD_PREFIX.length),
        server.requestIP(request)?.address ?? null,
      );
    }

    let decoded: string;
    try {
      decoded = decodeURIComponent(url.pathname);
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    if (decoded.includes("\0")) {
      return new Response("Bad request", { status: 400 });
    }

    const path = decoded === "/" ? "/index.html" : decoded;

    // Confine every read to public/ by resolving the path and checking it is
    // still inside the root. String-matching ".." is not enough: encodings and
    // URL normalisation both change what the string looks like, and only the
    // resolved path tells the truth about which file would be opened.
    const resolved = resolve(ROOT_DIR, `.${path}`);
    if (resolved !== ROOT_DIR && !resolved.startsWith(`${ROOT_DIR}/`)) {
      return new Response("Bad request", { status: 400 });
    }

    const file = Bun.file(resolved);

    if (await file.exists()) {
      return new Response(file, {
        headers: {
          "cache-control": CACHE[extname(path)] ?? "public, max-age=600",
          // The service worker must never be served stale, or a deploy can be
          // pinned by an old worker indefinitely.
          ...(path === "/sw.js"
            ? { "cache-control": "no-cache", "service-worker-allowed": "/" }
            : {}),
        },
      });
    }

    // Single-page app: unknown paths fall back to the shell so client routing
    // and deep links work. Anything under /data, /api or /game-icons is a
    // genuine 404 — a JSON fetch that silently got the HTML shell instead is
    // far harder to debug than a clean miss (this is exactly how the manifest
    // fetch on a fresh install, before anyone has uploaded an icon, has to
    // behave: "no manifest yet", not "here is the app").
    if (
      !path.startsWith("/data") &&
      !path.startsWith("/api") &&
      !path.startsWith("/game-icons")
    ) {
      const shell = Bun.file(resolve(ROOT_DIR, "index.html"));
      if (await shell.exists()) {
        return new Response(shell, {
          headers: { "cache-control": "public, max-age=0, must-revalidate" },
        });
      }
    }

    return new Response("Not found", { status: 404 });
  },
  });
}

// Importable for its pure/testable halves (VALID_GAME_IDS, handleIconUpload)
// without binding a port — test/serve-icon-upload.test.ts calls
// handleIconUpload directly, and test/serve.test.ts spawns this file as a
// subprocess instead, which is what actually exercises this branch.
if (import.meta.main) {
  const server = startServer();
  console.log(`Event Clock serving ${ROOT} on http://localhost:${server.port}`);
}
