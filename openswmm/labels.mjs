/**
 * Map labels: the rows of a deck's [LABELS] section, read and written as the desktop reads and writes
 * them (X Y "text" "anchor" "font" size bold italic; quoted fields, ';' starts a comment, a double
 * quote inside a label is written as a single quote).
 */
/** The tokens of one row: quoted fields keep their spaces; an empty quoted field is "". */
function tokens(line) {
  const out = [];
  let current = "",
    inToken = false,
    quoted = false;
  for (const c of line) {
    if (quoted) {
      if (c === '"') quoted = false;
      else current += c;
    } else if (c === '"') {
      quoted = inToken = true;
    } else if (c === ";") break;
    else if (/\s/.test(c)) {
      if (inToken) out.push(current);
      current = "";
      inToken = false;
    } else {
      current += c;
      inToken = true;
    }
  }
  if (inToken) out.push(current);
  return out;
}
/** Labels from the lines of a [LABELS] section (rows that are not labels are skipped). */
export function parseLabels(text) {
  const labels = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const t = tokens(line);
    if (t.length < 3 || !Number.isFinite(+t[0]) || !Number.isFinite(+t[1]) || t[0] === "" || t[1] === "") continue;
    const size = +t[5];
    labels.push({
      x: +t[0],
      y: +t[1],
      text: t[2],
      anchor: t[3] ?? "",
      font: t[4] ?? "",
      size: size > 0 ? size : 10,
      bold: /^(1|YES)$/i.test(t[6] ?? ""),
      italic: /^(1|YES)$/i.test(t[7] ?? ""),
    });
  }
  return labels;
}
/** A [LABELS] section's lines for `labels` ("" when there are none). */
export function labelsText(labels) {
  if (!labels.length) return "";
  const q = (s) => '"' + String(s ?? "").replaceAll('"', "'") + '"';
  return [
    ";;X-Coord          Y-Coord            Label",
    ...labels.map((l) => [String(l.x).padEnd(18), String(l.y).padEnd(18), q(l.text), q(l.anchor), q(l.font), String(l.size), l.bold ? "1" : "0", l.italic ? "1" : "0"].join(" ")),
  ].join("\n");
}
/** The [LABELS] lines of a whole deck's text. */
export function deckLabels(deck) {
  const lines = [];
  let on = false;
  for (const line of String(deck || "").split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith("[")) on = t.toUpperCase() === "[LABELS]";
    else if (on) lines.push(line);
  }
  return parseLabels(lines.join("\n"));
}
