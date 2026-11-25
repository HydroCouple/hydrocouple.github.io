/**
 * Flow streak style (interaction phase L1), model, no DOM; the desktop's FlowStreakStyle (color, color
 * by magnitude, width, trail duration, spacing, speed). Remembered in this browser. Views (view.mjs,
 * layers-panel.mjs, streak-style-view.mjs) listen for `change` events.
 */
import { ramps } from "./depth-style.mjs";

const defaults = {
  density: 1, // × the particles a frame gets (25–400 %)
  mode: "single", // "single" color or colored "speed"
  color: "#ffffff",
  ramp: "viridis",
  invert: false,
  width: 1.5, // body width in pixels; the head is 1 px wider
  trail: 1.5, // seconds of trail
  speed: 1, // × the screen speed at the frame's reference speed
};
export class StreakStyle extends EventTarget {
  /** @param {{storage?: Storage, key?: string}} [o] where the style is remembered */
  constructor({ storage, key = "openswmm.streakStyle" } = {}) {
    super();
    this.key = key;
    try {
      this.storage = storage === undefined ? globalThis.localStorage : storage;
    } catch {
      this.storage = null;
    }
    this.state = { ...defaults };
    try {
      this.state = check({ ...defaults, ...JSON.parse(this.storage?.getItem(key) || "{}") });
    } catch {}
  }
  get(name) {
    return this.state[name];
  }
  /** Change some settings; values out of range are brought into it. */
  set(changes) {
    const next = check({ ...this.state, ...changes });
    if (JSON.stringify(next) === JSON.stringify(this.state)) return;
    this.state = next;
    try {
      this.storage?.setItem(this.key, JSON.stringify(next));
    } catch {}
    this.dispatchEvent(new CustomEvent("change", { detail: { ...changes } }));
  }
  reset() {
    this.set({ ...defaults });
  }
}
function check(s) {
  const num = (v, d, lo, hi) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
  return {
    density: num(s.density, defaults.density, 0.25, 4),
    mode: s.mode === "speed" ? "speed" : "single",
    color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color.toLowerCase() : defaults.color,
    ramp: s.ramp in ramps ? s.ramp : defaults.ramp,
    invert: !!s.invert,
    width: num(s.width, defaults.width, 0.5, 4),
    trail: num(s.trail, defaults.trail, 0.25, 4),
    speed: num(s.speed, defaults.speed, 0.25, 4),
  };
}
/** "#rrggbb" or "rgb(r,g,b)" → [r, g, b]. */
export function rgbOf(color) {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16));
  return (color.match(/\d+(\.\d+)?/g) || [0, 0, 0]).slice(0, 3).map(Number);
}
/** Light enough for a dark edge (the desktop draws its half-pixel halo for light colors). */
export const isLight = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.55;
