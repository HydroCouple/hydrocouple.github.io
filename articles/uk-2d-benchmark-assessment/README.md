# UK 2D benchmark assessment

This is the initial results article, with a portable technical evidence bundle. It compares SWMM2D only with analytical constraints and a conservative digitized subset of published UCL measurements. The article explicitly reports the material G2 discrepancy and incomplete scientific qualification. Source/terrain acquisition rights remain recorded as unverified; new plots are authored from the executed models. Original report artwork and competitor traces are not copied.

## Rebuild locally

From the benchmark repository, after the dated assessment, analytical and regression-repeat runs have completed:

```bash
.venv/bin/python ../hydrocouple.github.io/articles/uk-2d-benchmark-assessment/assemble.py
.venv/bin/python ../hydrocouple.github.io/articles/uk-2d-benchmark-assessment/build.py
```

`assemble.py` copies textual run evidence and the authored PNG figures into this website, then writes `article.md`. The figures live under `img/articles/uk-2d-benchmark-assessment/`. `build.py` renders `preview.html`, replaces its own article block in `articles.html`, and inserts its dated index entry while preserving the other articles and giscus identities. `--preview-only` renders the standalone review page without editing the article index.

The technical report is `evidence/report.html`; independent repeat evidence is under `evidence/regression/`, and the exact equilibrium checks under `evidence/analytical/`. Engine source identity, output-correction patch and before/after integration-test proof are under `evidence/engine/`. Binary identities are preserved, but executable binaries and raw source PDFs are not embedded in the website.

The methods-only planning draft stays local under the ignored `drafts/` directory. All ten historical scenarios remain in coverage. Test 7 coupling, missing Test 8 inputs, original laboratory records, sensitivity studies and final source-panel qualification remain outstanding. No external publication or push is performed by these builders.
