// 2D groundwater (interaction phase E3d-2c): [2D_AQUIFER_OPTIONS] and [GW_TRANSPORT_OPTIONS] cards with
// the desktop's ranges; aquifer rows (extra properties ride along), node beds (replaced atomically),
// links; transport parameters, sorption (an unknown species would make the deck unopenable) and
// initial quality — written, reopened, undo.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import create from "../vendor/engine/openswmm_engine.js";
import { ModelSession } from "../model.mjs";
import { groupValues } from "../properties.mjs";

const decoder = new TextDecoder();
async function open(text) {
  const session = new ModelSession(await create());
  session.open({ name: "m.inp", entry: "m.inp", inputs: { "m.inp": new TextEncoder().encode(text) }, anchor: null, split: false });
  return session;
}
const deck = async () => decoder.decode(await readFile(new URL("../examples/coupled.inp", import.meta.url))) + "\n[POLLUTANTS]\nTSS MG/L 0 0 0 0 NO * 0 0 0\n";
function lines(text, section) {
  const out = [];
  let on = false;
  for (const line of text.split(/\r?\n/)) {
    const u = line.trim();
    if (u.startsWith("[")) on = u.toUpperCase() === section;
    else if (on && u && !u.startsWith(";;")) out.push(u.split(/\s+/).join(" "));
  }
  return out;
}
const card = (s, kind, title) => s.groups(kind, null).find((g) => g.title === title);
const set = (s, kind, title, changes) => s.setGroup(kind, null, card(s, kind, title).key, { ...groupValues(card(s, kind, title)), ...changes });

test("groundwater options: the desktop's groups and ranges, process options together, written, reopened, undo", async () => {
  const s = await open(await deck());
  assert.deepEqual(s.groups("gw2d", null).map((g) => g.title), ["Options", "Groundwater time stepping", "Groundwater processes"]);
  assert.deepEqual(s.groups("gwtransport2d", null).map((g) => g.title).length, 2);
  const options = groupValues(card(s, "gw2d", "Options"));
  assert.equal(options.SOIL_CHAR, "RUSSO");
  assert.throws(() => set(s, "gw2d", "Options", { M_LAYERS: 1 }), /σ layers must be at least 2/);
  set(s, "gw2d", "Options", { M_LAYERS: 3, DUNNE: "NO" });
  set(s, "gw2d", "Groundwater time stepping", { GW_CLOCK: "INDEPENDENT", GW_BASE_STEP: "", GW_MAX_STEP: 600 });
  set(s, "gw2d", "Groundwater processes", { LINK_SEEPAGE: "TWO_WAY", WILTING_SUCTION: 10 });
  const tr = s.groups("gwtransport2d", null);
  assert.throws(() => s.setGroup("gwtransport2d", null, tr[0].key, { ...groupValues(tr[0]), UNSAT_TRANSPORT: "LAYERED" }), /needs the SIGMA closure/);
  s.setGroup("gwtransport2d", null, tr[0].key, { ...groupValues(tr[0]), TRANSPORT_AGE: "NO" });
  const out = decoder.decode(s.writeAll()["m.inp"]);
  const opts = lines(out, "[2D_AQUIFER_OPTIONS]");
  for (const row of ["M_LAYERS 3", "DUNNE NO", "GW_CLOCK INDEPENDENT", "LINK_SEEPAGE TWO_WAY"]) assert.ok(opts.includes(row), row + " in " + opts.join(" | "));
  assert.ok(lines(out, "[GW_TRANSPORT_OPTIONS]").includes("TRANSPORT_AGE NO"));
  const t = await open(out);
  assert.deepEqual([groupValues(card(t, "gw2d", "Options")).M_LAYERS, groupValues(card(t, "gw2d", "Groundwater time stepping")).GW_BASE_STEP, groupValues(card(t, "gw2d", "Groundwater processes")).WILTING_SUCTION], [3, "", 10]);
  s.setGroup("gw2d", null, card(s, "gw2d", "Options").key, options); // undo
  assert.deepEqual(groupValues(card(s, "gw2d", "Options")), options);
});

