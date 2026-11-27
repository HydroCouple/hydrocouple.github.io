// Node and link cards (interaction phase E3d-3): a node's 2D coupling ([2D_NODE_COUPLING]) with the
// desktop's structures per node class and the engine's ranges (it refuses with a bare code), written,
// reopened, undo, Bellinge's row kept; reaction species in Initial quality ([REACTION_QUALITY]).
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import create from "../vendor/engine/openswmm_engine.js";
import { ModelSession } from "../model.mjs";
import { groupValues } from "../properties.mjs";

const decoder = new TextDecoder();
async function open(text, extra = {}, name = "m.inp") {
  const session = new ModelSession(await create());
  const inputs = { [name]: typeof text === "string" ? new TextEncoder().encode(text) : text };
  for (const [n, b] of Object.entries(extra)) inputs[n] = typeof b === "string" ? new TextEncoder().encode(b) : b;
  session.open({ name, entry: name, inputs, anchor: null, split: false });
  return session;
}
const read = async (path) => decoder.decode(await readFile(new URL(path, import.meta.url)));
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
const group = (s, kind, id, key) => s.groups(kind, id).find((g) => g.key === key);
const set = (s, kind, id, key, changes) => s.setGroup(kind, id, key, { ...groupValues(group(s, kind, id, key)), ...changes });

test("2D coupling: structures per node class, the engine's ranges explained, written, reopened, undo", async () => {
  const s = await open(await read("../examples/coupled.inp"));
  const j1 = group(s, "node", "J1", "coupling2d");
  assert.deepEqual(j1.fields[0].choices.map(([v]) => v), ["", "NONE", "MANHOLE", "GRATE", "CURB"]);
  assert.equal(j1.fields[0].choices[0][1], "Default (manhole)");
  assert.equal(j1.fields[0].value, "");
  assert.deepEqual(group(s, "node", "ST1", "coupling2d").fields[0].choices.map(([v]) => v), ["", "NONE", "MANHOLE", "GRATE", "CURB", "OPEN"]);
  const out1 = group(s, "node", "OUT1", "coupling2d");
  assert.deepEqual(out1.fields.map((f) => f.name), ["type", "c:SPREAD", "c:TAILWATER_RELAX"]);
  const before = groupValues(j1);
  assert.throws(() => set(s, "node", "J1", "coupling2d", { type: "OPEN" }), /A junction or divider couples as a manhole, grate or curb/);
  assert.throws(() => set(s, "node", "OUT1", "coupling2d", { type: "MANHOLE" }), /An outfall couples as an outfall or not at all/);
  assert.throws(() => set(s, "node", "J1", "coupling2d", { "c:D": -1 }), /Manhole diameter must be above 0/);
  assert.throws(() => set(s, "node", "J1", "coupling2d", { "c:LID_OPEN_FRACTION": 2 }), /lid open fraction is above 0 and at most 1/);
  assert.throws(() => set(s, "node", "OUT1", "coupling2d", { "c:TAILWATER_RELAX": -1 }), /Tailwater relaxation cannot be negative/);
  // A new structure keeps only what applies to it: the manhole diameter goes with the manhole.
  set(s, "node", "J1", "coupling2d", { type: "GRATE", "c:D": 1.2, "c:PERIMETER": 2, "c:CREST": "MESH_BED", "c:CW": 0.5 });
  set(s, "node", "OUT1", "coupling2d", { "c:SPREAD": 3 }); // a parameter authors the row at the class default
  set(s, "node", "ST1", "coupling2d", { type: "NONE" });
  const out = decoder.decode(s.writeAll()["m.inp"]);
  assert.deepEqual(lines(out, "[2D_NODE_COUPLING]"), ["J1 GRATE PERIMETER=2 CREST=MESH_BED CW=0.5", "OUT1 OUTFALL SPREAD=3", "ST1 NONE"]);
  const t = await open(out);
  const values = (s, id) => Object.fromEntries(Object.entries(groupValues(group(s, "node", id, "coupling2d"))).filter(([, v]) => v !== ""));
  assert.deepEqual(values(t, "J1"), { type: "GRATE", "c:PERIMETER": 2, "c:CREST": "MESH_BED", "c:CW": 0.5 });
  assert.deepEqual(values(t, "OUT1"), { type: "OUTFALL", "c:SPREAD": 3 });
  s.setGroup("node", "J1", "coupling2d", before); // undo: no row again
  assert.deepEqual(lines(decoder.decode(s.writeAll()["m.inp"]), "[2D_NODE_COUPLING]"), ["OUT1 OUTFALL SPREAD=3", "ST1 NONE"]);
});

