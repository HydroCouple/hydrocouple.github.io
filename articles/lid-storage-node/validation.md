# Validation and reproducibility — distributed LID examples

Validated locally on October 4, 2026 against the native engine library below.
The engine and GUI checkouts contain other local development changes. This
library hash identifies the actual binary used, including those local changes.
The pollutant-balance follow-up fixes are committed in the engine repository as
`10668a0c03dfe5b71c03c6386e62357e6032083e`. Website files are prepared locally,
without pushing or publishing.

Library: `libopenswmm.engine.6.0.0.dylib`

SHA-256: `aa76b2c709240076216f3c4adb0829b02821f96fba2930c5c68a49f24e28d128`

## Reproduce

From the GUI checkout:

```text
python3 docs/articles/lid-storage-node/figures/generate_examples.py
python3 docs/articles/lid-storage-node/figures/run_examples.py --library /absolute/path/to/current/libopenswmm.engine.dylib --steps 0.5 0.25 0.1
python3 docs/articles/lid-storage-node/figures/make_figures.py
```

The runner uses the native C API through Python's standard-library ctypes.
It records 30-second snapshots, report files, continuity queries and a binary
hash. It requires all runs to have no engine warnings and water and pollutant
continuity errors below 0.5%. It retains results under `results/` and deletes
expanded temporary decks and binary result files after each successful run.
The figures use the 0.1-second runs. SVG sources, PNG posters and two 64-frame
GIFs are generated with rsvg-convert and ImageMagick. Moving arrowheads indicate
flow direction only. The pollutant-fate bars show final 24-hour engine totals;
they do not animate inferred intermediate inventories.

The six decks were run at fixed routing steps of 0.5, 0.25 and 0.1 seconds. All 18 runs passed the 0.5% water/quality continuity criterion with no engine warnings; reported pollutant errors were below 0.001%. The first-storm receiving-outlet peaks and tracer timings were consistent across those runs. For the second storm and valve failure, we use the engine’s cumulative budgets: 30-second snapshots can alias rapid overflow, so their summed overflow volumes and half-export times are not used as performance metrics. The engine regression checks also passed 138 tests, including eight full-chain mass-conservation variants.

| First-storm strategy | V_BR peak (cfs) | Tracer 50% export (h) | Reacted by 24 h |
|---|---|---|---|
| Passive / free outlet | 0.0419 | 7.93 | 46.5% |
| Passive / backwater | 0.0407 | 12.56 | 59.9% |
| Timed hold | 0.0425 | 13.25 | 58.0% |
| Hold + head guard | 0.0414 | 13.37 | 58.1% |

## Second-event and failure budgets

The table uses cumulative engine totals, rather than summing aliased overflow
snapshots. Pollutant totals are rounded to 0.001 lb by the report. Mass-fate
bar lengths can therefore differ slightly from 100% after rounding.

| Case | Incoming reactive mass (lb) | Exported (lb) | Flood loss (lb) | Reacted (lb) | Stored at 24 h (lb) | Flood water (ft³) |
|---|---|---|---|---|---|---|
| Passive / free outlet | 1.347 | 0.675 | 0.000 | 0.626 | 0.046 | 0.00 |
| Passive / backwater | 1.347 | 0.491 | 0.000 | 0.807 | 0.049 | 0.00 |
| Timed hold | 1.347 | 0.516 | 0.000 | 0.781 | 0.051 | 0.00 |
| Hold + head guard | 1.347 | 0.520 | 0.000 | 0.783 | 0.045 | 0.00 |
| Second storm / guard | 3.369 | 1.888 | 0.094 | 1.307 | 0.081 | 90.46 |
| Valves stuck closed | 3.369 | 1.284 | 0.166 | 1.079 | 0.840 | 213.06 |

Seepage, evaporation and initial pollutant mass are zero in these decks.
The BOTTOM boundary is closed. External water totals can include clean
backflow from the receiver; pulse volume alone is not the full boundary budget.
For field work, account for all transfers over a common assessment horizon.
These synthetic models do not simulate receiving-water ecology or groundwater
pollutant fate. Tracer export time is not mean hydraulic residence time.

## Overflow convergence check

Four additional runs query cumulative emergency-weir flow statistics, avoiding aliasing of 30-second snapshots. They use the same engine binary. The weirs have no reverse flow. Both bypass and flooding totals differ by less than 0.1% between the 0.25 and 0.1-second steps. See `overflow_totals.json`.

| Case | Step (s) | Emergency-weir volume (ft³) | Flooding (ft³) |
|---|---|---|---|
| 05_repeat_storm | 0.25 | 679.85 | 90.52 |
| 05_repeat_storm | 0.10 | 679.87 | 90.46 |
| 06_stuck_closed | 0.25 | 1343.91 | 213.10 |
| 06_stuck_closed | 0.10 | 1343.94 | 213.06 |

## Pollutant correction

- Boundary water carrying LAST concentration into a LID is now booked as an
  external pollutant source. ZERO boundary mode explicitly supplies clean water.
- Zero-volume links connected to LIDs use consistently solved current mobile
  mixtures for donor and recipient mass. Provisional iterations restore mass
  inventories and counters; outlet treatment is booked only once.
- The LID dry-node path retains the concentration needed to export freshly
  percolated water even when final mobile volume is below the legacy dry cutoff.
- Weir and rating-outlet ports use their physical subtype crest, including
  layer-anchor synchronization, rather than an unrelated generic offset.
- Floating-point cancellation of a fully captured external load is clamped
  only within 64 machine epsilons; it is not treated as a negative source.
- A failed coupled quality iteration warns explicitly. Passing these tests is
  not a universal accuracy guarantee for arbitrary networks or treatment rules.

The pre-correction diagnostic had about −21% conservative-tracer continuity
error in an aggregate/backwater train, and about +10.6% in a media-drainage
case. Those were separate diagnostic decks, not the final tutorial geometry.
They motivated the regression fixtures and are not used as before/after
performance comparisons in the article.

## Engine regression results

| Suite | Tests passed |
|---|---|
| LID nodes | 25 |
| Quality routing | 21 |
| Treatment | 32 |
| Hotstart | 39 |
| Outfall backflow | 5 |
| LID water age | 6 |
| LID heat | 10 |
| Total | 138 |

The new chain regression covers MEDIA / AGGREGATE × low / high tailwater ×
ZERO / LAST boundary quality. It checks final balances for both constituents,
and conservative-tracer inventory during every routing step to 0.1% of input
mass. Separate focused cases cover sub-litre percolation drainage and weir
anchor changes. Existing ordinary-node quality paths remain on their prior
routing branch.

## Source scope and further reading

Current native implementation: engine `src/engine/hydrology/LidNode.cpp`,
`LidNodeTreatment.cpp`, `quality/QualityRouting.cpp`, and
`core/SWMMEngine.cpp`. Engine `plans/LID_StorageNode_Redesign.md` contains
superseded proposals as well as the implementation design; current Chapter 6
and the supplied decks describe the actual syntax.

Groundwater closing remarks are based on the local engine input reference:
`[2D_AQUIFER_OPTIONS]`, `[2D_AQUIFER]`, `[2D_AQUIFER_NODE]` and
`[2D_AQUIFER_LINKS]`. MESH mode represents one aquifer cell beneath each mesh
cell, with lateral flow and configurable surface/network exchanges. The
article proposes future investigations rather than claiming a validated
coupled LID–groundwater or groundwater treatment demonstration here.

Article research references are linked directly to EPA, the journal DOI and
the authors' preprint. Their findings motivate the questions; all numerical
results and animations in this bundle come from our synthetic example runs.
