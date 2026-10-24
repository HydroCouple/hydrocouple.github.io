# UK 2D benchmark assessment — execution report

Numerical checks and SWMM2D regression. Observed fit is reported only where reference measurements or a documented digitized subset are available. No comparison with other hydraulic models.

Coverage: 7/10 requested scenarios executed; 1 compared with observations; 0 checked against reviewed own baselines.

**This is partial qualification evidence. A numerical PASS is not a measured-validation claim.**

| Case | Numerical checks | Continuity (%) | Own regression | Measured fit | Wall time (s) |
|---|---|---:|---|---|---:|
| uk-ea-2013-t01 | PASS | -3.32e-13 | unavailable | not applicable | 19.55 |
| uk-ea-2013-t02 | PASS | -2.99e-14 | unavailable | not applicable | 243.12 |
| uk-ea-2013-t03 | PASS | 1.39e-13 | unavailable | not applicable | 0.69 |
| uk-ea-2013-t04 | PASS | 1.51e-12 | unavailable | not applicable | 1375.32 |
| uk-ea-2013-t05 | PASS | -4.53e-13 | unavailable | not applicable | 162.04 |
| uk-ea-2013-t07 | UNAVAILABLE | — | unavailable | unavailable | — |
| uk-ea-2013-t8a | UNAVAILABLE | — | unavailable | unavailable | — |
| uk-ea-2013-t8b | UNAVAILABLE | — | unavailable | unavailable | — |
| uk-ea-2013-t6a | PASS | -2.67e-12 | unavailable | compared | 746.59 |
| uk-ea-2013-t6b | PASS | 5.04e-13 | unavailable | not applicable | 1858.89 |

## Execution exclusions and failures

| Case | State | Detail |
|---|---|---|
| uk-ea-2013-t07 | UNAVAILABLE | Faithful geometry/coupling implementation pending |
| uk-ea-2013-t8a | UNAVAILABLE | Original inputs missing |
| uk-ea-2013-t8b | UNAVAILABLE | Original inputs missing |

[Assessment assembly history](assessment-history.json). This assessment retains the original run identities and identifies later complete replacement executions. Earlier evidence is preserved; incomplete runs are not scored as passes.


## Hardware and runtime scope

Apple M1 Max; 10 physical cores; 32 GiB installed RAM; 1 solver thread. CPU clock frequency was not fixed or recorded. Minimum recommended hardware has not been qualified.

Local wall times include I/O and may include other assessment/report/test activity. They are operational records, not isolated performance benchmarks or comparisons with other engines.

[Hardware record](hardware.json).


## Coverage and source gaps

Tests 8A/8B lack authoritative inputs in the supplied archive. Test 6A lacks original measured series; a conservative digitized subset is available. Test 7 requires faithful river/structure/coupling import. Missing cases remain UNAVAILABLE.

The figure register accounts for the complete UK Chapter 4 output contract. Generated outputs below cover executed cases only; pending counterparts are listed separately.

## Separate analytical equilibrium supplement

These two 60-second stationary lakes use the same CPU FULL_SWE second-order profile. The exact reference is equilibrium over the represented piecewise-flat bed; neither is a UK scenario or a transient convergence test. Predeclared limits are 1 µm depth drift, 1 µm/s spurious speed and 0.5% continuity error.

| Lake | Maximum depth drift (m) | Maximum spurious speed (m/s) | Check |
|---|---:|---:|---|
| analytic-lake-at-rest-immersed | 3.62266e-13 | 7.78523e-13 | PASS |
| analytic-lake-at-rest-emerged | 3.91215e-13 | 1.89013e-12 | PASS |

[Analytical run identities and metrics](analytical/scores.json).

## Independent repeated-run regression checks

These are separate executions against initially reviewed SWMM2D baselines. Agreement is change control, not experimental validation. Cross-platform tolerance qualification remains outstanding.

The main cohort’s own-regression column records baseline availability at execution time. Initial anchors were reviewed afterwards; the independent repeated executions below establish the actual repeat checks.

| Case | Own baseline verdict | Maximum absolute probe change |
|---|---|---:|
| uk-ea-2013-t01 | BASELINE-PASS | 0 |
| uk-ea-2013-t03 | BASELINE-PASS | 0 |
| uk-ea-2013-t6a | BASELINE-PASS | 0 |
| uk-ea-2013-t6b | BASELINE-PASS | 0 |

[Full repeated-run evidence](regression/report.html).

## Test 1: Disconnected water body

Nominal spacing 10 m; 700 Cartesian quads; duration 72000 s; saved interval 60 s.

Final volume 10127.1381 m³; independent volume residual None m³.

Maximum calendar-clock rounding to the authored output grid: 0.00100031 s.

### Configuration counterpart to UK Table 4.2

| Setting | Value |
|---|---|
| Engine revision | 0ff03ce1ba06f23bd0ffe7077f9886ca04d4cea4+output-freshness-fix |
| Platform | macOS-27.0.1-arm64-arm-64bit |
| Formulation/backend | CPU FULL_SWE, explicit |
| Requested reconstruction/tiering/CFL | Order 2 / one tier / 0.4 |
| Wet/dry and movement thresholds | 0.0001 m |
| Manning n | 0.03 |
| Nominal mesh / active cells | 10.0 m / 700 |
| End time / probe output interval | 72000 s / 60.0 s |

