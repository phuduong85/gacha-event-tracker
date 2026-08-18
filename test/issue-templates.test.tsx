import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BUG_URL,
  Credits,
  FEATURE_URL,
  bugReportUrl,
} from "../src/client/components/Credits.tsx";

/**
 * The issue forms, and the app's links into them.
 *
 * These pin a seam nothing else can see: GitHub answers a malformed form with a
 * rendered error only a visitor notices, and it drops a prefill parameter that
 * names no field with no error at all. Both failures look exactly like a working
 * link from here, so the only place they can be caught is a test that reads the
 * YAML the links point at.
 *
 * Reads repo files, never build output — see AGENTS.md § Commands.
 */

const DIR = ".github/ISSUE_TEMPLATE";

/**
 * Whether the README is in this context at all.
 *
 * The image build runs this suite as its gate, and `.dockerignore` excludes the
 * README along with `docs/` and `AGENTS.md` — deliberately, so that editing a
 * doc does not invalidate the layer that installs, tests and builds. `.github/`
 * is copied in for the opposite reason, which is why every other check here runs
 * there unchanged.
 *
 * So the README check stands down where the file was left out on purpose, rather
 * than failing the image on the absence of something that context does not ship.
 * It still runs in CI and locally, which is where a README link gets edited.
 */
const HAS_README = await Bun.file("README.md").exists();

type Field = {
  type: string;
  id?: string;
  attributes?: { label?: string };
  validations?: { required?: boolean };
};
type Form = { name?: string; description?: string; labels?: string[]; body?: Field[] };

async function form(file: string): Promise<Form> {
  const text = await Bun.file(`${DIR}/${file}`).text();
  return Bun.YAML.parse(text) as Form;
}

/** The `template=` filename a link points at, and its prefill parameters. */
function link(url: string): { template: string | null; params: URLSearchParams } {
  const parsed = new URL(url);
  const params = parsed.searchParams;
  return { template: params.get("template"), params };
}

describe("issue forms", () => {
  for (const file of ["bug_report.yml", "feature_request.yml"]) {
    test(`${file} is a well-formed issue form`, async () => {
      const doc = await form(file);

      expect(doc.name).toBeTruthy();
      expect(doc.description).toBeTruthy();
      expect(doc.body?.length).toBeGreaterThan(0);

      for (const field of doc.body ?? []) {
        // GitHub rejects an unknown type outright.
        expect([
          "markdown",
          "input",
          "textarea",
          "dropdown",
          "checkboxes",
        ]).toContain(field.type);

        // Every field that collects an answer needs a label to collect it under,
        // and an id, or its answer cannot be prefilled or referenced.
        if (field.type !== "markdown") {
          expect(field.attributes?.label).toBeTruthy();
          expect(field.id).toBeTruthy();
        }
      }
    });

    test(`${file} has unique field ids`, async () => {
      const ids = (await form(file)).body?.flatMap((f) => f.id ?? []) ?? [];
      expect(new Set(ids).size).toBe(ids.length);
    });

    test(`${file} asks for something, but not for everything`, async () => {
      const answered = (await form(file)).body?.filter((f) => f.type !== "markdown") ?? [];
      const required = answered.filter((f) => f.validations?.required === true);

      // At least one required field, or the form accepts an empty report.
      expect(required.length).toBeGreaterThan(0);
      // A form that demands every field is one a reader abandons — and this app
      // has no account to look anything up in, so an abandoned report is the
      // whole loss.
      expect(required.length).toBeLessThan(answered.length);
    });

    test(`${file} uses only labels a fresh repository already has`, async () => {
      // A template naming a label that does not exist applies nothing, silently.
      for (const label of (await form(file)).labels ?? []) {
        expect(["bug", "enhancement"]).toContain(label);
      }
    });
  }

  test("config.yml keeps the blank-issue escape hatch open", async () => {
    const text = await Bun.file(`${DIR}/config.yml`).text();
    expect(Bun.YAML.parse(text)).toEqual({ blank_issues_enabled: true });
  });
});

describe("the app's links into them", () => {
  test("each points at a template file that exists", async () => {
    for (const url of [BUG_URL, FEATURE_URL]) {
      const { template } = link(url);
      expect(template).toBeTruthy();
      expect(await Bun.file(`${DIR}/${template}`).exists()).toBe(true);
    }
  });

  test("the prefilled freshness line names a real field on the bug form", async () => {
    const ids = (await form("bug_report.yml")).body?.flatMap((f) => f.id ?? []) ?? [];
    const { params } = link(bugReportUrl("15 Aug 2026, 04:12 — 2 days ago"));

    for (const key of params.keys()) {
      if (key === "template") continue;
      // The failure this catches: renaming the field id leaves the link working
      // and the prefill gone, with nothing anywhere to say so.
      expect(ids).toContain(key);
    }
    expect(params.get("refreshed")).toBe("15 Aug 2026, 04:12 — 2 days ago");
  });

  test.skipIf(!HAS_README)("every template link in the README names a template that exists", async () => {
    // A `?template=` that names nothing lands the reader on the chooser instead,
    // which looks close enough to working that nobody reports it.
    const readme = await Bun.file("README.md").text();
    const named = [...readme.matchAll(/issues\/new\?template=([\w.-]+)/g)].map(
      (m) => m[1],
    );

    expect(named.length).toBeGreaterThan(0);
    for (const template of named) {
      expect(await Bun.file(`${DIR}/${template}`).exists()).toBe(true);
    }
    // Both forms are reachable from the README, not just the one.
    expect(new Set(named)).toEqual(
      new Set(["bug_report.yml", "feature_request.yml"]),
    );
  });

  test("the credits sheet offers both, and carries the freshness value into the bug form", () => {
    // The freshness line itself is shown next to the game list now
    // (Freshness.tsx, test/freshness.test.tsx), not here — but Credits still
    // has to compute the same value and carry it into the bug link, since a
    // report should arrive already saying whether the calendar was current.
    const NOW = Date.parse("2026-08-17T12:00:00.000Z");
    const html = renderToStaticMarkup(
      <Credits
        sources={[
          {
            sourceId: "genshin-game8-events",
            game: "genshin",
            url: "https://game8.co/games/Genshin-Impact/archives/301601",
            lastSuccessAt: new Date(NOW - 3 * 60 * 60 * 1000).toISOString(),
            eventCount: 9,
          },
        ]}
        now={NOW}
        onClose={() => {}}
      />,
    );

    expect(html).toContain("Report a problem");
    expect(html).toContain("request a feature");
    expect(html).toContain("template=feature_request.yml");
    // The age the report link carries matches what Freshness would have shown.
    expect(html).toContain(encodeURIComponent("3h 0m ago"));
  });

  test("an unfetched feed prefills nothing rather than an empty value", () => {
    // "" in the field reads as an answer the reader gave, and a report claiming
    // the app never refreshed is worse than one that leaves the question open.
    expect(bugReportUrl(null)).toBe(BUG_URL);
    expect(link(bugReportUrl(null)).params.has("refreshed")).toBe(false);
  });
});
