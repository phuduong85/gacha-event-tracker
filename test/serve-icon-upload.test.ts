import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameId } from "../src/shared/schema.ts";
import { VALID_GAME_IDS } from "../serve.ts";

/**
 * The one mutating route this static server has. Spawned as a real
 * subprocess per env configuration — `ICON_UPLOAD_PASSWORD` is read once at
 * module load, so a fresh process is the honest way to exercise "configured"
 * against "not configured" rather than fighting ES module caching.
 */

const PASSWORD = "test-password-Xy9!";

// Real magic bytes for each accepted type, padded past the minimum sniff
// length — these do not have to be valid, decodable images, only bytes the
// server's own sniff would recognise, which is all it actually checks.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
]);
const NOT_AN_IMAGE = new TextEncoder().encode("<script>alert(1)</script>");

describe("VALID_GAME_IDS", () => {
  test("agrees exactly with the real GameId enum", () => {
    // The runtime image ships serve.ts without src/shared/schema.ts (see the
    // comment on VALID_GAME_IDS), so this is the only thing keeping the
    // hand-copied list honest when a game is added or removed.
    expect(new Set(VALID_GAME_IDS)).toEqual(new Set(GameId.options));
  });
});

describe("icon upload, configured", () => {
  let proc: Bun.Subprocess;
  let base: string;
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "event-clock-icon-"));
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(
      join(root, "index.html"),
      "<!doctype html><html><body>shell</body></html>",
    );
    await writeFile(join(root, "sw.js"), "// worker");
    await writeFile(
      join(root, "data", "events.v1.json"),
      JSON.stringify({ schemaVersion: 1, generatedAt: "", events: [], sources: [] }),
    );

    const port = 3700 + Math.floor(Math.random() * 500);
    base = `http://127.0.0.1:${port}`;
    proc = Bun.spawn(["bun", "run", "serve.ts"], {
      env: {
        ...process.env,
        PORT: String(port),
        PUBLIC_DIR: root,
        ICON_UPLOAD_PASSWORD: PASSWORD,
      },
      stdout: "ignore",
      stderr: "pipe",
    });

    for (let i = 0; i < 40; i += 1) {
      if (proc.exitCode !== null) {
        const stderr = proc.stderr;
        const why =
          stderr instanceof ReadableStream
            ? await new Response(stderr).text()
            : "(no stderr captured)";
        throw new Error(
          `serve.ts exited with ${proc.exitCode} before listening:\n${why.slice(0, 500)}`,
        );
      }
      try {
        await fetch(`${base}/api/health`);
        return;
      } catch {
        await Bun.sleep(50);
      }
    }
    throw new Error(`server did not listen on ${base} within 2s`);
  }, 10_000);

  afterAll(async () => {
    proc.kill();
    await rm(root, { recursive: true, force: true });
  });

  function upload(gameId: string, body: Uint8Array, password = PASSWORD) {
    return fetch(`${base}/api/game-icon/${gameId}`, {
      method: "POST",
      headers: { "X-Upload-Password": password },
      body: new Blob([body as BlobPart]),
    });
  }

  test("rejects a wrong password", async () => {
    const res = await upload("genshin", PNG, "wrong");
    expect(res.status).toBe(401);
  });

  test("rejects a game id that is not tracked", async () => {
    const res = await upload("not-a-real-game", PNG);
    expect(res.status).toBe(400);
  });

  test("rejects a path-traversal attempt disguised as a game id", async () => {
    const res = await fetch(`${base}/api/game-icon/..%2f..%2fetc%2fpasswd`, {
      method: "POST",
      headers: { "X-Upload-Password": PASSWORD },
      body: new Blob([PNG]),
    });
    expect(res.status).toBe(400);
  });

  test("rejects bytes that are not a recognised image, whatever the extension implies", async () => {
    const res = await upload("genshin", NOT_AN_IMAGE);
    expect(res.status).toBe(415);
  });

  test("rejects a file over the size cap", async () => {
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set(PNG);
    const res = await upload("genshin", big);
    expect(res.status).toBe(413);
  });

  test("accepts a real image, writes it, and records it in the manifest", async () => {
    const res = await upload("hsr", PNG);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; file: string };
    expect(body.ok).toBe(true);
    expect(body.file).toBe("hsr.png");

    const written = await readFile(join(root, "game-icons", "hsr.png"));
    expect(new Uint8Array(written)).toEqual(PNG);

    const manifest = JSON.parse(
      await readFile(join(root, "game-icons", "manifest.json"), "utf8"),
    ) as Record<string, string>;
    expect(manifest.hsr).toBe("hsr.png");

    // The manifest is then just a static file — no special route for it.
    const served = await fetch(`${base}/game-icons/manifest.json`);
    expect(served.status).toBe(200);
    expect(await served.json()).toEqual(manifest);
  });

  test("re-uploading under a different format removes the old file", async () => {
    await upload("zzz", PNG);
    expect(
      await Bun.file(join(root, "game-icons", "zzz.png")).exists(),
    ).toBe(true);

    await upload("zzz", WEBP);
    expect(
      await Bun.file(join(root, "game-icons", "zzz.png")).exists(),
    ).toBe(false);
    expect(
      await Bun.file(join(root, "game-icons", "zzz.webp")).exists(),
    ).toBe(true);
  });

  test("sniffs jpeg correctly too", async () => {
    const res = await upload("wuwa", JPEG);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { file: string }).file).toBe("wuwa.jpg");
  });

  test("locks out further attempts after repeated wrong passwords", async () => {
    // A fresh game id's worth of attempts so this doesn't collide with the
    // successful calls above sharing the same in-process caller key.
    let last = new Response(null, { status: 200 });
    for (let i = 0; i < 10; i += 1) {
      last = await upload("p5x", PNG, "still-wrong");
    }
    expect(last.status).toBe(429);
  });

  test("a missing manifest 404s rather than falling back to the app shell", async () => {
    // Exercised against a game that was never uploaded in this run.
    const res = await fetch(`${base}/game-icons/r1999.png`);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("shell");
  });
});

