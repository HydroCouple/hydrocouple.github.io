// [2D_OPTIONS] cards (interaction phase E3d-1): the desktop 2D page's groups, values as the engine holds
// them, the desktop's ranges (the engine takes any number), the Coriolis/turbulence rule, blank
// specials, check boxes with their own tokens, the written deck reopening, and undo.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import create from "../vendor/engine/openswmm_engine.js";
import { ModelSession } from "../model.mjs";
import { groupValues } from "../properties.mjs";

const decoder = new TextDecoder();
async function open(text, name = "m.inp") {
  const session = new ModelSession(await create());
  session.open({ name, entry: name, inputs: { [name]: typeof text === "string" ? new TextEncoder().encode(text) : text }, anchor: null, split: false });
  return session;
}
const surface = () => readFile(new URL("../examples/surface.inp", import.meta.url));
const card = (s, title) => s.groups("options2d", null).find((g) => g.title === title);
const values = (s, title) => groupValues(card(s, title));
const set = (s, title, changes) => s.setGroup("options2d", null, card(s, title).key, { ...values(s, title), ...changes });
function lines(text, section) {
  const out = [];
  let on = false;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith("[")) on = t.toUpperCase() === section;
    else if (on && t && !t.startsWith(";;")) out.push(t.split(/\s+/).join(" "));
  }
  return out;
}

test("a model without a mesh has no 2D cards, only a note", async () => {
  const s = await open(await readFile(new URL("./fixtures/example1.inp", import.meta.url)));
  const g = s.groups("options2d", null);
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].fields, []);
  assert.match(g[0].note, /no 2D surface/);
  assert.throws(() => s.setGroup("options2d", null, "2d-0", {}), /no 2D surface/);
});

test("the desktop's groups and values; ranges, choices, checks, blanks and the Coriolis rule; written and reopened; undo", async () => {
  const s = await open(await surface());
  const titles = s.groups("options2d", null).map((g) => g.title);
  assert.deepEqual(titles, ["Time stepping", "Explicit marcher", "Optional momentum physics", "Depth thresholds", "Cell closure", "1D ↔ 2D coupling", "Processes", "Groundwater", "2D results", "Compute backend"]);
  assert.equal(values(s, "Time stepping").MAX_TIMESTEP, 10);
  assert.deepEqual([values(s, "Explicit marcher").MOMENTUM_EQUATION, values(s, "Explicit marcher").ADVECTION], ["FULL_SWE", "NO"]);
  assert.equal(card(s, "Compute backend").fields[0].readonly, true);
  // The engine takes any number: the card keeps the desktop's range.
  assert.throws(() => set(s, "Depth thresholds", { DRY_DEPTH: -1 }), /Dry depth threshold must be at least 0/);
  assert.throws(() => set(s, "Explicit marcher", { LTS_TIERS: 2.5 }), /LTS tiers is a whole number/);
  assert.throws(() => set(s, "Explicit marcher", { CFL_NUMBER: 2 }), /CFL number must be at most 1/);
  const marcher = values(s, "Explicit marcher");
  set(s, "Depth thresholds", { DRY_DEPTH: 0.002 });
  set(s, "Explicit marcher", { MOMENTUM_EQUATION: "LOCAL_INERTIAL", ADVECTION: "YES" });
  // Coriolis needs full SWE and one tier, from either card.
  assert.throws(() => set(s, "Optional momentum physics", { CORIOLIS: "LATITUDE", CORIOLIS_LATITUDE: 45 }), /require full shallow-water equations and one timestep tier/);
  set(s, "Explicit marcher", { MOMENTUM_EQUATION: "FULL_SWE", LTS_TIERS: 1, ADVECTION: "NO" });
  set(s, "Optional momentum physics", { CORIOLIS: "LATITUDE", CORIOLIS_LATITUDE: 45 });
  assert.throws(() => set(s, "Explicit marcher", { LTS_TIERS: 4 }), /one timestep tier/);
  // Blanks: the rim band's pond default; check boxes with their own tokens.
  assert.throws(() => set(s, "1D ↔ 2D coupling", { COUPLING_RIM_BAND: -1 }), /Rim band must be at least 0/);
  set(s, "1D ↔ 2D coupling", { COUPLING_RIM_BAND: "", COUPLING_AREA: "YES" });
  assert.equal(s.solver.options.ext.get("COUPLING_AREA"), "AUTO");
  assert.equal(values(s, "1D ↔ 2D coupling").COUPLING_RIM_BAND, "");
  // Results: variables by name, steps HH:MM:SS.
  assert.throws(() => set(s, "2D results", { REPORT_2D_VARIABLES: "depth nope" }), /Unknown 2D result variable NOPE/);
  assert.throws(() => set(s, "2D results", { REPORT_2D_STEP: "ten minutes" }), /2D report step is HH:MM:SS/);
  set(s, "2D results", { REPORT_2D_VARIABLES: "depth, velocity", REPORT_2D_STEP: "00:10:00" });
  assert.equal(values(s, "2D results").REPORT_2D_VARIABLES, "DEPTH VELOCITY");
  const deck = decoder.decode(s.writeAll()["m.inp"]);
  const opts = lines(deck, "[2D_OPTIONS]");
  for (const row of ["DRY_DEPTH 0.002", "CORIOLIS LATITUDE", "CORIOLIS_LATITUDE 45", "LTS_TIERS 1", "COUPLING_AREA AUTO", "REPORT_2D_STEP 00:10:00"]) assert.ok(opts.includes(row), row + " in " + opts.join(" | "));
  assert.ok(!lines(deck, "[OPTIONS]").some((r) => /^(DRY_DEPTH|CORIOLIS|COUPLING_|REPORT_2D|LTS_TIERS)/.test(r)), "no 2D key in [OPTIONS]");
  const t = await open(deck);
  assert.deepEqual([values(t, "Depth thresholds").DRY_DEPTH, values(t, "Optional momentum physics").CORIOLIS, values(t, "2D results").REPORT_2D_STEP], [0.002, "LATITUDE", "00:10:00"]);
  // Undo: each card back as it was shown.
  set(s, "Optional momentum physics", { CORIOLIS: "OFF", CORIOLIS_LATITUDE: "" });
  s.setGroup("options2d", null, card(s, "Explicit marcher").key, marcher);
  assert.deepEqual(values(s, "Explicit marcher"), marcher);
});
