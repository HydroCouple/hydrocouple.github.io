# UK 2D benchmark assessment

This is the initial results article, with a portable technical evidence bundle. It compares SWMM2D only with analytical constraints and a conservative digitized subset of published UCL measurements. The article explicitly reports the material G2 discrepancy and incomplete scientific qualification. Source/terrain acquisition rights remain recorded as unverified; new plots are authored from the executed models. Original report artwork and competitor traces are not copied.

The 24 October assessment replaces Test 6A/6B with the GUI's constrained TIN and restores the drawing's side-bank slopes. The other five executed UK tests retain their 22 October identities and still require mesh correction. The source and assembly histories preserve the superseded Cartesian Test 6 records. Test 6B follows the user's choice to scale elevations by 20 per the written specification; the supplied DEM's conflicting elevation array is retained as a documented source issue.

## Rebuild locally

From the benchmark repository, after the dated assessment, analytical and regression-repeat runs have completed:

```bash
.venv/bin/python ../hydrocouple.github.io/articles/uk-2d-benchmark-assessment/assemble.py
.venv/bin/python ../hydrocouple.github.io/articles/uk-2d-benchmark-assessment/build.py
```

To include the newly executed, separate W5-105 river supplement, pass
`--river results/uk_river/assessment-final-2026-10-22` to `assemble.py`.
This requires all ten executable configurations to have finalized outputs.
Its technical report and source-derived comparisons live under `evidence/river/`.
The imported Test L table contains the original published laboratory numbers;
it is separate from the digitized numbered 2D Test 6A comparison. Test J's bridge
model and Test E's analytical-reference qualification remain pending.

`assemble.py` copies textual run evidence and the authored PNG figures into this website, then writes `article.md`. The figures live under `img/articles/uk-2d-benchmark-assessment/`. `build.py` renders `preview.html`, replaces its own article block in `articles.html`, and inserts its dated index entry while preserving the other articles and giscus identities. `--preview-only` renders the standalone review page without editing the article index.

The technical report is `evidence/report.html`; independent repeat evidence is under `evidence/regression/`, and the exact equilibrium checks under `evidence/analytical/`. Engine source identity, output-correction patch and before/after integration-test proof are under `evidence/engine/`. Binary identities are preserved, but executable binaries and raw source PDFs are not embedded in the website.

The methods-only planning draft stays local under the ignored `drafts/` directory. All ten historical scenarios remain in coverage. Test 7 coupling, missing Test 8 inputs, original laboratory records, sensitivity studies and final source-panel qualification remain outstanding. No external publication or push is performed by these builders.


To include the finalized 25 October selective-wall-friction follow-up, pass
`--wall results/uk_2d/wall-assessment-2026-10-25` to `assemble.py`.
All planned cases, passing numerical checks, executed-input hashes and a
finalized `interpretation.json` are required. The supplement preserves the
same velocity operator across its own controls and treatments and keeps the
historical baseline evidence separate. Executables and HDF5 files are not
copied into the website bundle.

Rebuild the current article with both supplements retained:

```bash
.venv/bin/python ../hydrocouple.github.io/articles/uk-2d-benchmark-assessment/assemble.py \
  --river results/uk_river/assessment-final-2026-10-22 \
  --wall results/uk_2d/wall-assessment-2026-10-25
.venv/bin/python ../hydrocouple.github.io/articles/uk-2d-benchmark-assessment/build.py
```
