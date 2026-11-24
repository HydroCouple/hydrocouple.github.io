// Engine-as-model: one solver kept in the OPENED state so edits go through the engine API
// (catalog field paths) and the INP deck becomes a derived artifact written by the engine.
import { Solver, FIELDS, catalog, NodeType, LinkType } from "./vendor/engine/index.js";
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
export const objectKinds = ["options", "model", "node", "link", "subcatchment", "gage", "cell"];
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
    return {
      entry: this.entry,
      unitSystem: this.unitSystem,
      flowUnits: this.flowUnits,
      warnings: s.openWarnings,
      cells: this.cells.mannings.length,
      objects: {
        node: typed(s.nodes.ids, (id) => s.nodes.get(id), NodeType),
        link: links,
        subcatchment: s.subcatchments.ids.map((id) => ({ id })),
        gage: s.gages.ids.map((id) => ({ id })),
      },
    };
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
