/**
 * Property groups of map objects that the engine's field catalog has no rows for (interaction phase
 * E3b): a link's cross-section, losses, discharge coefficient, pump curve, inlet and LID layer anchor;
 * an outfall's, storage unit's (and its LID's) and divider's parameters, an inlet junction's inlet; a
 * subcatchment's infiltration, groundwater and frozen ground; the initial quality of nodes and links
 * (reaction species too), a node's 2D coupling (E3d-3) and the table rows that name a node or conduit
 * (table-groups.mjs, E3d-3b).
 * Each group is read
 * as `{key, title, fields, note}` — a field `{name, label, unit, type: "number" | "choice" | "text",
 * value, choices: [[value, label]], when: {name, in: [...]}}` shows only while the named field holds one
 * of `in` — and written back whole, checked as legacy SWMM 5.2.4 checks it. The session (model.mjs)
 * owns the engine; these functions take it.
 */
import { NodeType, LinkType, TableType, XSectShape, OutfallType, StorageShape, DividerType, InfilModel, GwfType, WeirView, InletPlacement, LidType, LidNodeLayerKind, NodeCoupling2DType, catalog } from "./vendor/engine/index.js";
import { tableGroups, tableGroupKeys, applyTableGroup } from "./table-groups.mjs";

/** Catalog rows a group shows instead (bare indices or a type that the group's fields follow). */
export const replacedRows = new Set(["node.outfall.type", "node.outfall.route_to", "node.storage.shape", "node.storage.curve", "node.divider.type", "link.pump.curve", "subcatchment.infiltration.model"]);

/** Geometry fields of each cross-section shape (the engine's header; SWMM 5.2 [XSECTIONS]). */
const shapes = {
  CIRCULAR: ["Diameter"],
  FORCE_MAIN: ["Diameter", "Roughness (C or ε)"],
  FILLED_CIRCULAR: ["Diameter", "Filled depth"],
  RECT_CLOSED: ["Height", "Width"],
  RECT_OPEN: ["Height", "Width", "Sides removed"],
  TRAPEZOIDAL: ["Height", "Bottom width", "Left slope", "Right slope"],
  TRIANGULAR: ["Height", "Top width"],
  PARABOLIC: ["Height", "Top width"],
  POWER: ["Height", "Top width", "Exponent"],
  RECT_TRIANG: ["Height", "Top width", "Triangle height"],
  RECT_ROUND: ["Height", "Top width", "Bottom radius"],
  MODBASKETHANDLE: ["Height", "Bottom width", "Top radius"],
  EGGSHAPED: ["Height"],
  HORSESHOE: ["Height"],
  GOTHIC: ["Height"],
  CATENARY: ["Height"],
  SEMIELLIPTICAL: ["Height"],
  BASKETHANDLE: ["Height"],
  SEMICIRCULAR: ["Height"],
  HORIZ_ELLIPSE: ["Height", "Width"],
  VERT_ELLIPSE: ["Height", "Width"],
  ARCH: ["Height", "Width"],
  IRREGULAR: [],
  CUSTOM: ["Height"],
  STREET_XSECT: [],
  DUMMY: [],
};
const shapeLabel = (name) => (name === "STREET_XSECT" ? "Street" : name[0] + name.slice(1).toLowerCase().replaceAll("_", " "));
/** Geometry that is no length (no unit label; zero allowed). */
const plain = new Set(["Left slope", "Right slope", "Exponent", "Sides removed", "Roughness (C or ε)"]);
/** The shapes a link type can take. */
const shapesOf = { CONDUIT: Object.keys(shapes), ORIFICE: ["CIRCULAR", "RECT_CLOSED"], WEIR: ["RECT_OPEN", "TRIANGULAR", "TRAPEZOIDAL"] };
const storageFields = {
  CYLINDRICAL: ["Major axis length", "Minor axis width"],
  CONICAL: ["Major axis length", "Minor axis width", "Side slope"],
  PARABOLOID: ["Major axis length", "Minor axis width", "Height"],
  PYRAMIDAL: ["Major axis length", "Minor axis width", "Side slope"],
};

const same = (a, b) => String(a).toUpperCase() === String(b).toUpperCase();
const num = (v, label) => {
  const x = Number(v);
  if (v === "" || v === null || !Number.isFinite(x)) throw new Error("Enter a number for " + label + ".");
  return x;
};
/** Tables of some types as choices, by name: `[[name, name]]`. */
function tables(s, types) {
  const out = [];
  for (let i = 0; i < s.tables.length; i++) if (types.includes(s.tables.getType(i))) out.push(s.tables.getId(i));
  return out;
}
/** A table's index by name among some types, or -1. */
function tableIndex(s, types, name) {
  for (let i = 0; i < s.tables.length; i++) if (types.includes(s.tables.getType(i)) && same(s.tables.getId(i), name)) return i;
  return -1;
}
const tableName = (s, i) => (i >= 0 && i < s.tables.length ? s.tables.getId(i) : "");
const pumpCurves = [TableType.CURVE_PUMP1, TableType.CURVE_PUMP2, TableType.CURVE_PUMP3, TableType.CURVE_PUMP4, TableType.CURVE_PUMP5];
const placements = [["AUTOMATIC", "Automatic"], ["ON_GRADE", "On grade"], ["ON_SAG", "On sag"]];
/** The ten values of a [FROZEN_GROUND] row, in the engine's order (SI whatever the project's units). */
export const frostFields = [
  ["thickness", "Thickness", "m"],
  ["conductivity", "Conductivity", "W/m/K"],
  ["heatCapacity", "Heat capacity", "J/m³/K"],
  ["waterContent", "Water content", ""],
  ["deepTemperature", "Deep temperature", "°C"],
  ["deepDepth", "Deep depth", "m"],
  ["initialTemperature", "Initial temperature", "°C"],
  ["exponent", "Exponent", ""],
  ["snowConductivity", "Snow conductivity", "W/m/K"],
  ["snowDensity", "Snow density", "kg/m³"],
];
/** What a new row starts from when the model has no `*` row (the desktop's defaults). */
export const frostDefaults = [0.15, 1.5, 2.4e6, 0.3, 8, 3, 5, 11, 0.25, 250];
/** The ten values of a frozen-ground card, checked as the engine checks them (FrozenGround.cpp validate). */
export function frostValues(values, need) {
  const v = frostFields.map(([name, label]) => num(values[name], "the " + label.toLowerCase()));
  need(v[0] > 0, "The thickness must be above 0.");
  need(v[1] > 0 && v[2] > 0, "The conductivity and heat capacity must be above 0.");
  need(v[3] >= 0 && v[3] <= 1, "The water content is between 0 and 1.");
  need(v[5] > 0.5 * v[0], "The deep depth must be more than half the thickness.");
  need(v[7] >= 1, "The exponent must be at least 1.");
  need(v[8] > 0 && v[9] > 0, "The snow conductivity and density must be above 0.");
  return v;
}
const concUnits = ["MG/L", "UG/L", "#/L"];
const bottoms = ["CURRENT", "SEALED", "MESH_AQUIFER"];
const yes = (v) => String(v ?? "").toUpperCase() === "YES";

/**
 * An inlet's usage on its host (a conduit, or an inlet junction): design, capture node and the legacy
 * [INLET_USAGE] values. A conduit may have none; `ends` are the nodes it cannot capture into.
 */
