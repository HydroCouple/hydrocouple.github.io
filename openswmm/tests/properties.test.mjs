// Properties of map objects the field catalog has no rows for (interaction phase E3b): cross-sections,
// losses, coefficients, pump curves, outfalls, storage units, dividers, infiltration and groundwater —
// read, checked as legacy SWMM 5.2.4 checks them, written by the engine into a deck that opens again,
// and put back (undo).
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import create from "../vendor/engine/openswmm_engine.js";
import { ModelSession } from "../model.mjs";
import { groupValues, undoValues } from "../properties.mjs";

const decoder = new TextDecoder();
const fixture = (name) => readFile(new URL("./fixtures/" + name, import.meta.url), "utf8");
async function open(text, name = "m.inp") {
  const session = new ModelSession(await create());
  session.open({ name, entry: name, inputs: { [name]: new TextEncoder().encode(text) }, anchor: null, split: false });
  return session;
}
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
async function reopened(session) {
  const text = decoder.decode(session.write());
  (await open(text)).close();
  return text;
}
const group = (s, kind, id, key) => s.groups(kind, id).find((g) => g.key === key);
const values = (s, kind, id, key) => groupValues(group(s, kind, id, key));
/** A curve with rows SWMM accepts for its type. */
function curve(s, name, type, points) {
  s.addRecord("curve", name, type);
  s.setRecord("curve", name, { type, points });
}

test("cross-sections: shape and geometry, transect / shape curve / street by name, legacy refusals, undo", async () => {
  const s = await open(await fixture("example1.inp"));
  const c1 = values(s, "link", "C1", "xsect");
  assert.deepEqual([c1.shape, c1.g1, c1.g2, c1.g3, c1.g4], ["TRAPEZOIDAL", 3, 5, 5, 5]);
  s.setGroup("link", "C1", "xsect", { ...c1, shape: "CIRCULAR", g1: 2 });
  let deck = await reopened(s);
  assert.deepEqual(row(deck, "[XSECTIONS]", "C1").slice(1, 3), ["CIRCULAR", "2"]);
  const refuse = (v, re) => assert.throws(() => s.setGroup("link", "C1", "xsect", { ...c1, ...v }), re);
  refuse({ shape: "CIRCULAR", g1: 0 }, /Diameter must be above 0/);
  refuse({ shape: "RECT_OPEN", g1: 2, g2: 3, g3: 3 }, /Sides removed is 0, 1 or 2/);
  refuse({ shape: "FILLED_CIRCULAR", g1: 2, g2: 2 }, /filled depth must be less than the diameter/);
  refuse({ shape: "TRAPEZOIDAL", g3: -1 }, /Left slope cannot be negative/);
  refuse({ shape: "IRREGULAR", transect: "" }, /Choose the transect/);
  // A custom shape's curve cannot be assigned through the engine API: not offered, refused.
  assert.ok(!group(s, "link", "C1", "xsect").fields[0].choices.some(([v]) => v === "CUSTOM"));
  refuse({ shape: "CUSTOM", g1: 2 }, /cannot be assigned here yet/);
  s.setGroup("link", "C1", "xsect", c1); // undo
  assert.deepEqual(row(decoder.decode(s.write()), "[XSECTIONS]", "C1").slice(1, 6), ["TRAPEZOIDAL", "3", "5", "5", "5"]);
  // An irregular channel names its transect; a street conduit its street.
  const t = await open(await fixture("transects.inp"));
  const name = t.transectIds()[0];
  t.setGroup("link", "C1", "xsect", { ...values(t, "link", "C1", "xsect"), shape: "IRREGULAR", transect: name });
  assert.deepEqual(row(await reopened(t), "[XSECTIONS]", "C1").slice(1, 3), ["IRREGULAR", name]);
  const k = await open(await fixture("kitchen.inp"));
  assert.deepEqual([values(k, "link", "C2", "xsect").shape, values(k, "link", "C2", "xsect").street], ["STREET_XSECT", "ST1"]);
});

