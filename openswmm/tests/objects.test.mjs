// Editors for non-visual objects (interaction phase E3a): aquifers and snowpacks as records — read,
// checked as legacy SWMM checks them, saved into the deck the engine writes, created with values SWMM
// accepts, renamed with their references, deleted with the references listed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import create from "../vendor/engine/openswmm_engine.js";
import { ModelSession, aquiferDefaults, snowpackDefaults } from "../model.mjs";

const decoder = new TextDecoder();
async function open(name) {
  const text = await readFile(new URL("./fixtures/" + name, import.meta.url), "utf8");
  const session = new ModelSession(await create());
  session.open({ name, entry: name, inputs: { [name]: new TextEncoder().encode(text) }, anchor: null, split: false });
  return session;
}
/** The rows of one section in the deck the engine writes now. */
const rows = (session, section) => {
  const text = decoder.decode(session.write());
  const out = [];
  let on = false;
  for (const line of text.split(/\r?\n/)) {
    const t = line.split(";")[0].trim();
    if (t.startsWith("[")) on = t.toUpperCase() === section;
    else if (on && t) out.push(t.split(/\s+/));
  }
  return out;
};

test("aquifers: read, checked as legacy SWMM, saved, created, renamed with their groundwater rows, deleted", async () => {
  const s = await open("kitchen.inp");
  assert.deepEqual(s.summary().objects.aquifer, [{ id: "AQ1" }]);
  const a = s.record("aquifer", "aq1");
  assert.equal(a.id, "AQ1");
  assert.equal(a.params.porosity, 0.5);
  assert.equal(a.params.waterTableElev, 8);
  assert.equal(a.evapPattern, "P1");
  assert.deepEqual(s.impact("aquifer", "AQ1").map((u) => u.object), ["subcatchment S1"]);
  // Legacy checks.
  const bad = (changes, re) => assert.throws(() => s.setRecord("aquifer", "AQ1", { params: { ...a.params, ...changes }, evapPattern: a.evapPattern }), re);
  bad({ porosity: 0 }, /Porosity must be above 0/);
  bad({ fieldCapacity: 0.6 }, /Field capacity must be below porosity/);
  bad({ wiltingPoint: 0.4 }, /Wilting point must be below field capacity/);
  bad({ conductivity: 0 }, /Conductivity must be above 0/);
  bad({ tensionSlope: -1 }, /Tension slope cannot be negative/);
  bad({ waterTableElev: -1 }, /water table cannot be below/);
  bad({ upperMoisture: 0.1 }, /between the wilting point and porosity/);
  bad({ porosity: "x" }, /needs a number/);
  assert.throws(() => s.setRecord("aquifer", "AQ1", { params: a.params, evapPattern: "NOPE" }), /No time pattern named NOPE/);
  // Saved: the written [AQUIFERS] row carries the new values.
  s.setRecord("aquifer", "AQ1", { params: { ...a.params, conductivity: 2.5, waterTableElev: 9 }, evapPattern: "" });
  const row = rows(s, "[AQUIFERS]").find((r) => r[0] === "AQ1");
  assert.equal(+row[4], 2.5);
  assert.equal(+row[11], 9);
  assert.equal(row.length, 13, "no evaporation pattern written");
  // Created with values legacy SWMM accepts; renamed; the groundwater row follows.
  const n = s.addRecord("aquifer", "Deep");
  assert.deepEqual(n.params, aquiferDefaults);
  assert.deepEqual(s.checkAquifer(n), []);
  assert.throws(() => s.addRecord("aquifer", "deep"), /exists/);
  assert.equal(s.renameRecord("aquifer", "AQ1", "Shallow"), "Shallow");
  assert.equal(rows(s, "[GROUNDWATER]").find((r) => r[0] === "S1")[1], "Shallow");
  // Deleted: the impact is listed and the deck no longer has it.
  const { impact } = s.deleteRecord("aquifer", "Shallow");
  assert.deepEqual(impact.map((u) => u.object), ["subcatchment S1"]);
  assert.deepEqual(rows(s, "[AQUIFERS]").map((r) => r[0]), ["Deep"]);
  s.close();
});

test("snowpacks: read, checked as legacy SWMM, saved, created, deleted", async () => {
  const s = await open("kitchen.inp");
  assert.deepEqual(s.summary().objects.snowpack, [{ id: "SP1" }]);
  const p = s.record("snowpack", "SP1");
  assert.equal(p.plowable.last, 0.5, "the plowable fraction of impervious area");
  assert.equal(p.impervious.tbase, 32);
  assert.equal(p.removal.dsnow, 1);
  assert.equal(p.removalSubcatch, "S2");
  const bad = (changes, re) => assert.throws(() => s.setRecord("snowpack", "SP1", { ...p, ...changes }), re);
  bad({ pervious: { ...p.pervious, cmin: 0.01, cmax: 0.001 } }, /Pervious: the minimum melt coefficient exceeds the maximum/);
  bad({ impervious: { ...p.impervious, fwfrac: 1.5 } }, /Impervious: the free water capacity/);
  bad({ plowable: { ...p.plowable, last: 2 } }, /plowable fraction/);
  bad({ removal: { ...p.removal, fout: 0.6, fimp: 0.6 } }, /add up to more than 1/);
  bad({ removalSubcatch: "NOPE" }, /No subcatchment named NOPE/);
  s.setRecord("snowpack", "SP1", { ...p, impervious: { ...p.impervious, cmax: 0.002 }, removal: { ...p.removal, fout: 0.25 }, removalSubcatch: "" });
  const written = rows(s, "[SNOWPACKS]").filter((r) => r[0] === "SP1");
  assert.equal(+written.find((r) => r[1] === "IMPERVIOUS")[3], 0.002);
  const removal = written.find((r) => r[1] === "REMOVAL");
  assert.equal(+removal[3], 0.25);
  assert.equal(removal.length, 8, "no receiving subcatchment written");
  const n = s.addRecord("snowpack", "Hills");
  assert.deepEqual({ ...n, kind: undefined, id: undefined }, { ...snowpackDefaults("US"), kind: undefined, id: undefined });
  assert.deepEqual(s.checkSnowpack(n), []);
  assert.equal(snowpackDefaults("SI").plowable.tbase, 0, "°C base temperature in SI");
  s.deleteRecord("snowpack", "SP1");
  assert.deepEqual([...new Set(rows(s, "[SNOWPACKS]").map((r) => r[0]))], ["Hills"]);
  s.close();
});

