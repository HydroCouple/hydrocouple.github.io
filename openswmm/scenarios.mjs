/**
 * The scenarios dialog: the project's saved scenarios (snapshots of the model), the last sweep's
 * comparison table and a hydrograph overlay. A view only; the app owns the scenarios, the runs
 * and the results.
 */
const COLORS = ["#0071bf", "#f29f38", "#2a9d8f", "#9b5de5", "#e63946", "#6c757d", "#0a1c2e", "#8ab17d"];
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const fmt = (n, digits = 2) =>
  n === null || n === undefined || Number.isNaN(n)
    ? "—"
    : // + 0 turns a rounded -0 into 0
      (Number(Number(n).toFixed(digits)) + 0).toLocaleString(undefined, { maximumFractionDigits: digits });
const clock = (s) =>
  [Math.floor(s / 3600), Math.floor(s / 60) % 60, Math.floor(s) % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");

/** The comparison rows: label and how to read the value from one result. */
const ROWS = [
  ["Run", (r) => (r.stopped ? "Stopped at " + clock(r.seconds) : "Complete")],
  ["Rainfall on the surface (m³)", (r) => fmt(r.balance?.rainfallIn)],
  ["Drained to the network (m³)", (r) => fmt(r.balance?.coupling2dTo1dOut)],
  ["Spilled from the network (m³)", (r) => fmt(r.balance?.coupling1dTo2dIn)],
  ["Out through boundaries (m³)", (r) => fmt(r.balance?.boundaryOut)],
  ["Stored at the end (m³)", (r) => fmt(r.balance?.finalStorage)],
  ["Surface continuity error (%)", (r) => fmt(r.balance?.continuityError, 3)],
  ["Deepest cell (m)", (r) => fmt(r.peakDepth, 3)],
  ["Warnings", (r) => fmt(r.warnings, 0)],
];

/**
 * @param {object} o
 * @param {{name: string, added: string}[]} o.scenarios the project's scenarios
 * @param {{names: string[], results: object[]}|null} o.sweep the last sweep's names and results
 * @param {boolean} o.busy a job is running
 * @param {() => void} o.onAdd snapshot the current model as a new scenario
 * @param {(i: number) => void} o.onRemove
 * @param {(i: number, name: string) => void} o.onRename
 * @param {() => void} o.onRun run every scenario in turn
 * @param {(selection: object|undefined) => Promise<object[]>} o.onSeries one series per result
 */
export function scenarioPanel(o) {
  const box = el("div", { className: "scenarios" });
  const list = el("ol", { className: "scenario-list" });
  o.scenarios.forEach((s, i) => {
    const name = el("input", { type: "text", value: s.name, ariaLabel: "Scenario name" });
    name.onchange = () => o.onRename(i, name.value.trim() || s.name);
    const remove = el("button", { className: "link", type: "button", textContent: "Remove" });
    remove.onclick = () => o.onRemove(i);
    const saved = new Date(s.added).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    list.append(el("li", {}, name, el("span", { className: "hint", textContent: "saved " + saved }), remove));
  });
  const add = el("button", { type: "button", textContent: "Add the current model" });
  add.onclick = o.onAdd;
  const run = el("button", { className: "primary", type: "button", textContent: "Run all scenarios" });
  run.disabled = o.busy || !o.scenarios.length;
  run.onclick = o.onRun;
  box.append(
    el("p", {
      className: "hint",
      textContent:
        "A scenario is a snapshot of the model as it stands: edit it (properties or the INP), then add it here. " +
        "Run all runs them one after another with the current run settings and forcings, and compares them below.",
    }),
    o.scenarios.length ? list : el("p", { className: "hint", textContent: "No scenarios yet." }),
    el("div", { className: "actions" }, add, run),
  );
  if (!o.sweep) return box;

  // The comparison: one column per scenario of the last sweep.
  const { names, results } = o.sweep;
  const head = el("tr", {}, el("th", { textContent: "" }), ...names.map((n, k) => el("th", { textContent: n, style: `color:${COLORS[k % COLORS.length]}` })));
  const body = ROWS.map(([label, read]) => el("tr", {}, el("th", { textContent: label }), ...results.map((r) => el("td", { textContent: read(r) }))));
  box.append(el("h3", { textContent: "Last sweep" }), el("table", { className: "compare" }, el("thead", {}, head), el("tbody", {}, ...body)));

  // The hydrograph overlay: the same node depth or link flow from each scenario's output.
  const select = el("select", { ariaLabel: "Series to compare" });
  const plot = el("canvas", { width: 560, height: 220, className: "overlay" });
  const legend = el("p", { className: "hint" });
  box.append(el("h3", { textContent: "Hydrographs" }), select, plot, legend);
  const draw = (series) => {
    const ctx = plot.getContext("2d");
    ctx.clearRect(0, 0, plot.width, plot.height);
    const all = series.filter((s) => s?.values?.length);
    if (!all.length) {
      legend.textContent = "No network time series in these results.";
      return;
    }
    const lo = Math.min(...all.map((s) => s.values.reduce((a, b) => Math.min(a, b), Infinity)));
    const hi = Math.max(...all.map((s) => s.values.reduce((a, b) => Math.max(a, b), -Infinity)));
    const n = Math.max(...all.map((s) => s.values.length));
    series.forEach((s, k) => {
      if (!s?.values?.length) return;
      ctx.strokeStyle = COLORS[k % COLORS.length];
      ctx.lineWidth = 2;
      ctx.beginPath();
      s.values.forEach((v, i) => {
        const x = 10 + (i * 540) / Math.max(1, n - 1),
          y = 205 - (190 * (v - lo)) / (hi - lo || 1);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.stroke();
    });
    const first = all[0];
    legend.textContent =
      (first.kind === "node" ? "Depth at " : "Discharge in ") + first.id + " · " + fmt(lo, 4) + " to " + fmt(hi, 4) + " " + first.unit +
      " · " + names.map((name, k) => name + (series[k]?.values?.length ? "" : " (no output)")).join(", ");
  };
  const query = async (selection) => {
    legend.textContent = "Reading the scenarios' binary outputs…";
    try {
      const series = await o.onSeries(selection);
      const any = series.find((s) => s?.nodes);
      if (any && !select.options.length)
        for (const [group, ids] of [["node", any.nodes], ["link", any.links]])
          for (const id of ids)
            select.add(new Option((group === "node" ? "Depth · " : "Discharge · ") + id, JSON.stringify({ kind: group, id })));
      draw(series);
    } catch (e) {
      legend.textContent = e.message || String(e);
    }
  };
  select.onchange = () => query(JSON.parse(select.value));
  query();
  return box;
}
