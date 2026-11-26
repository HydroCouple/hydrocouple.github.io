// Scoped 2D section rows (interaction phase E3d-2): 2D land-use coverage, initial buildup and curb
// length at all cells, a tag or one cell — checked (names, sums, scopes) before the engine takes them,
// written and reopened, and put back (undo).
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import create from "../vendor/engine/openswmm_engine.js";
import { ModelSession } from "../model.mjs";
import { groupValues } from "../properties.mjs";

const decoder = new TextDecoder();
async function open(text, name = "m.inp") {
  const session = new ModelSession(await create());
  session.open({ name, entry: name, inputs: { [name]: new TextEncoder().encode(text) }, anchor: null, split: false });
  return session;
}
/** The surface example with two land uses and a pollutant, its first cell tagged ROAD. */
async function deck() {
  let text = decoder.decode(await readFile(new URL("../examples/surface.inp", import.meta.url)));
  text = text.replace(/(\[2D_TRIANGLES\][^\n]*\n(?:;[^\n]*\n)*)([^\n;\[]+)\n/, (m, head, first) => head + first.trim().split(/\s+/).slice(0, 4).concat(["0", "ROAD"]).join(" ") + "\n");
  return text + "\n[POLLUTANTS]\nTSS MG/L 0 0 0 0 NO * 0 0 0\n\n[LANDUSES]\nURBAN 0 0 0\nPARK 0 0 0\n\n[SNOWPACKS]\nSP1 PLOWABLE 0.001 0.001 32.0 0.10 0.00 0.00 0.0\n";
}

test("2D coverage, buildup and curb length: scopes, checks, written, reopened, undo", async () => {
  const s = await open(await deck());
  const cov = s.scopedRows("coverage");
  assert.deepEqual(cov.columns.map((c) => c.key), ["URBAN", "PARK"]);
  assert.deepEqual(cov.tags, ["ROAD"]);
  assert.deepEqual(cov.rows, []);
  const refuse = (name, rows, re) => assert.throws(() => s.setScopedRows(name, rows), re);
  refuse("coverage", [{ scope: "GLOBAL", target: "", values: { URBAN: 70, PARK: 40 } }], /cover 110 %, more than 100 %/);
  refuse("coverage", [{ scope: "TAG", target: "SIDEWALK", values: { URBAN: 10 } }], /no cell has the tag SIDEWALK \(tags: ROAD\)/);
  refuse("coverage", [{ scope: "CELL", target: "99", values: { URBAN: 10 } }], /a cell is a number from 1 to 2/);
  refuse("coverage", [{ scope: "GLOBAL", target: "", values: {} }], /cover at least one land use/);
  refuse("coverage", [{ scope: "GLOBAL", target: "", values: { URBAN: 10 } }, { scope: "GLOBAL", target: "", values: { PARK: 10 } }], /repeats an earlier row/);
  refuse("loading", [{ scope: "GLOBAL", target: "", values: { species: "NOPE", value: 1 } }], /choose a pollutant/);
  refuse("curb", [{ scope: "GLOBAL", target: "", values: { length: 0 } }], /curb length must be above 0/);
  const before = s.setScopedRows("coverage", [{ scope: "GLOBAL", target: "", values: { URBAN: 60, PARK: 40 } }, { scope: "TAG", target: "road", values: { URBAN: 100, PARK: "" } }]);
  assert.deepEqual(before, []);
  s.setScopedRows("loading", [{ scope: "CELL", target: "2", values: { species: "tss", value: 5 } }]);
  s.setScopedRows("curb", [{ scope: "TAG", target: "ROAD", values: { length: 120 } }]);
  const written = decoder.decode(s.writeAll()["m.inp"]);
  const t = await open(written);
  assert.deepEqual(t.scopedRows("coverage").rows, [{ scope: "GLOBAL", target: "", values: { URBAN: 60, PARK: 40 } }, { scope: "TAG", target: "ROAD", values: { URBAN: 100 } }]);
  assert.deepEqual(t.scopedRows("loading").rows, [{ scope: "CELL", target: "2", values: { species: "TSS", value: 5 } }]);
  assert.deepEqual(t.scopedRows("curb").rows, [{ scope: "TAG", target: "ROAD", values: { length: 120 } }]);
  // Undo: the rows there were.
  s.setScopedRows("coverage", before);
  assert.deepEqual(s.scopedRows("coverage").rows, []);
});

test("a model without a mesh has no scoped 2D sections", async () => {
  const s = await open(decoder.decode(await readFile(new URL("./fixtures/example1.inp", import.meta.url))));
  assert.throws(() => s.scopedRows("coverage"), /no 2D surface/);
});

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

test("2D initial and bed quality: species checked (the engine takes any name), scopes, written, reopened, undo", async () => {
  const s = await open(await deck());
  const q = s.scopedRows("initQuality");
  assert.deepEqual(q.columns[0].choices, ["TSS"]);
  assert.throws(() => s.setScopedRows("initQuality", [{ scope: "GLOBAL", target: "", values: { species: "NOPE", value: 1 } }]), /choose a species \(TSS\)/);
  assert.throws(() => s.setScopedRows("initQuality", [{ scope: "GLOBAL", target: "", values: { species: "TSS", value: -1 } }]), /cannot be negative/);
  const before = s.setScopedRows("initQuality", [{ scope: "GLOBAL", target: "", values: { species: "TSS", value: 1.5 } }, { scope: "TAG", target: "road", values: { species: "tss", value: 2 } }, { scope: "CELL", target: "2", values: { species: "TSS", value: 3 } }]);
  s.setScopedRows("bedQuality", [{ scope: "GLOBAL", target: "", values: { species: "TSS", value: 4 } }]);
  const out = decoder.decode(s.writeAll()["m.inp"]);
  assert.deepEqual(lines(out, "[2D_INITIAL_QUALITY]"), ["* TSS 1.5", "TAG ROAD TSS 2", "CELL 2 TSS 3"]);
  assert.deepEqual(lines(out, "[2D_INITIAL_BED_QUALITY]"), ["* TSS 4"]);
  assert.equal((await open(out)).scopedRows("initQuality").rows.length, 3);
  // Water age and temperature join the species when the model carries them.
  s.solver.options.set("WATER_AGE", "YES");
  s.solver.options.set("HEAT_TRANSPORT", "YES");
  assert.deepEqual(s.scopedRows("initQuality").columns[0].choices, ["TSS", "__WATER_AGE__", "__TEMPERATURE__"]);
  s.setScopedRows("initQuality", [{ scope: "GLOBAL", target: "", values: { species: "__TEMPERATURE__", value: 12 } }]);
  assert.equal(s.scopedRows("initQuality").rows[0].values.species, "__TEMPERATURE__");
  s.setScopedRows("initQuality", before);
  assert.deepEqual(s.scopedRows("initQuality").rows, []);
});

test("2D infiltration defaults: all cells or a tag, each method's parameters with legacy rules, written, reopened, undo", async () => {
  const s = await open(await deck());
  const d = s.scopedRows("infilDefaults");
  assert.deepEqual(Object.keys(d.scopes), ["GLOBAL", "TAG"]);
  const refuse = (rows, re) => assert.throws(() => s.setScopedRows("infilDefaults", rows), re);
  const horton = { method: "HORTON", p1: 3, p2: 0.5, p3: 4, p4: 7, p5: "" };
  refuse([{ scope: "CELL", target: "1", values: horton }], /choose all cells, tag/);
  refuse([{ scope: "GLOBAL", target: "", values: { ...horton, p1: 0.1 } }], /maximum rate \(P1\) cannot be below the minimum rate/);
  refuse([{ scope: "GLOBAL", target: "", values: { method: "GREEN_AMPT", p1: 3.5, p2: 0, p3: 0.26 } }], /conductivity \(P2\) must be above 0/);
  refuse([{ scope: "GLOBAL", target: "", values: { method: "CURVE_NUMBER", p1: 80, p2: 1, p3: 7 } }], /does not use P2/);
  refuse([{ scope: "GLOBAL", target: "", values: { method: "CURVE_NUMBER", p1: 120, p3: 7 } }], /between 10 and 99/);
  const before = s.setScopedRows("infilDefaults", [{ scope: "GLOBAL", target: "", values: horton }, { scope: "TAG", target: "ROAD", values: { method: "CURVE_NUMBER", p1: 80, p3: 7 } }]);
  const out = decoder.decode(s.writeAll()["m.inp"]);
  const rows = lines(out, "[2D_INFILTRATION_DEFAULTS]");
  assert.ok(rows.some((r) => r.startsWith("* HORTON 3 0.5 4 7")) && rows.includes("ROAD CURVE_NUMBER 80 - 7"), rows.join(" | "));
  const back = (await open(out)).scopedRows("infilDefaults").rows;
  assert.deepEqual(back.map((r) => [r.scope, r.target, r.values.method, r.values.p1, r.values.p3]), [["GLOBAL", "", "HORTON", 3, 4], ["TAG", "ROAD", "CURVE_NUMBER", 80, 7]]);
  s.setScopedRows("infilDefaults", before);
  assert.deepEqual(s.scopedRows("infilDefaults").rows, []);
});

test("2D snow rows and options, 2D frozen ground: checked, written, reopened, undo", async () => {
  const s = await open(await deck());
  const cards = s.groups("snow2d", null);
  assert.deepEqual(cards.map((g) => g.key), ["snowOptions", "frost2d"]);
  s.setGroup("snow2d", null, "snowOptions", { mode: "YES", step: 1800 });
  const sn = s.scopedRows("snow");
  assert.deepEqual(sn.columns[0].choices, ["NONE", "SP1"]);
  const refuse = (rows, re) => assert.throws(() => s.setScopedRows("snow", rows), re);
  refuse([{ scope: "GLOBAL", target: "", values: { pack: "NOPE" } }], /choose a snowpack/);
  refuse([{ scope: "GLOBAL", target: "", values: { pack: "SP1", FC: 2 } }], /forest fraction is between 0 and 1/);
  refuse([{ scope: "GLOBAL", target: "", values: { pack: "SP1", SLOPE: 5 } }], /give both slope and aspect/);
  const before = s.setScopedRows("snow", [{ scope: "GLOBAL", target: "", values: { pack: "sp1", FC: 0.2 } }, { scope: "TAG", target: "ROAD", values: { pack: "SP1", SLOPE: 5, ASPECT: 180 } }, { scope: "CELL", target: "1", values: { pack: "NONE" } }]);
  s.setGroup("snow2d", null, "frost2d", { ...groupValues(s.groups("snow2d", null)[1]), row: "own", thickness: 0.2 });
  const out = decoder.decode(s.writeAll()["m.inp"]);
  assert.deepEqual(lines(out, "[2D_SNOW_OPTIONS]"), ["SNOWMELT YES", "SNOW_STEP 1800"]);
  // The engine quotes tags and names and keeps 17 digits.
  assert.deepEqual(lines(out, "[2D_SNOW_DEFAULTS]").map((r) => r.replace(/"/g, "")).sort(), ["* SNOWPACK SP1 FC 0.20000000000000001", "ROAD SNOWPACK SP1 SLOPE 5 ASPECT 180"]);
  assert.ok(lines(out, "[2D_SNOW]").some((r) => /^CELL 1 SNOWPACK "?NONE"?$/.test(r)), lines(out, "[2D_SNOW]").join(" | "));
  assert.ok(lines(out, "[2D_FROZEN_GROUND]")[0].startsWith("* 0.2 "));
  const t = await open(out);
  assert.deepEqual(t.scopedRows("snow").rows.map((r) => [r.scope, r.target, r.values.pack]), [["GLOBAL", "", "SP1"], ["TAG", "ROAD", "SP1"], ["CELL", "1", "NONE"]]);
  assert.deepEqual(groupValues(t.groups("snow2d", null)[0]), { mode: "YES", step: 1800 });
  // Undo: the rows there were; the options stay.
  s.setScopedRows("snow", before);
  assert.deepEqual(s.scopedRows("snow").rows, []);
  assert.deepEqual(groupValues(s.groups("snow2d", null)[0]), { mode: "YES", step: 1800 });
  s.setGroup("snow2d", null, "frost2d", { ...groupValues(s.groups("snow2d", null)[1]), row: "" });
  assert.equal(s.solver.frozenGroundRows(true)["*"], undefined);
});
