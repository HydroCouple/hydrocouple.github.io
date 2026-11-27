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
import { TransportDispersionMode, catalog } from "./vendor/engine/index.js";
import { options2dGroups, applyOptions2d } from "./options2d.mjs";
import { frostFields, frostDefaults, frostValues } from "./properties.mjs";
import { groundwaterGroups, applyGroundwater } from "./groundwater-options.mjs";

/** Edit object kinds that are one section of the deck (E3c) or one settings card (E3d-1). */
export const sectionKinds = ["options2d", "snow2d", "gw2d", "gwtransport2d", "title", "report", "files", "transport", "ueb", "components"];
/** The ARD transport component; its settings are saved only in its file ([PROCESS_COMPONENTS]). */
const ARD = "org.hydrocouple.openswmm.transport.ard";
/** The desktop's UEB parameters (openswmm.gui snowclimatesettings.h uebFields): key, label, group, range. */
const uebFields = [
  ["Z0", "Roughness length (m)", "Turbulence", 0.000001, 10],
  ["ZM", "Measurement height (m)", "Turbulence", 0.000001, 1000],
  ["FSTAB", "Stability weighting", "Turbulence", 0, 1],
  ["RHO_S", "Snow density (kg/m³)", "Snow and soil", 1, 916.999],
  ["RHO_G", "Soil density (kg/m³)", "Snow and soil", 1, 10000],
  ["CG", "Soil heat capacity (kJ/kg/K)", "Snow and soil", 0.000001, 100],
  ["DE", "Active soil depth (m)", "Snow and soil", 0.000001, 100],
  ["LC", "Liquid retention fraction", "Snow and soil", 0, 1],
  ["KSAT", "Saturated snow drainage (m/h)", "Snow and soil", 0, 1e6],
  ["KS", "Equilibrium conductance (m/h)", "Temperature scheme", 0.000001, 100],
  ["LAMBDA_S", "Snow conductivity (kJ/m/K/h)", "Temperature scheme", 0.000001, 1000],
  ["LAMBDA_G", "Soil conductivity (kJ/m/K/h)", "Temperature scheme", 0.000001, 1000],
  ["OMEGA_LF", "Low frequency (rad/h)", "Temperature scheme", 0.000001, 100],
  ["R", "Damping amplitude", "Temperature scheme", 0.000001, 100],
  ["TR", "All-rain temperature (°C)", "Precipitation", -99, 70],
  ["TB", "All-snow temperature (°C)", "Precipitation", -100, 69],
  ["EPSILON", "Snow emissivity", "Albedo and radiation", 0, 1],
  ["ABG", "Ground albedo", "Albedo and radiation", 0, 1],
  ["ALPHA_VO", "Fresh visible albedo", "Albedo and radiation", 0, 1],
  ["ALPHA_IRO", "Fresh infrared albedo", "Albedo and radiation", 0, 1],
  ["DNEWS", "Fresh-snow reset depth (m)", "Albedo and radiation", 0, 10],
  ["R3", "Dust aging coefficient", "Albedo and radiation", 0, 100],
  ["CV", "Visible albedo aging coefficient", "Albedo and radiation", 0, 1],
  ["CIR", "Infrared albedo aging coefficient", "Albedo and radiation", 0, 1],
  ["BC_A", "Bristow–Campbell maximum transmissivity", "Albedo and radiation", 0.000001, 1],
  ["BC_C", "Bristow–Campbell exponent", "Albedo and radiation", 0.000001, 100],
];
const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
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
  if (kind === "options2d") return options2dGroups(session);
  if (kind === "gw2d" || kind === "gwtransport2d") return groundwaterGroups(session, kind);
  if (kind === "snow2d") {
    if (!session.cells?.mannings?.length) return [{ key: "snow-none", title: "2D snow", fields: [], note: "This model has no 2D surface." }];
    const o = x.surface2d.snow.options,
      frost = x.frozenGroundRows(true)["*"];
    return [
      {
        key: "snowOptions",
        title: "2D snowmelt",
        fields: [
          { name: "mode", label: "Snowmelt on the mesh", type: "choice", value: o.mode, choices: [["AUTO", "Automatic (where a snowpack is assigned)"], ["YES", "On"], ["NO", "Off"]] },
          { name: "step", label: "Snow time step", unit: "s", type: "number", value: o.stepSeconds },
        ],
        note: "A step of 0 is the model's snow step ([2D_SNOW_OPTIONS]).",
      },
      {
        key: "frost2d",
        title: "2D frozen ground",
        fields: [
          { name: "row", label: "Use", type: "choice", value: frost ? "own" : "", choices: [["", "None"], ["own", "Values for all cells"]] },
          ...frostFields.map(([name, label, unit], k) => ({ name, label, unit, type: "number", value: (frost ?? frostDefaults)[k], when: { name: "row", in: ["own"] } })),
        ],
        note: "One row for every cell of the mesh ([2D_FROZEN_GROUND] *), in SI units.",
      },
    ];
  }
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
  if (kind === "transport") {
    const t = x.transport,
      len = catalog.unitLabel("length", session.unitSystem, session.flowUnits),
      registered = ardRow(x);
    const fields = [
      { name: "dispersion", label: "Dispersion", type: "choice", value: TransportDispersionMode[t.dispersionMode] ?? "OFF", choices: [["OFF", "Off"], ["FISCHER", "Fischer (from the hydraulics)"], ["VALUE", "Fixed coefficient"]] },
      { name: "coefficient", label: "Coefficient", unit: len + "²/s", type: "number", value: t.dispersionValue, when: { name: "dispersion", in: ["VALUE"] } },
      { name: "spacing", label: "Transport cell spacing", unit: len, type: "number", value: t.targetDx },
      { name: "detailed", label: "Detailed output file (CSV)", type: "text", value: t.detailedOutput },
    ];
    return [
      {
        key: "transport",
        title: "Transport (ARD)",
        fields,
        restore: { registered: !!registered, values: Object.fromEntries(fields.map((f) => [f.name, f.value])) },
        note:
          "Eulerian advection–reaction–dispersion on the conduits ([TRANSPORT_OPTIONS]); the quality solver is a simulation option. A spacing of 0 lets the engine choose; a blank file name means no detailed output. " +
          (registered ? "Saved in " + registered.config + " (a process component)." : "The first change registers the transport component with " + stem(session) + ".ard, as the desktop does; Apply saves that file with the deck."),
      },
    ];
  }
  if (kind === "ueb") {
    const snow = x.snow,
      ranges = snow.monthlyRanges;
    const fields = [
      { name: "SURFACE_TEMP", label: "Surface temperature", type: "choice", value: snow.option("SURFACE_TEMP"), choices: [["MODIFIED_FORCE_RESTORE", "Modified force-restore"], ["EQUILIBRIUM", "Equilibrium (1996 reference)"]] },
      { name: "PRECIP_SPLIT", label: "Rain / snow partition", type: "choice", value: snow.option("PRECIP_SPLIT"), choices: [["UEB", "UEB linear temperature transition"], ["DIVT", "Legacy division temperature"]] },
      ...uebFields.map(([key, label]) => ({ name: key, label, type: "number", value: +snow.option(key) })),
      ...months.map((m, i) => ({ name: "range" + i, label: m + " temperature range (°C)", type: "number", value: ranges[i] })),
    ];
    return [{ key: "ueb", title: "Snow (UEB)", fields, note: "The Utah Energy Balance snow parameters ([UEB_OPTIONS]), used when the snowmelt model is UEB. A monthly range of 0 takes the range from the temperature source." }];
  }
  if (kind === "components") {
    const rows = [...x.processComponents];
    return [
      {
        key: "components",
        title: "Process components",
        fields: rows.map((c, i) => {
          const args = x.processComponents.arguments(c.id).map(([n, v]) => n + "=" + v);
          return { name: "c" + i, label: c.id, type: "text", value: [c.config, ...args].filter(Boolean).join(" "), readonly: true };
        }),
        note: rows.length ? "Components the model registers ([PROCESS_COMPONENTS]) and their files; the transport card registers its own." : "This model registers no process components ([PROCESS_COMPONENTS]).",
      },
    ];
  }
  throw new Error("No section " + kind + ".");
}
/** The model's file name without its folder and extension (for a component's file). */
const stem = (session) => session.entry.replace(/^.*\//, "").replace(/\.[^.]*$/, "");
/** The ARD component's row, or null. */
const ardRow = (x) => [...x.processComponents].find((c) => c.id === ARD) ?? null;

/** Check a section's card as a run would and write it through the engine. */
export function applySection(session, kind, key, values) {
  const x = session.solver;
  if (kind === "options2d") return applyOptions2d(session, key, values);
  if (kind === "gw2d" || kind === "gwtransport2d") return applyGroundwater(session, kind, key, values);
  if (kind === "snow2d" && key === "snowOptions") {
    const need = (cond, message) => {
      if (!cond) throw new Error(message);
    };
    need(["AUTO", "YES", "NO"].includes(values.mode), "Choose automatic, on or off.");
    const step = Number(values.step);
    need(values.step !== "" && Number.isFinite(step) && step >= 0, "The snow time step is 0 (the model's) or more seconds.");
    const snow = x.surface2d.snow,
      c = snow.configuration();
    const options = [...(values.mode === "AUTO" ? [] : ["SNOWMELT " + values.mode]), ...(step > 0 ? ["SNOW_STEP " + step] : [])].join("\n");
    snow.applyConfiguration(options, c.defaults, c.cells);
    return sectionGroups(session, kind).find((g) => g.key === key);
  }
  if (kind === "snow2d" && key === "frost2d") {
    const need = (cond, message) => {
      if (!cond) throw new Error(message);
    };
    if (values.row !== "own") {
      if (x.frozenGroundRows(true)["*"]) x.removeFrozenGround("*", true);
    } else x.setFrozenGround("*", frostValues(values, need), true);
    return sectionGroups(session, kind).find((g) => g.key === key);
  }
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
  } else if (kind === "transport" && key === "transport") {
    const t = x.transport,
      v = values.restore ? values.restore.values : values;
    const mode = TransportDispersionMode[v.dispersion];
    need(mode !== undefined, "Choose off, Fischer or a fixed coefficient for the dispersion.");
    const coefficient = Number(v.coefficient),
      spacing = Number(v.spacing),
      detailed = String(v.detailed ?? "").trim();
    if (v.dispersion === "VALUE") need(v.coefficient !== "" && Number.isFinite(coefficient) && coefficient >= 0, "The dispersion coefficient must be 0 or more.");
    need(v.spacing !== "" && Number.isFinite(spacing) && spacing >= 0, "The transport cell spacing must be 0 (the engine chooses) or more.");
    need(!/["\r\n]/.test(detailed), "The detailed output file name cannot hold quotes or line breaks.");
    // The settings live in the component's file: register it first (the desktop does the same).
    if (!ardRow(x)) x.processComponents.register(ARD, stem(session) + ".ard");
    // The coefficient is kept whatever the mode (undo puts it back too); the mode is set after it.
    if (v.coefficient !== "" && Number.isFinite(coefficient) && coefficient >= 0) t.dispersionValue = coefficient;
    t.dispersionMode = mode;
    t.targetDx = spacing;
    t.detailedOutput = detailed;
    // Undo of the first change: the component goes again.
    if (values.restore && !values.restore.registered) x.processComponents.remove(ARD);
  } else if (kind === "ueb" && key === "ueb") {
    const snow = x.snow;
    need(["MODIFIED_FORCE_RESTORE", "EQUILIBRIUM"].includes(values.SURFACE_TEMP), "Choose the surface temperature scheme.");
    need(["UEB", "DIVT"].includes(values.PRECIP_SPLIT), "Choose how rain and snow are partitioned.");
    const numbers = uebFields.map(([key, label, , lo, hi]) => {
      const n = Number(values[key]);
      need(values[key] !== "" && Number.isFinite(n) && n >= lo && n <= hi, label + " is between " + lo + " and " + hi + ".");
      return [key, n];
    });
    const ranges = months.map((m, i) => {
      const n = Number(values["range" + i]);
      need(values["range" + i] !== "" && Number.isFinite(n) && n >= 0 && n <= 100, m + "'s temperature range is between 0 and 100 °C.");
      return n;
    });
    snow.setOption("SURFACE_TEMP", values.SURFACE_TEMP);
    snow.setOption("PRECIP_SPLIT", values.PRECIP_SPLIT);
    for (const [k, n] of numbers) snow.setOption(k, n);
    snow.monthlyRanges = ranges;
  } else if (kind === "components") {
    throw new Error("Process components are listed here; the transport card registers its own.");
  } else throw new Error("No section card " + key + " for " + kind + ".");
  return sectionGroups(session, kind).find((g) => g.key === key);
}
