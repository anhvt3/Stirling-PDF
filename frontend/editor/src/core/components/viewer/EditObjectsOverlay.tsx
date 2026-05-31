import React, { useCallback, useEffect, useRef, useState } from "react";
import { useViewer } from "@app/contexts/ViewerContext";

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
  width?: number;
  height?: number;
  fillColor?: TextColor;
}

interface PageModel {
  textElements?: TextElement[];
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
        const res = await fetch("/api/v1/convert/pdf/text-editor", {
          method: "POST",
          body: fd,
        });
        if (!res.ok) throw new Error(`PDF→JSON failed (${res.status})`);
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

  // ── Drag to move ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isActive) return;
    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d || !doc) return;
      const z = zoomRef.current || 1;
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
      if (dragRef.current) {
        dragRef.current = null;
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
    if (!selected || !doc) return null;
    const [pi, ei] = selected.split(":").map(Number);
    return doc.pages?.[pi]?.textElements?.[ei] ?? null;
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
        {!loading && doc && <span>Drag text to move · select to recolor</span>}
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
            />
          );
        }),
      )}
    </div>
  );
};

EditObjectsOverlay.displayName = "EditObjectsOverlay";
