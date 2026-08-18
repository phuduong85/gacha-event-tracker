/**
 * Stage the static half of the build into public/: the shell, the service
 * worker, the manifest and the icon.
 *
 * This was a `sed` chain in package.json. It grew a job a shell one-liner
 * cannot do: stamping the service worker with a hash of the built shell, so
 * that a deploy is *detectable* by a browser that already has the app. The
 * browser decides a worker is new by comparing its bytes, so an update the
 * worker file does not mention is an update no reader is ever offered.
 *
 * Deriving that stamp from the built bytes rather than from a constant someone
 * remembers to bump is the point: the previous scheme was a hand-edited
 * `CACHE_VERSION`, and it had already been forgotten once and fixed in a
 * follow-up commit.
 */
import { mkdir } from "node:fs/promises";
import { basename, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const OUT = resolve(ROOT, process.env.PUBLIC_DIR ?? "public");
/** Trailing slash matters: it is a `<base href>`, not a prefix. */
const BASE_PATH = process.env.BASE_PATH ?? "/";

/** The literal the service worker carries so this script has something to replace. */
export const BUILD_PLACEHOLDER = "__BUILD__";

/**
 * A short, stable name for exactly these bytes.
 *
 * Deterministic on purpose: an identical rebuild produces an identical id, so
 * nobody is told to reload for a deploy that changed nothing. A timestamp would
 * have been easier and would have prompted every reader on every rebuild.
 */
export function buildId(parts: Array<string | Uint8Array>): string {
  const hasher = new Bun.CryptoHasher("sha256");
  for (const part of parts) hasher.update(part);
  return hasher.digest("hex").slice(0, 12);
}

/**
 * Stamp the build id into the worker source.
 *
 * Throws when the placeholder is gone. That is the failure this whole mechanism
 * is prone to — an edit to sw.js drops the marker, the substitution quietly
 * matches nothing, and readers stop being offered updates with nothing broken
 * enough to notice. Better to fail the build.
 */
export function injectBuild(source: string, id: string): string {
  if (!source.includes(BUILD_PLACEHOLDER)) {
    throw new Error(
      `sw.js no longer contains ${BUILD_PLACEHOLDER}; without it a deploy is undetectable by an installed app`,
    );
  }
  return source.replaceAll(BUILD_PLACEHOLDER, id);
}

/** Bytes of a built asset, or null if this stage ran without it. */
async function bytesOf(path: string): Promise<Uint8Array | null> {
  const file = Bun.file(path);
  return (await file.exists()) ? new Uint8Array(await file.arrayBuffer()) : null;
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });

  const shell = (await Bun.file(resolve(ROOT, "index.html")).text()).replaceAll(
    "__BASE__",
    BASE_PATH,
  );
  await Bun.write(resolve(OUT, "index.html"), shell);

  const workerSource = await Bun.file(
    resolve(ROOT, "src/client/sw.js"),
  ).text();

  // Everything a reader would be reloading *for*. Not the feed: it is rewritten
  // twice a day by the refresh and served network-first, so new events reach an
  // open page without one — and calling that a new version of the app would
  // train readers to ignore the notice.
  const built = ["main.js", "styles.css"];
  const assets: Array<string | Uint8Array> = [shell, workerSource];
  for (const name of built) {
    const bytes = await bytesOf(resolve(OUT, name));
    if (bytes === null) {
      console.warn(
        `build-static: ${name} is missing from ${basename(OUT)}/ — run the full \`bun run build\``,
      );
      continue;
    }
    assets.push(bytes);
  }

  const id = buildId(assets);
  await Bun.write(resolve(OUT, "sw.js"), injectBuild(workerSource, id));

  for (const name of [
    "manifest.webmanifest",
    "icon.svg",
    "icon-192.png",
    "icon-512.png",
    "apple-touch-icon.png",
  ]) {
    await Bun.write(
      resolve(OUT, name),
      Bun.file(resolve(ROOT, "src/client", name)),
    );
  }

  console.log(`build-static: staged ${basename(OUT)}/ at build ${id}`);
}

// Importable for its two pure halves without staging anything.
if (import.meta.main) await main();
