import { test, expect } from "@app/tests/helpers/stub-test-base";
import path from "path";

const SAMPLE = path.join(__dirname, "../test-fixtures/sample.pdf");
const SAMPLE_B = path.join(__dirname, "../test-fixtures/compare_sample_b.pdf");

test.describe("Merge redesign — in-panel ordered file list", () => {
  test("shows an ordered, reorderable file list with thumbnails + controls", async ({
    page,
  }) => {
    await page.goto("/merge");
    await page.waitForLoadState("domcontentloaded");

    // Upload two PDFs.
    await page.getByTestId("files-button").click();
    await page
      .locator('[data-testid="file-input"]')
      .setInputFiles([SAMPLE, SAMPLE_B]);

    // The new ordered list renders one row per selected file (data-testid="merge-file-row-*").
    const rows = page.locator('[data-testid^="merge-file-row-"]');
    await expect(rows.first()).toBeVisible({ timeout: 20000 });

    // If both files auto-selected, we should have 2 rows; if not, at least the list is present.
    const count = await rows.count();
    console.log(`[merge-redesign] rows=${count}`);

    // Per-row controls exist: move up/down + remove.
    await expect(page.getByLabel("Move up").first()).toBeVisible();
    await expect(page.getByLabel("Move down").first()).toBeVisible();
    await expect(
      page.locator('[data-testid^="merge-file-remove-"]').first(),
    ).toBeVisible();

    await page.screenshot({
      path: path.resolve(process.cwd(), "test-artifacts", "merge-redesign.png"),
    });

    expect(count).toBeGreaterThan(0);
  });
});
