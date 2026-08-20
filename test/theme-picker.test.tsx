import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ThemePicker } from "../src/client/components/ThemePicker.tsx";
import { HEAT_RAMPS } from "../src/client/state/theme.ts";

function render(overrides: Partial<Parameters<typeof ThemePicker>[0]> = {}): string {
  return renderToStaticMarkup(
    <ThemePicker
      theme="dark"
      resolvedTheme="dark"
      meterMode="percentage"
      heatRamp="sunset"
      onUpdate={() => {}}
      onClose={() => {}}
      {...overrides}
    />,
  );
}

function pressedIn(html: string, groupLabel: string): string[] {
  const group = new RegExp(
    `<div role="group" aria-label="${groupLabel}"[^]*?<\\/div>`,
  ).exec(html);
  expect(group).not.toBeNull();
  return [...group![0].matchAll(/aria-pressed="(true|false)"/g)].map((m) => m[1]!);
}

/**
 * One ramp option's own button, by its exact label — "Sunset" would
 * otherwise also match inside "Dark Sunset"'s rendering, which is exactly
 * the kind of substring collision `toContain` can't see past.
 */
function rampButton(html: string, label: string): string {
  const button = new RegExp(`>${label}<[^]*?<\\/button>`).exec(html);
  expect(button).not.toBeNull();
  return button![0];
}

describe("the theme control", () => {
  test("offers all four choices", () => {
    const html = render({ theme: "system" });
    expect(html).toContain("System");
    expect(html).toContain("Dark");
    expect(html).toContain("Light");
    expect(html).toContain("Glass");
  });

  test("marks the reader's stored choice as pressed, not the other three", () => {
    const html = render({ theme: "light" });
    // Order in THEMES is Dark, Light, Glass, System.
    expect(pressedIn(html, "Theme")).toEqual(["false", "true", "false", "false"]);
  });
});

describe("the meter control", () => {
  test("offers both choices", () => {
    const html = render();
    expect(html).toContain("Percentage");
    expect(html).toContain("Per day");
  });

  test("marks the reader's stored choice as pressed, not the other", () => {
    const html = render({ meterMode: "days" });
    // Order in METER_MODES is Percentage, Per day.
    expect(pressedIn(html, "Meter")).toEqual(["false", "true"]);
  });
});

describe("the heat ramp control", () => {
  test("offers all four choices", () => {
    const html = render();
    expect(html).toContain("Sunset");
    expect(html).toContain("Dark Sunset");
    expect(html).toContain("Ocean");
    expect(html).toContain("Mono");
  });

  test("marks the reader's stored choice as pressed, not the other three", () => {
    const html = render({ heatRamp: "ocean" });
    // Order in HEAT_RAMP_OPTIONS is Sunset, Dark Sunset, Ocean, Mono.
    expect(pressedIn(html, "Heat ramp")).toEqual(["false", "false", "true", "false"]);
  });

  test("Dark Sunset previews sunset's dark palette on every ground, unlike Sunset itself", () => {
    // The one option where the paper swatch is deliberately the dark one —
    // that's the feature, not a bug this test should catch.
    const onLight = render({ resolvedTheme: "light" });
    const darkSunsetRow = rampButton(onLight, "Dark Sunset");
    expect(darkSunsetRow).toContain(HEAT_RAMPS.sunset.dark.critical);
    expect(darkSunsetRow).not.toContain(HEAT_RAMPS.sunset.paper.critical);

    // Sunset's own row, right beside it, still dims for the same ground.
    const sunsetRow = rampButton(onLight, "Sunset");
    expect(sunsetRow).toContain(HEAT_RAMPS.sunset.paper.critical);
    expect(sunsetRow).not.toContain(HEAT_RAMPS.sunset.dark.critical);
  });

  // The swatches are the point — a colour choice is something to see before
  // picking, not just a name to read — so they have to actually be the
  // ground this render is on, not a hardcoded set. Scoped to Sunset's own
  // button throughout: Dark Sunset's row deliberately ignores the ground
  // (tested above), so it would collide with a whole-page check here.
  test("swatches preview the resolved ground, not the raw choice", () => {
    const dark = rampButton(render({ theme: "system", resolvedTheme: "dark" }), "Sunset");
    expect(dark).toContain(HEAT_RAMPS.sunset.dark.critical);
    expect(dark).not.toContain(HEAT_RAMPS.sunset.paper.critical);

    const paper = rampButton(render({ theme: "system", resolvedTheme: "light" }), "Sunset");
    expect(paper).toContain(HEAT_RAMPS.sunset.paper.critical);
    expect(paper).not.toContain(HEAT_RAMPS.sunset.dark.critical);
  });

  test("glass previews on the same swatches as light — they share a ground", () => {
    const glass = rampButton(render({ resolvedTheme: "glass" }), "Sunset");
    expect(glass).toContain(HEAT_RAMPS.sunset.paper.critical);
    expect(glass).not.toContain(HEAT_RAMPS.sunset.dark.critical);
  });
});