test("aquifer rows, node beds and links: checked, written, reopened, extras kept, undo", async () => {
  const s = await open(await deck());
  const refuse = (name, rows, re) => assert.throws(() => s.setScopedRows(name, rows), re);
  const row = { ks: 0.5, zs: 3, thetaS: 0.4, thetaR: 0.05, alpha: 2, hg0: "", cLoss: "", soil: "", closure: "" };
  refuse("aquifer", [{ scope: "GLOBAL", target: "", values: { ...row, thetaR: 0.5 } }], /residual θr is 0 or more and below θs/);
  refuse("aquifer", [{ scope: "GLOBAL", target: "", values: { ...row, ks: 0 } }], /Ks must be above 0/);
  const before = s.setScopedRows("aquifer", [{ scope: "GLOBAL", target: "", values: row }, { scope: "CELL", target: "1", values: { ...row, soil: "GARDNER", closure: "SIGMA", hg0: 1 } }]);
  assert.deepEqual(before, []);
  // A property the table does not show rides along when the rows are replaced.
  s.solver.groundwater2d.setRowProperty(0, "N", 2.2);
  s.setScopedRows("aquifer", s.scopedRows("aquifer").rows);
  assert.equal(s.solver.groundwater2d.rowProperty(0, "N"), 2.2);
  refuse("nodeBeds", [{ values: { node: "NOPE", cell: "", kc: 0, dc: 0, area: 0, exchange: "YES" } }], /choose the node/);
  refuse("nodeBeds", [{ values: { node: "J1", cell: 99, kc: 0, dc: 0, area: 0, exchange: "YES" } }], /a cell is a number from 1 to/);
  s.setScopedRows("nodeBeds", [{ values: { node: "j1", cell: "", kc: 0.1, dc: 0.5, area: 0, exchange: "YES" } }]);
  s.setScopedRows("aquiferLinks", [{ values: { link: "C1", kc: 0, dc: 0, exchange: "YES" } }]);
  const out = decoder.decode(s.writeAll()["m.inp"]);
  assert.equal(lines(out, "[2D_AQUIFER]").length, 2);
  assert.ok(lines(out, "[2D_AQUIFER_NODE]")[0].startsWith("J1 AUTO"), lines(out, "[2D_AQUIFER_NODE]").join(" | "));
  assert.deepEqual(lines(out, "[2D_AQUIFER_LINKS]").map((r) => r.split(" ")[0]), ["C1"]);
  const t = await open(out);
  const rows = t.scopedRows("aquifer").rows;
  assert.deepEqual([rows[1].values.soil, rows[1].values.closure, rows[1].values.hg0, rows[0].values["x:N"]], ["GARDNER", "SIGMA", 1, 2.2]);
  assert.deepEqual(t.scopedRows("nodeBeds").rows.map((r) => [r.values.node, r.values.cell, r.values.kc]), [["J1", "", 0.1]]);
  s.setScopedRows("aquifer", before); // undo
  assert.deepEqual(s.scopedRows("aquifer").rows, []);
});

test("groundwater transport tables: parameters, sorption (species checked), initial quality; reopened; undo", async () => {
  const s = await open(await deck());
  const p = { rhoS: 2650, cS: 880, lambdaS: 2, aS: 0, alphaL: 1, alphaT: 0.1, dM: 1e-9, dV: 1e-9, geoFlux: 0.065 };
  assert.throws(() => s.setScopedRows("gwParams", [{ scope: "GLOBAL", target: "", values: { ...p, rhoS: -1 } }]), /grain density cannot be negative/);
  s.setScopedRows("gwParams", [{ scope: "GLOBAL", target: "", values: p }]);
  // The engine takes an unknown species and then cannot open the deck it wrote: refused here.
  assert.throws(() => s.setScopedRows("gwSorption", [{ scope: "GLOBAL", target: "", values: { species: "NOPE", kd: 0.5, decay: "" } }]), /choose a species \(TSS\)/);
  const before = s.setScopedRows("gwSorption", [{ scope: "GLOBAL", target: "", values: { species: "tss", kd: 0.5, decay: "" } }]);
  s.setScopedRows("gwInitialQuality", [{ scope: "GLOBAL", target: "", values: { zone: "SAT", species: "TSS", value: 2 } }, { scope: "GLOBAL", target: "", values: { zone: "UNSAT", species: "TSS", value: 3 } }]);
  const out = decoder.decode(s.writeAll()["m.inp"]);
  assert.deepEqual(lines(out, "[GW_SORPTION]"), ["* TSS 0.5 -"]);
  assert.deepEqual(lines(out, "[GW_INITIAL_QUALITY]"), ["* SAT TSS 2", "* UNSAT TSS 3"]);
  const t = await open(out);
  assert.deepEqual(t.scopedRows("gwSorption").rows, [{ scope: "GLOBAL", target: "", values: { species: "TSS", kd: 0.5, decay: "" } }]);
  assert.equal(t.scopedRows("gwParams").rows.length, 1);
  s.setScopedRows("gwSorption", before); // undo
  assert.deepEqual(s.scopedRows("gwSorption").rows, []);
});