test("losses, discharge coefficients and pump curves", async () => {
  const s = await open(await fixture("example1.inp"));
  s.setGroup("link", "C1", "losses", { inlet: 0.5, outlet: 1, average: 0.2 });
  assert.throws(() => s.setGroup("link", "C1", "losses", { inlet: -1, outlet: 0, average: 0 }), /cannot be negative/);
  s.addLink("ORIFICE", "J1", "J2");
  s.setGroup("link", "Or1", "coefficient", { cd: 0.61 });
  s.addLink("PUMP", "J2", "J3");
  curve(s, "P1", "PUMP1", [[0, 0], [100, 5]]);
  s.setGroup("link", "Pu1", "pump", { curve: "P1" });
  let deck = await reopened(s);
  assert.deepEqual(row(deck, "[LOSSES]", "C1").slice(1, 4).map(Number), [0.5, 1, 0.2]);
  assert.equal(+row(deck, "[ORIFICES]", "Or1")[5], 0.61);
  assert.equal(row(deck, "[PUMPS]", "Pu1")[3], "P1");
  assert.equal(values(s, "link", "Pu1", "pump").curve, "P1");
  s.setGroup("link", "Pu1", "pump", { curve: "" });
  deck = await reopened(s);
  assert.equal(row(deck, "[PUMPS]", "Pu1")[3], "*");
  // The pump curve index row is gone from the catalog rows; the group shows it by name.
  assert.ok(!s.fields("link", "Pu1").some((r) => r.path === "link.pump.curve"));
});

test("outfalls: type with its stage, tidal curve or time series, and routing onto a subcatchment", async () => {
  const s = await open(await fixture("example1.inp"));
  const o1 = values(s, "node", "O1", "outfall");
  assert.equal(o1.type, "FREE");
  s.setGroup("node", "O1", "outfall", { ...o1, type: "FIXED", stage: 3.5, routeTo: "S1" });
  let deck = await reopened(s);
  assert.deepEqual(row(deck, "[OUTFALLS]", "O1").slice(2, 4), ["FIXED", "3.5"]);
  assert.equal(row(deck, "[OUTFALLS]", "O1").at(-1), "S1");
  assert.throws(() => s.setGroup("node", "O1", "outfall", { ...o1, type: "TIDAL", tidal: "" }), /Choose the tidal curve/);
  curve(s, "T1", "TIDAL", [[0, 1], [12, 2], [24, 1]]);
  s.setGroup("node", "O1", "outfall", { ...o1, type: "TIDAL", tidal: "T1" });
  deck = await reopened(s);
  assert.deepEqual(row(deck, "[OUTFALLS]", "O1").slice(2, 4), ["TIDAL", "T1"]);
  s.setGroup("node", "O1", "outfall", { ...o1, type: "TIMESERIES", series: "2-yr" });
  deck = await reopened(s);
  assert.deepEqual(row(deck, "[OUTFALLS]", "O1").slice(2, 4), ["TIMESERIES", "2-yr"]);
  s.setGroup("node", "O1", "outfall", o1); // undo
  deck = await reopened(s);
  assert.equal(row(deck, "[OUTFALLS]", "O1")[2], "FREE");
});