describe("icon upload, not configured", () => {
  let proc: Bun.Subprocess;
  let base: string;
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "event-clock-icon-off-"));
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(join(root, "index.html"), "<!doctype html><html></html>");
    await writeFile(
      join(root, "data", "events.v1.json"),
      JSON.stringify({ schemaVersion: 1, generatedAt: "", events: [], sources: [] }),
    );

    const port = 3900 + Math.floor(Math.random() * 500);
    base = `http://127.0.0.1:${port}`;
    // ICON_UPLOAD_PASSWORD deliberately absent — and cwd is the temp root,
    // not the repo, or Bun's own auto-load would pull the real value back in
    // from the repo's .env regardless of what's deleted from `env` below.
    const env = { ...process.env };
    delete env["ICON_UPLOAD_PASSWORD"];
    const serveTs = new URL("../serve.ts", import.meta.url).pathname;
    proc = Bun.spawn(["bun", "run", serveTs], {
      cwd: root,
      env: { ...env, PORT: String(port), PUBLIC_DIR: root },
      stdout: "ignore",
      stderr: "pipe",
    });

    for (let i = 0; i < 40; i += 1) {
      if (proc.exitCode !== null) break;
      try {
        await fetch(`${base}/api/health`);
        return;
      } catch {
        await Bun.sleep(50);
      }
    }
  }, 10_000);

  afterAll(async () => {
    proc.kill();
    await rm(root, { recursive: true, force: true });
  });

  test("fails closed: no password configured means no uploads accepted, right password or not", async () => {
    const res = await fetch(`${base}/api/game-icon/genshin`, {
      method: "POST",
      headers: { "X-Upload-Password": "anything" },
      body: new Blob([PNG]),
    });
    expect(res.status).toBe(503);
  });
});
