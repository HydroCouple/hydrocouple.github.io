/**
 * Project sections edited as one card each (interaction phase E3c): [TITLE], [REPORT] (the engine's
 * RPT_* options) and [FILES], with the deck's [PLUGINS] listed. Read as property groups (the shape of
 * properties.mjs: `{key, title, fields, note}`) and written back whole, checked here where the engine
 * accepts what a run would refuse (an unknown name to report, a file to use that the project lacks).
 * As the desktop's Title / Notes page and its Files page (report contents, secondary file references).
 * The session (model.mjs) owns the engine; these functions take it.
 */
import { withCString, withCStrings } from "./vendor/engine/mem.js";
import { raiseForCode } from "./vendor/engine/errors.js";

/** Edit object kinds that are one section of the deck. */
export const sectionKinds = ["title", "report", "files"];
/** Simulation options rows the Report card shows instead. */
export const reportOptions = ["RPT_DISABLED", "RPT_INPUT", "RPT_CONTINUITY", "RPT_FLOWSTATS", "RPT_CONTROLS", "RPT_AVERAGES", "RPT_LINK_STEPS", "REPORT_SIGNED_HEADS", "RPT_SUBCATCHMENTS", "RPT_NODES", "RPT_LINKS"];

const flags = [
  ["disabled", "RPT_DISABLED", "Disable all reporting (DISABLED)"],
  ["input", "RPT_INPUT", "Input summary (INPUT)"],
  ["continuity", "RPT_CONTINUITY", "Continuity errors (CONTINUITY)"],
  ["flowstats", "RPT_FLOWSTATS", "Flow statistics (FLOWSTATS)"],
  ["controls", "RPT_CONTROLS", "Control rule actions (CONTROLS)"],
  ["averages", "RPT_AVERAGES", "Time-averaged results (AVERAGES)"],
  ["linksteps", "RPT_LINK_STEPS", "Conduit time step summary (LINK_STEPS)"],
];
const lists = [
  ["subcatchments", "RPT_SUBCATCHMENTS", "Subcatchments", "subcatchment"],
  ["nodes", "RPT_NODES", "Nodes", "node"],
  ["links", "RPT_LINKS", "Links", "link"],
];
/** [FILES] interface files a run reads (USE) or writes (SAVE): `[name, label, engine key, modes]`. */
const fileRows = [
  ["rainfall", "Rainfall", "RAINFALL", ["USE", "SAVE"]],
  ["runoff", "Runoff", "RUNOFF", ["USE", "SAVE"]],
  ["rdii", "RDII", "RDII", ["USE", "SAVE"]],
];
const yesNo = (v) => (String(v ?? "").toUpperCase() === "YES" ? "YES" : "NO");
const same = (a, b) => String(a).toUpperCase() === String(b).toUpperCase();

function intOut(x, call) {
  const p = x._mod._malloc(4);
  try {
    x._mod.HEAP32[p >> 2] = 0;
    raiseForCode(call(p));
    return x._mod.HEAP32[p >> 2];
  } finally {
    x._mod._free(p);
  }
}
/** The [TITLE] lines as the engine holds them. */
export function titleLines(session) {
  const x = session.solver;
  const n = intOut(x, (p) => x._raw.swmm_title_get_count(x.handle, p));
  return Array.from({ length: n }, (_, i) => withCString(x._mod, 1024, (buf, len) => x._raw.swmm_title_get_line(x.handle, i, buf, len)));
}
const filesGet = (x, key) => withCString(x._mod, 1024, (buf, len) => x._raw.swmm_files_get(x.handle, key, buf, len));
const filesSet = (x, key, value) => raiseForCode(x._raw.swmm_files_set(x.handle, key, value));
/** The deck's [PLUGINS] rows: `[path or id, arguments]`. */
function plugins(x) {
  const n = intOut(x, (p) => x._raw.swmm_plugins_count(x.handle, p));
  return Array.from({ length: n }, (_, i) => withCStrings(x._mod, 1024, 2, ([p, a], len) => x._raw.swmm_plugin_get(x.handle, i, p, len, a, len)));
}
/** A project file's name as the deck names it (relative to the deck's folder), or null. */
function projectFile(session, path) {
  const dir = session.entry.includes("/") ? session.entry.slice(0, session.entry.lastIndexOf("/") + 1) : "";
  return (session.inputNames || []).find((n) => n === path || n === dir + path) ?? null;
}

