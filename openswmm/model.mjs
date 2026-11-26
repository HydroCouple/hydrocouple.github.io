// Engine-as-model: one solver kept in the OPENED state so edits go through the engine API
// (catalog field paths) and the INP deck becomes a derived artifact written by the engine.
import { Solver, FIELDS, catalog, NodeType, LinkType, TableType, PatternType, XSectShape, FlowUnits, ConcentrationUnits, LidType, LidExtraField, InletType, GrateType, ThroatType, OutfallType, DividerType, OrificeType, WeirType, OutletRatingType, GageRainType, WeirView, InfilModel, InletPlacement } from "./vendor/engine/index.js";
import { localPath } from "./simulation.mjs";
import { parseLabels, labelsText } from "./labels.mjs";
import { propertyGroups, applyGroup, replacedRows } from "./properties.mjs";
import { sectionKinds, sectionGroups, applySection, reportOptions } from "./sections.mjs";

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
export const objectKinds = ["options", "model", "title", "report", "files", "node", "link", "subcatchment", "gage", "cell", "pollutant", "landuse", "timeseries", "curve", "pattern", "hydrograph", "transect", "lid", "aquifer", "snowpack", "street", "inlet", "controls", "events"];
/** Record kinds: edited as whole tables in the record editor rather than as property rows. */
export const recordKinds = ["timeseries", "curve", "pattern", "hydrograph", "transect", "lid", "aquifer", "snowpack", "street", "inlet"];
/** A new street cross-section (SWMM 5.2 [STREETS]); slopes in percent, gutter depression in in or mm. */
export function streetDefaults(unitSystem) {
  const si = unitSystem === "SI";
  return { tCrown: si ? 6 : 20, hCurb: si ? 0.15 : 0.5, sx: 2, nRoad: 0.016, gutterDepres: 0, gutterWidth: 0, sides: 2, backWidth: 0, backSlope: 0, backN: 0 };
}
/** Inlet types (SWMM 5.2 [INLETS]; COMBO is a grate and a curb opening), grate types and throats. */
export const inletTypes = ["GRATE", "CURB", "COMBO", "SLOTTED", "DROP_GRATE", "DROP_CURB", "CUSTOM"];
export const grateTypes = ["P_BAR_50", "P_BAR_50x100", "P_BAR_30", "CURVED_VANE", "TILT_BAR_45", "TILT_BAR_30", "RETICULINE", "GENERIC"];
export const throatTypes = ["HORIZONTAL", "INCLINED", "VERTICAL"];
/** The parts of an inlet design each type uses. */
export const inletParts = { GRATE: ["grate"], CURB: ["curb"], COMBO: ["grate", "curb"], SLOTTED: ["slot"], DROP_GRATE: ["grate"], DROP_CURB: ["curb"], CUSTOM: ["curve"] };
/** A new inlet's dimensions (lengths in ft or m). */
export function inletDefaults(unitSystem) {
  const k = unitSystem === "SI" ? 0.3 : 1;
  return { grate: { length: 2 * k, width: 2 * k, grateType: "P_BAR_50", openArea: 0, splashVeloc: 0 }, curb: { length: 2 * k, height: 0.5 * k, throat: "HORIZONTAL" }, slot: { length: 2 * k, width: 0.5 * k }, curve: "" };
}
/** [AQUIFERS] parameters in the engine's AquiferParam order. */
export const aquiferParams = ["porosity", "wiltingPoint", "fieldCapacity", "conductivity", "conductSlope", "tensionSlope", "upperEvapFrac", "lowerEvapDepth", "lowerLossCoeff", "bottomElev", "waterTableElev", "upperMoisture"];
/** A new aquifer's starting values (SWMM's usual ones; the engine starts at zeros, which SWMM refuses). */
export const aquiferDefaults = { porosity: 0.5, wiltingPoint: 0.15, fieldCapacity: 0.3, conductivity: 5, conductSlope: 10, tensionSlope: 15, upperEvapFrac: 0.35, lowerEvapDepth: 14, lowerLossCoeff: 0.002, bottomElev: 0, waterTableElev: 10, upperMoisture: 0.3 };
/** Snowpack surfaces and their seven parameters (the last: plowable fraction, or depth at 100 % cover). */
export const snowSurfaces = ["plowable", "impervious", "pervious"];
export const snowSurfaceFields = ["cmin", "cmax", "tbase", "fwfrac", "sd0", "fw0", "last"];
export const snowRemovalFields = ["dsnow", "fout", "fimp", "fperv", "fimelt", "fsubcatch"];
/** A new snowpack's starting values (the engine starts at zeros); base temperature in °F or °C. */
export function snowpackDefaults(unitSystem) {
  const surface = { cmin: 0.001, cmax: 0.001, tbase: unitSystem === "SI" ? 0 : 32, fwfrac: 0.1, sd0: 0, fw0: 0, last: 0 };
  return { plowable: { ...surface }, impervious: { ...surface }, pervious: { ...surface }, removal: { dsnow: 1, fout: 0, fimp: 0, fperv: 0, fimelt: 0, fsubcatch: 0 }, removalSubcatch: "" };
}
/** Water-quality objects: property rows plus a name, new and delete like a record. */
export const qualityKinds = ["pollutant", "landuse"];
/** Why the engine refuses a type change: the desktop's wording of the virtual and inlet junction rules. */
const conversionRules = {
  609: "A virtual junction must connect exactly two conduits (no pumps, orifices, weirs or outlets).",
  611: "The two conduits must have identical cross sections (shape, dimensions and barrels).",
  613: "Both conduit offsets at the node must be zero (invert continuity).",
  615: "The conduit inverts do not agree at the node.",
  617: "A virtual junction cannot be coupled to a 2D surface mesh (it has no opening).",
  619: "Virtual junctions require dynamic-wave (DYNWAVE) flow routing.",
  623: "An inlet junction sits between two STREET conduits (RECT_OPEN or TRAPEZOIDAL for a drop inlet).",
  627: "The capture node must be an existing node other than the inlet itself, and not a virtual or inlet junction.",
  635: "This conduit hosts an inlet usage. Remove the assignment first.",
};
/** Name prefixes of objects placed on the map (the desktop's defaults); a new name takes the first free number. */
export const namePrefixes = { JUNCTION: "J", VIRTUAL: "VJ", INLET: "IJ", OUTFALL: "O", STORAGE: "S", DIVIDER: "D", CONDUIT: "C", PUMP: "Pu", ORIFICE: "Or", WEIR: "W", OUTLET: "Ou", GAGE: "RG", SUBCATCHMENT: "Sub" };
/**
 * Creation values of objects placed on the map: the desktop's object defaults (US customary, with
 * the SI set's lengths, areas and unit-dependent coefficients). Junctions keep the engine's zeros.
 */
export function objectDefaults(unitSystem) {
  const si = unitSystem === "SI";
  return {
    storageMaxDepth: si ? 4.5 : 15,
    storageArea: si ? 100 : 1000, // FUNCTIONAL constant, ft² or m²
    conduitDiameter: si ? 0.3 : 1,
    conduitRoughness: 0.013,
    conduitLength: si ? 120 : 400, // when the traced length is unknown
    orificeDiameter: si ? 0.3 : 1,
    orificeCd: 0.65,
    weirHeight: si ? 1 : 3,
    weirLength: si ? 1 : 3,
    weirCd: si ? 1.84 : 3.33,
    outletCoeff: si ? 0.5 : 10,
    outletExponent: 0.5,
    gageInterval: 900, // seconds (15 minutes)
    gageSnowCatch: 1,
    // Subcatchments (area when the drawn one has none; depths in in or mm, rates in in/h or mm/h).
    subcatchArea: si ? 2 : 5, // ha or ac
    subcatchWidth: si ? 150 : 500,
    subcatchSlope: 0.5,
    subcatchImperv: 25,
    nImperv: 0.012,
    nPerv: 0.15,
    dsImperv: si ? 1.5 : 0.06,
    dsPerv: si ? 3.8 : 0.15,
    zeroImperv: 25,
    horton: si ? [76, 13, 4, 7] : [3, 0.5, 4, 7],
    greenAmpt: si ? [89, 13, 0.26] : [3.5, 0.5, 0.26],
    curveNumber: [80, 7],
  };
}
/** Buildup functions, normalizers and washoff functions by their engine codes ([BUILDUP], [WASHOFF]). */
export const buildupFuncs = ["NONE", "POW", "EXP", "SAT", "EXT"];
export const normalizers = ["AREA", "CURB"];
export const washoffFuncs = ["NONE", "EXP", "RC", "EMC"];
/** Concentration units of a pollutant, deck spelling → engine name. */
export const concentrationUnits = { "MG/L": "MG_PER_L", "UG/L": "UG_PER_L", "#/L": "COUNT_PER_L" };
/** Climate sources, in the engine's code order. */
export const evapTypes = ["CONSTANT", "MONTHLY", "TIMESERIES", "TEMPERATURE", "FILE"];
/** LID control types in the engine's LidType order, and the layers each has (SWMM 5.2). */
export const lidTypes = ["BC", "RG", "GR", "IT", "PP", "RB", "RD", "VS"];
const lidTypeNames = { BC: "BIO_CELL", RG: "RAIN_GARDEN", GR: "GREEN_ROOF", IT: "INFIL_TRENCH", PP: "PERM_PAVEMENT", RB: "RAIN_BARREL", RD: "ROOFTOP_DISCONN", VS: "VEGETATIVE_SWALE" };
export const lidLayers = {
  BC: ["surface", "soil", "storage", "drain"],
  RG: ["surface", "soil", "storage"],
  GR: ["surface", "soil", "drainmat"],
  IT: ["surface", "storage", "drain"],
  PP: ["surface", "pavement", "soil", "storage", "drain"],
  RB: ["storage", "drain"],
  RD: ["surface", "drain"],
  VS: ["surface"],
};
export const lidFieldNames = {
  surface: { storage: "berm height", vegetation: "vegetation volume fraction", roughness: "surface roughness", slope: "surface slope", sideSlope: "side slope" },
  soil: { thick: "thickness", porosity: "porosity", fc: "field capacity", wp: "wilting point", ksat: "conductivity", kslope: "conductivity slope", suction: "suction head" },
  pavement: { thick: "thickness", voidRatio: "void ratio", fracImperv: "impervious surface fraction", ksat: "permeability", clogFactor: "clogging factor", regenDays: "regeneration interval", regenDegree: "regeneration fraction" },
  storage: { thick: "thickness", voidFrac: "void ratio", ksat: "seepage rate", clogging: "clogging factor", covered: "covered" },
  drain: { coeff: "flow coefficient", expon: "flow exponent", offset: "offset", delay: "drain delay", open: "open level", close: "closed level", curve: "control curve" },
  drainmat: { thick: "thickness", voidFrac: "void fraction", roughness: "roughness" },
};
/**
 * Starting layer values for a new LID control (lengths in inches or millimeters, rates per hour);
 * legacy SWMM refuses a control without its required layers.
 */
