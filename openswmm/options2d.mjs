/**
 * The [2D_OPTIONS] cards (interaction phase E3d-1): the desktop's 2D page (openswmm.gui twodpage.cpp),
 * one card per group, read and written through the engine (`solver.options.ext`). The engine refuses a
 * bad choice but takes any number and keeps an unknown key in [OPTIONS], so only these keys are written
 * and every number keeps the desktop's range. The table below is generated from the desktop page
 * (workplans/openswmm-viz/v6/gen-options2d.mjs; every choice token checked against the engine parser).
 */
const groups = [
  {
    title: "Time stepping",
    fields: [
      {"key":"MAX_TIMESTEP","label":"Max timestep","type":"number","min":0.001,"max":3600,"unit":"s"},
    ],
  },
  {
    title: "Explicit marcher",
    fields: [
      {"key":"THETA","label":"Momentum θ","type":"number","min":0.05,"max":1},
      {"key":"THETA_REFERENCE_STEP","label":"Smoothing reference interval","type":"number","min":0,"max":3600,"unit":"s"},
      {"key":"CFL_NUMBER","label":"CFL number","type":"number","min":0.05,"max":1},
      {"key":"LTS_TIERS","label":"LTS tiers","type":"number","min":1,"max":8,"int":true},
      {"key":"H_MOVE","label":"Movement threshold","type":"number","min":0,"max":1,"unit":"m"},
      {"key":"MOMENTUM_EQUATION","label":"Momentum equation","type":"choice","choices":[["LOCAL_INERTIAL","Local inertial"],["FULL_SWE","Full shallow-water (HLLC, shock capturing; default)"],["DIFFUSIVE_WAVE","Diffusive wave"]]},
      {"key":"RECONSTRUCTION_ORDER","label":"Reconstruction order","type":"number","min":1,"max":2,"int":true},
      {"key":"FRONT_REBUILD","label":"Wet-front rebuild","type":"choice","choices":[["AUTO","Automatic"],["YES","Yes"],["NO","No"]]},
      {"key":"HEAT_SURFACE_EXCHANGE","label":"Surface heat exchange","type":"choice","choices":[["AUTO","Automatic"],["YES","Yes"],["NO","No"]]},
      {"key":"HEAT_RADIATIVE_EXCHANGE","label":"Radiative heat exchange","type":"choice","choices":[["AUTO","Automatic"],["YES","Yes"],["NO","No"]]},
      {"key":"FROUDE_MAX","label":"Max Froude number","type":"number","min":0.1,"max":5},
      {"key":"ADVECTION","label":"Convective momentum flux (ADVECTION)","type":"check","check":["YES","NO"],"when":["MOMENTUM_EQUATION",["LOCAL_INERTIAL"]]},
    ],
  },
  {
    title: "Optional momentum physics",
    fields: [
      {"key":"CORIOLIS","label":"Coriolis effect","type":"choice","choices":[["OFF","Off"],["LATITUDE","From latitude"],["CONSTANT_F","Specified parameter (advanced)"]]},
      {"key":"CORIOLIS_LATITUDE","label":"Latitude (degrees north)","type":"number","min":-90,"max":90,"when":["CORIOLIS",["LATITUDE"]],"blank":"UNSET"},
      {"key":"CORIOLIS_F","label":"Coriolis parameter (1/s)","type":"number","when":["CORIOLIS",["CONSTANT_F"]],"blank":"UNSET"},
      {"key":"TURBULENCE_MODEL","label":"Horizontal turbulent mixing","type":"choice","choices":[["NONE","Off"],["SMAGORINSKY","Smagorinsky"],["MIXING_LENGTH","Mixing length (depth)"]]},
      {"key":"SMAGORINSKY_CS","label":"Smagorinsky coefficient Cs","type":"number","min":0,"when":["TURBULENCE_MODEL",["SMAGORINSKY"]]},
      {"key":"MIXING_LENGTH_COEFFICIENT","label":"Mixing-length coefficient c","type":"number","min":0,"when":["TURBULENCE_MODEL",["MIXING_LENGTH"]]},
      {"key":"EDDY_VISCOSITY_BACKGROUND","label":"Background eddy viscosity (m²/s)","type":"number","min":0,"when":["TURBULENCE_MODEL",["SMAGORINSKY","MIXING_LENGTH"]]},
    ],
  },
  {
    title: "Depth thresholds",
    fields: [
      {"key":"DRY_DEPTH","label":"Dry depth threshold","type":"number","min":0,"max":1,"unit":"m"},
      {"key":"LIMITER_EPSILON","label":"Limiter epsilon","type":"number","min":0,"max":1},
      {"key":"FLUX_DH_EPS","label":"Flux head epsilon","type":"number","min":0,"max":1,"unit":"m"},
    ],
  },
  {
    title: "Cell closure",
    fields: [
      {"key":"CELL_CLOSURE","label":"Cell closure","type":"choice","choices":[["FLAT","Flat (η = z̄ + V/A, legacy)"],["VFR","VFR (planar-bed volume/free-surface)"]]},
      {"key":"FACE_RECONSTRUCTION","label":"Face reconstruction","type":"choice","choices":[["MEAN","Mean (upwind cell depth, legacy)"],["VFR_FACE","VFR face (edge depth + wetting gate)"]]},
      {"key":"VFR_MIN_WET_FRAC","label":"VFR min wet fraction","type":"number","min":0.0001,"max":0.5},
    ],
  },
  {
    title: "1D ↔ 2D coupling",
    fields: [
      {"key":"COUPLING_CD","label":"Coupling Cd","type":"number","min":0,"max":1},
      {"key":"COUPLING_LAW","label":"Exchange law","type":"choice","choices":[["ORIFICE","Orifice (legacy)"],["WEIR_ORIFICE","Weir / orifice (regime-aware)"]]},
      {"key":"COUPLING_COEFFS","label":"Coefficients","type":"choice","choices":[["DEFAULT","Default (continuous)"],["RUBINATO2017","Rubinato et al. 2017"],["RUBINATO2017_LOWER","Rubinato et al. 2017 — lower"],["RUBINATO2017_UPPER","Rubinato et al. 2017 — upper"]]},
      {"key":"COUPLING_HEAD","label":"Surface head","type":"choice","choices":[["CELL","Coupling cell (legacy)"],["VERTEX","Cells around the vertex"],["STENCIL_WET_MEAN","Wet mean over the structure area"]]},
      {"key":"COUPLING_POND_MODE","label":"Junction pond","type":"choice","choices":[["FOOTPRINT","Cell footprint (legacy)"],["CHAMBER","Chamber only"],["TRACKING","Tracking the wet footprint"]]},
      {"key":"COUPLING_POND_RELAX","label":"Pond relaxation","type":"number","min":0,"max":3600,"unit":"s"},
      {"key":"COUPLING_RIM_BAND","label":"Rim band","type":"number","min":-0.001,"max":1,"unit":"m","blank":"DEFAULT"},
      {"key":"COUPLING_EQUALIZE","label":"Head equalization","type":"choice","choices":[["DEFAULT","Default (on)"],["YES","On"],["NO","Off"]]},
      {"key":"COUPLING_SYNC","label":"Exchange interval","type":"number","min":0,"max":60,"unit":"s"},
      {"key":"COUPLING_AREA","label":"Derive exchange areas automatically (COUPLING_AREA AUTO)","type":"check","check":["AUTO","DEFAULT"]},
      {"key":"COUPLING_IN_FLOODING","label":"Book 1D-to-2D spill as node flooding (COUPLING_IN_FLOODING)","type":"check","check":["YES","NO"]},
    ],
  },
  {
    title: "Processes",
    fields: [
      {"key":"RAINFALL_MODE","label":"Rainfall mode","type":"choice","choices":[["NATURAL_NEIGHBOUR","Natural neighbor (all gages)"],["NEAREST_NEIGHBOUR","Nearest neighbor (closest gage)"],["SYSTEM","System (uniform gage mean)"],["NONE","None (no direct rainfall)"]]},
      {"key":"INFILTRATION","label":"Infiltration","type":"choice","choices":[["AUTO","Automatic (on when per-cell rows exist)"],["YES","On"],["NO","Off (keep rows, run without infiltration)"]]},
      {"key":"INFIL_STEP","label":"Infiltration step","type":"time"},
      {"key":"INFIL_DEFAULT_METHOD","label":"Default method","type":"choice","choices":[["NONE","None (no mesh-wide default)"],["HORTON","Horton"],["MOD_HORTON","Modified Horton"],["GREEN_AMPT","Green-Ampt"],["MOD_GREEN_AMPT","Modified Green-Ampt"],["CURVE_NUMBER","Curve Number"],["CONSTANT","Constant rate"]]},
      {"key":"INFIL_DESTINATION","label":"Destination","type":"choice","choices":[["LOST","Lost (leaves the model)"],["SUBCATCH_AQUIFER","Subcatchment aquifer (containing subcatchment)"],["AQUIFER_2D","Obsolete 2D destination — review ownership migration"]]},
      {"key":"EVAPORATION","label":"Evaporation","type":"choice","choices":[["YES","Forced only (API / control forcing)"],["CLIMATE","Project climate rate ([EVAPORATION]) on unforced cells"],["NO","Off"]]},
      {"key":"TRANSPORT_POLLUTANTS","label":"Pollutants","type":"check","check":["YES","NO"]},
      {"key":"TRANSPORT_MSX","label":"MSX species","type":"check","check":["YES","NO"]},
      {"key":"TRANSPORT_AGE","label":"Water age","type":"check","check":["YES","NO"]},
      {"key":"TRANSPORT_TEMPERATURE","label":"Temperature","type":"check","check":["YES","NO"]},
    ],
  },
  {
    title: "Groundwater",
    fields: [
      {"key":"GROUNDWATER","label":"Subsurface","type":"choice","choices":[["AUTO","Automatic (on when aquifer rows exist)"],["YES","On"],["NO","Off (keep rows, run without groundwater)"]]},
      {"key":"GW_ET","label":"Evapotranspiration","type":"choice","choices":[["AUTO","Automatic (depends on aquifer mode)"],["NONE","None"],["CAPILLARY_RISE","Capillary rise (from the water table)"],["BOUNDARY_ET","Boundary ET (from the unsaturated column)"],["BOTH","Both"]],"when":["GROUNDWATER",["AUTO","YES"]]},
    ],
  },
  {
    title: "2D results",
    fields: [
      {"key":"REPORT_2D","label":"Write 2D results to output (REPORT_2D)","type":"check","check":["YES","NO"]},
      {"key":"OUTPUT_FILE","label":"2D results file","type":"text"},
      {"key":"OUTPUT_PRECISION","label":"Precision","type":"choice","choices":[["FLOAT32","Single (float32, half the size)"],["FLOAT64","Double (float64, bit-exact)"]]},
      {"key":"OUTPUT_COMPRESSION","label":"Compression","type":"number","min":0,"max":9,"int":true},
      {"key":"REPORT_2D_STEP","label":"2D report step","type":"time"},
      {"key":"REPORT_2D_VARIABLES","label":"Variables","type":"list","choices":[["DEPTH","Depth & head (per cell)"],["VELOCITY","Velocity (per cell)"],["EDGE_FLUX","Edge fluxes (per edge)"],["NODE_HEAD","Vertex head & depth (per vertex)"],["SPECIES","Water quality (per cell × species)"],["RAINFALL","Rainfall (per cell)"],["INFILTRATION","Infiltration (per cell)"],["COUPLING","1D↔2D exchange (per cell)"],["GRADIENTS","Reconstruction gradients (diagnostic)"],["CONTINUITY","Continuity error (diagnostic)"],["ENVELOPES","Run statistics (once per run)"],["BUILDUP","BUILDUP"],["GROUNDWATER","GROUNDWATER"],["GW_DETAILED","GW_DETAILED"],["HEAT","HEAT"],["TURBULENCE","Turbulent viscosity and strain"]]},
      {"key":"REPORT_2D_SPECIES","label":"Species","type":"list","blank":"ALL"},
    ],
  },
  {
    title: "Compute backend",
    fields: [
      {"key":"BACKEND","label":"2D surface","type":"choice","choices":[["AUTO","Auto (CPU in GUI)"],["CPU","CPU (built-in marcher)"],["OMP","OpenMP (Kokkos)"],["CUDA","CUDA (experimental)"],["HIP","HIP (experimental)"],["SYCL","SYCL (experimental)"],["METAL","Apple GPU (Metal face flux)"],["WEBGPU","WebGPU (browser GPU)"]]},
    ],
  },
];

