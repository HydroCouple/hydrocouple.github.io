// Catalog-driven object editor in the inspector: object lists, generated property rows,
// edits sent to the model worker, undo, and "Apply to model" which installs the engine-written deck.
import { objectKinds } from "./model.mjs";
const $ = (id) => document.getElementById(id);
const kindLabels = {
  options: "Simulation options",
  model: "Climate and model settings",
  node: "Nodes",
  link: "Links",
  subcatchment: "Subcatchments",
  gage: "Rain gages",
  cell: "Surface cells",
};
export class Editor {
  constructor({ onApply, onError }) {
    this.onApply = onApply;
    this.onError = onError;
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
    const objects = kind === "model" ? [] : this.summary?.objects[kind] || [];
    select.replaceChildren(
      ...objects.map(
        (o) =>
          new Option(
            o.id + (o.type ? " · " + o.type.toLowerCase() : "") + (o.from ? " · " + o.from + " → " + o.to : ""),
            o.id,
          ),
      ),
    );
    select.hidden = kind === "model" || kind === "options" || kind === "cell";
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
    return kind === "model" || kind === "options" ? null : kind === "cell" ? $("cellindex").value : $("objid").value;
  }
  async show() {
    const kind = $("objkind").value,
      key = this.key();
    const props = $("props");
    const global = kind === "model" || kind === "options";
    if ((!global && !key) || (kind === "cell" && !this.summary?.cells)) {
      props.replaceChildren();
      if (kind === "cell") this.note("This model has no 2D surface cells.");
      return;
    }
    try {
      const rows = await this.call("fields", kind, key);
      props.replaceChildren(...rows.map((row) => this.row(kind, key, row)));
    } catch (e) {
      this.fail(e);
    }
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
      await this.call("set", edit.path, edit.key, edit.before);
      this.note();
    } catch (e) {
      this.fail(e);
    }
    this.show();
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