function inletGroup(s, u, kind, row, ends) {
  const designs = [...s.infrastructure.inlets];
  const captures = s.nodes.ids.filter((n) => !ends.some((e) => same(e, n)) && !s.nodes.get(n).isVirtual);
  const on = { name: "design", in: designs };
  return {
    key: "inlet",
    title: "Inlet",
    fields: [
      { name: "design", label: "Inlet design", type: "choice", value: row ? designs[row.designIdx] ?? "" : "", choices: [...(kind === "link" ? [["", "— none —"]] : []), ...designs.map((d) => [d, d])] },
      { name: "capture", label: "Capture node", type: "choice", value: row ? s.nodes.getId(row.captureNodeIdx) : "", choices: captures.map((n) => [n, n]), when: on },
      { name: "number", label: "Number of inlets", type: "number", value: row ? row.numInlets : 1, when: on },
      { name: "clogged", label: "Percent clogged", unit: "%", type: "number", value: row ? row.pctClogged : 0, when: on },
      { name: "flowLimit", label: "Flow restriction", unit: u("flow"), type: "number", value: row ? row.flowLimit : 0, when: on },
      { name: "depress", label: "Local depression height", unit: u("length"), type: "number", value: row ? row.localDepress : 0, when: on },
      { name: "width", label: "Local depression width", unit: u("length"), type: "number", value: row ? row.localWidth : 0, when: on },
      { name: "placement", label: "Placement", type: "choice", value: row ? InletPlacement[row.placement] : "AUTOMATIC", choices: placements, when: on },
    ],
    note: "A flow restriction of 0 means none. Inlet designs are records (Inlets).",
  };
}

/** The structures each node class may couple as (the desktop's nodecoupling2d.cpp allowedTypes). */
const couplingTypes = { JUNCTION: ["NONE", "MANHOLE", "GRATE", "CURB"], DIVIDER: ["NONE", "MANHOLE", "GRATE", "CURB"], STORAGE: ["NONE", "MANHOLE", "GRATE", "CURB", "OPEN"], OUTFALL: ["NONE", "OUTFALL"] };
const couplingLabels = { NONE: "Not coupled", MANHOLE: "Manhole", GRATE: "Grate", CURB: "Curb", OPEN: "Open storage", OUTFALL: "Outfall" };
const exchanging = ["MANHOLE", "GRATE", "CURB", "OPEN"];
/**
 * [2D_NODE_COUPLING] keys as the desktop's node card shows them (swmmnodepropertyadapter.cpp): key,
 * label, unit or choices, the structures it applies to (propertiespanel.cpp applyCouplingRowFlags).
 */
const couplingKeys = [
  ["D", "Manhole diameter", "length", ["MANHOLE"]],
  ["PERIMETER", "Inlet perimeter", "length", ["GRATE", "CURB", "OPEN"]],
  ["AREA", "Opening area", "area", ["GRATE", "CURB", "OPEN"]],
  ["CHAMBER_AREA", "Chamber area", "area", exchanging],
  ["LID_OPEN_FRACTION", "Lid open fraction", "", exchanging],
  ["CREST", "Crest elevation", [["", "Default (node rim)"], ["NODE_RIM", "Node rim"], ["MESH_BED", "Mesh bed"], ["MAX", "Higher of rim and bed"], ["MIN", "Lower of rim and bed"]], exchanging],
  ["LAW", "Exchange law", [["", "From 2D options"], ["ORIFICE", "Orifice"], ["WEIR_ORIFICE", "Weir and orifice"]], exchanging],
  ["COEFFS", "Coefficients", [["", "From 2D options"], ["DEFAULT", "Default"], ["RUBINATO2017", "Rubinato 2017"], ["RUBINATO2017_LOWER", "Rubinato 2017, lower"], ["RUBINATO2017_UPPER", "Rubinato 2017, upper"]], exchanging],
  ["CW", "Weir coefficient (Cw)", "", exchanging],
  ["CSW", "Submerged weir coefficient (Csw)", "", exchanging],
  ["COI", "Orifice coefficient in (Coi)", "", exchanging],
  ["COO", "Orifice coefficient out (Coo)", "", exchanging],
  ["SPREAD", "Discharge spread", "length", ["OUTFALL"]],
  ["TAILWATER_RELAX", "Tailwater relaxation", "s", ["OUTFALL"]],
];
/** Does any node carry a [2D_NODE_COUPLING] row? */
const anyCoupling = (s) => s.nodes.ids.some((n) => s.surface2d.getNodeCouplingType(s.nodes.get(n).index)[1]);

/**
 * A node's 1D ↔ 2D coupling ([2D_NODE_COUPLING]), as the desktop's node card: the structure (blank =
 * the class default, no row) and its parameters (blank = the structure's default or the 2D options).
 * Shown for junctions, storage units, dividers and outfalls of a model with a mesh or with coupling
 * rows; inlet and virtual junctions do not couple (an inlet already takes street flow into the sewer).
 */
function couplingGroup(session, u, id) {
  const s = session.solver,
    n = s.nodes.get(id),
    types = couplingTypes[NodeType[n.type]];
  if (!types || n.isInlet || n.isVirtual) return null;
  if (!session.cells?.mannings?.length && !anyCoupling(s)) return null;
  const g = s.surface2d,
    [type, authored] = g.getNodeCouplingType(n.index),
    def = NodeCoupling2DType[g.getNodeCouplingDefaultType(n.index)];
  const fields = [{ name: "type", label: "Structure", type: "choice", value: authored ? NodeCoupling2DType[type] : "", choices: [["", "Default (" + couplingLabels[def].toLowerCase() + ")"], ...types.map((t) => [t, couplingLabels[t]])] }];
  for (const [key, label, unit, on] of couplingKeys) {
    if (!on.some((t) => types.includes(t))) continue;
    const token = authored ? g.getNodeCouplingParam(n.index, key) : "";
    const when = { name: "type", in: [...on, ...(on.includes(def) ? [""] : [])] };
    if (Array.isArray(unit)) fields.push({ name: "c:" + key, label, type: "choice", value: token, choices: unit, when });
    else fields.push({ name: "c:" + key, label, unit: unit === "s" ? "s" : unit ? u(unit) : undefined, type: "number", value: token === "" ? "" : Number(token), when });
  }
  return {
    key: "coupling2d",
    title: "2D coupling",
    fields,
    note: "Blank uses the structure's default or the 2D options." + (types.includes("OUTFALL") ? " Tailwater relaxation applies to outfalls that are not FREE." : ""),
  };
}

