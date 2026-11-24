// Record editors (E2): time series, curves and patterns edited through the model session must mean
// what the same edit means in the deck text: the engine writes the same bytes and the run writes
// the same binary output. Fixtures: examples/ plus tests/fixtures/kitchen.inp (engine test deck
// deletion_ext/control_refs.inp: 15 record sections), transects.inp (engine
// ui_file_io_roundtrip/source.inp: relative and fractional-second series, a monthly pattern) and
// example1.inp (EPA SWMM Example 1).
// RECORDS_EVIDENCE=<dir> also saves every session-written deck there (native writer check).
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import create from "../vendor/engine/openswmm_engine.js";
import { ModelSession } from "../model.mjs";
import { simulate } from "../simulation.mjs";

const decoder = new TextDecoder();
async function deck(name) {
  const url = name.includes("/") ? new URL("../" + name, import.meta.url) : new URL("./fixtures/" + name, import.meta.url);
  return readFile(url, "utf8");
}
const project = (entry, text, extra = {}) => ({ name: entry, entry, inputs: { [entry]: new TextEncoder().encode(text), ...extra }, anchor: null, split: false });
async function evidence(name, bytes) {
  const dir = process.env.RECORDS_EVIDENCE;
  if (!dir) return;
  await mkdir(dir, { recursive: true });
  await writeFile(dir + "/" + name, bytes);
}
/** Open text in a fresh session and let the engine write it (its normalized form). */
async function normalized(entry, text) {
  const session = new ModelSession(await create());
  session.open(project(entry, text));
  const bytes = session.write();
  session.close();
  return bytes;
}
const outOf = (result) => result.files[Object.keys(result.files).find((p) => p.endsWith("/model.out"))];
/** The engine-written deck runs to the same binary output as the text-edited deck. */
async function sameRun(entry, a, b) {
  const engine = await create();
  const one = await simulate(engine, project(entry, decoder.decode(a)), () => {}, {}, 0, false, "/run-a");
  const two = await simulate(engine, project(entry, decoder.decode(b)), () => {}, {}, 0, false, "/run-b");
  assert.ok(outOf(one)?.length > 0, "the run wrote a binary output");
  assert.deepEqual(outOf(one), outOf(two), entry + ": the session edit and the text edit run identically");
}
/** Hours elapsed → a relative time series x (days after the anchor), as the editor encodes it. */
const elapsed = (anchor, hours) => anchor + (hours * 3600) / 86400;

