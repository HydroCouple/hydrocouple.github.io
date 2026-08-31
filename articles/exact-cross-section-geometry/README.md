# Exact and user-defined cross-section geometry for SWMM

Published at <https://www.hydrocouple.org/articles.html#exact-cross-section-geometry>.

Rebuild the page block after editing `article.md`:

```
python3 build.py
```

## Where the numbers come from

Everything in the article is measured, and falls into three groups.

**Shipped constants, no model run required.** The shape-disagreement table, the
gothic hero figure and the table point counts all come from
`src/engine/hydraulics/xsect_tables.hpp` in the openswmm.engine repository.
`figures/make_fig2_gothic_hero.py` regenerates figure 2 from that header alone
and prints the 56 mm band the article quotes.

**Bellinge, dynamic wave, 48 h, dry weather.** One input deck run twice under
`[OPTIONS] XSECT_GEOMETRY LEGACY` and `EXACT`. `figures/make_fig1_dynwave_blind.py`
takes the two resulting `.out` files and regenerates figure 1, printing every
percentage the article quotes. The two continuity errors are read from the
`.rpt` files and passed in on the command line. The `.out` files are ~180 MB
each and are not kept here.

**Per-call microbenchmarks and unit-level checks** (the compiled circle's
`|dA/dy − T|/T`, the per-shape runtimes) come from the engine's own test and
benchmark targets, at the commit the article's links are pinned to.

## Note on the two statistics in figure 1

The right panel deliberately plots two different things per quantity: the
largest difference between the two runs *at any instant*, and the change in the
*peak* itself. They differ by more than an order of magnitude, and conflating
them was the single largest error caught in review — an earlier draft described
the instantaneous statistic as a change in peak flow. If this figure is ever
regenerated or re-described, keep the two apart.
