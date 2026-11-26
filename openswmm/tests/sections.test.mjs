// Project sections as cards (interaction phase E3c): [TITLE], [REPORT] (RPT_* options) and [FILES] —
// read, checked where the engine accepts what a run would refuse, written into a deck that opens again,
// and put back (undo).
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import create from "../vendor/engine/openswmm_engine.js";
import { ModelSession } from "../model.mjs";
import { groupValues } from "../properties.mjs";

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