const cases = [
  {
    entry: "coupled.inp",
    source: "examples/coupled.inp",
    edit(s) {
      const rain = s.record("timeseries", "RAIN_TS");
      rain.points[0][1] = 7.5;
      s.setRecord("timeseries", "RAIN_TS", rain);
      const rating = s.record("curve", "DOWN_RC");
      assert.equal(rating.type, "RATING");
      rating.points[2][1] = 0.2;
      rating.points.splice(4, 0, [1.5, 0.9]);
      s.setRecord("curve", "DOWN_RC", rating);
    },
    text: (t) =>
      t
        .replace(/^(RAIN_TS\s+01\/01\/2024\s+00:00\s+)5\.0/m, "$17.5")
        .replace(/^(DOWN_RC\s+0\.50\s+)0\.18/m, "$10.20")
        .replace(/^(DOWN_RC\s+1\.00\s+0\.55)$/m, "$1\nDOWN_RC 1.50 0.90"),
  },
  {
    entry: "network.inp",
    source: "examples/network.inp",
    edit(s) {
      const ts = s.record("timeseries", "TS1");
      assert.equal(ts.relative.count, ts.points.length, "every row of TS1 is elapsed time");
      ts.points[2][1] = 1.25;
      ts.points.push([elapsed(ts.relative.anchor, 1.75), 0.1]);
      ts.relative.count += 1;
      s.setRecord("timeseries", "TS1", ts);
    },
    text: (t) => t.replace(/^(TS1\s+0:30\s+)1\.0/m, "$11.25").replace(/^(TS1\s+1:30\s+0\.0)$/m, "$1\nTS1 1:45 0.1"),
  },
  {
    entry: "kitchen.inp",
    source: "kitchen.inp",
    // KINWAVE with two outlet links at J1 (ERROR 133): checked as text here; a DYNWAVE copy runs in
    // model.test.mjs.
    run: false,
    edit(s) {
      const p = s.record("pattern", "P1");
      assert.equal(p.type, "MONTHLY");
      p.factors[2] = 1.2;
      s.setRecord("pattern", "P1", p);
      const ts = s.record("timeseries", "TS1");
      ts.points[0][1] = 0.75;
      s.setRecord("timeseries", "TS1", ts);
    },
    text: (t) => t.replace(/^P1\s+MONTHLY\s+1\.0 1\.0 1\.0/m, "P1 MONTHLY 1.0 1.0 1.2").replace(/^(TS1\s+01\/01\/2026 00:00 )1\.0/m, "$10.75"),
  },
  {
    entry: "example1.inp",
    source: "example1.inp",
    edit(s) {
      const rain = s.record("timeseries", "2-yr");
      const hour = rain.points.findIndex(([x]) => Math.abs((x - rain.relative.anchor) * 24 - 1) < 1e-9);
      assert.equal(rain.points[hour][1], 0.003124);
      rain.points[hour][1] = 0.0045;
      s.setRecord("timeseries", "2-yr", rain);
    },
    text: (t) => t.replace(/^(2-yr\s+1:00\s+)0\.003124/m, "$10.0045"),
  },
  {
    entry: "transects.inp",
    source: "transects.inp",
    run: false, // a writer stress deck (unresolved snow and groundwater pieces), not a runnable model
    edit(s) {
      const frac = s.record("timeseries", "FRAC");
      assert.equal(frac.relative.count, 2, "fractional-second rows are elapsed time");
      frac.points[1][1] = 2.5;
      s.setRecord("timeseries", "FRAC", frac);
      const p = s.record("pattern", "PAT");
      p.factors[11] = 3;
      s.setRecord("pattern", "PAT", p);
    },
    text: (t) => t.replace(/^(FRAC 0:00:00\.1234567 )9\.87654321012345/m, "$12.5").replace(/^(PAT MONTHLY 2 2 2 2 2 2 2 2 2 2 2 )2/m, "$13"),
  },
  {
    entry: "inflows.inp",
    source: "inflows.inp",
    edit(s) {
      // Control rules: change a threshold and add a rule.
      const rules = s.rules().map((r) => r.text);
      rules[0] = rules[0].replace("DEPTH > 1.0", "DEPTH > 1.5");
      rules.push("RULE R3\nIF NODE J3 DEPTH > 2\nTHEN CONDUIT C3 STATUS = OPEN\nPRIORITY 3");
      s.setRules(rules);
      // Inflows at J1 change in place; J2 gains a dry-weather row and a larger sewershed.
      const j1 = s.inflows("J1");
      assert.deepEqual(j1.external.map((r) => r.constituent), ["FLOW", "TSS"]);
      j1.external[0].baseline = 0.2;
      j1.external[0].sFactor = 1.5;
      j1.dwf[0].average = 0.25;
      s.setInflows("J1", j1);
      const j2 = s.inflows("J2");
      assert.deepEqual(j2.rdii, { hydrograph: "UH1", area: 5 });
      j2.dwf.push({ constituent: "FLOW", average: 0.05, monthly: "", daily: "", hourly: "HOURLY_P", weekend: "" });
      j2.rdii.area = 6;
      s.setInflows("J2", j2);
      // Unit hydrograph: change a response, drop January's long term, add February's short term.
      const uh = s.record("hydrograph", "UH1");
      assert.equal(uh.gage, "G1");
      uh.entries.find((e) => e.month === -1 && e.response === 0).r = 0.025;
      uh.entries = uh.entries.filter((e) => !(e.month === 0 && e.response === 2));
      uh.entries.push({ month: 1, response: 0, r: 0.01, t: 2, k: 2, dmax: 0, drecov: 0, dinit: 0 });
      s.setRecord("hydrograph", "UH1", uh);
    },
    text: (t) =>
      t
        .replace("IF NODE J2 DEPTH > 1.0", "IF NODE J2 DEPTH > 1.5")
        .replace("PRIORITY 2\n", "PRIORITY 2\n\nRULE R3\nIF NODE J3 DEPTH > 2\nTHEN CONDUIT C3 STATUS = OPEN\nPRIORITY 3\n")
        .replace(/^(J1\s+FLOW\s+INFLOW_TS\s+FLOW\s+1\.0\s+)1\.0(\s+)0\.1/m, "$11.5$20.2")
        .replace(/^(J1\s+FLOW\s+)0\.2(\s+MONTHLY_P)/m, "$10.25$2")
        .replace(/^(J1\s+TSS\s+50)$/m, '$1\nJ2 FLOW 0.05 "" "" HOURLY_P')
        .replace(/^(J2\s+UH1\s+)5$/m, "$16")
        .replace(/^(UH1\s+ALL\s+SHORT\s+)0\.02/m, "$10.025")
        .replace(/^UH1\s+JAN\s+LONG.*\n/m, "")
        .replace(/^(UH1\s+ALL\s+MEDIUM.*)$/m, "$1\nUH1 FEB SHORT 0.01 2 2 0 0 0"),
  },
  {
    entry: "kitchen.inp",
    source: "kitchen.inp",
    run: false,
    edit(s) {
      s.setRules(s.rules().map((r) => r.text.replace("SIMULATION TIME > 1", "SIMULATION TIME > 1.5")));
      const j1 = s.inflows("J1");
      j1.dwf[0].average = 2;
      j1.rdii.area = 10;
      s.setInflows("J1", j1);
      const uh = s.record("hydrograph", "UH1");
      uh.entries[0].k = 3;
      s.setRecord("hydrograph", "UH1", uh);
    },
    text: (t) =>
      t
        .replace("SIMULATION TIME > 1", "SIMULATION TIME > 1.5")
        .replace(/^J1  FLOW  1\.0  P1$/m, "J1  FLOW  2  P1")
        .replace(/^J1  UH1  12\.0$/m, "J1  UH1  10")
        .replace(/^(UH1  ALL  SHORT  0\.033  1\.0  )2\.0/m, "$13"),
  },
  {
    // Water quality (increment 3): pollutant and land use properties, buildup and washoff, coverage,
    // initial loading and a treatment expression; Example 1 runs, so the .out must match too.
    entry: "example1.inp",
    source: "example1.inp",
    edit(s) {
      assert.equal(s.set("pollutant.kdecay", "TSS", 0.1), 0.1);
      s.set("landuse.sweep_interval", "Commercial", 7);
      s.set("landuse.sweep_removal", "Commercial", 0.3);
      const lu = s.landuse("Commercial");
      const tss = lu.rows.find((r) => r.pollutant === "TSS");
      assert.deepEqual(tss.buildup, { func: "EXP", c1: 0.15, c2: 0.2, c3: 0, series: "", per: "CURB" });
      tss.buildup.c1 = 0.2;
      tss.washoff.coeff = 5;
      s.setLanduse("Commercial", lu);
      const s4 = s.subQuality("S4");
      assert.deepEqual(s4.coverages.map((c) => c.percent), [9, 30, 26, 0]);
      s4.coverages[0].percent = 10;
      s4.coverages[3].percent = 20;
      s4.loadings[0].value = 2;
      s.setSubQuality("S4", s4);
      s.setTreatment("J1", { node: "J1", rows: [{ pollutant: "TSS", expression: "R = 0.3" }] });
    },
    text: (t) =>
      t
        .replace(/^(TSS\s+MG\/L\s+0\.0\s+0\.0\s+0\.0\s+)0\.0/m, "$10.1")
        .replace(/^Commercial\s+0\s+0\s+0\s*$/m, "Commercial 7 0.3 0")
        .replace(/^(Commercial\s+TSS\s+EXP\s+)0\.15/m, "$10.2")
        .replace(/^(Commercial\s+TSS\s+EXP\s+)4(\s+2\.2)/m, "$15$2")
        .replace(/^(S4\s+Residential_1\s+)9(\s*)$/m, "$110$2")
        .replace(/^(S4\s+Commercial\s+26\s*)$/m, "$1\nS4 Undeveloped 20")
        .replace(/^\[LOADINGS\]$/m, "[LOADINGS]\nS4 TSS 2") + "\n[TREATMENT]\nJ1 TSS R = 0.3\n",
  },
  {
    entry: "kitchen.inp",
    source: "kitchen.inp",
    run: false,
    edit(s) {
      assert.deepEqual(s.coPollutant("Lead"), { co: "TSS", fraction: 0.25 });
      s.setCoPollutant("Lead", { co: "TSS", fraction: 0.5 });
      s.addRecord("pollutant", "NH3", "MG/L");
      const res = s.landuse("Res");
      res.rows.find((r) => r.pollutant === "TSS").washoff.coeff = 0.2;
      s.setLanduse("Res", res);
      const com = s.landuse("Com");
      const lead = com.rows.find((r) => r.pollutant === "Lead");
      lead.buildup = { func: "EXT", c1: 10, c2: 1, c3: 0, series: "ts1", per: "AREA" }; // names match without case
      com.rows.find((r) => r.pollutant === "TSS").washoff = { func: "EMC", coeff: 10, expon: 0, cleaning: 0, bmp: 25 };
      s.setLanduse("Com", com);
      const s1 = s.subQuality("S1");
      s1.loadings.find((l) => l.pollutant === "Lead").value = 0;
      s.setSubQuality("S1", s1);
      s.setTreatment("J1", { node: "J1", rows: [{ pollutant: "TSS", expression: "C = 0.8 * Lead" }, { pollutant: "Lead", expression: "R = 0.5 * R_TSS" }] });
    },
    text: (t) =>
      t
        .replace(/^(Lead\s+UG\/L\s+0\s+0\s+0\s+0\s+NO\s+TSS\s+)0\.25/m, "$10.5")
        .replace(/^(Lead\s+UG\/L.*)$/m, "$1\nNH3 MG/L 0 0 0 0 NO * 0 0 0")
        .replace(/^(Res\s+TSS\s+EXP\s+)0\.1/m, "$10.2")
        .replace(/^(Com\s+TSS\s+POW.*)$/m, "$1\nCom Lead EXT 10 1 TS1 AREA")
        .replace(/^(Res\s+TSS\s+EXP.*)$/m, "$1\nCom TSS EMC 10 0 0 25")
        .replace(/^S1\s+Lead\s+2\.0\s*\n/m, "")
        .replace(/^J1\s+TSS\s+R = 0\.5$/m, "J1 TSS C = 0.8 * Lead\nJ1 Lead R = 0.5 * R_TSS"),
  },
  {
    // Climate (increment 4): constant evaporation in dry periods only, no recovery pattern, wind,
    // snowmelt, areal depletion and monthly adjustments.
    entry: "climate.inp",
    source: "climate.inp",
    edit(s) {
      const c = s.climate();
      assert.equal(c.temperature.source, "TIMESERIES");
      assert.equal(c.evaporation.type, "MONTHLY");
      c.evaporation = { ...c.evaporation, type: "CONSTANT", monthly: Array(12).fill(0.15), recovery: "", dryOnly: true };
      c.wind.monthly = c.wind.monthly.map((x) => x + 1);
      c.snowmelt.divide = 34;
      c.snowmelt.ati = 0.5;
      c.adc.impervious[1] = 0.95;
      c.adjustments.rainfall[5] = 1.6;
      c.adjustments.temperature[6] = 6;
      s.setClimate(c);
    },
    text: (t) =>
      t
        .replace(/^MONTHLY\s+0\.10 .*$/m, "CONSTANT 0.15")
        .replace(/^RECOVERY\s+RecovPat\n/m, "")
        .replace(/^DRY_ONLY\s+NO$/m, "DRY_ONLY YES")
        .replace(/^WINDSPEED\s+MONTHLY .*$/m, "WINDSPEED MONTHLY 2 3 4 5 6 7 8 9 10 11 12 13")
        .replace(/^SNOWMELT\s+32\.5\s+0\.45/m, "SNOWMELT 34 0.5")
        .replace(/^ADC IMPERVIOUS\s+1\.0 0\.9 /m, "ADC IMPERVIOUS 1.0 0.95 ")
        .replace(/^(RAIN\s+1\.0 1\.1 1\.2 1\.3 1\.4 )1\.5/m, "$11.6")
        .replace(/^(TEMP\s+-2 -1 0 1 2 3 )4/m, "$16"),
  },
  {
    // No air temperature, evaporation from a time series, a recovery pattern; a conductivity of
    // zero reads as one.
    entry: "climate.inp",
    source: "climate.inp",
    edit(s) {
      const c = s.climate();
      c.temperature = { ...c.temperature, source: "NONE", series: "" };
      c.evaporation = { ...c.evaporation, type: "TIMESERIES", series: "ts1", recovery: "npervpat" }; // names match without case
      c.adjustments.conductivity[0] = 0;
      c.adjustments.conductivity[11] = 0.8;
      s.setClimate(c);
    },
    text: (t) =>
      t
        .replace(/^TIMESERIES\s+TempTS\n/m, "")
        .replace(/^MONTHLY\s+0\.10 .*$/m, "TIMESERIES TS1")
        .replace(/^RECOVERY\s+RecovPat$/m, "RECOVERY NPervPat")
        .replace(/^(CONDUCT\s+)(1\.0 ){11}1\.0$/m, "$11.0 1.0 1.0 1.0 1.0 1.0 1.0 1.0 1.0 1.0 1.0 0.8"),
  },
  {
    // Transects (increment 4): roughness, points, modifiers and description of a transect in use,
    // and a new one (a trapezoid, so the deck stays valid for legacy SWMM).
    entry: "channel.inp",
    source: "channel.inp",
    edit(s) {
      const t = s.record("transect", "Upper");
      assert.deepEqual(t.modifiers, { meander: 1, stationFactor: 1, elevationOffset: 0 });
      assert.deepEqual(s.record("transect", "Lower").modifiers, { meander: 1.1, stationFactor: 0.9, elevationOffset: 0.5 });
      t.roughness = { left: 0.07, right: 0.065, channel: 0.03 };
      t.points[1][1] = 7.5;
      t.points[3][1] = 1.5;
      t.modifiers = { meander: 1.2, stationFactor: 0, elevationOffset: 0.25 }; // a factor of 0 means 1
      t.comment = "Upper reach, resurveyed 2026";
      s.setRecord("transect", "Upper", t);
      s.addRecord("transect", "Middle");
    },
    text: (t) =>
      t
        .replace(";Upper reach, surveyed 2025", ";Upper reach, resurveyed 2026")
        .replace(/^NC 0\.06 .*$/m, "NC 0.07 0.065 0.03")
        .replace(/^X1 Upper .*$/m, "X1 Upper 7 20 60 0 0 1.2 1 0.25")
        .replace(/^GR 10\s+0\s+8\s+20\s+4\s+30\s+2\s+40/m, "GR 10 0 7.5 20 4 30 1.5 40")
        .replace(/^(GR 9\s+90)$/m, "$1\nNC 0.03 0.03 0.03\nX1 Middle 6 10 30 0 0 1 1 0\nGR 5 0 5 10 0 15 0 25 5 30\nGR 5 40"),
  },
  {
    // LID controls and usage (increment 4): layers of a bio-retention cell (with its removal), a
    // permeable pavement and a rain barrel, a new swale, and one subcatchment's placements.
    entry: "lids.inp",
    source: "lids.inp",
    edit(s) {
      const bc = s.record("lid", "UBC");
      assert.equal(bc.type, "BC");
      assert.deepEqual(bc.removals, [{ pollutant: "TSS", percent: 50 }]);
      bc.layers.surface = { ...bc.layers.surface, storage: 4, vegetation: 0.1 };
      bc.layers.soil.thick = 18;
      bc.layers.drain.delay = 6;
      bc.removals[0].percent = 75;
      s.setRecord("lid", "UBC", bc);
      const pp = s.record("lid", "UPP");
      pp.layers.pavement = { ...pp.layers.pavement, thick: 4, voidRatio: 0.15, ksat: 100, regenDays: 30, regenDegree: 0.5 };
      s.setRecord("lid", "UPP", pp);
      const rb = s.record("lid", "URB");
      assert.equal(rb.layers.storage.covered, true);
      rb.layers.storage.covered = false;
      s.setRecord("lid", "URB", rb);
      s.addRecord("lid", "Swale2", "VS");
      const a = s.lidUsage("A");
      assert.deepEqual(a.rows.map((r) => r.lid), ["UBC", "URG", "UGR"]);
      a.rows[0] = { ...a.rows[0], number: 3, area: 25, drainTo: "d" }; // names match without case
      a.rows.splice(1, 1);
      a.rows.push({ lid: "UVS", number: 1, area: 10, width: 3, initSat: 0, fromImperv: 5, fromPerv: 0, toPerv: false, drainTo: "J1", reportFile: "" });
      s.setLidUsage("A", a);
    },
    text: (t) =>
      t
        .replace(/^UBC\s+SURFACE\s+3\s+\.05/m, "UBC SURFACE 4 0.1")
        .replace(/^UBC\s+SOIL\s+6 /m, "UBC SOIL 18 ")
        .replace(/^UBC\s+DRAIN\s+\.5\s+\.5\s+0\s+0$/m, "UBC DRAIN .5 .5 0 6")
        .replace(/^UBC\s+REMOVALS\s+TSS\s+50$/m, "UBC REMOVALS TSS 75")
        .replace(/^UPP\s+PAVEMENT .*$/m, "UPP PAVEMENT 4 0.15 0 100 0 30 0.5")
        .replace(/^URB\s+STORAGE\s+36\s+1\s+0\s+0\s+YES$/m, "URB STORAGE 36 1 0 0 NO")
        .replace(/^(UVS\s+SURFACE.*)$/m, "$1\nSwale2 VS\nSwale2 SURFACE 6 0 0.1 1 5")
        .replace(/^A\s+UBC\s+2\s+20\s+3\s+70\s+30\s+1\s+\*\s+B$/m, "A UBC 3 25 3 70 30 1 * D")
        .replace(/^A\s+URG .*\n/m, "")
        .replace(/^(A\s+UGR .*)$/m, "$1\nA UVS 1 10 3 0 5 0 * J1 0"),
  },
];