/** Initial quality of a node or link ([INITIAL_QUALITY]): a row per pollutant, water age, temperature. */
function qualityGroup(session, kind, id) {
  const s = session.solver,
    q = s.initialQuality,
    isLink = kind === "link",
    index = (isLink ? s.links : s.nodes).get(id).index;
  const constituents = session.pollutantIds().map((p) => [p, p, concUnits[s.pollutants.get(p).units] ?? ""]);
  if (yes(s.options.get("WATER_AGE"))) constituents.push([q.WATER_AGE, "Water age", "hours"]);
  if (yes(s.options.get("HEAT_TRANSPORT"))) constituents.push([q.TEMPERATURE, "Temperature", "°C"]);
  const rows = [...q].map((r, i) => ({ ...r, i })).filter((r) => r.isLink === isLink && r.elemIndex === index);
  const fields = constituents.map(([c, label, unit]) => {
    const r = rows.find((r) => (c.startsWith("__") ? r.constituent === c : same(r.constituent, c)));
    return { name: "q:" + c, label, unit, type: "number", value: r ? r.value : "", readonly: r ? q.isFile(r.i) : false };
  });
  // Reaction species ([REACTION_QUALITY] NODE|LINK, saved with the reaction system), any species on
  // either, as the desktop's reaction editor; bulk per liter, wall per the system's area units.
  const re = s.reactions,
    species = [...re.species];
  if (species.length) {
    const area = re.getOption("AREA_UNITS") || "FT2",
      own = [...re.initial].filter((r) => r.isLink === isLink && r.elemIndex === index);
    species.forEach((sp, k) => {
      const r = own.find((r) => r.speciesIndex === k);
      fields.push({ name: "r:" + sp.name, label: sp.name + (sp.isWall ? " (wall)" : ""), unit: sp.units + "/" + (sp.isWall ? area : "L"), type: "number", value: r ? r.value : "" });
    });
  }
  if (!fields.length) return null;
  return { key: "quality", title: "Initial quality", fields, note: "Blank starts the constituent at its model-wide initial value." + (fields.some((f) => f.readonly) ? " Values from the initial-quality file are edited there." : "") };
}

/** The storage-node LID controls (type NODE), by name. */
const nodeLids = (s) => {
  const lids = s.infrastructure.lids;
  return Array.from({ length: lids.length }, (_, i) => i).filter((i) => lids.getType(i) === LidType.NODE).map((i) => lids.getId(i));
};
/** The one end of a link that is a storage node with a LID, or null (none, or both). */
function lidEnd(s, link) {
  const lids = s.infrastructure.lids;
  const ends = [link.fromNode.id, link.toNode.id].filter((n) => s.nodes.get(n).type === NodeType.STORAGE && lids.nodeAssignment(n));
  return ends.length === 1 ? ends[0] : null;
}
/** Whether a mesh-aquifer bottom could be chosen for a node (the desktop's check: a 2D aquifer bed). */
function meshBottomAllowed(s, id) {
  try {
    const g = s.groundwater2d,
      beds = g.nodes;
    g.replaceNodes(beds, beds, { bottoms: [[s.nodes.get(id).index, bottoms.indexOf(s.infrastructure.lids.nodeBottom(id)), 2]], apply: false });
    return true;
  } catch {
    return false;
  }
}

const responses = ["Short-term", "Medium-term", "Long-term"];
/** A unit hydrograph group's RDII decay row for one response (0–2), or null. */
function decayRow(s, group, response) {
  for (let i = 0; i < s.inflows.rdiiDecayCount; i++) {
    const r = s.inflows.getRdiiDecay(i);
    if (same(r.uhName, group) && r.response === response) return r;
  }
  return null;
}
/**
 * The RDII decay of a unit hydrograph group ([RDII_DECAY]), as the desktop's hydrograph editor: one
 * card per response, none (the linear initial abstraction above), exponential decay, or exponential
 * decay with a degree-day snow store.
 */
function decayGroups(s, u, group) {
  const depth = u("rain_depth");
  return responses.map((label, r) => {
    const row = decayRow(s, group, r);
    const mode = !row ? "" : row.snow_on ? "EXP_SNOW" : "EXP";
    const on = { name: "mode", in: ["EXP", "EXP_SNOW"] };
    return {
      key: "decay" + r,
      title: label + " RDII decay",
      fields: [
        { name: "mode", label: "Decay", type: "choice", value: mode, choices: [["", "None (linear initial abstraction)"], ["EXP", "Exponential"], ["EXP_SNOW", "Exponential with snow"]] },
        { name: "k_dep", label: "Depletion rate k_dep", unit: "1/" + depth, type: "number", value: row?.k_dep ?? 0, when: on },
        { name: "k_0", label: "Base recovery rate k_0", unit: "1/h", type: "number", value: row?.k_0 ?? 0, when: on },
        { name: "k_T", label: "Thermal recovery rate k_T", unit: "1/h", type: "number", value: row?.k_T ?? 0, when: on },
        { name: "T_ref", label: "Reference temperature T_ref", unit: "°C", type: "number", value: row?.T_ref ?? 0, when: on },
        { name: "theta_rec", label: "Temperature sensitivity theta_rec", unit: "1/°C", type: "number", value: row?.theta_rec ?? 0, when: on },
        { name: "T_freeze", label: "Freezing temperature T_freeze", unit: "°C", type: "number", value: row?.T_freeze ?? 0, when: on },
        { name: "snow_T", label: "Snow temperature snow_T", unit: "°C", type: "number", value: row?.snow_T ?? 1, when: { name: "mode", in: ["EXP_SNOW"] } },
        { name: "snow_ddf", label: "Melt factor snow_ddf", unit: depth + "/°C/day", type: "number", value: row?.snow_ddf ?? 0, when: { name: "mode", in: ["EXP_SNOW"] } },
      ],
      note:
        r === 0
          ? "Year-round: depletion as the soil store fills, recovery by drainage (k_0) and by evaporation at T_ref (k_T, theta_rec), none at or below T_freeze. Snow holds precipitation at or below snow_T and melts it above; it needs a climate temperature source."
          : undefined,
    };
  });
}

