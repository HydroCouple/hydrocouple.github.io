// Flow streak style (interaction phase L1): values kept in range, remembered, colors and their edge.
import assert from "node:assert/strict";
import { test } from "node:test";
import { StreakStyle, rgbOf, isLight } from "../streak-style.mjs";

test("the streak style keeps its values in range and is remembered", () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const s = new StreakStyle({ storage });
  assert.deepEqual(s.state, { density: 1, mode: "single", color: "#ffffff", ramp: "viridis", invert: false, width: 1.5, trail: 1.5, speed: 1 });
  let events = 0;
  s.addEventListener("change", () => events++);
  s.set({ density: 10, color: "#FF8800", mode: "speed", ramp: "nope", width: 0.1, trail: 9, speed: "2" });
  assert.deepEqual(s.state, { density: 4, mode: "speed", color: "#ff8800", ramp: "viridis", invert: false, width: 0.5, trail: 4, speed: 2 });
  s.set({ density: 4 });
  assert.equal(events, 1, "no event without a change");
  s.set({ color: "red", mode: "other" });
  assert.equal(s.get("color"), "#ffffff", "a color must be #rrggbb");
  assert.equal(s.get("mode"), "single");
  assert.equal(new StreakStyle({ storage }).get("density"), 4, "remembered");
  s.reset();
  assert.equal(s.get("density"), 1);
});

test("colors: hex and rgb() read alike; light colors take a dark edge", () => {
  assert.deepEqual(rgbOf("#ff8800"), [255, 136, 0]);
  assert.deepEqual(rgbOf("rgb(13,54,107)"), [13, 54, 107]);
  assert.equal(isLight([255, 255, 255]), true);
  assert.equal(isLight([255, 221, 0]), true);
  assert.equal(isLight([13, 54, 107]), false);
  assert.equal(isLight([0, 0, 0]), false);
});