![Test 1 Water-surface elevation (m) histories](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t01-level_m.png)

![Test 1 Speed (m/s) histories](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t01-speed_mps.png)

![UK Figure 4.3 with original axes](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t01-uk-4-3.png)

![UK Figure 4.3 full-range companion](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t01-uk-4-3-full-range.png)

The first frame preserves the original UK time units and axis limits; the companion retains the complete ordinate range of these traces. Full-duration histories appear above.

![Test 1: Output-sampled peak depth (m)](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t01-max_depth.png)

![Test 1: Output-sampled peak speed (m/s)](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t01-max_speed.png)

![Test 1: Final depth (m)](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t01-final_depth.png)

![Test 1 represented geometry and probes](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t01-setup.png)

![Test 1 represented bed profile](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t01-bed-profile.png)

![Test 1 prescribed boundary](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t01-forcing.png)

[Probe data](uk-ea-2013-t01/probes.csv) · [Water-volume history](uk-ea-2013-t01/volume.csv) · [Run identity](uk-ea-2013-t01/run-manifest.json) · [Metrics](uk-ea-2013-t01/metrics.json)

[Authored probe locations](uk-ea-2013-t01/probe-locations.csv) · [Executed model](uk-ea-2013-t01/model.inp)

### Scoped equilibrium constraints

| Point 2 constraint | Time (s) | Reference level (m) | Computed level (m) | Signed residual (mm) |
|---|---:|---:|---:|---:|
| End of high-stage hold | 39600 | 10.35 | 10.351717262 | 1.717262 |
| End of canonical retention run | 72000 | 10.25 | 10.254156719 | 4.156719 |

These are finite-time residuals, with no exact transient curve or qualified pass tolerance. Mesh, terrain representation and wet/dry sensitivity are still required.

[Equilibrium comparison data](uk-ea-2013-t01/equilibrium-constraints.json).

Own baseline: unavailable. Observed fit: not_applicable.

## Test 2: Filling floodplain depressions

Nominal spacing 20 m; 10,000 Cartesian quads; duration 172800 s; saved interval 300 s.

Final volume 97200 m³; independent volume residual 2.9336370062083006e-06 m³.

Maximum calendar-clock rounding to the authored output grid: 0.00100031 s.

### Configuration counterpart to UK Table 4.3

| Setting | Value |
|---|---|
| Engine revision | 0ff03ce1ba06f23bd0ffe7077f9886ca04d4cea4+output-freshness-fix |
| Platform | macOS-27.0.1-arm64-arm-64bit |
| Formulation/backend | CPU FULL_SWE, explicit |
| Requested reconstruction/tiering/CFL | Order 2 / one tier / 0.4 |
| Wet/dry and movement thresholds | 0.0001 m |
| Manning n | 0.03 |
| Nominal mesh / active cells | 20.0 m / 10000 |
| End time / probe output interval | 172800 s / 300.0 s |

![Test 2 Water-surface elevation (m) histories](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t02-level_m.png)

![Test 2 Speed (m/s) histories](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t02-speed_mps.png)

![UK Figure 4.5 with original axes](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t02-uk-4-5-a.png)

![UK Figure 4.5 full-range companion](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t02-uk-4-5-a-full-range.png)

The first frame preserves the original UK time units and axis limits; the companion retains the complete ordinate range of these traces. Full-duration histories appear above.

![UK Figure 4.5 with original axes](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t02-uk-4-5-b.png)

![UK Figure 4.5 full-range companion](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t02-uk-4-5-b-full-range.png)

The first frame preserves the original UK time units and axis limits; the companion retains the complete ordinate range of these traces. Full-duration histories appear above.

![UK Figure 4.5 with original axes](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t02-uk-4-5-c.png)

![UK Figure 4.5 full-range companion](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t02-uk-4-5-c-full-range.png)

The first frame preserves the original UK time units and axis limits; the companion retains the complete ordinate range of these traces. Full-duration histories appear above.

![Test 2: Output-sampled peak depth (m)](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t02-max_depth.png)

![Test 2: Output-sampled peak speed (m/s)](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t02-max_speed.png)

![Test 2: Final depth (m)](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t02-final_depth.png)

![Test 2 represented geometry and probes](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t02-setup.png)

![Test 2 final inundation extent](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t02-uk-4-6.png)

![Test 2 prescribed boundary](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t02-forcing.png)

[Probe data](uk-ea-2013-t02/probes.csv) · [Water-volume history](uk-ea-2013-t02/volume.csv) · [Run identity](uk-ea-2013-t02/run-manifest.json) · [Metrics](uk-ea-2013-t02/metrics.json)

[Authored probe locations](uk-ea-2013-t02/probe-locations.csv) · [Executed model](uk-ea-2013-t02/model.inp)

Own baseline: unavailable. Observed fit: not_applicable.

## Test 3: Momentum over an obstruction

Nominal spacing 5 m; 1,200 Cartesian quads; duration 900 s; saved interval 2 s.

Final volume 1310.00002 m³; independent volume residual 1.647043768571166e-05 m³.

Maximum calendar-clock rounding to the authored output grid: 0.00100031 s.

### Configuration counterpart to UK Table 4.4