for (const c of cases)
  test(`${c.entry} (${c.source === c.entry ? "" : c.source + ", "}case ${cases.indexOf(c) + 1}): record edits in the session equal the same edits in the deck text`, async () => {
    const original = await deck(c.source);
    const edited = c.text(original);
    assert.notEqual(edited, original, "the text edit applies");
    const session = new ModelSession(await create());
    session.open(project(c.entry, original));
    c.edit(session);
    const written = session.write();
    session.close();
    await evidence(c.entry.replace(".inp", ".case" + (cases.indexOf(c) + 1) + ".session.inp"), written);
    const expected = await normalized(c.entry, edited);
    assert.equal(decoder.decode(written), decoder.decode(expected), "the engine writes the same deck");
    // An unchanged round trip keeps every table and pattern as read.
    const again = new ModelSession(await create());
    const summary = again.open(project(c.entry, original));
    const before = [...summary.objects.timeseries, ...summary.objects.curve].map((t) => again.record(t.type ? "curve" : "timeseries", t.id));
    const patterns = summary.objects.pattern.map((p) => again.record("pattern", p.id));
    const plain = again.write();
    again.close();
    const reread = new ModelSession(await create());
    const back = reread.open(project(c.entry, decoder.decode(plain)));
    assert.deepEqual([...back.objects.timeseries, ...back.objects.curve].map((t) => reread.record(t.type ? "curve" : "timeseries", t.id)), before);
    assert.deepEqual(back.objects.pattern.map((p) => reread.record("pattern", p.id)), patterns);
    reread.close();
    if (c.run !== false) await sameRun(c.entry, written, expected);
  });

