# Assessing SWMM2D with the UK hydraulic benchmarks

### Initial analytical evidence, a digitized laboratory comparison and a reproducible regression corpus

Codex
October 22, 2026

The first implementation of the UK Environment Agency benchmark collection now provides executable SWMM2D models for Tests 1–5, 6A and 6B. This article presents the evidence available from that work: exact equilibrium checks, a limited comparison with published laboratory measurements, and numerical diagnostics from the historical scenarios.

The assessment is still partial. Original laboratory time series, the urban Test 8 inputs, a faithful Test 7 river/floodplain implementation, and spatial and temporal sensitivity studies remain outstanding. A completed simulation or an unchanged regression result does not establish experimental validation.

A fresh download of the official model archive matched the supplied archive byte-for-byte. Both contain Tests 1–7 and the supplementary profile workbooks, without the Test 8 inputs. The [source-verification record](evidence/official-source-verification.json) preserves the URL, date and checksums.

## What is being assessed

The controlling specification is Néelz and Pender’s 2013 Environment Agency report, SC120002/R. Its ten scenarios exercise disconnected ponding, depression filling, momentum over an obstruction, flood propagation, valley flooding, dam-break flow, river/floodplain exchange, urban rainfall and sewer surcharge.

These problems provide different kinds of evidence. Test 6A includes laboratory measurements. Test 1 supplies useful equilibrium constraints. Most other scenarios provide realistic hydraulic configurations without an independent measured or exact transient solution. Their results are therefore reported as diagnostics and regression evidence.

All comparisons in this assessment use SWMM2D with measured or analytical references where available. The complete [technical evidence report](evidence/report.html) retains the scenario coverage, output register, configuration, limitations and links to the underlying data.

## Analytical equilibrium preservation

Two separate lake-at-rest checks use the same CPU full shallow-water configuration as the UK assessment: explicit integration, second-order reconstruction and one timestep tier. One lake remains fully wet; the other contains an exposed region.

For a stationary lake, velocity is zero and the water surface is constant wherever wet. Here the exact reference is the equilibrium over the represented piecewise-flat bed. The test measures whether the solver preserves that state for 60 seconds. It does not establish transient accuracy or convergence over a smooth terrain surface.

| Lake | Maximum depth drift (m) | Maximum spurious speed (m/s) | Check |
|---|---:|---:|---|
| Immersed | 3.62e-13 | 7.79e-13 | PASS |
| Emerged | 3.91e-13 | 1.89e-12 | PASS |

The targets were declared before these runs: maximum depth drift of 0.000001 m, maximum speed of 0.000001 m/s, and continuity error no greater than 0.5%. The [analytical records and reference data](evidence/analytical/scores.json) identify the executed configuration. These are supplementary tests, outside the ten UK scenarios.

## Pond filling and retention

UK Test 1 raises a boundary stage, holds it while a depression fills, and then lowers it until the pond becomes disconnected. The specified high-stage equilibrium is 10.35 m; the retained pond level is 10.25 m.

At the prescribed 10 m spacing and 20-hour duration, SWMM2D’s final level at pond point 2 was 10.254157 m, a residual of 4.157 mm relative to the specified retention level. At the end of the high-stage hold, the residual was 1.717 mm relative to 10.35 m. The report preserves both residuals. Refinement and wetting/drying sensitivity are needed to distinguish the effects of the terrain representation and numerical treatment.

![Test 1: UK Figure 4.3 gauges and axes, with scoped equilibrium constraints. Dry intervals are omitted.](../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t01-uk-4-3.png)

These reference levels constrain equilibrium. They do not provide an exact hydrograph for the transient filling and draining process.

## A limited laboratory comparison

UK Test 6A represents a dam-break wave interacting with an isolated building. The specification requests 0.1 m spacing, a 120-second simulation, Manning roughness of 0.01, water-level output at six gauges, and velocity output where measurements exist.

The supplied archive contains the terrain and gauge coordinates but no original measured time series. To obtain an initial comparison, a conservative algorithm recovered only the distinctive isolated magenta diamond markers labelled as UCL measurements in Figures 4.25 and 4.26. It excluded the legend, continuous curves, and ambiguous or overlapping markers.

This recovered 611 markers, grouped into 446 samples by horizontal pixel column, across five gauge/quantity series. Most lie within the first 30 seconds. No reliable G6 markers survived recovery. The extracted points are a visibility-selected subset: the statistics below describe agreement with that subset and must not be generalized to the complete experiment.

| Gauge | Quantity | Samples | Covered time (s) | Bias | RMSE |
|---|---|---:|---:|---:|---:|
| G2 | Level (m) | 39 | 7.02 | -0.053 | 0.05729 |
| G2 | Speed (m/s) | 141 | 17.92 | 0.5953 | 0.8203 |
| G4 | Level (m) | 41 | 13.47 | -0.009843 | 0.0194 |
| G4 | Speed (m/s) | 117 | 23.01 | 0.05311 | 0.2201 |
| G5 | Level (m) | 108 | 18.88 | -0.01689 | 0.02106 |

Agreement varies substantially by gauge. In particular, the G2 subset shows material level and speed discrepancies; this assessment does not establish successful laboratory validation. Geometry, sampling and numerical-resolution effects require investigation with the original measurement records.

