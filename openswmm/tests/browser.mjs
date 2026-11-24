// Run on a local HTTP origin in CI, including the production module-worker path.
import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:8765/openswmm/");
  // A first visit opens the welcome dialog over the workbench (Bellinge loads behind it); the
  // sloping-plane card loads the small deck the rest of this test runs.
  await page.locator('#welcome .ex[data-example="surface"]').click();
  await page.waitForFunction(() => document.getElementById("modelname").textContent === "surface.inp");
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
  await page.getByRole("button", { name: "Close dialog" }).click();

  // Record editors: change one time series value in the dialog, apply it, and the deck row changes.
  await choose("example", "network");
  await page.waitForFunction(() => document.getElementById("modelname").textContent === "network.inp");
  await page.waitForFunction(() => [...document.getElementById("objkind").options].some((o) => o.value === "timeseries"));
  await choose("objkind", "timeseries");
  await page.waitForFunction(() => /^7 rows · 0:00:00 elapsed → 1:30:00 elapsed$/.test(document.querySelector(".record-card .record-desc")?.textContent || ""));
  assert.match(await page.locator(".record-card p.hint").innerText(), /Used by gage G1\./);
  await page.getByRole("button", { name: "Edit values…" }).click();
  await page.getByLabel("Row 3 value").fill("1.25");
  await page.getByRole("button", { name: "Save to model" }).click();
  await page.waitForFunction(() => document.getElementById("editnote").textContent.startsWith("1 edit"));
  await page.getByRole("button", { name: "Apply to model" }).click();
  await until(/^1 edit applied/);
  await page.getByRole("button", { name: "Edit INP" }).click();
  assert.match(await page.locator("#content textarea").inputValue(), /^TS1\s+0:30\s+1\.25\s*$/m);
  await page.getByRole("button", { name: "Close dialog" }).click();

  // Control rules, a node's inflows and a unit hydrograph on the inflows fixture.
  const { readFile } = await import("node:fs/promises");
  await page.locator("#input").setInputFiles({ name: "inflows.inp", mimeType: "text/plain", buffer: await readFile(new URL("./fixtures/inflows.inp", import.meta.url)) });
  await page.waitForFunction(() => document.getElementById("modelname").textContent === "inflows.inp");
  await choose("objkind", "controls");
  await page.waitForFunction(() => document.querySelector(".record-card .record-desc")?.textContent === "2 rules: R1, R2");
  await page.getByRole("button", { name: "Edit rules…" }).click();
  const program = page.getByLabel("Control rules", { exact: true });
  const original = await program.inputValue();
  await program.fill(original.replace("NODE J2", "NODE J9"));
  await page.waitForFunction(() => /J9/.test(document.querySelector(".rule-verdicts li.bad")?.textContent || ""));
  await program.fill(original.replace("DEPTH > 1.0", "DEPTH > 1.5"));
  await page.waitForFunction(() => document.querySelectorAll(".rule-verdicts li.ok").length === 2);
  await page.getByRole("button", { name: "Save to model" }).click();
  await page.waitForFunction(() => document.getElementById("editnote").textContent.startsWith("1 edit"));
  await choose("objkind", "node");
  await page.getByRole("button", { name: "Edit inflows…" }).click();
  await page.getByLabel("External inflow 1 baseline", { exact: true }).fill("0.2");
  await page.getByRole("button", { name: "Save to model" }).click();
  await page.waitForFunction(() => document.getElementById("editnote").textContent.startsWith("2 edits"));
  await choose("objkind", "hydrograph");
  await page.waitForFunction(() => /^Rain gage G1/.test(document.querySelector(".record-card .record-desc")?.textContent || ""));
  await page.getByRole("button", { name: "Edit values…" }).click();
  await page.getByLabel("Short term R", { exact: true }).fill("0.025");
  await page.getByRole("button", { name: "Save to model" }).click();
  await page.waitForFunction(() => document.getElementById("editnote").textContent.startsWith("3 edits"));
  await page.getByRole("button", { name: "Apply to model" }).click();
  await until(/^3 edits applied/);
  await page.getByRole("button", { name: "Edit INP" }).click();
  const deckText = await page.locator("#content textarea").inputValue();
  assert.match(deckText, /^IF NODE J2 DEPTH > 1\.5$/m);
  assert.match(deckText, /^J1\s+FLOW\s+INFLOW_TS\s+FLOW\s+1 1 0\.2/m);
  assert.match(deckText, /^UH1\s+ALL\s+SHORT\s+0\.025/m);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Run model" }).click();
  await until(/^Run complete/);
  // A model with a CRS is placed by it: the inspector names the system and the hand-placed map
  // reference is not offered; a model without one keeps the reference button.
  await page.locator("#input").setInputFiles({ name: "crs.inp", mimeType: "text/plain", buffer: await readFile(new URL("./fixtures/crs.inp", import.meta.url)) });
  await page.waitForFunction(() => document.getElementById("inspanchor").textContent === "EPSG:2284 · NAD83 / Virginia South (ftUS)");
  assert.equal(await page.locator("#locate").isHidden(), true);
  await page.locator("#input").setInputFiles({ name: "inflows.inp", mimeType: "text/plain", buffer: await readFile(new URL("./fixtures/inflows.inp", import.meta.url)) });
  await page.waitForFunction(() => document.getElementById("inspanchor").textContent === "Local coordinates");
  assert.equal(await page.locator("#locate").isHidden(), false);
  // Layer tree: a 1D model lists only SWMM and Basemaps; switching a kind off redraws without it.
  const shownCategories = () =>
    page.evaluate(() => [...document.querySelectorAll("#layertree .layer-cat:not([hidden]) .layer-head b")].map((b) => b.textContent));
  assert.deepEqual(await shownCategories(), ["SWMM", "Basemaps"]);
  const plot = () => page.evaluate(() => document.getElementById("plot").toDataURL());
  const before = await plot();
  await page.getByLabel("Conduits", { exact: true }).uncheck();
  assert.notEqual(await plot(), before);
  assert.equal(await page.getByLabel("Links", { exact: true }).isChecked(), false);
  assert.equal(await page.getByLabel("SWMM", { exact: true }).evaluate((b) => b.indeterminate), true);
  await page.getByLabel("Conduits", { exact: true }).check();
  assert.equal(await plot(), before);
  // The Bellinge example loads its deck, mesh sidecar and rain file, and is placed by its CRS.
  await choose("example", "bellinge");
  await page.waitForFunction(() => document.getElementById("modelname").textContent === "BellingeSWMM_v021_nopervious.inp");
  await page.waitForFunction(() => document.getElementById("inspanchor").textContent === "EPSG:25832 · ETRS89 / UTM zone 32N");
  assert.equal(await page.locator("#inspcells").innerText(), "27628");
  assert.equal(await page.locator("#inspinputs").innerText(), "3");
  // The desktop's category order; SWMM can be moved above the 2D outputs and back.
  assert.deepEqual(await shownCategories(), ["SWMM 2D Outputs", "SWMM", "Meshes", "Basemaps"]);
  await page.getByRole("button", { name: "Move SWMM up" }).click();
  assert.deepEqual(await shownCategories(), ["SWMM", "SWMM 2D Outputs", "Meshes", "Basemaps"]);
  await page.getByRole("button", { name: "Move SWMM down" }).click();
  assert.deepEqual(await shownCategories(), ["SWMM 2D Outputs", "SWMM", "Meshes", "Basemaps"]);
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
