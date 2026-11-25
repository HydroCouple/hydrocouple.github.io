/**
 * Time series plots (interaction phase V2): the plot model the plot panel (plot-view.mjs) draws.
 * A series is one object's variable over the run: `{key, kind, id, type, variable, slot}` with key
 * `kind:id:variable`. Its data comes from the run's binary output (network and system series, read
 * in a worker) or from the 2D frames in memory (cells). Series are grouped into rows, one per kind
 * and variable, so every row has one y-axis. Each series keeps its color slot for its life: color
 * follows the object, never its rank.
 */

/** Variables a series can show, per kind: [engine name, label, unit kind]. */
export const plotVariables = {
  node: [
    ["DEPTH", "Depth", "length"],
    ["HEAD", "Head", "length"],
    ["VOLUME", "Volume", "volume"],
    ["LATERAL_INFLOW", "Lateral inflow", "flow"],
    ["TOTAL_INFLOW", "Total inflow", "flow"],
    ["OVERFLOW", "Flooding", "flow"],
  ],
  link: [
    ["FLOW", "Flow", "flow"],
    ["DEPTH", "Depth", "length"],
    ["VELOCITY", "Velocity", "velocity"],
    ["VOLUME", "Volume", "volume"],
    ["CAPACITY", "Capacity (fraction full)", "fraction"],
  ],
  subcatchment: [
    ["RUNOFF", "Runoff", "flow"],
    ["RAINFALL", "Rainfall", "rainrate"],
    ["INFIL", "Infiltration", "rainrate"],
    ["EVAP", "Evaporation", "evaprate"],
    ["SNOW_DEPTH", "Snow depth", "snow"],
    ["GW_FLOW", "Groundwater flow", "flow"],
    ["GW_ELEV", "Groundwater elevation", "length"],
    ["SOIL_MOIST", "Soil moisture", "fraction"],
  ],
  cell: [
    ["depth", "Water depth", "length"],
    ["speed", "Speed", "velocity"],
  ],
  system: [
    ["RAINFALL", "Rainfall", "rainrate"],
    ["RUNOFF", "Runoff", "flow"],
    ["TOTAL_INFLOW", "Total inflow", "flow"],
    ["FLOODING", "Flooding", "flow"],
    ["OUTFLOW", "Outflow", "flow"],
    ["STORAGE", "Storage", "volume"],
    ["INFIL", "Infiltration", "rainrate"],
    ["EVAP", "Evaporation", "evaprate"],
    ["TEMPERATURE", "Air temperature", "temperature"],
  ],
};
export const kindNames = { node: "Node", link: "Link", subcatchment: "Subcatchment", cell: "2D cell", system: "System" };
/** At most this many series at once: the categorical palette has eight validated colors. */
export const maxSeries = 8;

/** A variable's label and unit kind. */
export function variableOf(kind, variable) {
  const v = (plotVariables[kind] || []).find((x) => x[0] === variable);
  return v ? { label: v[1], unit: v[2] } : { label: variable, unit: "" };
}
/** A unit kind's label in the model's unit system ("US" or "SI") and flow units (CFS, CMS, …). */
export function unitLabel(unit, unitSystem, flowUnits) {
  const si = unitSystem === "SI";
  return (
    {
      length: si ? "m" : "ft",
      volume: si ? "m³" : "ft³",
      flow: flowUnits || (si ? "CMS" : "CFS"),
      velocity: si ? "m/s" : "ft/s",
      rainrate: si ? "mm/hr" : "in/hr",
      evaprate: si ? "mm/day" : "in/day",
      snow: si ? "mm" : "in",
      temperature: si ? "°C" : "°F",
      fraction: "fraction",
    }[unit] ?? ""
  );
}

