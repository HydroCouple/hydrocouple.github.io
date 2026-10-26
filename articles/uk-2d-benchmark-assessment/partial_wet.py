"""Publish a completed diagnostic audit while retaining its failed physical gates."""
from pathlib import Path
import csv
import hashlib
import json
import shutil


def validate(source):
    source = Path(source)
    manifest = json.loads((source / 'publication-manifest.json').read_text())
    required = {'report.html', 'summary.json', 'design.json', 'execution.json', 'native.csv',
                'ridge-extended.csv', 'storage.csv', 'walls.csv', 'geometry-scope.json',
                'native-controls.png', 'test6-geometry.png', 'oracle-tests.log'}
    if manifest.get('state') != 'COMPLETE' or not required.issubset(manifest['files']):
        raise ValueError('Incomplete partial-wet evidence')
    for name, identity in manifest['files'].items():
        relative = Path(name)
        if relative.is_absolute() or '..' in relative.parts:
            raise ValueError('Invalid evidence path')
        if hashlib.sha256((source / relative).read_bytes()).hexdigest() != identity:
            raise ValueError('Partial-wet artifact identity mismatch: ' + name)
    summary = json.loads((source / 'summary.json').read_text())
    with (source / 'native.csv').open() as handle:
        native = list(csv.DictReader(handle))
    with (source / 'ridge-extended.csv').open() as handle:
        ridge = list(csv.DictReader(handle))
    if len(native) != 108 or len(ridge) != 24 or summary.get('state') != 'COMPLETE':
        raise ValueError('Incomplete partial-wet case matrix')
    for row in native:
        expected = .5 if row['kind'] == 'bank_release' else .2
        if (abs(float(row['final_time_s']) - expected) > 1e-12
                or float(row['max_volume_error_m3']) > 2e-11 or float(row['minimum_depth_m']) < 0):
            raise ValueError('Incomplete or invalid native run')
    failures = 0
    for row in ridge:
        if float(row['time_s']) != .001:
            raise ValueError('Incomplete ridge run')
        transfer = float(row['volume_left_initial_m3']) - float(row['volume_left_final_m3'])
        passed = (abs(transfer) <= 2e-11 if float(row['eta_left_m']) < float(row['crest_m'])
                  else transfer > 2e-11)
        failures += not passed
    if (failures != summary.get('ridge_failures') or failures == 0
            or summary.get('new_Test6_run') is not False
            or summary.get('solver_qualification') != 'VFR with FULL_SWE fails geometric dry-crest isolation; not promoted'):
        raise ValueError('Diagnostic failures or scope were misrepresented')
    return manifest


def supplement(source, here):
    source, here = Path(source), Path(here)
    manifest = validate(source)
    destination = here / 'evidence/g2-partial-wet'
    destination.mkdir(parents=True, exist_ok=True)
    for name in [*manifest['files'], 'publication-manifest.json']:
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source / name, target)
    return '''## Partially wet banks and wall pressure

The next audit completes 108 independent lake/release cases, 24 geometric-ridge checks and five geometry-oracle tests. Planar storage (VFR) preserves the tested partially wet lakes, but full SWE transfers water across a ridge above both water surfaces; selecting VFR_FACE does not prevent it. VFR alone is therefore not a qualified remedy for Test 6.

In the completed Test 6A result at 20 seconds, exact planar storage at the saved heads differs by 0.162% in the wet cells near G2; the gate-wall hydrostatic pressure integral differs from midpoint quadrature by 0.568%. Earlier sampled differences are larger: 3.139% for G2-neighborhood storage at 1 second and 7.178% for gate pressure initially. Building-wall edges have constant bed elevation and no such pressure quadrature difference. These are geometry diagnostics, not the solver's net momentum balance or evidence that the G2 discrepancy is resolved.

The [partially wet bank and wall audit](evidence/g2-partial-wet/report.html) retains every failed physical gate, complete matrices, exact integration formulas, source identities and reproducible native tests. That audit withheld promotion of a VFR-based full-SWE treatment. Subsequent Test 6 diagnosis can continue using the established FLAT/MEAN configuration; the ridge control alone does not establish the cause of G2. No new UK run, fitted coefficient, canonical input change or regression-anchor promotion is made in this audit.

'''
