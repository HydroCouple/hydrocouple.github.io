// Reactions and the ARD transport tables (interaction phase E3d-2c): the .rxn system checked whole,
// saved in model.rxn (registered on the first system, removed again by its undo) or kept in a deck
// that embeds it; conduit dispersion, boundaries and sources (reaction species only) saved in the
// transport component's <model>.ard; written files reopen; undo.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import create from "../vendor/engine/openswmm_engine.js";
import { ModelSession } from "../model.mjs";

const decoder = new TextDecoder();
const example1 = () => readFile(new URL("./fixtures/example1.inp", import.meta.url), "utf8");
async function open(text, extra = {}) {
  const session = new ModelSession(await create());
  const inputs = { "m.inp": new TextEncoder().encode(text) };
  for (const [n, b] of Object.entries(extra)) inputs[n] = typeof b === "string" ? new TextEncoder().encode(b) : b;
  session.open({ name: "m.inp", entry: "m.inp", inputs, anchor: null, split: false });
  return session;
}
const rxn = "[REACTION_OPTIONS]\nSOLVER RK5\n[REACTION_SPECIES]\nBULK X MG\n[REACTION_PIPES]\nRATE X -0.1*X\n[REACTION_TANKS]\nRATE X 0\n";

test("reactions: checked whole, model.rxn registered on the first system and saved with Apply, undo removes it", async () => {
  const s = await open(await example1());
  const before = s.reactions();
  assert.deepEqual([before.text, before.species, before.registered, before.embedded], ["", [], false, false]);
  assert.equal(s.checkReactions("[REACTION_SPECIES]\nBULK X\n").valid, false);
  assert.throws(() => s.setReactions("[REACTION_SPECIES]\nBULK X\n"), /BULK\|WALL name units/);
  assert.equal(s.reactions().registered, false, "a refusal registers nothing");
  s.setReactions(rxn);
  assert.deepEqual([s.reactions().species, s.reactions().registered], [["X"], true]);
  const files = s.writeAll();
  assert.deepEqual(Object.keys(files).sort(), ["m.inp", "model.rxn"]);
  assert.deepEqual((await open(decoder.decode(files["m.inp"]), { "model.rxn": files["model.rxn"] })).reactions().species, ["X"]);
  s.setReactions(null, before); // undo
  assert.deepEqual([s.reactions().species, s.reactions().registered], [[], false]);
  assert.deepEqual(Object.keys(s.writeAll()), ["m.inp"]);
});

test("reactions embedded in the deck stay there: no component", async () => {
  const s = await open((await example1()) + "\n" + rxn);
  assert.equal(s.reactions().embedded, true);
  s.setReactions(rxn.replace("-0.1*X", "-0.2*X"));
  assert.equal(s.reactions().registered, false);
  const files = s.writeAll();
  assert.deepEqual(Object.keys(files), ["m.inp"]);
  assert.match(decoder.decode(files["m.inp"]), /-0\.2\*X/);
});

test("ARD tables: dispersion, boundaries and sources of reaction species; <model>.ard written and reopened; undo", async () => {
  const s = await open(await example1());
  const refuse = (name, rows, re) => assert.throws(() => s.setScopedRows(name, rows), re);
  refuse("ardDispersion", [{ values: { conduit: "NOPE", value: 1 } }], /choose a conduit/);
  refuse("ardDispersion", [{ values: { conduit: "C1", value: -1 } }], /coefficient is 0 or more/);
  refuse("ardBoundaries", [{ values: { element: "J1", species: "TSS", from: "VALUE", value: 5 } }], /reaction species \(define them under Reactions\)/);
  s.setReactions(rxn);
  refuse("ardBoundaries", [{ values: { element: "J1", species: "X", from: "VALUE", value: -5 } }], /cannot be negative/);
  refuse("ardBoundaries", [{ values: { element: "J1", species: "X", from: "TIMESERIES", series: "NOPE" } }], /choose the time series/);
  refuse("ardSources", [{ values: { element: "J1", species: "X", from: "VALUE", value: 1 } }], /choose the conduit/);
  refuse("ardBoundaries", [{ values: { element: "J1", species: "X", from: "VALUE", value: 1 } }, { values: { element: "j1", species: "x", from: "VALUE", value: 2 } }], /repeats an earlier row/);
  const before = s.setScopedRows("ardDispersion", [{ values: { conduit: "c1", value: 0.5 } }]);
  assert.deepEqual(before, []);
  s.setScopedRows("ardBoundaries", [{ values: { element: "J1", species: "X", from: "VALUE", value: 5 } }, { values: { element: "J2", species: "x", from: "TIMESERIES", series: "2-yr" } }]);
  s.setScopedRows("ardSources", [{ values: { element: "C2", species: "X", from: "VALUE", value: -0.1 } }]);
  const files = s.writeAll();
  assert.deepEqual(Object.keys(files).sort(), ["m.ard", "m.inp", "model.rxn"]);
  const ard = decoder.decode(files["m.ard"]);
  for (const sec of ["[CONDUIT_DISPERSION]", "[TRANSPORT_BOUNDARIES]", "[TRANSPORT_SOURCES]"]) assert.ok(ard.includes(sec), sec + " in " + ard);
  const t = await open(decoder.decode(files["m.inp"]), { "m.ard": files["m.ard"], "model.rxn": files["model.rxn"] });
  assert.deepEqual(t.scopedRows("ardDispersion").rows, [{ values: { conduit: "C1", value: 0.5 } }]);
  assert.deepEqual(
    t.scopedRows("ardBoundaries").rows.map((r) => r.values),
    [
      { element: "J1", species: "X", from: "VALUE", value: 5, series: "" },
      { element: "J2", species: "X", from: "TIMESERIES", value: "", series: "2-yr" },
    ],
  );
  assert.deepEqual(t.scopedRows("ardSources").rows.map((r) => r.values.value), [-0.1]);
  s.setScopedRows("ardDispersion", before); // undo
  assert.deepEqual(s.scopedRows("ardDispersion").rows, []);
});
