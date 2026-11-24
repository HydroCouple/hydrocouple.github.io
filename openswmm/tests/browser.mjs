// Run on a local HTTP origin in CI, including the production module-worker path.
import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:8765/openswmm/");
  // A first visit opens the welcome dialog over the workbench.
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Run model" }).click();
  await page.waitForFunction(
    () =>
      document.getElementById("status").textContent.startsWith("Run complete"),
    {},
    { timeout: 90000 },
  );
  assert.match(await page.locator("#volume").innerText(), /250/);
  await page.getByRole("button", { name: "View report" }).click();
  assert.ok((await page.locator("#content pre").innerText()).length > 200);
  await page.getByRole("button", { name: "Close dialog" }).click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export project" }).click();
  const path = await (await downloaded).path();
  await page
    .locator("#input")
    .setInputFiles({
      name: "study.zip",
      mimeType: "application/zip",
      buffer: await (await import("node:fs/promises")).readFile(path),
    });
  await page.waitForFunction(
    () =>
      document.getElementById("status").textContent ===
      "Reopened local results.",
  );
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.context().setOffline(true);
  await page.reload();
  await page.waitForFunction(() =>
    document.getElementById("volume").textContent.includes("250"),
  );
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
