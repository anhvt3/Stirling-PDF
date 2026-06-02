import { test, expect } from "@app/tests/helpers/stub-test-base";
import path from "path";

test("rebrand — PDFMagic wordmark renders in header + landing", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500);

  await page.screenshot({
    path: path.resolve(process.cwd(), "test-artifacts", "rebrand.png"),
  });

  // The Wordmark renders role=img with aria-label "PDFMagic" (header + landing hero).
  const marks = page.getByRole("img", { name: "PDFMagic" });
  await expect(marks.first()).toBeVisible({ timeout: 10000 });
  const count = await marks.count();
  const title = await page.title();
  console.log(`[rebrand] wordmarks=${count} documentTitle="${title}"`);

  expect(count).toBeGreaterThan(0);
  expect(title.toLowerCase()).toContain("pdfmagic");
});