| Setting | Value |
|---|---|
| Engine revision | 0ff03ce1ba06f23bd0ffe7077f9886ca04d4cea4+output-freshness-fix |
| Platform | macOS-27.0.1-arm64-arm-64bit |
| Formulation/backend | CPU FULL_SWE, explicit |
| Requested reconstruction/tiering/CFL | Order 2 / one tier / 0.4 |
| Wet/dry and movement thresholds | 0.0001 m |
| Manning n | 0.01 |
| Nominal mesh / active cells | 5.0 m / 1200 |
| End time / probe output interval | 900 s / 2.0 s |

![Test 3 Water-surface elevation (m) histories](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t03-level_m.png)

![Test 3 Speed (m/s) histories](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t03-speed_mps.png)

![UK Figure 4.8 with original axes](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t03-uk-4-8-level.png)

![UK Figure 4.8 full-range companion](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t03-uk-4-8-level-full-range.png)

The first frame preserves the original UK time units and axis limits; the companion retains the complete ordinate range of these traces. Full-duration histories appear above.

![UK Figure 4.8 with original axes](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t03-uk-4-8-speed.png)

![UK Figure 4.8 full-range companion](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t03-uk-4-8-speed-full-range.png)

The first frame preserves the original UK time units and axis limits; the companion retains the complete ordinate range of these traces. Full-duration histories appear above.

![Test 3: Output-sampled peak depth (m)](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t03-max_depth.png)

![Test 3: Output-sampled peak speed (m/s)](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t03-max_speed.png)

![Test 3: Final depth (m)](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t03-final_depth.png)

![Test 3 represented geometry and probes](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t03-setup.png)

![Test 3 represented bed profile](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t03-bed-profile.png)

![Test 3 prescribed boundary](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t03-forcing.png)

[Probe data](uk-ea-2013-t03/probes.csv) · [Water-volume history](uk-ea-2013-t03/volume.csv) · [Run identity](uk-ea-2013-t03/run-manifest.json) · [Metrics](uk-ea-2013-t03/metrics.json)

[Authored probe locations](uk-ea-2013-t03/probe-locations.csv) · [Executed model](uk-ea-2013-t03/model.inp)

Own baseline: unavailable. Observed fit: not_applicable.

## Test 4: Flood propagation

Nominal spacing 5 m; 80,000 Cartesian quads; duration 18000 s; saved interval 20 s.

Final volume 284999.974 m³; independent volume residual -0.026383984135463834 m³.

Maximum calendar-clock rounding to the authored output grid: 0.00100031 s.

### Configuration counterpart to UK Table 4.5

| Setting | Value |
|---|---|
| Engine revision | 0ff03ce1ba06f23bd0ffe7077f9886ca04d4cea4+output-freshness-fix |
| Platform | macOS-27.0.1-arm64-arm-64bit |
| Formulation/backend | CPU FULL_SWE, explicit |
| Requested reconstruction/tiering/CFL | Order 2 / one tier / 0.4 |
| Wet/dry and movement thresholds | 0.0001 m |
| Manning n | 0.05 |
| Nominal mesh / active cells | 5.0 m / 80000 |
| End time / probe output interval | 18000 s / 20.0 s |

![Test 4 Water-surface elevation (m) histories](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t04-level_m.png)

![Test 4 Speed (m/s) histories](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t04-speed_mps.png)

![UK Figure 4.10 with original axes](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t04-uk-4-10.png)

![UK Figure 4.10 full-range companion](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t04-uk-4-10-full-range.png)

The first frame preserves the original UK time units and axis limits; the companion retains the complete ordinate range of these traces. Full-duration histories appear above.

![UK Figure 4.11 with original axes](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t04-uk-4-11.png)

![UK Figure 4.11 full-range companion](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t04-uk-4-11-full-range.png)

The first frame preserves the original UK time units and axis limits; the companion retains the complete ordinate range of these traces. Full-duration histories appear above.

![Test 4: Output-sampled peak depth (m)](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t04-max_depth.png)

![Test 4: Output-sampled peak speed (m/s)](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t04-max_speed.png)

![Test 4: Final depth (m)](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t04-final_depth.png)

### Required Appendix A field snapshots

These are instantaneous saved fields; peak maps above have a different time basis.

![Test 4 saved fields at 1800 s](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t04-snapshot-1800s.png)

![Test 4 saved fields at 3600 s](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t04-snapshot-3600s.png)

![Test 4 saved fields at 7200 s](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t04-snapshot-7200s.png)

![Test 4 saved fields at 10800 s](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t04-snapshot-10800s.png)

![Test 4 saved fields at 14400 s](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t04-snapshot-14400s.png)

![Test 4 represented geometry and probes](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t04-setup.png)

![UK Figure 4.12 contour counterpart](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t04-uk-4-12.png)

![UK Figure 4.13 section counterpart](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t04-uk-4-13.png)

![UK Figure 4.14 section counterpart](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t04-uk-4-14.png)

![Test 4 prescribed boundary](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t04-forcing.png)

[Probe data](uk-ea-2013-t04/probes.csv) · [Water-volume history](uk-ea-2013-t04/volume.csv) · [Run identity](uk-ea-2013-t04/run-manifest.json) · [Metrics](uk-ea-2013-t04/metrics.json)

[Authored probe locations](uk-ea-2013-t04/probe-locations.csv) · [Executed model](uk-ea-2013-t04/model.inp)

Own baseline: unavailable. Observed fit: not_applicable.

## Test 5: Valley flooding

Nominal spacing 50 m; 7,643 Cartesian quads; duration 108000 s; saved interval 60 s.

