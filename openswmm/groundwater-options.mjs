/**
 * The 2D groundwater option cards (interaction phase E3d-2c): [2D_AQUIFER_OPTIONS] (with GW_ET, link
 * seepage and wilting suction set together) and [GW_TRANSPORT_OPTIONS], as the desktop's 2D groundwater
 * dialog groups them. The engine checks tokens; the cards keep the desktop's ranges and write only
 * these keys. The tables are generated from the desktop dialog (workplans/openswmm-viz/v6/
 * gen-groundwater-options.mjs; every token checked against the engine).
 */
const aquiferGroups = [
  {
    title: "Options",
    fields: [
      {"key":"SOIL_CHAR","label":"Soil law","type":"choice","choices":[["RUSSO","RUSSO"],["GARDNER","GARDNER"],["BROOKS_COREY","BROOKS_COREY"],["VAN_GENUCHTEN","VAN_GENUCHTEN"]]},
      {"key":"CLOSURE","label":"Closure","type":"choice","choices":[["AUTO","AUTO"],["CLOSED_FORM","CLOSED_FORM"],["ENSLAVED","ENSLAVED"],["SIGMA","SIGMA"]]},
      {"key":"M_LAYERS","label":"σ layers","type":"number","min":2,"max":128},
      {"key":"CAPILLARY_DIFF","label":"Capillary flow in the column","type":"check","check":["YES","NO"]},
      {"key":"C_GW","label":"Saturated safety factor","type":"number","min":0.01,"max":1},
      {"key":"C_COL","label":"Column safety factor","type":"number","min":0.01,"max":1},
      {"key":"FORCE_CLOSED_FORM","label":"Keep the closed form even when AUTO would switch to σ","type":"check","check":["YES","NO"]},
      {"key":"DUNNE","label":"Return saturation excess to the surface (Dunne)","type":"check","check":["YES","NO"]},
      {"key":"MODE","label":"Mode","type":"choice","choices":[["MESH","MESH"],["PER_SUBCATCH","PER_SUBCATCH"]]},
      {"key":"GW_ET","label":"Groundwater ET","type":"choice","choices":[["AUTO","Automatic"],["NONE","None"],["CAPILLARY_RISE","Capillary rise"],["BOUNDARY_ET","Boundary ET"],["BOTH","Both"]]},
      {"key":"NODE_ENROLMENT","label":"Node enrollment","type":"choice","choices":[["AUTO","Automatic"],["ROWS","Node Beds rows only"]]},
    ],
  },
  {
    title: "Groundwater time stepping",
    fields: [
      {"key":"GW_CLOCK","label":"Time stepping","type":"choice","choices":[["SHARED","Shared with surface"],["INDEPENDENT","Independent (experimental)"]]},
      {"key":"GW_BASE_STEP","label":"Base interval","type":"number","min":1e-9,"max":1000000000,"unit":"s","when":["GW_CLOCK",["INDEPENDENT"]],"blank":"AUTO"},
      {"key":"GW_MAX_STEP","label":"Maximum groundwater step","type":"number","min":1e-9,"max":1000000000,"unit":"s","when":["GW_CLOCK",["INDEPENDENT"]]},
      {"key":"GW_BUDGET_FRACTION","label":"Storage budget fraction","type":"number","min":1e-9,"max":1,"when":["GW_CLOCK",["INDEPENDENT"]]},
      {"key":"GW_HEAD_TOLERANCE","label":"Relative head-change budget","type":"number","min":1e-9,"max":0.999999999,"when":["GW_CLOCK",["INDEPENDENT"]]},
      {"key":"GW_BINDS_SURFACE_DT","label":"Also let groundwater stability limit the surface step","type":"check","check":["YES","NO"],"when":["GW_CLOCK",["INDEPENDENT"]]},
    ],
  },
  {
    title: "Process options",
    fields: [
      {"key":"LINK_SEEPAGE","label":"Link seepage","type":"choice","choices":[["DEFAULT","Automatic (Two way with an active mesh aquifer)"],["ONE_WAY","One way"],["TWO_WAY","Two way"],["NONE","Off"]]},
      {"key":"WILTING_SUCTION","label":"Wilting suction","type":"number","min":1e-9,"max":1000000000,"unit":{"US":"ft","SI":"m"},"when":["GW_ET",["BOUNDARY_ET","BOTH","AUTO"]],"blank":"AUTO"},
    ],
  },
];
const transportGroups = [
  {
    title: "Transport",
    fields: [
      {"key":"TRANSPORT_POLLUTANTS","label":"Carry pollutants","type":"check","check":["YES","NO"]},
      {"key":"TRANSPORT_MSX","label":"Carry reaction species","type":"check","check":["YES","NO"]},
      {"key":"TRANSPORT_AGE","label":"Carry water age","type":"check","check":["YES","NO"]},
      {"key":"TRANSPORT_TEMPERATURE","label":"Carry temperature","type":"check","check":["YES","NO"]},
      {"key":"DISPERSION","label":"Solute dispersion","type":"check","check":["YES","NO"]},
      {"key":"UNSAT_TRANSPORT","label":"Unsaturated chemistry","type":"choice","choices":[["BULK","Well-mixed column"],["LAYERED","Separate soil layers"]]},
      {"key":"C_DIFF","label":"Diffusion safety factor","type":"number","min":0.000001,"max":1},
    ],
  },
  {
    title: "Porous soil heat and conduction",
    fields: [
      {"key":"THERMAL_MODEL","label":"Soil heat model","type":"choice","choices":[["WATER_ONLY","Water temperature only"],["POROUS_EQUILIBRIUM","Porous soil heat storage"]]},
      {"key":"CONDUCTION","label":"Vertical soil conduction","type":"choice","choices":[["NO","Off"],["YES","On"]],"when":["THERMAL_MODEL",["POROUS_EQUILIBRIUM"]]},
      {"key":"THERMAL_MIXING","label":"Conductivity mixing","type":"choice","choices":[["ARITHMETIC","Arithmetic"],["GEOMETRIC","Geometric"]],"when":["THERMAL_MODEL",["POROUS_EQUILIBRIUM"]]},
      {"key":"LATERAL_CONDUCTION","label":"Enable lateral conduction between saturated cells","type":"check","check":["YES","NO"],"when":["THERMAL_MODEL",["POROUS_EQUILIBRIUM"]]},
      {"key":"SOIL_ET_HEAT","label":"Soil ET heat treatment","type":"choice","choices":[["LATENT_SURFACE","Latent heat at surface"],["SENSIBLE_ONLY","Sensible energy only"]],"when":["THERMAL_MODEL",["POROUS_EQUILIBRIUM"]]},
      {"key":"THERMAL_LAYERS","label":"Vertical thermal resolution","type":"number","min":1,"max":128,"when":["THERMAL_MODEL",["POROUS_EQUILIBRIUM"]]},
      {"key":"THERMAL_MAX_STEP","label":"Maximum thermal step","type":"number","min":0.000001,"max":1000000000,"unit":"s","when":["THERMAL_MODEL",["POROUS_EQUILIBRIUM"]]},
      {"key":"WATER_THERMAL_CONDUCTIVITY","label":"Water thermal conductivity","type":"number","min":1e-9,"max":1000000,"unit":"W/m/K","when":["THERMAL_MODEL",["POROUS_EQUILIBRIUM"]]},
      {"key":"AIR_THERMAL_CONDUCTIVITY","label":"Air thermal conductivity","type":"number","min":1e-9,"max":1000000,"unit":"W/m/K","when":["THERMAL_MODEL",["POROUS_EQUILIBRIUM"]]},
      {"key":"SURFACE_THERMAL_RESISTANCE","label":"Surface thermal resistance","type":"number","min":1e-9,"max":1000000000000,"unit":"m² K/W","when":["THERMAL_MODEL",["POROUS_EQUILIBRIUM"]]},
      {"key":"SURFACE_THERMAL_BC","label":"Surface boundary","type":"text","when":["THERMAL_MODEL",["POROUS_EQUILIBRIUM"]]},
      {"key":"DEEP_THERMAL_BC","label":"Deep boundary","type":"text","when":["THERMAL_MODEL",["POROUS_EQUILIBRIUM"]]},
    ],
  },
];

