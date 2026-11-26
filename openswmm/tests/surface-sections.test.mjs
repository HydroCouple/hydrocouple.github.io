// Scoped 2D section rows (interaction phase E3d-2): 2D land-use coverage, initial buildup and curb
// length at all cells, a tag or one cell — checked (names, sums, scopes) before the engine takes them,
// written and reopened, and put back (undo).
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import create from "../vendor/engine/openswmm_engine.js";
import { ModelSession } from "../model.mjs";

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
  return text + "\n[POLLUTANTS]\nTSS MG/L 0 0 0 0 NO * 0 0 0\n\n[LANDUSES]\nURBAN 0 0 0\nPARK 0 0 0\n";
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
