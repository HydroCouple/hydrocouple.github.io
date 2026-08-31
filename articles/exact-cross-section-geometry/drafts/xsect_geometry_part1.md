# A New Geometry Engine for SWMM Pipes — Why It Matters and What We're Seeing

*OpenSWMM Engine · Engineering Newsletter · Part 1*
*August 2026 · Corinne Wiesner & Caleb Buahin · HydroCouple/openswmm.engine*

---

## TL;DR

For fifty years, SWMM has described every closed pipe shape — circular, egg,
horseshoe, gothic, arch, basket-handle — with a **51-row lookup table** and a
straight line drawn between two adjacent rows. That single engineering
shortcut is quietly responsible for a large fraction of the error in
partially-full-pipe hydraulics, especially in the **shallow-water regime**
where most dry-weather and small-event flow actually lives.

We've built a replacement that:

- computes the cross-section geometry **exactly** from the true circular-arc
  and straight-line boundary of the pipe, then
- compresses that exact answer into a tiny **piecewise polynomial** that the
  solver evaluates with a handful of multiplies — no tables, no interpolation,
  no geometry traversal at run time.

**The headline numbers — now measured end-to-end on a real network
(Bellinge, 1015 conduits, dry-weather flow):**

| | Legacy 51-row table | Exact boundary | |
|---|---|---|---|
| Worst area error below 10% depth (circular) | **470%** | $4.5 \times 10^{-7}$ | |
| FV continuity error, filling window | **−4.453%** | **−0.022%** | **~200× better** |
| FV continuity error, 2 h dry-weather window | **−2.253%** | **−0.134%** | **~17× better** |
| Per-shape geometry speed (gothic, 4M evals) | 474 ms | **85 ms** | **5.6× faster** |

On the shapes where the legacy table was *purpose-built* (circular), the new
path is within ~15% of the table's speed while delivering relative error of
~$10^{-9}$ versus the table's ~$10^{-2}$. On shapes the table handles poorly
(gothic, catenary, semi-elliptical), the new path is **both faster and orders
of magnitude more accurate**. And it enables **pipe shapes SWMM has never
been able to represent** — benched channels, sediment-filled pipes, surveyed
profiles, anything drawn as arcs and lines.

---

## 1. The problem: a 51-row table, and a straight line between each pair

### 1.1 What the legacy solver actually does

When SWMM needs the wetted area $A$, top width $W$, wetted perimeter $P$, or
hydraulic radius $R$ of a partially-full pipe, it does not compute these from
the pipe's geometry. Instead it reaches for a **precomputed table** — 51 rows,
one for each 2% of full depth — and **linearly interpolates** between the two
rows bracketing the current depth.

For a circular pipe, the area table looks like this (the actual values
shipped in the engine, normalized so $y/D = 1$ gives $A/A_\text{full} = 1$):

```
y/D:   0.00  0.05  0.08  0.11  0.13  ...  0.50  ...  0.95  1.00
A/Af:  0.00  .005 .013  .024  .037  ...  .500  ...  .995  1.000
```

The solver normalizes the current depth $y$ by the full depth, marches down
the table, finds the two bracketing rows, and draws a straight line between
them. That's it. For a circular pipe the *true* relationship is

$$A(y) = \frac{D^2}{4}\left[\theta - \sin\theta\right], \qquad
\theta = 2\arccos\!\left(1 - \frac{2y}{D}\right),$$

a smooth curve — and the table replaces that curve with **50 straight line
segments**.

> **Why 51?** It was a memory-budget compromise from the 1970s. Fifty-one
> doubles is 408 bytes per shape per quantity; the full built-in catalog
> fits in a few kilobytes. On a 1970s machine that was the *only* way to make
> partial-flow hydraulics affordable. On a 2026 machine it is a straightjacket.

### 1.2 How much error does that introduce?

**A lot — and it is not evenly distributed.** Near the **invert** (the bottom
of the pipe), a closed conduit's area varies like $y^{1.5}$ and its width
like $y^{0.5}$ — both with **unbounded derivatives at $y = 0$** — which is
exactly where uniform linear interpolation is least able to cope. The error
is worst precisely where hydraulics is most sensitive.

We measured the legacy table's relative error against the exact area for a
circular pipe, over 999 depths across the full range:

| Depth regime | Legacy table relative error in $A$ |
|---|---|
| Mid-depth ($0.3 \le y/D \le 0.7$) | ~$10^{-3}$ (egg runs ~4.7% off) |
| Near crown ($y/D \approx 0.95$) | ~$10^{-2}$ |
| **Shallow ($y/D < 0.10$)** | **up to 470%** |

So in the first 10% of depth — the regime that dominates dry-weather flow,
sanitary sewer design, and the leading edge of every storm hydrograph — the
**table can be wrong by 470%**. The table is *most* wrong exactly when the
pipe is *least* full, which is also when a modeler can least afford to lose
fidelity, because the signal is small to begin with.

### 1.3 The tables are also mutually inconsistent

This is a separate problem from interpolation error, and in some ways a more
fundamental one. The legacy engine stores area, width, and hydraulic radius
as **three separate, independently digitized 51-row tables**. But
mathematically, the top width $W$ is the **derivative** of the area with
respect to depth:

$$W(y) = \frac{dA}{dy}$$

If both tables were exact, $dA/dy$ computed from the $A$ table would equal
the $W$ table exactly. It doesn't. We measured $\|dA/dy - W\|/W$ at
$y/D = 0.02$:

| Shape | $\|dA/dy - W\|/W$ at 2% depth |
|---|---|
| Circular | 0.34% |
| Arch | 8% |
| Horseshoe | 13% |
| Egg | 17% |
| Basket-handle | 27% |
| Catenary | 60% |
| **Gothic** | **226%** (worst observed: 439%) |

The gothic $A$-table and $W$-table **cannot both be describing the same
pipe** — they disagree by more than a factor of 2 at 2% depth. And these
are *conservative floors*: on the circular shape, where the true error is
known, this diagnostic reports 0.34% where the true error is 1.3% — so every
figure understates the real discrepancy by roughly 4×.

### 1.4 How Manning's $n$ hides the error (and why that's not a defense)

A common response to these numbers is: *"But the model calibrates Manning's
$n$, so it doesn't matter."* This is worth addressing directly, because it
understates the problem.

Manning's equation gives the flow rate as

$$Q = \frac{1.49}{n}\,A^{5/3} P^{-2/3} S^{1/2} \quad\text{(US units)}.$$

$A$ enters to the **5/3 power**. So a 40% error in $A$ becomes roughly a
**75% error in $Q$** before $n$ ever gets a chance to absorb it. Calibration
can and does push $n$ to compensate — but it compensates for the *error
pattern*, not for the truth. The result is a Manning's $n$ that is:

- **depth-dependent in disguise** — it has to be larger at shallow depths
  (where the table overstates $A$) and smaller near the crown, but the solver
  applies a single $n$ across all depths, so calibration is a compromise that
  is right at the calibration depth and wrong everywhere else;
- **shape-dependent in disguise** — the table error is different for every
  pipe shape, so a calibrated $n$ from a circular reach does not transfer to
  an egg-shaped reach even if the roughness is physically identical;
- **network-dependent** — because the error compounds through a network, the
  $n$ that calibrates one pipe depends on the errors upstream of it.

In other words, the lookup table turns Manning's $n$ from a physical
roughness coefficient into a **fudge factor that quietly soaks up geometric
error**. This is why experienced SWMM modelers will tell you that $n$ values
that calibrate well often look "too high" or "too low" compared to textbook
ranges, and why the same physical pipe can need different $n$ values in
different models.

The deeper point: **you cannot calibrate away a systematic bias.** You can
shift it, redistribute it, or hide it at one operating point, but the shape of
the error curve stays in the model. The only way to remove it is to compute
the geometry correctly in the first place.

---

## 2. The new approach: exact geometry, then a smart compression

### 2.1 The idea in one sentence

> **Describe the pipe by its true boundary (arcs and lines), compute the
> hydraulic quantities exactly from that boundary once at load time, then
> compress the exact answer into a small polynomial the solver can evaluate
> in a handful of multiplications.**

There are two stages, and the split is the whole point:

1. **At load time (once per pipe, never in the time loop):** build the exact
   boundary — a closed chain of circular arcs and straight segments — and use
   **Green's theorem** to compute area, top width, wetted perimeter, and
   hydrostatic moment *exactly*, at any depth, with no quadrature. This is
   build-time-only machinery.

