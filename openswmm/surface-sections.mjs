/**
 * Scoped 2D section rows (interaction phase E3d-2): rows that apply to all cells (`*`), the cells with a
 * tag, or one cell, as the desktop's 2D section tables (openswmm.gui mesh2dsectionrowmodel.cpp: Scope,
 * Tag / cell, then the section's values). Each section is read as `{columns, rows}` and replaced whole,
 * checked here first: the engine checks names and species only when a run starts. Rows are
 * `{scope: "GLOBAL" | "TAG" | "CELL", target: "" | tag | 1-based cell, values: {column: value}}`.
 * The session (model.mjs) owns the engine; these functions take it.
 */
import { CellScope } from "./vendor/engine/index.js";

const scopes = { GLOBAL: "All cells", TAG: "Tag", CELL: "Cell" };
const yes = (v) => String(v ?? "").toUpperCase() === "YES";
/** 2D species: the pollutants, and water age and temperature when the model carries them (engine names). */
function species(session) {
  const o = session.solver.options,
    list = session.pollutantIds().map((p) => [p, p]);
  if (yes(o.get("WATER_AGE"))) list.push(["__WATER_AGE__", "Water age"]);
  if (yes(o.get("HEAT_TRANSPORT"))) list.push(["__TEMPERATURE__", "Temperature"]);
  return list;
}
/** A quality section ([2D_INITIAL_QUALITY], [2D_INITIAL_BED_QUALITY]) on `sf` through its getter and setters. */
const qualitySection = (title, rows, set, remove, note) => ({
  title,
  columns: (session) => [
    { key: "species", label: "Species", type: "choice", choices: species(session).map(([v]) => v), labels: Object.fromEntries(species(session)) },
    { key: "value", label: "Concentration", type: "number" },
  ],
  read: (sf) => sf[rows].map((r) => ({ scope: CellScope[r.scope], target: target(r), values: { species: r.species, value: r.conc } })),
  check: (session, row, label) => {
    const known = species(session).find(([v]) => same(v, row.values.species));
    if (!known) return label + ": choose a species (" + species(session).map(([, l]) => l).join(", ") + ").";
    const v = Number(row.values.value);
    if (row.values.value === "" || !Number.isFinite(v)) return label + ": enter the concentration.";
    if (v < 0) return label + ": the concentration cannot be negative."; // the engine refuses it for every species
    return null;
  },
  key: (row) => String(row.values.species).toUpperCase(),
  canon: (session, row) => ({ ...row, values: { ...row.values, species: species(session).find(([v]) => same(v, row.values.species))[0] } }),
  clear: (sf) => {
    for (let i = sf[rows].length - 1; i >= 0; i--) sf[remove](i);
  },
  write: (sf, row, at) => sf[set](row.values.species, Number(row.values.value), at),
  note,
});
/** 2D infiltration methods (engine codes) and the positional parameters each uses (MeshKit meshinfil.cpp). */
const infilMethods = {
  HORTON: [0, ["f0", "fmin", "decay", "dry", "fmax"]],
  MOD_HORTON: [1, ["f0", "fmin", "decay", "dry", "fmax"]],
  GREEN_AMPT: [2, ["suction", "ksat", "imd"]],
  MOD_GREEN_AMPT: [3, ["suction", "ksat", "imd"]],
  CURVE_NUMBER: [4, ["cn", null, "dry"]],
  CONSTANT: [5, ["rate"]],
};
const infilName = (code) => Object.keys(infilMethods).find((k) => infilMethods[k][0] === code);
const blankish = (v) => v === "" || v === null || v === undefined;
/** The 2D snow rows as the engine writes them: `<tag|CELL n> SNOWPACK "pack" [FC v] [F v] [QG v] [AEP v] [SLOPE v ASPECT v]`. */
const snowKeys = ["FC", "F", "QG", "AEP", "SLOPE", "ASPECT"];
function parseSnowRows(text, cell) {
  const out = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const tokens = (line.match(/"[^"]*"|\S+/g) || []).map((x) => x.replace(/^"(.*)"$/, "$1"));
    if (!tokens.length || tokens[0].startsWith(";")) continue;
    let at = 0;
    if (tokens[0].toUpperCase() === (cell ? "CELL" : "TAG")) at++;
    const key = tokens[at];
    const values = { pack: tokens[at + 2] };
    for (let k = at + 3; k + 1 < tokens.length; k += 2) values[tokens[k].toUpperCase()] = Number(tokens[k + 1]);
    out.push({ scope: cell ? "CELL" : key === "*" ? "GLOBAL" : "TAG", target: cell || key === "*" ? (cell ? key : "") : key, values });
  }
  return out;
}
const snowLine = (prefix, v) => prefix + ' SNOWPACK "' + v.pack + '"' + snowKeys.filter((k) => !blankish(v[k])).map((k) => " " + k + " " + Number(v[k])).join("");
const same = (a, b) => String(a).toUpperCase() === String(b).toUpperCase();
const target = (r) => (r.scope === CellScope.TAG ? r.tag : r.scope === CellScope.CELL ? String(r.cell + 1) : "");

