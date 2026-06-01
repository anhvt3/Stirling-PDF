import React, { useCallback, useEffect, useRef, useState } from "react";
import { useViewer } from "@app/contexts/ViewerContext";
import {
  currentFontPt,
  imageBoxPt,
  moveImageTransform,
  resizeImageTransformSE,
  scaleFactorForResize,
  scaleTextElement,
} from "./editObjectsMath";

// ─── Types ──────────────────────────────────────────────────────────────────
// Minimal shape of the text-editor JSON we need. The full document is kept
// opaque (rawDoc) and POSTed back unchanged except for the elements we edit.

interface TextColor {
  // PdfJsonTextColor — components in 0..1 plus a space; we only edit rgb here.
  r?: number;
  g?: number;
  b?: number;
  components?: number[];
  colorSpace?: string;
}

interface TextElement {
  text?: string;
  textMatrix?: number[]; // [a,b,c,d,e,f] — e,f translation in PDF pts (bottom-left origin)
  fontSize?: number;
  fontMatrixSize?: number; // backend's preferred glyph-size source (resolveFontMatrixSize)
  width?: number;
  height?: number;
  fillColor?: TextColor;
}

interface ImageElement {
  // PdfJsonImageElement — placement CTM [a,b,c,d,e,f] in PDF pts, lower-left origin.
  transform?: number[];
  width?: number;
  height?: number;
}

interface PageModel {
  textElements?: TextElement[];
  imageElements?: ImageElement[];
}

interface PdfJsonDoc {
  pages?: PageModel[];
  [k: string]: unknown;
}

interface EditObjectsOverlayProps {
  containerRef: React.RefObject<HTMLElement | null>;
  isActive: boolean;
  /** The current PDF File, used to fetch the editable JSON when the tool activates. */
  currentFile: File | null;
  /** Commit the edited JSON: returns the regenerated PDF blob to reload into the viewer. */
  onApply: (editedDocJson: string) => Promise<void>;
}