test("2D coupling: shown with a mesh or coupling rows; Bellinge's row is kept as it was", async () => {
  const ex1 = await read("fixtures/example1.inp");
  assert.equal(group(await open(ex1), "node", "J1", "coupling2d"), undefined, "no mesh, no rows");
  const rows = await open(ex1 + "\n[2D_NODE_COUPLING]\nJ2 CURB AREA=0.1\n");
  assert.deepEqual(groupValues(group(rows, "node", "J2", "coupling2d")).type, "CURB");
  assert.equal(group(rows, "node", "J1", "coupling2d").fields[0].value, "");
  const dir = new URL("../examples/bellinge/", import.meta.url),
    names = ["BellingeSWMM_v021_nopervious.inp", "BellingeSWMM_v021_nopervious.2dm", "rg_bellinge_2012-06-28_30.dat"];
  const inputs = Object.fromEntries(await Promise.all(names.map(async (n) => [n, new Uint8Array(await readFile(new URL(n, dir)))])));
  const b = await open(inputs[names[0]], { [names[1]]: inputs[names[1]], [names[2]]: inputs[names[2]] }, names[0]);
  const g = group(b, "node", "G70F130", "coupling2d");
  assert.equal(g.fields[0].value, "MANHOLE", "authored at its class default");
  b.setGroup("node", "G70F130", "coupling2d", groupValues(g));
  assert.deepEqual(lines(decoder.decode(b.writeAll()[names[0]]), "[2D_NODE_COUPLING]"), ["G70F130 MANHOLE"]);
  b.close();
});

test("initial quality: reaction species on nodes and links, saved with the reaction system, reopened, undo", async () => {
  const s = await open(await read("fixtures/example1.inp"));
  s.setReactions("[REACTION_OPTIONS]\nAREA_UNITS M2\n[REACTION_SPECIES]\nBULK X MG\nWALL W UG\n[REACTION_PIPES]\nRATE X -0.1*X\nRATE W 0\n[REACTION_TANKS]\nRATE X 0\n");
  const q = group(s, "node", "J1", "quality");
  assert.deepEqual(q.fields.map((f) => [f.name, f.label, f.unit, f.value]), [["q:TSS", "TSS", "MG/L", ""], ["r:X", "X", "MG/L", ""], ["r:W", "W (wall)", "UG/M2", ""]]);
  const before = groupValues(q);
  assert.throws(() => set(s, "node", "J1", "quality", { "r:X": -1 }), /X cannot be negative/);
  set(s, "node", "J1", "quality", { "r:X": 2 });
  set(s, "link", "C1", "quality", { "r:W": 1.5 });
  const files = s.writeAll();
  assert.deepEqual(lines(decoder.decode(files["model.rxn"]), "[REACTION_QUALITY]"), ["NODE J1 X 2", "LINK C1 W 1.5"]);
  const t = await open(decoder.decode(files["m.inp"]), { "model.rxn": files["model.rxn"] });
  assert.deepEqual([groupValues(group(t, "node", "J1", "quality"))["r:X"], groupValues(group(t, "link", "C1", "quality"))["r:W"]], [2, 1.5]);
  s.setGroup("node", "J1", "quality", before); // undo
  assert.deepEqual(lines(decoder.decode(s.writeAll()["model.rxn"]), "[REACTION_QUALITY]"), ["LINK C1 W 1.5"]);
});

// E3d-3b: the table rows that name a node or conduit, edited on its card.
const rows = (s, name) => s.scopedRows(name).rows.map((r) => r.values);

test("aquifer bed and link on cards: the table's rows and checks, in place, written, reopened, undo", async () => {
  const s = await open((await read("../examples/coupled.inp")) + "\n[POLLUTANTS]\nTSS MG/L 0 0 0 0 NO * 0 0 0\n");
  s.setScopedRows("nodeBeds", [{ values: { node: "ST1", cell: "", kc: 0.2, dc: 1, area: 0, exchange: "NO" } }]);
  const bed = group(s, "node", "J1", "aquiferBed");
  assert.equal(bed.fields[0].value, "", "no bed yet");
  const before = s.groups("node", "J1").find((g) => g.key === "aquiferBed");
  assert.throws(() => set(s, "node", "J1", "aquiferBed", { bed: "own", kc: -1 }), /The bed: kc is 0 or more/);
  assert.throws(() => set(s, "node", "J1", "aquiferBed", { bed: "own", cell: 99 }), /a cell is a number from 1 to 8/);
  assert.throws(() => set(s, "node", "J1", "aquiferBed", { bed: "own", kc: 0.1, dc: 0 }), /The bed: a bed with Kc above 0 needs a thickness above 0/); // the engine says only "invalid"
  set(s, "node", "J1", "aquiferBed", { bed: "own", kc: 0.1, dc: 0.5 });
  assert.deepEqual(rows(s, "nodeBeds").map((r) => [r.node, r.kc, r.exchange]), [["ST1", 0.2, "NO"], ["J1", 0.1, "YES"]], "the table shows the card's row");
  set(s, "node", "ST1", "aquiferBed", { kc: 0.3 }); // edited in place: the order stays
  assert.deepEqual(rows(s, "nodeBeds").map((r) => [r.node, r.kc]), [["ST1", 0.3], ["J1", 0.1]]);
  set(s, "link", "C1", "aquiferLink", { row: "own", kc: 0.05, dc: 0.2 });
  assert.throws(() => set(s, "link", "C2", "aquiferLink", { row: "own", dc: -1 }), /The bed: dc is 0 or more/);
  const out = decoder.decode(s.writeAll()["m.inp"]);
  assert.deepEqual(lines(out, "[2D_AQUIFER_NODE]").map((r) => r.split(" ")[0]), ["ST1", "J1"]);
  assert.deepEqual(lines(out, "[2D_AQUIFER_LINKS]").map((r) => r.split(" ")[0]), ["C1"]);
  const t = await open(out);
  assert.deepEqual([group(t, "node", "J1", "aquiferBed").fields[0].value, groupValues(group(t, "link", "C1", "aquiferLink")).kc], ["own", 0.05]);
  s.setGroup("node", "J1", "aquiferBed", { restore: before.restore }); // undo puts the table back exactly
  assert.deepEqual(rows(s, "nodeBeds").map((r) => [r.node, r.kc]), [["ST1", 0.2]]);
  set(s, "node", "ST1", "aquiferBed", { bed: "" }); // none removes the row
  assert.deepEqual(rows(s, "nodeBeds"), []);
});