/** The sections and how they read, check and write (`q` is `surface2d.quality`). */
const sections = {
  coverage: {
    title: "2D land-use coverage",
    columns: (session) => session.landuseIds().map((l) => ({ key: l, label: l + " (%)", type: "number", blank: true })),
    read: (sf) => sf.quality.coverages.map((c) => ({ scope: CellScope[c.scope], target: target(c), values: Object.fromEntries(c.landuses.map(([l, p]) => [l, p])) })),
    check: (session, row, label) => {
      const pairs = Object.entries(row.values).filter(([, v]) => v !== "" && v !== null && v !== undefined);
      if (!pairs.length) return label + ": cover at least one land use.";
      for (const [l, v] of pairs) if (!(Number(v) >= 0)) return label + ": the " + l + " percentage cannot be negative.";
      const sum = pairs.reduce((a, [, v]) => a + Number(v), 0);
      if (sum > 100 + 1e-9) return label + ": the land uses cover " + +sum.toFixed(6) + " %, more than 100 %.";
      return null;
    },
    clear: (sf) => {
      for (let i = sf.quality.coverages.length - 1; i >= 0; i--) sf.quality.removeCoverage(i);
    },
    write: (sf, row, at) => sf.quality.setCoverage(row.scope, Object.fromEntries(Object.entries(row.values).filter(([, v]) => v !== "" && v !== null && v !== undefined).map(([l, v]) => [l, Number(v)])), at),
    note: "Percent of each cell's area under each land use; blank is not covered, and the land uses of one row cover 100 % or less. A tag or cell row replaces the coverage of all cells there.",
  },
  loading: {
    title: "2D initial buildup",
    columns: (session) => [
      { key: "species", label: "Species", type: "choice", choices: session.pollutantIds() },
      { key: "value", label: "Initial buildup (" + (session.unitSystem === 0 ? "mass/acre" : "mass/hectare") + ")", type: "number" },
    ],
    read: (sf) => sf.quality.loadings.map((l) => ({ scope: CellScope[l.scope], target: target(l), values: { species: l.species, value: l.value } })),
    check: (session, row, label) => {
      if (!session.pollutantIds().some((p) => same(p, row.values.species))) return label + ": choose a pollutant.";
      if (!(Number(row.values.value) >= 0)) return label + ": the buildup cannot be negative.";
      return null;
    },
    key: (row) => String(row.values.species).toUpperCase(),
    canon: (session, row) => ({ ...row, values: { ...row.values, species: session.pollutantIds().find((p) => same(p, row.values.species)) } }),
    clear: (sf) => {
      for (let i = sf.quality.loadings.length - 1; i >= 0; i--) sf.quality.removeLoading(i);
    },
    write: (sf, row, at) => sf.quality.setLoading(row.scope, row.values.species, Number(row.values.value), at),
    note: "Buildup on the cells' land at the start of the run, shared among their land uses.",
  },
  curb: {
    title: "2D curb length",
    columns: (session) => [{ key: "length", label: "Curb length (" + (session.unitSystem === 0 ? "ft" : "m") + ")", type: "number" }],
    read: (sf) => sf.quality.curbLengths.map((c) => ({ scope: CellScope[c.scope], target: target(c), values: { length: c.length } })),
    check: (session, row, label) => (Number(row.values.length) > 0 ? null : label + ": the curb length must be above 0."),
    clear: (sf) => {
      for (let i = sf.quality.curbLengths.length - 1; i >= 0; i--) sf.quality.removeCurbLength(i);
    },
    write: (sf, row, at) => sf.quality.setCurbLength(row.scope, Number(row.values.length), at),
    note: "Curb length on the cells, for land uses whose buildup is per curb length.",
  },
};
sections.initQuality = qualitySection("2D initial quality", "initialQuality", "setInitialQuality", "removeInitialQuality", "Concentration of the water standing on the cells at the start, in each species' units (temperature in °C, water age in hours).");
sections.bedQuality = qualitySection("2D initial bed quality", "initialBedQuality", "setInitialBedQuality", "removeInitialBedQuality", "Concentration of the bed's pore water at the start, in each species' units.");
sections.infilDefaults = {
  title: "2D infiltration defaults",
  scopes: { GLOBAL: "All cells", TAG: "Tag" },
  columns: () => [
    { key: "method", label: "Method", type: "choice", choices: Object.keys(infilMethods) },
    ...[1, 2, 3, 4, 5].map((k) => ({ key: "p" + k, label: "P" + k, type: "number", blank: true })),
  ],
  read: (sf) =>
    sf.infiltration.defaults.entries().map(([tag, row]) => {
      const name = infilName(row.method),
        used = infilMethods[name]?.[1] || [];
      return { scope: tag === "*" ? "GLOBAL" : "TAG", target: tag === "*" ? "" : tag, values: { method: name, ...Object.fromEntries([1, 2, 3, 4, 5].map((k) => ["p" + k, used[k - 1] ? row.params[k - 1] : ""])) } };
    }),
  check: (session, row, label) => {
    const m = infilMethods[row.values.method];
    if (!m) return label + ": choose the method.";
    const p = (k) => row.values["p" + k],
      n = (k) => Number(p(k));
    for (let k = 1; k <= 5; k++) {
      if (m[1][k - 1] && blankish(p(k)) && !(m[1][k - 1] === "fmax")) return label + ": " + row.values.method + " needs P" + k + " (" + m[1][k - 1] + ").";
      if (!m[1][k - 1] && !blankish(p(k))) return label + ": " + row.values.method + " does not use P" + k + "; leave it blank.";
      if (!blankish(p(k)) && !Number.isFinite(n(k))) return label + ": P" + k + " is a number.";
    }
    // Legacy SWMM 5.2.4 (infil.c horton/grnampt/curvenum_setParams).
    if (m[0] <= 1) {
      if ([1, 2, 3, 4, 5].some((k) => !blankish(p(k)) && n(k) < 0)) return label + ": Horton parameters cannot be negative.";
      if (n(1) < n(2)) return label + ": the maximum rate (P1) cannot be below the minimum rate (P2).";
    } else if (m[0] <= 3) {
      if (n(1) < 0) return label + ": the suction head (P1) cannot be negative.";
      if (!(n(2) > 0)) return label + ": the conductivity (P2) must be above 0.";
      if (n(3) < 0 || n(3) > 1) return label + ": the initial deficit (P3) is between 0 and 1.";
    } else if (m[0] === 4) {
      if (n(1) < 10 || n(1) > 99) return label + ": the curve number (P1) is between 10 and 99.";
      if (!(n(3) > 0)) return label + ": the drying time (P3) must be above 0.";
    } else if (n(1) < 0) return label + ": the rate (P1) cannot be negative.";
    return null;
  },
  replace: (sf, rows) => {
    const inf = sf.infiltration;
    for (const [tag] of inf.defaults.entries()) inf.setDefault(tag, null);
    for (const row of rows) {
      const m = infilMethods[row.values.method];
      const params = m[1].map((name, k) => (name && !blankish(row.values["p" + (k + 1)]) ? Number(row.values["p" + (k + 1)]) : 0));
      inf.setDefault(row.scope === "GLOBAL" ? "*" : row.at.tag, { method: m[0], params, dest: 0 });
    }
  },
  note: "The infiltration of the cells with a tag, or of all cells ([2D_INFILTRATION_DEFAULTS]); a cell's own row is set on the cell. P1–P5 in project units: Horton f0, fmin, decay (1/h), drying time (days), Fmax (blank: none); Green-Ampt suction, conductivity, initial deficit; curve number CN, —, drying time (days); constant: the rate. Infiltrated water leaves the model.",
};
sections.snow = {
  title: "2D snow",
  columns: (session) => [
    { key: "pack", label: "Snowpack", type: "choice", choices: ["NONE", ...session.snowpackIds()] },
    { key: "FC", label: "Forest fraction", type: "number", blank: true },
    { key: "F", label: "Drift factor", type: "number", blank: true },
    { key: "QG", label: "Ground heat (W/m²)", type: "number", blank: true },
    { key: "AEP", label: "Extinction depth (m)", type: "number", blank: true },
    { key: "SLOPE", label: "Slope (°)", type: "number", blank: true },
    { key: "ASPECT", label: "Aspect (°)", type: "number", blank: true },
  ],
  read: (sf) => {
    const c = sf.snow.configuration();
    return [...parseSnowRows(c.defaults, false), ...parseSnowRows(c.cells, true)];
  },
  check: (session, row, label) => {
    const v = row.values;
    if (!(v.pack === "NONE" || session.snowpackIds().some((p) => same(p, v.pack)))) return label + ": choose a snowpack (or NONE).";
    const n = (k) => Number(v[k]),
      set = (k) => !blankish(v[k]);
    for (const k of snowKeys) if (set(k) && !Number.isFinite(n(k))) return label + ": " + k + " is a number.";
    // The engine's checks (MeshSnowConfig.cpp setMeshSnowRow).
    if (set("FC") && (n("FC") < 0 || n("FC") > 1)) return label + ": the forest fraction is between 0 and 1.";
    if (set("F") && n("F") < 0) return label + ": the drift factor cannot be negative.";
    if (set("AEP") && !(n("AEP") > 0)) return label + ": the extinction depth must be above 0.";
    if (set("SLOPE") !== set("ASPECT")) return label + ": give both slope and aspect, or neither (the cells' own geometry).";
    if (set("SLOPE") && (n("SLOPE") < 0 || n("SLOPE") >= 90)) return label + ": the slope is from 0 to under 90°.";
    if (set("ASPECT") && (n("ASPECT") < 0 || n("ASPECT") > 360)) return label + ": the aspect is from 0 to 360°.";
    return null;
  },
  canon: (session, row) => ({ ...row, values: { ...row.values, pack: row.values.pack === "NONE" ? "NONE" : session.snowpackIds().find((p) => same(p, row.values.pack)) } }),
  replace: (sf, rows) => {
    const defaults = rows.filter((r) => r.scope !== "CELL").map((r) => snowLine(r.scope === "GLOBAL" ? "*" : "TAG " + r.at.tag, r.values));
    const cells = rows.filter((r) => r.scope === "CELL").map((r) => snowLine("CELL " + (r.at.cell + 1), r.values));
    sf.snow.applyConfiguration(sf.snow.configuration().options, defaults.join("\n"), cells.join("\n"));
  },
  note: "The snowpack of the cells with a tag, of one cell, or of all cells ([2D_SNOW_DEFAULTS], [2D_SNOW]); NONE keeps snow off them. Blank overrides keep the snowpack's values and the cells' own slope and aspect.",
};
export const scopedSections = Object.keys(sections);