test("records are added, renamed and deleted with their references, and a delete undoes", async () => {
  const text = (await deck("kitchen.inp")).replace("[TIMESERIES]", '[TIMESERIES]\nFROMFILE FILE "rain.dat"');
  const session = new ModelSession(await create());
  const summary = session.open(project("kitchen.inp", text, { "rain.dat": new TextEncoder().encode("01/01/2026 00:00 1.0\n") }));
  assert.deepEqual(summary.objects.pattern, [{ id: "P1", type: "MONTHLY" }]);
  // A FILE series shows its file and cannot be edited here.
  const file = session.record("timeseries", "FROMFILE");
  assert.equal(file.file, "rain.dat");
  assert.throws(() => session.setRecord("timeseries", "FROMFILE", { ...file, points: [[file.start, 1]] }), /edit that file/);
  // New records carry one placeholder row (a pattern of ones) at the model's start.
  const ts = session.addRecord("timeseries", "NEW_TS");
  assert.deepEqual(ts.points, [[ts.start, 0]]);
  assert.equal(new Date((ts.start - 25569) * 86400000).toISOString(), "2026-01-01T00:00:00.000Z");
  assert.deepEqual(session.addRecord("curve", "NEW_C", "STORAGE").points, [[0, 0]]);
  assert.equal(session.record("curve", "NEW_C").type, "STORAGE");
  assert.deepEqual(session.addRecord("pattern", "NEW_P", "HOURLY").factors, Array(24).fill(1));
  assert.throws(() => session.addRecord("curve", "NEW_C", "RATING"), /exists/);
  // Names are unique per kind, as in legacy SWMM: a curve may share a time series' name.
  assert.equal(session.addRecord("curve", "NEW_TS", "RATING").kind, "curve");
  assert.equal(session.record("timeseries", "NEW_TS").points.length, 1);
  assert.throws(() => session.addRecord("timeseries", "two words"), /no spaces/);
  assert.throws(() => session.setRecord("pattern", "NEW_P", { type: "MONTHLY", factors: [1, 2] }), /12 factors/);
  // The engine's validation reaches the caller: time must not go backwards.
  const bad = session.record("timeseries", "TS1");
  assert.throws(() => session.setRecord("timeseries", "TS1", { ...bad, points: [...bad.points].reverse() }));
  // A rename follows every reference; the impact lists them (not the STREET link C2).
  assert.equal(session.renameRecord("timeseries", "TS1", "RAIN"), "RAIN");
  assert.deepEqual(session.impact("timeseries", "RAIN"), [{ object: "gage RG1", field: "time series" }]);
  const impact = session.impact("pattern", "P1").map((e) => e.object);
  assert.deepEqual(impact, ["dwf inflow dry-weather FLOW at J1", "aquifer AQ1"]);
  const kept = session.write();
  assert.match(decoder.decode(kept), /^RG1\s+INTENSITY\s+0:05\s+1\s+TIMESERIES\s+RAIN\s*$/m);
  // Delete: the references are cleared; restoring the token brings the model back exactly.
  const { impact: cleared, token } = session.deleteRecord("pattern", "P1");
  assert.equal(cleared.length, 2);
  const gone = decoder.decode(session.write());
  assert.doesNotMatch(gone, /^P1\s/m);
  const restored = session.restore(token);
  assert.deepEqual(restored.objects.pattern.map((p) => p.id), ["P1", "NEW_P"]);
  assert.equal(decoder.decode(session.write()), decoder.decode(kept));
  session.close();
  await evidence("kitchen.records.inp", kept);
  await evidence("rain.dat", new TextEncoder().encode("01/01/2026 00:00 1.0\n"));
});

