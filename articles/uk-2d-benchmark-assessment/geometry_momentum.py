"""Publish the completed Test 6A geometry/momentum audit without raw solver fields."""
from pathlib import Path
import csv,hashlib,json,shutil


def validate(source):
    source=Path(source)
    required=['geometry-audit.json','momentum-audit.json','instrumentation-equivalence.json','report-provenance.json','publication-manifest.json']
    if any(not (source/n).exists() for n in required):
        raise ValueError('Geometry/momentum supplement requires completed audit records')
    for filename in required[:3]:
        if json.loads((source/filename).read_text())['status']!='PASS':
            raise ValueError('Geometry/momentum audit is not qualified: '+filename)
    publication=json.loads((source/'publication-manifest.json').read_text())
    if publication['duration_s']!=30 or publication['qualification']!='diagnostic':
        raise ValueError('Geometry/momentum duration or qualification changed')
    expected_cases={'frozen30','audit-disabled','audit-enabled','audit-enabled-v2','order1-30','muscl-off-30','broad005-30','broad005-muscloff-30','previous-local'}
    if set(publication.get('cases',[]))!=expected_cases:
        raise ValueError('Geometry/momentum diagnostic case register incomplete')
    if not set(required[:4]).issubset(publication['files']):
        raise ValueError('Geometry/momentum audit identity register incomplete')
    for relative,expected in publication['files'].items():
        p=Path(relative)
        if p.is_absolute() or '..' in p.parts or hashlib.sha256((source/p).read_bytes()).hexdigest()!=expected:
            raise ValueError('Geometry/momentum artifact identity mismatch: '+relative)
    identities={};references=set()
    for case in expected_cases:
        names=[case+'/'+n for n in ['model.inp','manifest.json','metrics.json','case.json','status.json','probes.csv','reference/observations.csv']]
        if not set(names).issubset(publication['files']):
            raise ValueError('Geometry/momentum executed diagnostic case incomplete: '+case)
        work=source/case;identity=json.loads((work/'manifest.json').read_text());metric=json.loads((work/'metrics.json').read_text());config=json.loads((work/'case.json').read_text())
        if json.loads((work/'status.json').read_text())['state']!='COMPLETE' or metric['returncode']!=0 or not metric['checks'] or not all(metric['checks'].values()):
            raise ValueError('Geometry/momentum numerical diagnostic incomplete: '+case)
        if hashlib.sha256((work/'model.inp').read_bytes()).hexdigest()!=identity['input_sha256']:
            raise ValueError('Geometry/momentum executed input mismatch: '+case)
        expected_end=120 if case=='previous-local' else 30
        rows=list(csv.DictReader((work/'probes.csv').open()))
        if config['end']!=expected_end or len(rows)!=6*expected_end*10 or float(rows[-1]['time_s'])!=expected_end:
            raise ValueError('Geometry/momentum output duration incomplete: '+case)
        identities[case]=identity;references.add(hashlib.sha256((work/'reference/observations.csv').read_bytes()).hexdigest())
    if len(references)!=1:raise ValueError('Geometry/momentum measured subsets differ')
    for plain,disabled in [('frozen30','muscl-off-30'),('broad005-30','broad005-muscloff-30')]:
        if identities[plain]['input_sha256']!=identities[disabled]['input_sha256'] or identities[disabled].get('environment_overrides')!={'OPENSWMM_2D_MUSCL_OFF':'1'}:
            raise ValueError('Geometry/momentum reconstruction pair is not controlled')
    return publication


def supplement(source,here,image_root,slug):
    source=Path(source);publication=validate(source)
    destination=here/'evidence/g2-geometry-momentum'
    if destination.exists():shutil.rmtree(destination)
    destination.mkdir(parents=True)
    for relative in publication['files']:
        target=destination/relative;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source/relative,target)
    shutil.copy2(source/'publication-manifest.json',destination/'publication-manifest.json')
    interpretation=json.loads((source/'interpretation.json').read_text())
    return f'''## Auditing effective geometry and momentum at G2

The executed mesh passes an independent check of dimensions, wall normals and gate connectivity. The source DEM has a narrower sampled throat and a larger shallow-water building footprint than the exact drawing. These differences remain explicit interpretation questions.

{interpretation['finding']}

{interpretation['qualification']}

The [geometry and momentum technical report](evidence/g2-geometry-momentum/report.html) contains the geometry overlays, accepted momentum receipts, bit-identical instrumentation checks, reconstruction comparison and broader reservoir/gate/building refinement. New runs are 30-second diagnostics; the canonical benchmark and reviewed anchors remain unchanged.

'''
