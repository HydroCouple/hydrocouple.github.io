/**
 * Climate views (E2 increment 4): the model's temperature source, evaporation, wind speed,
 * snowmelt, areal depletion and monthly adjustments in one tabbed dialog, and the lines of the
 * climate card. Views only: the model session (model.mjs) checks and stores the values; the editor
 * (editor.mjs) wires the dialog.
 */
import { evapTypes } from "./model.mjs";

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const text = (v) => (v === null || v === undefined ? "" : String(v));
export const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const evapNames = { CONSTANT: "Constant", MONTHLY: "Monthly averages", TIMESERIES: "Time series", TEMPERATURE: "From temperatures", FILE: "From the climate file" };
/** Units of the climate values in the model's unit system. */
export function climateUnits(unitSystem) {
  const si = unitSystem === "SI";
  return { temp: si ? "°C" : "°F", evap: si ? "mm/d" : "in/d", wind: si ? "km/h" : "mph", length: si ? "m" : "ft" };
}
const fmt = (x) => String(+Number(x).toPrecision(6));
/** Lines for the climate card. */
export function describeClimate(c, unitSystem) {
  const u = climateUnits(unitSystem);
  const t = c.temperature,
    e = c.evaporation;
  const temperature =
    t.source === "TIMESERIES" ? "Air temperature: time series " + t.series + "." : t.source === "FILE" ? "Air temperature: climate file " + (t.file || "(unnamed)") + "." : "No air temperature data.";
  let evaporation = "Evaporation: " + evapNames[e.type].toLowerCase();
  if (e.type === "CONSTANT") evaporation += " " + fmt(e.monthly[0]) + " " + u.evap;
  else if (e.type === "MONTHLY") evaporation += " " + fmt(Math.min(...e.monthly)) + "–" + fmt(Math.max(...e.monthly)) + " " + u.evap;
  else if (e.type === "TIMESERIES") evaporation += " " + e.series;
  evaporation += (e.dryOnly ? ", dry periods only" : "") + (e.recovery ? ", recovery pattern " + e.recovery : "") + ".";
  const adjusted = Object.entries({ temperature: 0, evaporation: 0, rainfall: 1, conductivity: 1 })
    .filter(([k, base]) => c.adjustments[k].some((x) => x !== base))
    .map(([k]) => k);
  return [temperature, evaporation, adjusted.length ? "Monthly adjustments: " + adjusted.join(", ") + "." : "No monthly adjustments."];
}

const field = (caption, input, unit) =>
  el("label", { className: "prop" }, el("span", { textContent: caption + (unit ? " (" + unit + ")" : "") }), input);
function select(entries, value, label) {
  const s = el("select", { ariaLabel: label });
  for (const [v, name] of entries) s.add(new Option(name, v));
  s.value = value;
  return s;
}
/** A text box bound to `obj[key]`. */
function box(obj, key, label) {
  const input = el("input", { value: text(obj[key]), inputMode: "decimal", ariaLabel: label });
  input.oninput = () => (obj[key] = input.value);
  return input;
}
/** Twelve monthly values (or ten depletion values) as a compact grid of labeled boxes. */
function grid(values, labels, aria) {
  return el(
    "div",
    { className: "month-grid" + (values.length === 10 ? " ten" : "") },
    ...values.map((_, i) => el("label", {}, el("span", { textContent: labels[i] }), box(values, i, aria(i)))),
  );
}

/**
 * The climate dialog.
 * @param {object} o
 * @param {object} o.data the climate (model.mjs `climate`)
 * @param {string[]} o.series time series names
 * @param {string[]} o.patterns monthly time pattern names (evaporation recovery)
 * @param {string} o.unitSystem "US" or "SI"
 */