Final volume 9450000 m³; independent volume residual 0.0007043108344078064 m³.

Maximum calendar-clock rounding to the authored output grid: 0.00100031 s.

Geometry/setup qualifications: Active cells selected by centre inside supplied polygon; boundary is a nominal 50 m Cartesian staircase. Inlet is mapped to exposed staircase edges near source line; total discharge normalized by selected edge length. 1 boundary cells excluded because their corners intersect source NODATA. Polygon area, inlet geometry and refinement sensitivity remain to be qualified.
### Configuration counterpart to UK Table 4.6

| Setting | Value |
|---|---|
| Engine revision | 0ff03ce1ba06f23bd0ffe7077f9886ca04d4cea4+output-freshness-fix |
| Platform | macOS-27.0.1-arm64-arm-64bit |
| Formulation/backend | CPU FULL_SWE, explicit |
| Requested reconstruction/tiering/CFL | Order 2 / one tier / 0.4 |
| Wet/dry and movement thresholds | 0.0001 m |
| Manning n | 0.04 |
| Nominal mesh / active cells | 50.0 m / 7643 |
| End time / probe output interval | 108000 s / 60.0 s |

![Test 5 Water-surface elevation (m) histories](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t05-level_m.png)

![Test 5 Speed (m/s) histories](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t05-speed_mps.png)

![UK Figure 4.16 with original axes](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t05-uk-4-16.png)

![UK Figure 4.16 full-range companion](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t05-uk-4-16-full-range.png)

The first frame preserves the original UK time units and axis limits; the companion retains the complete ordinate range of these traces. Full-duration histories appear above.

![UK Figure 4.17 with original axes](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t05-uk-4-17.png)

![UK Figure 4.17 full-range companion](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t05-uk-4-17-full-range.png)

The first frame preserves the original UK time units and axis limits; the companion retains the complete ordinate range of these traces. Full-duration histories appear above.

![Test 5: Output-sampled peak depth (m)](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t05-max_depth.png)

![Test 5: Output-sampled peak speed (m/s)](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t05-max_speed.png)

![Test 5: Final depth (m)](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t05-final_depth.png)

![Test 5 represented geometry and probes](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t05-setup.png)

![UK Figure 4.18 contour threshold, full domain](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t05-uk-4-18.png)

![UK Figure 4.19 contour threshold, full domain](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t05-uk-4-19.png)

![UK Figure 4.20 profile with original axes](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t05-uk-4-20.png)

![UK Figure 4.20 full-range profile](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t05-uk-4-20-full-range.png)

![UK Figure 4.21 profile with original axes](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t05-uk-4-21.png)

![UK Figure 4.21 full-range profile](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t05-uk-4-21-full-range.png)

![UK Figure 4.22 profile with original axes](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t05-uk-4-22.png)

![UK Figure 4.22 full-range profile](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t05-uk-4-22-full-range.png)

![UK Figure 4.23 profile with original axes](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t05-uk-4-23.png)

![UK Figure 4.23 full-range profile](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t05-uk-4-23-full-range.png)

Profile Test5CrossSection: 3/501 source points lie outside the discretized wet-domain mesh; these remain gaps.

![Test 5 prescribed boundary](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t05-forcing.png)

[Probe data](uk-ea-2013-t05/probes.csv) · [Water-volume history](uk-ea-2013-t05/volume.csv) · [Run identity](uk-ea-2013-t05/run-manifest.json) · [Metrics](uk-ea-2013-t05/metrics.json)

[Authored probe locations](uk-ea-2013-t05/probe-locations.csv) · [Executed model](uk-ea-2013-t05/model.inp)

Own baseline: unavailable. Observed fit: not_applicable.

## Test 6A: Laboratory dam break

Nominal spacing 0.1 m; 61,642 constrained Delaunay triangles; duration 120 s; saved interval 0.1 s.

Final volume 16.618 m³; independent volume residual -7.105427357601002e-15 m³.

Maximum calendar-clock rounding to the authored output grid: 0.00100031 s.

Geometry/setup qualifications: GUI constrained Delaunay triangles follow the dimensioned flume, dam abutments, 1 m opening and 0.8 by 0.4 m building rotated 64 degrees (all lengths scaled by 20 for 6B). Figure (a) defines exact straight wall geometry and 0.34 m wide / 0.155 m high side-bank slopes; pixelated DEM barrier transitions are not fitted. This is a drawing-based geometric reconstruction, not a vertexwise reproduction of the supplied DEM. Bank toes and X=0 depth discontinuity are internal mesh constraints, not walls. All exposed edges are explicit reflective WALL boundaries. Initial conditions are uniform water depths, as specified, including over the bank slopes; no fitted time shift or roughness calibration. Original measured series missing; recovered isolated UCL markers provide exploratory 6A comparison only.

GUI mesh: 31,890 vertices; minimum angle 30.000°; edge lengths 0.056782–0.15573 m; 2,138 explicit wall edges. The requested spacing is nominal, not a bound on every edge. The bank toes and release interface remain internal. [Source, generator and constraint audit](uk-ea-2013-t6a/mesh-provenance.json).

Initialization follows the local depth values stated in Appendix A.6.3, including over the side-bank slopes. The main report summary also uses the term water level. A flat water-surface initialization would be a different configuration; that sensitivity has not been tested here. The initial-condition interpretation remains explicit rather than being fitted to the measurements.

### Exploratory comparison with digitized UCL markers