test("storage units: functional, tabular and geometric shapes, exfiltration; dividers: each type", async () => {
  const s = await open(await fixture("example1.inp"));
  s.convertObjects("node", ["J2"], "STORAGE", true);
  const st = values(s, "node", "J2", "storage");
  assert.deepEqual([st.shape, st.a, st.b, st.c], ["FUNCTIONAL", 0, 0, 1000]);
  s.setGroup("node", "J2", "storage", { ...st, shape: "CYLINDRICAL", p1: 20, p2: 10, suction: 3, ksat: 0.5, imd: 0.25 });
  let deck = await reopened(s);
  const r = row(deck, "[STORAGE]", "J2");
  assert.equal(r[4], "CYLINDRICAL");
  assert.deepEqual(r.slice(5, 7).map(Number), [20, 10]);
  assert.deepEqual(r.slice(-3).map(Number), [3, 0.5, 0.25]);
  assert.throws(() => s.setGroup("node", "J2", "storage", { ...st, a: 0, c: 0 }), /needs a coefficient or a constant/);
  assert.throws(() => s.setGroup("node", "J2", "storage", { ...st, shape: "TABULAR", curve: "" }), /Choose the storage curve/);
  curve(s, "SU1", "STORAGE", [[0, 100], [10, 200]]);
  s.setGroup("node", "J2", "storage", { ...st, shape: "TABULAR", curve: "SU1" });
  deck = await reopened(s);
  assert.deepEqual(row(deck, "[STORAGE]", "J2").slice(4, 6), ["TABULAR", "SU1"]);
  // Dividers: J3's only link out is C3.
  s.convertObjects("node", ["J3"], "DIVIDER", true);
  const dv = values(s, "node", "J3", "divider");
  assert.deepEqual([dv.type, dv.link], ["OVERFLOW", "C3"]);
  s.setGroup("node", "J3", "divider", { ...dv, type: "CUTOFF", cutoff: 2.5 });
  deck = await reopened(s);
  assert.deepEqual(row(deck, "[DIVIDERS]", "J3").slice(2, 5), ["C3", "CUTOFF", "2.5"]);
  s.setGroup("node", "J3", "divider", { ...dv, type: "WEIR", cutoff: 1, height: 2, coeff: 3.3 });
  deck = await reopened(s);
  assert.deepEqual(row(deck, "[DIVIDERS]", "J3").slice(3, 7).map((v, i) => (i ? +v : v)), ["WEIR", 1, 2, 3.3]);
  assert.throws(() => s.setGroup("node", "J3", "divider", { ...dv, link: "C1" }), /a link that leaves J3/);
  assert.throws(() => s.setGroup("node", "J3", "divider", { ...dv, type: "WEIR", height: 0, coeff: 3 }), /must be above 0/);
});

test("infiltration: each method's parameters with legacy rules; groundwater with GWF expressions", async () => {
  const s = await open(await fixture("example1.inp"));
  const inf = values(s, "subcatchment", "S1", "infiltration");
  assert.deepEqual([inf.model, inf.f0, inf.fmin, inf.decay, inf.dry], ["HORTON", 4.5, 0.2, 6.5, 7]);
  const refuse = (v, re) => assert.throws(() => s.setGroup("subcatchment", "S1", "infiltration", { ...inf, ...v }), re);
  refuse({ f0: 0.1, fmin: 0.2 }, /maximum rate cannot be below the minimum/);
  refuse({ decay: -1 }, /cannot be negative/);
  refuse({ model: "GREEN_AMPT", suction: 3, ksat: 0, imd: 0.3 }, /conductivity must be above 0/);
  refuse({ model: "GREEN_AMPT", suction: 3, ksat: 0.5, imd: 1.2 }, /between 0 and 1/);
  refuse({ model: "CURVE_NUMBER", cn: 5, cnDry: 7 }, /between 10 and 99/);
  s.setGroup("subcatchment", "S1", "infiltration", { ...inf, model: "GREEN_AMPT", suction: 3, ksat: 0.5, imd: 0.3 });
  let deck = await reopened(s);
  const r = row(deck, "[INFILTRATION]", "S1");
  assert.deepEqual(r.slice(1, 4).map(Number), [3, 0.5, 0.3]);
  assert.equal(r.at(-1), "GREEN_AMPT");
  s.setGroup("subcatchment", "S1", "infiltration", inf); // undo
  assert.deepEqual(values(s, "subcatchment", "S1", "infiltration"), inf);
  assert.ok(!s.fields("subcatchment", "S1").some((f) => f.path === "subcatchment.infiltration.model"));
  // Groundwater (kitchen: S1 on AQ1 draining to J1).
  const k = await open(await fixture("kitchen.inp"));
  const gw = values(k, "subcatchment", "S1", "groundwater");
  assert.deepEqual([gw.aquifer, gw.node, gw.surfElev, gw.a1, gw.b1], ["AQ1", "J1", 10, 0.1, 1.5]);
  assert.throws(() => k.setGroup("subcatchment", "S1", "groundwater", { ...gw, lateral: "0.001*(Hgw-" }), /Lateral flow expression: missing operand/);
  k.setGroup("subcatchment", "S1", "groundwater", { ...gw, a1: 0.2, lateral: "0.001*(Hgw-5)" });
  deck = await reopened(k);
  assert.equal(+row(deck, "[GROUNDWATER]", "S1")[4], 0.2);
  assert.ok(rows(deck, "[GWF]").some((r) => r[0] === "S1" && r[1] === "LATERAL"));
  k.setGroup("subcatchment", "S1", "groundwater", { ...gw, aquifer: "" });
  deck = await reopened(k);
  assert.equal(row(deck, "[GROUNDWATER]", "S1"), undefined);
});