/** The cards of the aquifer (`gw2d`) or groundwater-transport (`gwtransport2d`) options. */
const PROCESS = ["GW_ET", "LINK_SEEPAGE", "WILTING_SUCTION"];
function cardSpecs(kind) {
  if (kind === "gwtransport2d") return transportGroups.map((g) => ({ ...g, store: "transport" }));
  // GW_ET, link seepage and wilting suction are set together by the engine: one card.
  const all = aquiferGroups.flatMap((g) => g.fields);
  return [
    ...aquiferGroups.map((g) => ({ ...g, fields: g.fields.filter((f) => !PROCESS.includes(f.key)), store: "aquifer" })).filter((g) => g.fields.length),
    { title: "Groundwater processes", fields: PROCESS.map((k) => all.find((f) => f.key === k)), store: "process" },
  ];
}
const unitOf = (session, u) => (u && typeof u === "object" ? u[session.unitSystem === 0 ? "US" : "SI"] : u);

/** The option cards (sections.mjs shape); a note for a model without a mesh. */
export function groundwaterGroups(session, kind) {
  if (!session.cells?.mannings?.length) return [{ key: kind + "-none", title: kind === "gw2d" ? "2D groundwater" : "2D groundwater transport", fields: [], note: "This model has no 2D surface." }];
  const g = session.solver.groundwater2d,
    get = (store, key) => (store === "transport" ? g.transport.options.get(key) : g.options.get(key));
  return cardSpecs(kind).map((c, i) => ({
    key: (kind === "gw2d" ? "gw-" : "gwtr-") + i,
    title: c.title,
    fields: c.fields.map((f) => {
      const raw = String(get(c.store, f.key) ?? ""),
        base = { name: f.key, label: f.label, unit: unitOf(session, f.unit), when: f.when ? { name: f.when[0], in: f.when[1] } : undefined };
      if (f.type === "number") return { ...base, type: "number", value: f.blank && (raw.toUpperCase() === f.blank || raw === "") ? "" : Number(raw) };
      if (f.type === "choice") return { ...base, type: "choice", value: raw.toUpperCase(), choices: f.choices };
      if (f.type === "check") return { ...base, type: "check", value: raw.toUpperCase() === f.check[0] ? "YES" : "NO" };
      return { ...base, type: "text", value: raw };
    }),
    note:
      c.store === "process"
        ? "Set together, as the engine does; a blank wilting suction is automatic (150 m)."
        : c.title.startsWith("Groundwater time") || /time stepping/i.test(c.title)
          ? "A blank base interval is automatic. With a shared clock the surface step governs."
          : /heat/i.test(c.title)
            ? "The surface and deep boundaries are a kind and its argument as the deck writes them (e.g. AIR, FIXED 12, GEOTHERMAL_FLUX 0.065); the engine checks them."
            : undefined,
  }));
}