/** The property groups of a node, link or subcatchment (`session` a ModelSession). */
export function propertyGroups(session, kind, id) {
  const s = session.solver,
    u = (units) => catalog.unitLabel(units, session.unitSystem, session.flowUnits);
  const groups = [];
  if (kind === "hydrograph") return decayGroups(s, u, id);
  if (kind === "gage") return [flagGroup(session, kind, id)].filter(Boolean);
  if (kind === "link") {
    const l = s.links.get(id),
      type = LinkType[l.type];
    if (shapesOf[type]) {
      const [code, g1, g2, g3, g4] = l.xsect.asTuple(),
        shape = XSectShape[code];
      const geom = [g1, g2, g3, g4];
      // A custom shape's curve cannot be assigned through the engine API (swmm_link_set_xsect leaves
      // the curve reference alone): CUSTOM is not offered, and a custom link's section is read-only.
      const offered = shapesOf[type].filter((n) => n !== "CUSTOM" || shape === "CUSTOM");
      const fields = [{ name: "shape", label: "Shape", type: "choice", value: shape, choices: offered.map((n) => [n, shapeLabel(n)]) }];
      for (let k = 0; k < 4; k++) {
        const users = shapesOf[type].filter((n) => shapes[n][k]);
        if (!users.length) continue;
        // One row per geometry slot; its label is the shape's (the view takes `labels[shape]`).
        fields.push({
          name: "g" + (k + 1),
          label: shapes[users[0]][k],
          labels: Object.fromEntries(users.map((n) => [n, shapes[n][k]])),
          unit: u("length"), // the view leaves it off slopes, exponents and the like
          type: "number",
          value: shape === "IRREGULAR" || shape === "STREET_XSECT" || (shape === "CUSTOM" && k === 1) ? 0 : geom[k],
          when: { name: "shape", in: users },
        });
      }
      if (type === "CONDUIT") {
        fields.push({ name: "transect", label: "Transect", type: "choice", value: shape === "IRREGULAR" ? session.transectIds()[g1] ?? "" : "", choices: session.transectIds().map((t) => [t, t]), when: { name: "shape", in: ["IRREGULAR"] } });
        const streets = [...s.infrastructure.streets];
        fields.push({ name: "street", label: "Street", type: "choice", value: shape === "STREET_XSECT" ? streets[g1] ?? "" : "", choices: streets.map((t) => [t, t]), when: { name: "shape", in: ["STREET_XSECT"] } });
      }
      groups.push(
        shape === "CUSTOM"
          ? { key: "xsect", title: "Cross-section", fields, readonly: true, note: "A custom shape's curve is set in the deck (Edit INP); the engine cannot assign one here yet." }
          : { key: "xsect", title: "Cross-section", fields, note: "Barrels and the culvert code are rows above." },
      );
    }
    if (type === "CONDUIT") {
      const [inlet, outlet, average] = l.lossCoeff;
      groups.push({
        key: "losses",
        title: "Losses",
        fields: [
          { name: "inlet", label: "Entry loss coefficient", type: "number", value: inlet },
          { name: "outlet", label: "Exit loss coefficient", type: "number", value: outlet },
          { name: "average", label: "Average loss coefficient", type: "number", value: average },
        ],
        note: "Flap gate and seepage rate are rows above.",
      });
      const usages = s.infrastructure.inletUsages,
        at = usages.findLink(l.index);
      if (s.infrastructure.inlets.length || at >= 0) groups.push(inletGroup(s, u, "link", at >= 0 ? usages.get(at) : null, [l.fromNode.id, l.toNode.id]));
    }
    const end = lidEnd(s, l);
    if (end) {
      const lids = s.infrastructure.lids,
        [control] = lids.nodeAssignment(end),
        anchor = lids.getOutletAnchor(id);
      const layers = lids.getLayers(control).filter((x) => x.kind !== LidNodeLayerKind.BOTTOM);
      const names = layers.map((x, k) => String(k + 1));
      groups.push({
        key: "lidAnchor",
        title: "LID outlet",
        fields: [
          { name: "layer", label: "Layer of " + end, type: "choice", value: String(anchor ? anchor[0] : 0), choices: [["0", "— none (the link's own offset) —"], ...layers.map((x, k) => [names[k], names[k] + " · " + LidNodeLayerKind[x.kind][0] + LidNodeLayerKind[x.kind].slice(1).toLowerCase()])] },
          { name: "position", label: "At the layer's", type: "choice", value: anchor ? anchor[1] : "BOTTOM", choices: [["BOTTOM", "Bottom"], ["TOP", "Top"]], when: { name: "layer", in: names } },
        ],
        restore: lids.nodeSnapshot(end),
        refresh: true,
        note: "An anchored link's offset at " + end + " follows the layer.",
      });
    }
    if (type === "ORIFICE" || type === "OUTLET")
      groups.push({ key: "coefficient", title: type === "ORIFICE" ? "Orifice" : "Outlet rating", fields: [{ name: "cd", label: type === "ORIFICE" ? "Discharge coefficient" : "Coefficient", type: "number", value: new WeirView(l).dischargeCoeff }] });
    if (type === "PUMP") {
      const c = l.pump.curve;
      groups.push({ key: "pump", title: "Pump", fields: [{ name: "curve", label: "Pump curve", type: "choice", value: c >= 0 ? tableName(s, c) : "", choices: [["", "* (ideal pump)"], ...tables(s, pumpCurves).map((t) => [t, t])] }] });
    }
  } else if (kind === "node") {
    const n = s.nodes.get(id),
      type = NodeType[n.type];
    if (type === "OUTFALL") {
      const o = n.outfall,
        t = OutfallType[o.type],
        route = o.routeTo;
      groups.push({
        key: "outfall",
        title: "Outfall",
        fields: [
          { name: "type", label: "Type", type: "choice", value: t, choices: ["FREE", "NORMAL", "FIXED", "TIDAL", "TIMESERIES"].map((v) => [v, v[0] + v.slice(1).toLowerCase()]) },
          { name: "stage", label: "Fixed stage", unit: u("length"), type: "number", value: t === "FIXED" ? o.param : 0, when: { name: "type", in: ["FIXED"] } },
          { name: "tidal", label: "Tidal curve", type: "choice", value: t === "TIDAL" ? tableName(s, o.getTidalCurve()) : "", choices: tables(s, [TableType.CURVE_TIDAL]).map((v) => [v, v]), when: { name: "type", in: ["TIDAL"] } },
          { name: "series", label: "Stage time series", type: "choice", value: t === "TIMESERIES" ? tableName(s, o.getTimeseries()) : "", choices: tables(s, [TableType.TIMESERIES]).map((v) => [v, v]), when: { name: "type", in: ["TIMESERIES"] } },
          { name: "routeTo", label: "Route to subcatchment", type: "choice", value: route >= 0 ? s.subcatchments.getId(route) : "", choices: [["", "— none —"], ...s.subcatchments.ids.map((v) => [v, v])] },
        ],
        note: "The flap gate is a row above.",
      });
    }
    if (type === "STORAGE") {
      const st = n.storage,
        shape = StorageShape[st.shape],
        [a, b, c] = st.functional,
        geom = st.geometry,
        [suction, ksat, imd] = st.exfilParams;
      const fields = [
        { name: "shape", label: "Shape", type: "choice", value: shape, choices: ["FUNCTIONAL", "TABULAR", "CYLINDRICAL", "CONICAL", "PARABOLOID", "PYRAMIDAL"].map((v) => [v, v[0] + v.slice(1).toLowerCase()]) },
        { name: "a", label: "Coefficient", type: "number", value: a, when: { name: "shape", in: ["FUNCTIONAL"] } },
        { name: "b", label: "Exponent", type: "number", value: b, when: { name: "shape", in: ["FUNCTIONAL"] } },
        { name: "c", label: "Constant", unit: u("area"), type: "number", value: c, when: { name: "shape", in: ["FUNCTIONAL"] } },
        { name: "curve", label: "Storage curve", type: "choice", value: shape === "TABULAR" ? tableName(s, st.curve) : "", choices: tables(s, [TableType.CURVE_STORAGE]).map((v) => [v, v]), when: { name: "shape", in: ["TABULAR"] } },
      ];
      for (let k = 0; k < 3; k++) {
        const users = Object.keys(storageFields).filter((v) => storageFields[v][k]);
        fields.push({ name: "p" + (k + 1), label: storageFields.CONICAL[k], labels: Object.fromEntries(users.map((v) => [v, storageFields[v][k]])), unit: u("length"), type: "number", value: geom[k], when: { name: "shape", in: users } });
      }
      fields.push(
        { name: "suction", label: "Exfiltration suction head", unit: u("rain_depth"), type: "number", value: suction },
        { name: "ksat", label: "Exfiltration conductivity", unit: u("rain_rate"), type: "number", value: ksat },
        { name: "imd", label: "Exfiltration initial deficit", type: "number", value: imd },
      );
      groups.push({ key: "storage", title: "Storage", fields, note: "Zero exfiltration values mean none (the seepage rate is a row above)." });
      const lids = s.infrastructure.lids,
        controls = nodeLids(s),
        assigned = lids.nodeAssignment(id);
      if (controls.length || assigned) {
        const bottom = assigned ? lids.nodeBottom(id) : "CURRENT",
          on = { name: "control", in: controls };
        groups.push({
          key: "lid",
          title: "LID",
          fields: [
            { name: "control", label: "LID control", type: "choice", value: assigned ? lids.getId(assigned[0]) : "", choices: [["", "— none —"], ...controls.map((c) => [c, c])] },
            { name: "saturation", label: "Initial saturation", unit: "%", type: "number", value: assigned ? assigned[1] : 0, when: on },
            { name: "bottom", label: "Bottom", type: "choice", value: bottom, choices: [["CURRENT", "Keep current behavior"], ["SEALED", "Sealed"], ...(bottom === "MESH_AQUIFER" || meshBottomAllowed(s, id) ? [["MESH_AQUIFER", "Mesh aquifer"]] : [])], when: on },
          ],
          restore: lids.nodeSnapshot(id),
          refresh: true,
          note: "The node's maximum depth follows the control's layers; links are anchored to a layer on their own cards.",
        });
      }
    }
    if (n.isInlet) {
      const usages = s.infrastructure.inletUsages,
        at = usages.findNode(n.index);
      if (at >= 0) groups.push(inletGroup(s, u, "node", usages.get(at), [id]));
    }
    if (type === "DIVIDER") {
      const d = n.divider,
        t = DividerType[d.type],
        p = d.params;
      const out = s.links.ids.filter((l) => same(s.links.get(l).fromNode.id, id));
      groups.push({
        key: "divider",
        title: "Divider",
        fields: [
          { name: "type", label: "Type", type: "choice", value: t, choices: ["CUTOFF", "OVERFLOW", "TABULAR", "WEIR"].map((v) => [v, v[0] + v.slice(1).toLowerCase()]) },
          { name: "link", label: "Diverted link", type: "choice", value: p.diversion_link >= 0 ? s.links.getId(p.diversion_link) : "", choices: out.map((l) => [l, l]) },
          { name: "cutoff", label: t === "WEIR" ? "Minimum flow" : "Cutoff flow", labels: { CUTOFF: "Cutoff flow", WEIR: "Minimum flow" }, unit: u("flow"), type: "number", value: p.cutoff_flow, when: { name: "type", in: ["CUTOFF", "WEIR"] } },
          { name: "curve", label: "Diversion curve", type: "choice", value: t === "TABULAR" ? tableName(s, p.curve) : "", choices: tables(s, [TableType.CURVE_DIVERSION]).map((v) => [v, v]), when: { name: "type", in: ["TABULAR"] } },
          { name: "height", label: "Weir height", unit: u("length"), type: "number", value: p.weir_height, when: { name: "type", in: ["WEIR"] } },
          { name: "coeff", label: "Weir coefficient", type: "number", value: p.weir_coefficient, when: { name: "type", in: ["WEIR"] } },
        ],
      });
    }
  } else if (kind === "subcatchment") {
    const sub = s.subcatchments.get(id),
      inf = sub.infiltration,
      model = InfilModel[inf.model];
    const [f0, fmin, decay, dry] = inf.horton,
      [suction, ksat, imd] = inf.greenAmpt;
    const horton = ["HORTON", "MOD_HORTON"],
      ga = ["GREEN_AMPT", "MOD_GREEN_AMPT"];
    groups.push({
      key: "infiltration",
      title: "Infiltration",
      fields: [
        { name: "model", label: "Method", type: "choice", value: model, choices: [["HORTON", "Horton"], ["MOD_HORTON", "Modified Horton"], ["GREEN_AMPT", "Green-Ampt"], ["MOD_GREEN_AMPT", "Modified Green-Ampt"], ["CURVE_NUMBER", "Curve number"]] },
        { name: "f0", label: "Max. infiltration rate", unit: u("rain_rate"), type: "number", value: f0, when: { name: "model", in: horton } },
        { name: "fmin", label: "Min. infiltration rate", unit: u("rain_rate"), type: "number", value: fmin, when: { name: "model", in: horton } },
        { name: "decay", label: "Decay constant", unit: "1/h", type: "number", value: decay, when: { name: "model", in: horton } },
        { name: "dry", label: "Drying time", unit: "days", type: "number", value: dry, when: { name: "model", in: horton } },
        { name: "suction", label: "Suction head", unit: u("rain_depth"), type: "number", value: suction, when: { name: "model", in: ga } },
        { name: "ksat", label: "Conductivity", unit: u("rain_rate"), type: "number", value: ksat, when: { name: "model", in: ga } },
        { name: "imd", label: "Initial deficit", type: "number", value: imd, when: { name: "model", in: ga } },
        { name: "cn", label: "Curve number", type: "number", value: inf.curveNumber, when: { name: "model", in: ["CURVE_NUMBER"] } },
        { name: "cnDry", label: "Drying time", unit: "days", type: "number", value: inf.curveNumberDryingTime, when: { name: "model", in: ["CURVE_NUMBER"] } },
      ],
    });
    const aquifer = sub.aquifer,
      node = sub.gwNode,
      g = sub.gwParams;
    const gwf = (t) => s.subcatchments.getGwfExpression(id, t);
    const on = { name: "aquifer", in: session.aquiferIds() };
    groups.push({
      key: "groundwater",
      title: "Groundwater",
      fields: [
        { name: "aquifer", label: "Aquifer", type: "choice", value: aquifer === null ? "" : session.aquiferIds()[aquifer] ?? "", choices: [["", "— none —"], ...session.aquiferIds().map((v) => [v, v])] },
        { name: "node", label: "Receiving node", type: "choice", value: node === null ? "" : s.nodes.getId(node), choices: s.nodes.ids.map((v) => [v, v]), when: on },
        { name: "surfElev", label: "Surface elevation", unit: u("length"), type: "number", value: g.surfElev, when: on },
        { name: "a1", label: "A1 (groundwater flow coefficient)", type: "number", value: g.a1, when: on },
        { name: "b1", label: "B1 (groundwater flow exponent)", type: "number", value: g.b1, when: on },
        { name: "a2", label: "A2 (surface water flow coefficient)", type: "number", value: g.a2, when: on },
        { name: "b2", label: "B2 (surface water flow exponent)", type: "number", value: g.b2, when: on },
        { name: "a3", label: "A3 (interaction coefficient)", type: "number", value: g.a3, when: on },
        { name: "tw", label: "Fixed surface water depth", unit: u("length"), type: "number", value: g.tw, when: on },
        { name: "hstar", label: "Threshold groundwater height", unit: u("length"), type: "number", value: g.hstar, when: on },
        { name: "lateral", label: "Lateral flow expression", type: "text", value: gwf(GwfType.LATERAL), when: on },
        { name: "deep", label: "Deep flow expression", type: "text", value: gwf(GwfType.DEEP), when: on },
      ],
      note: "Blank expressions keep SWMM's standard groundwater flow.",
    });
    const frost = s.frozenGroundRows(),
      seed = frost[id] ?? frost["*"] ?? frostDefaults;
    groups.push({
      key: "frost",
      title: "Frozen ground",
      fields: [
        { name: "row", label: "Use", type: "choice", value: frost[id] ? "own" : "", choices: [["", frost["*"] ? "Model default (*)" : "None"], ["own", "Own values"]] },
        ...frostFields.map(([name, label, unit], k) => ({ name, label, unit, type: "number", value: seed[k], when: { name: "row", in: ["own"] } })),
      ],
      note: "SI values whatever the project's units." + (frost["*"] ? " Without values of its own the model's default row (*) applies." : ""),
    });
  }
  if (kind === "node") {
    const c = couplingGroup(session, u, id);
    if (c) groups.push(c);
  }
  if (kind === "node" || kind === "link") groups.push(...tableGroups(session, kind, id)); // aquifer bed/link, ARD
  if (kind === "node" || kind === "link") {
    const q = qualityGroup(session, kind, id);
    if (q) groups.push(q);
  }
  const flags = flagGroup(session, kind, id);
  if (flags) groups.push(flags);
  return groups;
}
const flagObject = { node: "NODE", link: "LINK", subcatchment: "SUBCATCHMENT", gage: "GAGE" };
/** The user flags' values on one object ([USER_FLAGS] rows); none when no flag is defined. */
function flagGroup(session, kind, id) {
  const defs = flagObject[kind] ? session.userFlags() : [];
  if (!defs.length) return null;
  const uf = session.solver.userflags;
  return {
    key: "userflags",
    title: "User flags",
    fields: defs.map((d) => {
      const v = uf.getValue(flagObject[kind], id, d.name) ?? "";
      const base = { name: "flag:" + d.name, label: d.name };
      return d.type === "BOOLEAN" ? { ...base, type: "choice", value: v.toUpperCase(), choices: [["", "— unset —"], ["YES", "Yes"], ["NO", "No"]] } : { ...base, type: "text", value: v };
    }),
    note: "Blank leaves a flag unset. " + defs.filter((d) => d.description).map((d) => d.name + ": " + d.description + ".").join(" "),
  };
}

