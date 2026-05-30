import React, { useCallback, useEffect, useRef, useState } from "react";
import { useViewer } from "@app/contexts/ViewerContext";

// ─── Types ──────────────────────────────────────────────────────────────────

export type FormFieldType = "text" | "checkbox";

/**
 * A new form field definition in BACKEND coordinates: x/y are the lower-left
 * corner in PDF points (PDF native, bottom-left origin), matching
 * FormUtils.NewFormFieldDefinition. pageIndex is 0-based.
 */
export interface NewFieldSpec {
  name: string;
  type: FormFieldType;
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

interface FormDesignerOverlayProps {
  containerRef: React.RefObject<HTMLElement | null>;
  isActive: boolean;
  /** Called when the user confirms a new field. Returns a promise so we can show progress. */
  onCreateField: (spec: NewFieldSpec) => Promise<void>;
}

// A finalized rectangle awaiting name/type confirmation, in PDF-point page space
// (top-left origin) plus the page it belongs to and its height for the Y-flip.
interface PendingRect {
  pageIndex: number;
  xPt: number; // left, PDF points, top-left origin
  yTopPt: number; // top, PDF points, top-left origin
  wPt: number;
  hPt: number;
  pageHeightPt: number;
}

export const FormDesignerOverlay = ({
  containerRef,
  isActive,
  onCreateField,
}: FormDesignerOverlayProps): React.ReactElement | null => {
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

  // Drag state (screen px relative to container).
  const dragStartRef = useRef<Point | null>(null);
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [dragCur, setDragCur] = useState<Point | null>(null);

  const [pending, setPending] = useState<PendingRect | null>(null);
  const [fieldName, setFieldName] = useState("");
  const [fieldType, setFieldType] = useState<FormFieldType>("text");
  const [busy, setBusy] = useState(false);

  const [, setScrollVersion] = useState(0);

  // ── Zoom + scroll re-render tracking (mirrors RulerOverlay) ────────────────
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

  // ── Reset when deactivated ─────────────────────────────────────────────────
  useEffect(() => {
    if (!isActive) {
      dragStartRef.current = null;
      setDragStart(null);
      setDragCur(null);
      setPending(null);
      setFieldName("");
    }
  }, [isActive]);

  // ── Coordinate helpers ─────────────────────────────────────────────────────
  /** Screen px relative to the container. */
  const toScreenPt = useCallback(
    (e: MouseEvent, container: HTMLElement): Point => {
      const r = container.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    },
    [],
  );

  /** Find the page element under a client point + its rect. */
  const pageElAt = useCallback(
    (clientX: number, clientY: number, container: HTMLElement) => {
      const pages = container.querySelectorAll("[data-page-index]");
      for (const el of Array.from(pages)) {
        const r = el.getBoundingClientRect();
        if (
          clientX >= r.left &&
          clientX <= r.right &&
          clientY >= r.top &&
          clientY <= r.bottom
        ) {
          const idxAttr = el.getAttribute("data-page-index");
          if (idxAttr == null) continue;
          return { el: el as HTMLElement, rect: r, pageIndex: Number(idxAttr) };
        }
      }
      return null;
    },
    [],
  );

  // ── Mouse drag to draw a rectangle ─────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!isActive || !container) return;

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if ((e.target as Element).closest?.("[data-formdesigner-ui]")) return;
      const hit = pageElAt(e.clientX, e.clientY, container);
      if (!hit) return; // only start a drag that begins on a page
      e.preventDefault();
      const sp = toScreenPt(e, container);
      dragStartRef.current = sp;
      setDragStart(sp);
      setDragCur(sp);
      setPending(null);
    };

