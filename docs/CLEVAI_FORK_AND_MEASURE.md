# Clevai Fork — Build Notes & Measure Tool

> Internal fork of Stirling-PDF for Clevai. This document records (1) how to build
> the **MIT-core** flavor (no proprietary/SaaS/AI-engine code, no paid license
> required) and (2) the **Measure tool** feature added on top (distance / perimeter
> / area), which fills a gap versus Foxit PhantomPDF.

## 1. Why this fork

Clevai needs a Foxit-PhantomPDF-class PDF editor. A feature comparison showed
Stirling-PDF (133 API tools as of v2.11) already covers ~90% of Foxit —
including text editing, certificate signing, document compare, convert-to-PDF,
compress, repair, OCR, redaction, forms, bookmarks, attachments. Rather than
build from scratch, we fork Stirling and add only the missing Foxit features.

### License boundary (IMPORTANT)

The repository is **open-core**, not pure MIT:

| Path | License | Production use |
|------|---------|----------------|
| `app/core`, `app/common`, `frontend/editor/src/core` | **MIT** | ✅ free, incl. commercial |
| `engine/` ("AI Document Engine") | Stirling PDF User License | ❌ paid subscription |
| `app/proprietary`, `app/saas`, `frontend/src/{proprietary,saas,desktop,prototypes}` | proprietary | ❌ paid |

**We build with `STIRLING_FLAVOR=core` only.** This excludes every non-MIT module,
so the resulting artifact is MIT-licensed and free for production use.

## 2. Build the MIT-core flavor

### Prerequisites
- **JDK 25** (Temurin) — `winget install EclipseAdoptium.Temurin.25.JDK`
- **Node 22+** and **go-task** — `winget install Task.Task`
- (Optional) Docker — only if you prefer container builds.

### Single-server build + run (frontend bundled into backend on :8080)
```bash
# from repo root, with JAVA_HOME pointing at JDK 25 and `task` on PATH
export STIRLING_FLAVOR=core
export DISABLE_ADDITIONAL_FEATURES=true   # belt-and-suspenders; core already implies this
export SECURITY_ENABLELOGIN=false
./gradlew clean bootRun -PbuildWithFrontend=true     # Windows: .\gradlew.bat ...
```
App serves on <http://localhost:8080>. Health: `GET /api/v1/info/status` → `{"status":"UP"}`.

### Frontend-only production build (type-check + bundle)
```bash
cd frontend && npx vite build editor --mode core
```

### Docker alternative
```bash
docker compose -f docker/compose/docker-compose.yml up --build   # DISABLE_ADDITIONAL_FEATURES=true
```

## 3. Measure tool (distance / perimeter / area)

Foxit has Measure tools; Stirling shipped only **distance** (the viewer "ruler").
This fork extends it to **perimeter** and **area**.

### Where
`frontend/editor/src/core/components/viewer/RulerOverlay.tsx` — the existing
ruler overlay mounted in `EmbedPdfViewer` and toggled by the viewer workbench-bar
ruler button (`useViewerWorkbenchBarButtons`). No new tool registration needed;
the overlay simply gains modes.

### What was added
- **Math**: `pathLength()` (perimeter = Σ segment lengths), `shoelaceArea()`
  (polygon area via the shoelace formula), `formatAreaScaled()` /
  `formatAreaUnscaled()` (mm²/cm²/m², or scaled units² when the PDF carries a
  `/Measure` scale).
- **Modes**: `distance` (unchanged) · `perimeter` · `area` (`MeasureMode`).
- **Interaction**: in perimeter/area modes, each left-click adds a vertex;
  **double-click or Enter** finalises; **Esc** cancels; switching modes discards
  any in-progress shape.
- **Render**: filled translucent polygon (area) or polyline (perimeter) with
  vertex dots and a centroid/last-vertex label. Area labels show both area and
  perimeter (`123 m²  ·  P 45 m`).
- **UI**: a 3-button mode selector (Distance / Perimeter / Area) plus a usage
  hint, and a unified "Clear all".

### Coordinate correctness
Reuses the overlay's zoom/scroll-invariant model: vertices are stored as
`PagePoint` (PDF points relative to page top-left), screen positions are
recovered at render time via `getBoundingClientRect`, and real-world scaling
reuses `pickScale()` which reads the PDF `/Measure` (viewport) dictionary.
Area scales as length², i.e. `realArea = pdfPointsArea × factor²`.

### Verification status
- `npx tsc -p tsconfig.core.vite.json --noEmit` → **0 errors in `src/core`**
  (pre-existing errors exist only under `prototypes/`/`saas/`, which the core
  build excludes).
- `npx vite build editor --mode core` → **build succeeds**.
- **Interactive QA passed** (Vite dev + Playwright on a real PDF): activated the
  ruler, switched to Area, clicked a 4-vertex rectangle, pressed Enter. The
  filled polygon rendered with the label `101.2 cm² · P 40.4 cm` (area +
  perimeter). Cross-checked the maths by hand from the click coordinates at 89%
  zoom — both values correct. The 3-mode toggle (Distance/Perimeter/Area) and
  the Clear-all control render as designed.

