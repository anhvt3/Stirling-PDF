// Pure geometry helpers for the Edit Objects resize handles.
//
// Rendered glyph size model (must match backend PdfJsonConversionService):
//   applyTextMatrix() divides textMatrix a,b,c,d by fontScale, then
//   setFont(font, fontScale) is called — so the net on-page glyph size equals
//   the textMatrix's intrinsic scale; the fontScale cancels out. Therefore a
//   resize only needs to scale a,b,c,d. We also scale fontSize/fontMatrixSize/
//   width so the emitted JSON stays internally consistent.

export interface ResizableText {
  textMatrix?: number[]; // [a,b,c,d,e,f] — e,f are translation (position), preserved on resize
  fontSize?: number;
  fontMatrixSize?: number;
  width?: number;
}

/** Min / max rendered font size (PDF points) a resize is allowed to reach. */
export const MIN_FONT_PT = 2;
export const MAX_FONT_PT = 400;

/**
 * Current rendered font size in PDF points. Uses the textMatrix vertical scale
 * `hypot(b,d)` (matching the backend's resolveFontMatrixSize), then horizontal
 * scale, then the explicit fontSize, then a 12pt default.
 */
export function currentFontPt(el: ResizableText): number {
  const m = el.textMatrix;
  if (m && m.length >= 4) {
    const vertical = Math.hypot(m[1], m[3]);
    if (vertical > 0) return vertical;
    const horizontal = Math.hypot(m[0], m[2]);
    if (horizontal > 0) return horizontal;
  }
  return el.fontSize ?? 12;
}

/**
 * Scale factor for a resize drag. `deltaScreenY` is the vertical pixel movement
 * of the handle (down = positive = bigger); it is converted to PDF points via
 * the zoom and added to the original size, clamped to [MIN_FONT_PT, MAX_FONT_PT].
 * Returns newFontPt / origFontPt.
 */
export function scaleFactorForResize(
  origFontPt: number,
  deltaScreenY: number,
  zoom: number,
): number {
  if (!(origFontPt > 0)) return 1;
  const z = zoom > 0 ? zoom : 1;
  const target = origFontPt + deltaScreenY / z;
  const clamped = Math.max(MIN_FONT_PT, Math.min(MAX_FONT_PT, target));
  return clamped / origFontPt;
}

/**
 * Scale a text element's glyph size by factor k (k>0, finite), mutating in place.
 * Scales textMatrix a,b,c,d (NOT translation e,f) plus fontSize/fontMatrixSize/
 * width when present. Invalid factors are ignored.
 */
export function scaleTextElement(el: ResizableText, k: number): void {
  if (!(k > 0) || !Number.isFinite(k)) return;
  const m = el.textMatrix;
  if (m && m.length >= 6) {
    m[0] *= k;
    m[1] *= k;
    m[2] *= k;
    m[3] *= k;
    // m[4], m[5] (e,f translation) preserved — position is unchanged by a resize.
  }
  if (typeof el.fontSize === "number") el.fontSize *= k;
  if (typeof el.fontMatrixSize === "number") el.fontMatrixSize *= k;
  if (typeof el.width === "number") el.width *= k;
}

// ─── Image objects (sub-task C) ──────────────────────────────────────────────
// An image element carries a placement CTM `transform` = [a,b,c,d,e,f] in PDF points with a
// LOWER-LEFT origin: a/d are the displayed width/height, e/f the lower-left corner. The backend
// re-emits the image from this transform under forceRegenerate, so editing it moves/resizes the
// image. The overlay works in a top-left screen space, so these helpers convert and edit.

/** Minimum image edge (PDF points) a resize is allowed to reach. */
export const MIN_IMAGE_PT = 4;

export interface PlacedImageBox {
  leftPt: number; // top-left origin, PDF points relative to page
  topPt: number;
  wPt: number;
  hPt: number;
}

/**
 * Top-left-origin PDF-point box for an image placement transform on a page of the given height.
 * Returns null for a malformed transform.
 */
export function imageBoxPt(
  transform: number[] | undefined,
  pageHeightPt: number,
): PlacedImageBox | null {
  if (!transform || transform.length < 6) return null;
  const wPt = Math.abs(transform[0]);
  const hPt = Math.abs(transform[3]);
  const leftPt = transform[4];
  // f is the lower-left y; the top edge sits at f + height, flipped into top-left space.
  const topPt = pageHeightPt - (transform[5] + hPt);
  return { leftPt, topPt, wPt, hPt };
}

/**
 * Move an image by a screen delta expressed in PDF points (dx right-positive, dy down-positive).
 * Returns a new transform; the original is not mutated. Scale (a,b,c,d) is preserved.
 */
export function moveImageTransform(
  transform: number[],
  dxPt: number,
  dyPt: number,
): number[] {
  const t = transform.slice();
  t[4] = t[4] + dxPt;
  t[5] = t[5] - dyPt; // screen-down lowers the lower-left origin
  return t;
}

/**
 * Resize from the south-east (bottom-right) handle, keeping the visual top-left corner fixed.
 * dWidthPt / dHeightPt are PDF-point deltas (right / down positive). Width=a and height=d grow;
 * the lower-left f is recomputed so the top edge stays put. Sign of a/d (flipped images) preserved.
 */
export function resizeImageTransformSE(
  transform: number[],
  dWidthPt: number,
  dHeightPt: number,
): number[] {
  const t = transform.slice();
  const a = t[0];
  const d = t[3];
  const topEdge = t[5] + Math.abs(d); // lower-left f + height = top edge (fixed)
  const newW = Math.max(MIN_IMAGE_PT, Math.abs(a) + dWidthPt);
  const newH = Math.max(MIN_IMAGE_PT, Math.abs(d) + dHeightPt);
  t[0] = a < 0 ? -newW : newW;
  t[3] = d < 0 ? -newH : newH;
  t[5] = topEdge - newH; // keep the top edge fixed → box grows downward
  return t;
}
