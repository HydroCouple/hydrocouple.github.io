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
  await page.context().setOffline(false);

  // Run controls: stop at a time and resume a 1D run, a live forcing, a scenario sweep.
  const status = () => page.locator("#status").innerText();
  const until = (pattern) =>
    page.waitForFunction(
      (source) => new RegExp(source).test(document.getElementById("status").textContent),
      pattern.source,
      { timeout: 90000 },
    );
  const choose = (id, value) =>
    page.evaluate(
      ([id, value]) => {
        const field = document.getElementById(id);
        field.value = value;
        field.dispatchEvent(new Event("change"));
      },
      [id, value],
    );
  await choose("example", "network");
  await page.waitForFunction(() => document.getElementById("modelname").textContent === "network.inp");
  await choose("until", "1:00");
  await page.getByRole("button", { name: "Run model" }).click();
  await until(/state saved; Resume run continues it/);
  assert.match(await status(), /^Run stopped at 01:0/);
  await choose("until", "");
  await page.getByRole("button", { name: "Resume run" }).click();
  await until(/^Run complete/);
  assert.equal(await page.locator("#resume").isHidden(), true);

  await choose("example", "surface");
  await page.waitForFunction(() => document.getElementById("modelname").textContent === "surface.inp");
  await page.getByRole("button", { name: "Forcing" }).click();
  await page.locator("#forcevalue").fill("0");
  await page.locator("#forceapply").click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Run model" }).click();
  await until(/^Run complete/);
  assert.equal(await page.locator("#volume").innerText(), "0 m³");
  assert.equal(await page.locator("#inspforced").innerText(), "1");
  await page.getByRole("button", { name: "Forcing" }).click();
  await page.locator("#forceclear").click();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Scenarios" }).click();
  await page.getByRole("button", { name: "Add the current model" }).click();
  await page.getByRole("button", { name: "Add the current model" }).click();
  await page.getByRole("button", { name: "Run all scenarios" }).click();
  await until(/^Scenarios run · 2 of 2/);
  assert.deepEqual(await page.locator("table.compare thead th").allInnerTexts(), ["", "Scenario 1", "Scenario 2"]);
  const rain = await page.locator("table.compare tbody tr").nth(1).locator("td").allInnerTexts();
  assert.deepEqual(rain, ["250", "250"]);
  await page.waitForFunction(() => /Depth at|No network time series/.test(document.querySelector(".scenarios p.hint:last-child")?.textContent || ""));
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
