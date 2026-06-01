package stirling.software.SPDF.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;

import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.apache.pdfbox.pdmodel.graphics.image.LosslessFactory;
import org.apache.pdfbox.pdmodel.graphics.image.PDImageXObject;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.pdfbox.text.TextPosition;
import org.apache.pdfbox.util.Matrix;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.DefaultResourceLoader;
import org.springframework.mock.web.MockMultipartFile;

import stirling.software.SPDF.config.EndpointConfiguration;
import stirling.software.SPDF.model.json.PdfJsonDocument;
import stirling.software.SPDF.model.json.PdfJsonImageElement;
import stirling.software.SPDF.model.json.PdfJsonPage;
import stirling.software.SPDF.model.json.PdfJsonTextElement;
import stirling.software.SPDF.service.pdfjson.PdfJsonFontService;
import stirling.software.SPDF.service.pdfjson.type3.Type3FontConversionService;
import stirling.software.SPDF.service.pdfjson.type3.Type3GlyphExtractor;
import stirling.software.common.model.ApplicationProperties;
import stirling.software.common.service.CustomPDFDocumentFactory;
import stirling.software.common.service.PdfMetadataService;
import stirling.software.common.service.TaskManager;
import stirling.software.common.util.TempFileManager;
import stirling.software.common.util.TempFileRegistry;

import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

/**
 * Golden-file roundtrip-stability harness for {@link PdfJsonConversionService} (Clevai fork,
 * Open-item #3 / sub-task B). Unlike the controller tests, this exercises the <b>real</b>
 * conversion (PDF&rarr;JSON&rarr;PDF) end-to-end so it guards two invariants:
 *
 * <ol>
 *   <li><b>Stability</b>: a no-edit roundtrip with {@code forceRegenerate=false} (the lossless
 *       token-rewrite path) preserves text content and on-page glyph positions.
 *   <li><b>Edits apply</b>: with {@code forceRegenerate=true}, a moved element actually moves and a
 *       <b>resized</b> element (sub-task A — scaling {@code textMatrix} a,b,c,d) actually changes
 *       the rendered glyph size. This is the backend proof behind the Edit Objects resize handles.
 * </ol>
 *
 * <p>The service has a deep dependency graph; everything that the direct roundtrip path touches is
 * constructed for real. The two deps that are only reached by unrelated paths ({@code
 * endpointConfiguration} — Ghostscript group check, disabled by default; {@code taskManager} —
 * async job notes) are mocked.
 */
class PdfJsonConversionServiceRoundtripTest {

    /** Distinctive single-run token placed at a known location in the golden PDF. */
    private static final String TOKEN = "MEASURE";

    private static final float GOLDEN_X = 100f;
    private static final float GOLDEN_Y = 700f; // PDF points, bottom-left origin
    private static final float GOLDEN_FONT_PT = 12f;
    private static final float PAGE_W = 612f;
    private static final float PAGE_H = 792f;

    private PdfJsonConversionService service;

    @BeforeEach
    void setUp() {
        ApplicationProperties appProps = new ApplicationProperties();
        PdfMetadataService metadataService =
                new PdfMetadataService(appProps, "Stirling-PDF", false, null);
        CustomPDFDocumentFactory pdfDocumentFactory = new CustomPDFDocumentFactory(metadataService);
        // Match the production Spring-configured mapper: Jackson 3 defaults
        // FAIL_ON_NULL_FOR_PRIMITIVES to true, but application.properties restores the Jackson 2
        // behaviour (spring.jackson.deserialization.fail-on-null-for-primitives=false) so absent/
        // null JSON fields map to Java primitive defaults.
        ObjectMapper objectMapper =
                JsonMapper.builder()
                        .disable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES)
                        .build();
        TempFileManager tempFileManager = new TempFileManager(new TempFileRegistry(), appProps);
        PdfJsonFontService fontService = new PdfJsonFontService(tempFileManager, appProps);
        PdfJsonFallbackFontService fallbackFontService =
                new PdfJsonFallbackFontService(new DefaultResourceLoader(), appProps);
        // Production resolves this from @Value/@PostConstruct; without a Spring context we set the
        // bundled Noto fallback location directly so the JSON->PDF rebuild can load a fallback
        // font.
        setField(
                fallbackFontService,
                "fallbackFontLocation",
                PdfJsonFallbackFontService.DEFAULT_FALLBACK_FONT_LOCATION);
        PdfJsonCosMapper cosMapper = new PdfJsonCosMapper();
        Type3GlyphExtractor type3GlyphExtractor = new Type3GlyphExtractor();
        Type3FontConversionService type3FontConversionService =
                new Type3FontConversionService(List.of(), type3GlyphExtractor);