/** A section's columns and rows (only for a model with a mesh). */
export function scopedRows(session, name) {
  const sec = sections[name];
  if (!sec) throw new Error("No 2D section " + name + ".");
  if (!session.cells?.mannings?.length) throw new Error("This model has no 2D surface.");
  return { name, title: sec.title, scopes: sec.scopes || scopes, columns: sec.columns(session), rows: sec.read(session.solver.surface2d, session), note: sec.note, tags: [...new Set(session.cells.tag.filter(Boolean))].sort(), cells: session.cells.mannings.length };
}

/** Replace a section's rows, all checked first; returns the rows there were (undo). */
export function setScopedRows(session, name, rows) {
  const sec = sections[name];
  const { rows: before, tags, cells } = scopedRows(session, name);
  const errors = [],
    seen = new Set();
  rows.forEach((row, i) => {
    const label = "Row " + (i + 1);
    const scope = row.scope,
      t = String(row.target ?? "").trim();
    if (!(scope in (sec.scopes || scopes))) return errors.push(label + ": choose " + Object.values(sec.scopes || scopes).join(", ").toLowerCase() + ".");
    if (scope === "TAG" && !tags.some((x) => same(x, t))) return errors.push(label + ": no cell has the tag " + (t || "(blank)") + (tags.length ? " (tags: " + tags.join(", ") + ")." : "; this mesh has no tags."));
    if (scope === "CELL" && !(Number.isInteger(Number(t)) && Number(t) >= 1 && Number(t) <= cells)) return errors.push(label + ": a cell is a number from 1 to " + cells + ".");
    const problem = sec.check(session, row, label);
    if (problem) return errors.push(problem);
    const key = scope + ":" + (scope === "GLOBAL" ? "*" : t.toUpperCase()) + ":" + (sec.key ? sec.key(row) : "");
    if (seen.has(key)) errors.push(label + " repeats an earlier row's scope" + (sec.key ? " and species" : "") + ".");
    seen.add(key);
  });
  if (errors.length) throw new Error(errors.join(" "));
  const sf = session.solver.surface2d;
  // Tags as the mesh spells them, cells 0-based.
  const placed = rows.map((given) => {
    const row = sec.canon ? sec.canon(session, given) : given,
      t = String(row.target ?? "").trim();
    return { ...row, at: row.scope === "TAG" ? { tag: tags.find((x) => same(x, t)) } : row.scope === "CELL" ? { cell: Number(t) - 1 } : {} };
  });
  if (sec.replace) sec.replace(sf, placed, session);
  else {
    sec.clear(sf);
    for (const row of placed) sec.write(sf, { ...row, scope: CellScope[row.scope] }, row.at);
  }
  return before;
}