test("pollutants and land uses are added, renamed and deleted with their references; quality edits refuse bad values", async () => {
  const session = new ModelSession(await create());
  const summary = session.open(project("kitchen.inp", await deck("kitchen.inp")));
  assert.deepEqual(summary.objects.pollutant, [{ id: "TSS" }, { id: "Lead" }]);
  assert.deepEqual(summary.objects.landuse, [{ id: "Res" }, { id: "Com" }]);
  // Every reference a pollutant delete clears, including the initial loading the engine leaves out.
  assert.deepEqual(session.impact("pollutant", "TSS"), [
    { object: "land use Res", field: "buildup" },
    { object: "land use Com", field: "buildup" },
    { object: "land use Res", field: "washoff" },
    { object: "node J1", field: "treatment" },
    { object: "pollutant Lead", field: "co-pollutant" },
    { object: "subcatchment S1", field: "initial loading" },
  ]);
  assert.deepEqual(session.impact("landuse", "Com"), [
    { object: "pollutant TSS", field: "buildup" },
    { object: "subcatchment S1", field: "coverage" },
  ]);
  // A rename follows every row that names the land use.
  assert.equal(session.renameRecord("landuse", "Res", "Resid"), "Resid");
  assert.equal(session.subQuality("S1").coverages[0].landuse, "Resid");
  assert.equal(session.landuse("Resid").rows[0].buildup.func, "POW");
  assert.throws(() => session.renameRecord("pollutant", "TSS", "lead"), /taken/);
  assert.throws(() => session.addRecord("pollutant", "tss"), /exists/);
  assert.deepEqual(session.addRecord("landuse", "Park"), { kind: "landuse", id: "Park" });
  // Delete and undo.
  const before = decoder.decode(session.write());
  const { token } = session.deleteRecord("pollutant", "TSS");
  const gone = decoder.decode(session.write());
  assert.doesNotMatch(gone, /\bTSS\b/);
  session.restore(token);
  assert.equal(decoder.decode(session.write()), before);
  // Refusals, before the engine sees a value.
  const s1 = session.subQuality("S1");
  s1.coverages[1].percent = 50; // 60 + 50
  assert.throws(() => session.setSubQuality("S1", s1), /cover 110 % of it; at most 100 %/);
  const com = session.landuse("Com");
  com.rows[1].buildup = { func: "EXT", c1: 1, c2: 1, c3: 0, series: "NOPE", per: "AREA" };
  assert.throws(() => session.setLanduse("Com", com), /No time series named NOPE/);
  com.rows[1].buildup = { func: "POW", c1: 1, c2: 1, c3: 1, series: "", per: "LENGTH" };
  assert.throws(() => session.setLanduse("Com", com), /per AREA or per CURB/);
  const res = session.landuse("Resid");
  res.rows[0].washoff.cleaning = 150;
  assert.throws(() => session.setLanduse("Resid", res), /percentage, 0 to 100/);
  assert.throws(() => session.setCoPollutant("Lead", { co: "lead", fraction: 1 }), /its own co-pollutant/);
  assert.throws(() => session.setCoPollutant("Lead", { co: "TSS", fraction: -1 }), /zero or more/);
  // Treatment: the engine's grammar, the model's pollutant names.
  assert.equal(session.checkTreatment("C = 0.5 * TSS"), "");
  assert.equal(session.checkTreatment("R = 0.8 * r_tss"), "");
  assert.equal(session.checkTreatment("R = 1 - exp(-0.1*HRT)"), "");
  assert.match(session.checkTreatment("R = R_NOPE"), /No pollutant named NOPE/);
  assert.match(session.checkTreatment("C = FOO * 2"), /unknown identifier 'FOO'.*a pollutant name.*\(at character 5\)/);
  assert.throws(() => session.setTreatment("J1", { node: "J1", rows: [{ pollutant: "TSS", expression: "C = FOO" }] }), /TSS: unknown identifier/);
  assert.deepEqual(session.treatment("J1").rows, [
    { pollutant: "TSS", expression: "R = 0.5" },
    { pollutant: "Lead", expression: "" },
  ], "a refused edit changes nothing");
  // An emptied expression removes the row.
  session.setTreatment("J1", { node: "J1", rows: [{ pollutant: "TSS", expression: "" }] });
  assert.doesNotMatch(decoder.decode(session.write()), /^J1\s+TSS\s+R/m);
  session.close();
});