test("ARD on cards: boundaries, dispersion and sources as the Transport (ARD) tables, written, reopened, undo", async () => {
  const s = await open(await read("fixtures/example1.inp"));
  assert.deepEqual([group(s, "node", "J1", "ardBoundary"), group(s, "link", "C1", "ard")], [undefined, undefined], "no species, no component");
  s.setReactions("[REACTION_SPECIES]\nBULK X MG\n[REACTION_PIPES]\nRATE X -0.1*X\n[REACTION_TANKS]\nRATE X 0\n");
  const node = group(s, "node", "J1", "ardBoundary"),
    link = group(s, "link", "C1", "ard");
  assert.deepEqual(node.fields.map((f) => f.name), ["b:X", "bv:X", "bt:X"]);
  assert.deepEqual(link.fields.map((f) => f.name), ["disp", "s:X", "sv:X", "st:X"]);
  assert.throws(() => set(s, "node", "J1", "ardBoundary", { "b:X": "VALUE", "bv:X": -1 }), /X boundary: a concentration cannot be negative/);
  assert.throws(() => set(s, "node", "J1", "ardBoundary", { "b:X": "TIMESERIES" }), /X boundary: choose the time series/);
  assert.throws(() => set(s, "link", "C1", "ard", { disp: -1 }), /Dispersion: the coefficient is 0 or more/);
  assert.deepEqual(rows(s, "ardDispersion"), [], "a refused card writes nothing");
  set(s, "node", "J1", "ardBoundary", { "b:X": "TIMESERIES", "bt:X": "2-yr" });
  set(s, "link", "C1", "ard", { disp: 0.3, "s:X": "VALUE", "sv:X": -0.5 });
  assert.deepEqual(rows(s, "ardBoundaries"), [{ element: "J1", species: "X", from: "TIMESERIES", value: "", series: "2-yr" }]);
  assert.deepEqual([rows(s, "ardDispersion"), rows(s, "ardSources").map((r) => [r.element, r.value])], [[{ conduit: "C1", value: 0.3 }], [["C1", -0.5]]]);
  // A table edit shows on the card.
  s.setScopedRows("ardDispersion", [{ values: { conduit: "C1", value: 0.4 } }]);
  assert.equal(groupValues(group(s, "link", "C1", "ard")).disp, 0.4);
  const files = s.writeAll();
  assert.deepEqual(Object.keys(files).sort(), ["m.ard", "m.inp", "model.rxn"]);
  const t = await open(decoder.decode(files["m.inp"]), { "m.ard": files["m.ard"], "model.rxn": files["model.rxn"] });
  assert.deepEqual([groupValues(group(t, "node", "J1", "ardBoundary"))["bt:X"], groupValues(group(t, "link", "C1", "ard"))["sv:X"]], ["2-yr", -0.5]);
  // Undo puts both tables back as they were shown: the rows there were, not just none.
  const shown = group(s, "link", "C1", "ard");
  set(s, "link", "C1", "ard", { disp: 0.1, "s:X": "" });
  assert.deepEqual([rows(s, "ardDispersion"), rows(s, "ardSources")], [[{ conduit: "C1", value: 0.1 }], []]);
  s.setGroup("link", "C1", "ard", { restore: shown.restore });
  assert.deepEqual([rows(s, "ardDispersion"), rows(s, "ardSources").map((r) => [r.element, r.value])], [[{ conduit: "C1", value: 0.4 }], [["C1", -0.5]]]);
  s.setGroup("link", "C1", "ard", { restore: link.restore }); // back to before the first change
  assert.deepEqual([rows(s, "ardDispersion"), rows(s, "ardSources")], [[], []]);
});