Only visible isolated laboratory diamonds were recovered. Overlapped/occluded markers and G6 were omitted. These statistics describe a visibility-selected, pixel-binned subset, primarily before 30 s. They do not estimate fit to the complete original experiment. Instrument uncertainty is unknown; per-axis digitization uncertainty is conservatively one pixel. The engine reports flux-reconstructed RT0 cell speed. Original instrument and averaging metadata are still needed to confirm the measurement operator.

| Gauge | Quantity | Samples | Covered time (s) | Bias | MAE | RMSE | Maximum absolute residual |
|---|---|---:|---:|---:|---:|---:|---:|
| G2 | level_m | 39 | 7.025 | -0.0509083 | 0.0509083 | 0.0559745 | 0.0844187 |
| G2 | speed_mps | 141 | 17.916 | 0.603401 | 0.663335 | 0.818786 | 1.39759 |
| G4 | level_m | 41 | 13.469 | 0.0108824 | 0.0197091 | 0.0241411 | 0.0573151 |
| G4 | speed_mps | 117 | 23.008 | -0.142819 | 0.217449 | 0.329799 | 0.999074 |
| G5 | level_m | 108 | 18.883 | -0.00918188 | 0.0144398 | 0.0177375 | 0.0421504 |
[Recovered reference samples](uk-ea-2013-t6a/reference/observations.csv) · [Digitization audit](uk-ea-2013-t6a/reference/digitization-audit.json)

Values are dimensional: metres for levels, metres per second for speed. Observed fit remains report-only.

**G2 has material level and speed discrepancies. These results do not establish successful laboratory validation.** Original records and geometry, sampling and numerical sensitivity studies are needed to investigate the differences.

### Configuration counterpart to UK Table 4.7

| Setting | Value |
|---|---|
| Engine revision | 0ff03ce1ba06f23bd0ffe7077f9886ca04d4cea4+output-freshness-fix |
| Platform | macOS-27.0.1-arm64-arm-64bit |
| Formulation/backend | CPU FULL_SWE, explicit |
| Requested reconstruction/tiering/CFL | Order 2 / one tier / 0.4 |
| Wet/dry and movement thresholds | 0.0001 m |
| Manning n | 0.01 |
| Nominal mesh / active cells | 0.1 m / 61642 |
| End time / probe output interval | 120 s / 0.1 s |

![Test 6A Water-surface elevation (m) histories](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6a-level_m.png)

![Test 6A Speed (m/s) histories](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6a-speed_mps.png)

![UK Figure 4.25 with original axes](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6a-uk-4-25.png)

![UK Figure 4.25 full-range companion](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6a-uk-4-25-full-range.png)

The first frame preserves the original UK time units and axis limits; the companion retains the complete ordinate range of these traces. Full-duration histories appear above.

![UK Figure 4.26 with original axes](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6a-uk-4-26.png)

![UK Figure 4.26 full-range companion](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6a-uk-4-26-full-range.png)

The first frame preserves the original UK time units and axis limits; the companion retains the complete ordinate range of these traces. Full-duration histories appear above.

Figures 4.25–4.26 are reproduced with the recoverable digitized measurement subset only; G6 and the original full records remain unavailable.

![Test 6A GUI mesh and wall/internal constraints, near-field detail](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6a-constrained-mesh.png)

![Test 6A drawing versus supplied DEM cross-section](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6a-source-bed-audit.png)

At this one unobstructed source cross-section the largest sampled bed difference is 0.0176358 m. This quantifies the source interpretation locally, not a global DEM error bound. The geometry was not adjusted to improve the measured fit.

![Test 6A: Output-sampled peak water elevation (m)](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6a-max_level.png)

![Test 6A: Output-sampled peak depth (m)](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6a-max_depth.png)

![Test 6A: Output-sampled peak speed (m/s)](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6a-max_speed.png)

![Test 6A: Final depth (m)](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6a-final_depth.png)

### Required Appendix A field snapshots

These are instantaneous saved fields; peak maps above have a different time basis.

![Test 6A saved fields at 1 s](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6a-snapshot-1s.png)

![Test 6A saved fields at 2 s](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6a-snapshot-2s.png)

![Test 6A saved fields at 3 s](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6a-snapshot-3s.png)

![Test 6A saved fields at 4 s](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6a-snapshot-4s.png)

![Test 6A saved fields at 5 s](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6a-snapshot-5s.png)

![Test 6A saved fields at 10 s](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6a-snapshot-10s.png)

![Test 6A saved fields at 15 s](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6a-snapshot-15s.png)

![Test 6A saved fields at 20 s](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6a-snapshot-20s.png)

![Test 6A saved fields at 25 s](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6a-snapshot-25s.png)

![Test 6A saved fields at 30 s](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6a-snapshot-30s.png)

![Test 6A represented geometry and probes](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6a-setup.png)

[Probe data](uk-ea-2013-t6a/probes.csv) · [Water-volume history](uk-ea-2013-t6a/volume.csv) · [Run identity](uk-ea-2013-t6a/run-manifest.json) · [Metrics](uk-ea-2013-t6a/metrics.json)

[Authored probe locations](uk-ea-2013-t6a/probe-locations.csv) · [Executed model](uk-ea-2013-t6a/model.inp)

Own baseline: unavailable. Observed fit: compared.

## Test 6B: Scaled dam break

