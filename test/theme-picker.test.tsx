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
  test("offers all three choices", () => {
    const html = render();
    expect(html).toContain("Sunset");
    expect(html).toContain("Ocean");
    expect(html).toContain("Mono");
  });

  test("marks the reader's stored choice as pressed, not the other two", () => {
    const html = render({ heatRamp: "ocean" });
    // Order in HEAT_RAMP_OPTIONS is Sunset, Ocean, Mono.
    expect(pressedIn(html, "Heat ramp")).toEqual(["false", "true", "false"]);
  });

  // The swatches are the point — a colour choice is something to see before
  // picking, not just a name to read — so they have to actually be the
  // ground this render is on, not a hardcoded set.
  test("swatches preview the resolved ground, not the raw choice", () => {
    const dark = render({ theme: "system", resolvedTheme: "dark" });
    expect(dark).toContain(HEAT_RAMPS.sunset.dark.critical);
    expect(dark).not.toContain(HEAT_RAMPS.sunset.paper.critical);

    const paper = render({ theme: "system", resolvedTheme: "light" });
    expect(paper).toContain(HEAT_RAMPS.sunset.paper.critical);
    expect(paper).not.toContain(HEAT_RAMPS.sunset.dark.critical);
  });

  test("glass previews on the same swatches as light — they share a ground", () => {
    const glass = render({ resolvedTheme: "glass" });
    expect(glass).toContain(HEAT_RAMPS.sunset.paper.critical);
    expect(glass).not.toContain(HEAT_RAMPS.sunset.dark.critical);
  });
});
