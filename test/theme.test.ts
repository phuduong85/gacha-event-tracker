import { describe, expect, test } from "bun:test";
import { GAMES, metaFor } from "../src/shared/games.ts";
import { CUSTOM_HUES } from "../src/client/components/CustomForms.tsx";
import { KEYS } from "../src/client/state/storage.ts";
import {
  DEFAULT_THEME_CHOICE,
  HEAT_RAMPS,
  metaOnTheme,
  readableHue,
  resolveTheme,
  THEME_COLOR,
} from "../src/client/state/theme.ts";

/**
 * Light mode.
 *
 * Three things are worth pinning and one of them is the whole risk. The dark
 * theme is what this app is and what every hue in `games.ts` was picked
 * against, so a light theme that moves it has broken something nobody asked to
 * change. The light theme has to be *readable* — a hue is a lane label at
 * 10px, and one that washes out on paper takes a game's identity with it. And
 * the ground colour is written down in three places that cannot import each
 * other (the stylesheet, this module, the pre-paint script in the shell), so
 * the copies are checked against each other rather than trusted.
 *
 * Glass reuses this same pinning, both senses: it shares light's hue branch
 * (below), and its own ground gets the identical three-place check.
 */

// An independent implementation of WCAG contrast — deliberately not the one in
// theme.ts, so this measures the output rather than agreeing with the method.
function luminance(hex: string): number {
  const body = hex.replace("#", "");
  const channels = [0, 2, 4].map((i) => {
    const s = parseInt(body.slice(i, i + 2), 16) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

const HUES = [
  ...Object.values(GAMES).map((game) => game.hue),
  ...CUSTOM_HUES,
  // What an unknown lane is drawn in — an import can carry an event whose game
  // did not come with it.
  metaFor("mygame:nothing-here", {}).hue,
];

describe("resolveTheme", () => {
  test("dark is the default, and it is a side rather than the device's", () => {
    expect(DEFAULT_THEME_CHOICE).toBe("dark");
    expect(resolveTheme(DEFAULT_THEME_CHOICE, true)).toBe("dark");
  });

  test("a reader who picked a side gets it whatever the device says", () => {
    expect(resolveTheme("dark", true)).toBe("dark");
    expect(resolveTheme("light", false)).toBe("light");
  });

  test("system is the device's answer, both ways", () => {
    expect(resolveTheme("system", true)).toBe("light");
    expect(resolveTheme("system", false)).toBe("dark");
  });

  test("glass is a pick, not something system can land on", () => {
    expect(resolveTheme("glass", true)).toBe("glass");
    expect(resolveTheme("glass", false)).toBe("glass");
  });
});

describe("readableHue", () => {
  test("dark is untouched, hue for hue", () => {
    // The one thing adding a theme must not do is change the theme that was
    // already there. These colours were chosen against this ground.
    for (const hue of HUES) expect(readableHue(hue, "dark")).toBe(hue);
  });

  test("every hue reads on the light ground", () => {
    for (const hue of HUES) {
      const adjusted = readableHue(hue, "light");
      expect(contrast(adjusted, THEME_COLOR.light)).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("a hue that already reads is left alone", () => {
    // A navy this dark already clears the bar against the paper ground;
    // darkening it further would cost a game its identity to fix a problem it
    // does not have.
    const navy = "#1D3A8F";
    expect(readableHue(navy, "light")).toBe(navy);
  });

  test("darkening keeps the colour, not just the contrast", () => {
    // Wuthering Waves is green before and after. A hue is an identity, so a
    // legibility fix that turned every lane into the same slate would be worse
    // than the illegibility.
    const green = readableHue(GAMES.wuwa.hue, "light");
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(green.slice(i, i + 2), 16));
    expect(g).toBeGreaterThan(r!);
    expect(g).toBeGreaterThan(b!);
  });

  test("a colour we cannot read is not reinterpreted", () => {
    // Custom hues are stored in the reader's browser and could be anything.
    // Guessing at one we do not understand is worse than leaving it.
    for (const odd of ["", "rebeccapurple", "var(--color-ink)", "#12345"]) {
      expect(readableHue(odd, "light")).toBe(odd);
    }
  });

  test("shorthand hex is understood rather than passed through", () => {
    expect(readableHue("#3d6", "light")).toBe(readableHue("#33dd66", "light"));
  });

  test("every hue reads on the glass ground too", () => {
    for (const hue of HUES) {
      const adjusted = readableHue(hue, "glass");
      expect(contrast(adjusted, THEME_COLOR.glass)).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("glass darkens a hue exactly the way light does", () => {
    // Glass shares light's branch in readableHue rather than getting its own
    // — its ground is just as pale, so there is nothing to compute twice.
    for (const hue of HUES) {
      expect(readableHue(hue, "glass")).toBe(readableHue(hue, "light"));
    }
  });
});

describe("metaOnTheme", () => {
  const meta = GAMES.wuwa;

  test("names and clocks are untouched; only the hue is answered", () => {
    const light = metaOnTheme(meta, "light");
    expect(light.hue).not.toBe(meta.hue);
    expect({ ...light, hue: meta.hue }).toEqual(meta);
  });

  test("the dark answer is the same object, so nothing re-renders for it", () => {
    expect(metaOnTheme(meta, "dark")).toBe(meta);
  });
});

describe("the ground colour, in all three places it is written down", () => {
  test("the stylesheet and the module agree", async () => {
    const css = await Bun.file(
      new URL("../src/client/styles.css", import.meta.url),
    ).text();

    // The dark value is in @theme, the other two each under their own
    // attribute selector.
    const dark = /@theme\s*\{[^}]*?--color-ground:\s*([^;]+);/s.exec(css);
    const light =
      /\[data-theme="light"\]\s*\{[^}]*?--color-ground:\s*([^;]+);/s.exec(css);
    const glass =
      /\[data-theme="glass"\]\s*\{[^}]*?--color-ground:\s*([^;]+);/s.exec(css);
    expect(dark?.[1]?.trim()).toBe(THEME_COLOR.dark);
    expect(light?.[1]?.trim()).toBe(THEME_COLOR.light);
    expect(glass?.[1]?.trim()).toBe(THEME_COLOR.glass);
  });

  test("the shell paints the right ground before the bundle arrives", async () => {
    const shell = await Bun.file(
      new URL("../index.html", import.meta.url),
    ).text();

    // The pre-paint script is the only reason a reader on light or glass does
    // not get a dark flash on every load, and it cannot import any of this.
    expect(shell).toContain(KEYS.prefs);
    expect(shell).toContain(THEME_COLOR.dark);
    expect(shell).toContain(THEME_COLOR.light);
    expect(shell).toContain(THEME_COLOR.glass);
  });
});

describe("HEAT_RAMPS", () => {
  const ids = Object.keys(HEAT_RAMPS) as Array<keyof typeof HEAT_RAMPS>;

  // sunsetDark is the one ramp that deliberately does not clear 4.5:1 on
  // paper — that's the whole point of it (see its own doc comment) — so it
  // is named here rather than silently exempted by a blanket try/catch.
  const ACCESSIBLE_ON_PAPER = ids.filter((id) => id !== "sunsetDark");

  test("every accessible ramp's paper variant clears the same 4.5:1 bar the shipped one does", () => {
    // The claim each ramp's own doc comment makes — checked here rather than
    // trusted, the same way readableHue's light output is above.
    for (const id of ACCESSIBLE_ON_PAPER) {
      const { calm, near, soon, critical } = HEAT_RAMPS[id].paper;
      for (const step of [calm, near, soon, critical]) {
        expect(contrast(step, THEME_COLOR.light)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  test("sunsetDark is sunset's own dark-ground palette, on every ground", () => {
    expect(HEAT_RAMPS.sunsetDark.dark).toEqual(HEAT_RAMPS.sunset.dark);
    expect(HEAT_RAMPS.sunsetDark.paper).toEqual(HEAT_RAMPS.sunset.dark);
  });

  test("no ramp repeats a colour across its own four steps", () => {
    // calm/near/soon/critical is meant to read as four states, on both
    // grounds — a repeat would silently merge two of them into one.
    for (const id of ids) {
      for (const ground of ["dark", "paper"] as const) {
        const steps = Object.values(HEAT_RAMPS[id][ground]);
        expect(new Set(steps).size).toBe(steps.length);
      }
    }
  });

  test("the stylesheet's baked-in ramp is HEAT_RAMPS.sunset, exactly", async () => {
    // styles.css carries `sunset` directly, as the pre-JS default applyHeatRamp
    // (state/theme.ts) then redraws over — see that stylesheet's own comment
    // on the light block. The two must never drift: a mismatch would mean
    // the page paints one ramp and then visibly jumps to another once React
    // mounts, even for a reader who never touched this setting.
    const css = await Bun.file(
      new URL("../src/client/styles.css", import.meta.url),
    ).text();

    const extract = (block: RegExp) => ({
      calm: new RegExp(`${block.source}[^}]*?--color-calm:\\s*([^;]+);`, "s").exec(css)?.[1]?.trim(),
      near: new RegExp(`${block.source}[^}]*?--color-near:\\s*([^;]+);`, "s").exec(css)?.[1]?.trim(),
      soon: new RegExp(`${block.source}[^}]*?--color-soon:\\s*([^;]+);`, "s").exec(css)?.[1]?.trim(),
      critical: new RegExp(`${block.source}[^}]*?--color-critical:\\s*([^;]+);`, "s").exec(css)?.[1]?.trim(),
    });

    expect(extract(/@theme\s*\{/)).toEqual(HEAT_RAMPS.sunset.dark);
    expect(extract(/\[data-theme="light"\]\s*\{/)).toEqual(HEAT_RAMPS.sunset.paper);
    expect(extract(/\[data-theme="glass"\]\s*\{/)).toEqual(HEAT_RAMPS.sunset.paper);
  });
});
