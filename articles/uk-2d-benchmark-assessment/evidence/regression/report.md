# UK 2D benchmark assessment — execution report

Numerical checks and SWMM2D regression. Observed fit is reported only where reference measurements or a documented digitized subset are available. No comparison with other hydraulic models.

Coverage: 2/2 requested scenarios executed; 0 compared with observations; 2 checked against reviewed own baselines.

**This is partial qualification evidence. A numerical PASS is not a measured-validation claim.**

| Case | Numerical checks | Continuity (%) | Own regression | Measured fit | Wall time (s) |
|---|---|---:|---|---|---:|
| uk-ea-2013-t01 | PASS | -3.32e-13 | BASELINE-PASS | not applicable | 23.82 |
| uk-ea-2013-t03 | PASS | 1.39e-13 | BASELINE-PASS | not applicable | 1.69 |

## Hardware and runtime scope

Apple M1 Max; 10 physical cores; 32 GiB installed RAM; 1 solver thread. CPU clock frequency was not fixed or recorded. Minimum recommended hardware has not been qualified.

Local wall times include I/O and may include other assessment/report/test activity. They are operational records, not isolated performance benchmarks or comparisons with other engines.

[Hardware record](hardware.json).


## Coverage and source gaps

Tests 8A/8B lack authoritative inputs in the supplied archive. Test 6A lacks original measured series; a conservative digitized subset is available. Test 7 requires faithful river/structure/coupling import. Missing cases remain UNAVAILABLE.

The figure register accounts for the complete UK Chapter 4 output contract. Generated outputs below cover executed cases only; pending counterparts are listed separately.

## Test 1: Disconnected water body

Historical spacing 10 m; 700 Cartesian quads; duration 72000 s; saved interval 60 s.

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

![Test 1 Water-surface elevation (m) histories](../../../../img/articles/uk-2d-benchmark-assessment/regression-uk-ea-2013-t01-level_m.png)

![Test 1 Speed (m/s) histories](../../../../img/articles/uk-2d-benchmark-assessment/regression-uk-ea-2013-t01-speed_mps.png)

![UK Figure 4.3 with original axes](../../../../img/articles/uk-2d-benchmark-assessment/regression-uk-ea-2013-t01-uk-4-3.png)

![UK Figure 4.3 full-range companion](../../../../img/articles/uk-2d-benchmark-assessment/regression-uk-ea-2013-t01-uk-4-3-full-range.png)

The first frame preserves the original UK time units and axis limits; the companion retains the complete ordinate range of these traces. Full-duration histories appear above.

![Test 1: Output-sampled peak depth (m)](../../../../img/articles/uk-2d-benchmark-assessment/regression-uk-ea-2013-t01-max_depth.png)

![Test 1: Output-sampled peak speed (m/s)](../../../../img/articles/uk-2d-benchmark-assessment/regression-uk-ea-2013-t01-max_speed.png)

![Test 1: Final depth (m)](../../../../img/articles/uk-2d-benchmark-assessment/regression-uk-ea-2013-t01-final_depth.png)

![Test 1 represented geometry and probes](../../../../img/articles/uk-2d-benchmark-assessment/regression-uk-ea-2013-t01-setup.png)

![Test 1 represented bed profile](../../../../img/articles/uk-2d-benchmark-assessment/regression-uk-ea-2013-t01-bed-profile.png)

![Test 1 prescribed boundary](../../../../img/articles/uk-2d-benchmark-assessment/regression-uk-ea-2013-t01-forcing.png)

[Probe data](uk-ea-2013-t01/probes.csv) · [Water-volume history](uk-ea-2013-t01/volume.csv) · [Run identity](uk-ea-2013-t01/run-manifest.json) · [Metrics](uk-ea-2013-t01/metrics.json)

[Authored probe locations](uk-ea-2013-t01/probe-locations.csv) · [Executed model](uk-ea-2013-t01/model.inp)

### Scoped equilibrium constraints

| Point 2 constraint | Time (s) | Reference level (m) | Computed level (m) | Signed residual (mm) |
|---|---:|---:|---:|---:|
| End of high-stage hold | 39600 | 10.35 | 10.351717262 | 1.717262 |
| End of canonical retention run | 72000 | 10.25 | 10.254156719 | 4.156719 |

These are finite-time residuals, with no exact transient curve or qualified pass tolerance. Mesh, terrain representation and wet/dry sensitivity are still required.

[Equilibrium comparison data](uk-ea-2013-t01/equilibrium-constraints.json).

Own baseline: checked. Observed fit: not_applicable.

