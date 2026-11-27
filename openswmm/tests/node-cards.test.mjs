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