test("the editor's date and elapsed-time encoding matches the engine's reading of the deck", async () => {
  const { toDays, fromDays, seconds, elapsedText } = await import("../records.mjs");
  const session = new ModelSession(await create());
  session.open(project("coupled.inp", await deck("examples/coupled.inp")));
  const rain = session.record("timeseries", "RAIN_TS").points.map((p) => p[0]);
  assert.deepEqual([toDays("2024-01-01", "00:00"), toDays("2024-01-01", "02:00:00"), toDays("2024-01-01", "02:05"), toDays("2024-01-01", "06:00")], rain);
  assert.deepEqual(fromDays(rain[2]), { date: "2024-01-01", time: "02:05:00" });
  session.close();
  const network = new ModelSession(await create());
  network.open(project("network.inp", await deck("examples/network.inp")));
  const ts = network.record("timeseries", "TS1");
  assert.deepEqual(ts.points.map(([x]) => elapsedText((x - ts.relative.anchor) * 86400)), ["0:00:00", "0:15:00", "0:30:00", "0:45:00", "1:00:00", "1:15:00", "1:30:00"]);
  assert.deepEqual(ts.points.map(([x]) => x), ["0:00", "0:15", "0:30", "0:45", "1:00", "1:15", "1.5"].map((t) => ts.relative.anchor + seconds(t) / 86400));
  network.close();
});

