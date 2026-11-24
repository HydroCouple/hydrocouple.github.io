import assert from "node:assert/strict";
import { test } from "node:test";
import { PanelLayout, widths } from "../panels.mjs";

/** An in-memory Storage stand-in. */
function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    data,
  };
}

test("defaults: every panel open at the design widths", () => {
  const layout = new PanelLayout({ storage: memoryStorage() });
  for (const side of ["left", "bottom", "right"]) assert.equal(layout.isOpen(side), true);
  assert.equal(layout.width("left"), 272);
  assert.equal(layout.width("right"), 300);
});

test("widths are clamped and rounded; collapse and reopen keep the width; changes are remembered", () => {
  const storage = memoryStorage();
  const layout = new PanelLayout({ storage });
  const events = [];
  layout.addEventListener("change", (e) => events.push(e.detail.side));
  layout.setWidth("left", 401.6);
  assert.equal(layout.width("left"), 402);
  layout.setWidth("left", 5000);
  assert.equal(layout.width("left"), widths.max);
  layout.setWidth("right", 10);
  assert.equal(layout.width("right"), widths.min);
  layout.setOpen("left", false);
  layout.toggle("left");
  assert.equal(layout.isOpen("left"), true);
  assert.equal(layout.width("left"), widths.max);
  layout.setWidth("right", widths.min); // unchanged: no event
  assert.deepEqual(events, ["left", "left", "right", "left", "left"]);
  const again = new PanelLayout({ storage });
  assert.equal(again.width("left"), widths.max);
  assert.equal(again.width("right"), widths.min);
  again.resetWidth("left");
  assert.equal(again.width("left"), 272);
});

test("the earlier saved form (open flags only) and bad values are read safely", () => {
  const layout = new PanelLayout({
    storage: memoryStorage({ "openswmm.panels": JSON.stringify({ left: false, bottom: true, right: "no", leftWidth: "wide", rightWidth: 9999 }) }),
  });
  assert.equal(layout.isOpen("left"), false);
  assert.equal(layout.isOpen("right"), true, "a non-boolean is ignored");
  assert.equal(layout.width("left"), 272, "a non-number is ignored");
  assert.equal(layout.width("right"), widths.max, "an out-of-range width is clamped");
  const broken = new PanelLayout({ storage: memoryStorage({ "openswmm.panels": "{not json" }) });
  assert.equal(broken.width("left"), 272);
  const blocked = new PanelLayout({
    storage: {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    },
  });
  blocked.setWidth("left", 300);
  assert.equal(blocked.width("left"), 300, "works for the page when storage refuses");
});
