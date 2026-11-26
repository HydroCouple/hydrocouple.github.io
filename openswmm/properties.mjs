/**
 * Property groups of map objects that the engine's field catalog has no rows for (interaction phase
 * E3b): a link's cross-section, losses, discharge coefficient and pump curve; an outfall's, storage
 * unit's and divider's parameters; a subcatchment's infiltration and groundwater. Each group is read
 * as `{key, title, fields, note}` — a field `{name, label, unit, type: "number" | "choice" | "text",
 * value, choices: [[value, label]], when: {name, in: [...]}}` shows only while the named field holds one
 * of `in` — and written back whole, checked as legacy SWMM 5.2.4 checks it. The session (model.mjs)
 * owns the engine; these functions take it.
 */
import { NodeType, LinkType, TableType, XSectShape, OutfallType, StorageShape, DividerType, InfilModel, GwfType, WeirView, catalog } from "./vendor/engine/index.js";

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

/** The property groups of a node, link or subcatchment (`session` a ModelSession). */
export function propertyGroups(session, kind, id) {
  const s = session.solver,
    u = (units) => catalog.unitLabel(units, session.unitSystem, session.flowUnits);
  const groups = [];
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
  }
  return groups;
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
  } else throw new Error("No property group " + key + " for this " + kind + ".");
  return propertyGroups(session, kind, id).find((g) => g.key === key);
}

/** The values of a group as `setGroup` takes them (for undo). */
export const groupValues = (group) => Object.fromEntries(group.fields.map((f) => [f.name, f.value]));