Nominal spacing 2 m; 61,642 constrained Delaunay triangles; duration 1800 s; saved interval 1 s.

Final volume 132944 m³; independent volume residual -1.6880221664905548e-09 m³.

Maximum calendar-clock rounding to the authored output grid: 0.00100031 s.

Geometry/setup qualifications: GUI constrained Delaunay triangles follow the dimensioned flume, dam abutments, 1 m opening and 0.8 by 0.4 m building rotated 64 degrees (all lengths scaled by 20 for 6B). Figure (a) defines exact straight wall geometry and 0.34 m wide / 0.155 m high side-bank slopes; pixelated DEM barrier transitions are not fitted. This is a drawing-based geometric reconstruction, not a vertexwise reproduction of the supplied DEM. Bank toes and X=0 depth discontinuity are internal mesh constraints, not walls. All exposed edges are explicit reflective WALL boundaries. Initial conditions are uniform water depths, as specified, including over the bank slopes; no fitted time shift or roughness calibration. Original measured series missing; recovered isolated UCL markers provide exploratory 6A comparison only.

GUI mesh: 31,890 vertices; minimum angle 30.000°; edge lengths 1.1356–3.1147 m; 2,138 explicit wall edges. The requested spacing is nominal, not a bound on every edge. The bank toes and release interface remain internal. [Source, generator and constraint audit](uk-ea-2013-t6b/mesh-provenance.json).

Initialization follows the local depth values stated in Appendix A.6.3, including over the side-bank slopes. The main report summary also uses the term water level. A flat water-surface initialization would be a different configuration; that sensitivity has not been tested here. The initial-condition interpretation remains explicit rather than being fitted to the measurements.

The 6B elevation interpretation is **specification**, with side banks 3.1 m high. The supplied 6A/6B DEM elevation arrays are identical, although the written specification scales all physical dimensions by 20. The user selected the written-specification scaling for this assessment. [Source-scale audit and decision](uk-ea-2013-t6b/source-scale-audit.json).

### Configuration counterpart to UK Table 4.8

| Setting | Value |
|---|---|
| Engine revision | 0ff03ce1ba06f23bd0ffe7077f9886ca04d4cea4+output-freshness-fix |
| Platform | macOS-27.0.1-arm64-arm-64bit |
| Formulation/backend | CPU FULL_SWE, explicit |
| Requested reconstruction/tiering/CFL | Order 2 / one tier / 0.4 |
| Wet/dry and movement thresholds | 0.0001 m |
| Manning n | 0.05 |
| Nominal mesh / active cells | 2.0 m / 61642 |
| End time / probe output interval | 1800 s / 1.0 s |

![Test 6B Water-surface elevation (m) histories](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6b-level_m.png)

![Test 6B Speed (m/s) histories](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6b-speed_mps.png)

![UK Figure 4.27 with original axes](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6b-uk-4-27.png)

![UK Figure 4.27 full-range companion](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6b-uk-4-27-full-range.png)

The first frame preserves the original UK time units and axis limits; the companion retains the complete ordinate range of these traces. Full-duration histories appear above.

![UK Figure 4.28 with original axes](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6b-uk-4-28.png)

![UK Figure 4.28 full-range companion](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6b-uk-4-28-full-range.png)

The first frame preserves the original UK time units and axis limits; the companion retains the complete ordinate range of these traces. Full-duration histories appear above.

![Test 6B GUI mesh and wall/internal constraints, near-field detail](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6b-constrained-mesh.png)

![Test 6B drawing versus supplied DEM cross-section](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6b-source-bed-audit.png)

At this one unobstructed source cross-section the largest sampled bed difference is 2.96262 m. This quantifies the source interpretation locally, not a global DEM error bound. The geometry was not adjusted to improve the measured fit.

![Test 6B: Output-sampled peak water elevation (m)](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6b-max_level.png)

![Test 6B: Output-sampled peak depth (m)](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6b-max_depth.png)

![Test 6B: Output-sampled peak speed (m/s)](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6b-max_speed.png)

![Test 6B: Final depth (m)](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6b-final_depth.png)

### Required Appendix A field snapshots

These are instantaneous saved fields; peak maps above have a different time basis.

![Test 6B saved fields at 60 s](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6b-snapshot-60s.png)

![Test 6B saved fields at 120 s](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6b-snapshot-120s.png)

![Test 6B saved fields at 180 s](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6b-snapshot-180s.png)

![Test 6B saved fields at 240 s](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6b-snapshot-240s.png)

![Test 6B saved fields at 300 s](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6b-snapshot-300s.png)

![Test 6B saved fields at 600 s](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6b-snapshot-600s.png)

![Test 6B saved fields at 900 s](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6b-snapshot-900s.png)

![Test 6B saved fields at 1200 s](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6b-snapshot-1200s.png)

![Test 6B represented geometry and probes](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6b-setup.png)

![UK Figure 4.30 profile with original axes](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6b-uk-4-30.png)

![UK Figure 4.30 full-range profile](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6b-uk-4-30-full-range.png)

Profile Test6BCrossSection1: 0/501 source points lie outside the discretized wet-domain mesh; these remain gaps.

![UK Figure 4.31 profile with original axes](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6b-uk-4-31.png)

![UK Figure 4.31 full-range profile](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6b-uk-4-31-full-range.png)

Profile Test6BCrossSection2: 0/501 source points lie outside the discretized wet-domain mesh; these remain gaps.