    const onMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;
      setDragCur(toScreenPt(e, container));
    };

    const onUp = (e: MouseEvent) => {
      const start = dragStartRef.current;
      dragStartRef.current = null;
      if (!start) return;
      const end = toScreenPt(e, container);
      const wPx = Math.abs(end.x - start.x);
      const hPx = Math.abs(end.y - start.y);
      setDragStart(null);
      setDragCur(null);
      if (wPx < 6 || hPx < 6) return; // ignore tiny drags / clicks

      // Resolve the page from the drag-start client point.
      const startClientX =
        start.x + container.getBoundingClientRect().left;
      const startClientY =
        start.y + container.getBoundingClientRect().top;
      const hit = pageElAt(startClientX, startClientY, container);
      if (!hit) return;

      const z = zoomRef.current || 1;
      const leftClient = Math.min(
        start.x,
        end.x,
      ) + container.getBoundingClientRect().left;
      const topClient =
        Math.min(start.y, end.y) + container.getBoundingClientRect().top;
      // Page-relative PDF points (top-left origin).
      const xPt = (leftClient - hit.rect.left) / z;
      const yTopPt = (topClient - hit.rect.top) / z;
      const wPt = wPx / z;
      const hPt = hPx / z;
      const pageHeightPt = hit.rect.height / z;

      setPending({
        pageIndex: hit.pageIndex,
        xPt,
        yTopPt,
        wPt,
        hPt,
        pageHeightPt,
      });
      setFieldName("");
      setFieldType("text");
    };

    container.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    container.style.cursor = "crosshair";
    return () => {
      container.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      container.style.cursor = "";
    };
  }, [isActive, containerRef, pageElAt, toScreenPt]);

  const handleSubmit = useCallback(async () => {
    if (!pending) return;
    const name = fieldName.trim();
    if (!name) return;
    setBusy(true);
    try {
      // Flip top-left origin → PDF lower-left origin for the backend.
      const yLowerLeft = pending.pageHeightPt - (pending.yTopPt + pending.hPt);
      await onCreateField({
        name,
        type: fieldType,
        pageIndex: pending.pageIndex,
        x: pending.xPt,
        y: yLowerLeft,
        width: pending.wPt,
        height: pending.hPt,
      });
      setPending(null);
      setFieldName("");
    } finally {
      setBusy(false);
    }
  }, [pending, fieldName, fieldType, onCreateField]);

  if (!isActive) return null;

  // Live drag rectangle (screen px relative to container).
  const liveRect =
    dragStart && dragCur
      ? {
          left: Math.min(dragStart.x, dragCur.x),
          top: Math.min(dragStart.y, dragCur.y),
          width: Math.abs(dragCur.x - dragStart.x),
          height: Math.abs(dragCur.y - dragStart.y),
        }
      : null;

  // Pending rect back-projected to screen for the popup anchor + outline.
  let pendingScreen: { left: number; top: number; width: number; height: number } | null =
    null;
  const container = containerRef.current;
  if (pending && container) {
    const pageEl = container.querySelector(
      `[data-page-index="${pending.pageIndex}"]`,
    ) as HTMLElement | null;
    if (pageEl) {
      const pr = pageEl.getBoundingClientRect();
      const cr = container.getBoundingClientRect();
      pendingScreen = {
        left: pr.left - cr.left + pending.xPt * zoom,
        top: pr.top - cr.top + pending.yTopPt * zoom,
        width: pending.wPt * zoom,
        height: pending.hPt * zoom,
      };
    }
  }

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 120,
      }}
    >
      {/* Hint */}
      <div
        data-formdesigner-ui="true"
        style={{
          position: "absolute",
          top: 8,
          left: 8,
          padding: "4px 10px",
          borderRadius: 6,
          background: "#1e88e5",
          color: "white",
          fontSize: 12,
          fontFamily: "sans-serif",
          fontWeight: 600,
          pointerEvents: "none",
        }}
      >
        Form Designer · drag a rectangle on the page to add a field
      </div>

      {/* Live drag rectangle */}
      {liveRect && (
        <div
          style={{
            position: "absolute",
            left: liveRect.left,
            top: liveRect.top,
            width: liveRect.width,
            height: liveRect.height,
            border: "2px dashed #1e88e5",
            background: "rgba(30,136,229,0.12)",
            pointerEvents: "none",
          }}
        />
      )}

      {/* Pending rectangle outline + popup */}
      {pendingScreen && (
        <>
          <div
            style={{
              position: "absolute",
              left: pendingScreen.left,
              top: pendingScreen.top,
              width: pendingScreen.width,
              height: pendingScreen.height,
              border: "2px solid #1e88e5",
              background: "rgba(30,136,229,0.16)",
              pointerEvents: "none",
            }}
          />
          <div
            data-formdesigner-ui="true"
            data-testid="formdesigner-popup"
            style={{
              position: "absolute",
              left: pendingScreen.left,
              top: pendingScreen.top + pendingScreen.height + 6,
              minWidth: 220,
              padding: 10,
              borderRadius: 8,
              background: "white",
              boxShadow: "0 2px 10px rgba(0,0,0,0.25)",
              pointerEvents: "auto",
              fontFamily: "sans-serif",
              fontSize: 13,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <input
              data-testid="formdesigner-name"
              autoFocus
              placeholder="Field name"
              value={fieldName}
              onChange={(e) => setFieldName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSubmit();
                if (e.key === "Escape") setPending(null);
              }}
              style={{
                padding: "6px 8px",
                border: "1px solid #cbd5e1",
                borderRadius: 5,
                fontSize: 13,
              }}
            />
            <select
              data-testid="formdesigner-type"
              value={fieldType}
              onChange={(e) => setFieldType(e.target.value as FormFieldType)}
              style={{
                padding: "6px 8px",
                border: "1px solid #cbd5e1",
                borderRadius: 5,
                fontSize: 13,
              }}
            >
              <option value="text">Text field</option>
              <option value="checkbox">Checkbox</option>
            </select>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setPending(null)}
                disabled={busy}
                style={{
                  padding: "6px 12px",
                  borderRadius: 5,
                  border: "1px solid #cbd5e1",
                  background: "white",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="formdesigner-add"
                onClick={() => void handleSubmit()}
                disabled={busy || !fieldName.trim()}
                style={{
                  padding: "6px 12px",
                  borderRadius: 5,
                  border: "none",
                  background: fieldName.trim() ? "#1e88e5" : "#94a3b8",
                  color: "white",
                  fontWeight: 600,
                  cursor: fieldName.trim() ? "pointer" : "default",
                }}
              >
                {busy ? "Adding…" : "Add field"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

FormDesignerOverlay.displayName = "FormDesignerOverlay";