test("rules, inflows and unit hydrographs refuse what the engine would not read back", async () => {
  const session = new ModelSession(await create());
  session.open(project("inflows.inp", await deck("inflows.inp")));
  // A rule naming a missing object is refused with the engine's message and the rule's id.
  const rules = session.rules().map((r) => r.text);
  assert.throws(() => session.setRules([...rules, "RULE BAD\nIF NODE NOPE DEPTH > 1\nTHEN CONDUIT C1 STATUS = OPEN"]), /Rule BAD, line 2: 'NOPE' is not the name of a defined NODE/);
  assert.deepEqual(session.rules().map((r) => r.id), ["R1", "R2"], "the program is unchanged");
  assert.deepEqual(session.ruleRefs("C2"), ["R1"]);
  assert.deepEqual(session.ruleRefs("J1"), []);
  // Inflow rows are checked against the model before the engine sees them.
  const j3 = session.inflows("J3");
  const bad = (change, pattern) => assert.throws(() => session.setInflows("J3", change(structuredClone(j3))), pattern);
  bad((d) => (d.external.push({ constituent: "FLOW", series: "NOPE", type: "FLOW", mFactor: 1, sFactor: 1, baseline: 0, pattern: "" }), d), /No time series named NOPE/);
  bad((d) => (d.external.push({ constituent: "TSS", series: "CONC_TS", type: "FLOW", mFactor: 1, sFactor: 1, baseline: 0, pattern: "" }), d), /CONCEN or MASS/);
  bad((d) => (d.external.push({ constituent: "LEAD", series: "CONC_TS", type: "CONCEN", mFactor: 1, sFactor: 1, baseline: 0, pattern: "" }), d), /No pollutant named LEAD/);
  bad((d) => (d.dwf.push({ ...d.dwf[0], constituent: "flow" }), d), /one dry-weather inflow per constituent/);
  bad((d) => ((d.dwf[0].monthly = "HOURLY_P"), d), /No monthly pattern named HOURLY_P/);
  bad((d) => ((d.rdii = { hydrograph: "NOPE", area: 1 }), d), /No unit hydrograph named NOPE/);
  bad((d) => ((d.rdii = { hydrograph: "UH1", area: -1 }), d), /zero or more/);
  assert.deepEqual(session.inflows("J3"), j3, "a refused edit changes nothing");
  // Names are matched without case and stored as the model spells them.
  const added = session.setInflows("J3", { ...j3, external: [{ constituent: "tss", series: "conc_ts", type: "mass", mFactor: 1, sFactor: 1, baseline: 0, pattern: "" }] });
  assert.deepEqual(added.external[0], { constituent: "TSS", series: "CONC_TS", type: "MASS", mFactor: 1, sFactor: 1, baseline: 0, pattern: "" });
  // Unit hydrographs: gage and ranges checked; a new group, a rename that follows the RDII rows, a delete and its undo.
  const uh = session.record("hydrograph", "UH1");
  assert.throws(() => session.setRecord("hydrograph", "UH1", { ...uh, gage: "NOGAGE" }), /No rain gage named NOGAGE/);
  assert.throws(() => session.setRecord("hydrograph", "UH1", { ...uh, entries: [...uh.entries, { ...uh.entries[0] }] }), /one row per response/);
  assert.throws(() => session.setRecord("hydrograph", "UH1", { ...uh, entries: [{ ...uh.entries[0], month: 12 }] }), /0 to 11/);
  assert.deepEqual(session.addRecord("hydrograph", "UH2"), { kind: "hydrograph", id: "UH2", gage: "G1", entries: [] });
  assert.equal(session.renameRecord("hydrograph", "UH1", "SEWER"), "SEWER");
  assert.deepEqual(session.inflows("J2").rdii, { hydrograph: "SEWER", area: 5 });
  assert.deepEqual(session.impact("hydrograph", "SEWER"), [{ object: "RDII at J2", field: "unit hydrograph" }]);
  const before = decoder.decode(session.write());
  const { token } = session.deleteRecord("hydrograph", "SEWER");
  assert.equal(session.inflows("J2").rdii, null, "the RDII row went with it");
  session.restore(token);
  assert.equal(decoder.decode(session.write()), before);
  session.close();
});

test("climate edits refuse what legacy SWMM would not read, and keep a climate file", async () => {
  const s = new ModelSession(await create());
  s.open(project("climate.inp", await deck("climate.inp")));
  const c = s.climate();
  const refused = (patch, message) => {
    const d = structuredClone(c);
    patch(d);
    assert.throws(() => s.setClimate(d), message);
  };
  refused((d) => (d.temperature.series = "NOPE"), /Air temperature: no time series named NOPE/);
  refused((d) => (d.temperature.source = "FILE"), /climate file is kept/);
  refused((d) => (d.evaporation.type = "TEMPERATURE"), /needs a climate file/);
  refused((d) => (d.evaporation.type = "FILE"), /needs a climate file/);
  refused((d) => (d.wind.type = "FILE"), /needs a climate file/);
  refused((d) => (d.evaporation.recovery = "NOPE"), /no time pattern named NOPE/);
  refused((d) => (d.snowmelt.ati = 2), /ATI weight: a fraction/);
  refused((d) => (d.snowmelt.latitude = 95), /Latitude/);
  refused((d) => (d.adc.pervious[3] = 1.5), /Areal depletion \(pervious\), value 4/);
  refused((d) => (d.adjustments.rainfall[0] = "x"), /Rainfall multipliers, value 1: enter a number/);
  assert.deepEqual(s.climate(), c, "nothing changed");
  // The workbench does not choose climate files (engine item 14); a deck's own file is kept.
  const withFile = (await deck("climate.inp")).replace(/^TIMESERIES\s+TempTS$/m, "FILE climate.dat 01/01/2020");
  const f = new ModelSession(await create());
  f.open(project("climate.inp", withFile, { "climate.dat": new TextEncoder().encode("") }));
  const fc = f.climate();
  assert.equal(fc.temperature.source, "FILE");
  assert.equal(fc.temperature.file, "climate.dat");
  fc.evaporation.type = "TEMPERATURE";
  fc.wind.type = "FILE";
  f.setClimate(fc);
  assert.match(decoder.decode(f.write()), /^FILE\s+"?climate\.dat"?\s+01\/01\/2020/m);
  assert.throws(() => f.setClimate({ ...fc, temperature: { source: "NONE", series: "" } }), /climate file is kept/);
  f.close();
  s.close();
});

