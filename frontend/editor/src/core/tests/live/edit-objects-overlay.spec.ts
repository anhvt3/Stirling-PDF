import { test, expect } from "@app/tests/helpers/test-base";
import { ensureCookieConsent, skipOnboarding } from "@app/tests/helpers/login";
import * as path from "path";
import * as fs from "fs";

/**
 * Live QA for the Edit Objects overlay (Clevai fork, Open-item #3 sub-tasks A & C):
 *  - A: text resize handle renders on a selected text box.
 *  - C: image-object boxes render and move/resize handles appear on selection.
 *
 * Requires a running core backend on :8080 (the overlay POSTs /convert/pdf/text-editor)
 * and the Vite dev server on :5173. Run WITHOUT the live-setup login bootstrap:
 *   npx playwright test edit-objects-overlay --project=live --no-deps
 * (backend started with SECURITY_ENABLELOGIN=false, so no auth needed).
 */

function fixture(name: string): string {
  const candidates = [
    path.resolve(process.cwd(), "src", "core", "tests", "test-fixtures", name),
    path.resolve(process.cwd(), "frontend", "editor", "src", "core", "tests", "test-fixtures", name),
  ];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  throw new Error(`fixture not found: ${name}`);
}

const ARTIFACTS = path.resolve(process.cwd(), "test-artifacts");

test("Edit Objects overlay: image boxes + resize handles render live", async ({ page }) => {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });

  // Dismiss cookie-consent + onboarding modals (normally done by live-setup, which
  // --no-deps skips). Must run before navigation.
  await ensureCookieConsent(page);
  await skipOnboarding(page);

  await page.goto("/read");
  await page.waitForLoadState("domcontentloaded");

  // Upload a PDF with text + an embedded image. The overlay requests inlineImages=true so the
  // doc carries editable imageElements (the lazy-image path would strip them).
  await page.getByTestId("files-button").click();
  await page.locator('[data-testid="file-input"]').setInputFiles(fixture("text-and-image.pdf"));

  // Wait for the page to render in the viewer (overlay needs [data-page-index]).
  await expect(page.locator("[data-page-index]").first()).toBeVisible({ timeout: 30_000 });

  // Activate the Edit Objects tool from the viewer workbench bar.
  const editBtn = page.getByRole("button", { name: /^Edit Objects$/i }).first();
  await expect(editBtn).toBeVisible({ timeout: 15_000 });
  await editBtn.click();

  // The overlay toolbar appears, then fetches the editable JSON from the backend.
  await expect(page.getByText("Edit Objects", { exact: true }).first()).toBeVisible({
    timeout: 15_000,
  });

  // Sub-task A (text resize): text boxes must render; selecting one shows the resize handle.
  const textBox = page.locator('[data-testid^="editobjects-el-"]').first();
  await expect(textBox).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: path.join(ARTIFACTS, "edit-objects-01-loaded.png") });

  await textBox.click({ position: { x: 3, y: 3 } });
  const textResize = page.locator('[data-testid^="editobjects-resize-"]').first();
  await expect(textResize).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId("editobjects-size")).toBeVisible({ timeout: 5_000 });
  await page.screenshot({ path: path.join(ARTIFACTS, "edit-objects-02-text-resize-handle.png") });

  // Sub-task C (image): with inlineImages=true the doc carries imageElements, so an editable image
  // box must render. Select it → SE resize handle appears → dragging it grows the box.
  const imgBox = page
    .locator('[data-testid^="editobjects-img-"]:not([data-testid*="resize"])')
    .first();
  await expect(imgBox).toBeVisible({ timeout: 30_000 });
  const imageCount = await page
    .locator('[data-testid^="editobjects-img-"]:not([data-testid*="resize"])')
    .count();

  await imgBox.click({ position: { x: 8, y: 8 } });
  const imgResize = page.locator('[data-testid^="editobjects-img-resize-"]').first();
  await expect(imgResize).toBeVisible({ timeout: 5_000 });
  const sizeReadout = page.getByTestId("editobjects-img-size");
  await expect(sizeReadout).toBeVisible({ timeout: 5_000 });
  await page.screenshot({ path: path.join(ARTIFACTS, "edit-objects-03-image-selected.png") });

  const sizeBefore = (await sizeReadout.textContent()) ?? "";
  const handle = await imgResize.boundingBox();
  if (handle) {
    await page.mouse.move(handle.x + 5, handle.y + 5);
    await page.mouse.down();
    await page.mouse.move(handle.x + 120, handle.y + 90, { steps: 10 });
    await page.mouse.up();
  }
  await page.screenshot({ path: path.join(ARTIFACTS, "edit-objects-04-image-resized.png") });
  const sizeAfter = (await sizeReadout.textContent()) ?? "";

  // Parse "image 200×160 pt" → width pt.
  const widthPt = (s: string) => parseFloat((s.match(/image\s+(\d+(?:\.\d+)?)/) ?? [])[1] ?? "0");
  console.log(`[QA] imageBoxes=${imageCount} sizeBefore="${sizeBefore}" sizeAfter="${sizeAfter}"`);
  console.log(`[QA] consoleErrors=${consoleErrors.length}`);
  expect(imageCount).toBeGreaterThan(0);
  // SE-handle drag down-right must GROW the image width.
  expect(widthPt(sizeAfter)).toBeGreaterThan(widthPt(sizeBefore) + 10);
});
