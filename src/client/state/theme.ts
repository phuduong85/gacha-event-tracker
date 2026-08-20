import { useEffect, useState } from "react";
import type { GameMeta } from "../../shared/games.ts";

/**
 * Which ground the app is drawn on.
 *
 * Almost everything about this is settled in CSS: `styles.css` holds the dark
 * tokens as the defaults and re-strikes them under `[data-theme="light"]` and
 * `[data-theme="glass"]`, so no component ever asks which theme it is in.
 * Three things cannot be settled
 * there, and they are what this module is:
 *
 * - **Resolving the reader's answer.** "System" is a choice about a preference
 *   they set elsewhere, and it has to be read and watched.
 * - **The game hues.** They are data, not tokens — `games.ts` for the games we
 *   track, the reader's own typing for theirs — and they were all picked
 *   against a near-black ground. On paper the brighter ones are unreadable, so
 *   they are darkened until they are not.
 * - **The browser's own chrome.** `<meta name="theme-color">` is markup, so it
 *   is set from here rather than styled.
 */
export type Theme = "dark" | "light" | "glass";

/**
 * What the reader chose, which is not the same as what gets drawn: `system`
 * defers to the device, and the other three override it outright.
 *
 * Glass is never what `system` resolves to (see `resolveTheme` below) — it is
 * a deliberate pick offered beside light, not a variant the OS preference can
 * land a reader in without asking.
 */
export type ThemeChoice = Theme | "system";

/**
 * Dark is the default and stays it.
 *
 * Not `system`: this app is a lit instrument panel and that is what it should
 * be on first sight, and a reader whose OS is in light mode has said something
 * about their OS rather than about this page. Defaulting to the device would
 * also silently move every existing reader the first time they load a build
 * that has this, which is the `knownGames` mistake in a different costume.
 * Choosing `system` is one tap, and then it *is* their answer.
 */
export const DEFAULT_THEME_CHOICE: ThemeChoice = "dark";

/** The media query "system" listens to. */
export const LIGHT_QUERY = "(prefers-color-scheme: light)";

/**
 * The `--color-ground` of each theme, duplicated out of `styles.css` because
 * `<meta name="theme-color">` is markup and cannot read a custom property. A
 * test pins each copy against its stylesheet value; the browser chrome
 * disagreeing with the page is exactly the kind of drift nobody files a bug
 * about.
 */
export const THEME_COLOR: Record<Theme, string> = {
  dark: "#12141c",
  light: "#edf0f7",
  glass: "#f7f1e6",
};

/** What the reader's choice comes to on this device, right now. */
export function resolveTheme(
  choice: ThemeChoice,
  systemPrefersLight: boolean,
): Theme {
  if (choice === "system") return systemPrefersLight ? "light" : "dark";
  return choice;
}

// ---------------------------------------------------------------------------
// Game hues on a light ground
// ---------------------------------------------------------------------------

/**
 * The smallest contrast a hue may have against the ground it is printed on.
 *
 * A hue is a lane label, a chip and a bar border — small text and thin lines,
 * so this is the 4.5:1 that applies to body copy rather than the 3:1 for large
 * text.
 */
const MIN_HUE_CONTRAST = 4.5;

