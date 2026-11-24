/**
 * Control rule editor view (E2): the model's rule program as text, each rule checked by the engine
 * as it is typed. A view only: the model session (model.mjs) checks and stores the program.
 */
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

/** Rule blocks of a program text: each starts at a RULE line; text before the first one is refused. */
export function splitRules(text) {
  const blocks = [];
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*RULE\s/i.test(line)) blocks.push([line.trim()]);
    else if (blocks.length) blocks[blocks.length - 1].push(line.trimEnd());
    else if (line.trim() && !line.trim().startsWith(";")) throw new Error("Every rule starts with a RULE line: “" + line.trim() + "” comes before the first one.");
  }
  return blocks.map((lines) => {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    return lines.join("\n");
  });
}

/**
 * @param {object} o
 * @param {{id: string, text: string}[]} o.rules the model's rules
 * @param {(blocks: string[]) => Promise<{id: string, ok: boolean, message: string}[]>} o.onCheck
 * @param {(blocks: string[]) => Promise<void>} o.onSave rejects with the engine's message
 * @param {() => void} o.onCancel
 */
export function rulesEditor({ rules, onCheck, onSave, onCancel }) {
  const area = el("textarea", { className: "rules-text", spellcheck: false, ariaLabel: "Control rules" });
  area.value = rules.map((r) => r.text).join("\n\n");
  const verdicts = el("ul", { className: "rule-verdicts", ariaLive: "polite" });
  const message = el("p", { className: "hint record-message", role: "status" });
  let timer,
    seq = 0;
  const check = async () => {
    const mine = ++seq;
    let blocks;
    try {
      blocks = splitRules(area.value);
    } catch (e) {
      verdicts.replaceChildren();
      message.textContent = e.message;
      return;
    }
    message.textContent = "";
    const results = blocks.length ? await onCheck(blocks).catch((e) => [{ id: "?", ok: false, message: e.message }]) : [];
    if (mine !== seq) return; // a newer check is under way
    verdicts.replaceChildren(
      ...results.map((r) =>
        el("li", { className: r.ok ? "ok" : "bad" }, el("b", { textContent: r.id }), " ", r.ok ? "checked" : r.message),
      ),
    );
    if (!blocks.length) verdicts.append(el("li", { textContent: "No rules: saving removes every rule." }));
  };
  area.oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(check, 500);
  };
  const save = el("button", { type: "button", className: "primary", textContent: "Save to model" });
  const cancel = el("button", { type: "button", textContent: "Cancel" });
  cancel.onclick = onCancel;
  save.onclick = async () => {
    let blocks;
    try {
      blocks = splitRules(area.value);
    } catch (e) {
      message.textContent = e.message;
      return;
    }
    save.disabled = true;
    try {
      await onSave(blocks);
    } catch (e) {
      message.textContent = e.message || String(e);
    } finally {
      save.disabled = false;
    }
  };
  check();
  return el(
    "div",
    { className: "record-editor rules-editor" },
    el("p", {
      className: "hint",
      textContent:
        "One block per rule: RULE name, IF and AND/OR conditions, THEN and ELSE actions, an optional PRIORITY. " +
        "The engine checks each rule against the model's objects as you type. Comments are not kept when the model is saved.",
    }),
    area,
    verdicts,
    message,
    el("div", { className: "actions end" }, cancel, save),
  );
}