test("inlets: a street conduit's inlet (design, capture node, legacy values, the shape rule) and an inlet junction's, undo", async () => {
  const s = await open(await fixture("street.inp"));
  const none = values(s, "link", "C1", "inlet");
  assert.equal(none.design, "");
  // The conduit's own ends cannot capture what its inlet takes.
  assert.deepEqual(group(s, "link", "C1", "inlet").fields.find((f) => f.name === "capture").choices.map(([v]) => v).sort(), ["J3", "O1"]);
  const on = { ...none, design: "IN1", capture: "J3", number: 2, clogged: 10, flowLimit: 1, depress: 0.5, width: 2, placement: "ON_SAG" };
  const refuse = (v, re, id = "C1") => assert.throws(() => s.setGroup("link", id, "inlet", { ...on, ...v }), re);
  refuse({ capture: "J1" }, /end of the conduit itself/);
  refuse({ capture: "" }, /Choose the node/);
  refuse({ number: 0 }, /whole number of at least 1/);
  refuse({ number: 2.5 }, /whole number/);
  refuse({ clogged: 100 }, /between 0 and 99/);
  refuse({ depress: -1 }, /cannot be negative/);
  refuse({ capture: "J1" }, /does not fit this cross-section/, "C3"); // a circular pipe takes no grate
  s.setGroup("link", "C1", "inlet", on);
  let deck = await reopened(s);
  assert.deepEqual(row(deck, "[INLET_USAGE]", "C1"), ["C1", "IN1", "J3", "2", "10", "1", "0.5", "2", "ON_SAG"]);
  assert.deepEqual(values(s, "link", "C1", "inlet"), on);
  s.setGroup("link", "C1", "inlet", none); // undo
  deck = await reopened(s);
  assert.equal(row(deck, "[INLET_USAGE]", "C1"), undefined);
  // An inlet junction (the map tool's): its card changes the values and never removes the inlet.
  const { id } = s.insertInlet("C1", 0.5, "IN1", "J3");
  const ij = values(s, "node", id, "inlet");
  assert.deepEqual([ij.design, ij.capture, ij.number, ij.placement], ["IN1", "J3", 1, "AUTOMATIC"]);
  assert.ok(!group(s, "node", id, "inlet").fields[0].choices.some(([v]) => v === ""));
  assert.throws(() => s.setGroup("node", id, "inlet", { ...ij, design: "" }), /needs an inlet design/);
  assert.throws(() => s.setGroup("node", id, "inlet", { ...ij, capture: id }), /itself/);
  s.setGroup("node", id, "inlet", { ...ij, number: 3, clogged: 20 });
  await reopened(s);
  assert.deepEqual([values(s, "node", id, "inlet").number, values(s, "node", id, "inlet").clogged], [3, 20]);
  s.setGroup("node", id, "inlet", ij); // undo
  assert.deepEqual(values(s, "node", id, "inlet"), ij);
});