export function lidDefaults(unitSystem) {
  const k = unitSystem === "SI" ? 25 : 1; // inches → about the same in millimeters
  return {
    surface: { storage: 6 * k, roughness: 0.1, slope: 1, vegetation: 0, sideSlope: 5 },
    soil: { thick: 12 * k, porosity: 0.5, fc: 0.2, wp: 0.1, ksat: 0.5 * k, kslope: 10, suction: 3.5 * k },
    pavement: { thick: 6 * k, voidRatio: 0.15, fracImperv: 0, ksat: 100 * k, clogFactor: 0, regenDays: 0, regenDegree: 0 },
    storage: { thick: 12 * k, voidFrac: 0.75, ksat: 0.5 * k, clogging: 0, covered: true },
    drain: { coeff: 0, expon: 0.5, offset: 6 * k, delay: 6, open: 0, close: 0, curve: "" },
    drainmat: { thick: 3 * k, voidFrac: 0.5, roughness: 0.1 },
  };
}
export const tempSources = ["NONE", "TIMESERIES", "FILE"];
/** Treatment expression variables and functions the engine knows (Treatment.cpp). */
const treatmentWords = /^(C|R|DT|HRT|Q|V|D|AREA|EXP|LOG|LN|SQRT|MIN|MAX|ABS|SGN|STEP)$/i;
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
  co_pollut: "co-pollutant",
  "xsect_curve[transect]": "cross-section",
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
/** "YYYY-MM-DD HH:MM" (or with a T) as a UTC wall-clock Date, or null when it is not one. */
function parseStamp(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(String(text || "").trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
  return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] && +m[4] < 24 ? d : null;
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
    this.inputNames = Object.keys(project.inputs); // the files a [FILES] USE row may name
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
        pollutant: this.pollutantIds().map((id) => ({ id })),
        landuse: this.landuseIds().map((id) => ({ id })),
        transect: this.transectIds().map((id) => ({ id })),
        lid: this.lidIds().map((id, i) => ({ id, type: lidTypes[s.infrastructure.lids.getType(i)] ?? "NODE" })),
        aquifer: this.aquiferIds().map((id) => ({ id })),
        snowpack: this.snowpackIds().map((id) => ({ id })),
        street: [...s.infrastructure.streets].map((id) => ({ id })),
        inlet: [...s.infrastructure.inlets].map((id) => ({ id })),
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
    if (kind === "transect") return this.transect(id);
    if (kind === "lid") return this.lid(id);
    if (kind === "aquifer") return this.aquifer(id);
    if (kind === "snowpack") return this.snowpack(id);
    if (kind === "street") return this.street(id);
    if (kind === "inlet") return this.inlet(id);
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
    if (kind === "transect") return this.setTransect(id, data);
    if (kind === "lid") return this.setLid(id, data);
    if (kind === "aquifer") return this.setAquifer(id, data);
    if (kind === "snowpack") return this.setSnowpack(id, data);
    if (kind === "street") return this.setStreet(id, data);
    if (kind === "inlet") return this.setInlet(id, data);
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
    if (kind === "pollutant") {
      if (this.pollutantIds().some((p) => same(p, id))) throw new Error("A pollutant named " + id + " exists.");
      const units = concentrationUnits[type] ?? "MG_PER_L";
      s.pollutants.add(id, ConcentrationUnits[units]);
      return { kind, id };
    }
    if (kind === "landuse") {
      if (this.landuseIds().some((l) => same(l, id))) throw new Error("A land use named " + id + " exists.");
      s.quality.landuses.add(id);
      return { kind, id };
    }
    if (kind === "lid") {
      if (this.lidIds().some((l) => same(l, id))) throw new Error("A LID control named " + id + " exists.");
      if (!lidLayers[type]) throw new Error("Unknown LID type " + type + ".");
      s.infrastructure.lids.add(id, LidType[lidTypeNames[type]]);
      const defaults = lidDefaults(this.unitSystem);
      this.setLid(id, { type, layers: Object.fromEntries(lidLayers[type].map((n) => [n, defaults[n]])), removals: [] });
      return this.lid(id);
    }
    if (kind === "aquifer") {
      if (this.aquiferIds().some((a) => same(a, id))) throw new Error("An aquifer named " + id + " exists.");
      s.aquifers.add(id);
      return this.setAquifer(id, { params: { ...aquiferDefaults }, evapPattern: "" });
    }
    if (kind === "snowpack") {
      if (this.snowpackIds().some((a) => same(a, id))) throw new Error("A snowpack named " + id + " exists.");
      s.snowpacks.add(id);
      return this.setSnowpack(id, snowpackDefaults(this.unitSystem));
    }
    if (kind === "street") {
      if (this.has("street", id)) throw new Error("A street named " + id + " exists.");
      s.infrastructure.streets.add(id);
      return this.setStreet(id, { params: streetDefaults(this.unitSystem) });
    }
    if (kind === "inlet") {
      if (this.has("inlet", id)) throw new Error("An inlet named " + id + " exists.");
      if (!inletTypes.includes(type)) throw new Error("Unknown inlet type " + type + ".");
      s.infrastructure.inlets.add(id, type === "COMBO" ? "GRATE" : type);
      return this.setInlet(id, { type, ...inletDefaults(this.unitSystem), comment: "" });
    }
    if (kind === "transect") {
      if (this.transectIds().some((t) => same(t, id))) throw new Error("A transect named " + id + " exists.");
      // Legacy SWMM refuses a transect with fewer than two points, so a new one starts as a
      // trapezoidal channel 5 deep with n 0.03 (in the model's length units).
      s.infrastructure.transects.add(id);
      this.setTransect(id, {
        roughness: { left: 0.03, right: 0.03, channel: 0.03 },
        banks: { left: 10, right: 30 },
        modifiers: { meander: 1, stationFactor: 1, elevationOffset: 0 },
        points: [[0, 5], [10, 5], [15, 0], [25, 0], [30, 5], [40, 5]],
        comment: "",
      });
      return this.transect(id);
    }
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
    const taken =
      kind === "pattern"
        ? s.patterns.has(next)
        : kind === "hydrograph"
          ? this.groupIndex(next) >= 0
          : kind === "pollutant"
            ? this.pollutantIds().some((p) => same(p, next))
            : kind === "landuse"
              ? this.landuseIds().some((l) => same(l, next))
              : kind === "transect"
                ? this.transectIds().some((t) => same(t, next))
                : kind === "lid"
                  ? this.lidIds().some((l) => same(l, next))
                  : kind === "aquifer"
                    ? this.aquiferIds().some((a) => same(a, next))
                    : kind === "snowpack"
                      ? this.snowpackIds().some((a) => same(a, next))
                      : kind === "street" || kind === "inlet"
                        ? this.has(kind, next)
                        : this.findTable(kind, next) >= 0;
    if (taken && next.toUpperCase() !== id.toUpperCase()) throw new Error(next + " is taken.");
    // Buildup, washoff, coverages, loadings, treatment and inflow rows follow a pollutant or land use.
    if (kind === "pollutant") s.pollutants.rename(this.name("pollutant", id), next);
    else if (kind === "landuse") s.quality.landuses.get(this.name("landuse", id)).rename(next);
    else if (kind === "hydrograph") s.inflows.renameHydrographGroup(this.group(id), next); // RDII rows follow
    else if (kind === "pattern") s.patterns.rename(id, next);
    else if (kind === "lid") s.infrastructure.lids.rename(this.lidIndex(id), next); // [LID_USAGE] rows follow
    else if (kind === "aquifer") s.aquifers.rename(this.named("aquifer", id), next); // [GROUNDWATER] rows follow
    else if (kind === "snowpack") s.snowpacks.rename(this.named("snowpack", id), next); // subcatchments follow
    else if (kind === "street") s.infrastructure.streets.rename(this.named("street", id), next); // street links follow
    else if (kind === "inlet") s.infrastructure.inlets.rename(this.named("inlet", id), next); // [INLET_USAGE] rows follow
    else if (kind === "transect") {
      // The engine renames the transect but its links keep the old name, and the deck no longer
      // opens (engine item 11): a transect in use keeps its name.
      const users = this.impact(kind, id);
      if (users.length) throw new Error("Links " + users.map((u) => u.object.replace(/^link /, "")).join(", ") + " use " + id + "; a transect in use cannot be renamed yet.");
      s.infrastructure.transects.rename(this.transectIndex(id), next);
    } else s.tables.rename(this.table(kind, id), next);
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
          : kind === "pollutant"
            ? s.editor.analyzePollutantImpact(this.name("pollutant", id))
            : kind === "landuse"
              ? s.editor.analyzeLanduseImpact(this.name("landuse", id))
              : kind === "transect"
                ? s.editor.analyzeTransectImpact(this.transectIndex(id))
                : kind === "lid"
                  ? s.editor.analyzeLidImpact(this.lidIds()[this.lidIndex(id)])
                  : kind === "aquifer"
                    ? s.editor.analyzeAquiferImpact(this.named("aquifer", id))
                    : kind === "snowpack"
                      ? s.editor.analyzeSnowpackImpact(this.named("snowpack", id))
                      : kind === "street"
                        ? s.editor.analyzeStreetImpact(this.named("street", id))
                        : kind === "inlet"
                          ? s.editor.analyzeInletImpact(this.named("inlet", id))
                          : s.editor.analyzeTableImpact(this.table(kind, id));
    const named = (list, i) => list.ids?.[i] ?? list.getId?.(i);
    // The engine's pollutant impact leaves out initial loadings, which its delete removes too (engine
    // item 8): listed here from the subcatchments.
    const loadings =
      kind === "pollutant"
        ? s.subcatchments.ids
            .filter((sub) => s.subcatchments.get(sub).loadings.get(this.name("pollutant", id)) !== 0)
            .map((sub) => ({ object: "subcatchment " + sub, field: "initial loading" }))
        : [];
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
        else if (type === "landuse") return { object: "land use " + this.landuseIds()[e.objIdx], field: e.field };
        else if (type === "pollutant") name = this.pollutantIds()[e.objIdx];
        else if (type === "treatment") return { object: "node " + s.nodes.ids[e.objIdx], field: "treatment" };
        else if (type === "lid_usage") return { object: "subcatchment " + s.subcatchments.ids[s.infrastructure.lids.usageRecord(e.objIdx).subcatchIndex], field: "LID usage" };
        else if (type === "inlet_usage") {
          const u = s.infrastructure.inletUsages.get(e.objIdx);
          const host = u.hostKind === 0 ? "link " + s.links.ids[u.hostIdx] : "node " + s.nodes.ids[u.hostIdx];
          return { object: "inlet " + s.infrastructure.inlets.getId(u.designIdx) + " on " + host, field: "inlet usage" };
        }
        else if (type === "ext_inflow") {
          const [n, constituent] = s.inflows.getExternal(e.objIdx);
          return { object: "external " + constituent + " inflow at " + s.nodes.ids[n], field: "constituent" };
        }
        return { object: (type.replaceAll("_", " ") + " " + (name ?? "#" + (e.objIdx + 1))).trim(), field: fieldNames[e.field] ?? e.field.replaceAll("_", " ") };
      })
      .concat(loadings);
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
    else if (kind === "pollutant") this.solver.editor.deletePollutant(this.name("pollutant", id));
    else if (kind === "landuse") this.solver.editor.deleteLanduse(this.name("landuse", id));
    else if (kind === "transect") this.solver.editor.deleteTransect(this.transectIndex(id));
    else if (kind === "lid") this.solver.editor.deleteLid(this.lidIds()[this.lidIndex(id)]);
    else if (kind === "aquifer") this.solver.editor.deleteAquifer(this.named("aquifer", id));
    else if (kind === "snowpack") this.solver.editor.deleteSnowpack(this.named("snowpack", id));
    else if (kind === "street") this.solver.editor.deleteStreet(this.named("street", id));
    else if (kind === "inlet") this.solver.editor.deleteInlet(this.named("inlet", id));
    else this.solver.editor.deleteTable(this.table(kind, id));
    if (kind === "timeseries") this.files.delete(String(id).toUpperCase());
    return { impact, token };
  }
  // ---- Aquifers ([AQUIFERS]) and snowpacks ([SNOWPACKS]): named parameter sets that subcatchments use.
  aquiferIds() {
    return [...this.solver.aquifers];
  }
  snowpackIds() {
    return [...this.solver.snowpacks];
  }
  /** The stored name of an aquifer, snowpack, street or inlet (names match without case). */
  named(kind, id) {
    const list = { aquifer: () => this.aquiferIds(), snowpack: () => this.snowpackIds(), street: () => [...this.solver.infrastructure.streets], inlet: () => [...this.solver.infrastructure.inlets] }[kind]();
    const found = list.find((n) => same(n, id));
    if (found === undefined) throw new Error("No " + kind + " named " + id + ".");
    return found;
  }
  aquifer(id) {
    const a = this.solver.aquifers,
      name = this.named("aquifer", id);
    return { kind: "aquifer", id: name, params: Object.fromEntries(aquiferParams.map((k, i) => [k, a.getParam(name, i)])), evapPattern: a.getEvapPattern(name) };
  }
  /** Problems with an aquifer as legacy SWMM checks it (gwater_validateAquifer); empty when fine. */
  checkAquifer(data) {
    const p = data.params,
      errors = [];
    for (const k of aquiferParams) if (!Number.isFinite(+p[k])) errors.push("Every parameter needs a number.");
    if (errors.length) return errors.slice(0, 1);
    const v = Object.fromEntries(aquiferParams.map((k) => [k, +p[k]]));
    if (v.porosity <= 0) errors.push("Porosity must be above 0.");
    if (v.fieldCapacity >= v.porosity) errors.push("Field capacity must be below porosity.");
    if (v.wiltingPoint >= v.fieldCapacity) errors.push("Wilting point must be below field capacity.");
    if (v.conductivity <= 0) errors.push("Conductivity must be above 0.");
    for (const [k, name] of [["conductSlope", "Conductivity slope"], ["tensionSlope", "Tension slope"], ["upperEvapFrac", "Upper evaporation fraction"], ["lowerEvapDepth", "Lower evaporation depth"]])
      if (v[k] < 0) errors.push(name + " cannot be negative.");
    if (v.waterTableElev < v.bottomElev) errors.push("The water table cannot be below the aquifer bottom.");
    if (v.upperMoisture > v.porosity || v.upperMoisture < v.wiltingPoint) errors.push("Unsaturated zone moisture must lie between the wilting point and porosity.");
    const pattern = data.evapPattern || "";
    if (pattern) {
      const s = this.solver;
      if (!s.patterns.has(pattern)) errors.push("No time pattern named " + pattern + ".");
      else if (PatternType[s.patterns.get(pattern).type] !== "MONTHLY") errors.push("The evaporation pattern must be a monthly pattern.");
    }
    return errors;
  }
  setAquifer(id, data) {
    const errors = this.checkAquifer(data);
    if (errors.length) throw new Error(errors.join(" "));
    const a = this.solver.aquifers,
      name = this.named("aquifer", id);
    aquiferParams.forEach((k, i) => a.setParam(name, i, +data.params[k]));
    a.setEvapPattern(name, data.evapPattern || "");
    return this.aquifer(name);
  }
  snowpack(id) {
    const sp = this.solver.snowpacks,
      name = this.named("snowpack", id);
    return {
      kind: "snowpack",
      id: name,
      plowable: sp.getPlowable(name),
      impervious: sp.getImpervious(name),
      pervious: sp.getPervious(name),
      removal: sp.getRemoval(name),
      removalSubcatch: sp.getRemovalSubcatch(name),
    };
  }
  /** Problems with a snowpack as legacy SWMM checks it (snow_validateSnowmelt); empty when fine. */
  checkSnowpack(data) {
    const errors = [];
    const numbers = [...snowSurfaces.flatMap((k) => snowSurfaceFields.map((f) => data[k]?.[f])), ...snowRemovalFields.map((f) => data.removal?.[f])];
    if (!numbers.every((v) => Number.isFinite(+v))) return ["Every parameter needs a number."];
    for (const k of snowSurfaces) {
      const v = data[k],
        name = k[0].toUpperCase() + k.slice(1);
      if (+v.cmin > +v.cmax) errors.push(name + ": the minimum melt coefficient exceeds the maximum.");
      if (+v.fwfrac < 0 || +v.fwfrac > 1) errors.push(name + ": the free water capacity is a fraction from 0 to 1.");
    }
    if (+data.plowable.last < 0 || +data.plowable.last > 1) errors.push("The plowable fraction of impervious area is a fraction from 0 to 1.");
    const sum = ["fout", "fimp", "fperv", "fimelt", "fsubcatch"].reduce((t, f) => t + +data.removal[f], 0);
    if (sum > 1.01) errors.push("The removal fractions add up to more than 1.");
    const sub = data.removalSubcatch || "";
    if (sub && !this.solver.subcatchments.ids.some((x) => same(x, sub))) errors.push("No subcatchment named " + sub + ".");
    return errors;
  }
  setSnowpack(id, data) {
    const errors = this.checkSnowpack(data);
    if (errors.length) throw new Error(errors.join(" "));
    const sp = this.solver.snowpacks,
      name = this.named("snowpack", id);
    const num = (o, fields) => Object.fromEntries(fields.map((f) => [f, +o[f]]));
    sp.setPlowable(name, num(data.plowable, snowSurfaceFields));
    sp.setImpervious(name, num(data.impervious, snowSurfaceFields));
    sp.setPervious(name, num(data.pervious, snowSurfaceFields));
    sp.setRemoval(name, num(data.removal, snowRemovalFields));
    sp.setRemovalSubcatch(name, data.removalSubcatch || "");
    return this.snowpack(name);
  }
  has(kind, id) {
    try {
      this.named(kind, id);
      return true;
    } catch {
      return false;
    }
  }
  // ---- Events ([EVENTS], SWMM 5.2): the periods a run is limited to, as "YYYY-MM-DD HH:MM" in UTC
  // wall-clock time (SWMM dates are never converted).
  events() {
    const stamp = (d) => d.toISOString().slice(0, 16).replace("T", " ");
    return [...this.solver.events].map((e) => ({ start: stamp(e.start), end: stamp(e.end) }));
  }
  /** Problems with event rows as legacy SWMM reads them (readEvent: the start before the end). */
  checkEvents(rows) {
    const errors = [];
    rows.forEach((r, i) => {
      const a = parseStamp(r.start),
        b = parseStamp(r.end);
      if (!a || !b) errors.push("Event " + (i + 1) + ": dates are YYYY-MM-DD HH:MM.");
      else if (a >= b) errors.push("Event " + (i + 1) + ": the start must come before the end.");
    });
    return errors;
  }
  setEvents(rows) {
    const errors = this.checkEvents(rows);
    if (errors.length) throw new Error(errors.join(" "));
    const ev = this.solver.events;
    ev.clear();
    for (const r of rows) ev.append({ start: parseStamp(r.start), end: parseStamp(r.end) });
    return this.events();
  }
  // ---- Streets ([STREETS]) and inlets ([INLETS]), SWMM 5.2: street cross-sections that STREET links
  // use, and inlet designs that [INLET_USAGE] places on street links.
  street(id) {
    const st = this.solver.infrastructure.streets,
      name = this.named("street", id);
    return { kind: "street", id: name, params: st.getParams(st.getIndex(name)) };
  }
  /** Problems with a street as legacy SWMM reads it (street_readParams); empty when fine. */
  checkStreet(data) {
    const v = data.params,
      errors = [];
    if (!["tCrown", "hCurb", "sx", "nRoad", "gutterDepres", "gutterWidth", "sides", "backWidth", "backSlope", "backN"].every((k) => Number.isFinite(+v[k]))) return ["Every parameter needs a number."];
    for (const [k, name] of [["tCrown", "The distance to the crown"], ["hCurb", "The curb height"], ["sx", "The cross slope"], ["nRoad", "The road's Manning n"]]) if (!(+v[k] > 0)) errors.push(name + " must be above 0.");
    if (+v.gutterDepres < 0 || +v.gutterWidth < 0) errors.push("The gutter depression and width cannot be negative.");
    if (![1, 2].includes(+v.sides)) errors.push("A street has 1 or 2 sides.");
    if (+v.backWidth < 0) errors.push("The backing width cannot be negative.");
    if (+v.backWidth > 0 && !(+v.backSlope > 0 && +v.backN > 0)) errors.push("A backing needs a slope and a Manning n above 0.");
    return errors;
  }
  setStreet(id, data) {
    const errors = this.checkStreet(data);
    if (errors.length) throw new Error(errors.join(" "));
    const st = this.solver.infrastructure.streets,
      name = this.named("street", id);
    st.setParams(st.getIndex(name), Object.fromEntries(Object.entries(data.params).map(([k, v]) => [k, k === "sides" ? Math.round(+v) : +v])));
    return this.street(name);
  }
  inlet(id) {
    const inl = this.solver.infrastructure.inlets,
      name = this.named("inlet", id),
      d = inl.getDesign(name);
    return {
      kind: "inlet",
      id: name,
      type: InletType[d.type],
      grate: { length: d.grateLength, width: d.grateWidth, grateType: GrateType[d.grateType], openArea: d.openArea, splashVeloc: d.splashVeloc },
      // A part the type does not use reads back as the engine leaves it; its throat shows the usual one.
      curb: { length: d.curbLength, height: d.curbHeight, throat: inletParts[InletType[d.type]]?.includes("curb") ? ThroatType[d.throat] : "HORIZONTAL" },
      slot: { length: d.slotLength, width: d.slotWidth },
      curve: d.curveId || "",
      comment: inl.getComment(name),
    };
  }
  /** The engine's design for inlet data (only the parts its type uses). */
  inletDesign(data) {
    const parts = inletParts[data.type] || [],
      g = data.grate || {},
      c = data.curb || {},
      sl = data.slot || {};
    const on = (part) => parts.includes(part);
    return {
      type: InletType[data.type],
      grateLength: on("grate") ? +g.length : 0,
      grateWidth: on("grate") ? +g.width : 0,
      grateType: on("grate") ? GrateType[g.grateType] ?? 0 : 0,
      openArea: on("grate") && g.grateType === "GENERIC" ? +g.openArea : 0,
      splashVeloc: on("grate") && g.grateType === "GENERIC" ? +g.splashVeloc : 0,
      curbLength: on("curb") ? +c.length : 0,
      curbHeight: on("curb") ? +c.height : 0,
      throat: on("curb") ? ThroatType[c.throat] ?? 0 : 0,
      slotLength: on("slot") ? +sl.length : 0,
      slotWidth: on("slot") ? +sl.width : 0,
      curveId: on("curve") ? String(data.curve || "") : "",
    };
  }
  /** Problems with an inlet design as legacy SWMM reads it, then as the engine validates it. */
  checkInlet(data) {
    if (!inletTypes.includes(data.type)) return ["Unknown inlet type " + data.type + "."];
    const parts = inletParts[data.type],
      errors = [];
    const positive = (v, name) => !(+v > 0) && errors.push(name + " must be above 0.");
    if (parts.includes("grate")) {
      positive(data.grate.length, "The grate length");
      positive(data.grate.width, "The grate width");
      if (!grateTypes.includes(data.grate.grateType)) errors.push("Unknown grate type " + data.grate.grateType + ".");
      if (data.grate.grateType === "GENERIC") {
        positive(data.grate.openArea, "A generic grate's open area");
        positive(data.grate.splashVeloc, "A generic grate's splash-over velocity");
      }
    }
    if (parts.includes("curb")) {
      positive(data.curb.length, "The curb opening length");
      positive(data.curb.height, "The curb opening height");
    }
    if (parts.includes("slot")) {
      positive(data.slot.length, "The slot length");
      positive(data.slot.width, "The slot width");
    }
    if (parts.includes("curve") && !(data.curve && this.findTable("curve", data.curve) >= 0)) errors.push("A custom inlet names a diversion or rating curve.");
    if (errors.length) return errors;
    try {
      this.solver.infrastructure.inlets.validateDesign(this.inletDesign(data));
    } catch (e) {
      return [e.message || String(e)];
    }
    return [];
  }
  setInlet(id, data) {
    const errors = this.checkInlet(data);
    if (errors.length) throw new Error(errors.join(" "));
    const inl = this.solver.infrastructure.inlets,
      name = this.named("inlet", id);
    inl.setDesign(name, this.inletDesign(data));
    inl.setComment(name, data.comment || "");
    return this.inlet(name);
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
  // ---- Water quality: pollutants and land uses are objects with catalog properties (fields); a land
  // use holds a buildup and a washoff per pollutant ([BUILDUP], [WASHOFF]); a subcatchment its
  // land-use coverage and initial loadings ([COVERAGES], [LOADINGS]); a node a treatment expression
  // per pollutant ([TREATMENT]).
  pollutantIds() {
    const p = this.solver.pollutants;
    return range(p.length).map((i) => p.getId(i));
  }
  landuseIds() {
    const l = this.solver.quality.landuses;
    return range(l.length).map((i) => l.getId(i));
  }
  /** An object's name as the model spells it (names match without case); throws when there is none. */
  name(kind, id) {
    const s = this.solver;
    const list =
      kind === "pollutant" ? this.pollutantIds() : kind === "landuse" ? this.landuseIds() : kind === "node" ? s.nodes.ids : s.subcatchments.ids;
    const found = list.find((x) => same(x, id));
    if (found === undefined) throw new Error("No " + (kind === "landuse" ? "land use" : kind) + " named " + id + ".");
    return found;
  }
  /** A pollutant's co-pollutant: its name ("" for none) and the fraction of its runoff concentration. */
  coPollutant(id) {
    const co = this.solver.pollutants.get(this.name("pollutant", id)).coPollutant;
    return { co: co ? co[0].id : "", fraction: co ? co[1] : 0 };
  }
  setCoPollutant(id, data) {
    const p = this.solver.pollutants.get(this.name("pollutant", id));
    if (!data.co) p.setCoPollutant(-1, 0);
    else {
      const co = this.name("pollutant", data.co);
      if (same(co, p.id)) throw new Error("A pollutant cannot be its own co-pollutant.");
      const fraction = Number(data.fraction);
      if (!(Number.isFinite(fraction) && fraction >= 0)) throw new Error("The co-pollutant fraction is a number, zero or more.");
      p.setCoPollutant(co, fraction);
    }
    return this.coPollutant(id);
  }
  /**
   * A land use's buildup and washoff for every pollutant. Buildup: function (NONE, POW, EXP, SAT,
   * EXT), c1–c3, `per` (AREA or CURB) and, for EXT, the time series the engine keeps as c3. Washoff:
   * function (NONE, EXP, RC, EMC), coefficient, exponent and the cleaning and BMP removal (%).
   */
  landuse(id) {
    const s = this.solver,
      q = s.quality,
      name = this.name("landuse", id);
    return {
      kind: "landuse",
      id: name,
      rows: this.pollutantIds().map((pollutant) => {
        const b = q.getBuildup(name, pollutant),
          w = q.getWashoff(name, pollutant);
        const ext = buildupFuncs[b.func] === "EXT";
        return {
          pollutant,
          buildup: { func: buildupFuncs[b.func], c1: b.c1, c2: b.c2, c3: ext ? 0 : b.c3, series: ext ? s.tables.getId(b.c3) : "", per: normalizers[b.normalizer] ?? "AREA" },
          washoff: { func: washoffFuncs[w.func], coeff: w.coeff, expon: w.expon, cleaning: w.sweep_effic, bmp: w.bmp_effic },
        };
      }),
    };
  }
  /** Land use rows as the engine will hold them, or an error naming the first bad value. */
  checkLanduse(data) {
    const seen = new Set();
    const number = (v, what, max = Infinity) => {
      const n = Number(v);
      if (!(Number.isFinite(n) && n >= 0 && n <= max)) throw new Error(what + (max === 100 ? " is a percentage, 0 to 100." : " is a number, zero or more."));
      return n;
    };
    return data.rows.map((row) => {
      const pollutant = this.name("pollutant", row.pollutant);
      if (seen.has(pollutant)) throw new Error("One row per pollutant: " + pollutant + " appears twice.");
      seen.add(pollutant);
      const b = row.buildup,
        w = row.washoff;
      if (!buildupFuncs.includes(b.func)) throw new Error("Unknown buildup function " + b.func + ".");
      if (!washoffFuncs.includes(w.func)) throw new Error("Unknown washoff function " + w.func + ".");
      if (!normalizers.includes(b.per)) throw new Error("Buildup is per AREA or per CURB length, not " + b.per + ".");
      let buildup = { func: "NONE", c1: 0, c2: 0, c3: 0, series: "", per: "AREA" };
      if (b.func !== "NONE") {
        const what = pollutant + " buildup ";
        buildup = { func: b.func, c1: number(b.c1, what + "maximum"), c2: number(b.c2, what + "C2"), c3: 0, series: "", per: b.per };
        if (b.func === "EXT") {
          const i = this.findTable("timeseries", b.series);
          if (i < 0) throw new Error("No time series named " + (b.series || "(none)") + " for the external " + pollutant + " buildup.");
          buildup.series = this.solver.tables.getId(i);
        } else buildup.c3 = number(b.c3, what + "C3");
      }
      let washoff = { func: "NONE", coeff: 0, expon: 0, cleaning: 0, bmp: 0 };
      if (w.func !== "NONE") {
        const what = pollutant + " washoff ";
        washoff = {
          func: w.func,
          coeff: number(w.coeff, what + "coefficient"),
          expon: number(w.expon, what + "exponent"),
          cleaning: number(w.cleaning, what + "cleaning efficiency", 100),
          bmp: number(w.bmp, what + "BMP efficiency", 100),
        };
      }
      return { pollutant, buildup, washoff };
    });
  }
  /** Set the changed buildup and washoff rows of a land use; returns the land use as stored. */
  setLanduse(id, data) {
    const s = this.solver,
      q = s.quality,
      name = this.name("landuse", id);
    const rows = this.checkLanduse(data);
    const current = this.landuse(name).rows;
    for (const row of rows) {
      const was = current.find((r) => r.pollutant === row.pollutant);
      const b = row.buildup,
        w = row.washoff;
      if (JSON.stringify(was.buildup) !== JSON.stringify(b))
        q.setBuildup(name, row.pollutant, {
          func: buildupFuncs.indexOf(b.func),
          c1: b.c1,
          c2: b.c2,
          c3: b.func === "EXT" ? this.findTable("timeseries", b.series) : b.c3, // EXT: the series' table index
          normalizer: normalizers.indexOf(b.per),
        });
      if (JSON.stringify(was.washoff) !== JSON.stringify(w))
        q.setWashoff(name, row.pollutant, { func: washoffFuncs.indexOf(w.func), coeff: w.coeff, expon: w.expon, sweep_effic: w.cleaning, bmp_effic: w.bmp });
    }
    return this.landuse(name);
  }
  /** A subcatchment's land-use coverage (% of its area, every land use) and initial loadings. */
  subQuality(id) {
    const name = this.name("subcatchment", id),
      sub = this.solver.subcatchments.get(name);
    const cover = sub.coverages();
    return {
      kind: "subquality",
      id: name,
      coverages: this.landuseIds().map((landuse, i) => ({ landuse, percent: cover[i] })),
      loadings: this.pollutantIds().map((pollutant) => ({ pollutant, value: sub.loadings.get(pollutant) })),
    };
  }
  /** Set changed coverages and loadings; coverage is 0–100 % per land use and at most 100 % in all. */
  setSubQuality(id, data) {
    const name = this.name("subcatchment", id),
      sub = this.solver.subcatchments.get(name);
    const coverages = data.coverages.map((c) => {
      const percent = Number(c.percent);
      if (!(Number.isFinite(percent) && percent >= 0 && percent <= 100)) throw new Error("Coverage of " + c.landuse + " is a percentage, 0 to 100.");
      return { landuse: this.name("landuse", c.landuse), percent };
    });
    const total = coverages.reduce((sum, c) => sum + c.percent, 0);
    // The engine accepts more than 100 % and runs with it (engine item 9); the deck would be wrong.
    if (total > 100 + 1e-9) throw new Error("The land uses of " + name + " cover " + +total.toFixed(6) + " % of it; at most 100 %.");
    const loadings = data.loadings.map((l) => {
      const value = Number(l.value);
      if (!(Number.isFinite(value) && value >= 0)) throw new Error("The initial loading of " + l.pollutant + " is a number, zero or more.");
      return { pollutant: this.name("pollutant", l.pollutant), value };
    });
    const current = this.subQuality(name);
    for (const c of coverages)
      if (current.coverages.find((x) => x.landuse === c.landuse).percent !== c.percent) sub.coverage.set(c.landuse, c.percent);
    for (const l of loadings)
      if (current.loadings.find((x) => x.pollutant === l.pollutant).value !== l.value) sub.loadings.set(l.pollutant, l.value);
    return this.subQuality(name);
  }
  /** A node's treatment expression for every pollutant ("" for none). */
  treatment(node) {
    const name = this.name("node", node);
    return { node: name, rows: this.pollutantIds().map((pollutant) => ({ pollutant, expression: this.solver.quality.getTreatment(name, pollutant) })) };
  }
  /**
   * Check a treatment expression; "" when it is fine. The engine checks the grammar, but its checker
   * has no model and refuses the pollutant references its runtime parser reads (a pollutant's name
   * for its concentration, R_name / C_name; engine item 7). Those are checked here against the
   * model's pollutants and stand in as C (padded, so the engine's column stays right).
   */
  checkTreatment(expression) {
    const text = String(expression ?? "").trim();
    if (!text) return "";
    const ids = this.pollutantIds();
    let unknown = null;
    const masked = text.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (word) => {
      if (treatmentWords.test(word)) return word;
      const ref = /^[RC]_(.+)$/i.exec(word)?.[1];
      if (ids.some((p) => same(p, word)) || (ref && ids.some((p) => same(p, ref)))) return "C".padEnd(word.length);
      if (ref) unknown ??= "No pollutant named " + ref + " (in " + word + ").";
      return word;
    });
    if (unknown) return unknown;
    const [ok, message, column] = this.solver.quality.validateTreatmentExpression(masked);
    if (ok) return "";
    return message.replace(/\(variables: ([^;]*);/, "(variables: $1, a pollutant name, R_name or C_name;") + (column >= 0 ? " (at character " + (column + 1) + ")" : "");
  }
  checkTreatments(rows) {
    return rows.map((r) => ({ pollutant: r.pollutant, message: this.checkTreatment(r.expression) }));
  }
  /** Set a node's changed treatment expressions (an empty one removes the row); returns them. */
  setTreatment(node, data) {
    const q = this.solver.quality,
      name = this.name("node", node);
    const rows = data.rows.map((r) => {
      const pollutant = this.name("pollutant", r.pollutant);
      const expression = String(r.expression ?? "").trim().replace(/\s+/g, " ");
      const message = this.checkTreatment(expression);
      if (message) throw new Error(pollutant + ": " + message);
      return { pollutant, expression };
    });
    const current = this.treatment(name).rows;
    for (const r of rows) {
      if (current.find((c) => c.pollutant === r.pollutant).expression === r.expression) continue;
      if (r.expression) q.setTreatment(name, r.pollutant, r.expression);
      else q.clearTreatment(name, r.pollutant);
    }
    return this.treatment(name);
  }
  // ---- Transects ([TRANSECTS]): irregular natural-channel cross-sections that IRREGULAR links use.
  transectIds() {
    const t = this.solver.infrastructure.transects;
    return range(t.length).map((i) => t.getId(i));
  }
  transectIndex(id) {
    const i = this.transectIds().findIndex((t) => same(t, id));
    if (i < 0) throw new Error("No transect named " + id + ".");
    return i;
  }
  /**
   * A transect as plain data: Manning's n of the left and right overbanks and the main channel, the
   * bank stations, the modifiers (meander factor, station factor, elevation offset; a factor of 0
   * means 1) and its station / elevation points as authored.
   */
  transect(id) {
    const t = this.solver.infrastructure.transects,
      i = this.transectIndex(id);
    const [left, right, channel] = t.getRoughness(i);
    const [bankLeft, bankRight] = t.getBankStations(i);
    const [stationFactor, elevationOffset, meander] = t.getModifiers(i); // engine item 15: this order
    return {
      kind: "transect",
      id: t.getId(i),
      roughness: { left, right, channel },
      banks: { left: bankLeft, right: bankRight },
      modifiers: { meander, stationFactor, elevationOffset },
      points: t.stations(i),
      comment: t.getComments(i),
    };
  }
  /**
   * Transect data as the engine will hold it, or an error naming the first bad value. Checked as
   * legacy SWMM's transect_validate (the engine stores what legacy refuses; engine item 13).
   */
  checkTransect(data) {
    const number = (v, what, ok = () => true, rule = "enter a number.") => {
      const x = Number(v);
      if (String(v).trim() === "" || !Number.isFinite(x) || !ok(x)) throw new Error(what + ": " + rule);
      return x;
    };
    // In an NC row a 0 keeps the previous transect's value, so a 0 written here would change meaning
    // when the deck is read again: every n is greater than zero.
    const positive = (x) => x > 0;
    const roughness = {
      left: number(data.roughness.left, "Left overbank n", positive, "a number greater than zero."),
      right: number(data.roughness.right, "Right overbank n", positive, "a number greater than zero."),
      channel: number(data.roughness.channel, "Channel n", positive, "a number greater than zero."),
    };
    const points = data.points.map(([x, y], i) => [number(x, "Point " + (i + 1) + " station"), number(y, "Point " + (i + 1) + " elevation")]);
    if (points.length < 2) throw new Error("A transect needs at least two points.");
    if (points.length >= 1500) throw new Error("A transect has fewer than 1500 points.");
    for (let i = 1; i < points.length; i++)
      if (points[i][0] < points[i - 1][0]) throw new Error("Point " + (i + 1) + ": stations run from left to right (each at least the one before).");
    const ys = points.map((p) => p[1]);
    if (Math.min(...ys) >= Math.max(...ys)) throw new Error("The points have no depth: the elevations are all the same.");
    const banks = { left: number(data.banks.left, "Left bank station"), right: number(data.banks.right, "Right bank station") };
    if (banks.left > banks.right) throw new Error("The left bank station is right of the right bank station.");
    // A factor of 0 reads as 1 (legacy and the engine's reader), so it is stored as 1.
    const factor = (v, what) => number(v, what, (x) => x >= 0, "a number, zero or more (0 means 1).") || 1;
    const modifiers = {
      meander: factor(data.modifiers.meander, "Meander factor"),
      stationFactor: factor(data.modifiers.stationFactor, "Station factor"),
      elevationOffset: number(data.modifiers.elevationOffset, "Elevation offset"),
    };
    return { kind: "transect", roughness, banks, modifiers, points, comment: String(data.comment ?? "").replace(/\s*\n\s*/g, " ").trim() };
  }
  /** Set a transect's changed values; returns it as the engine holds it. */
  setTransect(id, data) {
    const t = this.solver.infrastructure.transects,
      i = this.transectIndex(id);
    const next = this.checkTransect(data),
      was = this.transect(id);
    const differs = (part) => JSON.stringify(next[part]) !== JSON.stringify(was[part]);
    if (differs("roughness")) t.setRoughness(i, next.roughness.left, next.roughness.right, next.roughness.channel);
    if (differs("points")) {
      t.clearStations(i);
      for (const [x, y] of next.points) t.addStation(i, x, y);
    }
    if (differs("banks")) t.setBankStations(i, next.banks.left, next.banks.right);
    if (differs("modifiers")) t.setModifiers(i, next.modifiers.stationFactor, next.modifiers.elevationOffset, next.modifiers.meander);
    if (differs("comment")) t.setComments(i, next.comment);
    return this.transect(id);
  }
  // ---- LID controls ([LID_CONTROLS]) and their placement on subcatchments ([LID_USAGE]). ----
  lidIds() {
    const l = this.solver.infrastructure.lids;
    return range(l.length).map((i) => l.getId(i));
  }
  lidIndex(id) {
    const i = this.lidIds().findIndex((l) => same(l, id));
    if (i < 0) throw new Error("No LID control named " + id + ".");
    return i;
  }
  /** How many [LID_USAGE] rows place a control. */
  lidUses(i) {
    const l = this.solver.infrastructure.lids;
    return range(l.usageCount()).filter((u) => l.usageRecord(u).lidIndex === i).length;
  }
  /**
   * A LID control as plain data: its type (BC, RG, GR, IT, PP, RB, RD, VS; NODE stacks are not edited
   * here), the layers that type has with their values in project units, the underdrain removal (%)
   * per pollutant and how many placements use it.
   */
  lid(id) {
    const l = this.solver.infrastructure.lids,
      i = this.lidIndex(id);
    const type = lidTypes[l.getType(i)] ?? "NODE";
    const x = (f) => l.getExtra(i, LidExtraField[f]);
    const read = {
      surface: () => ({ ...l.getSurface(i), vegetation: x("SURFACE_VEGETATION"), sideSlope: x("SURFACE_SIDE_SLOPE") }),
      soil: () => ({ ...l.getSoil(i), suction: x("SOIL_SUCTION") }),
      pavement: () => l.getPavement(i),
      storage: () => ({ ...l.getStorage(i), clogging: x("STORAGE_CLOGGING"), ...(type === "RB" ? { covered: x("STORAGE_COVERED") !== 0 } : {}) }),
      drain: () => ({ ...l.getDrain(i), delay: x("DRAIN_DELAY"), open: x("DRAIN_OPEN"), close: x("DRAIN_CLOSE"), curve: l.getDrainCurve(i) }),
      drainmat: () => l.getDrainmat(i),
    };
    const layers = Object.fromEntries((lidLayers[type] || []).map((name) => [name, read[name]()]));
    const removals = lidLayers[type]?.includes("drain") ? this.pollutantIds().map((pollutant, p) => ({ pollutant, percent: l.getRemoval(i, p) })) : [];
    return { kind: "lid", id: l.getId(i), type, layers, removals, uses: this.lidUses(i) };
  }
  /**
   * LID control data as the engine will hold it, or an error naming the first bad value. Checked as
   * legacy SWMM's validateLidProc (required layers, soil moisture order, void ratios, drain heads,
   * swale surface).
   */
  checkLid(data, uses = 0, was = null) {
    const type = data.type;
    if (!lidLayers[type]) throw new Error("Unknown LID type " + type + ".");
    if (was && type !== was.type && uses) throw new Error("A LID control in use keeps its type.");
    const layerNames = { surface: "Surface", soil: "Soil", pavement: "Pavement", storage: "Storage", drain: "Drain", drainmat: "Drainage mat" };
    const v = {};
    for (const name of lidLayers[type]) {
      const given = data.layers[name] || lidDefaults(this.unitSystem)[name];
      v[name] = {};
      for (const [key, value] of Object.entries(given)) {
        if (key === "curve") v[name].curve = String(value ?? "");
        else if (key === "covered") v[name].covered = !!value;
        else {
          const n = Number(value);
          if (String(value).trim() === "" || !Number.isFinite(n) || n < 0) throw new Error(layerNames[name] + ": " + lidFieldNames[name][key] + " is a number, zero or more.");
          v[name][key] = n;
        }
      }
    }
    const fail = (name, rule) => {
      throw new Error(layerNames[name] + ": " + rule);
    };
    const s = v.surface;
    if (s && s.vegetation >= 1) fail("surface", "the vegetation volume fraction is less than 1.");
    if (type === "VS" && !(s.roughness * s.slope > 0 && s.storage > 0)) fail("surface", "a swale needs a berm height, a roughness and a slope above zero.");
    if ((type === "BC" || type === "RG" || type === "GR") && !(v.soil.thick > 0)) fail("soil", "this LID type needs a soil layer thickness above zero.");
    if (type === "GR" && !(v.drainmat.thick > 0)) fail("drainmat", "a green roof needs a drainage mat thickness above zero.");
    if (type === "IT" && !(v.storage.thick > 0)) fail("storage", "an infiltration trench needs a storage thickness above zero.");
    const p = v.pavement;
    if (p && !(p.thick > 0 && p.ksat > 0 && p.voidRatio > 0)) fail("pavement", "the thickness, void ratio and permeability are above zero.");
    if (p && p.fracImperv > 1) fail("pavement", "the impervious surface fraction is at most 1.");
    if (p && p.regenDegree > 1) fail("pavement", "the regeneration fraction is at most 1.");
    const o = v.soil;
    if (o && o.thick > 0 && !(o.porosity > 0 && o.fc < o.porosity && o.wp < o.fc && o.ksat > 0))
      fail("soil", "porosity above field capacity above wilting point, and a conductivity above zero.");
    if (v.storage && v.storage.thick > 0 && !(v.storage.voidFrac > 0)) fail("storage", "the void ratio is above zero.");
    if (v.drain && v.drain.open > 0 && v.drain.open <= v.drain.close) fail("drain", "the open level is above the closed level.");
    const removals = (lidLayers[type].includes("drain") ? data.removals || [] : []).map((r) => {
      const percent = Number(r.percent);
      if (!(Number.isFinite(percent) && percent >= 0 && percent <= 100)) throw new Error("Removal of " + r.pollutant + " is a percentage, 0 to 100.");
      return { pollutant: this.name("pollutant", r.pollutant), percent };
    });
    return { kind: "lid", type, layers: v, removals };
  }
  /** Set a LID control's changed type, layers and removals; returns it as the engine holds it. */
  setLid(id, data) {
    const l = this.solver.infrastructure.lids,
      i = this.lidIndex(id),
      was = this.lid(id);
    if (was.type === "NODE") throw new Error("Node LID stacks are edited in Edit INP.");
    const next = this.checkLid(data, was.uses, was);
    if (next.type !== was.type) {
      l.validateType(i, LidType[lidTypeNames[next.type]]);
      l.setType(i, LidType[lidTypeNames[next.type]]);
    }
    const before = next.type === was.type ? was.layers : {};
    const changed = (name) => JSON.stringify(next.layers[name]) !== JSON.stringify(before[name]);
    const extra = (f, value, old) => value !== old && l.setExtra(i, LidExtraField[f], value);
    for (const name of lidLayers[next.type]) {
      if (!changed(name)) continue;
      const v = next.layers[name],
        o = before[name] || {};
      if (name === "surface") {
        l.setSurface(i, { storage: v.storage, roughness: v.roughness, slope: v.slope });
        extra("SURFACE_VEGETATION", v.vegetation, o.vegetation);
        extra("SURFACE_SIDE_SLOPE", v.sideSlope, o.sideSlope);
      } else if (name === "soil") {
        l.setSoil(i, v);
        extra("SOIL_SUCTION", v.suction, o.suction);
      } else if (name === "pavement") l.setPavement(i, v);
      else if (name === "storage") {
        l.setStorage(i, { thick: v.thick, voidFrac: v.voidFrac, ksat: v.ksat });
        extra("STORAGE_CLOGGING", v.clogging, o.clogging);
        if (next.type === "RB") extra("STORAGE_COVERED", v.covered ? 1 : 0, o.covered === undefined ? undefined : o.covered ? 1 : 0);
      } else if (name === "drain") {
        l.setDrain(i, { coeff: v.coeff, expon: v.expon, offset: v.offset });
        extra("DRAIN_DELAY", v.delay, o.delay);
        extra("DRAIN_OPEN", v.open, o.open);
        extra("DRAIN_CLOSE", v.close, o.close);
      } else if (name === "drainmat") l.setDrainmat(i, v);
    }
    const ids = this.pollutantIds();
    for (const r of next.removals) {
      const p = ids.indexOf(r.pollutant);
      if (l.getRemoval(i, p) !== r.percent) l.setRemoval(i, p, r.percent);
    }
    return this.lid(id);
  }
  /**
   * A subcatchment's LID placements: per row the control, number of units, unit area and width,
   * initial saturation (%), impervious and pervious area treated (%), whether outflow returns to the
   * pervious area, the underdrain outlet ("" = the subcatchment's outlet) and the report file (kept).
   */
  lidUsage(sub) {
    const l = this.solver.infrastructure.lids,
      name = this.name("subcatchment", sub),
      si = this.solver.subcatchments.ids.indexOf(name);
    const lids = this.lidIds();
    const rows = range(l.usageCount())
      .map((u) => l.usageRecord(u))
      .filter((r) => r.subcatchIndex === si)
      .map((r) => ({
        lid: lids[r.lidIndex],
        number: r.number,
        area: r.area,
        width: r.width,
        initSat: r.initSat,
        fromImperv: r.fromImperv,
        fromPerv: r.fromPerv,
        toPerv: r.toPerv !== 0,
        drainTo: r.drainTo,
        reportFile: r.reportFile,
      }));
    return { kind: "lidusage", id: name, area: this.solver.subcatchments.get(name).area, rows };
  }
  /** Placement rows as the engine will hold them, checked as legacy lid_readGroupParams and its area totals. */
  checkLidUsage(sub, data) {
    const name = this.name("subcatchment", sub),
      s = this.solver;
    const drains = [...s.subcatchments.ids, ...s.nodes.ids];
    const rows = data.rows.map((r, k) => {
      const at = "Row " + (k + 1) + ": ";
      const lid = this.lidIds().find((id) => same(id, r.lid));
      if (lid === undefined) throw new Error(at + "no LID control named " + r.lid + ".");
      const num = (v, what, max = Infinity) => {
        const x = Number(v);
        if (String(v).trim() === "" || !Number.isFinite(x) || x < 0 || x > max) throw new Error(at + what + (max === 100 ? " is a percentage, 0 to 100." : " is a number, zero or more."));
        return x;
      };
      const number = num(r.number, "the number of units");
      if (!Number.isInteger(number) || number < 1) throw new Error(at + "the number of units is a whole number, 1 or more.");
      let drainTo = String(r.drainTo ?? "").trim();
      if (drainTo) {
        drainTo = drains.find((d) => same(d, drainTo));
        if (drainTo === undefined) throw new Error(at + "no subcatchment or node named " + r.drainTo + ".");
      }
      return {
        lid,
        number,
        area: num(r.area, "the unit area"),
        width: num(r.width, "the surface width"),
        initSat: num(r.initSat, "the initial saturation", 100),
        fromImperv: num(r.fromImperv, "the impervious area treated", 100),
        fromPerv: num(r.fromPerv, "the pervious area treated", 100),
        toPerv: !!r.toPerv,
        drainTo,
        reportFile: String(r.reportFile ?? ""),
      };
    });
    const sqft = this.unitSystem === "SI" ? 10000 : 43560; // m² per ha or ft² per acre
    const total = rows.reduce((t, r) => t + r.number * r.area, 0);
    const area = s.subcatchments.get(name).area * sqft;
    if (total > 1.001 * area) throw new Error("The LID units of " + name + " cover " + +total.toFixed(2) + (this.unitSystem === "SI" ? " m²" : " ft²") + ", more than its area (" + +area.toFixed(2) + ").");
    const imperv = rows.reduce((t, r) => t + r.fromImperv, 0),
      perv = rows.reduce((t, r) => t + r.fromPerv, 0);
    if (imperv > 100.1 || perv > 100.1) throw new Error("The LID units of " + name + " treat more than 100 % of its " + (imperv > 100.1 ? "impervious" : "pervious") + " area.");
    return { kind: "lidusage", id: name, rows };
  }
  /** Replace a subcatchment's placements when they changed; returns them as the engine holds them. */
  setLidUsage(sub, data) {
    const next = this.checkLidUsage(sub, data),
      was = this.lidUsage(sub);
    if (JSON.stringify(next.rows) === JSON.stringify(was.rows)) return was;
    const l = this.solver.infrastructure.lids,
      si = this.solver.subcatchments.ids.indexOf(next.id);
    const records = next.rows.map((r) => ({
      subcatchIndex: si,
      lidIndex: this.lidIndex(r.lid),
      number: r.number,
      area: r.area,
      width: r.width,
      initSat: r.initSat,
      fromImperv: r.fromImperv,
      toPerv: r.toPerv ? 1 : 0,
      fromPerv: r.fromPerv,
      reportFile: r.reportFile,
      reportFileResolved: "",
      drainTo: r.drainTo,
    }));
    for (const r of records) l.validateUsage(r);
    l.replaceUsages(next.id, records);
    return this.lidUsage(sub);
  }
  // ---- Climate (E2 increment 4): [TEMPERATURE], [EVAPORATION] and the monthly [ADJUSTMENTS]. ----
  /** The climate file a FILE temperature source names ([TEMPERATURE] FILE row), or "". */
  climateFile() {
    const text = new TextDecoder().decode(this.engine.FS.readFile(this.entry));
    const row = (sections(text)["[TEMPERATURE]"] || []).find((t) => same(t[0], "FILE"));
    return row?.[1]?.replace(/^"|"$/g, "") ?? "";
  }
  /**
   * The model's climate as plain data: the temperature source, evaporation (constant evaporation is
   * twelve equal monthly values), wind speed, snowmelt, areal depletion (ten fractions per surface)
   * and the monthly adjustments, in project units.
   */
  climate() {
    const c = this.solver.climate,
      list = (v) => Array.from(v);
    const source = tempSources[c.tempSource] ?? "NONE";
    return {
      kind: "climate",
      temperature: { source, series: source === "TIMESERIES" ? c.tempTimeseries : "", file: source === "FILE" ? this.climateFile() : "", start: c.tempFileStart },
      evaporation: {
        type: evapTypes[c.evapType],
        monthly: list(c.evapMonthly),
        series: c.evapType === 2 ? c.evapTimeseries : "",
        pan: list(c.panCoeff),
        recovery: c.evapRecovery,
        dryOnly: this.solver.forcing.getClimateDryOnly(),
      },
      wind: { type: c.windType === 1 ? "FILE" : "MONTHLY", monthly: list(c.windMonthly) },
      snowmelt: { divide: c.snowTemp, ati: c.atiWeight, negMelt: c.negMeltRatio, elevation: c.elevation, latitude: c.latitude, longitude: c.longitudeCorrection },
      adc: { impervious: list(c.adcImpervious), pervious: list(c.adcPervious) },
      adjustments: { temperature: list(c.adjustTemperature), evaporation: list(c.adjustEvaporation), rainfall: list(c.adjustRainfall), conductivity: list(c.adjustConductivity) },
    };
  }
  /**
   * Climate data as the engine will hold it, or an error naming the first bad value. Names and
   * ranges are checked as legacy SWMM reads them (the engine's setters take unknown names; engine
   * item 13). A climate file cannot be chosen here (engine item 14): a FILE source stays as it is.
   */
  checkClimate(data) {
    const numbers = (values, n, what, lo = -Infinity, hi = Infinity) => {
      if (!Array.isArray(values) || values.length !== n) throw new Error(what + ": enter " + n + " values.");
      return values.map((v, i) => {
        const x = Number(v);
        if (String(v).trim() === "" || !Number.isFinite(x)) throw new Error(what + ", value " + (i + 1) + ": enter a number.");
        if (x < lo || x > hi) throw new Error(what + ", value " + (i + 1) + ": a fraction, 0 to 1.");
        return x;
      });
    };
    const number = (v, what, ok = () => true, rule = "enter a number.") => {
      const x = Number(v);
      if (String(v).trim() === "" || !Number.isFinite(x) || !ok(x)) throw new Error(what + ": " + rule);
      return x;
    };
    const series = (name, what) => {
      const i = name ? this.findTable("timeseries", name) : -1;
      if (i < 0) throw new Error(what + ": " + (name ? "no time series named " + name + "." : "choose a time series."));
      return this.solver.tables.getId(i);
    };
    const was = this.climate();
    const t = data.temperature;
    if (!tempSources.includes(t.source)) throw new Error("Unknown temperature source " + t.source + ".");
    if ((t.source === "FILE") !== (was.temperature.source === "FILE"))
      throw new Error("A climate file is kept as the model names it; change it in Edit INP.");
    const temperature = { ...was.temperature, source: t.source, series: t.source === "TIMESERIES" ? series(t.series, "Air temperature") : "" };
    const hasFile = temperature.source === "FILE";
    const e = data.evaporation;
    if (!evapTypes.includes(e.type)) throw new Error("Unknown evaporation source " + e.type + ".");
    if ((e.type === "FILE" || e.type === "TEMPERATURE") && !hasFile)
      throw new Error("Evaporation " + (e.type === "FILE" ? "from the climate file" : "from temperatures") + " needs a climate file as the temperature source.");
    let recovery = "";
    if (e.recovery) {
      const p = this.solver.patterns;
      recovery = range(p.length).map((i) => p.get(i).id).find((id) => same(id, e.recovery));
      if (recovery === undefined) throw new Error("Evaporation recovery: no time pattern named " + e.recovery + ".");
    }
    const evaporation = {
      type: e.type,
      monthly: e.type === "CONSTANT" ? Array(12).fill(number(e.monthly[0], "Constant evaporation")) : numbers(e.monthly, 12, "Monthly evaporation"),
      series: e.type === "TIMESERIES" ? series(e.series, "Evaporation") : "",
      pan: numbers(e.pan, 12, "Pan coefficients"),
      recovery,
      dryOnly: !!e.dryOnly,
    };
    const w = data.wind;
    if (w.type !== "MONTHLY" && w.type !== "FILE") throw new Error("Unknown wind speed source " + w.type + ".");
    if (w.type === "FILE" && !hasFile) throw new Error("Wind speed from the climate file needs a climate file as the temperature source.");
    const wind = { type: w.type, monthly: numbers(w.monthly, 12, "Monthly wind speed") };
    const m = data.snowmelt;
    const fraction = (x) => x >= 0 && x <= 1;
    const snowmelt = {
      divide: number(m.divide, "Dividing temperature"),
      ati: number(m.ati, "ATI weight", fraction, "a fraction, 0 to 1."),
      negMelt: number(m.negMelt, "Negative melt ratio", fraction, "a fraction, 0 to 1."),
      elevation: number(m.elevation, "Elevation"),
      latitude: number(m.latitude, "Latitude", (x) => x > -89.99 && x < 89.99, "degrees, between -90 and 90."),
      longitude: number(m.longitude, "Longitude correction"),
    };
    const adc = {
      impervious: numbers(data.adc.impervious, 10, "Areal depletion (impervious)", 0, 1),
      pervious: numbers(data.adc.pervious, 10, "Areal depletion (pervious)", 0, 1),
    };
    const a = data.adjustments;
    const adjustments = {
      temperature: numbers(a.temperature, 12, "Temperature adjustments"),
      evaporation: numbers(a.evaporation, 12, "Evaporation adjustments"),
      rainfall: numbers(a.rainfall, 12, "Rainfall multipliers"),
      conductivity: numbers(a.conductivity, 12, "Conductivity multipliers").map((x) => (x <= 0 ? 1 : x)), // as legacy reads it
    };
    return { kind: "climate", temperature, evaporation, wind, snowmelt, adc, adjustments };
  }
  /** Set the parts of the climate that changed; returns the climate the engine now holds. */
  setClimate(data) {
    const next = this.checkClimate(data),
      was = this.climate(),
      c = this.solver.climate;
    const changed = (part) => JSON.stringify(next[part]) !== JSON.stringify(was[part]);
    if (changed("temperature")) {
      if (next.temperature.source === "NONE") c.tempSource = 0;
      else if (next.temperature.source === "TIMESERIES") c.tempTimeseries = next.temperature.series; // selects TIMESERIES
    }
    if (changed("evaporation")) {
      const e = next.evaporation,
        w = was.evaporation;
      if (e.type === "TIMESERIES") c.evapTimeseries = e.series; // selects TIMESERIES
      else if (e.type !== w.type) c.evapType = evapTypes.indexOf(e.type);
      if ((e.type === "CONSTANT" || e.type === "MONTHLY") && JSON.stringify(e.monthly) !== JSON.stringify(w.monthly)) c.evapMonthly = e.monthly;
      if (JSON.stringify(e.pan) !== JSON.stringify(w.pan)) c.panCoeff = e.pan;
      if (e.recovery !== w.recovery) c.evapRecovery = e.recovery;
      if (e.dryOnly !== w.dryOnly) this.solver.forcing.climateDryOnly(e.dryOnly);
    }
    if (changed("wind")) {
      if (next.wind.type !== was.wind.type) c.windType = next.wind.type === "FILE" ? 1 : 0;
      if (next.wind.type === "MONTHLY" && JSON.stringify(next.wind.monthly) !== JSON.stringify(was.wind.monthly)) c.windMonthly = next.wind.monthly;
    }
    if (changed("snowmelt")) {
      const m = next.snowmelt;
      Object.assign(c, { snowTemp: m.divide, atiWeight: m.ati, negMeltRatio: m.negMelt, elevation: m.elevation, latitude: m.latitude, longitudeCorrection: m.longitude });
    }
    if (changed("adc")) {
      c.adcImpervious = next.adc.impervious;
      c.adcPervious = next.adc.pervious;
    }
    if (changed("adjustments")) {
      const a = next.adjustments;
      Object.assign(c, { adjustTemperature: a.temperature, adjustEvaporation: a.evaporation, adjustRainfall: a.rainfall, adjustConductivity: a.conductivity });
    }
    return this.climate();
  }
  // ---- Map editing (V6): objects placed, traced, inserted and deleted on the map, as the desktop's
  // map tools do (names, creation defaults, refusals). Each returns what its undo needs.
  /** The first free name `<prefix><n>` among the nodes, links or gages. */
  nextName(prefix, kind) {
    const list = this.solver[collections[kind]];
    for (let n = 1; ; n++) if (!list.has(prefix + n)) return prefix + n;
  }
  /** The name of a conduit's second piece after a split: `<link>_B`, then `<link>_B1`, … */
  splitName(link) {
    const links = this.solver.links;
    for (let n = 0; ; n++) if (!links.has(link + "_B" + (n || ""))) return link + "_B" + (n || "");
  }
  /** A new node's type-specific values (the desktop's creation defaults). */
  nodeDefaults(id, type) {
    const d = objectDefaults(this.unitSystem),
      n = this.solver.nodes.get(id);
    if (type === "STORAGE") {
      n.maxDepth = d.storageMaxDepth;
      n.storage.functional = [0, 0, d.storageArea];
    } else if (type === "OUTFALL") n.outfall.type = OutfallType.FREE;
    else if (type === "DIVIDER") n.divider.type = DividerType.OVERFLOW;
  }
  /**
   * Place a junction, outfall, storage unit or divider at (x, y); returns its name. `invert` (the
   * ground under it, when the map knows it) is its invert elevation, as the desktop's terrain
   * assistance sets it; otherwise the engine's 0.
   */
  addNode(type, x, y, invert) {
    const code = NodeType[type];
    if (code === undefined || typeof code !== "number") throw new Error("Unknown node type " + type + ".");
    const id = this.nextName(namePrefixes[type], "node");
    this.solver.nodes.add(id, code);
    this.solver.spatial.setNodeCoord(id, x, y);
    this.nodeDefaults(id, type);
    if (Number.isFinite(invert)) this.solver.nodes.get(id).invertElev = invert;
    return { id };
  }
  /**
   * Insert a node on a conduit at fraction `t` of its length: the conduit ends there and a new one
   * (`<link>_B`) carries on. A virtual junction keeps the two pieces as one conduit. Outfalls end a
   * network, so they are refused (as in the desktop).
   */
  insertNode(type, link, t, virtual = false) {
    const s = this.solver;
    if (type === "OUTFALL") throw new Error("Outfalls end a network, so they cannot be inserted on a conduit.");
    if (s.links.get(link).type !== LinkType.CONDUIT) throw new Error(link + " is not a conduit.");
    const id = this.nextName(virtual ? namePrefixes.VIRTUAL : namePrefixes[type], "node"),
      piece = this.splitName(link);
    s.editor.splitConduit(link, Math.min(0.99, Math.max(0.01, t)), id, piece, virtual);
    if (!virtual && type !== "JUNCTION") {
      s.editor.convertNode(id, NodeType[type]);
      this.nodeDefaults(id, type);
    }
    return { id, link: piece };
  }
  /** Undo an insert: the node goes and its two conduits fuse back into one (the desktop's inverse). */
  removeInserted(id) {
    const s = this.solver;
    if (s.nodes.get(id).type !== NodeType.JUNCTION) s.editor.convertNode(id, NodeType.JUNCTION);
    if (!s.nodes.get(id).isVirtual) s.editor.setNodeVirtual(id, true);
    s.editor.fuseVirtualJunction(id);
  }
  /**
   * Trace a link from one node to another through `vertices` (its bends); `length` is the traced
   * length in the model's units (conduits). Virtual and inlet junctions keep the two conduits they
   * split, so a link cannot end at one (as in the desktop). A divider without a diversion link
   * diverts into the first link drawn out of it (SWMM refuses a divider without one).
   */
  addLink(type, from, to, vertices = [], length = 0) {
    const s = this.solver,
      code = LinkType[type];
    if (code === undefined || typeof code !== "number") throw new Error("Unknown link type " + type + ".");
    if (same(from, to)) throw new Error("A link needs two different nodes.");
    for (const n of [from, to]) {
      const node = s.nodes.get(n);
      if (node.isVirtual) throw new Error(n + " is " + (node.isInlet ? "an inlet" : "a virtual") + " junction: it keeps the two conduits it splits.");
    }
    const id = this.nextName(namePrefixes[type], "link");
    const l = s.links.add(id, code);
    l.setNodes(from, to);
    if (vertices.length) s.spatial.setLinkVertices(id, vertices);
    this.linkDefaults(id, type, length);
    this.divertFrom(from, id);
    return { id };
  }
  /** A divider without a diversion link diverts into `link`, a link drawn or converted out of it. */
  divertFrom(node, link) {
    const s = this.solver,
      n = s.nodes.get(node);
    if (n.type !== NodeType.DIVIDER) return;
    const p = n.divider.params;
    if (p.diversion_link < 0) n.divider.params = { ...p, diversion_link: s.links.get(link).index };
  }
  /** A new link's type-specific values (the desktop's creation defaults); `length` for a conduit. */
  linkDefaults(id, type, length) {
    const d = objectDefaults(this.unitSystem),
      link = this.solver.links.get(id);
    if (type === "CONDUIT") {
      link.xsect = [XSectShape.CIRCULAR, d.conduitDiameter, 0, 0, 0];
      link.roughness = d.conduitRoughness;
      link.length = length > 0 ? length : d.conduitLength;
    } else if (type === "PUMP") link.pump.initState = true;
    else if (type === "ORIFICE") {
      link.orifice.type = OrificeType.SIDE;
      link.xsect = [XSectShape.CIRCULAR, d.orificeDiameter, 0, 0, 0];
      new WeirView(link).dischargeCoeff = d.orificeCd; // one discharge coefficient setter serves every regulator
    } else if (type === "WEIR") {
      link.weir.type = WeirType.TRANSVERSE;
      link.xsect = [XSectShape.RECT_OPEN, d.weirHeight, d.weirLength, 0, 0];
      link.weir.dischargeCoeff = d.weirCd;
    } else if (type === "OUTLET") {
      link.outlet.ratingType = OutletRatingType.FUNCTIONAL_DEPTH;
      new WeirView(link).dischargeCoeff = d.outletCoeff;
      link.outlet.expon = d.outletExponent;
    }
  }
  /** What undo of a conversion puts back besides the type (type-specific values are not kept). */
  typeSnapshot(family, id) {
    const s = this.solver;
    if (family === "node") {
      const n = s.nodes.get(id);
      return { type: NodeType[n.type], invert: n.invertElev, maxDepth: n.maxDepth, storageArea: n.storageArea, tag: n.tag };
    }
    const l = s.links.get(id);
    return { type: LinkType[l.type], length: l.length, roughness: l.roughness, xsect: l.xsect.asTuple(), offsetUp: l.offsetUp, offsetDn: l.offsetDn, tag: l.tag };
  }
  /**
   * Preview (`apply` false) or convert nodes (`family` "node") or links to `target` (a NodeType or
   * LinkType name). One row per object: {id, from, state: "convert" | "same" | "refused", reason,
   * cleared, warnings}. A converted object takes the new type's creation values; applying also returns
   * `undo` for `unconvertObjects`.
   */
  convertObjects(family, ids, target, apply = false) {
    const s = this.solver,
      nodes = family === "node",
      list = nodes ? s.nodes : s.links,
      types = nodes ? NodeType : LinkType;
    const code = types[target];
    if (typeof code !== "number") throw new Error("Unknown " + family + " type " + target + ".");
    const snapshots = ids.map((id) => this.typeSnapshot(family, id));
    const changes = s.editor.convertTypes(nodes, code, ids.map((id) => list.get(id).index), { apply });
    const rows = changes.map((c, i) => ({
      id: ids[i],
      from: types[c.sourceType],
      state: c.status ? "refused" : c.sourceType === code ? "same" : "convert",
      reason: c.status ? (c.status === 609 && !nodes && c.dependencyNode >= 0 ? "Junction " + s.nodes.getId(c.dependencyNode) + " requires two conduits (rule 609)." : conversionRules[c.status] || s.errorMessage(c.status) || "Engine error " + c.status + ".") : "",
      cleared: c.details?.clearedFields || [],
      warnings: c.details?.warnings || [],
    }));
    if (!apply) return { rows };
    for (const r of rows) {
      if (r.state !== "convert") continue;
      if (nodes) this.convertedNodeValues(r.id, target);
      else {
        this.linkDefaults(r.id, target, s.links.get(r.id).length);
        this.divertFrom(s.links.get(r.id).fromNode.id, r.id);
      }
    }
    return { rows, undo: rows.map((r, i) => (r.state === "convert" ? { id: r.id, ...snapshots[i] } : null)).filter(Boolean) };
  }
  /**
   * A converted node keeps its invert and depth; it takes only what its new type needs and lacks: a
   * storage unit's area (and a depth when it has none), an outfall's FREE type, a divider's OVERFLOW
   * type and the first link out of it as its diversion link.
   */
  convertedNodeValues(id, type) {
    const s = this.solver,
      d = objectDefaults(this.unitSystem),
      n = s.nodes.get(id);
    if (type === "STORAGE") {
      if (n.storage.functional.every((v) => !v)) n.storage.functional = [0, 0, d.storageArea];
      if (!(n.maxDepth > 0)) n.maxDepth = d.storageMaxDepth;
    } else if (type === "OUTFALL") n.outfall.type = OutfallType.FREE;
    else if (type === "DIVIDER") {
      n.divider.type = DividerType.OVERFLOW;
      const out = s.links.ids.find((l) => same(s.links.get(l).fromNode.id, id));
      if (out) this.divertFrom(id, out);
    }
  }
  /** Undo a conversion: each object back to its type, with its common values. */
  unconvertObjects(family, rows) {
    const s = this.solver,
      nodes = family === "node";
    for (const r of rows) {
      const list = nodes ? s.nodes : s.links;
      s.editor.convertTypes(nodes, (nodes ? NodeType : LinkType)[r.type], [list.get(r.id).index], { apply: true });
      if (nodes) {
        const n = s.nodes.get(r.id);
        n.invertElev = r.invert;
        n.maxDepth = r.maxDepth;
        if (r.type === "JUNCTION") n.storageArea = r.storageArea;
        n.tag = r.tag;
      } else {
        const l = s.links.get(r.id);
        if (r.type === "CONDUIT") {
          l.length = r.length;
          l.roughness = r.roughness;
        }
        if (r.type !== "PUMP") l.xsect = r.xsect;
        l.offsetUp = r.offsetUp;
        l.offsetDn = r.offsetDn;
        l.tag = r.tag;
      }
    }
  }
  /** Place a rain gage at (x, y); returns its name. Its data source is chosen in its properties. */
  addGage(x, y) {
    const s = this.solver,
      d = objectDefaults(this.unitSystem);
    const id = this.nextName(namePrefixes.GAGE, "gage");
    const g = s.gages.add(id);
    g.rainType = GageRainType.INTENSITY;
    g.rainInterval = d.gageInterval;
    g.snowFactor = d.gageSnowCatch;
    s.spatial.setGageCoord(id, x, y);
    return { id };
  }
  /**
   * Draw a subcatchment: `ring` its outline (model coordinates), `area` its area in acres or hectares
   * from the map (the default when unknown). It takes the desktop's creation values, with the
   * infiltration parameters of the model's INFILTRATION option, rain from the nearest rain gage and
   * runoff to the nearest node (SWMM refuses a deck with a subcatchment that has neither).
   */
  addSubcatchment(ring, area) {
    const s = this.solver,
      d = objectDefaults(this.unitSystem);
    if (ring.length < 3) throw new Error("A subcatchment needs three corners or more.");
    const id = this.nextName(namePrefixes.SUBCATCHMENT, "subcatchment");
    s.subcatchments.add(id);
    const closed = same(ring[0].join(), ring.at(-1).join()) ? ring : [...ring, ring[0]];
    s.spatial.setSubcatchmentPolygon(id, closed);
    const set = (field, v) => s.fields.set("subcatchment." + field, id, v);
    set("area", area > 0 ? area : d.subcatchArea);
    set("width", d.subcatchWidth);
    set("slope", d.subcatchSlope);
    set("imperv_pct", d.subcatchImperv);
    const sub = s.subcatchments.get(id);
    sub.nImperv = d.nImperv;
    sub.nPerv = d.nPerv;
    sub.dsImperv = d.dsImperv;
    sub.dsPerv = d.dsPerv;
    sub.zeroImpervPct = d.zeroImperv;
    // Only the family of the model's INFILTRATION option, as the desktop writes it.
    const option = String(s.options.get("INFILTRATION") || "HORTON").toUpperCase();
    const infil = s.subcatchments.get(id).infiltration;
    if (option.includes("CURVE")) infil.setCurveNumber(...d.curveNumber);
    else if (option.includes("GREEN")) infil.setGreenAmpt(...d.greenAmpt);
    else infil.setHorton(...d.horton);
    if (option.startsWith("MOD")) infil.model = option.includes("GREEN") ? InfilModel.MOD_GREEN_AMPT : InfilModel.MOD_HORTON;
    // The nearest rain gage and node to the outline's center.
    const cx = closed.slice(0, -1).reduce((a, p) => a + p[0], 0) / (closed.length - 1),
      cy = closed.slice(0, -1).reduce((a, p) => a + p[1], 0) / (closed.length - 1);
    const nearest = (ids, at) => {
      let best = null,
        bestD = Infinity;
      for (const i of ids) {
        const [x, y] = at(i),
          dd = Math.hypot(x - cx, y - cy);
        if (Number.isFinite(dd) && dd < bestD) [best, bestD] = [i, dd];
      }
      return best;
    };
    const gage = nearest(s.gages.ids, (g) => s.spatial.gageCoord(g));
    const outlet = nearest(s.nodes.ids, (n) => s.spatial.nodeCoord(n));
    if (gage) sub.gage = gage;
    if (outlet) s.subcatchments.get(id).setOutletNode(outlet);
    return { id, gage, outlet };
  }
  /** A subcatchment's rain gage and outlet: `{gage, outlet: {kind: "node" | "subcatchment", id} | null}`. */
  subcatchLinks(id) {
    const s = this.solver,
      sub = s.subcatchments.get(id);
    const node = sub.outletNodeIndex,
      out = node >= 0 ? null : sub.outlet;
    return {
      id: sub.id,
      gage: sub.gageIndex >= 0 ? s.gages.getId(sub.gageIndex) : "",
      outlet: node >= 0 ? { kind: "node", id: s.nodes.getId(node) } : out ? { kind: "subcatchment", id: out.id } : null,
    };
  }
  /** Set a subcatchment's rain gage and outlet (a node or another subcatchment); returns them. */
  setSubcatchLinks(id, { gage, outlet }) {
    const s = this.solver,
      sub = s.subcatchments.get(id);
    if (gage) {
      if (!s.gages.has(gage)) throw new Error("No rain gage " + gage + ".");
      sub.gage = gage;
    }
    if (outlet?.id) {
      if (outlet.kind === "subcatchment") {
        if (same(outlet.id, id)) throw new Error("A subcatchment cannot drain to itself.");
        s.subcatchments.get(id).setOutletSubcatchment(outlet.id);
      } else s.subcatchments.get(id).setOutletNode(outlet.id);
    }
    return this.subcatchLinks(id);
  }
  /** Conduits ending at a node, with their polylines (for lengths after a move). */
  conduitsAt(node) {
    const s = this.solver;
    return s.links.ids
      .filter((l) => {
        const link = s.links.get(l);
        return link.type === LinkType.CONDUIT && (same(link.fromNode.id, node) || same(link.toNode.id, node));
      })
      .map((l) => ({ id: l, points: this.polyline(l) }));
  }
  polyline(link) {
    const v = this.solver.spatial.linkVertices(link);
    return Array.from({ length: v.shape[0] }, (_, i) => [v.data[2 * i], v.data[2 * i + 1]]);
  }
  /**
   * Move a node or rain gage to (x, y); returns where it was and, for a node, the conduits that end at
   * it with their new polylines (the controller sets their lengths from the map, as the desktop's
   * auto-length does).
   */
  moveObject(kind, id, x, y) {
    const sp = this.solver.spatial;
    if (kind === "gage") {
      const [x0, y0] = sp.gageCoord(id);
      sp.setGageCoord(id, x, y);
      return { x: x0, y: y0, conduits: [] };
    }
    const [x0, y0] = sp.nodeCoord(id);
    sp.setNodeCoord(id, x, y);
    return { x: x0, y: y0, conduits: this.conduitsAt(id) };
  }
  /** Replace a link's interior vertices; returns the ones it had and its new polyline. */
  setVertices(link, vertices) {
    const before = this.polyline(link).slice(1, -1);
    this.solver.spatial.setLinkVertices(link, vertices);
    return { before, points: this.polyline(link), conduit: this.solver.links.get(link).type === LinkType.CONDUIT };
  }
  /** Set conduit lengths `{id: length}`; returns the lengths they had. */
  setLengths(lengths) {
    const before = {};
    for (const [id, length] of Object.entries(lengths)) {
      const link = this.solver.links.get(id);
      before[id] = link.length;
      if (length > 0) link.length = length;
    }
    return before;
  }
  /**
   * What an inlet junction on `link` can use: whether the link is a STREET conduit, the inlet designs,
   * and the nodes that can capture its flow (not the conduit's own ends, not virtual or inlet
   * junctions — engine rule 627), nearest to (x, y) first.
   */
  inletChoices(link, x, y) {
    const s = this.solver,
      l = s.links.get(link);
    const ends = [l.fromNode.id, l.toNode.id].map((id) => id.toUpperCase());
    const captures = s.nodes.ids
      .filter((id) => !ends.includes(id.toUpperCase()) && !s.nodes.get(id).isVirtual)
      .map((id) => {
        const [nx, ny] = s.spatial.nodeCoord(id);
        return { id, d: Math.hypot(nx - x, ny - y) };
      })
      .sort((a, b) => a.d - b.d)
      .map((c) => c.id);
    return { street: l.type === LinkType.CONDUIT && l.xsect.shape === XSectShape.STREET_XSECT, designs: [...s.infrastructure.inlets], captures };
  }
  /**
   * Insert an inlet junction on a street conduit at fraction `t`: the conduit splits around it (the
   * second piece `<link>_B`), and the junction's inlet `design` sends what it captures to `capture`
   * (placement AUTOMATIC, ON_GRADE or ON_SAG).
   */
  insertInlet(link, t, design, capture, placement = "AUTOMATIC") {
    const s = this.solver;
    if (!this.inletChoices(link, 0, 0).street) throw new Error("Inlet junctions can only be placed on street conduits.");
    if (InletPlacement[placement] === undefined) throw new Error("Unknown inlet placement " + placement + ".");
    const id = this.nextName(namePrefixes.INLET, "node"),
      piece = this.splitName(link);
    s.editor.splitConduitInlet(link, Math.min(0.99, Math.max(0.01, t)), id, piece, design, capture);
    if (placement !== "AUTOMATIC") {
      const node = s.nodes.get(id).index,
        u = s.infrastructure.inletUsages;
      const row = u.get(u.findNode(node));
      u.set(row.hostKind, row.hostIdx, row.designIdx, row.captureNodeIdx, {
        numInlets: row.numInlets,
        pctClogged: row.pctClogged,
        flowLimit: row.flowLimit,
        localDepress: row.localDepress,
        localWidth: row.localWidth,
        placement: InletPlacement[placement],
      });
    }
    return { id, link: piece };
  }
  /** Undo an inlet junction: its usage goes and the two conduits fuse back (the engine's exact inverse). */
  removeInlet(id) {
    this.solver.editor.fuseInletJunction(id);
  }
  /**
   * Property groups beyond the catalog rows (properties.mjs): cross-section, outfall, storage, …; for
   * a section kind (title, report, files) its one card (sections.mjs).
   */
  groups(kind, id) {
    return sectionKinds.includes(kind) ? sectionGroups(this, kind) : propertyGroups(this, kind, id);
  }
  /** Write one property group (checked as legacy SWMM does); returns it as the engine now holds it. */
  setGroup(kind, id, key, values) {
    return sectionKinds.includes(kind) ? applySection(this, kind, key, values) : applyGroup(this, kind, id, key, values);
  }
  /** The map labels ([LABELS]): `{x, y, text, anchor, font, size, bold, italic}` in deck order. */
  labels() {
    return parseLabels(this.solver.spatial.getAnnotation("LABELS"));
  }
  /** Replace the map labels; returns the ones there were (a label needs some text). */
  setLabels(labels) {
    const before = this.labels();
    for (const l of labels) {
      if (!String(l.text ?? "").trim()) throw new Error("A label needs some text.");
      if (!Number.isFinite(+l.x) || !Number.isFinite(+l.y)) throw new Error("A label needs a place on the map.");
      if (!(+l.size > 0)) throw new Error("A label's size must be above 0.");
    }
    this.solver.spatial.setAnnotation("LABELS", labelsText(labels.map((l) => ({ ...l, x: +l.x, y: +l.y, size: +l.size }))));
    return before;
  }
  /** Undo a placement or a trace: the object goes again. */
  removeAdded(kind, id) {
    const e = this.solver.editor;
    ({ node: () => e.deleteNode(id), link: () => e.deleteLink(id), gage: () => e.deleteGage(id), subcatchment: () => e.deleteSubcatch(id) })[kind]();
  }
  /**
   * What deleting map objects would also remove or clear: links that end at a deleted node go with it;
   * other references (a subcatchment's outlet, inflows, controls, …) are cleared.
   */
  objectImpact(items) {
    const s = this.solver,
      names = { node: "nodes", link: "links", subcatchment: "subcatchments", gage: "gages" };
    const chosen = new Set(items.map((i) => i.kind + ":" + String(i.id).toUpperCase()));
    const removed = new Map(),
      cleared = new Map();
    for (const { kind, id } of items) {
      const entries = { node: "analyzeNodeImpact", link: "analyzeLinkImpact", subcatchment: "analyzeSubcatchImpact", gage: "analyzeGageImpact" }[kind];
      for (const e of s.editor[entries](id)) {
        const list = s[names[e.objTypeName]];
        const name = list ? e.objTypeName + " " + list.getId(e.objIdx) : e.objTypeName.replaceAll("_", " ") + " #" + (e.objIdx + 1);
        if (list && chosen.has(e.objTypeName + ":" + list.getId(e.objIdx).toUpperCase())) continue;
        (e.cascaded ? removed : cleared).set(name, e.cascaded ? name : name + " (" + (fieldNames[e.field] ?? e.field.replaceAll("_", " ")) + ")");
      }
    }
    return { removed: [...removed.values()], cleared: [...cleared.values()].filter((c) => !removed.has(c.replace(/ \(.*$/, ""))) };
  }
  /**
   * Delete map objects (links first, then nodes, subcatchments and gages); returns the impact and an
   * undo token for `restoreDeleted` (the engine's recorded deletes: every row and reference back).
   */
  deleteObjects(items) {
    const impact = this.objectImpact(items),
      e = this.solver.editor,
      records = [];
    for (const [kind, call] of [["link", "deleteLinksRecorded"], ["node", "deleteNodesRecorded"], ["subcatchment", "deleteSubcatchmentsRecorded"], ["gage", "deleteGagesRecorded"]]) {
      const keys = items.filter((i) => i.kind === kind).map((i) => i.id);
      if (keys.length) records.push(e[call](keys)[1]);
    }
    this.deleted ??= new Map();
    const token = "delete-" + (this.undoSeq = (this.undoSeq || 0) + 1);
    this.deleted.set(token, records);
    return { impact, token };
  }
  /** Undo `deleteObjects`: the recorded deletes restore in reverse order. */
  restoreDeleted(token) {
    const records = this.deleted?.get(token);
    if (!records) throw new Error("That delete can no longer be undone.");
    for (const r of [...records].reverse()) {
      r.restore();
      r.close();
    }
    this.deleted.delete(token);
  }
  /** What would keep the written deck from opening again (Apply refuses while any remain). */
  problems() {
    const s = this.solver;
    const dividers = s.nodes.ids
      .filter((id) => {
        const n = s.nodes.get(id);
        return n.type === NodeType.DIVIDER && n.divider.params.diversion_link < 0;
      })
      .map((id) => "Divider " + id + " needs a diversion link: trace a link out of it.");
    const subs = s.subcatchments.ids.flatMap((id) => {
      const sub = s.subcatchments.get(id),
        missing = [sub.gageIndex < 0 && "a rain gage", !sub.outlet && "an outlet"].filter(Boolean);
      return missing.length ? ["Subcatchment " + id + " needs " + missing.join(" and ") + ": set it in its properties."] : [];
    });
    return [...dividers, ...subs];
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
    if (sectionKinds.includes(kind)) return []; // one card each (sections.mjs)
    if (kind === "options") {
      const rows = [];
      for (const name of s.options) {
        if (reportOptions.includes(name)) continue; // on the Report card
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
      if (kind === "model" && path.startsWith("climate.")) continue; // edited in the climate dialog
      const sub = Object.keys(subviews).find((prefix) => path.startsWith(prefix));
      if (sub && subviews[sub] !== type) continue;
      if (path.includes(".stats.") || runtimeState.has(path) || replacedRows.has(path)) continue;
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
  /**
   * Every file the engine writes for the model, as `{path: bytes}` under the project's names: the deck
   * and what it keeps beside it (a `[2D_MESH_FILE]` sidecar holds the cells, so a cell edit is there,
   * not in the deck). Apply installs them all.
   */
  writeAll() {
    const fs = this.engine.FS,
      staged = [];
    if (!fs.analyzePath("_stage").exists) fs.mkdir("_stage");
    this.solver.writeStaged(this.entry, (path) => {
      const to = "_stage/" + staged.length;
      staged.push([path.replace(/^\/edit\//, ""), to]);
      return to;
    });
    const files = {};
    for (const [path, to] of staged) {
      files[path] = fs.readFile(to);
      fs.unlink(to);
    }
    return files;
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
