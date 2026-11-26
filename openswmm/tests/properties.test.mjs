// Properties of map objects the field catalog has no rows for (interaction phase E3b): cross-sections,
// losses, coefficients, pump curves, outfalls, storage units, dividers, infiltration and groundwater —
// read, checked as legacy SWMM 5.2.4 checks them, written by the engine into a deck that opens again,
// and put back (undo).
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import create from "../vendor/engine/openswmm_engine.js";
import { ModelSession } from "../model.mjs";
import { groupValues } from "../properties.mjs";

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
