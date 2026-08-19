import { describe, expect, test } from "bun:test";
import {
  canStep,
  DAY_WIDTHS,
  DEFAULT_DAY_WIDTH,
  snapDayWidth,
  stepDayWidth,
  weekLabelStep,
} from "../src/client/state/zoom.ts";

/**
 * The timeline's scale.
 *
 * A patch cycle is six weeks and a login campaign can run for months, so the
 * reader picks how much time is on screen. What these pin down is the two ways
 * that can go wrong: a stored value the ladder no longer contains, and an axis
 * whose dates stop being readable once they are close enough together.
 */

describe("snapDayWidth", () => {
  test("a value on the ladder is left alone", () => {
    for (const width of DAY_WIDTHS) expect(snapDayWidth(width)).toBe(width);
  });

  test("a value between steps lands on the nearest one", () => {
    // An export written against a different ladder still opens on something
    // close to what its reader chose.
    expect(snapDayWidth(10)).toBe(9);
    expect(snapDayWidth(7)).toBe(6);
    expect(snapDayWidth(1000)).toBe(DAY_WIDTHS[DAY_WIDTHS.length - 1]!);
    // Exactly between two steps takes the wider one: ties go to the more
    // legible board.
    expect(snapDayWidth(11)).toBe(13);
  });

  test("an unusable value is the default, not the nearest edge", () => {
    // A corrupt number is not a preference, and a board one pixel wide is not
    // a scale anyone chose.
    expect(snapDayWidth(0)).toBe(DEFAULT_DAY_WIDTH);
    expect(snapDayWidth(-5)).toBe(DEFAULT_DAY_WIDTH);
    expect(snapDayWidth(Number.NaN)).toBe(DEFAULT_DAY_WIDTH);
    expect(snapDayWidth(Number.POSITIVE_INFINITY)).toBe(DEFAULT_DAY_WIDTH);
  });
});

describe("stepDayWidth", () => {
  test("moves one step at a time", () => {
    expect(stepDayWidth(13, 1)).toBe(20);
    expect(stepDayWidth(13, -1)).toBe(9);
  });

  test("stops at the ends rather than wrapping", () => {
    const widest = DAY_WIDTHS[DAY_WIDTHS.length - 1]!;
    const narrowest = DAY_WIDTHS[0]!;
    expect(stepDayWidth(widest, 1)).toBe(widest);
    expect(stepDayWidth(narrowest, -1)).toBe(narrowest);
  });

  test("the close end goes past a week on screen", () => {
    // Several events routinely end within a day of each other, and the reader
    // has to be able to tell those ends apart — at 48px a day they are a few
    // pixels between.
    expect(canStep(48, 1)).toBe(true);
    expect(stepDayWidth(48, 1)).toBe(72);
    const widest = DAY_WIDTHS[DAY_WIDTHS.length - 1]!;
    // A single day wider than a fingertip, so a one-day event is readable and
    // tappable rather than the 34px minimum bar.
    expect(widest).toBeGreaterThanOrEqual(96);
  });

  test("canStep says when a control has nowhere left to go", () => {
    expect(canStep(DAY_WIDTHS[0]!, -1)).toBe(false);
    expect(canStep(DAY_WIDTHS[0]!, 1)).toBe(true);
    expect(canStep(DAY_WIDTHS[DAY_WIDTHS.length - 1]!, 1)).toBe(false);
  });
});

describe("weekLabelStep", () => {
  test("every Monday is dated at the default scale and closer in", () => {
    expect(weekLabelStep(DEFAULT_DAY_WIDTH)).toBe(1);
    expect(weekLabelStep(48)).toBe(1);
  });

  test("dates thin out rather than overlapping when zoomed out", () => {
    // At six px a day a week is 42px and "18 Aug" is wider than that.
    expect(weekLabelStep(6)).toBeGreaterThan(1);
    expect(weekLabelStep(6) * 7 * 6).toBeGreaterThanOrEqual(64);
  });

  test("never asks for a label every zero weeks", () => {
    expect(weekLabelStep(1000)).toBe(1);
  });
});
