"""Publish only completed bank comparisons and a nonperturbing momentum audit."""
from pathlib import Path
import csv
import hashlib
import json
import re
import shutil


def validate(source):
    source = Path(source)
    manifest = json.loads((source / 'publication-manifest.json').read_text())
    required = {'summary.json', 'report.html', 'interpretation.json', 'instrumentation-equivalence.json',
                'audit-enabled-30-ledger-check.json', 'audit-enabled-30/manifest.json'}
    if manifest.get('state') != 'COMPLETE' or not required.issubset(manifest['files']):
        raise ValueError('Incomplete bank/momentum package')
    for name, expected in manifest['files'].items():
        path = Path(name)
        if path.is_absolute() or '..' in path.parts:
            raise ValueError('Invalid bank/momentum path')
        if hashlib.sha256((source / path).read_bytes()).hexdigest() != expected:
            raise ValueError('Bank/momentum evidence identity mismatch')
    equivalent = json.loads((source / 'instrumentation-equivalence.json').read_text())
    fields = equivalent.get('fields', {})
    if (equivalent.get('status') != 'PASS' or not equivalent.get('bit_identical')
            or set(fields) != {'Mesh2_face_depth', 'Mesh2_face_vx', 'Mesh2_face_vy'}
            or any(v.get('frames') != 300 or v.get('changed_values') != 0
                   or v.get('max_absolute_difference') != 0 for v in fields.values())):
        raise ValueError('Instrumented fields are not identical')
    if json.loads((source / 'audit-enabled-30-ledger-check.json').read_text()).get('status') != 'PASS':
        raise ValueError('Momentum accounting did not pass')
    hashes, options, libraries = set(), set(), set()
    identities = {}
    for name in ['coarse', 'bank005', 'bank0025', 'broad005']:
        folder = source / 'cases' / name
        needed = {f'cases/{name}/{p}' for p in ['model.inp', 'manifest.json', 'metrics.json', 'probes.csv',
                  'status.json', 'reference/observations.csv']}
        if not needed.issubset(manifest['files']):
            raise ValueError('Incomplete bank case evidence')
        if json.loads((folder / 'status.json').read_text()).get('state') != 'COMPLETE':
            raise ValueError('Bank case not completed')
        metric = json.loads((folder / 'metrics.json').read_text())
        if metric.get('returncode') != 0 or not metric.get('checks') or not all(metric['checks'].values()):
            raise ValueError('Bank numerical checks failed')
        identity = json.loads((folder / 'manifest.json').read_text())
        identities[name] = hashlib.sha256((folder / 'model.inp').read_bytes()).hexdigest()
        if identities[name] != identity['input_sha256']:
            raise ValueError('Bank input identity mismatch')
        libraries.add(identity['library_sha256'])
        with (folder / 'probes.csv').open() as stream:
            rows = list(csv.DictReader(stream))
        if len(rows) != 1800 or {(r['probe'], round(float(r['time_s']), 7)) for r in rows} != {
                (f'G{i}', j / 10) for i in range(1, 7) for j in range(1, 301)}:
            raise ValueError('Bank duration incomplete')
        text = (folder / 'model.inp').read_text()
        match = re.search(r'\[2D_OPTIONS\]([\s\S]*?)(?=\n\[|\Z)', text)
        if not match: raise ValueError('Missing physics options')
        options.add(match[1].strip())
        hashes.add(hashlib.sha256((folder / 'reference/observations.csv').read_bytes()).hexdigest())
    if len(hashes) != 1 or len(options) != 1 or len(libraries) != 1:
        raise ValueError('Physical inputs, observations or solver identity differ')
    audit = json.loads((source / 'audit-enabled-30/manifest.json').read_text())
    if audit.get('input_sha256') != identities['coarse']:
        raise ValueError('Momentum audit changed the input')
    if json.loads((source / 'interpretation.json').read_text()).get('reviewed') is not True:
        raise ValueError('Bank interpretation not reviewed')
    return manifest


def supplement(source, here):
    source, here = Path(source), Path(here)
    manifest = validate(source)
    destination = here / 'evidence/g2-bank-momentum'
    destination.mkdir(parents=True, exist_ok=True)
    for name in [*manifest['files'], 'publication-manifest.json']:
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source / name, target)
    interpretation = json.loads((source / 'interpretation.json').read_text())
    return f'''## Targeted bank refinement and the corrected momentum balance

{interpretation['finding']}

The two 30-second diagnostics refine the sloping banks to 0.05 m and 0.025 m targets while retaining the drawing geometry, FLAT/MEAN settings and physical coefficients. The earlier broad refinement is included for context. Exact cross-section curves, all five available measured-subset errors, UK report panels and local front-normal diagnostics are retained.

{interpretation['momentum']}

The [bank-resolution and momentum report](evidence/g2-bank-momentum/report.html) includes the complete field-equivalence checks, control-volume receipts, reproducible scripts and executed inputs. These diagnostics do not establish mesh convergence or laboratory validation, and no regression anchors are promoted.

'''
