/* Sub-tabs for long pages: one group of sections at a time.
 *
 * Markup: a <nav class="subtabs" data-subtabs> holding <button class="subtab" role="tab"
 * data-tab="ID" id="subtab-ID" aria-controls="panel-ID">, and a
 * <div class="subtab-panel" role="tabpanel" id="panel-ID" data-tab="ID"> around each group of
 * sections. Without JavaScript the bar stays hidden and every section shows.
 *
 * A URL hash that names a tab (#ID), or any element inside a panel (#planned), opens that
 * panel, so existing links into the page keep working.
 */
(function () {
  "use strict";
  var bar = document.querySelector("[data-subtabs]");
  if (!bar) return;
  var tabs = Array.prototype.slice.call(bar.querySelectorAll('[role="tab"]'));
  var panels = Array.prototype.slice.call(document.querySelectorAll(".subtab-panel[data-tab]"));
  if (!tabs.length || !panels.length) return;
  var anchor = document.createElement("div");
  anchor.className = "subtabs-anchor";
  bar.parentNode.insertBefore(anchor, bar);
  document.documentElement.classList.add("has-subtabs");

  function show(id) {
    tabs.forEach(function (t) {
      var on = t.getAttribute("data-tab") === id;
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
    });
    panels.forEach(function (p) { p.hidden = p.getAttribute("data-tab") !== id; });
  }

  function fromHash() {
    var h = decodeURIComponent(location.hash.slice(1));
    if (!h) return null;
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].getAttribute("data-tab") === h) return { tab: h, target: null };
    }
    var el = document.getElementById(h);
    var panel = el && el.closest(".subtab-panel[data-tab]");
    return panel ? { tab: panel.getAttribute("data-tab"), target: el } : null;
  }

  // Bring the start of the chosen group into view if the reader had scrolled past the bar.
  function toTop() {
    var navHeight = 64;
    var y = anchor.getBoundingClientRect().top + window.pageYOffset - navHeight;
    if (window.pageYOffset > y) window.scrollTo(0, y);
  }

  function select(id, opts) {
    show(id);
    if (opts && opts.updateHash && history.replaceState) history.replaceState(null, "", "#" + id);
    if (opts && opts.scroll) toTop();
  }

  tabs.forEach(function (t, i) {
    t.addEventListener("click", function () { select(t.getAttribute("data-tab"), { updateHash: true, scroll: true }); });
    t.addEventListener("keydown", function (e) {
      var next = null;
      if (e.key === "ArrowRight") next = tabs[(i + 1) % tabs.length];
      else if (e.key === "ArrowLeft") next = tabs[(i - 1 + tabs.length) % tabs.length];
      else if (e.key === "Home") next = tabs[0];
      else if (e.key === "End") next = tabs[tabs.length - 1];
      if (!next) return;
      e.preventDefault();
      next.focus();
      select(next.getAttribute("data-tab"), { updateHash: true, scroll: true });
    });
  });

  function openFromHash() {
    var hit = fromHash();
    if (!hit) return false;
    show(hit.tab);
    if (hit.target) hit.target.scrollIntoView();
    else toTop();
    return true;
  }

  window.addEventListener("hashchange", openFromHash);
  if (!openFromHash()) show(tabs[0].getAttribute("data-tab"));
})();