## Test 3: Momentum over an obstruction

Historical spacing 5 m; 1,200 Cartesian quads; duration 900 s; saved interval 2 s.

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

![Test 3 Water-surface elevation (m) histories](../../../../img/articles/uk-2d-benchmark-assessment/regression-uk-ea-2013-t03-level_m.png)

![Test 3 Speed (m/s) histories](../../../../img/articles/uk-2d-benchmark-assessment/regression-uk-ea-2013-t03-speed_mps.png)

![UK Figure 4.8 with original axes](../../../../img/articles/uk-2d-benchmark-assessment/regression-uk-ea-2013-t03-uk-4-8-level.png)

![UK Figure 4.8 full-range companion](../../../../img/articles/uk-2d-benchmark-assessment/regression-uk-ea-2013-t03-uk-4-8-level-full-range.png)

The first frame preserves the original UK time units and axis limits; the companion retains the complete ordinate range of these traces. Full-duration histories appear above.

![UK Figure 4.8 with original axes](../../../../img/articles/uk-2d-benchmark-assessment/regression-uk-ea-2013-t03-uk-4-8-speed.png)

![UK Figure 4.8 full-range companion](../../../../img/articles/uk-2d-benchmark-assessment/regression-uk-ea-2013-t03-uk-4-8-speed-full-range.png)

The first frame preserves the original UK time units and axis limits; the companion retains the complete ordinate range of these traces. Full-duration histories appear above.

![Test 3: Output-sampled peak depth (m)](../../../../img/articles/uk-2d-benchmark-assessment/regression-uk-ea-2013-t03-max_depth.png)

![Test 3: Output-sampled peak speed (m/s)](../../../../img/articles/uk-2d-benchmark-assessment/regression-uk-ea-2013-t03-max_speed.png)

![Test 3: Final depth (m)](../../../../img/articles/uk-2d-benchmark-assessment/regression-uk-ea-2013-t03-final_depth.png)

![Test 3 represented geometry and probes](../../../../img/articles/uk-2d-benchmark-assessment/regression-uk-ea-2013-t03-setup.png)

![Test 3 represented bed profile](../../../../img/articles/uk-2d-benchmark-assessment/regression-uk-ea-2013-t03-bed-profile.png)

![Test 3 prescribed boundary](../../../../img/articles/uk-2d-benchmark-assessment/regression-uk-ea-2013-t03-forcing.png)

[Probe data](uk-ea-2013-t03/probes.csv) · [Water-volume history](uk-ea-2013-t03/volume.csv) · [Run identity](uk-ea-2013-t03/run-manifest.json) · [Metrics](uk-ea-2013-t03/metrics.json)

[Authored probe locations](uk-ea-2013-t03/probe-locations.csv) · [Executed model](uk-ea-2013-t03/model.inp)

Own baseline: checked. Observed fit: not_applicable.

## UK output register

Status below records diagnostic quantity coverage, not pixel-identical panel reproduction. Exact source axes, selected panels, contour paths and missing observations still require qualification.

[Machine-readable register](report-output-register.csv). Source pages locate captions; multipage figures may begin earlier. The display-specification record identifies individual chart pages.

