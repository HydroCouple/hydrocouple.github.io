/**
 * Property group cards (view): one card per group the session describes (properties.mjs), rows shown
 * or hidden as the type selects say (`when`), a row's label following the shape it belongs to
 * (`labels`). A change sends every value of the group to `onApply`; a refusal is shown under the card
 * and the rows keep what was typed until it is put right.
 */
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

/**
 * @param {object} group `{key, title, fields, note, readonly}`
 * @param {(values: object) => Promise<object>} onApply writes the values; resolves to the group as
 *   the engine now holds it (the card redraws from it) or rejects with the reason
 */
export function groupCard(group, onApply) {
  const card = el("div", { className: "record-card group-card" });
  card.dataset.group = group.key;
  const inputs = new Map();
  const status = el("p", { className: "hint group-status", role: "status" });
  const rows = new Map();
  for (const f of group.fields) {
    let input;
    if (f.type === "choice") {
      input = el("select");
      const known = f.choices.some(([v]) => v === f.value);
      if (!known) input.add(new Option(f.value ? f.value : "— choose —", f.value ?? ""));
      for (const [v, label] of f.choices) input.add(new Option(label, v));
      input.value = f.value ?? "";
    } else if (f.type === "text") input = el("input", { type: "text", value: f.value ?? "", spellcheck: false });
    else input = el("input", { type: "number", step: "any", value: String(f.value ?? 0) });
    input.disabled = !!group.readonly || !!f.readonly;
    const caption = el("span", { textContent: f.label });
    const unit = el("small", { textContent: f.unit ? " " + f.unit : "" });
    caption.append(unit);
    const row = el("label", { className: "prop" }, caption, input);
    input.setAttribute("aria-label", f.label + " (" + group.title.toLowerCase() + ")");
    rows.set(f.name, { row, caption, unit, field: f, input });
    inputs.set(f.name, input);
  }
  const value = (name) => inputs.get(name)?.value;
  /** Show the rows the type selects call for, with the label of the chosen shape. */
  const sync = () => {
    for (const { row, caption, unit, field, input } of rows.values()) {
      const on = !field.when || field.when.in.includes(value(field.when.name));
      row.hidden = !on;
      const label = field.labels?.[value(field.when?.name)] ?? field.label;
      caption.firstChild.textContent = label;
      input.setAttribute("aria-label", label + " (" + group.title.toLowerCase() + ")");
      unit.textContent = field.unit && !/slope|exponent|sides|roughness/i.test(label) ? " " + field.unit : "";
    }
  };
  const apply = async () => {
    const values = {};
    for (const f of group.fields) values[f.name] = f.type === "number" ? (inputs.get(f.name).value === "" ? "" : Number(inputs.get(f.name).value)) : inputs.get(f.name).value;
    try {
      const after = await onApply(values);
      // The card stays (a field being typed in keeps what is typed); the other fields take what the
      // engine now holds.
      status.textContent = "";
      for (const f of after.fields) {
        const input = inputs.get(f.name);
        if (!input || input === document.activeElement) continue;
        if (f.type === "choice" && ![...input.options].some((o) => o.value === (f.value ?? ""))) input.add(new Option(f.value || "— choose —", f.value ?? ""));
        input.value = f.type === "number" ? String(f.value ?? 0) : (f.value ?? "");
      }
      sync();
    } catch (e) {
      status.textContent = "Not applied: " + (e.message || String(e));
    }
  };
  for (const input of inputs.values())
    input.addEventListener("change", () => {
      sync();
      apply();
    });
  sync();
  card.append(el("h4", { className: "group-title", textContent: group.title }), ...[...rows.values()].map((r) => r.row));
  if (group.note) card.append(el("p", { className: "hint", textContent: group.note }));
  card.append(status);
  return card;
}