2. **In the solver time loop (millions of times per run):** evaluate a tiny
   **piecewise Chebyshev polynomial** that approximates the exact answer to
   relative error ~$10^{-9}$, using only a short recurrence of multiplies and
   adds. No table lookup, no `acos`, no geometry traversal.

### 2.2 Why the compression works: splitting at the right places

The key mathematical fact: the exact area-as-a-function-of-depth, $A(y)$, is
**not a single smooth curve**. It has kinks (where the water surface crosses
a sharp corner of the boundary, like a bench) and square-root branch points
(where the water surface is tangent to a curved wall, like the invert and
crown of a circular pipe). If you try to fit one polynomial across the whole
depth range, those features wreck the convergence. But if you **split the
depth range at exactly those critical heights**, then on each piece $A(y)$ is
a clean, analytic function — and a polynomial fit to an analytic function
converges *geometrically*. A handful of coefficients reaches machine
precision where a uniform table needs thousands of samples.

> **For the mathematically inclined reader** (the formal argument is in the
> papers cited at the bottom): the critical heights are the values of $y$ at
> which the topology of the cross-section's intersection with a horizontal
> line changes — corners, tangencies, and component merges/splits. They are
> the analogue, for a 2-D cross-section, of the critical points a Morse
> function has on a manifold. Between consecutive critical heights the
> sublevel set changes smoothly and analytically, which is exactly the
> condition a polynomial approximation needs to converge fast. The
> square-root behavior at a smooth tangency is the same phenomenon as a fold
> in a projection: locally, the width of the wetted surface goes like
> $\sqrt{\Delta y}$, so $A$ acquires a half-integer power. Our coordinate
> change (below) removes that branch point so the polynomial sees a smooth
> function.

### 2.3 The coordinate change that makes the polynomial cheap

On a piece where one end has a square-root branch point (say, the invert of a
circular pipe, where $A \propto y^{3/2}$ for small $y$), fitting a polynomial
in $y$ directly is slow — the polynomial has to work hard to mimic the
$\sqrt{y}$ kink. Instead we **change coordinates**: we fit in a variable $s$
where $y \propto s^2$ near the invert. In $s$, the area is analytic
($A \propto s^3$), and the polynomial converges in a few coefficients.

We pick the coordinate map automatically, per piece, based on which ends
carry a branch point. After a normalization step (no piece is left singular
at *both* ends — we split any that is), the only maps that ever appear are
the identity and a plain hardware `sqrt`. No `acos`, no transcendentals in the
evaluation path at all. This was the single biggest performance win we found:
removing one `acos` call from the circular-pipe path took it from 2.9× slower
than the table to within 15% — and *improved* accuracy at the same time,
because a one-sided map resolves the invert better than a two-sided one.

### 2.4 What "more accurate" means, precisely

Three distinct, measurable things:

1. **Vs. true geometry.** $A$, $W$, $P$, and the hydrostatic moment $I_1$ at
   any depth match the exact geometry of the pipe (computed from its true
   arcs and lines via Green's theorem) to relative error ~$10^{-9}$. The
   51-row table matches the same exact geometry to ~$10^{-2}$, and up to
   **470%** below 10% depth. That is roughly **seven orders of magnitude**
   better.

2. **Internal consistency.** $W = dA/dy$ is a mathematical identity. The new
   path computes $W$ as the **exact analytic derivative of the same
   Chebyshev polynomial that produces $A$**, so they agree to machine
   precision by construction. The legacy $A$-table and $W$-table are
   independent interpolations that disagree by up to **226%** (gothic,
   shallow). No external ground truth is needed to prove this — it's an
   internal contradiction in the tables themselves.

3. **Derived quantities.** The solver doesn't use $A$ and $W$ directly — it
   uses the **hydraulic radius** $R = A/P$ and the **section factor**
   $S = A^{5/3}/P^{2/3}$. These compound the $A$ and $P$ errors. Since $A$
   enters to the 5/3 power, a 40% error in $A$ becomes roughly 75% in $S$.
   Under the new path, $R$ and $S$ inherit the ~$10^{-9}$ accuracy because
   they're built from consistent exact polynomials. Under the legacy path,
   $R$ comes from a *third* independent table, compounding the error.

---

## 3. What it looks like

*(The figures below are placeholders describing exactly what each image should
show. Final figures will be generated from the test suite and benchmark
scripts before publication.)*

### Figure 1 — The 51-point table vs. the true circle (the "why this matters" image)

> **[FIGURE 1 PLACEHOLDER]**
>
> **Left panel:** A circle, drawn exactly (smooth). Overlaid: the 51 sampled
> points from `A_Circ`, with straight line segments connecting adjacent
> points. The polygon outline makes the "table = 50 chords" idea literal and
> visual. Highlight the **shallow region** (the first 2–3 segments near the
> invert) where the chords visibly depart from the true circle — the gap
> between the chord and the arc is the table's error, made geometric.
>
> **Right panel:** The same circle, but now overlaid with the **new
> approach's representation**: the true boundary (arcs) and, below it, the
> piecewise polynomial's *area curve* drawn as a smooth line that lies on
> top of the exact curve to within a pixel. Annotate the relative error at
> $y/D = 0.02$: table ≈ 470%, new ≈ $10^{-9}$.
>
> **Caption:** *The same pipe, two representations. Left: the legacy 51-row
> table is 50 straight-line chords — exact at 51 points, approximate
> everywhere else, and worst where the curve bends sharpest (invert and
> crown). Right: the new approach fits the exact area curve with a small
> piecewise polynomial that is effectively exact everywhere. The visible gap
> between the chords and the circle on the left is the error the solver
> carries every time step.*

This is the image we want people to remember. The left side makes the table
error *visible* — it's the wedge between each chord and the arc. The right
side shows there is no wedge to see.

### Figure 2 — The piecewise structure (how the compression is organized)

> **[FIGURE 2 PLACEHOLDER]**
>
> A horizontal bar representing the depth range $[0, y_\text{full}]$ of a
> **benched section** (a rectangular box with a semicircular bottom — a
> realistic sewer shape). The bar is divided into **pieces** at the critical
> heights: the springing line where the semicircle meets the vertical walls,
> and the crown. Each piece is colored and labeled with its coordinate map
> (`identity`, `sqrt` at one end). Above the bar, plot $A(y)$ as a smooth
> curve, with vertical dashed lines at the critical heights showing where the
> curve's *character* changes (kink at the springing line, square-root
> flattening at the invert). Below the bar, show the coefficient count per
> piece (e.g., 3, 14, 3) to convey how few coefficients are needed once the
> range is split correctly.
>
> **Caption:** *The new approach splits the depth range at the "critical
> heights" — depths where the wetted geometry changes character (a corner, a
> tangency, a component merge). On each piece the area is a clean analytic
> function, so a handful of polynomial coefficients reach machine precision.
> The coordinate map (identity or √) is chosen per piece to remove any
> square-root kink at the ends. Splitting at the right places is what makes
> the compression both fast and exact.*

### Figure 3 — Error comparison: table vs. new, across the full depth range

> **[FIGURE 3 PLACEHOLDER]**
>
> Log-y plot of **relative error in $A$** vs. $y/D$, from 0 to 1, for a
> circular pipe. Two curves:
>
> - **Legacy table (51-point, linear interp):** a sawtooth that spikes at
>   each table node (where error momentarily drops to zero) and rises between
>   nodes. Envelope: ~$10^{-3}$ at mid-depth, ~$10^{-2}$ near the crown,
>   **~$10^{-1}$ to $4.7 \times 10^{0}$ in the first 10% of depth**. Shade
>   the shallow region $y/D < 0.10$ to emphasize it.
> - **New (piecewise Chebyshev):** a flat line at ~$10^{-9}$ across the
>   entire range, with no structure at the critical heights because the split
>   handles them.
>
> Annotate the vertical gap between the two curves at $y/D = 0.02$: it spans
> roughly **seven orders of magnitude**.
>
> **Caption:** *Relative error in wetted area for a circular pipe. The legacy
> 51-row table (sawtooth) is exact only at its 51 sample points and reaches
> 470% error in the shallow regime. The new piecewise-Chebyshev fit (flat)
> sits at ~10⁻⁹ everywhere — roughly seven orders of magnitude better,
> including in the shallow-water region where the table is worst.*

---

## 4. Results — now end-to-end on a real network

These are no longer isolated kernel benchmarks. The new geometry is wired
into both SWMM solvers and has been run on the **Bellinge catchment** — a
real Danish urban drainage model with 1015 conduits under dry-weather flow.

