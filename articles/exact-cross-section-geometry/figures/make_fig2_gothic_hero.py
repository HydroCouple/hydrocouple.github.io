# -*- coding: utf-8 -*-
"""Figure 2 — a 2 m gothic sewer at 2% of capacity, read two ways.

Left: the section at true scale, with the band between the depth the
depth-of-area table reports and the depth implied by integrating the width
table. Right: the same disagreement across the dry-weather range.

Both curves come straight from the constants shipped in xsect_tables.hpp, so
this figure needs no model run and no engine build.

    python3 make_fig2_gothic_hero.py [path/to/xsect_tables.hpp]
"""
import re, sys, os, numpy as np, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

TABLES = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "../../../../SWMM_dev/src/engine/hydraulics/xsect_tables.hpp")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   "../../../img/articles/exact-cross-section-geometry/fig2.png")
src=open(TABLES).read()
def tab(nm):
    m=re.search(r'\b'+nm+r'\s*\[\s*\d+\s*\]\s*=\s*\{(.*?)\}',src,re.S)
    return np.array([float(v) for v in re.findall(r'-?\d*\.?\d+(?:[eE][-+]?\d+)?',m.group(1))])

H=2.0; aFull=0.6554*H*H; wMax=0.84*H
YG=tab('Y_Gothic'); alpha=np.linspace(0,1,len(YG))
WG=tab('W_Gothic'); ywn=np.linspace(0,1,len(WG))

yy=np.linspace(0,1,40001)
w=wMax*np.interp(yy,ywn,WG)
AB=np.concatenate([[0],np.cumsum(0.5*(w[1:]+w[:-1])*np.diff(yy)*H)])
def yA(f): return np.interp(f,alpha,YG)*H
def yB(f): return np.interp(np.minimum(f*aFull,AB[-1]),AB,yy)*H

INK="#25303a"; MUT="#8a97a3"; GRID="#edf0f2"
WATER="#2563b8"; WATER_F="#bcd2ee"
ORANGE="#c2410c"; ORANGE_F="#f4b992"

plt.rcParams.update({"font.family":"DejaVu Sans","font.size":11.5,
 "axes.edgecolor":MUT,"axes.labelcolor":INK,"xtick.color":MUT,"ytick.color":MUT,
 "xtick.labelcolor":INK,"ytick.labelcolor":INK,
 "axes.grid":True,"grid.color":GRID,"grid.linewidth":.8,"axes.axisbelow":True,
 "figure.facecolor":"white","axes.facecolor":"white","savefig.facecolor":"white"})

fig,(ax1,ax2)=plt.subplots(1,2,figsize=(10.8,5.9),
    gridspec_kw={"width_ratios":[0.92,1.08],"wspace":0.24})

f0=0.02
lo,hi=sorted((yA(f0),yB(f0)))

# ---------------- left: the pipe ----------------
hw=w/2
ax1.grid(False)
m=yy*H<=lo
ax1.fill_betweenx(yy[m]*H,-hw[m],hw[m],color=WATER_F,lw=0)
ax1.plot([-np.interp(lo/H,yy,hw),np.interp(lo/H,yy,hw)],[lo,lo],color=WATER,lw=2.0)
b=(yy*H>=lo)&(yy*H<=hi)
ax1.fill_betweenx(yy[b]*H,-hw[b],hw[b],color=ORANGE_F,lw=0)
ax1.plot([-np.interp(hi/H,yy,hw),np.interp(hi/H,yy,hw)],[hi,hi],color=ORANGE,lw=2.0)
ax1.plot(hw,yy*H,color=INK,lw=2.6)
ax1.plot(-hw,yy*H,color=INK,lw=2.6)
ax1.set_xlim(-1.02,1.02); ax1.set_ylim(-0.05,2.10); ax1.set_aspect("equal")
ax1.set_xlabel("width  (m)"); ax1.set_ylabel("height above invert  (m)")
ax1.set_xticks([-0.8,-0.4,0,0.4,0.8])
for s in ("top","right"): ax1.spines[s].set_visible(False)

# ---------------- right: dry-weather regime ----------------
ff=np.linspace(0,0.25,1500)
ax2.fill_between(100*ff,yA(ff),yB(ff),color=ORANGE_F,lw=0)
ax2.plot(100*ff,yA(ff),color=INK,lw=2.2)
ax2.plot(100*ff,yB(ff),color=INK,lw=2.2,ls=(0,(4,2.2)))
ax2.plot([100*f0,100*f0],[0,hi],color=ORANGE,lw=1.0,ls=(0,(2,2)))
ax2.plot(100*f0,lo,"o",ms=6.5,color=WATER,zorder=5)
ax2.plot(100*f0,hi,"o",ms=6.5,color=ORANGE,zorder=5)
ax2.set_xlim(0,25); ax2.set_ylim(0,0.68)
ax2.set_xlabel("stored water  (% of pipe capacity)")
ax2.set_ylabel("height of the water surface  (m)")
for s in ("top","right"): ax2.spines[s].set_visible(False)

plt.savefig(OUT,dpi=210,bbox_inches="tight")
print("wrote", OUT)
print("band at 2%%: %.0f mm  (%.3f -> %.3f m)"%(1000*(hi-lo),lo,hi))