test("streets: read, checked as legacy SWMM reads them, saved, created, renamed with their links", async () => {
  const s = await open("kitchen.inp");
  assert.deepEqual(s.summary().objects.street, [{ id: "ST1" }]);
  const st = s.record("street", "st1");
  assert.deepEqual([st.params.tCrown, st.params.hCurb, st.params.sx, st.params.sides, st.params.backWidth], [20, 0.5, 4, 1, 20]);
  assert.deepEqual(s.impact("street", "ST1").map((u) => u.object), ["inlet IN1 on link C2", "link C2"], "the street link and the inlet placed on it");
  const bad = (changes, re) => assert.throws(() => s.setRecord("street", "ST1", { params: { ...st.params, ...changes } }), re);
  bad({ hCurb: 0 }, /curb height must be above 0/);
  bad({ sides: 3 }, /1 or 2 sides/);
  bad({ backSlope: 0 }, /A backing needs a slope and a Manning n/);
  bad({ gutterWidth: -1 }, /cannot be negative/);
  s.setRecord("street", "ST1", { params: { ...st.params, tCrown: 15, sides: 2 } });
  const row = rows(s, "[STREETS]").find((r) => r[0] === "ST1");
  assert.deepEqual([+row[1], +row[7]], [15, 2]);
  const n = s.addRecord("street", "Lane");
  assert.deepEqual(s.checkStreet(n), []);
  assert.equal(s.renameRecord("street", "ST1", "Main"), "Main");
  assert.deepEqual(rows(s, "[XSECTIONS]").find((r) => r[0] === "C2").slice(1, 3), ["STREET", "Main"]);
  s.close();
});

test("inlets: designs by type, checked, saved (a combination writes a grate and a curb row), deleted", async () => {
  const s = await open("kitchen.inp");
  const inl = s.record("inlet", "IN1");
  assert.equal(inl.type, "GRATE");
  assert.deepEqual([inl.grate.length, inl.grate.width, inl.grate.grateType], [2, 2, "P_BAR_50"]);
  const users = s.impact("inlet", "IN1");
  assert.equal(users.length, 1, "its placement on C2");
  const bad = (data, re) => assert.throws(() => s.setRecord("inlet", "IN1", { ...inl, ...data }), re);
  bad({ grate: { ...inl.grate, length: 0 } }, /grate length must be above 0/);
  bad({ grate: { ...inl.grate, grateType: "GENERIC", openArea: 0, splashVeloc: 0 } }, /open area must be above 0/);
  bad({ type: "CUSTOM", curve: "" }, /names a diversion or rating curve/);
  bad({ type: "CURB", curb: { length: 2, height: 0, throat: "VERTICAL" } }, /curb opening height must be above 0/);
  s.setRecord("inlet", "IN1", { ...inl, type: "COMBO", curb: { length: 3, height: 0.5, throat: "INCLINED" } });
  const written = rows(s, "[INLETS]").filter((r) => r[0] === "IN1");
  assert.deepEqual(written.map((r) => r[1]), ["GRATE", "CURB"], "a combination is a grate row and a curb row");
  assert.deepEqual([+written[1][2], +written[1][3], written[1][4]], [3, 0.5, "INCLINED"]);
  assert.equal(s.record("inlet", "IN1").type, "COMBO");
  const n = s.addRecord("inlet", "Slot1", "SLOTTED");
  assert.equal(n.type, "SLOTTED");
  assert.deepEqual(s.checkInlet(n), []);
  const { impact } = s.deleteRecord("inlet", "IN1");
  assert.equal(impact.length, 1);
  assert.deepEqual([...new Set(rows(s, "[INLETS]").map((r) => r[0]))], ["Slot1"]);
  assert.deepEqual(rows(s, "[INLET_USAGE]"), [], "its placement goes with it");
  s.close();
});

test("events: read and written on the model's clock, the start before the end", async () => {
  const s = await open("kitchen.inp");
  const before = s.events();
  const rows = [
    { start: "2024-01-01 00:00", end: "2024-01-01 06:30" },
    { start: "2024-01-02 12:00", end: "2024-01-03 00:00" },
  ];
  assert.deepEqual(s.setEvents(rows), rows);
  const written = rows_(s);
  assert.equal(written.length, 2);
  assert.deepEqual(written[0], ["01/01/2024", "00:00", "01/01/2024", "06:30"], "SWMM's date format, no time zone shift");
  assert.throws(() => s.setEvents([{ start: "2024-01-02 00:00", end: "2024-01-01 00:00" }]), /Event 1: the start must come before the end/);
  assert.throws(() => s.setEvents([{ start: "2024-13-01 00:00", end: "2024-01-01 00:00" }]), /Event 1: dates are YYYY-MM-DD HH:MM/);
  assert.deepEqual(s.events(), rows, "a refused change leaves the events as they were");
  s.setEvents(before);
  s.close();
});
function rows_(s) {
  return rows(s, "[EVENTS]");
}