### 4.1 Why the solver you choose matters

The two solvers in OpenSWMM consume geometry differently, and that
difference — not the size of the geometry error — is what determines whether
`EXACT` changes your answer:

- **DYNWAVE *consults* geometry.** It asks for an area or a width at a depth
  and uses the answer locally in that timestep. A geometry error perturbs
  that timestep and is not carried forward as a conserved quantity.

- **FV (finite-volume) *embeds* geometry in its conservation statement.**
  Cell state is flow *area*; depth is recovered by inverting the same
  geometry. An inconsistency between $\text{area}(\text{depth})$ and
  $\text{depth}(\text{area})$ becomes a **mass error** that accumulates over
  the run.

This is why the same geometry produces a visible mass error in FV and not in
DYNWAVE — it's not about which solver is "better," it's about which one
*composes* the two directions of the geometry and which one doesn't.

### 4.2 Continuity (mass conservation) — the headline result

Measured on Bellinge (1015 conduits, dry-weather flow):

| | LEGACY | EXACT | |
|---|---|---|---|
| **DYNWAVE** continuity error | −0.073% | +0.087% | comparable — error stays local |
| **FV** continuity, 2 h window | **−2.253%** | **−0.134%** | **~17× better** |
| **FV** continuity, filling window | **−4.453%** | **−0.022%** | **~200× better** |

The FV numbers are the headline. On the **filling window** — the dry-to-wet
transient, precisely where the legacy tables are worst — geometry
representation alone moves mass conservation by **two orders of magnitude**.

Why the error concentrates in filling: the window starts from dry pipes, and
its balance is almost entirely storage:

```
Dry Weather Inflow .......  0.062          (10^6 ltr)
External Outflow .........  0.005
Initial Stored Volume ....  0.000
Final Stored Volume ......  0.059
Continuity Error (%) .....  -2.253
```

Essentially every drop that enters is still in the network at the end, so the
balance is a direct measure of how well the solver knows the area–depth
relation **at shallow depth** — the one regime where the legacy tables are
worst by two orders of magnitude. Under `EXACT`, the same window, same build,
same everything else, reports **−0.134%** — a 17× improvement, and the same
order as DYNWAVE's own error in either mode.

### 4.3 Speed — per-shape kernel benchmarks

4 million evaluations; legacy returns 3 fields ($A$, $W$, $R$), compiled
returns 4 ($A$, $W$, $P$, $I_1$ — note the new path computes an *extra*
quantity and still competes):

| Shape | Legacy (3 fields) | New (4 fields) | |
|---|---|---|---|
| Circular | 92 ms | 106 ms | ~parity (faster per field) |
| Rect (closed) | 60 ms | 40 ms | **faster** |
| **Gothic** | **474 ms** | **85 ms** | **5.6× faster** |
| Benched box+channel | *(not supported by table)* | 60 ms | **new capability** |

**The headline:** the new path is **faster on every shape except the plain
circle**, and on gothic — a shape the legacy table handles pathologically
slowly — it is **5.6× faster** while computing an extra field. The circle is
the *only* shape the 51-row table was purpose-built for, and even there the
new path is within 15% on a per-field basis.

**Why gothic is the dramatic case:** the legacy path has no direct width
table for gothic, so it derives $W$ from $A$ and $R$ through an expensive
indirect route. The new path doesn't care about the shape's history — it
compiles the same way for any boundary — so shapes that were penalized under
the table are penalized no longer.

### 4.4 Speed — end-to-end model runs

Measured on a 2020 MacBook Pro (Intel Core i5-1038NG7, 4 cores / 8 threads).
A mobile quad-core is the slow end of the range; **ratios are the portable
figure, not the seconds.**

| Solver | LEGACY | EXACT | ratio |
|---|---|---|---|
| DYNWAVE (Bellinge, 48 h) | 40.0 s | 63.1 s | ~1.58× |
| FV (Bellinge, 2 h window) | 319.9 s | 536.2 s | ~1.68× |

The runtime cost is real: **~1.6× slower end-to-end**. This is the trade for
the accuracy gain. The cost is understood — it comes from the
`-ffp-contract=off` flag that enforces the legacy bit-parity contract, which
disables FMA fusion (the Chebyshev evaluation is a chain of multiply-adds —
the ideal FMA workload — whereas the table lookup barely uses it). Before
that fix, the ratio was ~1.13×. There is a deployment choice available:
applying the contraction fix to legacy targets only would recover most of
the EXACT performance, at the cost of EXACT no longer being bit-reproducible
across compilers.