test("transects: a rename waits while links use one, a delete makes their sections circular, bad points are refused", async () => {
  const s = new ModelSession(await create());
  s.open(project("channel.inp", await deck("channel.inp")));
  assert.deepEqual(s.impact("transect", "Upper"), [{ object: "link R1", field: "cross-section" }]);
  assert.throws(() => s.renameRecord("transect", "Upper", "UpperReach"), /Links R1 use Upper; a transect in use cannot be renamed yet/);
  const t = s.record("transect", "Lower");
  const refused = (patch, message) => {
    const d = structuredClone(t);
    patch(d);
    assert.throws(() => s.setRecord("transect", "Lower", d), message);
  };
  refused((d) => (d.points = [[0, 9]]), /at least two points/);
  refused((d) => (d.points[2][0] = 5), /Point 3: stations run from left to right/);
  refused((d) => (d.points = d.points.map(([x]) => [x, 4])), /no depth/);
  refused((d) => (d.roughness.channel = 0), /Channel n: a number greater than zero/);
  refused((d) => (d.roughness.left = 0), /Left overbank n: a number greater than zero/);
  refused((d) => (d.banks = { left: 80, right: 20 }), /left bank station is right of the right bank/);
  refused((d) => (d.modifiers.meander = -1), /Meander factor/);
  assert.deepEqual(s.record("transect", "Lower"), t, "nothing changed");
  // An unused transect renames; a delete of one in use turns its links circular, and undo restores.
  s.addRecord("transect", "Spare");
  s.renameRecord("transect", "Spare", "Reserve");
  assert.equal(s.summary().objects.transect.map((x) => x.id).join(), "Upper,Lower,Reserve");
  const { token, impact } = s.deleteRecord("transect", "Lower");
  assert.deepEqual(impact, [{ object: "link R2", field: "cross-section" }]);
  assert.match(decoder.decode(s.write()), /^R2\s+CIRCULAR\s/m);
  s.restore(token);
  assert.match(decoder.decode(s.write()), /^R2\s+IRREGULAR\s+Lower\s/m);
  s.close();
});

test("LID controls and usage refuse what legacy SWMM would not run; renames follow, deletes take their placements", async () => {
  const s = new ModelSession(await create());
  s.open(project("lids.inp", await deck("lids.inp")));
  const bc = s.record("lid", "UBC");
  const refused = (patch, message) => {
    const d = structuredClone(bc);
    patch(d);
    assert.throws(() => s.setRecord("lid", "UBC", d), message);
  };
  refused((d) => (d.type = "RG"), /in use keeps its type/);
  refused((d) => (d.layers.soil.wp = 0.3), /Soil: porosity above field capacity above wilting point/);
  refused((d) => (d.layers.soil.thick = 0), /Soil: this LID type needs a soil layer/);
  refused((d) => (d.layers.drain = { ...d.layers.drain, open: 1, close: 2 }), /Drain: the open level is above the closed level/);
  refused((d) => (d.layers.surface.vegetation = 1), /vegetation volume fraction is less than 1/);
  refused((d) => (d.layers.storage.ksat = -1), /Storage: seepage rate is a number, zero or more/);
  refused((d) => (d.removals[0].percent = 150), /Removal of TSS is a percentage/);
  assert.deepEqual(s.record("lid", "UBC"), bc, "nothing changed");
  const a = s.lidUsage("A");
  const usage = (patch, message) => assert.throws(() => s.setLidUsage("A", { rows: a.rows.map((r, i) => (i ? r : { ...r, ...patch })) }), message);
  usage({ number: 0 }, /Row 1: the number of units is a whole number, 1 or more/);
  usage({ initSat: 150 }, /Row 1: the initial saturation is a percentage/);
  usage({ drainTo: "NOPE" }, /no subcatchment or node named NOPE/);
  usage({ number: 100, area: 5000 }, /cover 500040 ft², more than its area \(217800\)/);
  usage({ fromImperv: 80 }, /treat more than 100 % of its impervious area/);
  assert.deepEqual(s.lidUsage("A"), a, "nothing changed");
  // A new control starts with the layers its type needs; an unused one may change type.
  const added = s.addRecord("lid", "Cell", "BC");
  assert.deepEqual(Object.keys(added.layers), ["surface", "soil", "storage", "drain"]);
  assert.equal(s.setRecord("lid", "Cell", { ...added, type: "IT", layers: { ...added.layers } }).type, "IT");
  s.renameRecord("lid", "UBC", "Planter");
  assert.equal(s.lidUsage("A").rows[0].lid, "Planter");
  assert.deepEqual(s.impact("lid", "UPP"), [{ object: "subcatchment B", field: "LID usage" }]);
  s.deleteRecord("lid", "UPP");
  assert.deepEqual(s.lidUsage("B").rows.map((r) => r.lid), ["UIT", "URB"]);
  s.close();
});