| UK item | Caption PDF page | Quantity | Status | Counterpart |
|---|---:|---|---|---|
| Figure 4.1 | 28 | Terrain profile | diagnostic quantity generated; final layout pending | [view 1](../../../../img/articles/uk-2d-benchmark-assessment/regression-uk-ea-2013-t01-bed-profile.png) |
| Figure 4.2 | 28 | Stage boundary hydrograph | diagnostic quantity generated; final layout pending | [view 1](../../../../img/articles/uk-2d-benchmark-assessment/regression-uk-ea-2013-t01-forcing.png) |
| Figure 4.3 | 29 | Water-level histories at both pond probes | source gauges/sections, units and axes matched; full-range companion retained; equilibrium constraints only | [view 1](../../../../img/articles/uk-2d-benchmark-assessment/regression-uk-ea-2013-t01-uk-4-3.png) |
| Figure 4.4 | 32 | Terrain, depression probes and inflow hydrograph | pending | — |
| Figure 4.5 | 39 | 12 published depression level histories (points 4/3/2/1/8/7/6/5/12/11/10/9); all 16 retained separately | pending | — |
| Figure 4.6 | 40 | Final inundation extent | pending | — |
| Figure 4.7 | 46 | Terrain profile | diagnostic quantity generated; final layout pending | [view 1](../../../../img/articles/uk-2d-benchmark-assessment/regression-uk-ea-2013-t03-bed-profile.png) |
| Figure 4.8 | 48 | Two depression level histories and first depression speed; multipage figure | source gauges/sections, units and axes matched; full-range companion retained; diagnostic only | [view 1](../../../../img/articles/uk-2d-benchmark-assessment/regression-uk-ea-2013-t03-uk-4-8-level.png) · [view 2](../../../../img/articles/uk-2d-benchmark-assessment/regression-uk-ea-2013-t03-uk-4-8-speed.png) |
| Figure 4.9 | 51 | Domain, probes and flood distribution at 3 h | pending | — |
| Figure 4.10 | 53 | Level histories at points 1/3/5/6; multipage figure | pending | — |
| Figure 4.11 | 55 | Speed histories at points 1/3/5/6; multipage figure | pending | — |
| Figure 4.12 | 56 | 0.15 m depth contours at 1 h and 3 h | pending | — |
| Figure 4.13 | 57 | Depth section at 1 h along Figure 4.12 line | pending | — |
| Figure 4.14 | 57 | Speed section at 1 h along Figure 4.12 line | pending | — |
| Figure 4.15 | 62 | Valley map, inlet and seven probes | pending | — |
| Figure 4.16 | 64 | Level histories at points 1/3/5/7; multipage figure | pending | — |
| Figure 4.17 | 66 | Speed histories at points 1/3/4/7; multipage figure | pending | — |
| Figure 4.18 | 67 | 0.5 m peak-depth contours near points 1/2/3/6 | pending | — |
| Figure 4.19 | 68 | 3 m/s peak-speed contours in same region | pending | — |
| Figure 4.20 | 69 | Peak level and speed centreline profiles 0-2 km | pending | — |
| Figure 4.21 | 70 | Peak level and speed centreline profiles 2-5 km | pending | — |
| Figure 4.22 | 71 | Peak level and speed centreline profiles 5-10 km | pending | — |
| Figure 4.23 | 72 | Peak level and speed centreline profiles 10-15 km | pending | — |
| Figure 4.24 | 78 | Laboratory domain, gate, block and gauges | pending | — |
| Figure 4.25 | 80 | Water levels G2/G4/G5/G6, first 60 s; multipage figure | pending | — |
| Figure 4.26 | 81 | Speeds G2/G4, first 60 s | pending | — |
| Figure 4.27 | 86 | Water levels G2/G4/G5/G6; multipage figure | pending | — |
| Figure 4.28 | 87 | Speeds G2/G4 | pending | — |
| Figure 4.29 | 88 | Peak-level plan, jump and section positions | pending | — |
| Figure 4.30 | 89 | Peak level and speed section 1 | pending | — |
| Figure 4.31 | 90 | Peak level and speed section 2 | pending | — |
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
| Table 4.3 | 43 | Settings | pending | — |
| Table 4.4 | 49 | Settings | diagnostic quantity generated; final layout pending | configuration/summary above |
| Table 4.5 | 59 | Settings | pending | — |
| Table 4.6 | 75 | Settings | pending | — |
| Table 4.7 | 83 | Settings | pending | — |
| Table 4.8 | 91 | Settings | pending | — |
| Table 4.9 | 107 | Settings | pending | — |
| Table 4.10 | 116 | Settings | pending | — |
| Table 4.11 | 120 | Total manhole discharge volume | pending | — |
| Table 4.12 | 123 | Settings | pending | — |
| Table 4.13 | 126 | Run times | diagnostic quantity generated; final layout pending | configuration/summary above |

## Reproducibility and limitations

Each run manifest records the executed binaries, input and source hashes, analysis identity, solver request and platform. Where build_provenance is supplied it records the isolated source revision, documented patch and verified executed binary hashes. Without it, a checkout SHA is contextual and does not establish binary provenance. The initial assessment build includes the separately hashed derived-velocity output refresh correction: it refreshes reported velocity at output time instead of retaining a 30-second diagnostic cache and does not change solver advance. Full qualification still requires geometry and output-cadence sensitivity, original Test 6A observations and the remaining cases.

Peak fields above are maxima over saved output times. They are not certified internal-step maxima. Dry probe intervals (depth at or below 0.1 mm) are omitted from level/speed plots. The primary configuration explicitly requests CPU FULL_SWE, reconstruction order 2 and one timestep tier. Initial baselines are local regression anchors; cross-platform tolerances remain provisional.

[Environment Agency source project](https://www.gov.uk/flood-and-coastal-erosion-risk-management-research-reports/2d-benchmarking-evaluating-the-latest-generation-of-the-hydraulic-models-for-fcrm).
