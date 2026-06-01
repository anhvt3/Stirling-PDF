import { describe, expect, it } from "vitest";
import {
  currentFontPt,
  imageBoxPt,
  moveImageTransform,
  resizeImageTransformSE,
  scaleFactorForResize,
  scaleTextElement,
  MIN_IMAGE_PT,
  type ResizableText,
} from "./editObjectsMath";

describe("currentFontPt", () => {
  it("reads vertical scale (hypot of b,d) to match backend resolveFontMatrixSize", () => {
    // Unrotated 18pt text: [18,0,0,18,e,f].
    expect(currentFontPt({ textMatrix: [18, 0, 0, 18, 100, 200] })).toBeCloseTo(18);
  });

  it("uses hypot(b,d) for a rotated matrix (vertical scale preserved)", () => {
    // 90° rotation of a 20pt glyph: a=0,b=20,c=-20,d=0.
    expect(currentFontPt({ textMatrix: [0, 20, -20, 0, 0, 0] })).toBeCloseTo(20);
  });

  it("falls back to fontSize when no usable matrix scale", () => {
    expect(currentFontPt({ textMatrix: [0, 0, 0, 0, 5, 5], fontSize: 14 })).toBeCloseTo(14);
    expect(currentFontPt({ fontSize: 11 })).toBeCloseTo(11);
  });

  it("defaults to 12 when nothing is known", () => {
    expect(currentFontPt({})).toBe(12);
  });
});

describe("scaleFactorForResize", () => {
  it("returns k>1 when dragging the handle down (bigger font)", () => {
    // orig 20pt, drag +20pt at zoom 1 → 40pt → k=2.
    expect(scaleFactorForResize(20, 20, 1)).toBeCloseTo(2);
  });

  it("returns k<1 when dragging up (smaller font)", () => {
    expect(scaleFactorForResize(20, -10, 1)).toBeCloseTo(0.5);
  });

  it("divides the screen delta by zoom", () => {
    // orig 20pt, +40px at zoom 2 → +20pt → 40pt → k=2.
    expect(scaleFactorForResize(20, 40, 2)).toBeCloseTo(2);
  });

  it("clamps the resulting font size to the [2,400]pt range", () => {
    // drag far up: 20 - 100 = -80 → clamp 2 → k=0.1.
    expect(scaleFactorForResize(20, -100, 1)).toBeCloseTo(2 / 20);
    // drag far down past 400.
    expect(scaleFactorForResize(20, 1000, 1)).toBeCloseTo(400 / 20);
  });

  it("is a no-op (k=1) for a zero delta", () => {
    expect(scaleFactorForResize(20, 0, 1)).toBeCloseTo(1);
  });
});

describe("scaleTextElement", () => {
  it("scales textMatrix a,b,c,d but preserves translation e,f", () => {
    const el: ResizableText = { textMatrix: [18, 0, 0, 18, 100, 200] };
    scaleTextElement(el, 2);
    expect(el.textMatrix).toEqual([36, 0, 0, 36, 100, 200]);
  });

  it("scales fontSize, fontMatrixSize and width when present", () => {
    const el: ResizableText = {
      textMatrix: [10, 0, 0, 10, 0, 0],
      fontSize: 10,
      fontMatrixSize: 10,
      width: 50,
    };
    scaleTextElement(el, 1.5);
    expect(el.fontSize).toBeCloseTo(15);
    expect(el.fontMatrixSize).toBeCloseTo(15);
    expect(el.width).toBeCloseTo(75);
  });

  it("leaves optional fields untouched when absent", () => {
    const el: ResizableText = { textMatrix: [10, 0, 0, 10, 1, 2] };
    scaleTextElement(el, 3);
    expect(el.fontSize).toBeUndefined();
    expect(el.fontMatrixSize).toBeUndefined();
    expect(el.width).toBeUndefined();
  });

  it("preserves rotation/shear direction while scaling magnitude", () => {
    // 90° rotated 20pt → scale ×0.5 → 10pt, same orientation.
    const el: ResizableText = { textMatrix: [0, 20, -20, 0, 5, 5] };
    scaleTextElement(el, 0.5);
    expect(el.textMatrix).toEqual([0, 10, -10, 0, 5, 5]);
    expect(currentFontPt(el)).toBeCloseTo(10);
  });

  it("ignores invalid factors (NaN, <=0, Infinity)", () => {
    const el: ResizableText = { textMatrix: [10, 0, 0, 10, 0, 0], fontSize: 10 };
    scaleTextElement(el, NaN);
    scaleTextElement(el, 0);
    scaleTextElement(el, -2);
    scaleTextElement(el, Infinity);
    expect(el.textMatrix).toEqual([10, 0, 0, 10, 0, 0]);
    expect(el.fontSize).toBe(10);
  });

  it("round-trips: scale by k then 1/k restores the original within float epsilon", () => {
    const el: ResizableText = { textMatrix: [12, 0, 0, 12, 30, 40], fontSize: 12, width: 60 };
    scaleTextElement(el, 1.7);
    scaleTextElement(el, 1 / 1.7);
    expect(el.textMatrix![0]).toBeCloseTo(12);
    expect(el.fontSize).toBeCloseTo(12);
    expect(el.width).toBeCloseTo(60);
    expect(el.textMatrix![4]).toBe(30);
    expect(el.textMatrix![5]).toBe(40);
  });
});