export class PlotModel extends EventTarget {
  constructor() {
    super();
    this.series = [];
    this.data = new Map();
  }
  /**
   * Add `items` ({kind, id, type?}) with `variable`; one already plotted is skipped. Returns the
   * series added and how many were refused for want of a free color (more than `maxSeries`).
   */
  add(items, variable) {
    const added = [];
    let refused = 0;
    for (const item of items) {
      const key = item.kind + ":" + item.id + ":" + variable;
      if (this.series.some((s) => s.key === key)) continue;
      const used = new Set(this.series.map((s) => s.slot));
      const slot = [...Array(maxSeries).keys()].find((n) => !used.has(n));
      if (slot === undefined) {
        refused++;
        continue;
      }
      const s = { key, kind: item.kind, id: String(item.id), type: item.type, variable, slot };
      this.series.push(s);
      added.push(s);
    }
    if (added.length) this.dispatchEvent(new CustomEvent("change", { detail: { kind: "series", added } }));
    return { added, refused };
  }
  remove(key) {
    const before = this.series.length;
    this.series = this.series.filter((s) => s.key !== key);
    this.data.delete(key);
    if (this.series.length !== before) this.dispatchEvent(new CustomEvent("change", { detail: { kind: "series" } }));
  }
  clear() {
    if (!this.series.length) return;
    this.series = [];
    this.data.clear();
    this.dispatchEvent(new CustomEvent("change", { detail: { kind: "series" } }));
  }
  /** Values of one series: `{seconds, values}` (or `{error}`). */
  setData(key, data) {
    if (!this.series.some((s) => s.key === key)) return;
    this.data.set(key, data);
    this.dispatchEvent(new CustomEvent("change", { detail: { kind: "data", key } }));
  }
  /** Drop every series' values (a new run or model): they are read again. */
  invalidate() {
    if (!this.data.size) return;
    this.data.clear();
    this.dispatchEvent(new CustomEvent("change", { detail: { kind: "data" } }));
  }
  /** Series grouped by kind and variable, in the order first added: one chart row each. */
  get rows() {
    const rows = [];
    for (const s of this.series) {
      let row = rows.find((r) => r.kind === s.kind && r.variable === s.variable);
      if (!row) rows.push((row = { kind: s.kind, variable: s.variable, ...variableOf(s.kind, s.variable), series: [] }));
      row.series.push(s);
    }
    return rows;
  }
}

/** A series' name: "J1 depth", "System runoff". */
export function seriesName(s) {
  const v = variableOf(s.kind, s.variable).label.toLowerCase();
  return (s.kind === "system" ? "System" : s.kind === "cell" ? "Cell " + s.id : s.id) + " " + v;
}

/** Elapsed seconds as h:mm:ss. */
export function elapsed(sec) {
  const s = Math.round(sec),
    h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60);
  return h + ":" + String(m).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
}

/**
 * CSV of every series on one time column (the union of their times; a series without a value at a
 * time leaves its cell empty). `units(s)` gives a series' unit label.
 */
export function toCsv(model, units) {
  const plotted = model.series.filter((s) => model.data.get(s.key)?.values);
  const times = [...new Set(plotted.flatMap((s) => model.data.get(s.key).seconds))].sort((a, b) => a - b);
  const index = plotted.map((s) => {
    const d = model.data.get(s.key);
    return new Map(d.seconds.map((t, i) => [t, d.values[i]]));
  });
  const quote = (t) => (/[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t);
  const head = ["Elapsed (h:mm:ss)", ...plotted.map((s) => quote(seriesName(s) + " (" + units(s) + ")"))].join(",");
  const lines = times.map((t) => [elapsed(t), ...index.map((m) => (m.has(t) ? String(m.get(t)) : ""))].join(","));
  return [head, ...lines].join("\n") + "\n";
}

/** About `count` round tick values covering [lo, hi]. */
export function niceTicks(lo, hi, count = 4) {
  if (!(hi > lo)) {
    const pad = Math.abs(lo) * 0.1 || 1;
    lo -= pad;
    hi += pad;
  }
  const raw = (hi - lo) / count,
    mag = 10 ** Math.floor(Math.log10(raw)),
    step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw);
  const first = Math.floor(lo / step) * step,
    ticks = [];
  for (let v = first; v <= hi + step * 1e-9; v += step) ticks.push(+v.toPrecision(12));
  if (ticks[ticks.length - 1] < hi) ticks.push(+(ticks[ticks.length - 1] + step).toPrecision(12));
  return ticks;
}