/** The result variables the engine knows for REPORT_2D_VARIABLES (besides DEFAULT). */
const variables = groups.flatMap((g) => g.fields).find((f) => f.key === "REPORT_2D_VARIABLES").choices.map(([t]) => t);
const notes = {
  "Optional momentum physics": "As the desktop: Coriolis and turbulence need full shallow-water equations and one timestep tier (Explicit marcher), and run on the CPU. A blank latitude or parameter is unset.",
  "1D ↔ 2D coupling": "A blank rim band is the pond default; a Cd or relaxation of 0 is the engine's default.",
  Processes: "An infiltration step of 0 (HH:MM:SS) is the wet-weather step. Per-cell infiltration and snow are set on the cells.",
  Groundwater: "Link seepage and wilting suction are 2D aquifer settings.",
  "2D results": "Steps are HH:MM:SS (0 is the report step). Variables: DEFAULT or names separated by spaces; species: ALL or names. A blank file name is the model's name with .2d.h5.",
  "Compute backend": "The browser's run uses its CPU marcher, or WebGPU when the GPU is on in Run settings; this deck value is what the desktop uses.",
};
const tokens = (v) => String(v ?? "").toUpperCase().split(/[\s,]+/).filter(Boolean);

/** The 2D options cards of a model with a mesh (one per desktop group); a note otherwise. */
export function options2dGroups(session) {
  if (!session.cells?.mannings?.length) return [{ key: "2d-none", title: "2D options", fields: [], note: "This model has no 2D surface ([2D_TRIANGLES] / [2D_QUADS] or a [2D_MESH_FILE])." }];
  const ext = session.solver.options.ext;
  return groups.map((g, i) => ({
    key: "2d-" + i,
    title: g.title,
    fields: g.fields.map((f) => {
      const raw = ext.get(f.key),
        when = f.when ? { name: f.when[0], in: f.when[1] } : undefined;
      const base = { name: f.key, label: f.label, unit: f.unit, when, readonly: f.key === "BACKEND" };
      if (f.type === "number") return { ...base, type: "number", value: f.blank && (raw === f.blank || raw === "") ? "" : Number(raw) };
      if (f.type === "choice") return { ...base, type: "choice", value: raw, choices: f.choices.filter(([t]) => t !== "AQUIFER_2D" || raw === "AQUIFER_2D") };
      if (f.type === "check") return { ...base, type: "check", value: raw === f.check[0] ? "YES" : "NO" };
      return { ...base, type: "text", value: f.blank && raw === f.blank ? "" : raw };
    }),
    ...(notes[g.title] ? { note: notes[g.title] } : {}),
  }));
}

