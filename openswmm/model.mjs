// Engine-as-model: one solver kept in the OPENED state so edits go through the engine API
// (catalog field paths) and the INP deck becomes a derived artifact written by the engine.
import { Solver, FIELDS, catalog, NodeType, LinkType, TableType, PatternType, XSectShape, FlowUnits } from "./vendor/engine/index.js";
import { localPath } from "./simulation.mjs";

/** Sub-view path prefixes that only apply to one object type. */
const subviews = {
  "node.storage.": "STORAGE",
  "node.outfall.": "OUTFALL",
  "node.divider.": "DIVIDER",
  "link.pump.": "PUMP",
  "link.weir.": "WEIR",
  "link.orifice.": "ORIFICE",
  "link.outlet.": "OUTLET",
};
export const objectKinds = ["options", "model", "node", "link", "subcatchment", "gage", "cell", "timeseries", "curve", "pattern", "hydrograph", "controls"];
/** Record kinds: edited as whole tables in the record editor rather than as property rows. */
export const recordKinds = ["timeseries", "curve", "pattern", "hydrograph"];
/** External inflow types ([INFLOWS]); a FLOW row is always type FLOW. */
export const inflowTypes = ["FLOW", "CONCEN", "MASS"];
/** Dry-weather pattern slots, in [DWF] column order, and the pattern type each takes. */
export const dwfSlots = ["monthly", "daily", "hourly", "weekend"];
const range = (n) => Array.from({ length: n }, (_, i) => i);
const same = (a, b) => String(a).toUpperCase() === String(b).toUpperCase();
/** Factors per pattern type ([PATTERNS]). */
export const patternLength = { MONTHLY: 12, DAILY: 7, HOURLY: 24, WEEKEND: 24 };
const DAY_MS = 86400000;
/** A UTC Date as a SWMM DateTime: whole days since 1899-12-30 plus the time of day, as the engine encodes it. */
const oadate = (d) => {
  const days = Math.floor(d.getTime() / DAY_MS);
  return days + 25569 + (d.getTime() - days * DAY_MS) / DAY_MS;
};
const validName = (name) => {
  const id = String(name ?? "").trim();
  if (!id || /[\s;"]/.test(id)) throw new Error("A name needs at least one character and no spaces, quotes or semicolons.");
  return id;
};
/** Known value sets of `[OPTIONS]` keys, for dropdowns; other keys edit as text and the engine validates. */
const optionChoices = {
  FLOW_UNITS: ["CFS", "GPM", "MGD", "CMS", "LPS", "MLD"],
  FLOW_ROUTING: ["STEADY", "KINWAVE", "DYNWAVE"],
  LINK_OFFSETS: ["DEPTH", "ELEVATION"],
  INFILTRATION: ["HORTON", "MODIFIED_HORTON", "GREEN_AMPT", "MODIFIED_GREEN_AMPT", "CURVE_NUMBER"],
  FORCE_MAIN_EQUATION: ["H-W", "D-W"],
  NORMAL_FLOW_LIMITED: ["SLOPE", "FROUDE", "BOTH", "NONE"],
  INERTIAL_DAMPING: ["NONE", "PARTIAL", "FULL"],
  SURCHARGE_METHOD: ["EXTRAN", "SLOT"],
  COMPATIBILITY: ["5", "6"],
};
const yesNo = /^(ALLOW_PONDING|SKIP_STEADY_STATE|IGNORE_\w+|RPT_\w+|REPORT_SIGNED_HEADS|NODE_CONTINUITY|WATER_AGE|HEAT_TRANSPORT|WRITE_ABSOLUTE_PATHS|VARIABLE_STEP)$/;
/** Per-cell 2D attributes: engine setters work in the OPENED state, the getters only after initialize(). */
const cellFields = {
  "cell.mannings": { label: "Manning n", type: "float", units: "manning_n", column: "mannings", set: "setTriangleMannings", doc: "Manning's roughness of the surface cell ([2D_TRIANGLES] / [2D_QUADS] column)." },
  "cell.init_depth": { label: "Initial depth", type: "float", units: "length", column: "initDepth", set: "setTriangleInitDepth", doc: "Initial water depth of the cell." },
  "cell.tag": { label: "Tag", type: "str", column: "tag", set: "setTriangleTag", doc: "Cell tag used by [2D_INFILTRATION_DEFAULTS], quality and coupling rows." },
};
function sections(text) {
  const rows = {};
  let current;
  for (const line of text.split(/\r?\n/)) {
    const s = line.split(";")[0].trim();
    if (!s) continue;
    if (s.startsWith("[")) {
      current = s.toUpperCase();
      rows[current] ??= [];
    } else if (current) rows[current].push(s.split(/\s+/));
  }
  return rows;
}
/** Cell attribute columns of a deck (or of its [2D_MESH_FILE] sidecar), in engine cell order. */
function parseCells(fs, entry) {
  const text = fs.readFile(entry, { encoding: "utf8" });
  let s = sections(text);
  const external = s["[2D_MESH_FILE]"]?.find((row) => row[0].toUpperCase() === "FILE")?.[1];
  if (external && !s["[2D_TRIANGLES]"] && fs.analyzePath(external).exists)
    s = sections(fs.readFile(external, { encoding: "utf8" }));
  const cells = { mannings: [], initDepth: [], tag: [] };
  for (const [key, n] of [["[2D_TRIANGLES]", 3], ["[2D_QUADS]", 4]])
    for (const row of s[key] || []) {
      cells.mannings.push(Number(row[n]));
      cells.initDepth.push(row[n + 1] !== undefined && row[n + 1] !== "*" ? Number(row[n + 1]) : 0);
      cells.tag.push(row[n + 2] ?? "");
    }
  return cells;
}
/** Plain names of the engine's reference slots in impact entries. */
const fieldNames = {
  ts_index: "time series",
  xsect_curve: "shape curve",
  pat1: "monthly pattern",
  pat2: "daily pattern",
  pat3: "hourly pattern",
  pat4: "weekend pattern",
  upper_evap_pat: "upper evaporation pattern",
  uh_name: "unit hydrograph",
};
/** Time series that read their values from a file (`name FILE path`), keyed by upper-case name. */
function fileSeries(fs, entry) {
  const rows = sections(fs.readFile(entry, { encoding: "utf8" }))["[TIMESERIES]"] || [];
  return new Map(rows.filter((r) => r[1]?.toUpperCase() === "FILE").map((r) => [r[0].toUpperCase(), r.slice(2).join(" ").replace(/^"|"$/g, "")]));
}
/** Settable through the API but simulation state rather than deck parameters; not shown. */
const runtimeState = new Set([
  "node.depth",
  "node.lateral_inflow",
  "link.flow",
  "link.closed",
  "link.control_setting",
  "link.target_setting",
  "gage.rainfall",
]);
const collections = {
  node: "nodes",
  link: "links",
  subcatchment: "subcatchments",
  gage: "gages",
};
const label = (path) => {
  const name = path.split(".").pop().replaceAll("_", " ");
  return name[0].toUpperCase() + name.slice(1);
};
function empty(fs, dir) {
  if (!fs.analyzePath(dir).exists) return;
  for (const name of fs.readdir(dir)) {
    if (name === "." || name === "..") continue;
    const path = dir + "/" + name;
    if (fs.isDir(fs.stat(path).mode)) {
      empty(fs, path);
      fs.rmdir(path);
    } else fs.unlink(path);
  }
}
export class ModelSession {
  constructor(engine) {
    this.engine = engine;
    this.solver = null;
  }
  /** Stage a project's inputs and open its entry deck for editing. */
  open(project) {
    this.close();
    const fs = this.engine.FS;
    if (!fs.analyzePath("/edit").exists) fs.mkdir("/edit");
    empty(fs, "/edit");
    fs.chdir("/edit");
    this.entry = localPath(project.entry);
    for (const [name, data] of Object.entries(project.inputs)) {
      localPath(name);
      if (name.includes("/")) fs.mkdirTree(name.slice(0, name.lastIndexOf("/")));
      fs.writeFile(name, data);
    }
    fs.mkdir("_edit");
    const solver = (this.solver = new Solver(this.engine));
    solver.open(this.entry, "_edit/model.rpt", "_edit/model.out");
    this.unitSystem = solver.unitSystem;
    this.flowUnits = solver.flowUnits;
    this.cells = parseCells(fs, this.entry);
    this.files = fileSeries(fs, this.entry);
    return this.summary();
  }
  summary() {
    const s = this.solver;
    const typed = (ids, get, names) =>
      ids.map((id) => {
        const view = get(id);
        return { id, type: names ? names[view.type] : undefined };
      });
    const links = s.links.ids.map((id) => {
      const l = s.links.get(id);
      return { id, type: LinkType[l.type], from: l.fromNode.id, to: l.toNode.id };
    });
    const tables = Array.from({ length: s.tables.length }, (_, i) => ({ id: s.tables.getId(i), type: s.tables.getType(i) }));
    return {
      entry: this.entry,
      unitSystem: this.unitSystem,
      flowUnits: this.flowUnits,
      flowUnitsName: FlowUnits[this.flowUnits], // CFS, GPM, MGD, CMS, LPS or MLD
      warnings: s.openWarnings,
      cells: this.cells.mannings.length,
      objects: {
        node: typed(s.nodes.ids, (id) => s.nodes.get(id), NodeType),
        link: links,
        subcatchment: s.subcatchments.ids.map((id) => ({ id })),
        gage: s.gages.ids.map((id) => ({ id })),
        timeseries: tables.filter((t) => t.type === TableType.TIMESERIES).map((t) => ({ id: t.id })),
        curve: tables
          .filter((t) => t.type !== TableType.TIMESERIES)
          .map((t) => ({ id: t.id, type: TableType[t.type].replace("CURVE_", "") })),
        pattern: Array.from({ length: s.patterns.length }, (_, i) => {
          const p = s.patterns.get(i);
          return { id: p.id, type: PatternType[p.type] };
        }),
        hydrograph: range(s.inflows.hydrographGroupCount).map((i) => ({ id: s.inflows.getHydrographGroupId(i) })),
      },
    };
  }
  /**
   * One table record as plain data. Time series and curve points are raw `[x, y]` pairs; a time
   * series x is a SWMM DateTime (days), its leading `relative.count` rows authored as elapsed time
   * from `relative.anchor`. `start` is the model's start (SWMM DateTime) for new rows.
   */
  /**
   * The index of a time series or curve by name, or -1. Names are unique per kind only (a time
   * series and a curve may share one, as in legacy SWMM), so lookups go by kind and name.
   */
  findTable(kind, id) {
    const t = this.solver.tables;
    const key = String(id).toUpperCase();
    for (let i = 0; i < t.length; i++)
      if ((t.getType(i) === TableType.TIMESERIES) === (kind === "timeseries") && t.getId(i).toUpperCase() === key) return i;
    return -1;
  }
  table(kind, id) {
    const i = this.findTable(kind, id);
    if (i < 0) throw new Error("No " + (kind === "timeseries" ? "time series" : "curve") + " named " + id + ".");
    return i;
  }
  record(kind, id) {
    const s = this.solver;
    if (kind === "hydrograph") return this.hydrograph(id);
    if (kind === "pattern") {
      const p = s.patterns.get(id);
      return { kind, id: p.id, type: PatternType[p.type], factors: p.factors };
    }
    const i = this.table(kind, id);
    const record = { kind, id: s.tables.getId(i), type: TableType[s.tables.getType(i)].replace("CURVE_", ""), points: s.tables.get(i).points };
    if (kind === "timeseries") {
      const [count, anchor] = s.tables.asTimeseries(i).relativeInfo;
      record.relative = { count, anchor };
      record.file = this.files.get(record.id.toUpperCase()) ?? null;
      record.start = oadate(s.editor.startDatetime);
    }
    return record;
  }
  /** Replace a record's rows (and a curve's or pattern's type) after the engine validates them; returns the stored record. */
  setRecord(kind, id, data) {
    const s = this.solver;
    if (kind === "hydrograph") return this.setHydrograph(id, data);
    if (kind === "pattern") {
      const type = PatternType[data.type];
      if (type === undefined) throw new Error("Unknown pattern type " + data.type + ".");
      const factors = data.factors.map(Number);
      if (factors.length !== patternLength[data.type]) throw new Error(`A ${data.type.toLowerCase()} pattern has ${patternLength[data.type]} factors.`);
      if (!factors.every(Number.isFinite)) throw new Error("Every factor must be a number.");
      s.patterns.get(id).setFactors(factors, type);
      return this.record(kind, id);
    }
    const current = this.record(kind, id);
    if (current.file) throw new Error(id + " reads its values from " + current.file + "; edit that file instead.");
    const rows = data.points.map((p) => p.map(Number));
    if (!rows.length) throw new Error("A " + (kind === "timeseries" ? "time series" : "curve") + " needs at least one row.");
    if (!rows.every((r) => r.length === 2 && r.every(Number.isFinite))) throw new Error("Every row needs two numbers.");
    const options = kind === "timeseries" ? { relativeCount: data.relative?.count ?? 0, anchor: data.relative?.anchor ?? 0 } : {};
    const type = kind === "curve" ? TableType["CURVE_" + data.type] : undefined;
    if (kind === "curve" && type === undefined) throw new Error("Unknown curve type " + data.type + ".");
    const i = this.table(kind, id);
    const before = s.tables.getType(i);
    if (type !== undefined && type !== before) s.tables.setType(i, type);
    try {
      s.tables.get(i).validatePoints(rows, options);
    } catch (e) {
      if (type !== undefined && type !== before) s.tables.setType(i, before);
      throw e;
    }
    s.tables.get(i).replacePoints(rows, options); // no fileToken: the table keeps any FILE reference
    return this.record(kind, id);
  }
  /** Add a record with one placeholder row (a pattern of ones); returns it. */
  addRecord(kind, name, type) {
    const s = this.solver;
    const id = validName(name);
    if (kind === "hydrograph") {
      if (this.groupIndex(id) >= 0) throw new Error("A unit hydrograph named " + id + " exists.");
      const gage = s.gages.ids[0];
      if (!gage) throw new Error("Add a rain gage first: a unit hydrograph names one.");
      s.inflows.addHydrographGage(id, gage);
      return this.record(kind, id);
    }
    if (kind === "pattern") {
      if (s.patterns.has(id)) throw new Error("A pattern named " + id + " exists.");
      if (!(type in patternLength)) throw new Error("Unknown pattern type " + type + ".");
      s.patterns.add(id, PatternType[type]).setFactors(Array(patternLength[type]).fill(1), PatternType[type]);
      return this.record(kind, id);
    }
    if (this.findTable(kind, id) >= 0) throw new Error("A " + (kind === "timeseries" ? "time series" : "curve") + " named " + id + " exists.");
    if (kind === "timeseries") s.tables.addTimeseries(id).replacePoints([[oadate(s.editor.startDatetime), 0]]);
    else {
      const code = TableType["CURVE_" + type];
      if (code === undefined) throw new Error("Unknown curve type " + type + ".");
      s.tables.addCurve(id, code); // the engine takes the TableType code
      s.tables.get(this.table(kind, id)).replacePoints([[0, 0]]);
    }
    return this.record(kind, id);
  }
  renameRecord(kind, id, name) {
    const s = this.solver;
    const next = validName(name);
    const taken = kind === "pattern" ? s.patterns.has(next) : kind === "hydrograph" ? this.groupIndex(next) >= 0 : this.findTable(kind, next) >= 0;
    if (taken && next.toUpperCase() !== id.toUpperCase()) throw new Error(next + " is taken.");
    if (kind === "hydrograph") s.inflows.renameHydrographGroup(this.group(id), next); // RDII rows follow
    else if (kind === "pattern") s.patterns.rename(id, next);
    else s.tables.rename(this.table(kind, id), next);
    const file = kind === "timeseries" ? this.files.get(id.toUpperCase()) : undefined;
    if (file !== undefined) {
      this.files.delete(id.toUpperCase());
      this.files.set(next.toUpperCase(), file);
    }
    return next;
  }
  /** The model objects that refer to a record and would lose the reference if it were deleted. */
  impact(kind, id) {
    const s = this.solver;
    const entries =
      kind === "pattern"
        ? s.editor.analyzePatternImpact(id)
        : kind === "hydrograph"
          ? s.editor.analyzeHydrographImpact(s.inflows.getHydrographGroupId(this.group(id)))
          : s.editor.analyzeTableImpact(this.table(kind, id));
    const named = (list, i) => list.ids?.[i] ?? list.getId?.(i);
    return entries
      .filter((e) => {
        // The engine also lists STREET and IRREGULAR links (their street/transect index sits in the
        // same slot); only a CUSTOM cross-section refers to a curve.
        if (e.field !== "xsect_curve") return true;
        const link = s.links.get(s.links.ids[e.objIdx]);
        return link.xsect.shape === XSectShape.CUSTOM;
      })
      .map((e) => {
        const type = e.objTypeName;
        let name;
        if (type in { node: 1, link: 1, subcatchment: 1, gage: 1 }) name = named(s[type === "subcatchment" ? "subcatchments" : type + "s"], e.objIdx);
        else if (type === "dwf_inflow") name = "dry-weather " + s.inflows.getDwf(e.objIdx)[1] + " at " + s.nodes.ids[s.inflows.getDwf(e.objIdx)[0]];
        else if (type === "aquifer") name = s.aquifers.getId(e.objIdx);
        else if (type === "rdii_assign") return { object: "RDII at " + s.nodes.ids[s.inflows.getRdii(e.objIdx).nodeIndex], field: "unit hydrograph" };
        return { object: (type.replaceAll("_", " ") + " " + (name ?? "#" + (e.objIdx + 1))).trim(), field: fieldNames[e.field] ?? e.field.replaceAll("_", " ") };
      });
  }
  /**
   * Delete a record (references to it are cleared by the engine); returns the impact and an undo
   * token: the deck written just before, which `restore` reopens.
   */
  deleteRecord(kind, id) {
    const impact = this.impact(kind, id);
    const token = this.entry.replace(/[^/]*$/, "") + ".undo-" + (this.undoSeq = (this.undoSeq || 0) + 1) + ".inp";
    this.solver.write(token);
    if (kind === "pattern") this.solver.editor.deletePattern(id);
    else if (kind === "hydrograph") this.solver.editor.deleteHydrograph(this.solver.inflows.getHydrographGroupId(this.group(id)));
    else this.solver.editor.deleteTable(this.table(kind, id));
    if (kind === "timeseries") this.files.delete(String(id).toUpperCase());
    return { impact, token };
  }
  // ---- Unit hydrographs ([HYDROGRAPHS]): a group names a rain gage and holds up to three responses
  // (0 short, 1 medium, 2 long term) for all months (-1) or for one month (0 = January … 11).
  groupIndex(id) {
    const inf = this.solver.inflows;
    return range(inf.hydrographGroupCount).findIndex((i) => same(inf.getHydrographGroupId(i), id));
  }
  group(id) {
    const i = this.groupIndex(id);
    if (i < 0) throw new Error("No unit hydrograph named " + id + ".");
    return i;
  }
  hydrograph(id) {
    const inf = this.solver.inflows;
    const name = inf.getHydrographGroupId(this.group(id));
    const gage = range(inf.hydrographGageCount).map((i) => inf.getHydrographGage(i)).find((g) => same(g.uhName, name));
    const entries = range(inf.hydrographCount)
      .map((i) => inf.getHydrograph(i))
      .filter((h) => same(h.uhName, name))
      .map(({ month, response, r, t, k, dmax, drecov, dinit }) => ({ month, response, r, t, k, dmax, drecov, dinit }));
    return { kind: "hydrograph", id: name, gage: gage?.gageName ?? "", entries };
  }
  /** Replace a group's gage and responses: changed and new responses are set, missing ones removed. */
  setHydrograph(id, data) {
    const s = this.solver,
      inf = s.inflows;
    const current = this.hydrograph(id);
    const gage = s.gages.ids.find((g) => same(g, data.gage));
    if (!gage) throw new Error("No rain gage named " + data.gage + ".");
    const key = (e) => e.month + "/" + e.response;
    const seen = new Set();
    for (const e of data.entries) {
      if (!Number.isInteger(e.month) || e.month < -1 || e.month > 11) throw new Error("A month is -1 (all months) or 0 to 11.");
      if (![0, 1, 2].includes(e.response)) throw new Error("A response is short (0), medium (1) or long (2) term.");
      if (seen.has(key(e))) throw new Error("Each month has one row per response.");
      seen.add(key(e));
      for (const f of ["r", "t", "k", "dmax", "drecov", "dinit"])
        if (!Number.isFinite(e[f]) || e[f] < 0) throw new Error("R, T, K and the initial abstraction values must be numbers of zero or more.");
    }
    if (!same(gage, current.gage)) inf.setHydrographGage(current.id, gage);
    for (const e of current.entries) if (!seen.has(key(e))) inf.removeHydrographEntry(current.id, e.month, e.response);
    for (const e of data.entries) {
      const was = current.entries.find((c) => key(c) === key(e));
      if (was && ["r", "t", "k", "dmax", "drecov", "dinit"].every((f) => was[f] === e[f])) continue;
      inf.setHydrographRtk(current.id, e.month, e.response, e.r, e.t, e.k); // adds a missing response
      inf.setHydrographIa(current.id, e.month, e.response, e.dmax, e.drecov, e.dinit);
    }
    return this.hydrograph(current.id);
  }

  // ---- Control rules ([CONTROLS])
  rules() {
    const c = this.solver.controls;
    return range(c.length).map((i) => ({ ...c.get(i) }));
  }
  /** The engine's verdict on each rule text: `{ id, ok, message }`. */
  checkRules(texts) {
    return texts.map((text) => {
      const [ok, message] = this.solver.controls.validateMessage(text);
      return { id: text.match(/^\s*RULE\s+(\S+)/i)?.[1] ?? "?", ok, message };
    });
  }
  /** Replace the whole rule program after every rule passes the engine's check; returns the stored rules. */
  setRules(texts) {
    const bad = this.checkRules(texts).filter((r) => !r.ok);
    if (bad.length) throw new Error(bad.map((r) => "Rule " + r.id + ", " + r.message).join("\n"));
    this.solver.controls.replaceProgram(texts);
    return this.rules();
  }
  /** Ids of the rules that name an object. */
  ruleRefs(name) {
    const c = this.solver.controls;
    return c.findReferences(name).map((i) => c.get(i).id);
  }

  // ---- Inflows per node ([INFLOWS], [DWF], [RDII]). The engine adds rows without checking their
  // names, types or duplicates (a bad row makes the written deck unreadable), so they are checked here.
  nodeIndex(node) {
    const i = this.solver.nodes.ids.findIndex((n) => same(n, node));
    if (i < 0) throw new Error("No node named " + node + ".");
    return i;
  }
  /** Names an inflow row may use: constituents, time series, patterns by type, unit hydrographs. */
  inflowChoices() {
    const s = this.solver;
    const patterns = { MONTHLY: [], DAILY: [], HOURLY: [], WEEKEND: [] };
    for (const i of range(s.patterns.length)) {
      const p = s.patterns.get(i);
      patterns[PatternType[p.type]].push(p.id);
    }
    return {
      constituents: ["FLOW", ...range(s.pollutants.length).map((i) => s.pollutants.getId(i))],
      series: range(s.tables.length).filter((i) => s.tables.getType(i) === TableType.TIMESERIES).map((i) => s.tables.getId(i)),
      patterns,
      hydrographs: range(s.inflows.hydrographGroupCount).map((i) => s.inflows.getHydrographGroupId(i)),
    };
  }
  inflows(node) {
    const inf = this.solver.inflows;
    const n = this.nodeIndex(node);
    const rdii = range(inf.rdiiCount).map((i) => inf.getRdii(i)).find((r) => r.nodeIndex === n);
    return {
      node: this.solver.nodes.ids[n],
      external: range(inf.externalCount)
        .map((i) => inf.getExternal(i))
        .filter((r) => r[0] === n)
        .map(([, constituent, series, type, mFactor, sFactor, baseline, pattern]) => ({ constituent, series, type, mFactor, sFactor, baseline, pattern })),
      dwf: range(inf.dwfCount)
        .map((i) => inf.getDwf(i))
        .filter((r) => r[0] === n)
        .map(([, constituent, average, monthly, daily, hourly, weekend]) => ({ constituent, average, monthly, daily, hourly, weekend })),
      rdii: rdii ? { hydrograph: rdii.uhName, area: rdii.area } : null,
    };
  }
  /** Check one node's inflow rows against the model; returns them with canonical names. */
  checkInflows(data) {
    const c = this.inflowChoices();
    const pick = (list, name, what) => {
      if (name === "" || name == null) return "";
      const hit = list.find((x) => same(x, name));
      if (!hit) throw new Error("No " + what + " named " + name + ".");
      return hit;
    };
    const num = (v, what, min = -Infinity) => {
      const x = Number(v);
      if (v === "" || !Number.isFinite(x) || x < min) throw new Error(what + (min === 0 ? " must be a number of zero or more." : " must be a number."));
      return x;
    };
    const once = (rows, what) => {
      const names = rows.map((r) => r.constituent.toUpperCase());
      const dup = names.find((n, i) => names.indexOf(n) !== i);
      if (dup) throw new Error("Only one " + what + " per constituent: " + dup + " is listed twice.");
    };
    const external = data.external.map((r) => {
      const constituent = pick(c.constituents, r.constituent, "pollutant") || (() => { throw new Error("Choose a constituent for each external inflow."); })();
      const type = constituent === "FLOW" ? "FLOW" : String(r.type).toUpperCase();
      if (!inflowTypes.includes(type) || (constituent !== "FLOW" && type === "FLOW")) throw new Error("A pollutant inflow is CONCEN or MASS.");
      const row = {
        constituent,
        series: pick(c.series, r.series, "time series"),
        type,
        mFactor: num(r.mFactor, "The conversion factor"),
        sFactor: num(r.sFactor, "The scale factor"),
        baseline: num(r.baseline, "The baseline"),
        pattern: pick(Object.values(c.patterns).flat(), r.pattern, "pattern"),
      };
      if (!row.series && !row.baseline) throw new Error("An external inflow needs a time series or a baseline.");
      return row;
    });
    once(external, "external inflow");
    const dwf = data.dwf.map((r) => {
      const constituent = pick(c.constituents, r.constituent, "pollutant") || (() => { throw new Error("Choose a constituent for each dry-weather inflow."); })();
      const row = { constituent, average: num(r.average, "The average value") };
      for (const slot of dwfSlots) row[slot] = pick(c.patterns[slot.toUpperCase()], r[slot], slot + " pattern");
      return row;
    });
    once(dwf, "dry-weather inflow");
    const rdii = data.rdii && data.rdii.hydrograph ? { hydrograph: pick(c.hydrographs, data.rdii.hydrograph, "unit hydrograph"), area: num(data.rdii.area, "The sewershed area", 0) } : null;
    return { external, dwf, rdii };
  }
  /**
   * Replace one node's inflow rows. Each list is rebuilt in order: a row for a constituent the node
   * already had keeps its place, a new one goes after the node's last row (or at the end), so the
   * written deck changes only where the edit is.
   */
  setInflows(node, data) {
    const inf = this.solver.inflows;
    const n = this.nodeIndex(node);
    const rows = this.checkInflows(data);
    const rebuild = (count, get, remove, add, mine) => {
      const all = range(count()).map(get);
      const key = (r) => String(r[1]).toUpperCase(); // the constituent (RDII: the node has one row)
      const fresh = new Map(mine.map((r) => [key(r), r]));
      const placed = new Set();
      const next = [];
      const last = all.findLastIndex((r) => r[0] === n);
      const rest = () => mine.filter((r) => !placed.has(key(r)));
      all.forEach((r, i) => {
        if (r[0] !== n) next.push(r);
        else if (fresh.has(key(r)) && !placed.has(key(r))) {
          next.push(fresh.get(key(r)));
          placed.add(key(r));
        }
        if (i === last)
          for (const r of rest()) {
            placed.add(key(r));
            next.push(r);
          }
      });
      if (last < 0) next.push(...mine);
      if (JSON.stringify(next) === JSON.stringify(all)) return;
      for (let i = count() - 1; i >= 0; i--) remove(i);
      for (const r of next) add(r);
    };
    rebuild(
      () => inf.externalCount,
      (i) => inf.getExternal(i),
      (i) => inf.removeExternal(i),
      ([node, constituent, tsName, type, mFactor, sFactor, baseline, pattern]) => inf.addExternal(node, constituent, { tsName, type, mFactor, sFactor, baseline, pattern }),
      rows.external.map((r) => [n, r.constituent, r.series, r.type, r.mFactor, r.sFactor, r.baseline, r.pattern]),
    );
    rebuild(
      () => inf.dwfCount,
      (i) => inf.getDwf(i),
      (i) => inf.removeDwf(i),
      ([node, constituent, avgValue, monthlyPattern, dailyPattern, hourlyPattern, weekendPattern]) =>
        inf.addDwf(node, constituent, { avgValue, monthlyPattern, dailyPattern, hourlyPattern, weekendPattern }),
      rows.dwf.map((r) => [n, r.constituent, r.average, r.monthly, r.daily, r.hourly, r.weekend]),
    );
    rebuild(
      () => inf.rdiiCount,
      (i) => {
        const r = inf.getRdii(i);
        return [r.nodeIndex, "RDII", r.uhName, r.area];
      },
      (i) => inf.removeRdii(i),
      ([node, , uh, area]) => inf.addRdii(node, uh, area),
      rows.rdii ? [[n, "RDII", rows.rdii.hydrograph, rows.rdii.area]] : [],
    );
    return this.inflows(node);
  }
  /** Reopen the deck saved by `deleteRecord` (undo of a delete); returns the summary. */
  restore(token) {
    const fs = this.engine.FS;
    const bytes = fs.readFile(token);
    for (const step of ["close", "destroy"])
      try {
        this.solver[step]();
      } catch {}
    fs.writeFile(this.entry, bytes);
    fs.unlink(token);
    const solver = (this.solver = new Solver(this.engine));
    solver.open(this.entry, "_edit/model.rpt", "_edit/model.out");
    this.files = fileSeries(fs, this.entry);
    return this.summary();
  }
  /** The settable catalog fields of one object (or of the model when kind is "model"). */
  fields(kind, key) {
    const s = this.solver;
    if (kind === "options") {
      const rows = [];
      for (const name of s.options) {
        const value = s.options.get(name);
        const choices = optionChoices[name] || (yesNo.test(name) ? ["YES", "NO"] : null);
        rows.push({
          path: "options." + name,
          label: name,
          value,
          type: "str",
          unit: null,
          doc: "[OPTIONS] " + name,
          choices: choices && !choices.includes(value) && value !== "" ? [...choices, value] : choices,
        });
      }
      return rows;
    }
    if (kind === "cell") {
      const i = Math.trunc(Number(key));
      if (!(i >= 0 && i < this.cells.mannings.length)) throw new Error("No surface cell " + key + ".");
      return Object.entries(cellFields).map(([path, f]) => ({
        path,
        label: f.label,
        value: this.cells[f.column][i],
        type: f.type,
        unit: catalog.unitLabel(f.units, this.unitSystem, this.flowUnits),
        doc: f.doc,
      }));
    }
    const type =
      kind === "node"
        ? NodeType[s.nodes.get(key).type]
        : kind === "link"
          ? LinkType[s.links.get(key).type]
          : null;
    const rows = [];
    for (const [path, spec] of Object.entries(FIELDS)) {
      if (!spec.set) continue;
      if (kind === "model" ? spec.element : spec.element !== kind) continue;
      const sub = Object.keys(subviews).find((prefix) => path.startsWith(prefix));
      if (sub && subviews[sub] !== type) continue;
      if (path.includes(".stats.") || runtimeState.has(path)) continue;
      let value;
      try {
        value = s.fields.get(path, kind === "model" ? undefined : key);
      } catch {
        continue; // runtime-only field: the engine refuses it in the OPENED state
      }
      rows.push({
        path,
        label: label(path),
        value,
        type: spec.type,
        unit: spec.units ? catalog.unitLabel(spec.units, this.unitSystem, this.flowUnits) : null,
        doc: spec.doc,
      });
    }
    return rows;
  }
  /** Set one 2D cell attribute through Surface2D; returns the stored value. */
  setCell(path, index, value) {
    const f = cellFields[path];
    const i = Math.trunc(Number(index));
    if (!f || !(i >= 0 && i < this.cells.mannings.length))
      throw new Error("No surface cell " + index + ".");
    const v = f.type === "str" ? String(value) : Number(value);
    if (f.type !== "str" && !Number.isFinite(v)) throw new Error("Enter a number for " + f.label + ".");
    this.solver.surface2d[f.set](i, v);
    this.cells[f.column][i] = v;
    return v;
  }
  /** Apply one value to every surface cell (bulk edit); returns the cell count. */
  setAll(path, value) {
    const n = this.cells.mannings.length;
    for (let i = 0; i < n; i++) this.setCell(path, i, value);
    return n;
  }
  /** Set one field; returns the value the engine now reports. */
  set(path, key, value) {
    if (path.startsWith("cell.")) return this.setCell(path, key, value);
    if (path.startsWith("options.")) {
      const name = path.slice(8);
      if (!this.solver.options.has(name)) throw new Error("Unknown option " + name);
      this.solver.options.set(name, String(value).trim()); // the engine validates the value
      return this.solver.options.get(name);
    }
    const spec = FIELDS[path];
    if (!spec?.set) throw new Error("Not an editable field: " + path);
    let v;
    if (spec.type === "float") v = Number(value);
    else if (spec.type === "bool") v = value === true || value === "true";
    else if (spec.type === "str") v = String(value);
    else v = Math.trunc(Number(value));
    if (typeof v === "number" && !Number.isFinite(v))
      throw new Error("Enter a number for " + label(path) + ".");
    const element = spec.element ? key : undefined;
    this.solver.fields.set(path, element, v);
    return this.solver.fields.get(path, element);
  }
  /** Write the model back to its entry deck through the engine's INP writer; returns the bytes. */
  write() {
    this.solver.write(this.entry);
    return this.engine.FS.readFile(this.entry);
  }
  close() {
    if (!this.solver) return;
    for (const step of ["close", "destroy"])
      try {
        this.solver[step]();
      } catch {}
    this.solver = null;
    try {
      this.engine.FS.chdir("/");
      empty(this.engine.FS, "/edit"); // release the staged inputs and outputs
    } catch {}
  }
}
