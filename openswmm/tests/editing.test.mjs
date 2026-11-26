// Map editing (interaction phase V6a): objects placed, traced, inserted and deleted through the editing
// session as the desktop's map tools do — names, creation defaults per unit system, refusals, undo —
// and the deck the engine writes afterwards opens again.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import create from "../vendor/engine/openswmm_engine.js";
import { ModelSession } from "../model.mjs";
import { sketch, deckNetwork } from "../view.mjs";

const decoder = new TextDecoder();
const fixture = (name) => readFile(new URL("./fixtures/" + name, import.meta.url), "utf8");
async function open(text, name = "m.inp") {
  const session = new ModelSession(await create());
  session.open({ name, entry: name, inputs: { [name]: new TextEncoder().encode(text) }, anchor: null, split: false });
  return session;
}
/** The rows of one section of a deck, split into tokens. */
function rows(text, section) {
  const out = [];
  let on = false;
  for (const line of text.split(/\r?\n/)) {
    const t = line.split(";")[0].trim();
    if (t.startsWith("[")) on = t.toUpperCase() === section;
    else if (on && t) out.push(t.split(/\s+/));
  }
  return out;
}
const row = (text, section, id) => rows(text, section).find((r) => r[0] === id);
/** SI values pass through the engine's internal US units: equal to 12 digits. */
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9 * Math.max(1, Math.abs(expected)), actual + " ≠ " + expected);
/** The session's deck, written and opened again in a fresh engine (what Apply installs). */
async function reopened(session) {
  const text = decoder.decode(session.write());
  const again = await open(text);
  again.close();
  return text;
}

test("nodes placed on the map: desktop names and creation defaults (US), coordinates, the deck reopens", async () => {
  const s = await open(await fixture("example1.inp"));
  assert.deepEqual(s.addNode("JUNCTION", 10, 20), { id: "J12" }); // example1 has J1 … J11
  assert.deepEqual(s.addNode("OUTFALL", 11, 21), { id: "O2" }); // O1 exists
  assert.deepEqual(s.addNode("STORAGE", 12, 22), { id: "S1" }); // a subcatchment S1 does not take the name
  assert.deepEqual(s.addNode("DIVIDER", 13, 23), { id: "D1" });
  assert.equal(s.addNode("JUNCTION", 14, 24).id, "J13");
  assert.throws(() => s.addNode("TANK", 0, 0), /Unknown node type/);
  // The divider needs a diversion link before the deck opens again.
  assert.deepEqual(s.problems(), ["Divider D1 needs a diversion link: trace a link out of it."]);
  s.addLink("CONDUIT", "D1", "J13", [], 50);
  assert.deepEqual(s.problems(), []);
  const text = await reopened(s);
  assert.deepEqual(row(text, "[JUNCTIONS]", "J12"), ["J12", "0", "0", "0", "0", "0"]);
  assert.deepEqual(row(text, "[OUTFALLS]", "O2").slice(0, 4), ["O2", "0", "FREE", "NO"]);
  const storage = row(text, "[STORAGE]", "S1");
  assert.equal(+storage[2], 15); // max depth 15 ft
  assert.equal(storage[4], "FUNCTIONAL");
  assert.deepEqual(storage.slice(5, 8).map(Number), [0, 0, 1000]);
  const divider = row(text, "[DIVIDERS]", "D1");
  assert.equal(divider[2], "C12"); // diverts into the first link drawn out of it
  assert.equal(divider[3], "OVERFLOW");
  assert.deepEqual(row(text, "[COORDINATES]", "J12").slice(1).map(Number), [10, 20]);
  assert.deepEqual(row(text, "[COORDINATES]", "D1").slice(1).map(Number), [13, 23]);
});