/** Check one card as the desktop does and write its keys (and only its keys). */
export function applyOptions2d(session, key, values) {
  const need = (cond, message) => {
    if (!cond) throw new Error(message);
  };
  const g = groups[Number(String(key).replace(/^2d-/, ""))];
  need(g && session.cells?.mannings?.length, "This model has no 2D surface.");
  const ext = session.solver.options.ext,
    writes = [];
  for (const f of g.fields) {
    if (!(f.key in values) || f.key === "BACKEND") continue;
    const v = values[f.key];
    if (f.type === "number") {
      if ((v === "" || v === null) && f.blank) {
        writes.push([f.key, f.blank]);
        continue;
      }
      const n = Number(v),
        lo = f.blank && f.min < 0 ? 0 : f.min;
      need(v !== "" && v !== null && Number.isFinite(n), "Enter a number for " + f.label.toLowerCase() + ".");
      need(lo === undefined || n >= lo, f.label + " must be at least " + lo + ".");
      need(f.max === undefined || n <= f.max, f.label + " must be at most " + f.max + ".");
      need(!f.int || Number.isInteger(n), f.label + " is a whole number.");
      writes.push([f.key, String(n)]);
    } else if (f.type === "choice") {
      need(f.choices.some(([t]) => t === v), "Choose the " + f.label.toLowerCase() + ".");
      writes.push([f.key, v]);
    } else if (f.type === "check") writes.push([f.key, v === "YES" ? f.check[0] : f.check[1]]);
    else if (f.type === "time") {
      const t = String(v ?? "").trim();
      need(/^\d+(\.\d+)?$/.test(t) || /^\d+:\d{2}(:\d{2}(\.\d+)?)?$/.test(t), f.label + " is HH:MM:SS (or seconds).");
      writes.push([f.key, t]);
    } else if (f.key === "REPORT_2D_VARIABLES") {
      const list = tokens(v);
      need(list.length, "Name the 2D result variables, or DEFAULT.");
      const unknown = list.filter((t) => t !== "DEFAULT" && !variables.includes(t));
      need(!unknown.length, "Unknown 2D result variable" + (unknown.length > 1 ? "s " : " ") + unknown.join(", ") + " (known: DEFAULT, " + variables.join(", ") + ").");
      need(!list.includes("DEFAULT") || list.length === 1, "DEFAULT stands alone.");
      writes.push([f.key, list.join(" ")]);
    } else {
      const t = String(v ?? "").trim();
      need(!/["\r\n]/.test(t), f.label + " cannot hold quotes or line breaks.");
      writes.push([f.key, t || f.blank || ""]);
    }
  }
  // Coriolis and turbulence need full shallow-water equations and one tier (twodpage.cpp:1176-1179),
  // whichever card changes one side of it.
  const now = (k) => writes.find(([w]) => w === k)?.[1] ?? ext.get(k);
  if (now("CORIOLIS") !== "OFF" || now("TURBULENCE_MODEL") !== "NONE")
    need(now("MOMENTUM_EQUATION") === "FULL_SWE" && Number(now("LTS_TIERS")) === 1, "Coriolis and turbulence closures require full shallow-water equations and one timestep tier.");
  for (const [k, v] of writes)
    try {
      ext.set(k, v);
    } catch (e) {
      throw new Error((g.fields.find((f) => f.key === k)?.label || k) + ": the engine refused " + JSON.stringify(v) + " (" + e.message + ").");
    }
  return options2dGroups(session).find((c) => c.key === key);
}
