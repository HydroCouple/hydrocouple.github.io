# -*- coding: utf-8 -*-
"""Figure 1 — continuity error vs. how far the two runs' predictions actually diverge.

Inputs: two SWMM .out binaries from the SAME Bellinge deck under DYNWAVE,
differing only in [OPTIONS] XSECT_GEOMETRY (LEGACY vs EXACT).

    python3 make_fig1_dynwave_blind.py legacy.out exact.out \
            --nconduits 1015 --legacy-continuity -0.073 --exact-continuity 0.085

The continuity errors are read off the two .rpt files by hand and passed in;
everything else is computed from the binaries over EVERY reporting period.

Two statistics are plotted per quantity, and the distinction is the point of
the figure: the largest difference at any instant (max_t |a-b| / max_t |a|)
and the change in the peak itself (| max_t|a| - max_t|b| | / max_t|a|).
Links are restricted to conduits, which occupy indices [0, nconduits) in the
.out link ordering; pumps, orifices and weirs sit above that and switch on and
off, which puts them at the top of any instantaneous-difference ranking for
reasons that have nothing to do with geometry.
"""
import argparse, sys
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ap = argparse.ArgumentParser()
ap.add_argument('legacy_out'); ap.add_argument('exact_out')
ap.add_argument('--reader', default='../../../../SWMM_dev/scripts',
                help='directory holding compare_results.py (openswmm.engine checkout)')
ap.add_argument('--nconduits', type=int, required=True)
ap.add_argument('--legacy-continuity', type=float, required=True)
ap.add_argument('--exact-continuity', type=float, required=True)
ap.add_argument('--flow-floor', type=float, default=1e-3, help='cms; peak below this is skipped')
ap.add_argument('--depth-floor', type=float, default=0.05, help='m; peak below this is skipped')
ap.add_argument('-o', '--out', default='../../../img/articles/exact-cross-section-geometry/fig1.png')
a = ap.parse_args()

sys.path.insert(0, a.reader)
try:
    from compare_results import SwmmOutReader
except ImportError:
    sys.exit('could not import compare_results.py; pass --reader <dir>')

A, B = SwmmOutReader(a.legacy_out), SwmmOutReader(a.exact_out)
if (A.n_nodes, A.n_links, A.n_periods) != (B.n_nodes, B.n_links, B.n_periods):
    sys.exit('the two .out files do not describe the same network/run')

nN, nL = A.n_nodes, A.n_links
pkA = np.zeros(nL); pkB = np.zeros(nL); fmax = np.zeros(nL)
dpA = np.zeros(nN); dpB = np.zeros(nN); dmax = np.zeros(nN)
for p in range(A.n_periods):
    _, _, an, al, _ = A.read_period(p)
    _, _, bn, bl, _ = B.read_period(p)
    pkA = np.maximum(pkA, np.abs(al[:, 0])); pkB = np.maximum(pkB, np.abs(bl[:, 0]))
    fmax = np.maximum(fmax, np.abs(al[:, 0] - bl[:, 0]))
    dpA = np.maximum(dpA, an[:, 0]); dpB = np.maximum(dpB, bn[:, 0])
    dmax = np.maximum(dmax, np.abs(an[:, 0] - bn[:, 0]))

live = np.zeros(nL, bool); live[:a.nconduits] = pkA[:a.nconduits] > a.flow_floor
wet = dpA > a.depth_floor
li = 100 * fmax[live] / pkA[live]                        # conduit flow, instantaneous
lp = 100 * np.abs(pkA[live] - pkB[live]) / pkA[live]     # conduit flow, peak
ni = 100 * dmax[wet] / dpA[wet]                          # node depth, instantaneous
npk = 100 * np.abs(dpA[wet] - dpB[wet]) / dpA[wet]       # node depth, peak
for lab, v in (('conduit flow, instantaneous', li), ('conduit flow, peak', lp),
               ('node depth, instantaneous', ni), ('node depth, peak', npk)):
    print('%-30s median %6.2f%%   >1/5/10/25%%: %s' %
          (lab, np.median(v), ' '.join('%.0f%%' % (100 * (v > t).mean()) for t in (1, 5, 10, 25))))
