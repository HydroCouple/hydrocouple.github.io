// Project sections as cards (interaction phase E3c): [TITLE], [REPORT] (RPT_* options) and [FILES] —
// read, checked where the engine accepts what a run would refuse, written into a deck that opens again,
// and put back (undo).
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import create from "../vendor/engine/openswmm_engine.js";
import { ModelSession } from "../model.mjs";
import { groupValues, undoValues } from "../properties.mjs";

const decoder = new TextDecoder();
const fixture = (name) => readFile(new URL("./fixtures/" + name, import.meta.url), "utf8");
async function open(text, extra = {}, name = "m.inp") {
  const session = new ModelSession(await create());
  const inputs = { [name]: new TextEncoder().encode(text) };
  for (const [n, t] of Object.entries(extra)) inputs[n] = new TextEncoder().encode(t);
  session.open({ name, entry: name, inputs, anchor: null, split: false });
  return session;
}
/** A section's lines as written (whole lines, ";;" comment lines dropped). */
function lines(text, section) {
  const out = [];
  let on = false;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith("[")) on = t.toUpperCase() === section;
    else if (on && t && !t.startsWith(";;")) out.push(t.split(/\s+/).join(" "));
  }
  return out;
}
async function reopened(session) {
  const text = decoder.decode(session.write());
  (await open(text)).close();
  return text;
}
const values = (s, kind) => groupValues(s.groups(kind, null)[0]);

test("title and notes: the engine's lines in one text, written back, undo", async () => {
  const s = await open(await fixture("example1.inp"));
  const before = values(s, "title");
  assert.match(before.text, /A site surface drainage model\./);
  assert.deepEqual(s.fields("title", null), []);
  s.setGroup("title", null, "title", { text: "Pond study\r\nRevised 2026-11-26" });
  let deck = await reopened(s);
  assert.deepEqual(lines(deck, "[TITLE]"), ["Pond study", "Revised 2026-11-26"]);
  assert.equal(values(s, "title").text, "Pond study\nRevised 2026-11-26");
  s.setGroup("title", null, "title", before); // undo
  deck = await reopened(s);
  assert.deepEqual(lines(deck, "[TITLE]"), ["A site surface drainage model.", "See Site_Drainage_Model.txt for more details."]);
});

test("report: summary sections, objects to report (names checked), signed heads; off the options list; undo", async () => {
  const s = await open(await fixture("example1.inp"));
  const before = values(s, "report");
  assert.deepEqual(
    [before.disabled, before.input, before.continuity, before.flowstats, before.controls, before.averages, before.linksteps, before.signedHeads, before.subcatchments, before.nodes, before.links],
    ["NO", "NO", "YES", "YES", "NO", "NO", "NO", "NO", "ALL", "ALL", "ALL"],
  );
  assert.ok(!s.fields("options", null).some((r) => /^options\.(RPT_|REPORT_SIGNED_HEADS)/.test(r.path)), "report rows left the options list");
  const refuse = (v, re) => assert.throws(() => s.setGroup("report", null, "report", { ...before, ...v }), re);
  refuse({ nodes: "SOME", nodesList: "" }, /Name the nodes to report, or choose None/);
  refuse({ nodes: "SOME", nodesList: "J1 NOPE GONE" }, /No nodes NOPE, GONE in this model/);
  refuse({ links: "SOME", linksList: "XYZ" }, /No link XYZ in this model/);
  // A refusal writes nothing, not even the valid part.
  assert.equal(values(s, "report").nodes, "ALL");
  s.setGroup("report", null, "report", { ...before, input: "YES", controls: "YES", nodes: "SOME", nodesList: "j1, J2", links: "NONE" });
  let deck = await reopened(s);
  const rpt = lines(deck, "[REPORT]");
  assert.ok(rpt.includes("INPUT YES") && rpt.includes("CONTROLS YES") && rpt.includes("LINKS NONE"), rpt.join(" | "));
  assert.ok(rpt.some((r) => /^NODES J1( |$)/.test(r)) && rpt.join(" ").includes("J2"), "canonical node names: " + rpt.join(" | "));
  const now = values(s, "report");
  assert.deepEqual([now.input, now.nodes, now.nodesList, now.links], ["YES", "SOME", "J1 J2", "NONE"]);
  s.setGroup("report", null, "report", { ...before, disabled: "YES" });
  assert.equal(values(s, "report").disabled, "YES");
  s.setGroup("report", null, "report", before); // undo
  assert.deepEqual(values(s, "report"), before);
  await reopened(s);
});

