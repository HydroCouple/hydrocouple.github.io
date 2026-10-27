"""Publish completed, qualified reconstruction diagnostics with both reference subsets."""
from pathlib import Path
import csv
import hashlib
import json
import shutil


def validate(source):
    source = Path(source)
    manifest = json.loads((source / 'publication-manifest.json').read_text())
    required = {'report.html', 'summary.json', 'interpretation.json', 'experiment-design.json',
                'executed-design.json', 'replay-equivalence.json', 'diagnostic.patch',
                'qualification/summary.json', 'strict-reference/observations.csv',
                'strict-reference/observations.json', 'front-at-20s.json'}
    if manifest.get('status') != 'COMPLETE' or not required.issubset(manifest['files']):
        raise ValueError('Incomplete MUSCL evidence')
    for name, expected in manifest['files'].items():
        path = Path(name)
        if path.is_absolute() or '..' in path.parts:
            raise ValueError('Unsafe MUSCL evidence path')
        if hashlib.sha256((source / path).read_bytes()).hexdigest() != expected:
            raise ValueError('MUSCL evidence identity mismatch')
    summary = json.loads((source / 'summary.json').read_text())
    if summary.get('status') != 'COMPLETE':
        raise ValueError('Incomplete MUSCL assessment')
    replay = json.loads((source / 'replay-equivalence.json').read_text())
    if replay.get('status') != 'PASS' or any(r['changed_values'] for r in replay['fields'].values()):
        raise ValueError('Diagnostic replay differs')
    qualification = json.loads((source / 'qualification/summary.json').read_text())
    modes = {r['mode']: r for r in qualification['modes']}
    if (qualification['baseline_cpu_returncode'] != 0 or modes['baseline']['native_failures']
            or modes['baseline']['analytical_passed'] != 16):
        raise ValueError('Baseline qualification failed')
    design = json.loads((source / 'executed-design.json').read_text())
    expected = {'coarse-order2', 'coarse-order1', 'coarse-muscl-off',
                'broad-order2', 'broad-order1', 'broad-muscl-off'}
    expected |= {'coarse-' + mode for mode in design['selected_modes']}
    if set(summary['cases']) != expected:
        raise ValueError('Incomplete paired method matrix')
    accuracy_checks = {'AdmissibleLinearFieldsAreExactOnIrregularTin',
                       'TangentialLinearSurfaceAtReflectingWall', 'WallPressureUsesReconstructedBeginningState'}
    for mode in design['selected_modes']:
        row = modes[mode]
        allowed = accuracy_checks if mode in ['surface-only', 'velocity-only'] else set()
        if (not row['qualified_for_diagnostic'] or row['native_tests'] != 12
                or set(row['native_failures']) - allowed
                or row['analytical_cases'] != 16 or row['analytical_passed'] != 16):
            raise ValueError('Unqualified experiment admitted')
    refs = set()
    for name, record in summary['cases'].items():
        case = source / 'cases' / name
        metrics = json.loads((case / 'metrics.json').read_text())
        status = json.loads((case / 'status.json').read_text())
        identity = json.loads((case / 'manifest.json').read_text())
        with (case / 'probes.csv').open() as stream:
            rows = list(csv.DictReader(stream))
        if (status['state'] != 'COMPLETE' or metrics['returncode'] != 0
                or not all(metrics['checks'].values()) or len(rows) != 1800
                or float(rows[-1]['time_s']) != 30):
            raise ValueError('Incomplete hydraulic case')
        if hashlib.sha256((case / 'model.inp').read_bytes()).hexdigest() != identity['input_sha256']:
            raise ValueError('Executed input differs')
        if hashlib.sha256((case / 'driver.py').read_bytes()).hexdigest() != identity['driver_sha256']:
            raise ValueError('Executed driver differs')
        refs.add(hashlib.sha256((case / 'reference/observations.csv').read_bytes()).hexdigest())
    if len(refs) != 1:
        raise ValueError('Historical reference subsets differ')
    strict = source / 'strict-reference'
    if hashlib.sha256((strict / 'observations.csv').read_bytes()).hexdigest() != json.loads((strict / 'observations.json').read_text())['csv_sha256']:
        raise ValueError('Strict reference identity mismatch')
    interpretation = json.loads((source / 'interpretation.json').read_text())
    if interpretation.get('reviewed') is not True or any(not interpretation.get(key) for key in ['finding', 'qualification', 'accuracy', 'front', 'decision']):
        raise ValueError('MUSCL interpretation incomplete')
    return manifest


def supplement(source, here):
    source, here = Path(source), Path(here)
    manifest = validate(source)
    destination = here / 'evidence/g2-muscl'
    for name in [*manifest['files'], 'publication-manifest.json']:
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source / name, target)
    interpretation = json.loads((source / 'interpretation.json').read_text())
    return ('## First order and MUSCL on the corrected engine\n\n'
            + interpretation['finding'] + '\n\n' + interpretation['decision']
            + '\n\nThe [corrected-engine MUSCL report](evidence/g2-muscl/report.html) retains '
              'the coarse/broad paired controls, qualified limiter experiments, all available gauge '
              'comparisons, original UK reporting panels, front histories and both recovered-marker '
              'subsets. Every new comparison covers 30 seconds. Diagnostic completion does not '
              'establish convergence or replace canonical regression anchors.\n\n')