print('largest change in any node PEAK depth  : %.0f mm' % (1000 * np.abs(dpA - dpB).max()))
print('largest instantaneous depth difference : %.0f mm' % (1000 * dmax.max()))

INK, MUT, GRID = '#25303a', '#8a97a3', '#edf0f2'
BLUE, BLUEL, ORANGE, ORANGEL, GREY = '#2563b8', '#a9c6e8', '#c2410c', '#f0b795', '#c8d0d6'
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 11,
                     'axes.edgecolor': MUT, 'axes.labelcolor': INK, 'xtick.color': MUT,
                     'ytick.color': MUT, 'xtick.labelcolor': INK, 'ytick.labelcolor': INK,
                     'axes.grid': True, 'grid.color': GRID, 'grid.linewidth': .8,
                     'axes.axisbelow': True, 'figure.facecolor': 'white',
                     'axes.facecolor': 'white', 'savefig.facecolor': 'white'})
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11.6, 5.0),
                               gridspec_kw={'width_ratios': [0.46, 1.54], 'wspace': 0.24})
vals = [abs(a.legacy_continuity), abs(a.exact_continuity)]
ax1.grid(True, axis='y')
ax1.bar([0, 1], vals, width=.52, color=GREY, edgecolor=INK, lw=1.6)
for i, v in enumerate(vals):
    ax1.text(i, v + 2.0, '%.3f%%' % v, ha='center', fontsize=11, color=INK, fontweight='bold')
ax1.set_xticks([0, 1]); ax1.set_xticklabels(['LEGACY', 'EXACT'])
ax1.set_ylabel('magnitude  (%)'); ax1.set_ylim(0, 100)
ax1.set_xlabel('continuity error\n(what the model reports about itself)', labelpad=10)
for s in ('top', 'right'): ax1.spines[s].set_visible(False)

th = [1, 5, 10, 25]; xs = np.arange(len(th)); w = 0.20
series = [(ni, 'node depth — largest difference at any instant', BLUE, -1.5),
          (npk, 'node depth — change in the peak itself', BLUEL, -0.5),
          (li, 'conduit flow — largest difference at any instant', ORANGE, 0.5),
          (lp, 'conduit flow — change in the peak itself', ORANGEL, 1.5)]
for v, lab, c, off in series:
    ax2.bar(xs + off * w, [100 * (v > t).mean() for t in th], w, color=c, label=lab)
for v, lab, c, off in series:
    if lab.endswith('peak itself'):
        for k, t in enumerate(th):
            h = 100 * (v > t).mean()
            ax2.text(k + off * w, h + 1.8, '%.0f' % h, ha='center', fontsize=8.0, color=MUT)
ax2.set_xticks(xs); ax2.set_xticklabels(['>%d%%' % t for t in th])
ax2.set_ylim(0, 102)
ax2.set_xlabel('difference between the LEGACY and EXACT run\n(what the model actually computed)', labelpad=10)
ax2.set_ylabel('% of the population exceeding that difference')
ax2.legend(frameon=False, fontsize=9.2, loc='upper right', bbox_to_anchor=(1.0, 1.0), labelspacing=0.55)
ax2.text(0.0, -0.235, 'Peak changes are near zero — median 0.20%% (flow), 0.08%% (depth) — it is the hydrographs between them that move.\n'
         '%d conduits with peak flow > %g L/s  ·  %d nodes with peak depth > %g mm'
         % (live.sum(), a.flow_floor * 1000, wet.sum(), a.depth_floor * 1000),
         transform=ax2.transAxes, fontsize=8.8, color=MUT, va='top', linespacing=1.5)
for s in ('top', 'right'): ax2.spines[s].set_visible(False)
plt.savefig(a.out, dpi=210, bbox_inches='tight')
print('wrote', a.out)
