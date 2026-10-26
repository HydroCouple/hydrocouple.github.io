"""Publish a sealed source audit without promoting its stricter reference subset."""
from pathlib import Path
import csv
import hashlib
import json
import shutil


def validate(source):
    source = Path(source)
    manifest = json.loads((source / 'publication-manifest.json').read_text())
    required = {'report.html', 'audit.json', 'source-review.json', 'marker-connectivity.csv',
                'strict-marker-pixels.json', 'strict-reference/observations.csv',
                'strict-reference/observations.json', 'strict-comparison.json', 'marker-tests.log',
                'source-geometry.png', 'g2-marker-audit.png'}
    if manifest.get('state') != 'COMPLETE' or not required.issubset(manifest['files']):
        raise ValueError('Incomplete source audit')
    for name, expected in manifest['files'].items():
        path = Path(name)
        if path.is_absolute() or '..' in path.parts:
            raise ValueError('Unsafe source-audit path')
        if hashlib.sha256((source / path).read_bytes()).hexdigest() != expected:
            raise ValueError('Source-audit identity mismatch')
    audit = json.loads((source / 'audit.json').read_text())
    if (audit.get('state') != 'COMPLETE' or audit['geometry']['status'] != 'PASS'
            or audit['markers']['status'] != 'PASS'):
        raise ValueError('Source checks incomplete')
    review = json.loads((source / 'source-review.json').read_text())
    if review.get('state') != 'COMPLETE_WITH_SOURCE_LIMITATIONS' or not review.get('next_evidence'):
        raise ValueError('Source limitations omitted')
    reference = json.loads((source / 'strict-reference/observations.json').read_text())
    if reference['csv_sha256'] != hashlib.sha256((source / 'strict-reference/observations.csv').read_bytes()).hexdigest():
        raise ValueError('Strict-reference identity mismatch')
    rows = list(csv.DictReader((source / 'marker-connectivity.csv').open()))
    pixels = json.loads((source / 'strict-marker-pixels.json').read_text())
    accepted = {(r['probe'], r['quantity'], int(r['x']), int(r['y'])) for r in rows if r['strict'] == 'True'}
    if (any(int(r['connected_pixels']) != 13 for r in rows if r['strict'] == 'True')
            or accepted != {(r['probe'], r['quantity'], r['x'], r['y']) for r in pixels}):
        raise ValueError('Strict connectivity misrepresented')
    series = audit['markers']['series']
    if len(series) != 6 or sum(r['original_pixels'] for r in series) != len(rows):
        raise ValueError('Marker audit incomplete')
    for item in series:
        count = sum(r['probe'] == item['probe'] and r['quantity'] == item['quantity'] for r in pixels)
        if item['strict_pixels'] != count:
            raise ValueError('Strict marker counts differ')
    return manifest


def supplement(source, here):
    source, here = Path(source), Path(here)
    manifest = validate(source)
    destination = here / 'evidence/g2-source-reconciliation'
    for name in [*manifest['files'], 'publication-manifest.json']:
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source / name, target)
    return '''## Source geometry and observation audit

The executed geometry, all six gauge coordinates and 0.1-second output interval agree with the UK specification. The source drawing explicitly includes sloping banks in the reservoir and channel, a rectangular 1 m throat, and a 0.8 × 0.4 m building oriented 64° from x. No missing gate sill or specified finite opening schedule was found. An earlier IMPACT transcription has conflicting building-position and initial-depth values, but its original could not be authenticated; those values have not been substituted into the UK benchmark.

The observation review corrects an earlier overstatement: the historical 5×5 diamond-pattern detector did not guarantee that each candidate was disconnected from other magenta graphics. A new independent connected-component algorithm retains 15 disconnected G2 level markers and 138 speed markers. These still show the missing depth rise and slowdown. Historical pixel-to-time/value conversions reproduce within 10⁻¹²; this is an algorithmic cross-check by the same assistant, not a second-person or instrument validation.

The [source reconciliation report](evidence/g2-source-reconciliation/report.html) records every candidate’s connectivity, stricter-subset coverage and metrics, source decisions and unresolved acquisition needs. The stricter subset is retained only as an audit artifact. No new simulation, canonical-reference replacement or regression-anchor promotion follows from this audit.

'''