export function climateEditor({ data, series, patterns, unitSystem, onSave, onCancel }) {
  const u = climateUnits(unitSystem);
  // Working copy: every value as text, so a half-typed number stays as typed.
  const asText = (list) => list.map(text);
  const w = {
    temperature: { ...data.temperature },
    evaporation: { ...data.evaporation, monthly: asText(data.evaporation.monthly), pan: asText(data.evaporation.pan), constant: text(data.evaporation.monthly[0]) },
    wind: { type: data.wind.type, monthly: asText(data.wind.monthly) },
    snowmelt: Object.fromEntries(Object.entries(data.snowmelt).map(([k, v]) => [k, text(v)])),
    adc: { impervious: asText(data.adc.impervious), pervious: asText(data.adc.pervious) },
    adjustments: Object.fromEntries(Object.entries(data.adjustments).map(([k, v]) => [k, asText(v)])),
  };
  const hasFile = data.temperature.source === "FILE";
  const message = el("p", { className: "hint record-message", role: "status" });
  const seriesSelect = (value, label) => select([["", "(choose)"], ...series.map((n) => [n, n])], value, label);

  // Temperature: none or a time series; a climate file is shown and kept (engine item 14).
  const temperature = el("div", { className: "climate-panel" });
  const drawTemperature = () => {
    if (hasFile) {
      temperature.replaceChildren(
        el("p", { className: "hint", textContent: "Air temperature, and wind speed and evaporation when they use it, come from the climate file " + (data.temperature.file || "(unnamed)") + ". Change the file in Edit INP." }),
      );
      return;
    }
    const source = select([["NONE", "No temperature data"], ["TIMESERIES", "Time series"]], w.temperature.source, "Temperature source");
    source.onchange = () => {
      w.temperature.source = source.value;
      drawTemperature();
    };
    const parts = [field("Source", source)];
    if (w.temperature.source === "TIMESERIES") {
      const ts = seriesSelect(w.temperature.series, "Temperature time series");
      ts.onchange = () => (w.temperature.series = ts.value);
      parts.push(field("Time series", ts, u.temp));
    }
    parts.push(el("p", { className: "hint", textContent: "Air temperature drives snowmelt and, with a climate file, evaporation." }));
    temperature.replaceChildren(...parts);
  };

  // Evaporation.
  const evaporation = el("div", { className: "climate-panel" });
  const drawEvaporation = () => {
    const e = w.evaporation;
    const types = evapTypes.filter((t) => hasFile || (t !== "FILE" && t !== "TEMPERATURE") || t === e.type);
    const type = select(types.map((t) => [t, evapNames[t]]), e.type, "Evaporation source");
    type.onchange = () => {
      e.type = type.value;
      drawEvaporation();
    };
    const parts = [field("Source", type)];
    if (e.type === "CONSTANT") parts.push(field("Rate", box(e, "constant", "Constant evaporation"), u.evap));
    if (e.type === "MONTHLY") parts.push(el("p", { className: "prop-caption", textContent: "Monthly rates (" + u.evap + ")" }), grid(e.monthly, months, (i) => monthNames[i] + " evaporation"));
    if (e.type === "TIMESERIES") {
      const ts = seriesSelect(e.series, "Evaporation time series");
      ts.onchange = () => (e.series = ts.value);
      parts.push(field("Time series", ts, u.evap));
    }
    if (e.type === "FILE") parts.push(el("p", { className: "prop-caption", textContent: "Pan coefficients" }), grid(e.pan, months, (i) => monthNames[i] + " pan coefficient"));
    const recovery = select([["", "None"], ...patterns.map((p) => [p, p])], e.recovery, "Soil recovery pattern");
    recovery.onchange = () => (e.recovery = recovery.value);
    const dry = el("input", { type: "checkbox", checked: !!e.dryOnly, ariaLabel: "Evaporate only in dry periods" });
    dry.onchange = () => (e.dryOnly = dry.checked);
    parts.push(
      field("Soil recovery pattern", recovery),
      el("label", { className: "check" }, dry, el("span", { textContent: "Evaporate only in dry periods" })),
    );
    evaporation.replaceChildren(...parts);
  };

  // Wind speed (snowmelt during rain).
  const wind = el("div", { className: "climate-panel" });
  const drawWind = () => {
    const type = select([["MONTHLY", "Monthly averages"], ...(hasFile || w.wind.type === "FILE" ? [["FILE", "From the climate file"]] : [])], w.wind.type, "Wind speed source");
    type.onchange = () => {
      w.wind.type = type.value;
      drawWind();
    };
    const parts = [field("Source", type)];
    if (w.wind.type === "MONTHLY") parts.push(el("p", { className: "prop-caption", textContent: "Monthly averages (" + u.wind + ")" }), grid(w.wind.monthly, months, (i) => monthNames[i] + " wind speed"));
    parts.push(el("p", { className: "hint", textContent: "Wind speed is used for snowmelt during rain." }));
    wind.replaceChildren(...parts);
  };

  // Snowmelt.
  const m = w.snowmelt;
  const snowmelt = el(
    "div",
    { className: "climate-panel" },
    field("Dividing temperature between snow and rain", box(m, "divide", "Dividing temperature"), u.temp),
    field("ATI weight", box(m, "ati", "ATI weight")),
    field("Negative melt ratio", box(m, "negMelt", "Negative melt ratio")),
    field("Elevation above sea level", box(m, "elevation", "Elevation"), u.length),
    field("Latitude", box(m, "latitude", "Latitude"), "°"),
    field("Longitude correction", box(m, "longitude", "Longitude correction"), "min"),
  );

  // Areal depletion: fraction of area covered by snow at each ratio of depth to the depth at 100 % cover.
  const ratios = Array.from({ length: 10 }, (_, i) => (i / 10).toFixed(1));
  const depletion = el(
    "div",
    { className: "climate-panel" },
    el("p", { className: "hint", textContent: "Fraction of area covered by snow (0 to 1) at each ratio of snow depth to the depth at full cover." }),
    el("p", { className: "prop-caption", textContent: "Impervious area" }),
    grid(w.adc.impervious, ratios, (i) => "Impervious cover at depth ratio " + ratios[i]),
    el("p", { className: "prop-caption", textContent: "Pervious area" }),
    grid(w.adc.pervious, ratios, (i) => "Pervious cover at depth ratio " + ratios[i]),
  );

  // Monthly adjustments: one row per month.
  const a = w.adjustments;
  const columns = [
    ["temperature", "Temperature (± " + u.temp + ")", "temperature adjustment"],
    ["evaporation", "Evaporation (± " + u.evap + ")", "evaporation adjustment"],
    ["rainfall", "Rainfall (×)", "rainfall multiplier"],
    ["conductivity", "Conductivity (×)", "conductivity multiplier"],
  ];
  const adjustments = el(
    "div",
    { className: "climate-panel" },
    el(
      "table",
      { className: "record-table climate-adjust" },
      el("thead", {}, el("tr", {}, el("th"), ...columns.map(([, h]) => el("th", { textContent: h, scope: "col" })))),
      el(
        "tbody",
        {},
        ...months.map((mo, i) =>
          el("tr", {}, el("th", { textContent: mo, scope: "row" }), ...columns.map(([k, , aria]) => el("td", {}, box(a[k], i, monthNames[i] + " " + aria)))),
        ),
      ),
    ),
    el("p", { className: "hint", textContent: "Temperature and evaporation are added to the model's values; rainfall and soil conductivity are multiplied. A conductivity of 0 or less means 1." }),
  );

  // Tabs.
  const panels = [
    ["Temperature", temperature],
    ["Evaporation", evaporation],
    ["Wind speed", wind],
    ["Snowmelt", snowmelt],
    ["Areal depletion", depletion],
    ["Adjustments", adjustments],
  ];
  const tabs = el("div", { className: "climate-tabs", role: "tablist", ariaLabel: "Climate" });
  const show = (index) => {
    panels.forEach(([, panel], i) => {
      panel.hidden = i !== index;
      const tab = tabs.children[i];
      tab.ariaSelected = String(i === index);
      tab.tabIndex = i === index ? 0 : -1;
    });
  };
  panels.forEach(([name, panel], i) => {
    panel.role = "tabpanel";
    panel.ariaLabel = name;
    const tab = el("button", { type: "button", role: "tab", textContent: name });
    tab.onclick = () => show(i);
    tab.onkeydown = (ev) => {
      const step = ev.key === "ArrowRight" ? 1 : ev.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      const next = (i + step + panels.length) % panels.length;
      show(next);
      tabs.children[next].focus();
    };
    tabs.append(tab);
  });
  drawTemperature();
  drawEvaporation();
  drawWind();
  show(0);

  const collect = () => ({
    temperature: { source: w.temperature.source, series: w.temperature.series },
    evaporation: {
      type: w.evaporation.type,
      monthly: w.evaporation.type === "CONSTANT" ? Array(12).fill(w.evaporation.constant) : w.evaporation.monthly,
      series: w.evaporation.series,
      pan: w.evaporation.pan,
      recovery: w.evaporation.recovery,
      dryOnly: w.evaporation.dryOnly,
    },
    wind: w.wind,
    snowmelt: w.snowmelt,
    adc: w.adc,
    adjustments: w.adjustments,
  });
  const save = el("button", { type: "button", className: "primary", textContent: "Save to model" });
  const cancel = el("button", { type: "button", textContent: "Cancel" });
  cancel.onclick = onCancel;
  save.onclick = async () => {
    save.disabled = true;
    try {
      await onSave(collect());
    } catch (e) {
      message.textContent = e.message || String(e);
    } finally {
      save.disabled = false;
    }
  };
  return el("div", { className: "climate-editor" }, tabs, ...panels.map(([, p]) => p), message, el("div", { className: "actions end" }, cancel, save));
}
