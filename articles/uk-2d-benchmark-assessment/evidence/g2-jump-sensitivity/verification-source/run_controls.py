"""Local, preregistered Test 6A diagnostics; never edits corpus or baselines."""
from pathlib import Path
import concurrent.futures as futures
import csv
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT))
os.chdir(ROOT)
import numpy as np
from harness import engines
from suites.uk_2d import sampling,checks,observations,tin
from suites.uk_2d.suite import binary_manifest,analysis_hash
from suites.uk_2d.wall_sensitivity import solid_groups

OUT=ROOT/'results/uk_2d/g2-jump-assessment-2026-10-25'
BASE=ROOT/'results/uk_2d/wall-assessment-2026-10-25/6a-cs0-none-cw0.01'
EXE=BASE.parent/'pinned-clock/bin/openswmm'
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()

def save(path,value):
    path.write_text(json.dumps(value,indent=2,allow_nan=False)+'\n')

def sections(text):
    result={};name=None
    for raw in text.splitlines():
        line=raw.split(';')[0].strip()
        if line.startswith('['):name=line.strip('[]');result[name]=[]
        elif line and name:result[name].append(line.split())
    return result

def replace(text,name,rows):
    return re.sub(r'\['+name+r'\][\s\S]*?(?=\n\[|\Z)',
                  '['+name+']\n'+'\n'.join(rows)+'\n',text)

def prepare(names):
    original=BASE/'model.inp';identity=json.loads((BASE/'manifest.json').read_text())
    assert sha(original)==identity['input_sha256']
    assert binary_manifest(EXE)==identity['binaries']
    base=original.read_text();s=sections(base)
    verts=np.array([[float(v) for v in row[:3]] for row in s['2D_VERTICES']])
    cells=np.array([[int(v) for v in row[:3]] for row in s['2D_TRIANGLES']])
    for name in names:
        work=OUT/name
        if work.exists():raise ValueError('Refusing to overwrite '+str(work))
        work.mkdir();text=base;v=verts;c=cells;mesh_record=None
        if name=='cfl02':
            text,n=re.subn(r'^CFL_NUMBER\s+.*$','CFL_NUMBER 0.2',text,flags=re.M);assert n==1
            changed='CFL_NUMBER only: 0.4 to 0.2'
        elif name=='uniform-level':
            heights=np.maximum(np.where(v[c,0].mean(1)<0,.4,.02)-v[c,2].mean(1),0)
            rows=[' '.join(row[:4])+f' {h:.17g}' for row,h in zip(s['2D_TRIANGLES'],heights)]
            text=replace(text,'2D_TRIANGLES',rows)
            changed='Initial depths only: max(prescribed level minus cell-mean bed, 0)'
        elif name=='local005':
            meshdir=OUT/'local-mesh';raw=json.loads((meshdir/'mesh-output.json').read_text())
            xy=np.array(raw['vertices']);v=np.column_stack([xy,tin.bed(xy)]);c=np.array(raw['triangles'],dtype=int)
            request=json.loads((meshdir/'mesh-request.json').read_text());mesh_record,walls=tin.audit(v,c,request)
            assert not raw['stats']['refine_capped']
            text=replace(text,'2D_VERTICES',[' '.join(f'{a:.17g}' for a in row) for row in v])
            text=replace(text,'2D_TRIANGLES',[f'{a} {b} {d} .01 {(.4 if x<0 else .02):.17g}' for (a,b,d),x in zip(c,v[c,0].mean(1))])
            groups=solid_groups(text,1)
            text=replace(text,'2D_BOUNDARY_CONDITIONS',[f"{r['cell']} {r['edge']} WALL * * {g}" for g,rows in groups.items() for r in rows])
            changed='GUI local 0.05 m constrained refinement only, with 0.1 m background'
            shutil.copy2(meshdir/'mesh-provenance.json',work/'mesh-provenance.json')
        else:raise ValueError(name)
        parsed=sections(text);areas=tin.areas(v,c);depth=np.array([float(row[4]) for row in parsed['2D_TRIANGLES']])
        case=json.loads((BASE/'case.json').read_text());case.update(id=name,model_sha256=hashlib.sha256(text.encode()).hexdigest(),cell_count=len(c),area_m2=float(areas.sum()),initial_volume_m3=float(areas@depth))
        case['deviations']=case['deviations']+[changed+'; declared diagnostic, no canonical or regression promotion.']
        (work/'model.inp').write_text(text);save(work/'case.json',case)
        shutil.copy2(BASE/'probe-locations.csv',work/'probe-locations.csv');shutil.copytree(BASE/'reference',work/'reference')
        save(work/'manifest.json',dict(case=name,change=changed,control_directory=str(BASE),control_input_sha256=sha(original),input_sha256=sha(work/'model.inp'),probe_sha256=sha(work/'probe-locations.csv'),observations_sha256=sha(work/'reference/observations.csv'),binaries=identity['binaries'],analysis_sha256=analysis_hash(),driver_sha256=sha(__file__),mesh_audit=mesh_record,created_utc=dt.datetime.now(dt.timezone.utc).isoformat()))
        print(name,len(c),case['initial_volume_m3'],flush=True)

def execute(name):
    work=OUT/name;manifest=json.loads((work/'manifest.json').read_text());case=json.loads((work/'case.json').read_text())
    assert sha(work/'model.inp')==manifest['input_sha256'] and binary_manifest(EXE)==manifest['binaries']
    assert not (work/'surface.h5').exists() and not (work/'metrics.json').exists()
    started=time.monotonic()
    try:
        with (work/'process.log').open('w') as log:
            process=subprocess.Popen([str(EXE),str(work/'model.inp'),str(work/'model.rpt'),str(work/'model.out')],cwd=work,env=engines.env(1,[str(EXE.parent),str(EXE.parent.parent/'engine')]),stdout=log,stderr=subprocess.STDOUT)
            save(work/'status.json',dict(state='RUNNING',pid=process.pid,driver_pid=os.getpid(),started_utc=dt.datetime.now(dt.timezone.utc).isoformat()))
            code=process.wait(timeout=14400)
        assert code==0 and binary_manifest(EXE)==manifest['binaries']
        probes=list(csv.DictReader((work/'probe-locations.csv').open()))
        data=sampling.extract(work/'surface.h5',case,probes,work)
        result=dict(case=name,returncode=code,wall_s=time.monotonic()-started,**checks.numerical(case,data))
        assert all(result['checks'].values()),result
        result['observed']=observations.compare(work/'reference',case,data['times'],data['values'],probes)
        np.savez_compressed(work/'extracted.npz',times=data['times'],values=data['values'])
        save(work/'metrics.json',result);save(work/'status.json',dict(state='COMPLETE',completed_utc=dt.datetime.now(dt.timezone.utc).isoformat(),checks=result['checks']))
        print(json.dumps(result),flush=True)
    except BaseException as e:
        save(work/'status.json',dict(state='FAILED',error=str(e),at_utc=dt.datetime.now(dt.timezone.utc).isoformat()));raise

if __name__=='__main__':
    action,names=sys.argv[1],sys.argv[2].split(',')
    if action=='prepare':prepare(names)
    elif action=='run':
        with futures.ThreadPoolExecutor(max_workers=2) as pool:list(pool.map(execute,names))
    else:raise ValueError(action)