/** The one card of a section kind. */
export function sectionGroups(session, kind) {
  const x = session.solver;
  if (kind === "title")
    return [{ key: "title", title: "Title and notes", fields: [{ name: "text", label: "Title and notes", type: "textarea", value: titleLines(session).join("\n") }], note: "The first line is the title the report shows. Blank lines are not kept." }];
  if (kind === "report") {
    const opt = (key) => x.options.get(key);
    const fields = flags.map(([name, key, label]) => ({ name, label, type: "check", value: yesNo(opt(key)), ...(name === "disabled" ? {} : { when: { name: "disabled", in: ["NO"] } }) }));
    fields.push({ name: "signedHeads", label: "Signed piezometric heads in the binary output (REPORT_SIGNED_HEADS)", type: "check", value: yesNo(opt("REPORT_SIGNED_HEADS")) });
    for (const [name, key, label] of lists) {
      const v = String(opt(key) ?? "ALL").trim(),
        mode = /^none$/i.test(v) ? "NONE" : !v || /^all$/i.test(v) ? "ALL" : "SOME";
      fields.push(
        { name, label, type: "choice", value: mode, choices: [["ALL", "All"], ["NONE", "None"], ["SOME", "Selected"]] },
        { name: name + "List", label: label + " to report", type: "text", value: mode === "SOME" ? v.split(/[\s,]+/).filter(Boolean).join(" ") : "", when: { name, in: ["SOME"] } },
      );
    }
    return [{ key: "report", title: "Report", fields, note: "What the report (.rpt) and the binary output (.out) hold. Selected names are separated by spaces." }];
  }
  if (kind === "files") {
    const fields = [];
    for (const [name, label, key, modes] of fileRows) {
      const mode = filesGet(x, key + "_MODE").toUpperCase();
      fields.push(
        { name: name + "Mode", label: label + " file", type: "choice", value: mode, choices: [["", "— none —"], ...modes.map((m) => [m, m === "USE" ? "Use" : "Save"])] },
        { name: name + "Path", label: label + " file name", type: "text", value: mode ? filesGet(x, key + "_PATH") : "", when: { name: name + "Mode", in: modes } },
      );
    }
    fields.push(
      { name: "inflows", label: "Inflows file to use", type: "text", value: filesGet(x, "INFLOWS_PATH") },
      { name: "outflows", label: "Outflows file to save", type: "text", value: filesGet(x, "OUTFLOWS_PATH") },
      { name: "hotstart", label: "Hot-start file to use", type: "text", value: filesGet(x, "HOTSTART_USE_PATH") },
    );
    const saves = +filesGet(x, "HOTSTART_SAVE_COUNT") || 0,
      rows = plugins(x);
    const note = [
      "A file to use must be one of the project's files; files saved come back with the run's outputs. Blank means none.",
      saves ? "The deck also schedules " + saves + " hot-start save" + (saves > 1 ? "s" : "") + " (edited in the deck)." : "",
      rows.length ? "Plugins ([PLUGINS]): " + rows.map(([p, a]) => p + (a ? " " + a : "")).join("; ") + " — native libraries the browser's engine cannot load." : "",
    ];
    return [{ key: "files", title: "Files", fields, note: note.filter(Boolean).join(" ") }];
  }
  throw new Error("No section " + kind + ".");
}

/** Check a section's card as a run would and write it through the engine. */
export function applySection(session, kind, key, values) {
  const x = session.solver;
  const need = (cond, message) => {
    if (!cond) throw new Error(message);
  };
  if (kind === "title" && key === "title") {
    const text = String(values.text ?? "").replace(/\r\n?/g, "\n");
    raiseForCode(x._raw.swmm_title_set(x.handle, text));
  } else if (kind === "report" && key === "report") {
    // Every list is checked before anything is written.
    const writes = [];
    for (const [name, optKey, label, what] of lists) {
      if (!(name in values)) continue;
      const mode = values[name];
      need(["ALL", "NONE", "SOME"].includes(mode), "Choose All, None or Selected for " + label.toLowerCase() + ".");
      if (mode !== "SOME") {
        writes.push([optKey, mode]);
        continue;
      }
      const names = String(values[name + "List"] ?? "").split(/[\s,]+/).filter(Boolean);
      need(names.length, "Name the " + label.toLowerCase() + " to report, or choose None.");
      const ids = what === "subcatchment" ? x.subcatchments.ids : what === "node" ? x.nodes.ids : x.links.ids;
      const unknown = names.filter((n) => !ids.some((id) => same(id, n)));
      need(!unknown.length, "No " + what + (unknown.length > 1 ? "s " : " ") + unknown.join(", ") + " in this model.");
      writes.push([optKey, names.map((n) => ids.find((id) => same(id, n))).join(" ")]);
    }
    for (const [name, optKey] of flags) if (name in values) writes.push([optKey, yesNo(values[name])]);
    if ("signedHeads" in values) writes.push(["REPORT_SIGNED_HEADS", yesNo(values.signedHeads)]);
    for (const [optKey, value] of writes) x.options.set(optKey, value);
  } else if (kind === "files" && key === "files") {
    const path = (v) => String(v ?? "").trim();
    const listed = () => (session.inputNames || []).join(", ") || "none";
    const writes = [];
    const file = (label, p, use) => {
      need(!/["\r\n]/.test(p), label + " file names cannot hold quotes or line breaks.");
      if (use && p) need(projectFile(session, p), label + " file " + p + " is not one of the project's files (" + listed() + ").");
    };
    for (const [name, label, key, modes] of fileRows) {
      const mode = String(values[name + "Mode"] ?? "").toUpperCase(),
        p = path(values[name + "Path"]);
      need(!mode || modes.includes(mode), "Choose Use, Save or none for the " + label.toLowerCase() + " file.");
      if (mode) need(p, "Name the " + label.toLowerCase() + " file to " + mode.toLowerCase() + ".");
      file(label, p, mode === "USE");
      writes.push([key + "_MODE", mode], [key + "_PATH", mode ? p : ""]);
    }
    for (const [name, label, key, use] of [["inflows", "Inflows", "INFLOWS_PATH", true], ["outflows", "Outflows", "OUTFLOWS_PATH", false], ["hotstart", "Hot-start", "HOTSTART_USE_PATH", true]]) {
      const p = path(values[name]);
      file(label, p, use);
      writes.push([key, p]);
    }
    for (const [k, v] of writes) filesSet(x, k, v);
  } else throw new Error("No section card " + key + " for " + kind + ".");
  return sectionGroups(session, kind).find((g) => g.key === key);
}