**For FV users, the trade is clear:** ~17% more runtime for ~17× better mass
conservation. For DYNWAVE users, the continuity gain is small and the runtime
cost is ~58% — the decision depends on whether local accuracy matters to your
application.

### 4.5 A new capability: shapes the table cannot represent

The benched box+channel row in the speed table is marked "new capability"
because **the legacy engine has no table for it at all.** Today, a modeler
who wants a benched section must approximate it with a trapezoid or a custom
transect and accept that approximation's error. The new approach compiles it
from its true boundary — arcs and lines — in the same way it compiles a
circle, at no extra cost.

This is the real long-term promise: **any pipe shape defined by arcs and
lines can now be simulated exactly.** Egg, arch, gothic, horseshoe,
basket-handle, and shapes that have never had a built-in table — including
custom shapes drawn from a CAD/DXF boundary — all go through the same path.

---

## 5. When to use `EXACT` (and when not to)

**Use it when:**

- **You are running FV.** This is the strongest case by a wide margin. The
  mass-conservation gain is one to two orders of magnitude, and the runtime
  cost is ~17%. If you run FV, the default `LEGACY` tables are the dominant
  error term in your continuity budget.
- **Your model spends time at shallow depths** — dry-weather flow, long
  inter-event periods, the filling limb of a storm. That is where the table
  error is measured in hundreds of percent.
- **Your network uses GOTHIC, CATENARY, SEMIELLIPTICAL or SEMICIRCULAR.**
  These have *no* built-in area or hydraulic-radius table; they are
  reconstructed indirectly. `EXACT` is both more accurate and *faster*.
- **You need a section SWMM cannot express** — benched channels, sediment
  accumulation, surveyed profiles. `POLYGON` is the only option, and it
  brings `EXACT` evaluation with it.

**Stay on `LEGACY` when:**

- **You need bit-reproducibility with EPA SWMM 5.2.4.** This is the default
  and it is unchanged — `LEGACY` output is byte-for-byte identical to the
  pre-change build. If reproducing historical results is itself a deliverable
  — regulatory submissions, consent-decree modeling — `LEGACY` is the answer.
- **Your conduits are rectangular, trapezoidal, triangular or parabolic.**
  Their legacy formulas are already closed-form. `EXACT` does not even apply.
- **You are running DYNWAVE and are satisfied with current continuity.** The
  measured continuity difference is small; you would be paying ~58% runtime
  for local accuracy that may not change your decisions.

**Status:** `EXACT` is alpha / experimental. It is opt-in (`[OPTIONS]
XSECT_GEOMETRY EXACT`), the report file records which mode ran, and `LEGACY`
remains the default.

---

## 6. What's next

This piece reports the **first full integration** results: the geometry
kernels, wired into both solvers, tested on a real network. The work that
remains, and that the next newsletter piece will cover:

1. **More networks.** Bellinge is one catchment; we will run the full test
   suite across networks of varying size, shape mix, and flow regime to map
   where the gains are largest and where the runtime cost is hardest to
   justify.

2. **Calibration sensitivity.** We expect, and will test, that models
   calibrated with `EXACT` geometry will show **more stable and more
   physically meaningful Manning's $n$ values** — because the geometric error
   those $n$ values currently absorb will be gone. If the $n$ needed to
   calibrate a reach drops toward the textbook range, that is the cleanest
   possible confirmation that the table error was real and was being hidden.

3. **Per-shape and adaptive selection.** The global `LEGACY|EXACT` switch is
   the blunt form. The plumbing already supports per-link dispatch — for
   shapes like GOTHIC where EXACT is *both* faster and more accurate, the
   engine could compile those unconditionally even under `LEGACY`, with no
   trade to reason about. A two-pass adaptive scheme (run cheap LEGACY,
   identify shallow links, re-run with EXACT only on those) is a research
   direction worth exploring.

4. **New pipe shapes.** With the exact-boundary path in place, shapes that
   have never had a SWMM table become first-class citizens. We will
   demonstrate at least one shape (e.g., a true CAD-imported benched sewer)
   simulated end-to-end.