describe("imageBoxPt", () => {
  it("maps a lower-left transform to a top-left box on the page", () => {
    // 80x60 image at lower-left (120,500) on an 800pt-tall page.
    const box = imageBoxPt([80, 0, 0, 60, 120, 500], 800);
    expect(box).toEqual({ leftPt: 120, topPt: 800 - (500 + 60), wPt: 80, hPt: 60 });
  });

  it("uses absolute width/height for flipped (negative-scale) images", () => {
    const box = imageBoxPt([80, 0, 0, -60, 120, 500], 800);
    expect(box!.wPt).toBe(80);
    expect(box!.hPt).toBe(60);
  });

  it("returns null for a malformed transform", () => {
    expect(imageBoxPt(undefined, 800)).toBeNull();
    expect(imageBoxPt([1, 2, 3], 800)).toBeNull();
  });
});

describe("moveImageTransform", () => {
  it("shifts e by +dx and f by -dy (screen-down lowers the origin), preserving scale", () => {
    const t = moveImageTransform([80, 0, 0, 60, 120, 500], 30, 25);
    expect(t).toEqual([80, 0, 0, 60, 150, 475]);
  });

  it("does not mutate the input array", () => {
    const orig = [80, 0, 0, 60, 120, 500];
    moveImageTransform(orig, 10, 10);
    expect(orig).toEqual([80, 0, 0, 60, 120, 500]);
  });
});

describe("resizeImageTransformSE", () => {
  it("grows width and height from the SE handle, keeping the top edge fixed", () => {
    // top edge = f + h = 500 + 60 = 560. Grow +20 wide, +30 tall.
    const t = resizeImageTransformSE([80, 0, 0, 60, 120, 500], 20, 30);
    expect(t[0]).toBeCloseTo(100); // width 80→100
    expect(t[3]).toBeCloseTo(90); // height 60→90
    expect(t[4]).toBe(120); // x origin unchanged
    expect(t[5] + Math.abs(t[3])).toBeCloseTo(560); // top edge preserved
    expect(t[5]).toBeCloseTo(470); // f = 560 - 90
  });

  it("clamps width/height to MIN_IMAGE_PT when shrinking past zero", () => {
    const t = resizeImageTransformSE([80, 0, 0, 60, 120, 500], -1000, -1000);
    expect(t[0]).toBeCloseTo(MIN_IMAGE_PT);
    expect(t[3]).toBeCloseTo(MIN_IMAGE_PT);
  });

  it("preserves the sign of a flipped image's scale", () => {
    const t = resizeImageTransformSE([80, 0, 0, -60, 120, 500], 20, 30);
    expect(t[0]).toBeCloseTo(100);
    expect(t[3]).toBeCloseTo(-90); // stays negative (flipped)
  });

  it("does not mutate the input array", () => {
    const orig = [80, 0, 0, 60, 120, 500];
    resizeImageTransformSE(orig, 10, 10);
    expect(orig).toEqual([80, 0, 0, 60, 120, 500]);
  });
});