test("links traced node to node: bends, traced length, desktop defaults per type and unit system", async () => {
  const us = await open(await fixture("example1.inp"));
  assert.deepEqual(us.addLink("CONDUIT", "J1", "J2", [[5, 5], [6, 6]], 123.4), { id: "C12" }); // example1 has C1 … C11
  us.addLink("PUMP", "J2", "J3");
  us.addLink("ORIFICE", "J3", "J4");
  us.addLink("WEIR", "J4", "J5");
  us.addLink("OUTLET", "J5", "J6");
  assert.throws(() => us.addLink("CONDUIT", "J1", "j1"), /two different nodes/);
  let text = await reopened(us);
  const c = row(text, "[CONDUITS]", "C12");
  assert.deepEqual([c[1], c[2], +c[3], +c[4]], ["J1", "J2", 123.4, 0.013]);
  assert.deepEqual(row(text, "[XSECTIONS]", "C12").slice(1, 3), ["CIRCULAR", "1"]);
  assert.deepEqual(rows(text, "[VERTICES]").filter((r) => r[0] === "C12").map((r) => r.slice(1).map(Number)), [[5, 5], [6, 6]]);
  assert.deepEqual(row(text, "[PUMPS]", "Pu1").slice(1, 5), ["J2", "J3", "*", "ON"]);
  const orifice = row(text, "[ORIFICES]", "Or1");
  assert.deepEqual([orifice[3], +orifice[5]], ["SIDE", 0.65]);
  assert.deepEqual(row(text, "[XSECTIONS]", "Or1").slice(1, 3), ["CIRCULAR", "1"]);
  const weir = row(text, "[WEIRS]", "W1");
  assert.deepEqual([weir[3], +weir[5]], ["TRANSVERSE", 3.33]);
  assert.deepEqual(row(text, "[XSECTIONS]", "W1").slice(1, 4), ["RECT_OPEN", "3", "3"]);
  const outlet = row(text, "[OUTLETS]", "Ou1");
  assert.deepEqual([outlet[4], +outlet[5], +outlet[6]], ["FUNCTIONAL/DEPTH", 10, 0.5]);
  // SI: the desktop's SI lengths and coefficients; no traced length → the default length.
  const si = await open((await fixture("example1.inp")).replace(/^(FLOW_UNITS\s+)CFS/m, "$1CMS"));
  si.addLink("CONDUIT", "J1", "J2");
  si.addLink("WEIR", "J4", "J5");
  si.addLink("OUTLET", "J5", "J6");
  si.addNode("STORAGE", 0, 0);
  text = await reopened(si);
  near(row(text, "[CONDUITS]", "C12")[3], 120);
  near(row(text, "[XSECTIONS]", "C12")[2], 0.3);
  near(row(text, "[WEIRS]", "W1")[5], 1.84);
  near(row(text, "[XSECTIONS]", "W1")[2], 1);
  near(row(text, "[XSECTIONS]", "W1")[3], 1);
  near(row(text, "[OUTLETS]", "Ou1")[5], 0.5);
  const storage = row(text, "[STORAGE]", "S1");
  near(storage[2], 4.5);
  near(storage[7], 100);
});

test("nodes inserted on a conduit split it at the clicked fraction; a virtual junction; undo fuses them back", async () => {
  const s = await open(await fixture("example1.inp"));
  const before = decoder.decode(s.write());
  const c2 = row(before, "[CONDUITS]", "C2");
  assert.deepEqual(s.insertNode("JUNCTION", "C2", 0.3), { id: "J12", link: "C2_B" });
  let text = await reopened(s);
  const first = row(text, "[CONDUITS]", "C2");
  assert.deepEqual([first[1], first[2]], [c2[1], "J12"]);
  assert.ok(Math.abs(first[3] - 0.3 * c2[3]) < 1e-9, first[3]);
  assert.deepEqual(row(text, "[CONDUITS]", "C2_B").slice(1, 3), ["J12", c2[2]]);
  s.removeInserted("J12");
  text = decoder.decode(s.write());
  assert.deepEqual(row(text, "[CONDUITS]", "C2").slice(1, 3), c2.slice(1, 3));
  assert.equal(row(text, "[CONDUITS]", "C2_B"), undefined);
  assert.equal(row(text, "[JUNCTIONS]", "J12"), undefined);
  // A storage unit inserted: split, converted, given the storage defaults; undo leaves no trace.
  assert.deepEqual(s.insertNode("STORAGE", "C2", 0.5), { id: "S1", link: "C2_B" });
  text = await reopened(s);
  assert.equal(+row(text, "[STORAGE]", "S1")[2], 15);
  s.removeInserted("S1");
  assert.equal(row(decoder.decode(s.write()), "[STORAGE]", "S1"), undefined);
  // A virtual junction: [VIRTUAL_JUNCTIONS]; links cannot end there.
  assert.deepEqual(s.insertNode("JUNCTION", "C2", 0.5, true), { id: "VJ1", link: "C2_B" });
  text = await reopened(s);
  assert.ok(row(text, "[VIRTUAL_JUNCTIONS]", "VJ1"));
  assert.throws(() => s.addLink("CONDUIT", "VJ1", "J1"), /virtual junction/);
  assert.throws(() => s.insertNode("OUTFALL", "C2", 0.5), /Outfalls end a network/);
  s.removeInserted("VJ1");
  assert.equal(row(decoder.decode(s.write()), "[VIRTUAL_JUNCTIONS]", "VJ1"), undefined);
  // Second pieces take the next free name.
  s.insertNode("JUNCTION", "C2", 0.5);
  assert.equal(s.insertNode("JUNCTION", "C2", 0.5).link, "C2_B1");
});