test("initial quality: a value per pollutant on nodes and links, water age and temperature with their options, blank = none, undo", async () => {
  const s = await open(await fixture("example1.inp"));
  assert.deepEqual(values(s, "node", "J1", "quality"), { "q:TSS": "" });
  assert.throws(() => s.setGroup("node", "J1", "quality", { "q:TSS": -1 }), /TSS cannot be negative/);
  s.setGroup("node", "J1", "quality", { "q:TSS": 12.5 });
  s.setGroup("link", "C1", "quality", { "q:TSS": 0.2 });
  let deck = await reopened(s);
  assert.deepEqual(rows(deck, "[INITIAL_QUALITY]").map((r) => [r[0], r[1], r[2], +r[3]]), [["NODE", "J1", "TSS", 12.5], ["LINK", "C1", "TSS", 0.2]]);
  assert.deepEqual(values(s, "link", "C1", "quality"), { "q:TSS": 0.2 });
  // Water age and temperature appear with their options and may be below 0.
  s.solver.options.set("WATER_AGE", "YES");
  s.solver.options.set("HEAT_TRANSPORT", "YES");
  const q = group(s, "node", "J1", "quality");
  assert.deepEqual(q.fields.map((f) => [f.label, f.unit]), [["TSS", "MG/L"], ["Water age", "hours"], ["Temperature", "°C"]]);
  s.setGroup("node", "J1", "quality", { "q:TSS": 12.5, "q:__WATER_AGE__": 3, "q:__TEMPERATURE__": -2 });
  deck = await reopened(s);
  assert.ok(rows(deck, "[INITIAL_QUALITY]").some((r) => r[1] === "J1" && r[2] === "__TEMPERATURE__" && +r[3] === -2));
  // Undo: blank removes the rows the change made.
  s.setGroup("node", "J1", "quality", groupValues(q));
  s.setGroup("link", "C1", "quality", { "q:TSS": "" });
  deck = await reopened(s);
  assert.deepEqual(rows(deck, "[INITIAL_QUALITY]").map((r) => r.slice(0, 3)), [["NODE", "J1", "TSS"]]);
  assert.deepEqual(values(s, "node", "J1", "quality"), { "q:TSS": 12.5, "q:__WATER_AGE__": "", "q:__TEMPERATURE__": "" });
});

test("frozen ground: none, the model default (*) or values of its own, the engine's checks, undo", async () => {
  const s = await open(await fixture("example1.inp"));
  const none = values(s, "subcatchment", "S1", "frost");
  assert.equal(none.row, "");
  assert.equal(none.thickness, 0.15); // the desktop's defaults seed the values
  assert.deepEqual(group(s, "subcatchment", "S1", "frost").fields[0].choices, [["", "None"], ["own", "Own values"]]);
  const own = { ...none, row: "own", thickness: 0.2 };
  const refuse = (v, re) => assert.throws(() => s.setGroup("subcatchment", "S1", "frost", { ...own, ...v }), re);
  refuse({ thickness: 0 }, /thickness must be above 0/);
  refuse({ waterContent: 1.5 }, /between 0 and 1/);
  refuse({ deepDepth: 0.05 }, /more than half the thickness/);
  refuse({ exponent: 0.5 }, /at least 1/);
  refuse({ snowDensity: 0 }, /snow conductivity and density/);
  s.setGroup("subcatchment", "S1", "frost", own);
  let deck = await reopened(s);
  assert.deepEqual(row(deck, "[FROZEN_GROUND]", "S1").slice(1).map(Number), [0.2, 1.5, 2.4e6, 0.3, 8, 3, 5, 11, 0.25, 250]);
  // A model default row: offered as such, and it seeds a subcatchment without values of its own.
  s.solver.setFrozenGround("*", [0.3, 1.5, 2.4e6, 0.3, 8, 3, 5, 11, 0.25, 250]);
  const s2 = values(s, "subcatchment", "S2", "frost");
  assert.deepEqual([s2.row, s2.thickness], ["", 0.3]);
  assert.equal(group(s, "subcatchment", "S2", "frost").fields[0].choices[0][1], "Model default (*)");
  s.setGroup("subcatchment", "S1", "frost", none); // undo
  deck = await reopened(s);
  assert.deepEqual(rows(deck, "[FROZEN_GROUND]").map((r) => r[0]), ["*"]);
});

