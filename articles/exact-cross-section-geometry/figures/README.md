# Figure scripts

Both write directly into `img/articles/exact-cross-section-geometry/`.

| script | figure | needs |
|---|---|---|
| `make_fig1_dynwave_blind.py` | fig1 | the two Bellinge `.out` files (LEGACY and EXACT), and `compare_results.py` from an openswmm.engine checkout |
| `make_fig2_gothic_hero.py` | fig2 | only `xsect_tables.hpp` from an openswmm.engine checkout |

Both default to finding the engine checkout at `../../../../SWMM_dev`, i.e. a
sibling of this site repository; pass an explicit path if yours is elsewhere.

```
python3 make_fig2_gothic_hero.py [path/to/xsect_tables.hpp]

python3 make_fig1_dynwave_blind.py legacy.out exact.out \
        --nconduits 1015 --legacy-continuity -0.073 --exact-continuity 0.085
```
