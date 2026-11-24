import assert from "node:assert/strict";
import { test } from "node:test";
import { Timeline, clock } from "../timeline.mjs";

const frames = (n) => Array.from({ length: n }, (_, i) => ({ seconds: 60 * i }));

test("results are ready to play only with two or more frames of a finished run", () => {
  const t = new Timeline();
  assert.equal(t.ready, false, "nothing loaded");
  t.load([], 3600); // a 1D run: no frames
  assert.equal(t.ready, false);
  assert.equal(t.current, null);
  assert.equal(t.seconds, 3600);
  t.load(frames(1));
  assert.equal(t.ready, false, "one frame is shown but not playable");
  assert.equal(t.current.seconds, 0);
  t.load(frames(5));
  assert.equal(t.ready, true);
  assert.equal(t.index, 4, "a loaded run shows its last frame");
  assert.equal(t.seconds, 240);
});

test("a live run hides the results until it is loaded; its frames and clock still advance", () => {
  const t = new Timeline();
  t.load(frames(5));
  const kinds = [];
  t.addEventListener("change", (e) => kinds.push(e.detail.kind));
  t.beginLive();
  assert.equal(t.ready, false);
  assert.equal(t.frames.length, 0);
  t.push({ seconds: 0 });
  t.progress(30);
  t.push({ seconds: 60 });
  t.push({ seconds: 120 });
  assert.equal(t.ready, false, "still running");
  assert.equal(t.current.seconds, 120);
  assert.equal(t.seconds, 120);
  t.load(t.frames);
  assert.equal(t.ready, true);
  assert.deepEqual(kinds, ["frame", "frame", "clock", "frame", "frame", "frame"]);
});

test("seek clamps and stops playing; play runs to the end and stops; play from the end restarts", async () => {
  const t = new Timeline({ interval: 5 });
  t.load(frames(4));
  t.seek(-3);
  assert.equal(t.index, 0);
  t.seek(99);
  assert.equal(t.index, 3);
  t.play(); // from the last frame: starts over
  assert.equal(t.index, 0);
  assert.equal(t.playing, true);
  await new Promise((done) => t.addEventListener("change", (e) => e.detail.kind === "state" && !t.playing && done()));
  assert.equal(t.index, 3);
  assert.equal(t.playing, false);
  t.seek(1);
  t.toggle();
  assert.equal(t.playing, true);
  t.seek(2);
  assert.equal(t.playing, false, "seeking pauses");
  assert.equal(t.index, 2);
  t.beginLive();
  t.play();
  assert.equal(t.playing, false, "nothing plays while a run is live");
});

test("loading another model stops playback", () => {
  const t = new Timeline({ interval: 1000 });
  t.load(frames(3));
  t.seek(0);
  t.play();
  assert.equal(t.playing, true);
  t.load([]);
  assert.equal(t.playing, false);
  assert.equal(t.ready, false);
});

test("clock formats elapsed seconds", () => {
  assert.equal(clock(0), "00:00:00");
  assert.equal(clock(3725.9), "01:02:05");
  assert.equal(clock(21600), "06:00:00");
});