test("files: use (a project file only) and save rows, inflows, outflows, hot start; undo clears them", async () => {
  const s = await open(await fixture("example1.inp"), { "rain.dat": "RG1 2026 1 1 0 0 0.1\n", "start.hsf": "" });
  const before = values(s, "files");
  assert.deepEqual(before, { rainfallMode: "", rainfallPath: "", runoffMode: "", runoffPath: "", rdiiMode: "", rdiiPath: "", inflows: "", outflows: "", hotstart: "" });
  const refuse = (v, re) => assert.throws(() => s.setGroup("files", null, "files", { ...before, ...v }), re);
  refuse({ rainfallMode: "USE", rainfallPath: "nope.dat" }, /Rainfall file nope.dat is not one of the project's files \(m.inp, rain.dat, start.hsf\)/);
  refuse({ runoffMode: "SAVE", runoffPath: "" }, /Name the runoff file to save/);
  refuse({ hotstart: "gone.hsf" }, /Hot-start file gone.hsf is not one of the project's files/);
  refuse({ outflows: 'a"b.txt' }, /cannot hold quotes/);
  refuse({ rdiiMode: "MAYBE", rdiiPath: "x" }, /Choose Use, Save or none for the rdii file/);
  s.setGroup("files", null, "files", { ...before, rainfallMode: "USE", rainfallPath: "rain.dat", runoffMode: "SAVE", runoffPath: "runoff.dat", outflows: "outflows.txt", hotstart: "start.hsf" });
  let deck = await reopened(s);
  assert.deepEqual(lines(deck, "[FILES]").sort(), ['SAVE OUTFLOWS "outflows.txt"', 'SAVE RUNOFF "runoff.dat"', 'USE HOTSTART "start.hsf"', 'USE RAINFALL "rain.dat"']);
  const now = values(s, "files");
  assert.deepEqual([now.rainfallMode, now.rainfallPath, now.runoffMode, now.runoffPath, now.outflows, now.hotstart], ["USE", "rain.dat", "SAVE", "runoff.dat", "outflows.txt", "start.hsf"]);
  s.setGroup("files", null, "files", before); // undo
  deck = await reopened(s);
  assert.deepEqual(lines(deck, "[FILES]"), []);
  assert.deepEqual(values(s, "files"), before);
});

test("transport (ARD): the first change registers <stem>.ard, Apply writes it, reopen keeps it, undo removes it", async () => {
  const s = await open(await fixture("example1.inp"));
  // The lossy rows left the model settings (owner 2026-11-26).
  assert.ok(!s.fields("model", null).some((r) => /^(transport|heat)\./.test(r.path)));
  const shown = s.groups("transport", null)[0],
    before = groupValues(shown);
  assert.deepEqual(before, { dispersion: "OFF", coefficient: 0, spacing: 0, detailed: "" });
  assert.equal(shown.restore.registered, false);
  assert.match(shown.note, /registers the transport component with m\.ard/);
  const refuse = (v, re) => assert.throws(() => s.setGroup("transport", null, "transport", { ...before, ...v }), re);
  refuse({ dispersion: "VALUE", coefficient: -1 }, /coefficient must be 0 or more/);
  refuse({ spacing: -2 }, /spacing must be 0/);
  refuse({ detailed: 'a"b.csv' }, /cannot hold quotes/);
  assert.equal([...s.solver.processComponents].length, 0, "a refusal registers nothing");
  s.setGroup("transport", null, "transport", { dispersion: "VALUE", coefficient: 0.25, spacing: 12, detailed: "cells.csv" });
  const files = s.writeAll();
  assert.deepEqual(Object.keys(files).sort(), ["m.ard", "m.inp"]);
  const ard = lines(decoder.decode(files["m.ard"]), "[TRANSPORT_OPTIONS]");
  assert.ok(ard.includes("DISPERSION 0.25") && ard.includes("TARGET_DX 12"), ard.join(" | "));
  assert.ok(lines(decoder.decode(files["m.inp"]), "[PROCESS_COMPONENTS]")[0].startsWith("org.hydrocouple.openswmm.transport.ard"));
  const t = await open(decoder.decode(files["m.inp"]), { "m.ard": decoder.decode(files["m.ard"]) });
  assert.deepEqual(values(t, "transport"), { dispersion: "VALUE", coefficient: 0.25, spacing: 12, detailed: "cells.csv" });
  assert.deepEqual(t.groups("components", null)[0].fields.map((f) => [f.label, f.readonly]), [["org.hydrocouple.openswmm.transport.ard", true]]);
  // Undo of the first change: values back and the component gone.
  s.setGroup("transport", null, "transport", undoValues(shown));
  assert.deepEqual(values(s, "transport"), before);
  assert.deepEqual(Object.keys(s.writeAll()), ["m.inp"]);
});

test("snow (UEB): parameters with the desktop's ranges, schemes, monthly ranges; written, reopened, undo", async () => {
  const s = await open(await fixture("example1.inp"));
  const before = values(s, "ueb");
  assert.deepEqual([before.SURFACE_TEMP, before.PRECIP_SPLIT, before.ZM, before.range0], ["MODIFIED_FORCE_RESTORE", "UEB", 2, 0]);
  assert.throws(() => s.setGroup("ueb", null, "ueb", { ...before, ZM: 0 }), /Measurement height \(m\) is between 0.000001 and 1000/);
  assert.throws(() => s.setGroup("ueb", null, "ueb", { ...before, range3: 120 }), /April's temperature range is between 0 and 100/);
  s.setGroup("ueb", null, "ueb", { ...before, ZM: 3, PRECIP_SPLIT: "DIVT", range0: 8.5 });
  const deck = decoder.decode(s.writeAll()["m.inp"]);
  const ueb = lines(deck, "[UEB_OPTIONS]");
  assert.ok(ueb.includes("ZM 3") && ueb.includes("PRECIP_SPLIT DIVT"), ueb.join(" | "));
  const t = await open(deck);
  const back = values(t, "ueb");
  assert.deepEqual([back.ZM, back.PRECIP_SPLIT, back.range0], [3, "DIVT", 8.5]);
  s.setGroup("ueb", null, "ueb", before); // undo
  assert.deepEqual(values(s, "ueb"), before);
});
