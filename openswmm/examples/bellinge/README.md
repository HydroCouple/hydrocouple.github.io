# Bellinge coupled 1D/2D example

The Bellinge catchment (Odense, Denmark): a 1D drainage network coupled to a 27,628-cell 2D overland-flow mesh, derived from the open Bellinge dataset published by the University of Southern Denmark and VCS Denmark. It is the OpenSWMM desktop GUI's bundled example (`openswmm.gui/examples/bellinge_2d/`), trimmed for the browser.

| File | Purpose |
|---|---|
| `BellingeSWMM_v021_nopervious.inp` | The SWMM model: 1D network, `[2D_*]` sections and `CRS EPSG:25832` (ETRS89 / UTM zone 32N), which places it on the basemap |
| `BellingeSWMM_v021_nopervious.2dm` | The 2D mesh the deck's `[2D_MESH_FILE]` names (OpenSWMM mesh sections) |
| `rg_bellinge_2012-06-28_30.dat` | The two rain gages' record for 28–30 June 2012, cut from the dataset's 2010–2021 record |
| `example.json` | The files the workbench loads for this example |

Differences from the desktop example (owner decision 2026-11-24): the simulation runs the storm of 29 June 2012 from 03:00 to 09:00 with the report starting at 04:00 (the desktop deck runs 29–30 June), the rain file carries three days instead of eleven years, and the deck's `THREADS` line is dropped so the browser build chooses its own thread team. Every other option, object and coordinate is the desktop's. The SRTM terrain raster of the desktop example is not referenced by the model and is not shipped.