/** Check a group's values as legacy SWMM 5.2.4 does and write them through the engine. */
export function applyGroup(session, kind, id, key, values) {
  const s = session.solver;
  const need = (cond, message) => {
    if (!cond) throw new Error(message);
  };
  if (kind === "link" && key === "xsect") {
    const l = s.links.get(id),
      shape = values.shape;
    need(shapesOf[LinkType[l.type]]?.includes(shape), "Unknown shape " + shape + " for this link.");
    need(shape !== "CUSTOM" && XSectShape[l.xsect.shape] !== "CUSTOM", "A custom shape's curve cannot be assigned here yet; use Edit INP.");
    const code = XSectShape[shape];
    let tuple;
    if (shape === "IRREGULAR") {
      const i = session.transectIds().findIndex((t) => same(t, values.transect));
      need(i >= 0, "Choose the transect of the irregular channel.");
      tuple = [code, i, 0, 0, 0];
    } else if (shape === "STREET_XSECT") {
      const i = [...s.infrastructure.streets].findIndex((t) => same(t, values.street));
      need(i >= 0, "Choose the street of the street cross-section.");
      tuple = [code, i, 0, 0, 0];
    } else {
      const labels = shapes[shape],
        g = [0, 0, 0, 0];
      labels.forEach((label, k) => {
        g[k] = num(values["g" + (k + 1)], label);
        if (plain.has(label)) need(g[k] >= 0, label + " cannot be negative.");
        else need(g[k] > 0 || (shape === "FILLED_CIRCULAR" && k === 1 && g[k] >= 0) || (shape === "RECT_TRIANG" && k === 2 && g[k] >= 0), label + " must be above 0.");
      });
      if (shape === "RECT_OPEN") need([0, 1, 2].includes(g[2]), "Sides removed is 0, 1 or 2.");
      if (shape === "FILLED_CIRCULAR") need(g[1] < g[0], "The filled depth must be less than the diameter.");
      if (shape === "POWER") need(g[2] > 0, "The exponent must be above 0.");
      if (shape === "RECT_TRIANG") need(g[2] < g[0], "The triangle height must be less than the height.");
      if (shape === "RECT_ROUND") need(g[2] >= g[1] / 2, "The bottom radius must be at least half the top width.");
      tuple = [code, ...g];
    }
    l.xsect = tuple;
  } else if (kind === "link" && key === "losses") {
    const v = ["inlet", "outlet", "average"].map((k) => num(values[k], k + " loss coefficient"));
    need(v.every((x) => x >= 0), "Loss coefficients cannot be negative.");
    s.links.get(id).lossCoeff = v;
  } else if (kind === "link" && key === "coefficient") {
    const cd = num(values.cd, "the coefficient");
    need(cd >= 0, "The coefficient cannot be negative.");
    new WeirView(s.links.get(id)).dischargeCoeff = cd;
  } else if (kind === "link" && key === "pump") {
    const i = values.curve ? tableIndex(s, pumpCurves, values.curve) : -1;
    need(!values.curve || i >= 0, "No pump curve " + values.curve + ".");
    s.links.get(id).pump.curve = i;
  } else if (kind === "node" && key === "outfall") {
    const o = s.nodes.get(id).outfall,
      t = values.type;
    if (t === "FIXED") o.setStage(num(values.stage, "the fixed stage"));
    else if (t === "TIDAL") {
      const i = tableIndex(s, [TableType.CURVE_TIDAL], values.tidal);
      need(i >= 0, "Choose the tidal curve.");
      o.setTidalCurve(i);
    } else if (t === "TIMESERIES") {
      const i = tableIndex(s, [TableType.TIMESERIES], values.series);
      need(i >= 0, "Choose the stage time series.");
      o.setTimeseries(i);
    } else {
      need(t === "FREE" || t === "NORMAL", "Unknown outfall type " + t + ".");
      o.type = OutfallType[t];
    }
    o.routeTo = values.routeTo ? s.subcatchments.get(values.routeTo).index : -1;
  } else if (kind === "node" && key === "storage") {
    const st = s.nodes.get(id).storage,
      shape = values.shape;
    if (shape === "FUNCTIONAL") {
      const f = ["a", "b", "c"].map((k) => num(values[k], { a: "the coefficient", b: "the exponent", c: "the constant" }[k]));
      need(f.every((x) => x >= 0), "Storage coefficients cannot be negative.");
      need(f[0] > 0 || f[2] > 0, "A functional storage unit needs a coefficient or a constant above 0.");
      st.functional = f;
    } else if (shape === "TABULAR") {
      const i = tableIndex(s, [TableType.CURVE_STORAGE], values.curve);
      need(i >= 0, "Choose the storage curve.");
      st.curve = i;
    } else {
      need(storageFields[shape], "Unknown storage shape " + shape + ".");
      const p = storageFields[shape].map((label, k) => num(values["p" + (k + 1)], label));
      need(p[0] > 0 && p[1] > 0, "The axis length and width must be above 0.");
      need((p[2] ?? 0) >= 0, storageFields[shape][2] + " cannot be negative.");
      st.shape = StorageShape[shape];
      st.geometry = [p[0], p[1], p[2] ?? 0];
    }
    if (shape === "FUNCTIONAL" || shape === "TABULAR") st.shape = StorageShape[shape];
    const exfil = ["suction", "ksat", "imd"].map((k) => num(values[k], "the exfiltration " + k));
    need(exfil.every((x) => x >= 0), "Exfiltration values cannot be negative.");
    st.exfilParams = exfil;
  } else if (kind === "node" && key === "divider") {
    const d = s.nodes.get(id).divider,
      t = values.type;
    need(DividerType[t] !== undefined, "Unknown divider type " + t + ".");
    const link = s.links.ids.find((l) => same(l, values.link) && same(s.links.get(l).fromNode.id, id));
    need(link, "Choose the diverted link: a link that leaves " + id + ".");
    const p = { ...d.params, diversion_link: s.links.get(link).index };
    if (t === "CUTOFF") {
      p.cutoff_flow = num(values.cutoff, "the cutoff flow");
      need(p.cutoff_flow >= 0, "The cutoff flow cannot be negative.");
    } else if (t === "TABULAR") {
      p.curve = tableIndex(s, [TableType.CURVE_DIVERSION], values.curve);
      need(p.curve >= 0, "Choose the diversion curve.");
    } else if (t === "WEIR") {
      p.cutoff_flow = num(values.cutoff, "the minimum flow");
      p.weir_height = num(values.height, "the weir height");
      p.weir_coefficient = num(values.coeff, "the weir coefficient");
      need(p.cutoff_flow >= 0, "The minimum flow cannot be negative.");
      need(p.weir_height > 0 && p.weir_coefficient > 0, "The weir height and coefficient must be above 0.");
    }
    d.type = DividerType[t];
    d.params = { ...d.params, ...p, method: DividerType[t] };
  } else if (kind === "subcatchment" && key === "infiltration") {
    const inf = s.subcatchments.get(id).infiltration,
      m = values.model;
    need(InfilModel[m] !== undefined, "Unknown infiltration method " + m + ".");
    if (m.includes("HORTON")) {
      const p = ["f0", "fmin", "decay", "dry"].map((k) => num(values[k], { f0: "the maximum rate", fmin: "the minimum rate", decay: "the decay constant", dry: "the drying time" }[k]));
      need(p.every((x) => x >= 0), "Horton parameters cannot be negative."); // horton_setParams
      need(p[0] >= p[1], "The maximum rate cannot be below the minimum rate.");
      inf.setHorton(...p);
    } else if (m.includes("GREEN")) {
      const p = ["suction", "ksat", "imd"].map((k) => num(values[k], { suction: "the suction head", ksat: "the conductivity", imd: "the initial deficit" }[k]));
      need(p[0] >= 0, "The suction head cannot be negative."); // grnampt_setParams
      need(p[1] > 0, "The conductivity must be above 0.");
      need(p[2] >= 0 && p[2] <= 1, "The initial deficit is between 0 and 1.");
      inf.setGreenAmpt(...p);
    } else {
      const cn = num(values.cn, "the curve number"),
        dry = num(values.cnDry, "the drying time");
      need(cn >= 10 && cn <= 99, "The curve number is between 10 and 99."); // curvenum_setParams clamps
      need(dry > 0, "The drying time must be above 0.");
      inf.setCurveNumber(cn, dry);
    }
    inf.model = InfilModel[m]; // after the family setter, which stamps its own model
  } else if (kind === "subcatchment" && key === "groundwater") {
    const sub = s.subcatchments.get(id);
    if (!values.aquifer) {
      sub.aquifer = null;
      sub.gwNode = null;
    } else {
      need(session.aquiferIds().some((a) => same(a, values.aquifer)), "No aquifer " + values.aquifer + ".");
      need(values.node && s.nodes.has(values.node), "Choose the node that receives the groundwater flow.");
      const p = ["surfElev", "a1", "b1", "a2", "b2", "a3", "tw", "hstar"].map((k) => num(values[k], k));
      need(p.slice(1, 6).every((x) => x >= 0), "The flow coefficients and exponents cannot be negative.");
      for (const [t, text] of [[GwfType.LATERAL, values.lateral], [GwfType.DEEP, values.deep]]) {
        const expr = String(text ?? "").trim();
        if (expr) {
          const [ok, message] = s.subcatchments.validateGwfExpression(expr);
          if (!ok) throw new Error((t === GwfType.LATERAL ? "Lateral" : "Deep") + " flow expression: " + message + ".");
        }
      }
      sub.aquifer = values.aquifer;
      sub.gwNode = values.node;
      sub.setGwParams(...p);
      s.subcatchments.setGwfExpression(id, GwfType.LATERAL, String(values.lateral ?? "").trim());
      s.subcatchments.setGwfExpression(id, GwfType.DEEP, String(values.deep ?? "").trim());
    }
  } else if (key === "inlet" && (kind === "link" || kind === "node")) {
    const usages = s.infrastructure.inletUsages,
      host = kind === "link" ? s.links.get(id) : s.nodes.get(id),
      at = kind === "link" ? usages.findLink(host.index) : usages.findNode(host.index);
    need(kind === "link" ? host.type === LinkType.CONDUIT : host.isInlet, "Inlets are placed on conduits and inlet junctions.");
    if (!values.design) {
      need(kind === "link", "An inlet junction needs an inlet design.");
      if (at >= 0) usages.remove(at);
    } else {
      const design = [...s.infrastructure.inlets].findIndex((d) => same(d, values.design));
      need(design >= 0, "No inlet design " + values.design + ".");
      need(values.capture && s.nodes.has(values.capture), "Choose the node that receives what the inlet captures.");
      const capture = s.nodes.get(values.capture);
      if (kind === "link") need(![host.fromNode.id, host.toNode.id].some((e) => same(e, values.capture)), "The capture node cannot be an end of the conduit itself.");
      else need(!same(values.capture, id), "An inlet junction cannot capture into itself.");
      need(!capture.isVirtual, "The capture node cannot be a virtual or inlet junction.");
      const number = num(values.number, "the number of inlets");
      need(Number.isInteger(number) && number >= 1, "The number of inlets is a whole number of at least 1.");
      const clogged = num(values.clogged, "the percent clogged");
      need(clogged >= 0 && clogged <= 99, "The percent clogged is between 0 and 99.");
      const [flowLimit, depress, width] = [num(values.flowLimit, "the flow restriction"), num(values.depress, "the depression height"), num(values.width, "the depression width")];
      need(flowLimit >= 0 && depress >= 0 && width >= 0, "The flow restriction and local depression cannot be negative.");
      need(InletPlacement[values.placement] !== undefined, "Unknown placement " + values.placement + ".");
      try {
        usages.set(kind === "link" ? 0 : 1, host.index, design, capture.index, { numInlets: number, pctClogged: clogged, flowLimit, localDepress: depress, localWidth: width, placement: InletPlacement[values.placement] });
      } catch (e) {
        // Legacy inlet_validate (inlet.c:498-505), engine error 635.
        if (e.code === 635) throw new Error("Inlet design " + values.design + " does not fit this cross-section: grate, curb, slotted and combination inlets need a street; drop inlets an open rectangular or trapezoidal channel.");
        throw e;
      }
    }
  } else if (key === "quality" && (kind === "node" || kind === "link")) {
    const q = s.initialQuality,
      re = s.reactions,
      isLink = kind === "link",
      index = (isLink ? s.links : s.nodes).get(id).index,
      group = qualityGroup(session, kind, id);
    need(group, "This model has no pollutants, water age, temperature or reaction species.");
    const blank = (v) => v === "" || v === null || v === undefined;
    const given = group.fields.filter((f) => f.name in values);
    for (const f of given) {
      const v = values[f.name];
      if (f.readonly) need(blank(v) ? f.value === "" : Number(v) === f.value, f.label + " comes from the initial-quality file; edit it there.");
      else if (!blank(v)) {
        const x = num(v, f.label);
        if (!f.name.startsWith("q:__")) need(x >= 0, f.label + " cannot be negative.");
      }
    }
    for (const f of given) {
      if (f.readonly) continue;
      const c = f.name.slice(2),
        v = values[f.name];
      if (f.name.startsWith("r:")) {
        const k = [...re.species].findIndex((sp) => sp.name === c),
          i = [...re.initial].findIndex((r) => r.isLink === isLink && r.elemIndex === index && r.speciesIndex === k);
        if (!blank(v)) re.initial.set(isLink, index, c, Number(v));
        else if (i >= 0) re.initial.remove(i);
      } else if (!blank(v)) q.set(c, Number(v), isLink ? { link: id } : { node: id });
      else {
        const i = [...q].findIndex((r) => r.isLink === isLink && r.elemIndex === index && (c.startsWith("__") ? r.constituent === c : same(r.constituent, c)));
        if (i >= 0) q.remove(i);
      }
    }
  } else if (kind === "node" && key === "coupling2d") {
    const g = s.surface2d,
      n = s.nodes.get(id),
      shown = couplingGroup(session, () => "", id),
      blank = (v) => v === "" || v === null || v === undefined;
    need(shown, id + " does not couple to the 2D surface.");
    const types = couplingTypes[NodeType[n.type]],
      type = values.type ?? "";
    // The engine refuses with a bare code; say why as the desktop's choices do.
    need(type === "" || types.includes(type), NodeType[n.type] === "OUTFALL" ? "An outfall couples as an outfall or not at all." : NodeType[n.type] === "STORAGE" ? "A storage unit couples as a manhole, grate, curb or open storage, or not at all." : "A junction or divider couples as a manhole, grate or curb, or not at all.");
    const effective = type || NodeCoupling2DType[g.getNodeCouplingDefaultType(n.index)],
      changed = type !== shown.fields[0].value,
      params = {};
    for (const [key, label, unit, on] of couplingKeys) {
      const v = values["c:" + key];
      if (blank(v) || effective === "NONE") continue;
      // A new structure keeps only what applies to it (the desktop clears the rest); an unchanged one
      // keeps its row as it was.
      if (changed && !on.includes(effective)) continue;
      if (Array.isArray(unit)) {
        need(unit.some(([t]) => t && t === v), label + " is one of " + unit.filter(([t]) => t).map(([, l]) => l.toLowerCase()).join(", ") + ".");
        params[key] = v;
        continue;
      }
      const x = num(v, label);
      if (key === "LID_OPEN_FRACTION") need(x > 0 && x <= 1, "The lid open fraction is above 0 and at most 1.");
      else if (key === "SPREAD" || key === "TAILWATER_RELAX") need(x >= 0, label + " cannot be negative.");
      else need(x > 0, label + " must be above 0.");
      params[key] = x;
    }
    if (type === "" && !Object.keys(params).length) g.resetNodeCoupling(n.index);
    else g.replaceNodeCoupling(n.index, NodeCoupling2DType[effective], params);
  } else if (kind === "subcatchment" && key === "frost") {
    if (values.row !== "own") {
      if (s.frozenGroundRows()[id]) s.removeFrozenGround(id);
    } else {
      s.setFrozenGround(id, frostValues(values, need));
    }
  } else if (kind === "node" && key === "lid") {
    const lids = s.infrastructure.lids;
    need(s.nodes.get(id).type === NodeType.STORAGE, "LIDs are placed on storage units.");
    if (values.restore) lids.replaceNode(id, values.restore); // undo: the node as it was, anchors and offsets too
    else if (!values.control) lids.replaceNode(id, lids.prepareNode(id, null));
    else {
      need(nodeLids(s).some((c) => same(c, values.control)), "No storage-node LID control " + values.control + ".");
      const saturation = num(values.saturation, "the initial saturation");
      need(saturation >= 0 && saturation <= 100, "The initial saturation is between 0 and 100 %.");
      const bottom = bottoms.indexOf(values.bottom);
      need(bottom >= 0, "Unknown bottom " + values.bottom + ".");
      if (values.bottom === "MESH_AQUIFER" && lids.nodeBottom(id) !== "MESH_AQUIFER") need(meshBottomAllowed(s, id), id + " needs an enabled 2D aquifer and a bed under it with a contact area above 0 for a mesh-aquifer bottom.");
      const control = nodeLids(s).find((c) => same(c, values.control));
      lids.replaceNode(id, lids.prepareNode(id, control, { initialSaturation: saturation, bottom }));
    }
  } else if (kind === "link" && key === "lidAnchor") {
    const lids = s.infrastructure.lids,
      end = lidEnd(s, s.links.get(id));
    need(end, "Link " + id + " has no single storage end with a LID.");
    if (values.restore) lids.replaceNode(end, values.restore); // undo: the anchors and offsets as they were
    else {
      const count = lids.getLayers(lids.nodeAssignment(end)[0]).filter((x) => x.kind !== LidNodeLayerKind.BOTTOM).length;
      const layer = Number(values.layer);
      need(Number.isInteger(layer) && layer >= 0 && layer <= count, "Choose a layer of " + end + "'s LID (1 to " + count + ") or none.");
      need(values.position === "TOP" || values.position === "BOTTOM", "Choose the layer's top or bottom.");
      lids.setOutletAnchor(id, layer, { position: values.position });
    }
  } else if (key === "userflags" && flagObject[kind]) {
    const uf = s.userflags,
      writes = [];
    for (const d of session.userFlags()) {
      if (!("flag:" + d.name in values)) continue;
      const v = String(values["flag:" + d.name] ?? "").trim();
      if (!v) {
        writes.push([d.name, null]);
        continue;
      }
      if (d.type === "BOOLEAN") need(/^(YES|NO)$/i.test(v), d.name + " is yes, no or unset.");
      if (d.type === "INTEGER") need(/^[-+]?\d+$/.test(v) && Math.abs(Number(v)) <= 2147483647, d.name + " takes a whole number.");
      if (d.type === "REAL") need(Number.isFinite(Number(v)), d.name + " takes a number.");
      if (d.type === "STRING") need(!/[\r\n"]/.test(v), d.name + " is one line without quotes.");
      writes.push([d.name, v]);
    }
    for (const [name, v] of writes) v === null ? uf.clearValue(flagObject[kind], id, name) : uf.setValue(flagObject[kind], id, name, v);
  } else if (kind === "hydrograph" && /^decay[012]$/.test(key)) {
    const r = Number(key.slice(5)),
      row = decayRow(s, id, r),
      mode = values.mode;
    need(["", "EXP", "EXP_SNOW"].includes(mode), "Choose none, exponential or exponential with snow.");
    if (!mode) {
      if (row) s.inflows.removeRdiiDecay(row.uhName, r);
    } else {
      const p = {};
      for (const k of ["k_dep", "k_0", "k_T", "T_ref", "theta_rec", "T_freeze", "snow_T", "snow_ddf"]) p[k] = num(values[k], k);
      // The engine's checks (swmm_rdii_decay_add): rates and the melt factor are not negative.
      need(p.k_dep >= 0 && p.k_0 >= 0 && p.k_T >= 0, "The rates k_dep, k_0 and k_T cannot be negative.");
      need(p.snow_ddf >= 0, "The melt factor cannot be negative.");
      p.snow_on = mode === "EXP_SNOW";
      if (row) s.inflows.setRdiiDecay(row.uhName, r, p);
      else s.inflows.addRdiiDecay(id, r, p);
    }
  } else if ((kind === "node" || kind === "link") && tableGroupKeys.includes(key)) {
    applyTableGroup(session, kind, id, key, values);
  } else throw new Error("No property group " + key + " for this " + kind + ".");
  return propertyGroups(session, kind, id).find((g) => g.key === key);
}

/** The values of a group as `setGroup` takes them. */
export const groupValues = (group) => Object.fromEntries(group.fields.map((f) => [f.name, f.value]));
/**
 * What puts a group back as it was shown (undo): its values, or — for a group that carries `restore`,
 * the engine's snapshot of a LID node — that snapshot, which gives back depth and offsets exactly.
 */
export const undoValues = (group) => (group.restore ? { restore: group.restore } : groupValues(group));
