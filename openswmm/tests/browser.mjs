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
  // The time bar is context driven: hidden until a run has results to play.
  assert.equal(await page.locator("#timebar").isHidden(), true);
  await page.getByRole("button", { name: "Run model" }).click();
  await page.waitForFunction(
    () =>
      document.getElementById("status").textContent.startsWith("Run complete"),
    {},
    { timeout: 90000 },
  );
  assert.equal(await page.locator("#timebar").isHidden(), false);
  const steps = await page.locator("#step").innerText();
  assert.match(steps, /^(\d+) \/ \1$/, "the last frame is shown");
  await page.getByRole("button", { name: "Jump to start" }).click();
  assert.match(await page.locator("#step").innerText(), /^1 \/ /);
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press(" "); // Space plays
  await page.waitForFunction(() => !/^1 \//.test(document.getElementById("step").textContent));
  assert.match(await page.locator("#volume").innerText(), /250/);
  // Water depth style (V4a): filled contours in 4 equal classes list 4 classes in the legend; Reset
  // returns to the continuous ramp.
  await page.getByRole("button", { name: "Water depth style" }).click();
  await page.locator('select[aria-label="Display"]').selectOption("bands");
  await page.locator('select[aria-label="Classes"]').selectOption("equal");
  await page.locator('input[aria-label="Number of classes"]').fill("4");
  await page.getByRole("button", { name: "Done" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".layer-classes li").length === 4);
  await page.getByRole("button", { name: "Water depth style" }).click();
  await page.getByRole("button", { name: "Reset" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".layer-classes li").length === 0);
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
  // A network model has no surface frames: no time bar, and the status says where its results are.
  assert.equal(await page.locator("#timebar").isHidden(), true);
  assert.match(await status(), /network results in Plot and View report$/);
  // Plot (V2): a conduit picked in the inspector is plotted as flow in the docked panel.
  await page.waitForTimeout(1500); // the editing session reopens after the run
  await choose("objkind", "link");
  await choose("objid", "C1");
  await page.getByRole("button", { name: "Plot", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".plot-chip").length === 1);
  await page.waitForFunction(() => document.querySelector(".plot-note").textContent === "", null, { timeout: 60000 });
  assert.match(await page.locator(".plot-chip").textContent(), /^C1 flow/);
  await page.getByRole("button", { name: "Close plots" }).click();

  await choose("example", "surface");
  await page.waitForFunction(() => document.getElementById("modelname").textContent === "surface.inp");
  assert.equal(await page.locator("#timebar").isHidden(), true, "another model, not run yet");
  await page.getByRole("button", { name: "Forcing" }).click();
  await page.locator("#forcevalue").fill("0");
  await page.locator("#forceapply").click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Run model" }).click();
  await until(/^Run complete/);
  assert.equal(await page.locator("#timebar").isHidden(), false);
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

  // Water quality on EPA Example 1: a land use's buildup, a subcatchment's land uses (a total over
  // 100 % is refused) and a node's treatment (checked as it is typed), applied and run.
  await page.locator("#input").setInputFiles({ name: "example1.inp", mimeType: "text/plain", buffer: await readFile(new URL("./fixtures/example1.inp", import.meta.url)) });
  await page.waitForFunction(() => document.getElementById("modelname").textContent === "example1.inp");
  await choose("objkind", "landuse");
  await page.waitForFunction(() => [...document.getElementById("objid").options].some((o) => o.value === "Commercial"));
  await choose("objid", "Commercial");
  await page.getByRole("button", { name: "Edit buildup and washoff…" }).click();
  await page.getByLabel("Max. buildup", { exact: true }).fill("0.2");
  await page.getByRole("button", { name: "Save to model" }).click();
  await page.waitForFunction(() => document.getElementById("editnote").textContent.startsWith("1 edit"));
  await choose("objkind", "subcatchment");
  await choose("objid", "S4");
  await page.getByRole("button", { name: "Edit land uses and loadings…" }).click();
  await page.getByLabel("Undeveloped coverage", { exact: true }).fill("80");
  await page.getByRole("button", { name: "Save to model" }).click();
  await page.waitForFunction(() => /at most 100 %/.test(document.querySelector("#content .record-message")?.textContent || ""));
  await page.getByLabel("Undeveloped coverage", { exact: true }).fill("20");
  await page.getByRole("button", { name: "Save to model" }).click();
  await page.waitForFunction(() => document.getElementById("editnote").textContent.startsWith("2 edits"));
  await choose("objkind", "node");
  await choose("objid", "J1");
  await page.getByRole("button", { name: "Edit treatment…" }).click();
  const treat = page.getByLabel("TSS treatment", { exact: true });
  await treat.fill("R = FOO");
  await page.waitForFunction(() => /unknown identifier 'FOO'/.test(document.querySelector(".quality-verdict.bad")?.textContent || ""));
  await treat.fill("R = 0.3");
  await page.waitForFunction(() => document.querySelector(".quality-verdict.ok")?.textContent === "Checked");
  await page.getByRole("button", { name: "Save to model" }).click();
  await page.waitForFunction(() => document.getElementById("editnote").textContent.startsWith("3 edits"));
  await page.getByRole("button", { name: "Apply to model" }).click();
  await until(/^3 edits applied/);
  await page.getByRole("button", { name: "Edit INP" }).click();
  const qualityDeck = await page.locator("#content textarea").inputValue();
  // The writer keeps 17 significant digits: 0.2 is written 0.20000000000000001.
  assert.match(qualityDeck, /^Commercial\s+TSS\s+EXP\s+0\.20000000000000001\s/m);
  assert.match(qualityDeck, /^S4\s+Undeveloped\s+20\s*$/m);
  assert.match(qualityDeck, /^J1\s+TSS\s+R = 0\.3\s*$/m);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Run model" }).click();
  await until(/^Run complete/);
  // Climate: constant evaporation in dry periods only, applied and run. The engine refuses this
  // model for checkpoint sessions after initializing it; the run still completes.
  await page.locator("#input").setInputFiles({ name: "climate.inp", mimeType: "text/plain", buffer: await readFile(new URL("./fixtures/climate.inp", import.meta.url)) });
  await page.waitForFunction(() => document.getElementById("modelname").textContent === "climate.inp");
  await choose("objkind", "model");
  await page.getByRole("button", { name: "Edit climate…" }).click();
  await page.getByRole("tab", { name: "Evaporation" }).click();
  await page.getByLabel("Evaporation source", { exact: true }).selectOption("CONSTANT");
  await page.getByLabel("Constant evaporation", { exact: true }).fill("0.15");
  await page.getByLabel("Evaporate only in dry periods", { exact: true }).check();
  await page.getByRole("tab", { name: "Snowmelt" }).click();
  await page.getByLabel("ATI weight", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Save to model" }).click();
  await page.waitForFunction(() => /ATI weight: a fraction/.test(document.querySelector("#content .record-message")?.textContent || ""));
  await page.getByLabel("ATI weight", { exact: true }).fill("0.5");
  await page.getByRole("button", { name: "Save to model" }).click();
  await page.waitForFunction(() => document.getElementById("editnote").textContent.startsWith("1 edit"));
  await page.getByRole("button", { name: "Apply to model" }).click();
  await until(/^1 edit applied/);
  await page.getByRole("button", { name: "Edit INP" }).click();
  const climateDeck = await page.locator("#content textarea").inputValue();
  assert.match(climateDeck, /^CONSTANT\s+0\.14999999999999999\s*$/m); // 17 significant digits
  assert.match(climateDeck, /^DRY_ONLY\s+YES\s*$/m);
  assert.match(climateDeck, /^SNOWMELT\s+32\.5 0\.5 /m);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Run model" }).click();
  await until(/^Run complete/);
  // Transects: one in use keeps its name; its channel n is checked and saved, applied and run.
  await page.locator("#input").setInputFiles({ name: "channel.inp", mimeType: "text/plain", buffer: await readFile(new URL("./fixtures/channel.inp", import.meta.url)) });
  await page.waitForFunction(() => document.getElementById("modelname").textContent === "channel.inp");
  await choose("objkind", "transect");
  await page.waitForFunction(() => [...document.getElementById("objid").options].some((o) => o.value === "Upper"));
  await choose("objid", "Upper");
  await page.getByRole("button", { name: "Edit cross-section…" }).waitFor();
  assert.equal(await page.getByLabel("Name of the transect", { exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "Edit cross-section…" }).click();
  await page.getByLabel("Channel n", { exact: true }).fill("0");
  await page.getByRole("button", { name: "Save to model" }).click();
  await page.waitForFunction(() => /Channel n: a number greater than zero/.test(document.querySelector("#content .record-message")?.textContent || ""));
  await page.getByLabel("Channel n", { exact: true }).fill("0.03");
  await page.getByLabel("Point 2 elevation", { exact: true }).fill("7.5");
  await page.getByRole("button", { name: "Save to model" }).click();
  await page.waitForFunction(() => document.getElementById("editnote").textContent.startsWith("1 edit"));
  await page.getByRole("button", { name: "Apply to model" }).click();
  await until(/^1 edit applied/);
  await page.getByRole("button", { name: "Edit INP" }).click();
  const channelDeck = await page.locator("#content textarea").inputValue();
  assert.match(channelDeck, /^NC 0\.059999999999999998 0\.059999999999999998 0\.029999999999999999$/m);
  assert.match(channelDeck, /^GR 10 0 7\.5 20 /m);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Run model" }).click();
  await until(/^Run complete/);
  // LID controls: a bio-retention cell's soil and a subcatchment's placements (0 units refused),
  // applied and run.
  await page.locator("#input").setInputFiles({ name: "lids.inp", mimeType: "text/plain", buffer: await readFile(new URL("./fixtures/lids.inp", import.meta.url)) });
  await page.waitForFunction(() => document.getElementById("modelname").textContent === "lids.inp");
  await choose("objkind", "lid");
  await page.waitForFunction(() => [...document.getElementById("objid").options].some((o) => o.value === "UBC"));
  await choose("objid", "UBC");
  await page.getByRole("button", { name: "Edit layers…" }).click();
  assert.equal(await page.getByLabel("LID type", { exact: true }).isDisabled(), true);
  await page.getByLabel("Soil thickness", { exact: true }).fill("18");
  await page.getByRole("button", { name: "Save to model" }).click();
  await page.waitForFunction(() => document.getElementById("editnote").textContent.startsWith("1 edit"));
  await choose("objkind", "subcatchment");
  await choose("objid", "A");
  await page.getByRole("button", { name: "Edit LID usage…" }).click();
  await page.getByLabel("Row 1 units", { exact: true }).fill("0");
  await page.getByRole("button", { name: "Save to model" }).click();
  await page.waitForFunction(() => /Row 1: the number of units is a whole number/.test(document.querySelector("#content .record-message")?.textContent || ""));
  await page.getByLabel("Row 1 units", { exact: true }).fill("3");
  await page.getByRole("button", { name: "Save to model" }).click();
  await page.waitForFunction(() => document.getElementById("editnote").textContent.startsWith("2 edits"));
  await page.getByRole("button", { name: "Apply to model" }).click();
  await until(/^2 edits applied/);
  await page.getByRole("button", { name: "Edit INP" }).click();
  const lidDeck = await page.locator("#content textarea").inputValue();
  assert.match(lidDeck, /^UBC\s+SOIL\s+18 /m);
  assert.match(lidDeck, /^A\s+UBC\s+3 20 /m);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Run model" }).click();
  await until(/^Run complete/);
  // Selection (V1): a box over the network example takes its 4 nodes and 3 links and the inspector
  // shows one; Alt + box removes them; a pick in the inspector selects it on the map; Esc clears.
  await choose("example", "network");
  await page.waitForFunction(() => document.getElementById("modelname").textContent === "network.inp");
  await page.waitForTimeout(1500); // the editing session opens the model
  const map = await page.locator("#plot").boundingBox();
  const sweep = async (modifiers = []) => {
    for (const m of modifiers) await page.keyboard.down(m);
    await page.mouse.move(map.x + 10, map.y + 10);
    await page.mouse.down();
    await page.mouse.move(map.x + map.width - 10, map.y + map.height - 10, { steps: 5 });
    await page.mouse.up();
    for (const m of modifiers) await page.keyboard.up(m);
  };
  await page.locator("#tool-box").click();
  await sweep();
  assert.equal(await page.locator("#probe").textContent(), "7 selected · 4 nodes, 3 links");
  await page.waitForFunction(() => ["node", "link"].includes(document.getElementById("objkind").value));
  await sweep(["Alt"]);
  assert.equal(await page.locator("#probe").textContent(), "Select an object to inspect");
  await page.locator("#tool-select").click();
  await choose("objkind", "link");
  await choose("objid", "C2");
  await page.waitForFunction(() => document.getElementById("probe").textContent === "C2 · conduit");
  await page.locator("#plot").click({ position: { x: 5, y: 5 }, modifiers: ["Shift"] });
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#probe").textContent(), "Select an object to inspect");
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
  // Side panels: drag the layers panel wider, resize the inspector from the keyboard and reset it
  // by double-click, collapse the layers panel from its header and reopen it from the rail; the
  // width survives a reload.
  const width = (id) => page.evaluate((id) => document.getElementById(id).getBoundingClientRect().width, id);
  const leftBar = page.getByRole("separator", { name: "Resize layers panel" });
  const grip = await leftBar.boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 100, grip.y + grip.height / 2, { steps: 5 });
  await page.mouse.up();
  assert.equal(await width("left"), 372);
  const rightBar = page.getByRole("separator", { name: "Resize inspector" });
  await rightBar.focus();
  await page.keyboard.press("ArrowLeft"); // toward the map: wider
  assert.equal(await width("right"), 316);
  await rightBar.dblclick();
  assert.equal(await width("right"), 300);
  await page.getByRole("button", { name: "Collapse layers panel" }).click();
  assert.equal(await page.locator("#left").isHidden(), true);
  assert.equal(await leftBar.isHidden(), true);
  await page.locator("#raillayers").click();
  assert.equal(await width("left"), 372);
  await page.reload();
  await page.waitForFunction(() => document.getElementById("modelname").textContent.length > 0);
  assert.equal(await width("left"), 372);
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