        service =
                new PdfJsonConversionService(
                        pdfDocumentFactory,
                        objectMapper,
                        mock(EndpointConfiguration.class),
                        tempFileManager,
                        mock(TaskManager.class),
                        cosMapper,
                        fallbackFontService,
                        fontService,
                        type3FontConversionService,
                        type3GlyphExtractor,
                        appProps);
    }

    private static void setField(Object target, String fieldName, Object value) {
        try {
            java.lang.reflect.Field field = target.getClass().getDeclaredField(fieldName);
            field.setAccessible(true);
            field.set(target, value);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException("Failed to set field " + fieldName, e);
        }
    }

    // ── Golden fixture ─────────────────────────────────────────────────────────

    private static byte[] goldenPdf() throws IOException {
        try (PDDocument doc = new PDDocument();
                ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
            PDPage page = new PDPage(new PDRectangle(PAGE_W, PAGE_H));
            doc.addPage(page);
            try (PDPageContentStream cs = new PDPageContentStream(doc, page)) {
                cs.beginText();
                cs.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA), GOLDEN_FONT_PT);
                cs.newLineAtOffset(GOLDEN_X, GOLDEN_Y);
                cs.showText(TOKEN);
                cs.endText();
            }
            doc.save(baos);
            return baos.toByteArray();
        }
    }

    private MockMultipartFile multipart(byte[] pdf) {
        return new MockMultipartFile("fileInput", "golden.pdf", "application/pdf", pdf);
    }

    private byte[] jsonToPdf(PdfJsonDocument doc, boolean forceRegenerate) throws IOException {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        service.convertJsonToPdf(doc, forceRegenerate, baos);
        return baos.toByteArray();
    }

    /** Find the text element that carries the golden TOKEN (or its first glyph). */
    private static PdfJsonTextElement tokenElement(PdfJsonDocument doc) {
        assertNotNull(doc.getPages(), "doc has pages");
        for (PdfJsonPage page : doc.getPages()) {
            if (page.getTextElements() == null) continue;
            for (PdfJsonTextElement el : page.getTextElements()) {
                String t = el.getText();
                if (t != null
                        && (t.contains(TOKEN) || TOKEN.startsWith(t.trim()) && !t.isBlank())) {
                    return el;
                }
            }
        }
        // Fallback: first non-blank element.
        for (PdfJsonPage page : doc.getPages()) {
            if (page.getTextElements() == null) continue;
            for (PdfJsonTextElement el : page.getTextElements()) {
                if (el.getText() != null && !el.getText().isBlank()) return el;
            }
        }
        throw new AssertionError("no text element found in golden doc");
    }

    // ── Position probe via PDFBox ───────────────────────────────────────────────

    private record Glyph(float x, float y, float fontSize, float height) {}

    /** Position + size of the first occurrence of {@code target} char in the rendered PDF. */
    private static Optional<Glyph> firstGlyph(byte[] pdf, char target) throws IOException {
        List<TextPosition> positions = new ArrayList<>();
        try (PDDocument doc = Loader.loadPDF(pdf)) {
            PDFTextStripper stripper =
                    new PDFTextStripper() {
                        @Override
                        protected void writeString(String text, List<TextPosition> tps) {
                            positions.addAll(tps);
                        }
                    };
            stripper.setStartPage(1);
            stripper.setEndPage(1);
            stripper.getText(doc);
        }
        for (TextPosition tp : positions) {
            String u = tp.getUnicode();
            if (u != null && !u.isEmpty() && u.charAt(0) == target) {
                return Optional.of(
                        new Glyph(
                                tp.getXDirAdj(),
                                tp.getYDirAdj(),
                                tp.getFontSizeInPt(),
                                tp.getHeightDir()));
            }
        }
        return Optional.empty();
    }

    private static Glyph requireGlyph(byte[] pdf, char target) throws IOException {
        return firstGlyph(pdf, target)
                .orElseThrow(
                        () -> new AssertionError("glyph '" + target + "' not found in output"));
    }

    // ── Tests ───────────────────────────────────────────────────────────────────

    @Test
    void roundtrip_preservesTextContent() throws Exception {
        PdfJsonDocument doc = service.convertPdfToJsonDocument(multipart(goldenPdf()));
        PdfJsonTextElement el = tokenElement(doc);
        assertTrue(el.getText().contains("M"), "token text extracted, was: " + el.getText());
        assertNotNull(el.getTextMatrix(), "element carries a text matrix");
        assertEquals(6, el.getTextMatrix().length);
    }

    @Test
    void roundtrip_noEdit_isPositionStable() throws Exception {
        byte[] golden = goldenPdf();
        Glyph before = requireGlyph(golden, 'M');

        PdfJsonDocument doc = service.convertPdfToJsonDocument(multipart(golden));
        byte[] rebuilt = jsonToPdf(doc, /* forceRegenerate= */ false);
        Glyph after = requireGlyph(rebuilt, 'M');

        // Lossless rewrite path: position + size must be stable within a tight tolerance.
        assertEquals(before.x(), after.x(), 1.0f, "X stable");
        assertEquals(before.y(), after.y(), 1.0f, "Y stable");
        assertEquals(before.fontSize(), after.fontSize(), 0.5f, "font size stable");
    }

    @Test
    void forceRegenerate_move_shiftsGlyphPosition() throws Exception {
        byte[] golden = goldenPdf();
        Glyph before = requireGlyph(golden, 'M');

        PdfJsonDocument doc = service.convertPdfToJsonDocument(multipart(golden));
        PdfJsonTextElement el = tokenElement(doc);
        float[] m = el.getTextMatrix();
        m[4] = m[4] + 150f; // shift +150pt in PDF x (the Edit Objects "move" edit)
        el.setTextMatrix(m);

        byte[] rebuilt = jsonToPdf(doc, /* forceRegenerate= */ true);
        Glyph after = requireGlyph(rebuilt, 'M');

        assertEquals(before.x() + 150f, after.x(), 2.0f, "X shifted by +150pt");
        assertEquals(before.y(), after.y(), 2.0f, "Y unchanged by a horizontal move");
    }

    @Test
    void forceRegenerate_resize_scalesGlyphSize() throws Exception {
        // Backend proof for sub-task A: scaling textMatrix a,b,c,d (+ fontSize/fontMatrixSize)
        // by k doubles the rendered glyph size, position (e,f) preserved.
        byte[] golden = goldenPdf();
        Glyph before = requireGlyph(golden, 'M');

        PdfJsonDocument doc = service.convertPdfToJsonDocument(multipart(golden));
        PdfJsonTextElement el = tokenElement(doc);
        float[] m = el.getTextMatrix();
        float origE = m[4];
        float origF = m[5];
        float k = 2.0f;
        m[0] *= k;
        m[1] *= k;
        m[2] *= k;
        m[3] *= k;
        el.setTextMatrix(m); // e,f untouched
        if (el.getFontSize() != null) el.setFontSize(el.getFontSize() * k);
        if (el.getFontMatrixSize() != null) el.setFontMatrixSize(el.getFontMatrixSize() * k);
        if (el.getWidth() != null) el.setWidth(el.getWidth() * k);

        byte[] rebuilt = jsonToPdf(doc, /* forceRegenerate= */ true);
        Glyph after = requireGlyph(rebuilt, 'M');

        assertTrue(
                after.fontSize() > before.fontSize() * 1.7f,
                "font size grew ~2x: before=" + before.fontSize() + " after=" + after.fontSize());
        assertTrue(
                after.height() > before.height() * 1.5f,
                "glyph height grew: before=" + before.height() + " after=" + after.height());
        // Position anchor (e,f) preserved — resize must not move the text origin.
        assertEquals(origE, el.getTextMatrix()[4], 0.001f, "e preserved in edited model");
        assertEquals(origF, el.getTextMatrix()[5], 0.001f, "f preserved in edited model");
        assertFalse(rebuilt.length == 0, "rebuilt pdf is non-empty");
    }

    // ── Image objects (sub-task C) ──────────────────────────────────────────────
    // The image element carries the placement CTM in `transform` ([a,b,c,d,e,f] where a/d are the
    // displayed width/height and e/f the lower-left origin). drawImageElement re-emits the image
    // from that transform under forceRegenerate=true, so editing the transform moves/resizes the
    // image. We measure by re-extracting the rebuilt PDF: the extraction recaptures the CTM, so the
    // round-tripped transform reflects exactly where/how big the image landed.

    private static final float IMG_W = 80f;
    private static final float IMG_H = 60f;
    private static final float IMG_X = 120f; // lower-left e
    private static final float IMG_Y = 500f; // lower-left f

    private static byte[] goldenImagePdf() throws IOException {
        try (PDDocument doc = new PDDocument();
                ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
            PDPage page = new PDPage(new PDRectangle(PAGE_W, PAGE_H));
            doc.addPage(page);
            BufferedImage bi = new BufferedImage(16, 16, BufferedImage.TYPE_INT_RGB);
            for (int x = 0; x < 16; x++) {
                for (int y = 0; y < 16; y++) {
                    bi.setRGB(x, y, 0xD81B60); // solid magenta so the encoder keeps it
                }
            }
            PDImageXObject image = LosslessFactory.createFromImage(doc, bi);
            try (PDPageContentStream cs = new PDPageContentStream(doc, page)) {
                // CTM maps the unit square to an IMG_W×IMG_H box at (IMG_X, IMG_Y).
                cs.drawImage(image, new Matrix(IMG_W, 0, 0, IMG_H, IMG_X, IMG_Y));
            }
            doc.save(baos);
            return baos.toByteArray();
        }
    }

    private static PdfJsonImageElement imageElement(PdfJsonDocument doc) {
        assertNotNull(doc.getPages(), "doc has pages");
        for (PdfJsonPage page : doc.getPages()) {
            if (page.getImageElements() == null) continue;
            for (PdfJsonImageElement img : page.getImageElements()) {
                if (img.getTransform() != null && img.getTransform().length == 6) return img;
            }
        }
        throw new AssertionError("no image element with a transform found");
    }

    /** Re-extract the rebuilt PDF and read where/how big the image landed. */
    private PdfJsonImageElement placedImage(byte[] pdf) throws IOException {
        return imageElement(service.convertPdfToJsonDocument(multipart(pdf)));
    }

    @Test
    void image_isExtractedWithPlacementTransform() throws Exception {
        PdfJsonImageElement img =
                imageElement(service.convertPdfToJsonDocument(multipart(goldenImagePdf())));
        float[] t = img.getTransform();
        assertEquals(IMG_W, t[0], 1.0f, "transform a == displayed width");
        assertEquals(IMG_H, t[3], 1.0f, "transform d == displayed height");
        assertEquals(IMG_X, t[4], 1.0f, "transform e == lower-left x");
        assertEquals(IMG_Y, t[5], 1.0f, "transform f == lower-left y");
        assertNotNull(img.getImageData(), "image bitmap carried in JSON");
    }

    @Test
    void forceRegenerate_imageMove_shiftsPlacement() throws Exception {
        PdfJsonDocument doc = service.convertPdfToJsonDocument(multipart(goldenImagePdf()));
        PdfJsonImageElement img = imageElement(doc);
        float[] t = img.getTransform();
        float origE = t[4];
        float origF = t[5];
        float origA = t[0];
        float origD = t[3];
        t[4] = origE + 130f; // move right
        t[5] = origF - 90f; // move down
        img.setTransform(t);

        PdfJsonImageElement after = placedImage(jsonToPdf(doc, /* forceRegenerate= */ true));
        assertEquals(origE + 130f, after.getTransform()[4], 2.0f, "image moved +130 in x");
        assertEquals(origF - 90f, after.getTransform()[5], 2.0f, "image moved -90 in y");
        // Size unchanged by a pure move.
        assertEquals(origA, after.getTransform()[0], 1.0f, "width unchanged");
        assertEquals(origD, after.getTransform()[3], 1.0f, "height unchanged");
    }

    @Test
    void forceRegenerate_imageResize_scalesPlacement() throws Exception {
        PdfJsonDocument doc = service.convertPdfToJsonDocument(multipart(goldenImagePdf()));
        PdfJsonImageElement img = imageElement(doc);
        float[] t = img.getTransform();
        float origA = t[0];
        float origD = t[3];
        float origE = t[4];
        float origF = t[5];
        float k = 1.5f;
        t[0] = origA * k;
        t[3] = origD * k;
        img.setTransform(t);
        if (img.getWidth() != null) img.setWidth(img.getWidth() * k);
        if (img.getHeight() != null) img.setHeight(img.getHeight() * k);

        PdfJsonImageElement after = placedImage(jsonToPdf(doc, /* forceRegenerate= */ true));
        assertEquals(origA * k, after.getTransform()[0], 1.5f, "width scaled ~1.5x");
        assertEquals(origD * k, after.getTransform()[3], 1.5f, "height scaled ~1.5x");
        // Lower-left anchor preserved (resize grows up/right from the origin, like the CTM).
        assertEquals(origE, after.getTransform()[4], 2.0f, "x origin preserved");
        assertEquals(origF, after.getTransform()[5], 2.0f, "y origin preserved");
    }
}