[Probe data](uk-ea-2013-t6b/probes.csv) · [Water-volume history](uk-ea-2013-t6b/volume.csv) · [Run identity](uk-ea-2013-t6b/run-manifest.json) · [Metrics](uk-ea-2013-t6b/metrics.json)

[Authored probe locations](uk-ea-2013-t6b/probe-locations.csv) · [Executed model](uk-ea-2013-t6b/model.inp)

Own baseline: unavailable. Observed fit: not_applicable.

## UK output register

Status below records diagnostic quantity coverage, not pixel-identical panel reproduction. Exact source axes, selected panels, contour paths and missing observations still require qualification.

[Machine-readable register](report-output-register.csv). Source pages locate captions; multipage figures may begin earlier. The display-specification record identifies individual chart pages.

| UK item | Caption PDF page | Quantity | Status | Counterpart |
|---|---:|---|---|---|
| Figure 4.1 | 28 | Terrain profile | diagnostic quantity generated; final layout pending | [view 1](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t01-bed-profile.png) |
| Figure 4.2 | 28 | Stage boundary hydrograph | diagnostic quantity generated; final layout pending | [view 1](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t01-forcing.png) |
| Figure 4.3 | 29 | Water-level histories at both pond probes | source gauges/sections, units and axes matched; full-range companion retained; equilibrium constraints only | [view 1](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t01-uk-4-3.png) |
| Figure 4.4 | 32 | Terrain, depression probes and inflow hydrograph | diagnostic quantity generated; final layout pending | [view 1](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t02-setup.png) · [view 2](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t02-forcing.png) |
| Figure 4.5 | 39 | 12 published depression level histories (points 4/3/2/1/8/7/6/5/12/11/10/9); all 16 retained separately | source gauges/sections, units and axes matched; full-range companion retained; diagnostic only | [view 1](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t02-uk-4-5-a.png) · [view 2](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t02-uk-4-5-b.png) · [view 3](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t02-uk-4-5-c.png) |
| Figure 4.6 | 40 | Final inundation extent | diagnostic quantity generated; final layout pending | [view 1](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t02-uk-4-6.png) |
| Figure 4.7 | 46 | Terrain profile | diagnostic quantity generated; final layout pending | [view 1](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t03-bed-profile.png) |
| Figure 4.8 | 48 | Two depression level histories and first depression speed; multipage figure | source gauges/sections, units and axes matched; full-range companion retained; diagnostic only | [view 1](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t03-uk-4-8-level.png) · [view 2](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t03-uk-4-8-speed.png) |
| Figure 4.9 | 51 | Domain, probes and flood distribution at 3 h | pending | [view 1](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t04-setup.png) · [view 2](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t04-snapshot-10800s.png) |
| Figure 4.10 | 53 | Level histories at points 1/3/5/6; multipage figure | source gauges/sections, units and axes matched; full-range companion retained; diagnostic only | [view 1](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t04-uk-4-10.png) |
| Figure 4.11 | 55 | Speed histories at points 1/3/5/6; multipage figure | source gauges/sections, units and axes matched; full-range companion retained; diagnostic only | [view 1](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t04-uk-4-11.png) |
| Figure 4.12 | 56 | 0.15 m depth contours at 1 h and 3 h | diagnostic quantity generated; final layout pending | [view 1](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t04-uk-4-12.png) |
| Figure 4.13 | 57 | Depth section at 1 h along Figure 4.12 line | diagnostic quantity generated; final layout pending | [view 1](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t04-uk-4-13.png) |
| Figure 4.14 | 57 | Speed section at 1 h along Figure 4.12 line | diagnostic quantity generated; final layout pending | [view 1](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t04-uk-4-14.png) |
| Figure 4.15 | 62 | Valley map, inlet and seven probes | diagnostic quantity generated; final layout pending | [view 1](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t05-setup.png) |
| Figure 4.16 | 64 | Level histories at points 1/3/5/7; multipage figure | source gauges/sections, units and axes matched; full-range companion retained; diagnostic only | [view 1](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t05-uk-4-16.png) |
| Figure 4.17 | 66 | Speed histories at points 1/3/4/7; multipage figure | source gauges/sections, units and axes matched; full-range companion retained; diagnostic only | [view 1](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t05-uk-4-17.png) |
| Figure 4.18 | 67 | 0.5 m peak-depth contours near points 1/2/3/6 | diagnostic quantity generated; final layout pending | [view 1](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t05-uk-4-18.png) |
| Figure 4.19 | 68 | 3 m/s peak-speed contours in same region | diagnostic quantity generated; final layout pending | [view 1](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t05-uk-4-19.png) |
| Figure 4.20 | 69 | Peak level and speed centreline profiles 0-2 km | source gauges/sections, units and axes matched; full-range companion retained; diagnostic only | [view 1](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t05-uk-4-20.png) |
| Figure 4.21 | 70 | Peak level and speed centreline profiles 2-5 km | source gauges/sections, units and axes matched; full-range companion retained; diagnostic only | [view 1](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t05-uk-4-21.png) |
| Figure 4.22 | 71 | Peak level and speed centreline profiles 5-10 km | source gauges/sections, units and axes matched; full-range companion retained; diagnostic only | [view 1](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t05-uk-4-22.png) |
| Figure 4.23 | 72 | Peak level and speed centreline profiles 10-15 km | source gauges/sections, units and axes matched; full-range companion retained; diagnostic only | [view 1](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t05-uk-4-23.png) |
| Figure 4.24 | 78 | Laboratory domain, gate, block and gauges | diagnostic quantity generated; final layout pending | [view 1](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6a-setup.png) |
| Figure 4.25 | 80 | Water levels G2/G4/G5/G6, first 60 s; multipage figure | digitized subset compared; original records/G6 incomplete; original axes and full-range frames available | [view 1](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6a-uk-4-25.png) |
| Figure 4.26 | 81 | Speeds G2/G4, first 60 s | digitized subset compared; original records/G6 incomplete; original axes and full-range frames available | [view 1](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6a-uk-4-26.png) |
| Figure 4.27 | 86 | Water levels G2/G4/G5/G6; multipage figure | source gauges/sections, units and axes matched; full-range companion retained; diagnostic only | [view 1](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6b-uk-4-27.png) |
| Figure 4.28 | 87 | Speeds G2/G4 | source gauges/sections, units and axes matched; full-range companion retained; diagnostic only | [view 1](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6b-uk-4-28.png) |
| Figure 4.29 | 88 | Peak-level plan, jump and section positions | diagnostic quantity generated; final layout pending | [view 1](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6b-setup.png) |
| Figure 4.30 | 89 | Peak level and speed section 1 | source gauges/sections, units and axes matched; full-range companion retained; diagnostic only | [view 1](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6b-uk-4-30.png) |
| Figure 4.31 | 90 | Peak level and speed section 2 | source gauges/sections, units and axes matched; full-range companion retained; diagnostic only | [view 1](../../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6b-uk-4-31.png) |
| Figure 4.32 | 95 | River levels M015/M025/M035/M045; multipage figure | pending | — |
| Figure 4.33 | 96 | River speeds M025/M035 | pending | — |
| Figure 4.34 | 98 | Floodplain 1 level histories; multipage figure | pending | — |
| Figure 4.35 | 99 | Floodplain 2 level histories | pending | — |
| Figure 4.36 | 100 | Floodplain 3 level histories | pending | — |
| Figure 4.37 | 101 | Selected speeds across floodplains | pending | — |
| Figure 4.38 | 102 | Peak-speed map | pending | — |
| Figure 4.39 | 103 | Final-depth map | pending | — |
| Figure 4.40 | 104 | Peak-depth map originally illustrating one named package | pending | — |
| Figure 4.41 | 110 | Urban DEM, point source, roads and probes | pending | — |
| Figure 4.42 | 112 | Level histories at points 1/2/3/6; multipage figure | pending | — |
| Figure 4.43 | 113 | Speed histories at points 2/6 | pending | — |
| Figure 4.44 | 114 | 0.20 m peak-depth contours | pending | — |
| Figure 4.45 | 119 | Urban DEM, pipe and manhole location | pending | — |
| Figure 4.46 | 120 | Manhole discharge history | pending | — |
| Figure 4.47 | 122 | Water levels at points 1/2/3; multipage figure | pending | — |
| Figure 4.48 | 122 | Speed at point 3 | pending | — |
| Table 4.1 | 26 | Participation | diagnostic quantity generated; final layout pending | configuration/summary above |
| Table 4.2 | 30 | Settings | diagnostic quantity generated; final layout pending | configuration/summary above |
| Table 4.3 | 43 | Settings | diagnostic quantity generated; final layout pending | configuration/summary above |
| Table 4.4 | 49 | Settings | diagnostic quantity generated; final layout pending | configuration/summary above |
| Table 4.5 | 59 | Settings | diagnostic quantity generated; final layout pending | configuration/summary above |
| Table 4.6 | 75 | Settings | diagnostic quantity generated; final layout pending | configuration/summary above |
| Table 4.7 | 83 | Settings | diagnostic quantity generated; final layout pending | configuration/summary above |
| Table 4.8 | 91 | Settings | diagnostic quantity generated; final layout pending | configuration/summary above |
| Table 4.9 | 107 | Settings | pending | — |
| Table 4.10 | 116 | Settings | pending | — |
| Table 4.11 | 120 | Total manhole discharge volume | pending | — |
| Table 4.12 | 123 | Settings | pending | — |
| Table 4.13 | 126 | Run times | diagnostic quantity generated; final layout pending | configuration/summary above |

## Reproducibility and limitations

Each run manifest records the executed binaries, input and source hashes, analysis identity, solver request and platform. Where build_provenance is supplied it records the isolated source revision, documented patch and verified executed binary hashes. Without it, a checkout SHA is contextual and does not establish binary provenance. The initial assessment build includes the separately hashed derived-velocity output refresh correction: it refreshes reported velocity at output time instead of retaining a 30-second diagnostic cache and does not change solver advance. Full qualification still requires geometry and output-cadence sensitivity, original Test 6A observations and the remaining cases.

Peak fields above are maxima over saved output times. They are not certified internal-step maxima. Dry probe intervals (depth at or below 0.1 mm) are omitted from level/speed plots. The primary configuration explicitly requests CPU FULL_SWE, reconstruction order 2 and one timestep tier. Initial baselines are local regression anchors; cross-platform tolerances remain provisional.

[Environment Agency source project](https://www.gov.uk/flood-and-coastal-erosion-risk-management-research-reports/2d-benchmarking-evaluating-the-latest-generation-of-the-hydraulic-models-for-fcrm).