Bias and RMSE use the dimensional units shown in the quantity column. Predictions are sampled at the recovered observation times; intervals separated by more than one second are treated as gaps. No time shift is fitted to improve agreement.

![Test 6A: UK Figure 4.25 gauge selection, with the recoverable UCL measurement subset. G6 has no recovered markers.](../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6a-uk-4-25-full-range.png)

![Test 6A: UK Figure 4.26 speed comparison against recovered UCL markers.](../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t6a-uk-4-26-full-range.png)

Digitization uncertainty is conservatively one pixel in each axis, with physical conversions recorded per chart. Instrument uncertainty is unknown. SWMM2D’s reported speed is reconstructed from cell-edge fluxes; the original instrument and averaging metadata are still needed to establish the measurement operator. Overlapped observations, G6 and the original full records remain unavailable. Original-data recovery and an independent digitization review are required before a stronger laboratory-validation claim.

## The remaining UK scenarios

The requested coverage at this stage is shown below. PASS denotes successful numerical checks, including complete duration, nonnegative finite depths and the declared conservation checks. It is not a score of observed accuracy. Errors and unavailable cases remain part of the record.

| UK test | Numerical execution | Observed comparison |
|---|---|---|
| 1 | PASS | not applicable |
| 2 | PASS | not applicable |
| 3 | PASS | not applicable |
| 4 | PASS | not applicable |
| 5 | PASS | not applicable |
| 6A | PASS | compared |
| 6B | PASS | not applicable |
| 7 | UNAVAILABLE | unavailable |
| 8A | UNAVAILABLE | unavailable |
| 8B | UNAVAILABLE | unavailable |

For example, the independently integrated inflow volumes are 97,200 m³ for Test 2, 1,310 m³ for Test 3, 285,000 m³ for Test 4 and 9,450,000 m³ for Test 5. Agreement with these budgets tests input application and water conservation. It does not determine the correct spatial flow field.

![Test 4: the UK report’s 0.15 m depth contours at one and three hours, shown for SWMM2D as a diagnostic.](../../img/articles/uk-2d-benchmark-assessment/uk-ea-2013-t04-uk-4-12.png)

The technical report tracks the UK quantities and gauge selections, including the requested flood-front contours, valley and building-wake profiles, and additional Appendix A snapshots. Test 4 completed its full five-hour duration after an initial budget exclusion. Available counterparts are shown alongside the pending views. Its output register accounts for all 48 Chapter 4 figures and 13 tables. Unfinished counterparts and outstanding map/panel-layout checks are explicitly listed.

Test 6B is treated as a separate numerical scenario. Its geometry is enlarged from the laboratory problem, but the prescribed roughness does not preserve simple Froude-scaled similarity. Laboratory observations are therefore not relabelled as full-scale measurements.

## Retaining the evidence as the engine changes

The cases run in a dedicated suite in HydroCouple’s benchmark repository. Checks distinguish analytical equilibrium, measured goodness of fit, numerical consistency and change from an approved SWMM2D baseline.

The two complete fast cases, Tests 1 and 3, have initial numerical baselines and a separate repeated-run check. Both reproduced their saved probe values without a numerical change in this local repeat. This is initial regression evidence; cross-platform tolerance qualification remains outstanding. The [regression report](evidence/regression/report.html) records the checks and baseline scope.

The assessment uses an isolated build of base revision `0ff03ce1ba06f23bd0ffe7077f9886ca04d4cea4` plus a [documented output-cache correction](evidence/engine/output-freshness.patch). The laboratory run exposed a defect that held reported velocities on a 30-second diagnostic cadence despite more frequent output. Refreshing that derived cache when output is prepared corrected the reporting path; a small end-to-end test fails before the correction and passes afterwards. The solver advance was unchanged, and the comparisons shown here use the corrected output. Run manifests preserve binary, source, model, reference and analysis identities. Geometry, boundary treatment, sampling and output cadence are recorded so that a changed result can be investigated. Baselines require an explicit review record and are not automatically overwritten after a failure.

## Scope of the present findings

This work establishes a working regression corpus, seven completed canonical UK simulations, analytical equilibrium-preservation evidence and an exploratory comparison with part of a published laboratory dataset. It also exposes the remaining work: complete experimental records, missing urban inputs, river/floodplain coupling, geometry checks, mesh and timestep sensitivity, peak-output qualification and the unfinished UK report views.

Those limitations define the next assessment stages. The downloadable evidence separates them from the checks already completed.

## References

Néelz, S. and Pender, G. (2013). [Benchmarking the latest generation of 2D hydraulic modelling packages](https://assets.publishing.service.gov.uk/media/6033a943d3bf7f721f4b0d49/_SC120002_Benchmarking_2D_hydraulic_models_Report.pdf). Environment Agency, SC120002/R. Appendix A defines the scenarios; Chapter 4 provides the reporting views; Section 5 discusses limitations of the tests.

[Environment Agency project and source datasets](https://www.gov.uk/flood-and-coastal-erosion-risk-management-research-reports/2d-benchmarking-evaluating-the-latest-generation-of-the-hydraulic-models-for-fcrm).

Soares-Frazão and Zech (2002), isolated-building IMPACT experiment, as cited in SC120002/R. The source charts identify the recovered points as UCL measurements. Their original machine-readable records remain an acquisition priority.