## 4. Remaining Foxit gaps (backlog)

Verified present in Stirling-core, so NOT needed: text-edit, sign/cert/timestamp,
compare, convert-to/from-PDF, compress, repair, sanitize, OCR, redaction, forms
fill/modify, bookmarks, attachments, multi-page layout, watermark, page numbers.

Status vs Foxit:
1. **Measure** — distance ✅ (upstream) + perimeter/area ✅ (this fork, `RulerOverlay.tsx`).
2. **Full Bates numbering** — ✅ (this fork): prefix/suffix added on top of the
   existing zero-pad + `{n}/{total}/{filename}` template (`PageNumbersController`,
   `AddPageNumbers*` frontend).
3. **Form Designer** — ✅ **DONE & interactively verified** (backend + frontend).
   Backend verified end-to-end: `POST /form/create-field` on a real PDF then a
   PyMuPDF widget dump confirms the created fields (`signature` Text + a
   CheckBox) exist at the correct positions, with the top-left→lower-left Y-flip
   correct (sent lower-left y=600 on an 842pt page → stored top-left y=212).
   Frontend verified via Vite dev + Playwright: toggled the toolbar button,
   dragged a rectangle, the name/type popup appeared, clicked Add → POST 200 →
   the document reloaded with the field. Implementation detail below.
   - Backend (DONE): `FormUtils.createFormFields(doc, defs)` wraps the existing
     private `createNewField` (creates the AcroForm if missing, validates each
     def, skips bad ones); `FormPayloadParser.parseNewFieldDefinitions`; and
     `POST /api/v1/form/create-field` (multipart `file` + JSON `fields[]`).
     `NewFormFieldDefinition` is self-contained: `{name, label, type, pageIndex,
     x, y, width, height, required, multiSelect, options, defaultValue,
     tooltip}` with x/y in PDF points, **lower-left origin**.
   - Frontend (REMAINING) — fully grounded, ~1 focused session:
     1. `FormDesignerOverlay.tsx` modelled on `RulerOverlay.tsx`: drag a rect on
        a page using the same coord model (`PagePoint` = PDF points top-left via
        `getBoundingClientRect`/zoom). Convert to backend rect:
        `x_ll = x`, `y_ll = pageHeightPts − (yTop + h)`, where
        `pageHeightPts = pageRect.height / zoom`.
     2. On mouse-up show an inline popup (name input + type select text/checkbox)
        → POST `/api/v1/form/create-field`.
     3. Reload via the proven pattern in `ViewerAnnotationControls.tsx:92-107`:
        response blob → `File` → `createStirlingFilesAndStubs([file], parentStub,
        "form")` → `fileActions.consumeFiles([oldId], stirlingFiles, stubs)`.
     4. Toolbar toggle button mirroring the ruler wiring
        (`useViewerWorkbenchBarButtons.tsx:229-245` + `EmbedPdfViewer` state +
        overlay mount at `:1263`).
4. **Edit images/objects** (move/resize/recolor) — ⏳ NOT done, but feasibility
   **revised UP** after reading `PdfJsonConversionService` (6958 lines):
   - The text-editor JSON model `PdfJsonTextElement` ALREADY carries per-element
     `textMatrix` (full Tm), `fillColor`/`strokeColor`, `fontSize`, `x/y/w/h`.
   - The JSON→PDF reconstruction has TWO paths: a **token rewrite**
     (`rewriteTextOperators`, ~line 3905 — patches the original operators,
     preserves position/colour, only swaps text) which is the DEFAULT when
     fonts are intact; and a **full regenerate** (~line 5042 `setTextMatrix`,
     ~3750 `setNonStrokingColor`) that emits text FROM the elements, honouring an
     edited matrix/colour/size. Regenerate triggers when rewrite fails / fallback
     fonts / no preserved stream / `forceRegenerate`.
   - ⇒ **Move/recolor/resize TEXT is tractable**, NOT a 3–4 week rebuild: edit
     the element's `textMatrix`/`fillColor`/`fontSize` and force the regenerate
     path. The hard content-stream reconstruction already exists.
   - ✅ **EMPIRICALLY PROVEN + backend enabler shipped**: round-trip test
     (PDF→JSON, shift a text element's `textMatrix[4]` by +150, JSON→PDF) moved
     the text by exactly 150pt (x 161.4→311.4). Added an optional
     **`forceRegenerate`** flag to `convertJsonToPdf` + `/convert/text-editor/pdf`:
     `true` rebuilds each page from the (edited) elements so position/colour/size
     edits apply; `false` (default) keeps the lossless rewrite. Verified both
     ways (true→moved, false→unchanged). `compileJava` SUCCESSFUL.
   - REMAINING (next focused session): the interactive element-edit UI — load the
     per-page text-element JSON, overlay draggable/recolorable handles on the
     rendered page, on commit set `textMatrix`/`fillColor`/`fontSize` and POST
     with `forceRegenerate=true`, then reload via `handleFormApply`. Add a
     golden-file roundtrip-stability harness. Image-object move/resize is
     separate (`reconstructImageXObjects` ~line 2962); image recolor + arbitrary
     vector-object editing remain genuinely hard.