test("rain gages placed; added objects removed again (undo of an add)", async () => {
  const s = await open(await fixture("example1.inp"));
  assert.deepEqual(s.addGage(7, 8), { id: "RG1" });
  let text = await reopened(s);
  assert.deepEqual(row(text, "[RAINGAGES]", "RG1").slice(1, 3), ["INTENSITY", "0:15"]);
  assert.deepEqual(row(text, "[SYMBOLS]", "RG1").slice(1).map(Number), [7, 8]);
  s.addNode("JUNCTION", 1, 1);
  s.addLink("CONDUIT", "J12", "J1", [[2, 2]], 10);
  s.removeAdded("link", "C12");
  s.removeAdded("node", "J12");
  s.removeAdded("gage", "RG1");
  text = decoder.decode(s.write());
  for (const [section, id] of [["[CONDUITS]", "C12"], ["[JUNCTIONS]", "J12"], ["[RAINGAGES]", "RG1"], ["[VERTICES]", "C12"], ["[COORDINATES]", "J12"]])
    assert.equal(row(text, section, id), undefined, section + " " + id);
});

test("deleting map objects lists what goes with them; undo restores every row and reference", async () => {
  const s = await open(await fixture("example1.inp"));
  const before = decoder.decode(s.write());
  const items = [{ kind: "node", id: "J5" }, { kind: "link", id: "C5" }, { kind: "gage", id: "RainGage" }];
  const impact = s.objectImpact(items);
  // J5's other links are deleted with it; C5 was chosen itself. Subcatchments lose their gage.
  const ends = rows(before, "[CONDUITS]").filter((r) => (r[1] === "J5" || r[2] === "J5") && r[0] !== "C5").map((r) => "link " + r[0]);
  assert.deepEqual(impact.removed.sort(), ends.sort());
  assert.ok(impact.cleared.some((c) => /^subcatchment S\d+ \(/.test(c)), impact.cleared.join(", "));
  const { token } = s.deleteObjects(items);
  let text = decoder.decode(s.write());
  assert.equal(row(text, "[JUNCTIONS]", "J5"), undefined);
  for (const l of ends) assert.equal(row(text, "[CONDUITS]", l.slice(5)), undefined);
  assert.equal(row(text, "[RAINGAGES]", "RainGage"), undefined);
  s.restoreDeleted(token);
  text = await reopened(s);
  for (const section of ["[JUNCTIONS]", "[CONDUITS]", "[XSECTIONS]", "[RAINGAGES]", "[SUBCATCHMENTS]", "[COORDINATES]", "[VERTICES]", "[SYMBOLS]"])
    assert.deepEqual(rows(text, section).sort(), rows(before, section).sort(), section);
  assert.throws(() => s.restoreDeleted(token), /no longer be undone/);
});

test("the map's network after an edit (deckNetwork) is sketch's network; virtual junctions draw with the junctions", async () => {
  const text = await fixture("example1.inp");
  assert.deepEqual(deckNetwork(text).network, sketch(text).network);
  assert.equal(deckNetwork(text).mapUnits, "FEET"); // [MAP] Units Feet
  const s = await open(text);
  s.insertNode("JUNCTION", "C2", 0.5, true);
  s.addNode("STORAGE", 3, 4);
  const { network } = deckNetwork(decoder.decode(s.write()));
  const at = network.junctions[network.ids.junctions.indexOf("VJ1")];
  assert.ok(at && network.virtual.has("VJ1") && !network.virtual.has("J1"));
  // The two pieces meet at the virtual junction; the storage unit is where it was placed.
  const piece = (id) => network.conduits[network.ids.conduits.indexOf(id)];
  assert.deepEqual(piece("C2").at(-1), at);
  assert.deepEqual(piece("C2_B")[0], at);
  assert.deepEqual(network.storage[network.ids.storage.indexOf("S1")], [3, 4]);
});

test("subcatchments drawn on the map: desktop values per unit system and INFILTRATION option, nearest gage and outlet", async () => {
  const text = await fixture("example1.inp");
  const s = await open(text);
  // A square next to J1 (648.5, 1043.7): its nearest node is J1, the only gage RainGage.
  const ring = [[600, 1000], [700, 1000], [700, 1100], [600, 1100]];
  assert.deepEqual(s.addSubcatchment(ring, 3.25), { id: "Sub1", gage: "RainGage", outlet: "J1" });
  let deck = await reopened(s);
  const row = (section, id = "Sub1") => rows(deck, section).find((r) => r[0] === id);
  assert.deepEqual(row("[SUBCATCHMENTS]").slice(1, 3), ["RainGage", "J1"]);
  assert.deepEqual(row("[SUBCATCHMENTS]").slice(3, 7).map(Number), [3.25, 25, 500, 0.5]);
  assert.deepEqual(row("[SUBAREAS]").slice(1, 6).map(Number), [0.012, 0.15, 0.06, 0.15, 25]);
  assert.deepEqual(row("[INFILTRATION]").slice(1, 5).map(Number), [3, 0.5, 4, 7]);
  assert.deepEqual(rows(deck, "[POLYGONS]").filter((r) => r[0] === "Sub1").map((r) => r.slice(1).map(Number)).slice(0, 4), ring);
  assert.deepEqual(s.problems(), []);
  s.removeAdded("subcatchment", "Sub1");
  assert.equal(rows(decoder.decode(s.write()), "[SUBCATCHMENTS]").find((r) => r[0] === "Sub1"), undefined);
  // SI, Green-Ampt: the SI values and the Green-Ampt family; no area → the default 2 ha.
  // (The fixture's own subcatchments get Green-Ampt rows too: its Horton values are no Green-Ampt set.)
  const greenAmpt = text
    .replace(/^(FLOW_UNITS\s+)CFS/m, "$1CMS")
    .replace(/^(INFILTRATION\s+)HORTON/m, "$1GREEN_AMPT")
    .replace(/(\[INFILTRATION\][^[]*)/, (block) => block.replace(/^(S\d+)\s+.*$/gm, "$1 89 13 0.26"));
  const si = await open(greenAmpt);
  si.addSubcatchment(ring);
  deck = await reopened(si);
  near(row("[SUBCATCHMENTS]")[3], 2);
  near(row("[SUBCATCHMENTS]")[5], 150);
  near(row("[SUBAREAS]")[3], 1.5);
  near(row("[SUBAREAS]")[4], 3.8);
  const ga = row("[INFILTRATION]");
  near(ga[1], 89);
  near(ga[2], 13);
  near(ga[3], 0.26);
  // No rain gage in the model: Apply waits until one is set.
  const bare = await open(text);
  bare.deleteObjects([{ kind: "gage", id: "RainGage" }]);
  assert.equal(bare.addSubcatchment(ring).gage, null);
  assert.deepEqual(bare.problems().filter((p) => p.includes("Sub1")), ["Subcatchment Sub1 needs a rain gage: set it in its properties."]);
});

test("a subcatchment's rain gage and outlet (a node or another subcatchment) are set in its properties", async () => {
  const s = await open(await fixture("example1.inp"));
  assert.deepEqual(s.subcatchLinks("S1"), { id: "S1", gage: "RainGage", outlet: { kind: "node", id: "J1" } });
  s.addGage(0, 0);
  assert.deepEqual(s.setSubcatchLinks("S1", { gage: "RG1", outlet: { kind: "subcatchment", id: "S2" } }), { id: "S1", gage: "RG1", outlet: { kind: "subcatchment", id: "S2" } });
  const deck = await reopened(s);
  assert.deepEqual(rows(deck, "[SUBCATCHMENTS]").find((r) => r[0] === "S1").slice(1, 3), ["RG1", "S2"]);
  assert.throws(() => s.setSubcatchLinks("S1", { outlet: { kind: "subcatchment", id: "s1" } }), /cannot drain to itself/);
  assert.throws(() => s.setSubcatchLinks("S1", { gage: "Nope" }), /No rain gage Nope/);
});

test("moving a node carries its conduits' ends; vertices are replaced; lengths set and restored; inverts from the ground", async () => {
  const s = await open(await fixture("example1.inp"));
  const before = s.moveObject("node", "J1", 700, 1100);
  assert.deepEqual([before.x, before.y], [648.532, 1043.713]);
  assert.deepEqual(before.conduits.map((c) => c.id).sort(), ["C1"]);
  assert.deepEqual(before.conduits[0].points[0], [700, 1100]); // C1 starts at J1
  const old = s.setLengths({ C1: 222 });
  assert.deepEqual(old, { C1: 185 });
  let deck = decoder.decode(s.write());
  assert.deepEqual(rows(deck, "[COORDINATES]").find((r) => r[0] === "J1").slice(1).map(Number), [700, 1100]);
  assert.equal(+rows(deck, "[CONDUITS]").find((r) => r[0] === "C1")[3], 222);
  s.moveObject("node", "J1", before.x, before.y);
  s.setLengths(old);
  assert.equal(+rows(decoder.decode(s.write()), "[CONDUITS]").find((r) => r[0] === "C1")[3], 185);
  // Gages move too (no conduits).
  assert.deepEqual(s.moveObject("gage", "RainGage", 1, 2), { x: -175.841, y: 1212.778, conduits: [] });
  // Link vertices: replaced, and back.
  const v = s.setVertices("C2", [[1300, 700]]);
  assert.deepEqual(v.before, [[1321.339, 774.591], [1374.819, 652.105], [1366.193, 588.275]]);
  assert.equal(v.points.length, 3);
  deck = await reopened(s);
  assert.deepEqual(rows(deck, "[VERTICES]").filter((r) => r[0] === "C2").map((r) => r.slice(1).map(Number)), [[1300, 700]]);
  s.setVertices("C2", v.before);
  assert.equal(rows(decoder.decode(s.write()), "[VERTICES]").filter((r) => r[0] === "C2").length, 3);
  // A node placed over the ground takes its elevation as the invert.
  s.addNode("JUNCTION", 5, 5, 812.5);
  assert.equal(+rows(decoder.decode(s.write()), "[JUNCTIONS]").find((r) => r[0] === "J12")[1], 812.5);
});

test("nodes and links converted to another type: a preview, the new type's values, refusals, undo", async () => {
  const s = await open(await fixture("example1.inp"));
  const before = decoder.decode(s.write());
  const preview = s.convertObjects("node", ["J2", "O1"], "STORAGE");
  assert.deepEqual(preview.rows.map((r) => [r.id, r.from, r.state]), [["J2", "JUNCTION", "convert"], ["O1", "OUTFALL", "convert"]]);
  assert.equal(decoder.decode(s.write()), before, "a preview changes nothing");
  const done = s.convertObjects("node", ["J2"], "STORAGE", true);
  let deck = await reopened(s);
  const j2 = rows(before, "[JUNCTIONS]").find((r) => r[0] === "J2");
  const st = rows(deck, "[STORAGE]").find((r) => r[0] === "J2");
  assert.deepEqual([+st[1], +st[2]], [+j2[1], +j2[2]], "invert and depth kept");
  assert.deepEqual(st.slice(4, 8).map((v, i) => (i ? +v : v)), ["FUNCTIONAL", 0, 0, 1000]);
  assert.equal(s.convertObjects("node", ["J2"], "STORAGE").rows[0].state, "same");
  s.unconvertObjects("node", done.undo);
  deck = decoder.decode(s.write());
  assert.deepEqual(rows(deck, "[JUNCTIONS]").find((r) => r[0] === "J2"), j2);
  assert.equal(rows(deck, "[STORAGE]").find((r) => r[0] === "J2"), undefined);
  // A conduit to a weir: the weir's values; and back.
  const link = s.convertObjects("link", ["C3"], "WEIR", true);
  deck = await reopened(s);
  assert.equal(rows(deck, "[WEIRS]").find((r) => r[0] === "C3")[3], "TRANSVERSE");
  s.unconvertObjects("link", link.undo);
  deck = decoder.decode(s.write());
  assert.deepEqual(rows(deck, "[CONDUITS]").find((r) => r[0] === "C3"), rows(before, "[CONDUITS]").find((r) => r[0] === "C3"));
  assert.deepEqual(rows(deck, "[XSECTIONS]").find((r) => r[0] === "C3"), rows(before, "[XSECTIONS]").find((r) => r[0] === "C3"));
  // A divider takes the first link out of it as its diversion link, so the deck opens again.
  s.convertObjects("node", ["J3"], "DIVIDER", true);
  assert.deepEqual(s.problems(), []);
  await reopened(s);
});

test("map labels ([LABELS]): read, added, changed, moved and deleted as the desktop writes them; the map reads them", async () => {
  const s = await open(await fixture("example1.inp"));
  const labels = s.labels();
  assert.equal(labels.length, rows(decoder.decode(s.write()), "[LABELS]").length);
  assert.deepEqual(labels[0], { x: 218.836, y: 1149.697, text: "S1", anchor: "", font: "Arial", size: 14, bold: false, italic: false });
  const next = [...labels, { x: 10, y: 20, text: 'Two "words"', anchor: "", font: "Arial", size: 12, bold: true, italic: false }];
  next[0] = { ...next[0], x: 300, y: 1200 };
  const before = s.setLabels(next);
  assert.deepEqual(before, labels);
  const deck = await reopened(s);
  const after = s.labels();
  assert.equal(after.length, labels.length + 1);
  assert.deepEqual(after.at(-1), { x: 10, y: 20, text: "Two 'words'", anchor: "", font: "Arial", size: 12, bold: true, italic: false });
  assert.deepEqual([after[0].x, after[0].y], [300, 1200]);
  // The map reads the same labels from the deck, spaces in their text kept.
  assert.deepEqual(deckNetwork(deck).network.labels, after);
  assert.throws(() => s.setLabels([{ x: 0, y: 0, text: "  ", size: 10 }]), /needs some text/);
  assert.throws(() => s.setLabels([{ x: 0, y: 0, text: "A", size: 0 }]), /size must be above 0/);
  s.setLabels(before); // undo
  assert.deepEqual(s.labels(), labels);
  s.setLabels([]);
  assert.deepEqual(s.labels(), []);
  await reopened(s);
});

const streetDeck = `[OPTIONS]
FLOW_UNITS CFS
FLOW_ROUTING DYNWAVE
START_DATE 01/01/2026
START_TIME 00:00:00
END_DATE 01/01/2026
END_TIME 01:00:00
ROUTING_STEP 0:00:10
[JUNCTIONS]
J1 100 10 0 0 0
J2 99 10 0 0 0
J3 98 10 0 0 0
[OUTFALLS]
O1 95 FREE
[CONDUITS]
C1 J1 J2 400 0.016 0 0
C2 J2 O1 400 0.013 0 0
C3 J3 O1 400 0.013 0 0
[XSECTIONS]
C1 STREET ST1
C2 CIRCULAR 1.5 0 0 0 1
C3 CIRCULAR 1.5 0 0 0 1
[STREETS]
ST1 20 0.5 4 0.016 0 0 1 20 4 0.016
[INLETS]
IN1 GRATE 2 2 P_BAR-50
[COORDINATES]
J1 0 0
J2 400 0
J3 400 200
O1 800 0
`;

test("inlet junctions on a street conduit: choices, the split, placement, the map's diamond and capture line, undo", async () => {
  const s = await open(streetDeck);
  const before = decoder.decode(s.write());
  const choices = s.inletChoices("C1", 200, 150);
  assert.deepEqual(choices, { street: true, designs: ["IN1"], captures: ["J3", "O1"] }); // not C1's ends; nearest first
  assert.equal(s.inletChoices("C2", 0, 0).street, false);
  assert.throws(() => s.insertInlet("C2", 0.5, "IN1", "J3"), /only be placed on street conduits/);
  assert.deepEqual(s.insertInlet("C1", 0.5, "IN1", "J3", "ON_SAG"), { id: "IJ1", link: "C1_B" });
  const deck = await reopened(s);
  const row = rows(deck, "[INLET_JUNCTIONS]").find((r) => r[0] === "IJ1");
  assert.deepEqual([row[3], row[4], row.at(-1)], ["IN1", "J3", "ON_SAG"]);
  assert.deepEqual(rows(deck, "[CONDUITS]").find((r) => r[0] === "C1").slice(1, 3), ["J1", "IJ1"]);
  assert.deepEqual(rows(deck, "[CONDUITS]").find((r) => r[0] === "C1_B").slice(1, 3), ["IJ1", "J2"]);
  assert.throws(() => s.addLink("CONDUIT", "IJ1", "J3"), /IJ1 is an inlet junction/);
  // The map: the junction is drawn (with the junctions), and it sends to J3.
  const { network } = deckNetwork(deck);
  assert.ok(network.ids.junctions.includes("IJ1"));
  assert.equal(network.inlets.get("IJ1"), "J3");
  s.removeInlet("IJ1");
  const fused = decoder.decode(s.write());
  for (const section of ["[JUNCTIONS]", "[CONDUITS]", "[XSECTIONS]", "[COORDINATES]"]) assert.deepEqual(rows(fused, section), rows(before, section), section);
  assert.deepEqual(rows(fused, "[INLET_JUNCTIONS]"), []);
});