test("storage-node LIDs: control, saturation and bottom; layer anchors on links; undo puts depth and offsets back", async () => {
  const s = await open(await fixture("lid-nodes.inp"));
  const a = values(s, "node", "A", "lid");
  assert.deepEqual([a.control, a.saturation, a.bottom], ["Train", 10, "CURRENT"]);
  // No 2D aquifer bed under A: no mesh-aquifer bottom.
  assert.deepEqual(group(s, "node", "A", "lid").fields[2].choices.map(([v]) => v), ["CURRENT", "SEALED"]);
  const refuse = (v, re) => assert.throws(() => s.setGroup("node", "A", "lid", { ...a, ...v }), re);
  refuse({ saturation: 150 }, /between 0 and 100/);
  refuse({ control: "Nope" }, /No storage-node LID control/);
  refuse({ bottom: "MESH_AQUIFER" }, /needs an enabled 2D aquifer/);
  s.setGroup("node", "A", "lid", { ...a, saturation: 50, bottom: "SEALED" });
  let deck = await reopened(s);
  assert.deepEqual(row(deck, "[LID_NODES]", "A").slice(0, 3), ["A", "Train", "50"]);
  // The anchor of a link with one LID end: layers of A's control, top or bottom.
  const w = values(s, "link", "W_A", "lidAnchor");
  assert.deepEqual([w.layer, w.position], ["1", "BOTTOM"]);
  assert.deepEqual(group(s, "link", "W_A", "lidAnchor").fields[0].choices.map(([, l]) => l), ["— none (the link's own offset) —", "1 · Surface", "2 · Media", "3 · Aggregate"]);
  assert.equal(group(s, "link", "V_AB", "lidAnchor"), undefined); // both ends have a LID
  const offsets = () => [s.solver.links.get("W_A").offsetUp, s.solver.links.get("W_A").offsetDn];
  const before = offsets(),
    shown = group(s, "link", "W_A", "lidAnchor");
  assert.throws(() => s.setGroup("link", "W_A", "lidAnchor", { ...w, layer: "9" }), /1 to 3/);
  s.setGroup("link", "W_A", "lidAnchor", { ...w, layer: "2", position: "TOP" });
  deck = await reopened(s);
  assert.deepEqual(row(deck, "[LID_NODE_OUTLETS]", "W_A"), ["W_A", "2", "TOP"]);
  assert.notDeepEqual(offsets(), before);
  s.setGroup("link", "W_A", "lidAnchor", undoValues(shown)); // undo: the snapshot the card carried
  assert.deepEqual(offsets(), before);
  assert.deepEqual(row(decoder.decode(s.write()), "[LID_NODE_OUTLETS]", "W_A"), ["W_A", "1", "BOTTOM"]);
  // Removing the LID and undoing it: the assignment and its anchors come back exactly.
  const b = group(s, "node", "B", "lid"),
    vbr = [s.solver.links.get("V_BR").offsetUp, s.solver.links.get("V_BR").offsetDn];
  s.setGroup("node", "B", "lid", { ...groupValues(b), control: "" });
  deck = await reopened(s);
  assert.equal(row(deck, "[LID_NODES]", "B"), undefined);
  assert.equal(row(deck, "[LID_NODE_OUTLETS]", "V_BR"), undefined);
  assert.equal(group(s, "link", "V_BR", "lidAnchor"), undefined); // no LID end any more
  s.setGroup("node", "B", "lid", undoValues(b));
  deck = await reopened(s);
  assert.deepEqual(row(deck, "[LID_NODES]", "B"), ["B", "Train", "10"]);
  assert.deepEqual(row(deck, "[LID_NODE_OUTLETS]", "V_BR"), ["V_BR", "3", "BOTTOM"]);
  assert.deepEqual([s.solver.links.get("V_BR").offsetUp, s.solver.links.get("V_BR").offsetDn], vbr);
  assert.deepEqual(groupValues(group(s, "node", "B", "lid")), groupValues(b));
});

test("RDII decay of a unit hydrograph: none, exponential, with snow; the engine's checks; written, reopened, undo", async () => {
  const s = await open(await fixture("inflows.inp"));
  const uh = s.solver.inflows.getHydrographGroupId(0);
  const cards = s.groups("hydrograph", uh);
  assert.deepEqual(cards.map((g) => g.title), ["Short-term RDII decay", "Medium-term RDII decay", "Long-term RDII decay"]);
  const before = groupValues(cards[1]);
  assert.equal(before.mode, "");
  const on = { ...before, mode: "EXP_SNOW", k_dep: 0.5, k_0: 0.01, k_T: 0.02, T_ref: 20, theta_rec: 0.05, T_freeze: 0, snow_T: 1, snow_ddf: 2 };
  assert.throws(() => s.setGroup("hydrograph", uh, "decay1", { ...on, k_0: -1 }), /k_dep, k_0 and k_T cannot be negative/);
  assert.throws(() => s.setGroup("hydrograph", uh, "decay1", { ...on, snow_ddf: -1 }), /melt factor cannot be negative/);
  s.setGroup("hydrograph", uh, "decay1", on);
  let deck = await reopened(s);
  const row = rows(deck, "[RDII_DECAY]").find((r) => r[0] === uh);
  assert.ok(row, "[RDII_DECAY] row: " + JSON.stringify(rows(deck, "[RDII_DECAY]")));
  assert.deepEqual(groupValues(s.groups("hydrograph", uh)[1]), on);
  s.setGroup("hydrograph", uh, "decay1", { ...on, mode: "EXP" }); // snow off
  assert.equal(groupValues(s.groups("hydrograph", uh)[1]).mode, "EXP");
  s.setGroup("hydrograph", uh, "decay1", before); // undo: no row
  deck = await reopened(s);
  assert.equal(rows(deck, "[RDII_DECAY]").length, 0);
});