/** `#abc` and `#aabbcc`, or null for anything else — a hue can be reader data. */
function parseHex(hex: string): [number, number, number] | null {
  const body = hex.trim().replace(/^#/, "");
  const full =
    body.length === 3
      ? body
          .split("")
          .map((c) => c + c)
          .join("")
      : body;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}

function toHex(channels: [number, number, number]): string {
  return `#${channels.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

/** WCAG relative luminance. */
function luminance([r, g, b]: [number, number, number]): number {
  const [lr, lg, lb] = [r, g, b].map((channel) => {
    const s = channel / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

const LIGHT_GROUND = parseHex(THEME_COLOR.light) as [number, number, number];

/**
 * The same hue, dark enough to read on this theme's ground.
 *
 * Dark is returned untouched, always: those hues were chosen against that
 * ground and every one of them clears the bar there, so adding a theme must
 * not move a single pixel of the app as it shipped.
 *
 * On light — and on glass, which shares this branch rather than getting its
 * own: its ground (styles.css) is just as pale as light's `--color-ground`,
 * so the same scale clears the same bar — it is a scale towards black — the
 * channels keep their ratios, so Genshin's blue stays Genshin's blue rather
 * than becoming a computed near-neighbour of Star Rail's. A hue that already
 * reads (Fate's navy) is left exactly as it is, and so is anything this
 * cannot parse: a reader's stored colour is not ours to reinterpret when we
 * do not understand it.
 */
export function readableHue(hue: string, theme: Theme): string {
  if (theme === "dark") return hue;
  const rgb = parseHex(hue);
  if (rgb === null) return hue;
  if (contrast(rgb, LIGHT_GROUND) >= MIN_HUE_CONTRAST) return hue;

  // Bisect the scale factor, measuring the colour that will actually be
  // written: rounding to 8-bit channels after the search would hand back
  // something a shade lighter than the one that passed, and by a hair's
  // breadth it can fail the bar it was chosen to clear.
  const at = (factor: number) =>
    rgb.map((c) => Math.round(c * factor)) as [number, number, number];

  // Twenty steps lands well inside one channel, and a fixed count keeps this
  // total — no loop that can fail to terminate on a colour nobody thought of.
  let tooDark = 0;
  let tooLight = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (tooDark + tooLight) / 2;
    if (contrast(at(mid), LIGHT_GROUND) >= MIN_HUE_CONTRAST) tooDark = mid;
    else tooLight = mid;
  }
  return toHex(at(tooDark));
}

/** A lane's metadata with its hue answered for this theme. */
export function metaOnTheme(meta: GameMeta, theme: Theme): GameMeta {
  const hue = readableHue(meta.hue, theme);
  return hue === meta.hue ? meta : { ...meta, hue };
}

// ---------------------------------------------------------------------------
// Applying it
// ---------------------------------------------------------------------------

/**
 * Put the resolved theme on the document.
 *
 * The attribute is what every token override in `styles.css` hangs off, and it
 * is the same attribute the pre-paint script in `index.html` sets — that script
 * is what stops a reader who chose light from being shown a dark page for the
 * length of a bundle download, and this keeps agreeing with it afterwards.
 */
export function applyTheme(theme: Theme, doc: Document = document): void {
  doc.documentElement.dataset["theme"] = theme;
  const meta = doc.querySelector('meta[name="theme-color"]');
  if (meta !== null) meta.setAttribute("content", THEME_COLOR[theme]);
}

// ---------------------------------------------------------------------------
// Heat ramps
// ---------------------------------------------------------------------------

/**
 * Which four colours `calm`/`near`/`soon`/`critical` are drawn in — a
 * reader's pick, independent of `Theme`. `styles.css` still carries one ramp
 * (`sunset`) baked into each `[data-theme]` block as the pre-JS default, the
 * same reason the pre-paint script in index.html exists for `Theme` itself;
 * `applyHeatRamp` below overrides those three tokens with an inline style
 * once a reader has picked something else, which wins the cascade over any
 * attribute-selector rule in the stylesheet without this needing a CSS block
 * for every theme × ramp combination.
 */
export type HeatRampId = "sunset" | "sunsetDark" | "ocean" | "mono";

interface HeatRamp {
  calm: string;
  near: string;
  soon: string;
  critical: string;
}

/**
 * Two grounds, not three: light and glass read the ramp identically already
 * (`styles.css`'s glass block copies light's heat tokens outright), so this
 * only needs the split `readableHue` already draws — dark, or everything
 * that isn't.
 */
type Ground = "dark" | "paper";

function groundFor(theme: Theme): Ground {
  return theme === "dark" ? "dark" : "paper";
}

/**
 * Sunset's own dark-ground values — pulled out because `sunsetDark` (below)
 * reuses them verbatim rather than risking a second hand-copied set drifting
 * from the first.
 */
const SUNSET_VIVID: HeatRamp = {
  calm: "#4ade80",
  near: "#facc15",
  soon: "#fb923c",
  critical: "#f87171",
};

/**
 * The four choices on offer, `sunset` first because it's the default.
 *
 * Every `paper` value clears the same ≥4.5:1 bar against a pale ground that
 * `styles.css`'s own comment holds itself to for the ramp it ships inline —
 * picking a different ramp must not be a readability downgrade — with one
 * declared exception: see `sunsetDark`. `dark` values have no such
 * constraint (that ground has room to spare) and are chosen for clarity
 * against near-black instead.
 */
export const HEAT_RAMPS: Record<HeatRampId, Record<Ground, HeatRamp>> = {
  /**
   * Green → yellow → orange → red — the "heat rising" story read the most
   * literally, and the ramp every reader sees until they open this picker.
   * `paper`'s middle two steps are Tailwind's 700 shade of each hue, chosen
   * over 800 (one step darker) specifically because at 800 yellow and orange
   * both collapse toward the same brown, and "under a week" next to "under 3
   * days" stopped being tellable apart — 700 is the lightest shade of each
   * that still clears 4.5:1.
   */
  sunset: {
    dark: SUNSET_VIVID,
    paper: { calm: "#157d3c", near: "#9b5f07", soon: "#c2410c", critical: "#b91c1c" },
  },
  /**
   * Sunset's dark-ground palette, worn on every ground rather than only the
   * one it was tuned for — a reader who wants the neon version on Light or
   * Glass rather than the dimmed-for-contrast one gets it exactly. This is
   * the one ramp in this table that does *not* clear 4.5:1 on a pale
   * ground: that's the whole point of picking it there, a deliberate trade
   * of legibility for the louder look, made by the reader rather than
   * assumed for them. Excluded from the "every ramp reads on paper" test
   * for exactly that reason — `theme.test.ts` names it explicitly rather
   * than silently skipping it.
   */
  sunsetDark: {
    dark: SUNSET_VIVID,
    paper: SUNSET_VIVID,
  },
  /**
   * Blue → teal → amber → red — cool while there's time, warm once there
   * isn't, without ever touching green. The one ramp here that stays
   * legible to red-green colour blindness the way `sunset` and its all-hues
   * story cannot promise to: nothing in this set asks a reader to tell green
   * apart from red, or teal apart from either.
   */
  ocean: {
    dark: { calm: "#60a5fa", near: "#2dd4bf", soon: "#fbbf24", critical: "#f87171" },
    paper: { calm: "#1d4ed8", near: "#0f766e", soon: "#b05109", critical: "#b91c1c" },
  },
  /**
   * Grey, grey, darker grey, then red — colour spent on one thing only.
   * `calm`/`near`/`soon` carry the ramp on lightness alone (brightening
   * toward critical on a dark ground, darkening toward it on a pale one, the
   * same direction the other two ramps' hues intensify in), so nothing here
   * asks a reader to tell two hues apart at all — only `critical` is a
   * colour, and it is the only one that needs to be.
   */
  mono: {
    dark: { calm: "#6b7280", near: "#9ca3af", soon: "#d1d5db", critical: "#f87171" },
    paper: { calm: "#5f6e83", near: "#475569", soon: "#44403c", critical: "#b91c1c" },
  },
};

/**
 * Write the chosen ramp onto the document as an inline style, which beats
 * any `[data-theme]` rule in the stylesheet without needing one written for
 * every theme × ramp pair. Idempotent and cheap enough to call on every
 * render of the effect below — `sunset` re-writes the same values the
 * stylesheet already has, which is a no-op the reader never sees.
 */
export function applyHeatRamp(
  theme: Theme,
  ramp: HeatRampId,
  doc: Document = document,
): void {
  const palette = HEAT_RAMPS[ramp][groundFor(theme)];
  const root = doc.documentElement.style;
  root.setProperty("--color-calm", palette.calm);
  root.setProperty("--color-near", palette.near);
  root.setProperty("--color-soon", palette.soon);
  root.setProperty("--color-critical", palette.critical);
}

/** Keeps the ramp in step with both the reader's pick and the ground it's drawn on. */
export function useHeatRamp(theme: Theme, ramp: HeatRampId): void {
  useEffect(() => applyHeatRamp(theme, ramp), [theme, ramp]);
}

function systemPrefersLight(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(LIGHT_QUERY).matches;
}

/**
 * The theme this render is in, kept in step with the device and written to the
 * document.
 *
 * The media query is watched whatever the choice is, so a reader on `system`
 * who flips their OS at sunset sees the page follow without a reload — and one
 * who has chosen a side is unaffected by it, because `resolveTheme` never asks.
 */
export function useTheme(choice: ThemeChoice): Theme {
  const [prefersLight, setPrefersLight] = useState(systemPrefersLight);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia(LIGHT_QUERY);
    const sync = () => setPrefersLight(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  const theme = resolveTheme(choice, prefersLight);
  useEffect(() => applyTheme(theme), [theme]);
  return theme;
}