function hexToRgb01(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

function rgb01ToHex(c?: TextColor): string {
  if (!c) return "#000000";
  const comps = c.components ?? [c.r ?? 0, c.g ?? 0, c.b ?? 0];
  const [r, g, b] = comps;
  const to = (v: number) =>
    Math.max(0, Math.min(255, Math.round((v ?? 0) * 255)))
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

export const EditObjectsOverlay = ({
  containerRef,
  isActive,
  currentFile,
  onApply,
}: EditObjectsOverlayProps): React.ReactElement | null => {
  const viewer = useViewer();
  const { registerImmediateZoomUpdate } = viewer;

  const [zoom, setZoom] = useState<number>(() => {
    try {
      return ((viewer.getZoomState() as any)?.zoomPercent ?? 100) / 100;
    } catch {
      return 1;
    }
  });
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  const [doc, setDoc] = useState<PdfJsonDoc | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Selected element key "pageIndex:elementIndex".
  const [selected, setSelected] = useState<string | null>(null);
  const [, setScrollVersion] = useState(0);

  const dragRef = useRef<{
    key: string;
    startClientX: number;
    startClientY: number;
    origE: number;
    origF: number;
  } | null>(null);

  const resizeRef = useRef<{
    key: string;
    startClientX: number;
    startClientY: number;
    origFontPt: number;
    // Snapshot of the original element values so each mousemove rescales from
    // the start (no drift / compounding).
    origMatrix: number[];
    origFontSize?: number;
    origFontMatrixSize?: number;
    origWidth?: number;
  } | null>(null);

  // Image move / SE-resize drags. Keys are "img:pageIndex:imageIndex".
  const imgDragRef = useRef<{
    key: string;
    startClientX: number;
    startClientY: number;
    origTransform: number[];
  } | null>(null);

  const imgResizeRef = useRef<{
    key: string;
    startClientX: number;
    startClientY: number;
    origTransform: number[];
  } | null>(null);

  // ── zoom + scroll re-render ────────────────────────────────────────────────
  useEffect(() => {
    return registerImmediateZoomUpdate((pct) => {
      const z = pct / 100;
      zoomRef.current = z;
      setZoom(z);
      requestAnimationFrame(() => setScrollVersion((n) => n + 1));
    });
  }, [registerImmediateZoomUpdate]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const scrollEl =
      (container.querySelector("[data-viewer-scroll]") as HTMLElement | null) ??
      container;
    const handler = () => setScrollVersion((n) => n + 1);
    scrollEl.addEventListener("scroll", handler, { passive: true });
    return () => scrollEl.removeEventListener("scroll", handler);
  }, [containerRef]);

  // ── Fetch the editable JSON when the tool activates ────────────────────────
  useEffect(() => {
    if (!isActive) {
      setDoc(null);
      setSelected(null);
      setDirty(false);
      setError(null);
      return;
    }
    if (!currentFile) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const fd = new FormData();
        fd.append("fileInput", currentFile);
        // Force inline images so the doc carries editable imageElements (transform + data) and
        // images survive the forceRegenerate Apply. Without this the lazy-image path returns
        // imageElements:[] and every image is dropped on export.
        fd.append("inlineImages", "true");
        const res = await fetch("/api/v1/convert/pdf/text-editor", {
          method: "POST",
          body: fd,
        });
        if (!res.ok) {
          // Surface the backend's message (e.g. the "too large to edit images" guard) instead of
          // a bare status code.
          let msg = `Couldn't load this PDF for editing (HTTP ${res.status}).`;
          try {
            const parsed = JSON.parse(await res.text());
            if (parsed?.message) msg = String(parsed.message);
          } catch {
            /* non-JSON body — keep the default message */
          }
          throw new Error(msg);
        }
        const json = (await res.json()) as PdfJsonDoc;
        if (!cancelled) setDoc(json);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isActive, currentFile]);

  // ── Element → screen box ───────────────────────────────────────────────────
  const elementBox = useCallback(
    (
      pageIndex: number,
      el: TextElement,
    ): { left: number; top: number; width: number; height: number } | null => {
      const container = containerRef.current;
      if (!container) return null;
      const pageEl = container.querySelector(
        `[data-page-index="${pageIndex}"]`,
      ) as HTMLElement | null;
      if (!pageEl) return null;
      const pr = pageEl.getBoundingClientRect();
      const cr = container.getBoundingClientRect();
      const z = zoom;
      const pageHeightPt = pr.height / z;
      const m = el.textMatrix;
      const e = m ? m[4] : 0;
      const f = m ? m[5] : 0;
      const fontPt = (m ? Math.abs(m[0]) : el.fontSize) || el.fontSize || 12;
      const wPt = el.width ?? (el.text?.length ?? 1) * fontPt * 0.5;
      // f is the baseline (bottom-left origin). Box top = baseline - cap height.
      const leftPt = e;
      const topPt = pageHeightPt - f - fontPt;
      return {
        left: pr.left - cr.left + leftPt * z,
        top: pr.top - cr.top + topPt * z,
        width: Math.max(8, wPt * z),
        height: Math.max(10, fontPt * z * 1.25),
      };
    },
    [containerRef, zoom],
  );

  // ── Image → screen box ─────────────────────────────────────────────────────
  const imageScreenBox = useCallback(
    (
      pageIndex: number,
      img: ImageElement,
    ): { left: number; top: number; width: number; height: number } | null => {
      const container = containerRef.current;
      if (!container) return null;
      const pageEl = container.querySelector(
        `[data-page-index="${pageIndex}"]`,
      ) as HTMLElement | null;
      if (!pageEl) return null;
      const pr = pageEl.getBoundingClientRect();
      const cr = container.getBoundingClientRect();
      const z = zoom;
      const pageHeightPt = pr.height / z;
      const box = imageBoxPt(img.transform, pageHeightPt);
      if (!box) return null;
      return {
        left: pr.left - cr.left + box.leftPt * z,
        top: pr.top - cr.top + box.topPt * z,
        width: Math.max(8, box.wPt * z),
        height: Math.max(8, box.hPt * z),
      };
    },
    [containerRef, zoom],
  );

  // ── Drag to move ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isActive) return;
    const onMove = (ev: MouseEvent) => {
      if (!doc) return;
      const z = zoomRef.current || 1;

      const ir = imgResizeRef.current;
      if (ir) {
        const [pi, ii] = ir.key.slice(4).split(":").map(Number);
        const img = doc.pages?.[pi]?.imageElements?.[ii];
        if (img) {
          const dW = (ev.clientX - ir.startClientX) / z;
          const dH = (ev.clientY - ir.startClientY) / z; // down = taller
          img.transform = resizeImageTransformSE(ir.origTransform, dW, dH);
          setScrollVersion((n) => n + 1);
        }
        return;
      }

      const idr = imgDragRef.current;
      if (idr) {
        const [pi, ii] = idr.key.slice(4).split(":").map(Number);
        const img = doc.pages?.[pi]?.imageElements?.[ii];
        if (img) {
          const dxPt = (ev.clientX - idr.startClientX) / z;
          const dyPt = (ev.clientY - idr.startClientY) / z;
          img.transform = moveImageTransform(idr.origTransform, dxPt, dyPt);
          setScrollVersion((n) => n + 1);
        }
        return;
      }

      const r = resizeRef.current;
      if (r) {
        const [pi, ei] = r.key.split(":").map(Number);
        const el = doc.pages?.[pi]?.textElements?.[ei];
        if (el) {
          // SE (diagonal) handle: combine horizontal + vertical drag so a down-right drag always
          // grows and up-left shrinks (pure-vertical previously made right-drags do nothing and
          // could shrink on a slightly-upward down-right drag).
          const diagDelta =
            ((ev.clientX - r.startClientX) + (ev.clientY - r.startClientY)) / 2;
          const k = scaleFactorForResize(r.origFontPt, diagDelta, z);
          // Restore originals, then apply the absolute scale (no compounding).
          el.textMatrix = r.origMatrix.slice();
          el.fontSize = r.origFontSize;
          el.fontMatrixSize = r.origFontMatrixSize;
          el.width = r.origWidth;
          scaleTextElement(el, k);
          setScrollVersion((n) => n + 1);
        }
        return;
      }

      const d = dragRef.current;
      if (!d) return;
      const dxPt = (ev.clientX - d.startClientX) / z;
      const dyPt = (ev.clientY - d.startClientY) / z;
      const [pi, ei] = d.key.split(":").map(Number);
      const el = doc.pages?.[pi]?.textElements?.[ei];
      if (el?.textMatrix) {
        el.textMatrix[4] = d.origE + dxPt;
        el.textMatrix[5] = d.origF - dyPt; // screen down = PDF y down (bottom-left)
        setScrollVersion((n) => n + 1);
      }
    };
    const onUp = () => {
      if (
        dragRef.current ||
        resizeRef.current ||
        imgDragRef.current ||
        imgResizeRef.current
      ) {
        dragRef.current = null;
        resizeRef.current = null;
        imgDragRef.current = null;
        imgResizeRef.current = null;
        setDirty(true);
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isActive, doc]);

  const startDrag = (key: string, el: TextElement, ev: React.MouseEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    setSelected(key);
    if (!el.textMatrix) return;
    dragRef.current = {
      key,
      startClientX: ev.clientX,
      startClientY: ev.clientY,
      origE: el.textMatrix[4],
      origF: el.textMatrix[5],
    };
  };

  const startResize = (key: string, el: TextElement, ev: React.MouseEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    setSelected(key);
    if (!el.textMatrix) return;
    resizeRef.current = {
      key,
      startClientX: ev.clientX,
      startClientY: ev.clientY,
      origFontPt: currentFontPt(el),
      origMatrix: el.textMatrix.slice(),
      origFontSize: el.fontSize,
      origFontMatrixSize: el.fontMatrixSize,
      origWidth: el.width,
    };
  };

  const startImgDrag = (key: string, img: ImageElement, ev: React.MouseEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    setSelected(key);
    if (!img.transform || img.transform.length < 6) return;
    imgDragRef.current = {
      key,
      startClientX: ev.clientX,
      startClientY: ev.clientY,
      origTransform: img.transform.slice(),
    };
  };

  const startImgResize = (key: string, img: ImageElement, ev: React.MouseEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    setSelected(key);
    if (!img.transform || img.transform.length < 6) return;
    imgResizeRef.current = {
      key,
      startClientX: ev.clientX,
      startClientY: ev.clientY,
      origTransform: img.transform.slice(),
    };
  };

  const recolorSelected = (hex: string) => {
    if (!selected || !doc) return;
    const [pi, ei] = selected.split(":").map(Number);
    const el = doc.pages?.[pi]?.textElements?.[ei];
    if (!el) return;
    const [r, g, b] = hexToRgb01(hex);
    el.fillColor = { ...(el.fillColor ?? {}), components: [r, g, b], colorSpace: "DeviceRGB" };
    setDirty(true);
    setScrollVersion((n) => n + 1);
  };

  const handleApply = useCallback(async () => {
    if (!doc) return;
    setApplying(true);
    setError(null);
    try {
      await onApply(JSON.stringify(doc));
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  }, [doc, onApply]);

  if (!isActive) return null;

  const selectedEl = (() => {
    if (!selected || !doc || selected.startsWith("img:")) return null;
    const [pi, ei] = selected.split(":").map(Number);
    return doc.pages?.[pi]?.textElements?.[ei] ?? null;
  })();

  const selectedImg = (() => {
    if (!selected || !doc || !selected.startsWith("img:")) return null;
    const [pi, ii] = selected.slice(4).split(":").map(Number);
    return doc.pages?.[pi]?.imageElements?.[ii] ?? null;
  })();

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 130 }}>
      {/* Toolbar */}
      <div
        data-editobjects-ui="true"
        style={{
          position: "absolute",
          top: 8,
          left: 8,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "6px 10px",
          borderRadius: 8,
          background: "white",
          boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
          pointerEvents: "auto",
          fontFamily: "sans-serif",
          fontSize: 13,
        }}
      >
        <strong style={{ color: "#1e88e5" }}>Edit Objects</strong>
        {loading && <span>Loading text…</span>}
        {!loading && doc && (
          <span>Drag to move · corner handle to resize · text: select to recolor</span>
        )}
        {selectedEl && (
          <span data-testid="editobjects-size" style={{ color: "#475569" }}>
            {currentFontPt(selectedEl).toFixed(1)} pt
          </span>
        )}
        {selectedImg && selectedImg.transform && (
          <span data-testid="editobjects-img-size" style={{ color: "#2e7d32" }}>
            image {Math.abs(selectedImg.transform[0]).toFixed(0)}×
            {Math.abs(selectedImg.transform[3]).toFixed(0)} pt
          </span>
        )}
        {selectedEl && (
          <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
            Color
            <input
              data-testid="editobjects-color"
              type="color"
              value={rgb01ToHex(selectedEl.fillColor)}
              onChange={(e) => recolorSelected(e.target.value)}
            />
          </label>
        )}
        <button
          type="button"
          data-testid="editobjects-apply"
          onClick={() => void handleApply()}
          disabled={!dirty || applying || !doc}
          style={{
            padding: "5px 12px",
            borderRadius: 5,
            border: "none",
            background: dirty && !applying ? "#1e88e5" : "#94a3b8",
            color: "white",
            fontWeight: 600,
            cursor: dirty && !applying ? "pointer" : "default",
          }}
        >
          {applying ? "Applying…" : "Apply changes"}
        </button>
        {error && <span style={{ color: "#c62828" }}>{error}</span>}
      </div>

      {/* Draggable text-element boxes */}
      {doc?.pages?.map((pg, pi) =>
        (pg.textElements ?? []).map((el, ei) => {
          if (!(el.text || "").trim()) return null;
          const box = elementBox(pi, el);
          if (!box) return null;
          const key = `${pi}:${ei}`;
          const isSel = selected === key;
          return (
            <div
              key={key}
              data-editobjects-ui="true"
              data-testid={`editobjects-el-${key}`}
              onMouseDown={(ev) => startDrag(key, el, ev)}
              title={el.text}
              style={{
                position: "absolute",
                left: box.left,
                top: box.top,
                width: box.width,
                height: box.height,
                border: isSel ? "2px solid #1e88e5" : "1px dashed rgba(30,136,229,0.5)",
                background: isSel ? "rgba(30,136,229,0.12)" : "rgba(30,136,229,0.04)",
                cursor: "move",
                pointerEvents: "auto",
                boxSizing: "border-box",
              }}
            >
              {isSel && (
                <div
                  data-editobjects-ui="true"
                  data-testid={`editobjects-resize-${key}`}
                  onMouseDown={(ev) => startResize(key, el, ev)}
                  title="Drag to resize font"
                  style={{
                    position: "absolute",
                    right: -5,
                    bottom: -5,
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    background: "#1e88e5",
                    border: "1px solid white",
                    cursor: "nwse-resize",
                    pointerEvents: "auto",
                    boxSizing: "border-box",
                  }}
                />
              )}
            </div>
          );
        }),
      )}

      {/* Draggable / resizable image-element boxes */}
      {doc?.pages?.map((pg, pi) =>
        (pg.imageElements ?? []).map((img, ii) => {
          const box = imageScreenBox(pi, img);
          if (!box) return null;
          const key = `img:${pi}:${ii}`;
          const isSel = selected === key;
          return (
            <div
              key={key}
              data-editobjects-ui="true"
              data-testid={`editobjects-img-${pi}:${ii}`}
              onMouseDown={(ev) => startImgDrag(key, img, ev)}
              title="Drag to move image · corner handle to resize"
              style={{
                position: "absolute",
                left: box.left,
                top: box.top,
                width: box.width,
                height: box.height,
                border: isSel ? "2px solid #2e7d32" : "1px dashed rgba(46,125,50,0.6)",
                background: isSel ? "rgba(46,125,50,0.10)" : "rgba(46,125,50,0.03)",
                cursor: "move",
                pointerEvents: "auto",
                boxSizing: "border-box",
              }}
            >
              {isSel && (
                <div
                  data-editobjects-ui="true"
                  data-testid={`editobjects-img-resize-${pi}:${ii}`}
                  onMouseDown={(ev) => startImgResize(key, img, ev)}
                  title="Drag to resize image"
                  style={{
                    position: "absolute",
                    right: -5,
                    bottom: -5,
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    background: "#2e7d32",
                    border: "1px solid white",
                    cursor: "nwse-resize",
                    pointerEvents: "auto",
                    boxSizing: "border-box",
                  }}
                />
              )}
            </div>
          );
        }),
      )}
    </div>
  );
};

EditObjectsOverlay.displayName = "EditObjectsOverlay";
