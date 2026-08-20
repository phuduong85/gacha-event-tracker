import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Meter } from "../src/client/components/Meter.tsx";

const DAY = 24 * 60 * 60 * 1000;

function liveTicks(html: string): number {
  return [...html.matchAll(/data-live="true"/g)].length;
}

function unknown(html: string): boolean {
  return html.includes('data-unknown="true"');
}

describe("Meter, percentage mode", () => {
  test("a fresh event reads as a full strip", () => {
    const html = renderToStaticMarkup(
      <Meter progress={0} msRemaining={null} mode="percentage" urgency="calm" label="x" />,
    );
    expect(liveTicks(html)).toBe(24);
  });

  test("halfway through drains half the strip", () => {
    const html = renderToStaticMarkup(
      <Meter progress={0.5} msRemaining={null} mode="percentage" urgency="near" label="x" />,
    );
    expect(liveTicks(html)).toBe(12);
  });

  test("an unannounced end is hatched, not full", () => {
    const html = renderToStaticMarkup(
      <Meter progress={null} msRemaining={null} mode="percentage" urgency="calm" label="x" />,
    );
    expect(unknown(html)).toBe(true);
    expect(liveTicks(html)).toBe(0);
  });
});

describe("Meter, days mode", () => {
  // The user-reported case this mode exists for: two events with wildly
  // different total lengths were showing the same tick count under
  // percentage mode, because that mode always measures a share of the
  // event's own window rather than an absolute day count.

  test("more than 24 days left reads as a full strip, not '24+'", () => {
    const html = renderToStaticMarkup(
      <Meter
        progress={0.1}
        msRemaining={40 * DAY}
        mode="days"
        urgency="calm"
        label="x"
      />,
    );
    expect(liveTicks(html)).toBe(24);
  });

  test("exactly 24 days left is still the full strip, not one short", () => {
    const html = renderToStaticMarkup(
      <Meter progress={0} msRemaining={24 * DAY} mode="days" urgency="calm" label="x" />,
    );
    expect(liveTicks(html)).toBe(24);
  });

  test("once under 24 days, one tick is one day", () => {
    const html = renderToStaticMarkup(
      <Meter progress={0.8} msRemaining={5 * DAY} mode="days" urgency="soon" label="x" />,
    );
    expect(liveTicks(html)).toBe(5);
  });

  // Matches windowCaption's own leftDays math (shared/time.ts) — any time
  // left in the current day still counts as a whole day, so the meter and
  // the "X of Y days left" caption underneath it never disagree.
  test("part of a day left still counts as one whole tick", () => {
    const html = renderToStaticMarkup(
      <Meter
        progress={0.95}
        msRemaining={6 * 60 * 60 * 1000}
        mode="days"
        urgency="critical"
        label="x"
      />,
    );
    expect(liveTicks(html)).toBe(1);
  });

  test("nothing left is an empty strip, not a negative one", () => {
    const html = renderToStaticMarkup(
      <Meter progress={1} msRemaining={0} mode="days" urgency="critical" label="x" />,
    );
    expect(liveTicks(html)).toBe(0);
  });

  test("an unannounced end is hatched here too, regardless of progress", () => {
    const html = renderToStaticMarkup(
      <Meter progress={0} msRemaining={null} mode="days" urgency="calm" label="x" />,
    );
    expect(unknown(html)).toBe(true);
    expect(liveTicks(html)).toBe(0);
  });
});