/** Check one card as the desktop does and write its keys (and only those). */
export function applyGroundwater(session, kind, key, values) {
  const need = (cond, message) => {
    if (!cond) throw new Error(message);
  };
  need(session.cells?.mannings?.length, "This model has no 2D surface.");
  const c = cardSpecs(kind)[Number(String(key).replace(/^gw(tr)?-/, ""))];
  need(c, "No groundwater card " + key + ".");
  const g = session.solver.groundwater2d,
    writes = [];
  for (const f of c.fields) {
    if (!(f.key in values)) continue;
    const v = values[f.key];
    if (f.type === "number") {
      if ((v === "" || v === null) && f.blank) {
        writes.push([f.key, f.blank]);
        continue;
      }
      const n = Number(v);
      need(v !== "" && v !== null && Number.isFinite(n), "Enter a number for " + f.label.toLowerCase() + ".");
      need(f.min === undefined || n >= f.min, f.label + " must be at least " + f.min + ".");
      need(f.max === undefined || n <= f.max, f.label + " must be at most " + f.max + ".");
      writes.push([f.key, String(n)]);
    } else if (f.type === "choice") {
      need(f.choices.some(([t]) => t === v), "Choose the " + f.label.toLowerCase() + ".");
      writes.push([f.key, v]);
    } else if (f.type === "check") writes.push([f.key, v === "YES" ? f.check[0] : f.check[1]]);
    else {
      const t = String(v ?? "").trim().toUpperCase();
      need(t && !/[\r\n"]/.test(t), f.label + " needs a kind (and its argument), on one line.");
      writes.push([f.key, t]);
    }
  }
  const now = (k) => writes.find(([w]) => w === k)?.[1];
  // Layered unsaturated chemistry needs the sigma closure (the desktop's rule).
  if (now("UNSAT_TRANSPORT") === "LAYERED") need(g.options.get("CLOSURE").toUpperCase() === "SIGMA", "Layered unsaturated chemistry needs the SIGMA closure (2D groundwater options).");
  const fail = (k, value, e) => new Error((c.fields.find((f) => f.key === k)?.label || k) + ": the engine refused " + JSON.stringify(value) + " (" + e.message + ").");
  if (c.store === "process") {
    const et = now("GW_ET") ?? g.options.get("GW_ET"),
      link = now("LINK_SEEPAGE") ?? g.options.get("LINK_SEEPAGE"),
      wilting = now("WILTING_SUCTION") ?? g.options.get("WILTING_SUCTION");
    try {
      g.options.setProcessOptions({ et, link, wilting });
    } catch (e) {
      throw fail("GW_ET", [et, link, wilting].join(" / "), e);
    }
  } else
    for (const [k, value] of writes)
      try {
        (c.store === "transport" ? g.transport.options : g.options).set(k, value);
      } catch (e) {
        throw fail(k, value, e);
      }
  return groundwaterGroups(session, kind).find((x) => x.key === key);
}
