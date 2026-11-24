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
];

for (const c of cases)
  test(`${c.entry}: table and pattern edits in the session equal the same edits in the deck text`, async () => {
    const original = await deck(c.source);
    const edited = c.text(original);
    assert.notEqual(edited, original, "the text edit applies");
    const session = new ModelSession(await create());
    session.open(project(c.entry, original));
    c.edit(session);
    const written = session.write();
    session.close();
    await evidence(c.entry.replace(".inp", ".session.inp"), written);
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