test("user flags: definitions checked, values on objects by type, written and reopened, removal undone with its values", async () => {
  const s = await open(await fixture("example1.inp"));
  assert.deepEqual(s.userFlags(), []);
  assert.deepEqual(s.groups("node", "J1").filter((g) => g.key === "userflags"), [], "no flags, no card");
  assert.throws(() => s.setUserFlags([{ name: "has space", type: "STRING" }]), /cannot hold spaces/);
  assert.throws(() => s.setUserFlags([{ name: "A", type: "STRING" }, { name: "a", type: "REAL" }]), /defined twice/);
  assert.throws(() => s.setUserFlags([{ name: "B", type: "NOPE" }]), /choose its type/);
  s.setUserFlags([{ name: "Owner", type: "STRING", description: "Who maintains it" }, { name: "Inspected", type: "BOOLEAN" }, { name: "Year", type: "INTEGER" }, { name: "Score", type: "REAL" }]);
  const card = group(s, "node", "J1", "userflags");
  assert.deepEqual(card.fields.map((f) => [f.label, f.type]), [["OWNER", "text"], ["INSPECTED", "choice"], ["YEAR", "text"], ["SCORE", "text"]]);
  assert.match(card.note, /OWNER: Who maintains it/);
  const v = groupValues(card);
  const refuse = (x, re) => assert.throws(() => s.setGroup("node", "J1", "userflags", { ...v, ...x }), re);
  refuse({ "flag:YEAR": "1999.5" }, /YEAR takes a whole number/);
  refuse({ "flag:SCORE": "high" }, /SCORE takes a number/);
  refuse({ "flag:INSPECTED": "maybe" }, /yes, no or unset/);
  s.setGroup("node", "J1", "userflags", { ...v, "flag:OWNER": "City", "flag:INSPECTED": "YES", "flag:YEAR": "1999", "flag:SCORE": "7.5" });
  s.setGroup("gage", "RainGage", "userflags", { ...groupValues(group(s, "gage", "RainGage", "userflags")), "flag:OWNER": "NOAA" });
  const deck = await reopened(s);
  const t = await open(deck);
  assert.deepEqual(groupValues(group(t, "node", "J1", "userflags")), { "flag:OWNER": "City", "flag:INSPECTED": "YES", "flag:YEAR": "1999", "flag:SCORE": "7.5" });
  assert.equal(groupValues(group(t, "gage", "RainGage", "userflags"))["flag:OWNER"], "NOAA");
  // Names are kept in capitals (the engine). A type change while the flag has values is refused; removal takes the values; undo brings them back.
  assert.throws(() => s.setUserFlags(s.userFlags().map((d) => (d.name === "YEAR" ? { ...d, type: "STRING" } : d))), /YEAR has values on objects/);
  const { restore } = s.setUserFlags(s.userFlags().filter((d) => d.name !== "OWNER"));
  assert.equal(s.userFlags().length, 3);
  assert.deepEqual(restore.values.sort(), [["GAGE", "RainGage", "OWNER", "NOAA"], ["NODE", "J1", "OWNER", "City"]].sort());
  s.setUserFlags(restore.definitions, restore.values); // undo
  assert.equal(groupValues(group(s, "node", "J1", "userflags"))["flag:OWNER"], "City");
  // Clearing a value: blank.
  s.setGroup("node", "J1", "userflags", { ...groupValues(group(s, "node", "J1", "userflags")), "flag:SCORE": "" });
  assert.equal(groupValues(group(s, "node", "J1", "userflags"))["flag:SCORE"], "");
});
