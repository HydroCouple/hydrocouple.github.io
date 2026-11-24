/**
 * Result playback. `Timeline` is the model: a run's surface frames, the one shown, the playback state
 * and the run clock. `timelineBar` is the view: the time bar under the map, shown only when there are
 * results to play (two or more frames of a finished or reopened run), with its controls sending
 * changes to the model. Events: `change` with `detail.kind` = frame | clock | state.
 */
/** Elapsed seconds as hh:mm:ss. */
export const clock = (s) =>
  [Math.floor(s / 3600), Math.floor(s / 60) % 60, Math.floor(s) % 60].map((n) => String(n).padStart(2, "0")).join(":");

export class Timeline extends EventTarget {
  /** @param {{interval?: number}} [o] milliseconds per frame while playing */
  constructor({ interval = 130 } = {}) {
    super();
    this.interval = interval;
    this.frames = [];
    this.index = -1;
    this.seconds = 0;
    this.live = false;
    this.timer = null;
  }
  emit(kind) {
    this.dispatchEvent(new CustomEvent("change", { detail: { kind } }));
  }
  /** The frame shown, or null. */
  get current() {
    return this.frames[this.index] ?? null;
  }
  /** Results to play: a finished or reopened run with at least two frames. */
  get ready() {
    return !this.live && this.frames.length >= 2;
  }
  get playing() {
    return this.timer !== null;
  }
  /** A finished or reopened run's frames (none for a 1D run or a model not run); shows the last. */
  load(frames = [], seconds = 0) {
    this.halt();
    this.live = false;
    this.frames = frames;
    this.index = frames.length - 1;
    this.seconds = this.current?.seconds ?? seconds;
    this.emit("frame");
  }
  /** A run that takes over the map has started: its frames arrive with push(). */
  beginLive() {
    this.halt();
    this.live = true;
    this.frames = [];
    this.index = -1;
    this.seconds = 0;
    this.emit("frame");
  }
  push(frame) {
    this.frames.push(frame);
    this.index = this.frames.length - 1;
    this.seconds = frame.seconds;
    this.emit("frame");
  }
  /** The running model's clock between frames. */
  progress(seconds) {
    this.seconds = seconds;
    this.emit("clock");
  }
  /** Show frame `i` (clamped) and stop playing. */
  seek(i) {
    this.pause();
    this.show(i);
  }
  show(i) {
    if (!this.frames.length) return;
    this.index = Math.min(this.frames.length - 1, Math.max(0, Math.round(i)));
    this.seconds = this.current.seconds;
    this.emit("frame");
  }
  /** Play from the shown frame (from the first when at the end) to the last, then stop. */
  play() {
    if (!this.ready || this.playing) return;
    if (this.index >= this.frames.length - 1) this.show(0);
    this.timer = setInterval(() => {
      if (this.index + 1 >= this.frames.length) this.pause();
      else this.show(this.index + 1);
    }, this.interval);
    this.emit("state");
  }
  pause() {
    if (this.halt()) this.emit("state");
  }
  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }
  halt() {
    if (this.timer === null) return false;
    clearInterval(this.timer);
    this.timer = null;
    return true;
  }
}

/** The time bar (#timebar and its controls) for `timeline`. */
export function timelineBar(timeline) {
  const $ = (id) => document.getElementById(id);
  const bar = $("timebar"),
    slider = $("time"),
    play = $("play");
  play.onclick = () => timeline.toggle();
  $("first").onclick = () => timeline.seek(0);
  $("last").onclick = () => timeline.seek(timeline.frames.length - 1);
  slider.oninput = () => timeline.seek(+slider.value);
  function update() {
    const ready = timeline.ready,
      n = timeline.frames.length;
    bar.hidden = !ready;
    slider.max = String(Math.max(0, n - 1));
    slider.value = String(Math.max(0, timeline.index));
    for (const control of [slider, play, $("first"), $("last")]) control.disabled = !ready;
    $("clock").value = clock(timeline.seconds);
    $("step").value = ready ? timeline.index + 1 + " / " + n : "—";
    play.classList.toggle("playing", timeline.playing);
    play.setAttribute("aria-label", timeline.playing ? "Pause" : "Play");
  }
  timeline.addEventListener("change", update);
  update();
}
