/**
 * A scoped 2D section table (view), as the desktop's 2D section tables: one row per scope — all cells,
 * the cells with a tag, or one cell — then the section's value columns; a table without scopes
 * (`data.scopes` null, e.g. the transport tables) has the value columns only. The rows are edited here
 * and sent whole to `onSave`, which resolves when the model took them or rejects with the reasons.
 */
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

/**
 * @param {{scopes: object, columns: Array<{key, label, type, choices?}>, rows: Array<{scope, target, values}>, tags: string[], cells: number, note: string, title: string}} data
 * @param {{onSave: (rows: object[]) => Promise<void>, onCancel: () => void}} o
 */
export function scopedTable(data, { onSave, onCancel }) {
  const work = data.rows.map((r) => ({ scope: r.scope, target: r.target, values: { ...r.values } }));
  const body = el("tbody");
  const listId = "scoped-tags-" + Math.random().toString(36).slice(2, 8);
  const tags = el("datalist", { id: listId }, ...(data.tags || []).map((t) => el("option", { value: t })));
  const message = el("p", { className: "hint record-message", role: "status" });
  const render = () =>
    body.replaceChildren(
      ...work.map((row, i) => {
        const n = i + 1;
        const scope = el("select", { ariaLabel: "Scope of row " + n });
        for (const [v, label] of Object.entries(data.scopes || {})) scope.add(new Option(label, v));
        scope.value = row.scope;
        const target = el("input", { value: row.target, ariaLabel: "Tag or cell of row " + n, placeholder: row.scope === "CELL" ? "1–" + data.cells : "tag" });
        target.setAttribute("list", listId);
        target.disabled = row.scope === "GLOBAL";
        target.oninput = () => (row.target = target.value);
        scope.onchange = () => {
          row.scope = scope.value;
          if (row.scope === "GLOBAL") row.target = "";
          render();
        };
        const cells = data.columns.map((c) => {
          let input;
          if (c.type === "choice") {
            input = el("select", { ariaLabel: c.label + " of row " + n });
            input.add(new Option("— choose —", ""));
            for (const v of c.choices) input.add(new Option(c.labels?.[v] ?? v, v));
            input.value = row.values[c.key] ?? "";
          } else input = el("input", { type: "number", step: "any", value: row.values[c.key] ?? "", ariaLabel: c.label + " of row " + n });
          input.oninput = input.onchange = () => (row.values[c.key] = input.value === "" ? "" : c.type === "number" ? Number(input.value) : input.value);
          return el("td", {}, input);
        });
        const drop = el("button", { type: "button", className: "tb ghost", textContent: "Remove", ariaLabel: "Remove row " + n });
        drop.onclick = () => {
          work.splice(i, 1);
          render();
        };
        return el("tr", {}, ...(data.scopes ? [el("td", {}, scope), el("td", {}, target)] : []), ...cells, el("td", {}, drop));
      }),
    );
  render();
  const add = el("button", { type: "button", className: "tb ghost", textContent: "Add row" });
  add.onclick = () => {
    work.push(data.scopes ? { scope: work.length ? "TAG" : "GLOBAL", target: "", values: {} } : { values: {} });
    render();
  };
  const save = el("button", { type: "button", className: "primary", textContent: "Save to model" });
  const cancel = el("button", { type: "button", textContent: "Cancel" });
  cancel.onclick = onCancel;
  save.onclick = async () => {
    try {
      await onSave(work);
    } catch (e) {
      message.textContent = e.message || String(e);
    }
  };
  return el(
    "div",
    { className: "record-editor scoped-table" },
    el("div", { className: "scoped-scroll" }, el("table", { className: "events-table" }, el("thead", {}, el("tr", {}, ...(data.scopes ? [el("th", { textContent: "Scope" }), el("th", { textContent: "Tag / cell" })] : []), ...data.columns.map((c) => el("th", { textContent: c.label })), el("th"))), body)),
    tags,
    add,
    el("p", { className: "hint", textContent: data.note + (data.scopes ? " A tag or cell row overrides the all-cells row there; cells are numbered from 1." : "") }),
    message,
    el("div", { className: "actions end" }, cancel, save),
  );
}
