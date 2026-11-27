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
const reactionSpecies = (session) => {
  try {
    return [...session.solver.reactions.species].map((sp) => sp.name);
  } catch {
    return [];
  }
};
/** 2D species: the pollutants, and water age and temperature when the model carries them (engine names). */
function species(session) {
  const o = session.solver.options,
    list = session.pollutantIds().map((p) => [p, p]);
  for (const sp of reactionSpecies(session)) if (!list.some(([v]) => same(v, sp))) list.push([sp, sp]);
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
// ---- 2D groundwater (E3d-2c): [2D_AQUIFER] rows, node beds, links; [GW_TRANSPORT_PARAMS],
// [GW_SORPTION], [GW_INITIAL_QUALITY] (the desktop's 2D groundwater dialog; spec in workplans).
const soilLaws = ["RUSSO", "GARDNER", "BROOKS_COREY", "VAN_GENUCHTEN"];
const closures = { "-1": "AUTO", 0: "CLOSED_FORM", 1: "ENSLAVED", 2: "SIGMA" };
const rowExtras = { PSI_B: 0.2, LAMBDA: 0.4, N: 1.6, L: 0.5 }; // engine defaults: written back only when they differ
const unitsOf = (session) => (session.unitSystem === 0 ? { rate: "in/hr", len: "ft", area: "ft²" } : { rate: "mm/hr", len: "m", area: "m²" });
const num = (v) => (blankish(v) ? NaN : Number(v));
sections.aquifer = {
  title: "2D aquifer",
  columns: (session) => {
    const u = unitsOf(session);
    return [
      { key: "ks", label: "Ks (" + u.rate + ")", type: "number" },
      { key: "zs", label: "zs (" + u.len + ")", type: "number" },
      { key: "thetaS", label: "Porosity θs", type: "number" },
      { key: "thetaR", label: "Residual θr", type: "number" },
      { key: "alpha", label: "α (1/" + u.len + ")", type: "number" },
      { key: "hg0", label: "Initial hg (" + u.len + ")", type: "number", blank: true },
      { key: "cLoss", label: "Deep loss (" + u.rate + ")", type: "number", blank: true },
      { key: "soil", label: "Soil law", type: "choice", choices: soilLaws, blankLabel: "Options" },
      { key: "closure", label: "Closure", type: "choice", choices: Object.values(closures), blankLabel: "Options" },
    ];
  },
  read: (sf) => {
    const g = sf.groundwater;
    return g.rows.map((r, i) => {
      const p = (k) => {
        try {
          return g.rowProperty(i, k);
        } catch {
          return NaN;
        }
      };
      const set = (k) => (Number.isFinite(p(k)) && p(k) >= 0 ? p(k) : ""); // the engine reads an unset value as negative
      const values = { ks: r.ks, zs: r.zs, thetaS: r.thetaS, thetaR: r.thetaR, alpha: r.alpha, hg0: set("HG0"), cLoss: set("C_LOSS"), soil: p("SOIL_CHAR_SET") ? soilLaws[p("SOIL_CHAR")] ?? "" : "", closure: p("CLOSURE_SET") ? closures[p("CLOSURE")] ?? "" : "" };
      // Properties the table does not show ride along, so replacing the rows keeps them.
      for (const [k, d] of Object.entries(rowExtras)) if (Number.isFinite(p(k)) && Math.abs(p(k) - d) > 1e-12) values["x:" + k] = p(k);
      const layers = p("M_LAYERS");
      if (Number.isFinite(layers) && layers >= 2) values["x:M_LAYERS"] = layers;
      return { scope: CellScope[r.scope], target: target(r), values };
    });
  },
  check: (session, row, label) => {
    const v = row.values,
      n = (k) => num(v[k]);
    if (!(n("ks") > 0)) return label + ": Ks must be above 0.";
    if (!(n("zs") > 0)) return label + ": zs must be above 0.";
    if (!(n("thetaS") > 0 && n("thetaS") <= 1)) return label + ": the porosity θs is above 0 and at most 1.";
    if (!(n("thetaR") >= 0 && n("thetaR") < n("thetaS"))) return label + ": the residual θr is 0 or more and below θs.";
    if (!(n("alpha") > 0)) return label + ": α must be above 0.";
    for (const k of ["hg0", "cLoss"]) if (!blankish(v[k]) && !(n(k) >= 0)) return label + ": " + (k === "hg0" ? "the initial hg" : "the deep loss") + " cannot be negative.";
    if (!blankish(v.soil) && !soilLaws.includes(v.soil)) return label + ": choose a soil law.";
    if (!blankish(v.closure) && !Object.values(closures).includes(v.closure)) return label + ": choose a closure.";
    return null;
  },
  replace: (sf, rows) => {
    const g = sf.groundwater;
    for (let i = g.rows.length - 1; i >= 0; i--) g.removeRow(i);
    for (const r of rows) {
      const v = r.values;
      g.addRow({ scope: CellScope[r.scope], tag: r.at.tag ?? "", cell: r.at.cell ?? -1, ks: num(v.ks), zs: num(v.zs), thetaS: num(v.thetaS), thetaR: num(v.thetaR), alpha: num(v.alpha) });
      const i = g.rows.length - 1;
      if (!blankish(v.hg0)) g.setRowProperty(i, "HG0", num(v.hg0));
      if (!blankish(v.cLoss)) g.setRowProperty(i, "C_LOSS", num(v.cLoss));
      if (!blankish(v.soil)) g.setRowProperty(i, "SOIL_CHAR", soilLaws.indexOf(v.soil));
      if (!blankish(v.closure)) g.setRowProperty(i, "CLOSURE", Number(Object.keys(closures).find((c) => closures[c] === v.closure)));
      for (const k of [...Object.keys(rowExtras), "M_LAYERS"]) if (!blankish(v["x:" + k])) g.setRowProperty(i, k, num(v["x:" + k]));
    }
  },
  note: "The soil of all cells, the cells with a tag, or one cell ([2D_AQUIFER]); a blank soil law or closure follows the groundwater options. Saved to 6 significant digits.",
};
sections.nodeBeds = {
  title: "2D aquifer node beds",
  scopes: null,
  columns: (session) => {
    const u = unitsOf(session);
    return [
      { key: "node", label: "Node", type: "choice", choices: session.solver.nodes.ids },
      { key: "cell", label: "Cell (blank: located)", type: "number", blank: true },
      { key: "kc", label: "Bed Kc (" + u.rate + ")", type: "number" },
      { key: "dc", label: "Bed thickness (" + u.len + ")", type: "number" },
      { key: "area", label: "Exchange area (" + u.area + ")", type: "number" },
      { key: "exchange", label: "Exchange", type: "choice", choices: ["YES", "NO"] },
    ];
  },
  read: (sf) => sf.groundwater.nodes.filter((b) => !b.automatic).map((b) => ({ values: { node: b.node, cell: b.locate || b.cell < 0 ? "" : b.cell + 1, kc: b.kc, dc: b.dc, area: b.area, exchange: b.exchange ? "YES" : "NO" } })),
  check: (session, row, label) => {
    const v = row.values;
    if (!session.solver.nodes.ids.some((x) => same(x, v.node))) return label + ": choose the node.";
    if (!blankish(v.cell) && !(Number.isInteger(num(v.cell)) && num(v.cell) >= 1 && num(v.cell) <= session.cells.mannings.length)) return label + ": a cell is a number from 1 to " + session.cells.mannings.length + ", or blank to locate it.";
    for (const k of ["kc", "dc", "area"]) if (!(num(v[k]) >= 0)) return label + ": " + k + " is 0 or more.";
    if (!["YES", "NO"].includes(v.exchange)) return label + ": choose whether it exchanges.";
    return null;
  },
  key: (row) => String(row.values.node).toUpperCase(),
  replace: (sf, rows, session) => {
    const g = sf.groundwater,
      current = g.nodes;
    const next = rows.map(({ values: v }) => ({
      node: session.solver.nodes.ids.find((x) => same(x, v.node)),
      cell: blankish(v.cell) ? -1 : num(v.cell) - 1,
      locate: blankish(v.cell),
      exchange: v.exchange === "YES",
      automatic: false,
      kc: num(v.kc),
      dc: num(v.dc),
      area: num(v.area),
    }));
    g.replaceNodes(current, [...current.filter((b) => b.automatic), ...next]); // atomic: all or nothing
  },
  note: "Where a node's bed exchanges water with the aquifer ([2D_AQUIFER_NODE]): its cell (blank locates it from the node), bed conductivity, thickness and area (0 uses the cell's).",
};
sections.aquiferLinks = {
  title: "2D aquifer links",
  scopes: null,
  columns: (session) => {
    const u = unitsOf(session);
    return [
      { key: "link", label: "Conduit", type: "choice", choices: session.solver.links.ids.filter((id) => session.solver.links.get(id).type === 0) },
      { key: "kc", label: "Kc (" + u.rate + ")", type: "number" },
      { key: "dc", label: "Thickness (" + u.len + ")", type: "number" },
      { key: "exchange", label: "Exchange", type: "choice", choices: ["YES", "NO"] },
    ];
  },
  read: (sf) => sf.groundwater.links.map((l) => ({ values: { link: l.link, kc: l.kc, dc: l.dc, exchange: l.exchange ? "YES" : "NO" } })),
  check: (session, row, label) => {
    const v = row.values,
      s = session.solver;
    if (!s.links.ids.some((x) => same(x, v.link) && s.links.get(x).type === 0)) return label + ": choose a conduit.";
    for (const k of ["kc", "dc"]) if (!(num(v[k]) >= 0)) return label + ": " + k + " is 0 or more.";
    if (!["YES", "NO"].includes(v.exchange)) return label + ": choose whether it exchanges.";
    return null;
  },
  key: (row) => String(row.values.link).toUpperCase(),
  replace: (sf, rows, session) => {
    const g = sf.groundwater;
    for (let i = g.links.length - 1; i >= 0; i--) g.removeLink(i);
    for (const { values: v } of rows) g.addLink(session.solver.links.ids.find((x) => same(x, v.link)), num(v.kc), num(v.dc), v.exchange === "YES");
  },
  note: "A conduit's bed exchanging with the aquifer ([2D_AQUIFER_LINKS]): Kc 0 uses the conduit's seepage rate, thickness 0 its full depth.",
};
const gwParamColumns = [
  ["rhoS", "Grain density (kg/m³)", 2650],
  ["cS", "Grain specific heat (J/kg/K)", 880],
  ["lambdaS", "Grain conductivity (W/m/K)", 2],
  ["aS", "Specific surface (m²/kg)", 0],
  ["alphaL", "Longitudinal dispersivity (m)", 1],
  ["alphaT", "Transverse dispersivity (m)", 0.1],
  ["dM", "Molecular diffusivity (m²/s)", 1e-9],
  ["dV", "Vapor diffusivity (m²/s)", 1e-9],
  ["geoFlux", "Geothermal flux (W/m²)", 0.065],
];
sections.gwParams = {
  title: "2D groundwater transport parameters",
  columns: () => gwParamColumns.map(([key, label]) => ({ key, label, type: "number" })),
  read: (sf) => sf.groundwater.transport.parameters.map((r) => ({ scope: CellScope[r.scope], target: r.scope === CellScope.TAG ? r.tag : r.scope === CellScope.CELL ? String(r.cell + 1) : "", values: Object.fromEntries(gwParamColumns.map(([k]) => [k, r[k]])) })),
  check: (session, row, label) => {
    for (const [k, l] of gwParamColumns) {
      const n = num(row.values[k]);
      if (!Number.isFinite(n)) return label + ": enter the " + l.replace(/ \(.*$/, "").toLowerCase() + ".";
      if (k !== "geoFlux" && n < 0) return label + ": the " + l.replace(/ \(.*$/, "").toLowerCase() + " cannot be negative.";
    }
    return null;
  },
  clear: (sf) => {
    const tr = sf.groundwater.transport;
    for (let i = tr.parameters.length - 1; i >= 0; i--) tr.removeParameters(i);
  },
  write: (sf, row, at) => sf.groundwater.transport.setParameters({ scope: row.scope, tag: at.tag ?? "", cell: at.cell ?? -1, ...Object.fromEntries(gwParamColumns.map(([k]) => [k, num(row.values[k])])) }),
  note: "Grain and pore-water properties for groundwater transport and soil heat, in SI units ([GW_TRANSPORT_PARAMS]).",
};
sections.gwSorption = {
  title: "2D groundwater sorption",
  columns: (session) => [
    { key: "species", label: "Species", type: "choice", choices: species(session).map(([v]) => v), labels: Object.fromEntries(species(session)) },
    { key: "kd", label: "Kd (L/kg)", type: "number" },
    { key: "decay", label: "Decay (1/day)", type: "number", blank: true },
  ],
  read: (sf) => sf.groundwater.transport.sorption.map((r) => ({ scope: CellScope[r.scope], target: target(r), values: { species: r.species, kd: r.kd, decay: r.decay < 0 ? "" : r.decay } })),
  check: (session, row, label) => {
    // An unknown species is taken and written, and then the deck cannot be opened again.
    if (!species(session).some(([v]) => same(v, row.values.species))) return label + ": choose a species (" + species(session).map(([, l]) => l).join(", ") + ").";
    if (!(num(row.values.kd) >= 0)) return label + ": Kd is 0 or more.";
    if (!blankish(row.values.decay) && !(num(row.values.decay) >= 0)) return label + ": the decay is 0 or more (blank: the pollutant's).";
    return null;
  },
  key: (row) => String(row.values.species).toUpperCase(),
  canon: (session, row) => ({ ...row, values: { ...row.values, species: species(session).find(([v]) => same(v, row.values.species))[0] } }),
  clear: (sf) => {
    const tr = sf.groundwater.transport;
    for (let i = tr.sorption.length - 1; i >= 0; i--) tr.removeSorption(i);
  },
  write: (sf, row, at) => sf.groundwater.transport.setSorption({ scope: row.scope, tag: at.tag ?? "", cell: at.cell ?? -1, species: row.values.species, kd: num(row.values.kd), decay: blankish(row.values.decay) ? -1 : num(row.values.decay) }),
  note: "Linear sorption of a species onto the aquifer's grains ([GW_SORPTION]); a blank decay uses the pollutant's.",
};
sections.gwInitialQuality = {
  title: "2D groundwater initial quality",
  columns: (session) => {
    const layered = sections.gwInitialQuality.read(session.solver.surface2d).map((r) => r.values.zone).filter((z) => /^LAYER /.test(z));
    return [
      { key: "zone", label: "Zone", type: "choice", choices: ["SAT", "UNSAT", ...new Set(layered)] },
      { key: "species", label: "Species", type: "choice", choices: species(session).map(([v]) => v), labels: Object.fromEntries(species(session)) },
      { key: "value", label: "Initial value", type: "number" },
    ];
  },
  read: (sf) => sf.groundwater.transport.initialQuality.map((r) => ({ scope: CellScope[r.scope], target: target(r), values: { zone: r.zone === 0 ? "SAT" : r.zone === 1 ? "UNSAT" : "LAYER " + r.layer, species: r.species, value: r.value } })),
  check: (session, row, label) => {
    if (!/^(SAT|UNSAT|LAYER \d+)$/.test(row.values.zone)) return label + ": choose the zone.";
    if (!species(session).some(([v]) => same(v, row.values.species))) return label + ": choose a species (" + species(session).map(([, l]) => l).join(", ") + ").";
    if (!Number.isFinite(num(row.values.value))) return label + ": enter the initial value.";
    return null;
  },
  key: (row) => row.values.zone + "|" + String(row.values.species).toUpperCase(),
  keyName: "zone and species",
  canon: (session, row) => ({ ...row, values: { ...row.values, species: species(session).find(([v]) => same(v, row.values.species))[0] } }),
  clear: (sf) => {
    const tr = sf.groundwater.transport;
    for (let i = tr.initialQuality.length - 1; i >= 0; i--) tr.removeInitialQuality(i);
  },
  write: (sf, row, at) => {
    const z = row.values.zone;
    sf.groundwater.transport.setInitialQuality({ scope: row.scope, tag: at.tag ?? "", cell: at.cell ?? -1, zone: z === "SAT" ? 0 : z === "UNSAT" ? 1 : 2, layer: z.startsWith("LAYER") ? Number(z.slice(6)) : -1, species: row.values.species, value: num(row.values.value) });
  },
  note: "The aquifer's water at the start ([GW_INITIAL_QUALITY]): saturated (SAT) or unsaturated (UNSAT) zone, in the species' units (water age in seconds, temperature in °C).",
};
export const scopedSections = Object.keys(sections);

/** A section's columns and rows (only for a model with a mesh). */
export function scopedRows(session, name) {
  const sec = sections[name];
  if (!sec) throw new Error("No 2D section " + name + ".");
  if (!session.cells?.mannings?.length) throw new Error("This model has no 2D surface.");
  return { name, title: sec.title, scopes: sec.scopes === null ? null : sec.scopes || scopes, columns: sec.columns(session), rows: sec.read(session.solver.surface2d, session), note: sec.note, tags: [...new Set(session.cells.tag.filter(Boolean))].sort(), cells: session.cells.mannings.length };
}

/** Replace a section's rows, all checked first; returns the rows there were (undo). */
export function setScopedRows(session, name, rows) {
  const sec = sections[name];
  const { rows: before, tags, cells } = scopedRows(session, name);
  const errors = [],
    seen = new Set();
  rows.forEach((row, i) => {
    const label = "Row " + (i + 1);
    const scope = sec.scopes === null ? "NONE" : row.scope,
      t = String(row.target ?? "").trim();
    if (sec.scopes !== null && !(scope in (sec.scopes || scopes))) return errors.push(label + ": choose " + Object.values(sec.scopes || scopes).join(", ").toLowerCase() + ".");
    if (scope === "TAG" && !tags.some((x) => same(x, t))) return errors.push(label + ": no cell has the tag " + (t || "(blank)") + (tags.length ? " (tags: " + tags.join(", ") + ")." : "; this mesh has no tags."));
    if (scope === "CELL" && !(Number.isInteger(Number(t)) && Number(t) >= 1 && Number(t) <= cells)) return errors.push(label + ": a cell is a number from 1 to " + cells + ".");
    const problem = sec.check(session, row, label);
    if (problem) return errors.push(problem);
    const key = scope + ":" + (scope === "GLOBAL" ? "*" : t.toUpperCase()) + ":" + (sec.key ? sec.key(row) : "");
    if (seen.has(key)) errors.push(label + " repeats an earlier row" + (sec.scopes === null ? "" : "'s scope" + (sec.key ? " and " + (sec.keyName || "species") : "")) + ".");
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
