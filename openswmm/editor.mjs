// Catalog-driven object editor in the inspector: object lists, generated property rows, record
// cards (time series, curves, patterns, unit hydrographs) with their editor dialogs, the control
// rule program, a node's inflows and treatment, pollutants and land uses (buildup, washoff), a
// subcatchment's land uses and loadings, the climate, transects, LID controls and their placement,
// edits sent to the model worker, map edits (objects placed, inserted, traced and deleted on the map),
// undo, and "Apply to model" which installs the engine-written deck.
import { objectKinds, recordKinds, qualityKinds, patternLength, concentrationUnits, lidTypes, lidDefaults, inletTypes } from "./model.mjs";
import { recordEditor, drawRecord, describeRecord, curveTypes } from "./records.mjs";
import { rulesEditor } from "./rules.mjs";
import { inflowsEditor, describeInflows, hydrographEditor, describeHydrograph, hydrographCurve, monthRows } from "./inflows.mjs";
import { landuseEditor, describeLanduse, subQualityEditor, describeSubQuality, treatmentEditor, describeTreatment } from "./quality.mjs";
import { climateEditor, describeClimate } from "./climate.mjs";
import { transectEditor, describeTransect, drawTransect } from "./transects.mjs";
import { lidEditor, describeLid, lidNames, lidUsageEditor, describeLidUsage } from "./lids.mjs";
import { aquiferEditor, describeAquifer } from "./aquifers.mjs";
import { snowpackEditor, describeSnowpack } from "./snowpacks.mjs";
import { streetEditor, describeStreet, inletEditor, describeInlet, inletNames } from "./streets.mjs";
import { groupCard } from "./groups-view.mjs";
import { scopedTable } from "./scoped-table.mjs";
import { groupValues, undoValues } from "./properties.mjs";
const $ = (id) => document.getElementById(id);
const kindLabels = {
  options: "Simulation options",
  model: "Climate and model settings",
  options2d: "2D options",
  quality2d: "2D surface quality",
  infil2d: "2D infiltration",
  snow2d: "2D snow and frozen ground",
  gw2d: "2D groundwater",
  gwtransport2d: "2D groundwater transport",
  title: "Title and notes",
  report: "Report",
  files: "Files",
  transport: "Transport (ARD)",
  reactions: "Reactions",
  ueb: "Snow (UEB)",
  components: "Process components",
  userflags: "User flags",
  node: "Nodes",
  link: "Links",
  subcatchment: "Subcatchments",
  gage: "Rain gages",
  cell: "Surface cells",
  pollutant: "Pollutants",
  landuse: "Land uses",
  timeseries: "Time series",
  curve: "Curves",
  pattern: "Time patterns",
  hydrograph: "Unit hydrographs",
  transect: "Transects",
  lid: "LID controls",
  aquifer: "Aquifers",
  snowpack: "Snowpacks",
  street: "Streets",
  inlet: "Inlets",
  controls: "Control rules",
  events: "Events",
};
/** Type names in "Convert to", in the desktop's order. */
const nodeTypeLabels = { JUNCTION: "Junction", OUTFALL: "Outfall", STORAGE: "Storage unit", DIVIDER: "Divider" };
const linkTypeLabels = { CONDUIT: "Conduit", PUMP: "Pump", ORIFICE: "Orifice", WEIR: "Weir", OUTLET: "Outlet" };
const recordNoun = { timeseries: "time series", curve: "curve", pattern: "time pattern", hydrograph: "unit hydrograph", pollutant: "pollutant", landuse: "land use", transect: "transect", lid: "LID control", aquifer: "aquifer", snowpack: "snowpack", street: "street", inlet: "inlet" };
const recordTitle = { timeseries: "Time series", curve: "Curve", pattern: "Time pattern", hydrograph: "Unit hydrograph", pollutant: "Pollutant", landuse: "Land use", transect: "Transect", lid: "LID control", aquifer: "Aquifer", snowpack: "Snowpack", street: "Street", inlet: "Inlet" };
/** Kinds the map can select (selection.mjs). */
const pickKinds = ["node", "link", "subcatchment", "gage", "cell"];
/** Kinds edited as one whole (no object list). */
const globalKinds = ["model", "options", "options2d", "quality2d", "infil2d", "snow2d", "gw2d", "gwtransport2d", "title", "report", "files", "transport", "reactions", "ueb", "components", "userflags", "controls", "events"];
/** Kinds that are one section card (sections.mjs). */
const sectionKinds = ["options2d", "title", "report", "files", "transport", "ueb", "components"];
const node = (tag, props = {}, ...children) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...children);
  return n;
};
export class Editor {
  /**
   * @param {object} o
   * @param {(files: Object<string, Uint8Array>, count: number) => void} o.onApply installs the files the
   *   engine wrote: the deck and, for a mesh kept beside it, the sidecar
   * @param {(title: string, content: Node) => void} o.openDialog shows the record editor
   * @param {() => void} o.closeDialog
   * @param {(bytes: Uint8Array, select: object|null) => void} o.onNetwork shows the session's network
   *   on the map after a map edit (the deck the engine writes), selecting `select`
   * @param {{length: (points: number[][]) => number}} o.measure a polyline's length on the map in the
   *   model's units (a moved node's or reshaped link's conduits take it, as with the desktop's auto-length)
   */
  constructor({ onApply, onError, openDialog, closeDialog, onPick, onNetwork, onDiscard, measure, selected }) {
    this.onApply = onApply;
    this.selected = selected; // the map's selection: "Convert to" acts on its objects of the shown kind
    this.measure = measure;
    this.onNetwork = onNetwork;
    this.onDiscard = onDiscard; // the session went with map edits not applied
    this.onPick = onPick; // an object picked in Edit object becomes the selection
    this.onError = onError;
    this.openDialog = openDialog;
    this.closeDialog = closeDialog;
    this.pending = new Map();
    this.seq = 0;
    this.edits = [];
    this.defaults = null;
    this.worker = null;
    fetch("./vendor/engine/catalog_defaults.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        this.defaults = d;
      })
      .catch(() => {});
    $("objkind").replaceChildren(
      ...objectKinds.map((k) => new Option(kindLabels[k], k)),
    );
    $("objkind").onchange = () => {
      this.list();
      this.picked();
    };
    $("objid").onchange = () => {
      this.show();
      this.picked();
    };
    $("cellindex").onchange = () => {
      this.show();
      this.picked();
    };
    $("undoedit").onclick = () => this.undo();
    $("applyedits").onclick = () => this.apply();
  }
  /** The editing engine lives in its own worker, created on demand and dropped while a run owns the memory. */
  ensureWorker() {
    if (this.worker) return;
    this.worker = new Worker("./model-worker.mjs", { type: "module" });
    this.worker.onmessage = ({ data }) => {
      const p = this.pending.get(data.id);
      if (!p) return;
      this.pending.delete(data.id);
      if (data.error) p.reject(new Error(data.error));
      else p.resolve(data.result);
    };
    this.worker.onerror = (e) => this.suspend(e.message || "Model worker failed");
  }
  /** Drop the editing engine (and its staged model) so only one engine instance holds memory at a time. */
  suspend(reason = "Editing resumes after the run.") {
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.pending.values()) p.reject(new Error(reason));
    this.pending.clear();
    this.token = {};
    const mapped = this.edits.some((e) => e.op === "map");
    this.edits = [];
    if (mapped) this.onDiscard?.();
    $("props").replaceChildren();
    this.note(reason);
  }
  call(op, ...args) {
    return new Promise((resolve, reject) => {
      if (!this.worker) return reject(new Error("The editor is not open."));
      const id = ++this.seq;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, op, args });
    });
  }
  /** Open a project in the editing session and refresh the object lists. */
  async load(project) {
    const token = (this.token = {});
    this.edits = [];
    this.loading = true; // a pick made meanwhile waits for the new model (reveal)
    this.note();
    try {
      this.ensureWorker();
      const summary = await this.call("open", project);
      if (token !== this.token) return;
      this.summary = summary;
      this.loading = false;
      const waiting = this.waiting;
      this.waiting = null;
      if (waiting) this.reveal(waiting);
      else this.list();
    } catch (e) {
      if (token === this.token) {
        this.loading = false;
        this.fail(e);
      }
    }
  }
  list(pick) {
    const kind = $("objkind").value,
      select = $("objid");
    const objects = globalKinds.includes(kind) ? [] : this.summary?.objects[kind] || [];
    select.replaceChildren(
      ...objects.map(
        (o) =>
          new Option(
            o.id + (o.type ? " · " + (kind === "lid" ? lidNames[o.type] : o.type).toLowerCase() : "") + (o.from ? " · " + o.from + " → " + o.to : ""),
            o.id,
          ),
      ),
    );
    if (pick !== undefined && objects.some((o) => o.id === pick)) select.value = pick;
    select.hidden = globalKinds.includes(kind) || kind === "cell";
    const cells = this.summary?.cells || 0;
    $("cellindex").hidden = kind !== "cell";
    $("cellindex").max = Math.max(0, cells - 1);
    if (kind === "cell" && $("cellindex").value === "") $("cellindex").value = cells ? "0" : "";
    this.show();
  }
  /** Show an object selected elsewhere (the map) in Edit object: a node, link, subcatchment, gage or cell. */
  reveal(item) {
    if (!pickKinds.includes(item?.kind)) return;
    if (this.loading || !this.summary) {
      this.waiting = item; // shown when the editing session has the model
      return;
    }
    if (item.kind === "cell") {
      if (!this.summary.cells) return;
      $("cellindex").value = item.id;
    }
    $("objkind").value = item.kind;
    this.list(item.id);
  }
  /** Tell the controller which object Edit object now shows (when it is one the map can select). */
  picked() {
    const kind = $("objkind").value,
      id = this.key();
    if (!pickKinds.includes(kind) || id === null || id === "") return;
    const type = this.summary?.objects[kind]?.find((o) => o.id === id)?.type;
    this.onPick?.({ kind, id, ...(type ? { type: type.toLowerCase().replaceAll("_", " ") } : {}) });
  }
  key() {
    const kind = $("objkind").value;
    return globalKinds.includes(kind) ? null : kind === "cell" ? $("cellindex").value : $("objid").value;
  }
  async show() {
    const kind = $("objkind").value,
      key = this.key();
    const props = $("props");
    // Only the latest show() draws: choosing a kind and then an object starts two for one key. Each
    // show hands its own check to the card builders; a stale one stops after its next await.
    const mine = (this.showSeq = (this.showSeq || 0) + 1);
    const current = () => mine === this.showSeq && key === this.key();
    if (recordKinds.includes(kind)) return this.showRecord(kind, key, current);
    if (kind === "controls") return this.showRules();
    if (kind === "events") return this.showEvents();
    if (kind === "userflags") return this.showUserFlags();
    if (kind === "quality2d") return this.showScoped(kind, ["coverage", "loading", "curb", "initQuality", "bedQuality"], current);
    if (kind === "infil2d") return this.showScoped(kind, ["infilDefaults"], current);
    if (kind === "snow2d") return this.showScoped(kind, ["snow"], current, { groups: true });
    if (kind === "transport") return this.showScoped(kind, ["ardDispersion", "ardBoundaries", "ardSources"], current, { groups: true });
    if (kind === "gw2d") return this.showScoped(kind, ["aquifer", "nodeBeds", "aquiferLinks"], current, { groups: true });
    if (kind === "gwtransport2d") return this.showScoped(kind, ["gwParams", "gwSorption", "gwInitialQuality"], current, { groups: true });
    if (kind === "reactions") return this.showReactions();
    if (qualityKinds.includes(kind) && !key) return this.showQuality(kind, null, props, current);
    const global = kind === "model" || kind === "options" || sectionKinds.includes(kind);
    if ((!global && !key) || (kind === "cell" && !this.summary?.cells)) {
      props.replaceChildren();
      if (kind === "cell") this.note("This model has no 2D surface cells.");
      return;
    }
    try {
      const rows = await this.call("fields", kind, key);
      if (mine !== this.showSeq) return;
      props.replaceChildren(...rows.map((row) => this.row(kind, key, row)));
      if (kind === "node" || kind === "link" || kind === "subcatchment" || kind === "gage" || sectionKinds.includes(kind)) await this.showGroups(kind, key, props, current);
      if (kind === "node" || kind === "link") this.showConvert(kind, key, props);
      if (kind === "node" || kind === "link") await this.showReferences(kind, key, props, current);
      if (kind === "subcatchment") await this.showSubLinks(key, props, current);
      if (kind === "subcatchment") await this.showSubQuality(key, props, current);
      if (kind === "subcatchment") await this.showSubLids(key, props, current);
      if (qualityKinds.includes(kind)) await this.showQuality(kind, key, props, current);
      if (kind === "model") await this.showClimate(props, current);
    } catch (e) {
      this.fail(e);
    }
  }
  /** Whether the model has water quality to edit (pollutants or land uses). */
  hasQuality() {
    return !!(this.summary?.objects.pollutant.length || this.summary?.objects.landuse.length);
  }
  /**
   * Below a pollutant's or land use's properties: its name, what refers to it, New and Delete; a
   * pollutant's co-pollutant; a land use's buildup and washoff.
   */
  async showQuality(kind, key, props, current) {
    const noun = recordNoun[kind];
    const card = node("div", { className: "record-card" });
    const create = node("button", { type: "button", className: "tb ghost", textContent: "New " + noun });
    create.onclick = () => this.newRecordForm(kind, card, create);
    if (!key) {
      card.append(node("p", { className: "hint", textContent: "This model has no " + noun + "s." }), create);
      props.replaceChildren(card);
      return;
    }
    const [users, extra] = await Promise.all([this.call("impact", kind, key), this.call(kind === "pollutant" ? "coPollutant" : "landuse", key)]);
    if (!current()) return; // a later show() draws instead
    const name = node("input", { type: "text", value: key, ariaLabel: "Name of the " + noun });
    name.onchange = () => this.rename(kind, key, name.value);
    const remove = node("button", { type: "button", className: "tb ghost", textContent: "Delete" });
    remove.onclick = () => this.confirmDelete(kind, key, users, card);
    const parts = [];
    if (kind === "landuse") {
      const edit = node("button", { type: "button", className: "tb ghost", textContent: "Edit buildup and washoff…" });
      edit.disabled = !extra.rows.length;
      edit.onclick = () => this.openLanduse(key);
      parts.push(node("p", { className: "record-desc", textContent: describeLanduse(extra) }), edit);
    } else {
      // Co-pollutant: a fraction of another pollutant's runoff concentration.
      const others = this.summary.objects.pollutant.map((p) => p.id).filter((p) => p !== key);
      const co = node("select", { ariaLabel: "Co-pollutant" });
      co.add(new Option("None", ""));
      for (const p of others) co.add(new Option(p, p));
      co.value = extra.co;
      const fraction = node("input", { type: "number", step: "any", min: "0", value: String(extra.fraction), ariaLabel: "Co-pollutant fraction" });
      fraction.disabled = !extra.co;
      const save = async () => {
        try {
          const after = await this.call("setCoPollutant", key, { co: co.value, fraction: co.value ? fraction.value : 0 });
          this.edits.push({ op: "co", kind, key, before: extra, after });
          this.note();
          this.show();
        } catch (e) {
          this.fail(e);
          this.show();
        }
      };
      co.onchange = fraction.onchange = save;
      parts.push(
        node("label", { className: "prop", title: "The pollutant's runoff concentration includes this fraction of another pollutant's." }, node("span", { textContent: "Co-pollutant" }), co),
        node("label", { className: "prop" }, node("span", { textContent: "Co-pollutant fraction" }), fraction),
      );
    }
    card.append(
      ...parts,
      node("p", { className: "hint", textContent: users.length ? "Used by " + users.map((u) => u.object + " (" + u.field + ")").join(", ") + "." : "Not used by any object." }),
      node("label", { className: "prop" }, node("span", { textContent: "Name" }), name),
      node("div", { className: "pair" }, remove, create),
    );
    props.append(card);
  }
  /** Above the model's settings: the climate, edited in one dialog. */
  async showClimate(props, current) {
    const data = await this.call("climate");
    if (!current()) return; // a later show() draws instead
    const edit = node("button", { type: "button", className: "tb ghost", textContent: "Edit climate…" });
    edit.onclick = () => this.openClimate();
    props.prepend(
      node(
        "div",
        { className: "record-card" },
        node("p", { className: "record-desc", textContent: "Climate" }),
        ...describeClimate(data, this.summary.unitSystem).map((line) => node("p", { className: "hint", textContent: line })),
        edit,
      ),
    );
  }
  async openClimate() {
    let data;
    try {
      data = await this.call("climate");
    } catch (e) {
      return this.fail(e);
    }
    this.openDialog(
      "Climate",
      climateEditor({
        data,
        series: this.summary.objects.timeseries.map((t) => t.id),
        patterns: this.summary.objects.pattern.filter((p) => p.type === "MONTHLY").map((p) => p.id),
        unitSystem: this.summary.unitSystem,
        onSave: async (next) => {
          const after = await this.call("setClimate", next);
          this.edits.push({ op: "climate", kind: "model", key: null, before: data, after });
          this.closeDialog();
          this.note();
          this.show();
        },
        onCancel: () => this.closeDialog(),
      }),
    );
  }
  /** Below a subcatchment's properties: the LID controls placed on it. */
  async showSubLids(key, props, current) {
    if (!this.summary?.objects.lid.length) return;
    const data = await this.call("lidUsage", key);
    if (!current()) return; // a later show() draws instead
    const edit = node("button", { type: "button", className: "tb ghost", textContent: "Edit LID usage…" });
    edit.onclick = () => this.openLidUsage(key);
    props.append(
      node(
        "div",
        { className: "record-card" },
        node("p", { className: "record-desc", textContent: "Low impact development" }),
        ...describeLidUsage(data, this.summary.unitSystem).map((line) => node("p", { className: "hint", textContent: line })),
        edit,
      ),
    );
  }
  async openLidUsage(key) {
    let data;
    try {
      data = await this.call("lidUsage", key);
    } catch (e) {
      return this.fail(e);
    }
    const o = this.summary.objects;
    this.openDialog(
      "Subcatchment " + data.id + " · LID usage",
      lidUsageEditor({
        data,
        lids: o.lid.filter((l) => l.type !== "NODE").map((l) => l.id),
        drains: [...o.subcatchment, ...o.node].map((x) => x.id),
        unitSystem: this.summary.unitSystem,
        onSave: async (next) => {
          const after = await this.call("setLidUsage", key, next);
          this.edits.push({ op: "lidusage", kind: "subcatchment", key: data.id, before: data, after });
          this.closeDialog();
          this.note();
          this.show();
        },
        onCancel: () => this.closeDialog(),
      }),
    );
  }
  /** Below a subcatchment's properties: its land uses and initial loadings. */
  async showSubQuality(key, props, current) {
    if (!this.hasQuality()) return;
    const data = await this.call("subQuality", key);
    if (!current()) return; // a later show() draws instead
    const edit = node("button", { type: "button", className: "tb ghost", textContent: "Edit land uses and loadings…" });
    edit.onclick = () => this.openSubQuality(key);
    props.append(
      node(
        "div",
        { className: "record-card" },
        node("p", { className: "record-desc", textContent: "Water quality" }),
        ...describeSubQuality(data, this.summary).map((line) => node("p", { className: "hint", textContent: line })),
        edit,
      ),
    );
  }
  async openLanduse(key) {
    let record;
    try {
      record = await this.call("landuse", key);
    } catch (e) {
      return this.fail(e);
    }
    this.openDialog(
      "Land use " + record.id + " · buildup and washoff",
      landuseEditor({
        record,
        series: this.summary.objects.timeseries.map((t) => t.id),
        onSave: async (data) => {
          const after = await this.call("setLanduse", key, data);
          this.edits.push({ op: "landuse", kind: "landuse", key: record.id, before: record, after });
          this.closeDialog();
          this.note();
          this.show();
        },
        onCancel: () => this.closeDialog(),
      }),
    );
  }
  async openSubQuality(key) {
    let data;
    try {
      data = await this.call("subQuality", key);
    } catch (e) {
      return this.fail(e);
    }
    this.openDialog(
      "Subcatchment " + data.id + " · land uses and loadings",
      subQualityEditor({
        data,
        units: this.summary,
        onSave: async (next) => {
          const after = await this.call("setSubQuality", key, next);
          this.edits.push({ op: "subquality", kind: "subcatchment", key: data.id, before: data, after });
          this.closeDialog();
          this.note();
          this.show();
        },
        onCancel: () => this.closeDialog(),
      }),
    );
  }
  async openTreatment(key) {
    let data;
    try {
      data = await this.call("treatment", key);
    } catch (e) {
      return this.fail(e);
    }
    this.openDialog(
      "Treatment at " + data.node,
      treatmentEditor({
        data,
        onCheck: (rows) => this.call("checkTreatments", rows),
        onSave: async (next) => {
          const after = await this.call("setTreatment", key, next);
          this.edits.push({ op: "treatment", kind: "node", key: data.node, before: data, after });
          this.closeDialog();
          this.note();
          this.show();
        },
        onCancel: () => this.closeDialog(),
      }),
    );
  }
  /** Below a node's or link's properties: the rules that name it and, for a node, its inflows. */
  async showReferences(kind, key, props, current) {
    const treats = kind === "node" && this.summary?.objects.pollutant.length;
    const [rules, inflows, treatment] = await Promise.all([
      this.call("ruleRefs", key),
      kind === "node" ? this.call("inflows", key) : null,
      treats ? this.call("treatment", key) : null,
    ]);
    if (!current()) return; // a later show() draws instead
    const extra = node("div", { className: "record-card" });
    if (treatment) {
      const edit = node("button", { type: "button", className: "tb ghost", textContent: "Edit treatment…" });
      edit.onclick = () => this.openTreatment(key);
      extra.append(node("p", { className: "hint", textContent: describeTreatment(treatment) }), edit);
    }
    if (inflows) {
      const edit = node("button", { type: "button", className: "tb ghost", textContent: "Edit inflows…" });
      edit.onclick = () => this.openInflows(key);
      extra.append(
        node("p", { className: "record-desc", textContent: "Inflows" }),
        ...describeInflows(inflows, this.summary).map((line) => node("p", { className: "hint", textContent: line })),
        edit,
      );
    }
    if (rules.length) extra.append(node("p", { className: "hint", textContent: "Named in control rule" + (rules.length > 1 ? "s " : " ") + rules.join(", ") + "." }));
    if (extra.childElementCount) props.append(extra);
  }
  /** A node's external, dry-weather and RDII inflows in one dialog. */
  async openInflows(key) {
    let data, choices;
    try {
      [data, choices] = await Promise.all([this.call("inflows", key), this.call("inflowChoices")]);
    } catch (e) {
      return this.fail(e);
    }
    this.openDialog(
      "Inflows at " + data.node,
      inflowsEditor({
        data,
        choices,
        units: { unitSystem: this.summary?.unitSystem, flowUnits: this.summary?.flowUnitsName },
        onSave: async (rows) => {
          const after = await this.call("setInflows", data.node, rows);
          this.edits.push({ op: "inflows", kind: "node", key: data.node, before: data, after });
          this.closeDialog();
          this.note();
          this.show();
        },
        onCancel: () => this.closeDialog(),
      }),
    );
  }
  /** The control rule card: the rule ids and the program editor. */
  async showRules() {
    const props = $("props");
    let rules;
    try {
      rules = await this.call("rules");
    } catch (e) {
      props.replaceChildren();
      return this.fail(e);
    }
    if ($("objkind").value !== "controls") return;
    const ids = rules.map((r) => r.id);
    const edit = node("button", { type: "button", className: "tb ghost", textContent: rules.length ? "Edit rules…" : "Write rules…" });
    edit.onclick = () => this.openRules();
    props.replaceChildren(
      node(
        "div",
        { className: "record-card" },
        node("p", {
          className: "record-desc",
          textContent: rules.length ? rules.length + " rule" + (rules.length > 1 ? "s" : "") + ": " + ids.slice(0, 12).join(", ") + (ids.length > 12 ? " …" : "") : "This model has no control rules.",
        }),
        edit,
      ),
    );
  }
  /** Events ([EVENTS]): the card lists the periods; the dialog edits them as rows. */
  async showEvents() {
    const props = $("props");
    let rows;
    try {
      rows = await this.call("events");
    } catch (e) {
      props.replaceChildren();
      return this.fail(e);
    }
    if ($("objkind").value !== "events") return;
    const edit = node("button", { type: "button", className: "tb ghost", textContent: rows.length ? "Edit events…" : "Add events…" });
    edit.onclick = () => this.openEvents(rows);
    props.replaceChildren(
      node(
        "div",
        { className: "record-card" },
        node("p", {
          className: "record-desc",
          textContent: rows.length ? rows.length + " event" + (rows.length > 1 ? "s" : "") + ": " + rows.slice(0, 4).map((r) => r.start + " – " + r.end).join("; ") + (rows.length > 4 ? " …" : "") : "No events: the run covers the whole simulation period.",
        }),
        node("p", { className: "hint", textContent: "Events limit a run to these periods (SWMM 5.2 [EVENTS]); times are the model's clock." }),
        edit,
      ),
    );
  }
  /** Scoped 2D section tables (surface-sections.mjs): a line per section and its table dialog. */
  async showScoped(kind, names, current, { groups = false } = {}) {
    const props = $("props");
    let sections;
    try {
      sections = await Promise.all(names.map((n) => this.call("scopedRows", n)));
    } catch (e) {
      if (current()) props.replaceChildren(node("div", { className: "record-card" }, node("p", { className: "hint", textContent: e.message || String(e) })));
      return;
    }
    if (!current()) return; // a later show() draws (two for one kind would both append option cards)
    // A table without cell scopes (node beds, links, ARD) names its object (and species).
    const objectText = (v) => [v.node ?? v.link ?? v.conduit ?? v.element, v.species].filter((x) => x !== undefined && x !== "").join(" ");
    const scopeText = (r) => (!r.scope ? objectText(r.values) : r.scope === "GLOBAL" ? "all cells" : r.scope === "TAG" ? "tag " + r.target : "cell " + r.target);
    props.replaceChildren(
      ...sections.map((d) => {
        const edit = node("button", { type: "button", className: "tb ghost", textContent: "Edit " + d.title.replace(/^2D /, "").toLowerCase() + "…" });
        edit.onclick = () => this.openScoped(d);
        return node(
          "div",
          { className: "record-card" },
          node("h4", { className: "group-title", textContent: d.title }),
          node("p", { className: "record-desc", textContent: d.rows.length ? d.rows.length + " row" + (d.rows.length > 1 ? "s" : "") + ": " + d.rows.slice(0, 4).map(scopeText).join(", ") + (d.rows.length > 4 ? " …" : "") : "None." }),
          edit,
        );
      }),
    );
    if (groups) await this.showGroups(kind, null, props, current); // option cards of the same kind
  }
  openScoped(data) {
    this.openDialog(
      data.title,
      scopedTable(data, {
        onCancel: () => this.closeDialog(),
        onSave: async (rows) => {
          const before = await this.call("setScopedRows", data.name, rows);
          this.edits.push({ op: "scoped", kind: $("objkind").value, name: data.name, before });
          this.closeDialog();
          this.note();
          this.show();
        },
      }),
    );
  }
  /** The reaction system ([REACTION_*]): a summary and its .rxn text editor. */
  async showReactions() {
    const props = $("props");
    let r;
    try {
      r = await this.call("reactions");
    } catch (e) {
      props.replaceChildren();
      return this.fail(e);
    }
    if ($("objkind").value !== "reactions") return;
    const edit = node("button", { type: "button", className: "tb ghost", textContent: r.text ? "Edit reaction system…" : "Add a reaction system…" });
    edit.onclick = () => this.openReactions(r);
    const where = r.embedded ? "Kept in the deck's [REACTION_*] sections." : r.registered ? "Saved in model.rxn (a process component)." : "A first system registers the reactions component with model.rxn, as the desktop does; Apply saves it with the deck.";
    props.replaceChildren(
      node(
        "div",
        { className: "record-card" },
        node("h4", { className: "group-title", textContent: "Reactions" }),
        node("p", { className: "record-desc", textContent: r.species.length ? r.species.length + " species: " + r.species.join(", ") : "No reaction system." }),
        node("p", { className: "hint", textContent: "Multi-species reactions in pipes and tanks (the .rxn format: options, species, coefficients, terms, pipe and tank expressions, …). " + where }),
        edit,
      ),
    );
  }
  openReactions(r) {
    const template = "[REACTION_OPTIONS]\nSOLVER RK5\n\n[REACTION_SPECIES]\n;;BULK|WALL name units\n\n[REACTION_PIPES]\n;;RATE species expression\n\n[REACTION_TANKS]\n";
    const area = node("textarea", { value: r.text || template, spellcheck: false, ariaLabel: "Reaction system (.rxn)", rows: 18 });
    area.className = "rxn-text";
    const message = node("p", { className: "hint record-message", role: "status" });
    const check = node("button", { type: "button", textContent: "Check" });
    check.onclick = async () => {
      const result = await this.call("checkReactions", area.value);
      message.textContent = result.valid ? "The engine reads it." : result.message;
      message.classList.toggle("ok", result.valid);
    };
    const save = node("button", { type: "button", className: "primary", textContent: "Save to model" });
    const cancel = node("button", { type: "button", textContent: "Cancel" });
    cancel.onclick = () => this.closeDialog();
    save.onclick = async () => {
      try {
        const before = await this.call("setReactions", area.value);
        this.edits.push({ op: "reactions", kind: "reactions", before });
        this.closeDialog();
        this.note();
        this.show();
      } catch (e) {
        message.classList.remove("ok");
        message.textContent = e.message || String(e);
      }
    };
    this.openDialog(
      "Reaction system",
      node(
        "div",
        { className: "record-editor" },
        area,
        node("p", { className: "hint", textContent: "Checked as a whole when saved: nothing changes unless the engine reads all of it." }),
        message,
        node("div", { className: "actions end" }, check, cancel, save),
      ),
    );
  }
  /** User flag definitions ([USER_FLAGS]): a summary and the flags dialog. */
  async showUserFlags() {
    const props = $("props");
    let flags;
    try {
      flags = await this.call("userFlags");
    } catch (e) {
      props.replaceChildren();
      return this.fail(e);
    }
    if ($("objkind").value !== "userflags") return;
    const edit = node("button", { type: "button", className: "tb ghost", textContent: flags.length ? "Edit flags…" : "Add flags…" });
    edit.onclick = () => this.openUserFlags(flags);
    const typeName = { BOOLEAN: "yes/no", INTEGER: "integer", REAL: "real", STRING: "text" };
    props.replaceChildren(
      node(
        "div",
        { className: "record-card" },
        node("p", { className: "record-desc", textContent: flags.length ? flags.map((f) => f.name + " (" + typeName[f.type] + ")").join(", ") : "No user flags." }),
        node("p", { className: "hint", textContent: "Named values you attach to nodes, links, subcatchments and rain gages ([USER_FLAGS]); each object's card has a User flags group." }),
        edit,
      ),
    );
  }
  /** The flags dialog, as the desktop's User Flags Manager: name, type and description per flag. */
  openUserFlags(before) {
    const work = before.map((f) => ({ ...f }));
    const message = node("p", { className: "hint record-message", role: "status" });
    const body = node("tbody");
    const types = [["BOOLEAN", "Yes/no"], ["INTEGER", "Integer"], ["REAL", "Real"], ["STRING", "Text"]];
    const render = () =>
      body.replaceChildren(
        ...work.map((f, i) => {
          const name = node("input", { value: f.name, ariaLabel: "Name of flag " + (i + 1) });
          name.oninput = () => (f.name = name.value);
          const type = node("select", { ariaLabel: "Type of flag " + (i + 1) });
          for (const [v, label] of types) type.add(new Option(label, v));
          type.value = f.type;
          type.onchange = () => (f.type = type.value);
          const description = node("input", { value: f.description, ariaLabel: "Description of flag " + (i + 1) });
          description.oninput = () => (f.description = description.value);
          const drop = node("button", { type: "button", className: "tb ghost", textContent: "Remove", ariaLabel: "Remove flag " + (i + 1) });
          drop.onclick = () => {
            work.splice(i, 1);
            render();
          };
          return node("tr", {}, node("td", {}, name), node("td", {}, type), node("td", {}, description), node("td", {}, drop));
        }),
      );
    render();
    const add = node("button", { type: "button", className: "tb ghost", textContent: "Add flag" });
    add.onclick = () => {
      work.push({ name: "", type: "STRING", description: "" });
      render();
      body.querySelector("tr:last-child input")?.focus();
    };
    const save = node("button", { type: "button", className: "primary", textContent: "Save to model" });
    const cancel = node("button", { type: "button", textContent: "Cancel" });
    cancel.onclick = () => this.closeDialog();
    save.onclick = async () => {
      try {
        const { restore } = await this.call("setUserFlags", work);
        this.edits.push({ op: "userflags", kind: "userflags", before: restore });
        this.closeDialog();
        this.note();
        this.show();
      } catch (e) {
        message.textContent = e.message || String(e);
      }
    };
    this.openDialog(
      "User flags",
      node(
        "div",
        { className: "record-editor" },
        node("table", { className: "events-table" }, node("thead", {}, node("tr", {}, node("th", { textContent: "Name" }), node("th", { textContent: "Type" }), node("th", { textContent: "Description" }), node("th"))), body),
        add,
        node("p", { className: "hint", textContent: "Names are kept in capitals. A removed or renamed flag takes its values with it (Undo brings them back). A flag that has values keeps its type." }),
        message,
        node("div", { className: "actions end" }, cancel, save),
      ),
    );
  }
  openEvents(before) {
    const work = before.map((r) => ({ ...r }));
    const message = node("p", { className: "hint record-message", role: "status" });
    const body = node("tbody");
    const render = () =>
      body.replaceChildren(
        ...work.map((r, i) => {
          const cell = (key, label) => {
            const input = node("input", { value: r[key], placeholder: "YYYY-MM-DD HH:MM", ariaLabel: label + " " + (i + 1) });
            input.oninput = () => (r[key] = input.value);
            return node("td", {}, input);
          };
          const drop = node("button", { type: "button", className: "tb ghost", textContent: "Remove", ariaLabel: "Remove event " + (i + 1) });
          drop.onclick = () => {
            work.splice(i, 1);
            render();
          };
          return node("tr", {}, node("td", { textContent: String(i + 1) }), cell("start", "Start of event"), cell("end", "End of event"), node("td", {}, drop));
        }),
      );
    render();
    const add = node("button", { type: "button", className: "tb ghost", textContent: "Add event" });
    add.onclick = () => {
      const last = work[work.length - 1];
      work.push({ start: last?.end || "", end: "" });
      render();
    };
    const save = node("button", { type: "button", className: "primary", textContent: "Save to model" });
    const cancel = node("button", { type: "button", textContent: "Cancel" });
    cancel.onclick = () => this.closeDialog();
    save.onclick = async () => {
      try {
        const after = await this.call("setEvents", work);
        this.edits.push({ op: "events", kind: "events", before, after });
        this.closeDialog();
        this.note();
        this.show();
      } catch (e) {
        message.textContent = e.message || String(e);
      }
    };
    this.openDialog(
      "Events",
      node(
        "div",
        { className: "record-editor" },
        node("table", { className: "events-table" }, node("thead", {}, node("tr", {}, node("th", { textContent: "#" }), node("th", { textContent: "Start" }), node("th", { textContent: "End" }), node("th"))), body),
        add,
        node("p", { className: "hint", textContent: "Dates and times as YYYY-MM-DD HH:MM on the model's clock; each event starts before it ends." }),
        message,
        node("div", { className: "actions end" }, cancel, save),
      ),
    );
  }
  async openRules() {
    let rules;
    try {
      rules = await this.call("rules");
    } catch (e) {
      return this.fail(e);
    }
    this.openDialog(
      "Control rules",
      rulesEditor({
        rules,
        onCheck: (blocks) => this.call("checkRules", blocks),
        onSave: async (blocks) => {
          const after = await this.call("setRules", blocks);
          this.edits.push({ op: "rules", kind: "controls", before: rules.map((r) => r.text), after });
          this.closeDialog();
          this.note();
          this.show();
        },
        onCancel: () => this.closeDialog(),
      }),
    );
  }
  row(kind, key, row) {
    const wrap = document.createElement("label");
    wrap.className = "prop";
    const caption = document.createElement("span");
    caption.textContent = row.label;
    if (row.unit) {
      const unit = document.createElement("small");
      unit.textContent = row.unit;
      caption.append(" ", unit);
    }
    const info = this.defaults?.properties?.[row.path];
    const members = row.type in (this.defaults?.enums || {}) ? this.defaults.enums[row.type] : null;
    let input;
    if (members) {
      input = document.createElement("select");
      for (const [name, value] of Object.entries(members)) input.add(new Option(name, value));
      input.value = String(row.value);
    } else if (row.choices) {
      input = document.createElement("select");
      for (const choice of row.choices) input.add(new Option(choice, choice));
      input.value = String(row.value);
    } else if (row.type === "bool") {
      input = document.createElement("select");
      input.add(new Option("Yes", "true"));
      input.add(new Option("No", "false"));
      input.value = String(row.value);
    } else {
      input = document.createElement("input");
      input.type = row.type === "str" ? "text" : "number";
      if (row.type !== "str") input.step = row.type === "float" ? "any" : "1";
      input.value = row.value;
      if (info && info.default !== null && info.default !== undefined) input.placeholder = info.default;
    }
    let title = row.doc || "";
    if (info?.rejects)
      for (const [probe, message] of Object.entries(info.rejects))
        if (message) title += "\nRefuses " + probe + ": " + message.replace(/^\w+: /, "");
    wrap.title = title.trim();
    input.onchange = async () => {
      try {
        const next = await this.call("set", row.path, key, input.value);
        this.edits.push({ path: row.path, key, kind, before: row.value, after: next });
        row.value = next;
        input.value = String(next);
        this.note();
      } catch (e) {
        input.value = String(row.value);
        this.fail(e);
      }
    };
    wrap.append(caption, input);
    if (kind === "cell") {
      const all = document.createElement("button");
      all.type = "button";
      all.className = "tb ghost all";
      all.textContent = "Apply to all cells";
      all.onclick = async () => {
        try {
          const n = await this.call("setAll", row.path, input.value);
          this.edits.push({ path: row.path, key: "*", kind, before: null, after: input.value, bulk: n });
          row.value = input.value;
          this.note(n + " cells set · " + this.edits.length + " edit(s) not yet applied to the input deck.");
        } catch (e) {
          this.fail(e);
        }
      };
      wrap.append(all);
    }
    return wrap;
  }
  note(message) {
    const n = this.edits.length;
    $("editnote").textContent =
      message ??
      (n ? n + " edit" + (n > 1 ? "s" : "") + " not yet applied to the input deck." : "");
    $("undoedit").disabled = !n;
    $("applyedits").disabled = !n || !!this.busy;
  }
  async undo() {
    const edit = this.edits.pop();
    if (!edit) return;
    try {
      if (edit.bulk) throw new Error("A bulk cell edit cannot be undone; reload the project to discard it.");
      if (edit.op === "record") await this.call("setRecord", edit.kind, edit.key, edit.before);
      else if (edit.op === "rules") await this.call("setRules", edit.before);
      else if (edit.op === "events") await this.call("setEvents", edit.before);
      else if (edit.op === "userflags") await this.call("setUserFlags", edit.before.definitions, edit.before.values);
      else if (edit.op === "scoped") await this.call("setScopedRows", edit.name, edit.before);
      else if (edit.op === "reactions") await this.call("setReactions", null, edit.before);
      else if (edit.op === "inflows") await this.call("setInflows", edit.key, edit.before);
      else if (edit.op === "co") await this.call("setCoPollutant", edit.key, edit.before);
      else if (edit.op === "landuse") await this.call("setLanduse", edit.key, edit.before);
      else if (edit.op === "subquality") await this.call("setSubQuality", edit.key, edit.before);
      else if (edit.op === "treatment") await this.call("setTreatment", edit.key, edit.before);
      else if (edit.op === "climate") await this.call("setClimate", edit.before);
      else if (edit.op === "lidusage") await this.call("setLidUsage", edit.key, edit.before);
      else if (edit.op === "add") await this.call("deleteRecord", edit.kind, edit.key);
      else if (edit.op === "rename") await this.call("renameRecord", edit.kind, edit.after, edit.before);
      else if (edit.op === "delete") await this.call("restore", edit.token);
      else if (edit.op === "map") {
        for (const step of Array.isArray(edit.undo[0]) ? edit.undo : [edit.undo]) await this.call(...step);
        return this.afterMapEdit(null);
      } else if (edit.op === "sublinks") await this.call("setSubcatchLinks", edit.key, edit.before);
      else if (edit.op === "group") await this.call("setGroup", edit.kind, edit.key, edit.group, edit.before);
      else await this.call("set", edit.path, edit.key, edit.before);
      if (["add", "rename", "delete"].includes(edit.op)) return this.refresh(edit.kind, edit.op === "add" ? null : edit.op === "rename" ? edit.before : edit.key);
      this.note();
    } catch (e) {
      this.fail(e);
    }
    this.show();
  }
  /** Reread the object lists after a record was added, renamed or deleted; select `select`. */
  async refresh(kind, select) {
    this.summary = await this.call("summary");
    $("objkind").value = kind;
    const keep = $("objid").value;
    this.list();
    const ids = [...$("objid").options].map((o) => o.value);
    $("objid").value = select && ids.includes(select) ? select : ids.includes(keep) ? keep : ids[0] || "";
    this.note();
    this.show();
  }
  /** The inspector card of a time series, curve or pattern: its extent, a preview, its users and actions. */
  async showRecord(kind, key, current) {
    const props = $("props");
    const noun = recordNoun[kind];
    const card = node("div", { className: "record-card" });
    const create = node("button", { type: "button", className: "tb ghost", textContent: "New " + noun });
    create.onclick = () => this.newRecordForm(kind, card, create);
    if (!key) {
      card.append(node("p", { className: "hint", textContent: "This model has no " + noun + (kind === "timeseries" ? "" : "s") + "." }), create);
      props.replaceChildren(card);
      return;
    }
    let record, users;
    try {
      [record, users] = await Promise.all([this.call("record", kind, key), this.call("impact", kind, key)]);
    } catch (e) {
      props.replaceChildren();
      return this.fail(e);
    }
    if (!current()) return; // another object was picked meanwhile
    const preview = node("canvas", { width: 260, height: 64, className: "record-spark", ariaLabel: "Preview of " + record.id });
    const noPreview = ["lid", "aquifer", "snowpack", "street", "inlet"].includes(kind);
    preview.hidden = noPreview;
    const edit = node("button", { type: "button", className: "tb ghost", textContent: { transect: "Edit cross-section…", lid: "Edit layers…", aquifer: "Edit parameters…", snowpack: "Edit snowpack…", street: "Edit cross-section…", inlet: "Edit design…" }[kind] ?? "Edit values…" });
    edit.disabled = !!record.file || record.type === "NODE"; // a FILE series is edited in its file; a node LID stack in Edit INP
    edit.onclick = () => this.openRecord(kind, record.id);
    const name = node("input", { type: "text", value: record.id, ariaLabel: "Name of the " + noun });
    name.onchange = () => this.rename(kind, record.id, name.value);
    // The engine's transect rename leaves its links naming the old transect (engine item 11).
    const fixedName = kind === "transect" && users.length > 0;
    name.disabled = fixedName;
    const remove = node("button", { type: "button", className: "tb ghost", textContent: "Delete" });
    remove.onclick = () => this.confirmDelete(kind, record.id, users, card);
    const unitSystem = this.summary?.unitSystem;
    const describe =
      kind === "hydrograph"
        ? describeHydrograph(record)
        : kind === "transect"
          ? describeTransect(record)
          : kind === "lid"
            ? describeLid(record)
            : kind === "aquifer"
              ? describeAquifer(record, unitSystem)
              : kind === "snowpack"
                ? describeSnowpack(record, unitSystem)
                : kind === "street"
                  ? describeStreet(record, unitSystem)
                  : kind === "inlet"
                    ? describeInlet(record, unitSystem)
                    : describeRecord(record);
    card.append(
      node("p", { className: "record-desc", textContent: describe }),
      preview,
      node(
        "p",
        { className: "hint" },
        users.length ? "Used by " + users.map((u) => u.object).join(", ") + "." : "Not used by any object.",
      ),
      node("label", { className: "prop", title: fixedName ? "A transect that links use keeps its name for now." : "" }, node("span", { textContent: "Name" }), name),
      node("div", { className: "pair" }, edit, remove),
      create,
    );
    props.replaceChildren(card);
    if (kind === "hydrograph") this.showGroups(kind, record.id, props, current); // RDII decay cards
    if (kind === "transect") drawTransect(preview, record);
    else if (noPreview) return;
    else if (kind === "hydrograph") {
      const months = record.entries.map((e) => e.month);
      drawRecord(preview, { kind: "curve", points: hydrographCurve(monthRows(record, months.includes(-1) ? -1 : Math.min(...months))) });
    } else drawRecord(preview, record);
  }
  /** Inline form for a new record: a name and, for curves and patterns, a type. */
  newRecordForm(kind, card, button) {
    const name = node("input", { type: "text", ariaLabel: "New " + recordNoun[kind] + " name", placeholder: "Name" });
    const type = node("select", { ariaLabel: "New " + recordNoun[kind] + " type" });
    const types = kind === "curve" ? curveTypes : kind === "pattern" ? Object.keys(patternLength) : kind === "pollutant" ? Object.keys(concentrationUnits) : kind === "lid" ? lidTypes : kind === "inlet" ? inletTypes : [];
    for (const t of types) type.add(new Option(kind === "pollutant" ? t : kind === "lid" ? lidNames[t] : kind === "inlet" ? inletNames[t] : t[0] + t.slice(1).toLowerCase(), t));
    if (kind === "pollutant") type.ariaLabel = "New pollutant units";
    type.hidden = !types.length;
    const ok = node("button", { type: "button", className: "tb primary", textContent: "Create" });
    const form = node("div", { className: "record-new" }, name, type, ok);
    ok.onclick = async () => {
      try {
        const r = await this.call("addRecord", kind, name.value, type.value);
        this.edits.push({ op: "add", kind, key: r.id });
        await this.refresh(kind, r.id);
      } catch (e) {
        this.fail(e);
      }
    };
    name.onkeydown = (e) => {
      if (e.key === "Enter") ok.click();
    };
    button.replaceWith(form);
    name.focus();
  }
  async rename(kind, id, value) {
    try {
      const next = await this.call("renameRecord", kind, id, value);
      if (next !== id) this.edits.push({ op: "rename", kind, before: id, after: next });
      await this.refresh(kind, next);
    } catch (e) {
      this.fail(e);
      this.show();
    }
  }
  /** Delete after listing the references the engine will clear; undo reopens the model as it was. */
  confirmDelete(kind, id, users, card) {
    const run = async () => {
      try {
        const { token } = await this.call("deleteRecord", kind, id);
        this.edits.push({ op: "delete", kind, key: id, token });
        await this.refresh(kind, null);
      } catch (e) {
        this.fail(e);
      }
    };
    if (!users.length) return run();
    const yes = node("button", { type: "button", className: "tb danger", textContent: "Delete anyway" });
    const no = node("button", { type: "button", className: "tb ghost", textContent: "Keep" });
    yes.onclick = run;
    no.onclick = () => this.show();
    card.replaceChildren(
      node("p", {
        className: "hint",
        textContent:
          kind === "transect"
            ? "Deleting " + id + " turns the cross-section of " + users.map((u) => u.object).join(", ") + " into a circular one."
            : "Deleting " + id + " clears these references: " + users.map((u) => u.object + " (" + u.field + ")").join(", ") + ".",
      }),
      node("div", { className: "pair" }, no, yes),
    );
  }
  /** The record editor dialog; saving replaces the record's rows in the editing session. */
  async openRecord(kind, id) {
    let record;
    try {
      record = await this.call("record", kind, id);
    } catch (e) {
      return this.fail(e);
    }
    const units = { unitSystem: this.summary?.unitSystem, flowUnits: this.summary?.flowUnitsName };
    const onSave = async (data) => {
      const after = await this.call("setRecord", kind, record.id, data);
      this.edits.push({ op: "record", kind, key: record.id, before: record, after });
      this.closeDialog();
      this.note();
      this.show();
    };
    const onCancel = () => this.closeDialog();
    this.openDialog(
      recordTitle[kind] + " " + record.id,
      kind === "transect"
        ? transectEditor({ record, unitSystem: this.summary?.unitSystem, onSave, onCancel })
        : kind === "lid"
        ? lidEditor({ record, defaults: lidDefaults(this.summary?.unitSystem), unitSystem: this.summary?.unitSystem, onSave, onCancel })
        : kind === "aquifer"
        ? aquiferEditor({ record, patterns: (this.summary?.objects.pattern || []).filter((p) => p.type === "MONTHLY").map((p) => p.id), unitSystem: this.summary?.unitSystem, onSave, onCancel })
        : kind === "snowpack"
        ? snowpackEditor({ record, subcatchments: (this.summary?.objects.subcatchment || []).map((x) => x.id), unitSystem: this.summary?.unitSystem, onSave, onCancel })
        : kind === "street"
        ? streetEditor({ record, unitSystem: this.summary?.unitSystem, onSave, onCancel })
        : kind === "inlet"
        ? inletEditor({ record, curves: (this.summary?.objects.curve || []).filter((c) => c.type === "DIVERSION" || c.type === "RATING").map((c) => c.id), unitSystem: this.summary?.unitSystem, onSave, onCancel })
        : kind === "hydrograph"
        ? hydrographEditor({
            record,
            gages: (this.summary?.objects.gage || []).map((g) => g.id),
            draw: (canvas, points) => drawRecord(canvas, { kind: "curve", points }),
            onSave,
            onCancel,
          })
        : recordEditor({ record, units, onSave, onCancel }),
    );
  }
  /**
   * A map edit (view.mjs add tool): `{op: "node" | "insert" | "link" | "gage", …}` goes to the editing
   * session; its undo joins the edit log, the new object is selected and the map shows the result.
   * Returns what the session made; a refusal throws (its reason also goes to the inspector note).
   */
  async mapEdit(spec) {
    let made, undo, select, message;
    try {
      // The selection's type reads as the map's picks do ("J12 · junction").
      const type = spec.virtual ? "virtual junction" : spec.op === "gage" ? "rain gage" : String(spec.type || "").toLowerCase();
      if (spec.op === "node") {
        made = await this.call("addNode", spec.type, spec.x, spec.y, spec.invert);
        undo = ["removeAdded", "node", made.id];
        select = { kind: "node", id: made.id, type };
      } else if (spec.op === "insert") {
        made = await this.call("insertNode", spec.type, spec.link, spec.t, !!spec.virtual);
        undo = ["removeInserted", made.id];
        select = { kind: "node", id: made.id, type };
        message = "Inserted " + made.id + ", splitting " + spec.link + " into " + spec.link + " and " + made.link + ".";
      } else if (spec.op === "link") {
        made = await this.call("addLink", spec.type, spec.from, spec.to, spec.vertices, spec.length);
        undo = ["removeAdded", "link", made.id];
        select = { kind: "link", id: made.id, type };
      } else if (spec.op === "gage") {
        made = await this.call("addGage", spec.x, spec.y);
        undo = ["removeAdded", "gage", made.id];
        select = { kind: "gage", id: made.id, type };
      } else if (spec.op === "subcatchment") {
        made = await this.call("addSubcatchment", spec.ring, spec.area);
        undo = ["removeAdded", "subcatchment", made.id];
        select = { kind: "subcatchment", id: made.id, type: "subcatchment" };
        // It takes the nearest gage and node (SWMM needs both); the note says so.
        message =
          made.gage && made.outlet
            ? made.id + " drains to " + made.outlet + " with rain from " + made.gage + " (the nearest); change them in its properties."
            : made.id + " needs " + [!made.gage && "a rain gage", !made.outlet && "an outlet"].filter(Boolean).join(" and ") + ": set it in its properties.";
      } else if (spec.op === "move" && spec.kind === "label") {
        const labels = await this.call("labels");
        labels[spec.index] = { ...labels[spec.index], x: spec.x, y: spec.y };
        const before = await this.call("setLabels", labels);
        made = { id: spec.id };
        undo = ["setLabels", before];
        select = null;
      } else if (spec.op === "move") {
        // A moved node's conduits take their new length on the map (the desktop's auto-length).
        const r = await this.call("moveObject", spec.kind, spec.id, spec.x, spec.y);
        const before = await this.call("setLengths", this.lengths(r.conduits));
        made = { id: spec.id };
        undo = [["moveObject", spec.kind, spec.id, r.x, r.y], ["setLengths", before]];
        select = { kind: spec.kind, id: spec.id };
      } else if (spec.op === "vertices") {
        const r = await this.call("setVertices", spec.link, spec.vertices);
        const before = r.conduit ? await this.call("setLengths", this.lengths([{ id: spec.link, points: r.points }])) : {};
        made = { id: spec.link };
        undo = [["setVertices", spec.link, r.before], ["setLengths", before]];
        select = { kind: "link", id: spec.link };
      } else throw new Error("Unknown map edit " + spec.op + ".");
    } catch (e) {
      this.fail(e);
      throw e; // the map's hint line says why too
    }
    this.edits.push({ op: "map", kind: select?.kind ?? "label", key: made.id, undo });
    await this.afterMapEdit(select, message);
    return made;
  }
  /**
   * An inlet junction on a street conduit (the desktop's New Inlet Junction): the inlet design, the
   * node that receives what it captures (nearest to the click first) and its placement; the conduit
   * splits around it. Throws when the conduit is no street or the model has no inlet design.
   */
  async addInlet(spec) {
    const c = await this.call("inletChoices", spec.link, spec.x, spec.y);
    if (!c.street) throw new Error("Inlet junctions can only be placed on street conduits.");
    if (!c.designs.length) throw new Error("This model has no inlet design: add one under Inlets in Edit object first.");
    if (!c.captures.length) throw new Error("No node can receive this inlet's flow.");
    const design = node("select", { ariaLabel: "Inlet design" });
    for (const d of c.designs) design.add(new Option(d, d));
    const capture = node("select", { ariaLabel: "Capture node" });
    for (const n of c.captures) capture.add(new Option(n, n));
    const placement = node("select", { ariaLabel: "Placement" });
    for (const [v, t] of [["AUTOMATIC", "Automatic"], ["ON_GRADE", "On grade"], ["ON_SAG", "On sag"]]) placement.add(new Option(t, v));
    const ok = node("button", { type: "button", className: "tb primary", textContent: "Insert inlet junction" });
    const cancel = node("button", { type: "button", className: "tb ghost", textContent: "Cancel" });
    const status = node("p", { className: "hint", role: "status" });
    cancel.onclick = () => this.closeDialog();
    ok.onclick = async () => {
      try {
        const made = await this.call("insertInlet", spec.link, spec.t, design.value, capture.value, placement.value);
        this.closeDialog();
        this.edits.push({ op: "map", kind: "node", key: made.id, undo: ["removeInlet", made.id] });
        await this.afterMapEdit(
          { kind: "node", id: made.id, type: "inlet junction" },
          "Inserted inlet junction " + made.id + " on " + spec.link + " (now " + spec.link + " and " + made.link + "); it sends what it captures to " + capture.value + ".",
        );
      } catch (e) {
        status.textContent = e.message;
      }
    };
    const row = (caption, input) => node("label", { className: "prop" }, node("span", { textContent: caption }), input);
    this.openDialog(
      "New inlet junction on " + spec.link,
      node(
        "div",
        { className: "inlet-editor" },
        node("p", { className: "hint", textContent: "An inlet junction captures street flow into a separate drainage node. Choose the inlet design and the node it discharges to." }),
        row("Inlet design", design),
        row("Capture node", capture),
        row("Placement", placement),
        status,
        node("div", { className: "pair" }, cancel, ok),
      ),
    );
    ok.focus();
  }
  /**
   * A map label's dialog (the desktop's text tool): `{x, y}` places a new one there, `{index}` changes
   * or deletes an existing one. Text, size, bold and italic are what [LABELS] holds.
   */
  async editLabel(at) {
    const labels = await this.call("labels");
    const old = at.index !== undefined ? labels[at.index] : null;
    const label = old || { x: at.x, y: at.y, text: "", anchor: "", font: "Arial", size: 14, bold: false, italic: false };
    const text = node("input", { type: "text", value: label.text, ariaLabel: "Label text", required: true });
    const size = node("input", { type: "number", min: "1", step: "1", value: String(label.size), ariaLabel: "Label size" });
    const bold = node("input", { type: "checkbox", checked: label.bold, ariaLabel: "Bold" });
    const italic = node("input", { type: "checkbox", checked: label.italic, ariaLabel: "Italic" });
    const save = node("button", { type: "button", className: "tb primary", textContent: old ? "Save" : "Add label" });
    const cancel = node("button", { type: "button", className: "tb ghost", textContent: "Cancel" });
    const remove = node("button", { type: "button", className: "tb danger", textContent: "Delete" });
    const status = node("p", { className: "hint", role: "status" });
    const commit = async (next, message) => {
      try {
        const before = await this.call("setLabels", next);
        this.closeDialog();
        this.edits.push({ op: "map", kind: "label", key: label.text, undo: ["setLabels", before] });
        await this.afterMapEdit(null, message);
      } catch (e) {
        status.textContent = e.message;
      }
    };
    save.onclick = () => {
      const changed = { ...label, text: text.value.trim(), size: Number(size.value), bold: bold.checked, italic: italic.checked };
      const next = [...labels];
      if (old) next[at.index] = changed;
      else next.push(changed);
      commit(next, (old ? "Changed" : "Added") + " the label " + changed.text + ".");
    };
    remove.onclick = () => commit(labels.filter((_, i) => i !== at.index), "Deleted the label " + label.text + ".");
    cancel.onclick = () => this.closeDialog();
    text.onkeydown = (e) => {
      if (e.key === "Enter") save.click();
    };
    const row = (caption, input) => node("label", { className: "prop" }, node("span", { textContent: caption }), input);
    this.openDialog(
      old ? "Label " + old.text : "New label",
      node(
        "div",
        { className: "label-editor" },
        row("Text", text),
        row("Size", size),
        node("div", { className: "pair" }, node("label", { className: "check" }, bold, "Bold"), node("label", { className: "check" }, italic, "Italic")),
        status,
        node("div", { className: "pair" }, ...(old ? [remove] : []), cancel, save),
      ),
    );
    text.focus();
  }
  /**
   * "Convert to" on a node's or link's card (the desktop's type conversion): it acts on the selected
   * objects of that kind when this one is among them, else on this one; a preview lists what converts,
   * what already is that type and what the engine refuses (and why) before anything changes.
   */
  showConvert(kind, key, props) {
    const types = kind === "node" ? nodeTypeLabels : linkTypeLabels;
    const target = node("select", { ariaLabel: "Convert " + key + " to" });
    target.add(new Option("— choose a type —", ""));
    for (const [type, label] of Object.entries(types)) target.add(new Option(label, type));
    const go = node("button", { type: "button", className: "tb ghost", textContent: "Convert…", disabled: true });
    target.onchange = () => (go.disabled = !target.value);
    go.onclick = () => this.confirmConvert(kind, key, target.value);
    props.append(node("div", { className: "prop convert-row" }, node("span", { textContent: "Convert to" }), node("div", { className: "pair" }, target, go)));
  }
  async confirmConvert(kind, key, type) {
    const picked = (this.selected?.() || []).filter((i) => i.kind === kind).map((i) => i.id);
    const ids = picked.includes(key) ? picked : [key];
    const label = (kind === "node" ? nodeTypeLabels : linkTypeLabels)[type];
    let preview;
    try {
      preview = await this.call("convertObjects", kind, ids, type);
    } catch (e) {
      return this.fail(e);
    }
    const by = (state) => preview.rows.filter((r) => r.state === state);
    const yes = node("button", { type: "button", className: "tb primary", textContent: "Convert" });
    const no = node("button", { type: "button", className: "tb ghost", textContent: "Keep" });
    yes.disabled = !by("convert").length;
    no.onclick = () => this.closeDialog();
    yes.onclick = async () => {
      this.closeDialog();
      try {
        const done = await this.call("convertObjects", kind, ids, type, true);
        const converted = done.rows.filter((r) => r.state === "convert");
        this.edits.push({ op: "map", kind, key, undo: ["unconvertObjects", kind, done.undo] });
        const cleared = converted.filter((r) => r.cleared.length).map((r) => r.id + " (" + r.cleared.join(", ") + ")");
        await this.afterMapEdit(
          { kind, id: converted.some((r) => r.id === key) ? key : converted[0].id, type: label.toLowerCase() },
          "Converted " + converted.map((r) => r.id).join(", ") + " to " + label.toLowerCase() + "." + (cleared.length ? " Cleared, which undo cannot restore: " + cleared.join("; ") + "." : ""),
        );
      } catch (e) {
        this.fail(e);
      }
    };
    const line = (text, rows, why) => (rows.length ? node("p", { className: "hint", textContent: text + rows.map((r) => r.id + (why ? " — " + r.reason : "")).join(why ? "; " : ", ") + "." }) : "");
    this.openDialog(
      "Convert to " + label.toLowerCase(),
      node(
        "div",
        { className: "confirm-convert" },
        node("p", { textContent: "To convert: " + by("convert").length + " · already this type: " + by("same").length + " · refused: " + by("refused").length + "." }),
        line("Converts: ", by("convert")),
        line("Already this type: ", by("same")),
        line("Refused: ", by("refused"), true),
        node("p", { className: "hint", textContent: "Values only the old type has are cleared; undo brings the type back with the common values." }),
        node("div", { className: "pair" }, no, yes),
      ),
    );
    (yes.disabled ? no : yes).focus();
  }
  /**
   * Property groups the catalog has no rows for (properties.mjs): a link's cross-section and losses,
   * an outfall's, storage unit's or divider's parameters, a subcatchment's infiltration and
   * groundwater. A change writes the whole group (one undo step).
   */
  async showGroups(kind, key, props, current) {
    const groups = await this.call("groups", kind, key);
    if (!current()) return;
    for (const g of groups) {
      let shown = g;
      const onApply = async (values) => {
        const after = await this.call("setGroup", kind, key, g.key, values);
        this.edits.push({ op: "group", kind, key, group: g.key, before: undoValues(shown), after: groupValues(after) });
        shown = after;
        this.note();
        if (g.refresh) this.show(); // a LID moves the node's depth and its links' offsets (rows above)
        return after;
      };
      props.append(groupCard(g, onApply));
    }
  }
  /** Conduit lengths `{id: length}` measured on the map (none when no measure is given). */
  lengths(conduits) {
    const out = {};
    for (const c of conduits) {
      const length = this.measure?.length(c.points);
      if (length > 0) out[c.id] = length;
    }
    return out;
  }
  /**
   * At the top of a subcatchment's properties: its rain gage and outlet (a node or another
   * subcatchment), which SWMM needs; a change is one undo step.
   */
  async showSubLinks(key, props, current) {
    const links = await this.call("subcatchLinks", key);
    if (!current()) return;
    const objects = this.summary?.objects || {};
    const gage = node("select", { ariaLabel: "Rain gage of " + key });
    if (!links.gage) gage.add(new Option("— choose —", ""));
    for (const g of objects.gage || []) gage.add(new Option(g.id, g.id));
    gage.value = links.gage;
    const outlet = node("select", { ariaLabel: "Outlet of " + key });
    if (!links.outlet) outlet.add(new Option("— choose —", ""));
    const group = (label, kind, list) => {
      const g = node("optgroup", { label });
      for (const o of list) if (!(kind === "subcatchment" && o.id === key)) g.append(new Option(o.id, kind + ":" + o.id));
      outlet.append(g);
    };
    group("Nodes", "node", objects.node || []);
    group("Subcatchments", "subcatchment", objects.subcatchment || []);
    outlet.value = links.outlet ? links.outlet.kind + ":" + links.outlet.id : "";
    const save = async () => {
      const [kind, ...id] = outlet.value.split(":");
      const next = { gage: gage.value, outlet: outlet.value ? { kind, id: id.join(":") } : null };
      try {
        const before = { ...links, outlet: links.outlet && { ...links.outlet } }; // links changes below
        const after = await this.call("setSubcatchLinks", key, next);
        this.edits.push({ op: "sublinks", kind: "subcatchment", key, before, after });
        Object.assign(links, after);
        this.note();
      } catch (e) {
        this.fail(e);
        this.show();
      }
    };
    gage.onchange = outlet.onchange = save;
    const row = (label, input, title) => node("label", { className: "prop", title }, node("span", { textContent: label }), input);
    props.prepend(
      row("Rain gage", gage, "The rain gage whose rainfall the subcatchment receives."),
      row("Outlet", outlet, "The node or subcatchment that receives the subcatchment's runoff."),
    );
  }
  /**
   * Delete objects selected on the map. When the delete takes or clears anything else, the dialog
   * lists it first (links that end at a deleted node go too); undo puts everything back.
   */
  async deleteObjects(items) {
    let impact;
    try {
      impact = await this.call("objectImpact", items);
    } catch (e) {
      return this.fail(e);
    }
    const run = async () => {
      try {
        const { token } = await this.call("deleteObjects", items);
        this.edits.push({ op: "map", kind: items[0].kind, undo: ["restoreDeleted", token] });
        await this.afterMapEdit(null, "Deleted " + items.map((i) => i.id).join(", ") + (impact.removed.length ? " and " + impact.removed.join(", ") : "") + ".");
      } catch (e) {
        this.fail(e);
      }
    };
    if (!impact.removed.length && !impact.cleared.length) return run();
    const yes = node("button", { type: "button", className: "tb danger", textContent: "Delete" });
    const no = node("button", { type: "button", className: "tb ghost", textContent: "Keep" });
    yes.onclick = () => {
      this.closeDialog();
      run();
    };
    no.onclick = () => this.closeDialog();
    const line = (text, list) => (list.length ? node("p", { className: "hint", textContent: text + list.join(", ") + "." }) : "");
    const names = items.map((i) => i.id);
    this.openDialog(
      "Delete " + (names.length === 1 ? names[0] : names.length + " objects"),
      node(
        "div",
        { className: "confirm-delete" },
        node("p", { textContent: "Delete " + names.join(", ") + " from the model?" }),
        line("Also deleted, as they end at a deleted node: ", impact.removed),
        line("These references are cleared: ", impact.cleared),
        node("div", { className: "pair" }, no, yes),
      ),
    );
    yes.focus();
  }
  /** After a map edit or its undo: the object lists again, then the map from the deck the engine writes. */
  async afterMapEdit(select, message) {
    try {
      this.summary = await this.call("summary");
      if (select) $("objkind").value = select.kind;
      this.list(select?.id);
      this.note(message);
      const bytes = await this.call("write");
      this.onNetwork?.(bytes, select);
    } catch (e) {
      this.fail(e);
    }
  }
  /** Install the edited model (the deck and the files beside it) in the project; true when applied. */
  async apply() {
    try {
      // A deck the engine could not open again would leave the project unopenable: say what is missing.
      const problems = await this.call("problems");
      if (problems.length) throw new Error(problems.join(" "));
      const files = await this.call("writeAll");
      const count = this.edits.length;
      this.edits = [];
      this.onApply(files, count);
      return true;
    } catch (e) {
      this.fail(e);
      return false;
    }
  }
  setBusy(on) {
    this.busy = on;
    this.note();
  }
  fail(e) {
    // Editor problems stay in the inspector; the global status line belongs to jobs.
    $("editnote").textContent = e.message || String(e);
  }
}
