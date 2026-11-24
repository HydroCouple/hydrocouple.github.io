// Catalog-driven object editor in the inspector: object lists, generated property rows, record
// cards (time series, curves, patterns, unit hydrographs) with their editor dialogs, the control
// rule program, a node's inflows and treatment, pollutants and land uses (buildup, washoff), a
// subcatchment's land uses and loadings, edits sent to the model worker, undo, and "Apply to model"
// which installs the engine-written deck.
import { objectKinds, recordKinds, qualityKinds, patternLength, concentrationUnits } from "./model.mjs";
import { recordEditor, drawRecord, describeRecord, curveTypes } from "./records.mjs";
import { rulesEditor } from "./rules.mjs";
import { inflowsEditor, describeInflows, hydrographEditor, describeHydrograph, hydrographCurve, monthRows } from "./inflows.mjs";
import { landuseEditor, describeLanduse, subQualityEditor, describeSubQuality, treatmentEditor, describeTreatment } from "./quality.mjs";
const $ = (id) => document.getElementById(id);
const kindLabels = {
  options: "Simulation options",
  model: "Climate and model settings",
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
  controls: "Control rules",
};
const recordNoun = { timeseries: "time series", curve: "curve", pattern: "time pattern", hydrograph: "unit hydrograph", pollutant: "pollutant", landuse: "land use" };
const recordTitle = { timeseries: "Time series", curve: "Curve", pattern: "Time pattern", hydrograph: "Unit hydrograph", pollutant: "Pollutant", landuse: "Land use" };
/** Kinds edited as one whole (no object list). */
const globalKinds = ["model", "options", "controls"];
const node = (tag, props = {}, ...children) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...children);
  return n;
};
export class Editor {
  /**
   * @param {object} o
   * @param {(bytes: Uint8Array, count: number) => void} o.onApply installs the engine-written deck
   * @param {(title: string, content: Node) => void} o.openDialog shows the record editor
   * @param {() => void} o.closeDialog
   */
  constructor({ onApply, onError, openDialog, closeDialog }) {
    this.onApply = onApply;
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
    $("objkind").onchange = () => this.list();
    $("objid").onchange = () => this.show();
    $("cellindex").onchange = () => this.show();
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
    this.edits = [];
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
    this.note();
    try {
      this.ensureWorker();
      const summary = await this.call("open", project);
      if (token !== this.token) return;
      this.summary = summary;
      this.list();
    } catch (e) {
      if (token === this.token) this.fail(e);
    }
  }
  list() {
    const kind = $("objkind").value,
      select = $("objid");
    const objects = globalKinds.includes(kind) ? [] : this.summary?.objects[kind] || [];
    select.replaceChildren(
      ...objects.map(
        (o) =>
          new Option(
            o.id + (o.type ? " · " + o.type.toLowerCase() : "") + (o.from ? " · " + o.from + " → " + o.to : ""),
            o.id,
          ),
      ),
    );
    select.hidden = globalKinds.includes(kind) || kind === "cell";
    const cells = this.summary?.cells || 0;
    $("cellindex").hidden = kind !== "cell";
    $("cellindex").max = Math.max(0, cells - 1);
    if (kind === "cell" && $("cellindex").value === "") $("cellindex").value = cells ? "0" : "";
    this.show();
  }
  /** A cell picked on the map becomes the edited object. */
  selectCell(index) {
    if (!(index >= 0) || !this.summary?.cells) return;
    $("objkind").value = "cell";
    $("cellindex").value = String(index);
    this.list();
  }
  key() {
    const kind = $("objkind").value;
    return globalKinds.includes(kind) ? null : kind === "cell" ? $("cellindex").value : $("objid").value;
  }
  async show() {
    const kind = $("objkind").value,
      key = this.key();
    const props = $("props");
    // Only the latest show() draws: choosing a kind and then an object starts two for one key.
    const mine = (this.showSeq = (this.showSeq || 0) + 1);
    this.current = () => mine === this.showSeq && key === this.key();
    if (recordKinds.includes(kind)) return this.showRecord(kind, key);
    if (kind === "controls") return this.showRules();
    if (qualityKinds.includes(kind) && !key) return this.showQuality(kind, null, props);
    const global = kind === "model" || kind === "options";
    if ((!global && !key) || (kind === "cell" && !this.summary?.cells)) {
      props.replaceChildren();
      if (kind === "cell") this.note("This model has no 2D surface cells.");
      return;
    }
    try {
      const rows = await this.call("fields", kind, key);
      if (mine !== this.showSeq) return;
      props.replaceChildren(...rows.map((row) => this.row(kind, key, row)));
      if (kind === "node" || kind === "link") await this.showReferences(kind, key, props);
      if (kind === "subcatchment") await this.showSubQuality(key, props);
      if (qualityKinds.includes(kind)) await this.showQuality(kind, key, props);
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
  async showQuality(kind, key, props) {
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
    if (!this.current()) return; // a later show() draws instead
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
  /** Below a subcatchment's properties: its land uses and initial loadings. */
  async showSubQuality(key, props) {
    if (!this.hasQuality()) return;
    const data = await this.call("subQuality", key);
    if (!this.current()) return; // a later show() draws instead
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
  async showReferences(kind, key, props) {
    const treats = kind === "node" && this.summary?.objects.pollutant.length;
    const [rules, inflows, treatment] = await Promise.all([
      this.call("ruleRefs", key),
      kind === "node" ? this.call("inflows", key) : null,
      treats ? this.call("treatment", key) : null,
    ]);
    if (!this.current()) return; // a later show() draws instead
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
      else if (edit.op === "inflows") await this.call("setInflows", edit.key, edit.before);
      else if (edit.op === "co") await this.call("setCoPollutant", edit.key, edit.before);
      else if (edit.op === "landuse") await this.call("setLanduse", edit.key, edit.before);
      else if (edit.op === "subquality") await this.call("setSubQuality", edit.key, edit.before);
      else if (edit.op === "treatment") await this.call("setTreatment", edit.key, edit.before);
      else if (edit.op === "add") await this.call("deleteRecord", edit.kind, edit.key);
      else if (edit.op === "rename") await this.call("renameRecord", edit.kind, edit.after, edit.before);
      else if (edit.op === "delete") await this.call("restore", edit.token);
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
  async showRecord(kind, key) {
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
    if (!this.current()) return; // another object was picked meanwhile
    const preview = node("canvas", { width: 260, height: 64, className: "record-spark", ariaLabel: "Preview of " + record.id });
    const edit = node("button", { type: "button", className: "tb ghost", textContent: "Edit values…" });
    edit.disabled = !!record.file; // a FILE series is edited in its file
    edit.onclick = () => this.openRecord(kind, record.id);
    const name = node("input", { type: "text", value: record.id, ariaLabel: "Name of the " + noun });
    name.onchange = () => this.rename(kind, record.id, name.value);
    const remove = node("button", { type: "button", className: "tb ghost", textContent: "Delete" });
    remove.onclick = () => this.confirmDelete(kind, record.id, users, card);
    card.append(
      node("p", { className: "record-desc", textContent: kind === "hydrograph" ? describeHydrograph(record) : describeRecord(record) }),
      preview,
      node(
        "p",
        { className: "hint" },
        users.length ? "Used by " + users.map((u) => u.object).join(", ") + "." : "Not used by any object.",
      ),
      node("label", { className: "prop" }, node("span", { textContent: "Name" }), name),
      node("div", { className: "pair" }, edit, remove),
      create,
    );
    props.replaceChildren(card);
    if (kind === "hydrograph") {
      const months = record.entries.map((e) => e.month);
      drawRecord(preview, { kind: "curve", points: hydrographCurve(monthRows(record, months.includes(-1) ? -1 : Math.min(...months))) });
    } else drawRecord(preview, record);
  }
  /** Inline form for a new record: a name and, for curves and patterns, a type. */
  newRecordForm(kind, card, button) {
    const name = node("input", { type: "text", ariaLabel: "New " + recordNoun[kind] + " name", placeholder: "Name" });
    const type = node("select", { ariaLabel: "New " + recordNoun[kind] + " type" });
    const types = kind === "curve" ? curveTypes : kind === "pattern" ? Object.keys(patternLength) : kind === "pollutant" ? Object.keys(concentrationUnits) : [];
    for (const t of types) type.add(new Option(kind === "pollutant" ? t : t[0] + t.slice(1).toLowerCase(), t));
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
      node("p", { className: "hint", textContent: "Deleting " + id + " clears these references: " + users.map((u) => u.object + " (" + u.field + ")").join(", ") + "." }),
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
      kind === "hydrograph"
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
  async apply() {
    try {
      const bytes = await this.call("write");
      const count = this.edits.length;
      this.edits = [];
      this.onApply(bytes, count);
    } catch (e) {
      this.fail(e);
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
