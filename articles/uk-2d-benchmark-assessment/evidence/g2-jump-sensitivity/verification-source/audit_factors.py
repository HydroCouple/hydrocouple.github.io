"""Independent input-section checks for the three declared experimental factors."""
from pathlib import Path
import json,hashlib,sys
import numpy as np
ROOT=Path(__file__).resolve().parents[3];sys.path.insert(0,str(ROOT))
from suites.uk_2d.tin import audit,geometry
OUT=ROOT/'results/uk_2d/g2-jump-assessment-2026-10-25'
BASE=OUT.parent/'wall-assessment-2026-10-25/6a-cs0-none-cw0.01'
def read(path):
    result={};key=None
    for raw in path.read_text().splitlines():
        line=raw.split(';')[0].strip()
        if line.startswith('['):key=line;result[key]=[]
        elif line and key:result[key].append(line.split())
    return result
base=read(BASE/'model.inp');checks={}
for name in ['uniform-level','cfl02','local005']:
    work=OUT/name;s=read(work/'model.inp');manifest=json.loads((work/'manifest.json').read_text())
    assert hashlib.sha256((work/'model.inp').read_bytes()).hexdigest()==manifest['input_sha256']
    assert set(s)==set(base)
    permitted={'[2D_TRIANGLES]'} if name=='uniform-level' else {'[2D_OPTIONS]'} if name=='cfl02' else {'[2D_VERTICES]','[2D_TRIANGLES]','[2D_BOUNDARY_CONDITIONS]'}
    for key in s:
        if key not in permitted:assert s[key]==base[key],(name,key)
    if name=='cfl02':
        left={r[0]:r[1:] for r in base['[2D_OPTIONS]']};right={r[0]:r[1:] for r in s['[2D_OPTIONS]']}
        assert {k for k in left if left[k]!=right[k]}=={'CFL_NUMBER'}
        assert float(left['CFL_NUMBER'][0])==.4 and float(right['CFL_NUMBER'][0])==.2
    v=np.array(s['[2D_VERTICES]'],dtype=float);c=np.array([r[:3] for r in s['[2D_TRIANGLES]']],dtype=int);h=np.array([float(r[4]) for r in s['[2D_TRIANGLES]']]);n=np.array([float(r[3]) for r in s['[2D_TRIANGLES]']])
    assert (n==.01).all()
    centres=v[c].mean(1);stage=np.where(centres[:,0]<0,.4,.02)
    if name=='uniform-level':
        assert [r[:4] for r in s['[2D_TRIANGLES]']]==[r[:4] for r in base['[2D_TRIANGLES]']]
        assert np.allclose(h,np.maximum(stage-centres[:,2],0),rtol=0,atol=1e-12)
    else:assert np.allclose(h,stage,rtol=0,atol=1e-12)
    if name=='local005':
        request=json.loads((OUT/'local-mesh/mesh-request.json').read_text());review,walls=audit(v,c,request)
        expected={(ci,slot) for ci,slot,length in walls};actual={(int(r[0]),int(r[1])) for r in s['[2D_BOUNDARY_CONDITIONS]']}
        assert expected==actual and all(r[2]=='WALL' for r in s['[2D_BOUNDARY_CONDITIONS]'])
    checks[name]=dict(all_unrelated_sections_identical=True,declared_factor_only=True,initial_condition_verified=True,uniform_manning_n=.01,input_sha256=manifest['input_sha256'])
(OUT/'factor-audit.json').write_text(json.dumps(dict(status='PASS',cases=checks),indent=2)+'\n')
print('Three independent input-factor audits pass.')