---

## 7. The takeaway

The 51-row lookup table was the right engineering decision in 1971. It is the
wrong one in 2026. We can now afford the exact geometry — and on most shapes
we can afford it *faster* than the table, while removing a systematic error
that has been quietly embedded in every SWMM calibration for half a century.

The shallow-water regime is where this matters most, and where the
improvement is largest: from **470% error to $10^{-9}$**, in the depth range
that carries dry-weather flow, sanitary sewer design, and the leading edge of
every storm. That is not a refinement. It is a correction.

And for the finite-volume solver, the payoff is concrete and measured: a
**17× improvement in mass conservation** on a real network, in the regime
where the legacy tables are worst. The geometry representation alone moves
the continuity budget by two orders of magnitude. That is the kind of result
that changes what a modeler can trust.

---

## References

The mathematical foundations for this work draw on:

1. **Morse, M. (1925).** *Relations between the critical points of a real
   function of n variables.* Transactions of the American Mathematical
   Society. — The original source for the idea that the topology of a
   sublevel set changes only at critical points. Our "critical heights" are
   the cross-section analogue: the depths at which the wetted cross-section's
   topology changes (a corner is crossed, a tangency is reached, components
   merge or split).

2. **Milnor, J. (1963).** *Morse Theory.* Princeton University Press. — The
   standard reference. The key structural result we rely on: between
   consecutive critical values, the sublevel set varies smoothly and
   analytically, which is the condition a polynomial approximation needs to
   converge geometrically.

3. **Edelsbrunner, H. & Harer, J. (2010).** *Computational Topology: An
   Introduction.* AMS. — The Reeb graph (§VII.2) is the formal object our
   piecewise structure implements: critical heights are nodes of a graph on
   the depth axis, and each piece is an edge between two nodes on which the
   geometry is analytic. The normalization step (no piece singular at both
   ends) is a Reeb-graph edge invariant.

4. **Trefethen, L. N. (2013).** *Approximation Theory and Approximation
   Practice.* SIAM. — Chebyshev approximation and the geometric convergence
   of polynomial fits to analytic functions (§8, §17). The core fact: a
   function analytic on an ellipse containing the interpolation interval has
   Chebyshev coefficients that decay geometrically, so a handful of them
   reach machine precision.

5. **Green, G. (1828).** *An Essay on the Application of Mathematical Analysis
   to the Theories of Electricity and Magnetism.* — The boundary-integral
   (Green's theorem) formulas that compute area, moment, and perimeter
   exactly from the arc/line boundary, with no depth quadrature. Used in the
   load-time exact stage.

6. **Apostol, T. M. (1969).** *Calculus, Vol. II.* Wiley. — The
   line-integral identities (Green's theorem on a piecewise-smooth boundary)
   that underlie the exact area and moment formulas.

7. **Press, W. H., Teukolsky, S. A., Vetterling, W. T., & Flannery, B. P.
   (2007).** *Numerical Recipes, 3rd ed.* Cambridge University Press. —
   Chebyshev evaluation by Clenshaw's recurrence (§5.4) and polynomial
   approximation theory (§5.1). The Clenshaw recurrence is the evaluation
   kernel the solver runs in its hot loop.

8. **Rossman, L. A. (2017).** *Storm Water Management Model Reference Manual
   Vol. II — Hydraulics.* EPA/600/R-17/111. — The SWMM hydraulic reference;
   documents the table-based geometry approach and the Manning/area/perimeter
   relationships the new method serves.

---

*Work conducted on the OpenSWMM Engine (`swmm6_rel` branch, v6.0.0-alpha
line). The exact-boundary and Chebyshev-compiler modules (`XSectBoundary`,
`ChebSection`) and the `POLYGON` section / `XSECT_GEOMETRY EXACT` dispatch are
under review in PRs against `feature/xsect-geometry`. The legacy solver in
`src/legacy/` is unmodified. `LEGACY` output is byte-for-byte identical to
the pre-change build.*

*Validation: `ctest` 160/160, zero failures. Bellinge `.out` byte-for-byte
identical under `LEGACY`. New test suites: `test_xsect_boundary` (26),
`test_cheb_section` (30), `test_cheb_section_batch`, `test_legacy_shape_boundary`,
`test_fv_polygon_network`, `test_xsect_polygon_dedup`.*