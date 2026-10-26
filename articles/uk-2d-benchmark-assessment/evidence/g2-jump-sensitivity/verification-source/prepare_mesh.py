"""Audit GUI mesh adapter equivalence and the declared local size variation."""
from pathlib import Path
import hashlib,json,os,subprocess,sys
import numpy as np
ROOT=Path(__file__).resolve().parents[3];sys.path.insert(0,str(ROOT));os.chdir(ROOT)
from suites.uk_2d import tin
HERE=Path(__file__).resolve().parent
OUT=ROOT/'results/uk_2d/g2-jump-assessment-2026-10-25'
EXE=HERE/'mesher-build/uk_gui_mesher'
GUI=ROOT.parent/'openswmm.gui'
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
mode=sys.argv[1]
request=tin.geometry()
if mode=='local':
    request['min_cell_size']=.0125
    request['refinement_boxes']=[dict(xmin=-.8,xmax=6.,ymin=-1.8,ymax=1.8,max_area=float(np.sqrt(3)/4*.05**2),transition_width=1.)]
folder=OUT/('local-mesh' if mode=='local' else 'coarse-mesh-equivalence');folder.mkdir(exist_ok=True)
(folder/'mesh-request.json').write_text(json.dumps(request,indent=2)+'\n')
sources=[GUI/'src/core/editgeometry.cpp',GUI/'include/core/editgeometry.h',GUI/'vendor/predicates/predicates.c',GUI/'vendor/predicates/predicates.h']
sources += list((GUI/'include/mesh').glob('*.h'))+[GUI/'src/mesh'/f'{n}.cpp' for n in ['meshgenerator','meshcdt','meshpatch','meshquadregion','pslgprep','breaklinestrips']]
identity={str(p):sha(p) for p in sources};binary=sha(EXE)
with (folder/'mesher.log').open('w') as log:subprocess.run([str(EXE),str(folder/'mesh-request.json'),str(folder/'mesh-output.json')],stdout=log,stderr=subprocess.STDOUT,timeout=1200,check=True)
assert sha(EXE)==binary and identity=={str(p):sha(p) for p in sources}
result=json.loads((folder/'mesh-output.json').read_text());xy=np.array(result['vertices']);v=np.column_stack([xy,tin.bed(xy)]);c=np.array(result['triangles'],dtype=int)
audit,walls=tin.audit(v,c,request);assert not result['stats']['refine_capped']
if mode=='coarse':
    original=json.loads((ROOT/'results/uk_2d/tin-review-2026-10-24/mesh-output.json').read_text())
    assert result['vertices']==original['vertices'] and result['triangles']==original['triangles'],'No-box adapter changed the control mesh'
centres=v[c,:2].mean(1);a=tin.areas(v,c);local=(centres[:,0]>1.5)&(centres[:,0]<5)&(abs(centres[:,1])<1.2)
edges=np.linalg.norm(v[c,:2]-np.roll(v[c,:2],-1,axis=1),axis=2)
record=dict(generator='Unchanged GUI MeshGenerator / ConstrainedDelaunay; optional targetAreaAt callback supplied by benchmark adapter',executable_sha256=binary,gui_source_hashes=identity,adapter_sha256=sha(ROOT/'suites/uk_2d/mesher/main.cpp'),request=request,audit=audit,stats=result['stats'],no_box_control_bit_identical=(mode=='coarse'),local_edge_median_m=float(np.median(edges[local])),local_edge_p95_m=float(np.quantile(edges[local],.95)),local_max_area_m2=float(a[local].max()))
(folder/'mesh-provenance.json').write_text(json.dumps(record,indent=2)+'\n');np.savez_compressed(folder/'mesh.npz',vertices=v,cells=c)
print(json.dumps({k:v for k,v in record.items() if k not in ['gui_source_hashes','request']},indent=2),flush=True)
