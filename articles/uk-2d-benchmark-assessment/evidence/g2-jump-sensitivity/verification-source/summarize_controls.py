"""Finalize the declared G2 controls only after all full-duration records pass."""
from pathlib import Path
import csv,datetime as dt,hashlib,html,json,os,shutil,sys
ROOT=Path(__file__).resolve().parents[3];sys.path.insert(0,str(ROOT));os.chdir(ROOT)
OUT=ROOT/'results/uk_2d/g2-jump-assessment-2026-10-25'
os.environ.setdefault('MPLCONFIGDIR',str(OUT/'.plot-cache'));os.environ.setdefault('XDG_CACHE_HOME',str(OUT/'.cache'))
import h5py,numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.tri import Triangulation
from matplotlib.collections import LineCollection
from suites.uk_2d import tin,render

BASE=OUT.parent/'wall-assessment-2026-10-25/6a-cs0-none-cw0.01'
LABELS={'control':'Original depth / CFL 0.4','uniform-level':'Uniform water level','cfl02':'CFL 0.2','local005':'Local 0.05 m target'}
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()

def final():
    factor_audit=json.loads((OUT/'factor-audit.json').read_text());assert factor_audit['status']=='PASS'
    records=[]
    for name in LABELS:
        work=BASE if name=='control' else OUT/name
        if not (work/'metrics.json').exists():raise RuntimeError('Pending full-duration metrics: '+name)
        metric=json.loads((work/'metrics.json').read_text());manifest=json.loads((work/'manifest.json').read_text())
        assert metric['returncode']==0 and all(metric['checks'].values())
        assert sha(work/'model.inp')==manifest['input_sha256']
        if name!='control':assert factor_audit['cases'][name]['input_sha256']==manifest['input_sha256']
        rows=list(csv.DictReader((work/'probes.csv').open()))
        assert len(rows)==1200*6 and float(rows[-1]['time_s'])==120
        records.append((name,work,metric,manifest,rows))
    assert len({sha(work/'reference/observations.csv') for _,work,*_ in records})==1
    assert all(r[3]['binaries']==records[0][3]['binaries'] for r in records)
    assert all(r[3]['analysis_sha256']==records[0][3]['analysis_sha256'] for r in records)
    # Portable control inputs and histories, preserving the original manifests verbatim.
    control=OUT/'control';control.mkdir(exist_ok=True)
    for name in ['model.inp','case.json','manifest.json','metrics.json','probes.csv','probe-locations.csv','probe-map.json','volume.csv','process.log']:
        shutil.copy2(BASE/name,control/name)
    shutil.copytree(BASE/'reference',control/'reference',dirs_exist_ok=True)
    display_path=ROOT/'suites/uk_2d/figure-display-specs.json';shutil.copy2(display_path,OUT/display_path.name)
    display=json.loads(display_path.read_text())['figures'];observed=list(csv.DictReader((BASE/'reference/observations.csv').open()))
    figures=[]
    for quantity,points,source in [('level_m',['G2','G4','G5','G6'],'4.25'),('speed_mps',['G2','G4'],'4.26')]:
        fig,axes=plt.subplots(len(points),1,figsize=(9,2.6*len(points)),squeeze=False)
        for point,ax in zip(points,axes[:,0]):
            for name,work,metric,manifest,rows in records:
                history=[r for r in rows if r['probe']==point];ax.plot([float(r['time_s']) for r in history],[float(r[quantity]) if float(r['depth_m'])>1e-4 else np.nan for r in history],label=LABELS[name],lw=1.4)
            obs=[r for r in observed if r['probe']==point and r['quantity']==quantity]
            if obs:ax.scatter([float(r['time_s']) for r in obs],[float(r['value']) for r in obs],s=14,marker='D',facecolors='none',edgecolors='black',label='UCL digitized subset',zorder=10)
            else:ax.text(.02,.95,'Measured series unavailable',va='top',transform=ax.transAxes,fontsize=8)
            ax.set(title=point,xlabel='Time (seconds)',ylabel='Water level (m)' if quantity=='level_m' else 'Speed (m/s)');ax.grid(alpha=.25);ax.legend(fontsize=8)
        fig.suptitle(f'Test 6A: G2 diagnostic controls; UK Figure {source} panels',y=1.002);fig.tight_layout()
        stem='g2-controls-uk-'+source.replace('.','-');fig.savefig(OUT/(stem+'-full-range.png'),dpi=150,bbox_inches='tight');figures.append(stem+'-full-range.png')
        for point,ax in zip(points,axes[:,0]):ax.set(xlim=display[source]['panels'][point]['xlim'],ylim=display[source]['panels'][point]['ylim'])
        fig.savefig(OUT/(stem+'.png'),dpi=150,bbox_inches='tight');figures.append(stem+'.png');plt.close(fig)
    front_rows=[];sampled={};state20=[]
    ts=list(np.arange(1,30.01,.5))+[40.,60.,120.]
    for name,work,metric,manifest,rows in records:
        with h5py.File(work/'surface.h5','r') as f:
            vx=f['Mesh2_node_x'][:];vy=f['Mesh2_node_y'][:];conn=f['Mesh2_face_nodes'][:]-int(f['Mesh2_face_nodes'].attrs.get('start_index',0));x=f['Mesh2_face_x'][:];y=f['Mesh2_face_y'][:]
            tri=Triangulation(vx,vy,conn);xs=np.linspace(1.5,4.5,601);ids=tri.get_trifinder()(xs,np.full_like(xs,-.6));assert (ids>=0).all()
            for t in ts:
                i=round(t/.1)-1;h=f['Mesh2_face_depth'][i];u=f['Mesh2_face_vx'][i];v=f['Mesh2_face_vy'][i];fr=np.hypot(u[ids],v[ids])/np.sqrt(9.80665*np.maximum(h[ids],1e-12))
                cuts=np.flatnonzero((fr[:-1]>=1)&(fr[1:]<1));first=float((xs[cuts[0]]+xs[cuts[0]+1])/2) if len(cuts) else None
                front_rows.append(dict(case=name,time_s=float(t),first_super_to_subcritical_x_m=first))
                if t==20:state20.append((name,tri,h.copy(),np.hypot(u,v)/np.sqrt(9.80665*np.maximum(h,1e-12)),x,y))
        g2=[r for r in rows if r['probe']=='G2'];entry=[]
        for t in [10,15,20,25,30]:
            r=min(g2,key=lambda r:abs(float(r['time_s'])-t));h=float(r['depth_m']);speed=float(r['speed_mps']);entry.append(dict(time_s=t,depth_m=h,level_m=float(r['level_m']),speed_mps=speed,froude=speed/np.sqrt(9.80665*h)))
        sampled[name]=entry
    with (OUT/'front-positions.csv').open('w',newline='') as f:
        w=csv.DictWriter(f,fieldnames=list(front_rows[0]));w.writeheader();w.writerows(front_rows)
    (OUT/'G2-sampled-states.json').write_text(json.dumps(sampled,indent=2)+'\n')
    fig,ax=plt.subplots(figsize=(9,4.5))
    for name in LABELS:
        rows=[r for r in front_rows if r['case']==name and r['time_s']<=30];ax.plot([r['time_s'] for r in rows],[r['first_super_to_subcritical_x_m'] for r in rows],label=LABELS[name])
    ax.axhline(2.65,color='black',ls='--',label='G2 x coordinate');ax.set(xlabel='Time (s)',ylabel='First downstream Fr=1 crossing x (m)',title='Sampled critical-front position along y=-0.6 m\nApproximate cell-constant diagnostic; no measured front trajectory');ax.grid(alpha=.25);ax.legend(fontsize=8);fig.tight_layout();fig.savefig(OUT/'g2-controls-front-position.png',dpi=160);figures.append('g2-controls-front-position.png');plt.close(fig)
    fig,axes=plt.subplots(2,2,figsize=(12,8),layout='constrained')
    for ax,(name,tri,h,fr,x,y) in zip(axes.flat,state20):
        art=ax.tripcolor(tri,facecolors=h,vmin=0,vmax=.16,cmap='viridis',rasterized=True)
        near=(x>1)&(x<5.5)&(abs(y)<1.5);owners={}
        for c in np.flatnonzero(near):
            row=tri.triangles[c]
            for a,b in zip(row,np.roll(row,-1)):owners.setdefault(tuple(sorted((int(a),int(b)))),[]).append(c)
        edges=[[[tri.x[a],tri.y[a]],[tri.x[b],tri.y[b]]] for (a,b),c in owners.items() if len(c)==2 and (fr[c[0]]-1)*(fr[c[1]]-1)<0]
        ax.add_collection(LineCollection(edges,colors='cyan',linewidths=.9));building=np.array(tin.geometry()['constraints'][0]['points']);ax.fill(building[:,0],building[:,1],color='.65',edgecolor='black');ax.plot(2.65,-.6,'wo',mec='black');ax.annotate('G2',(2.65,-.6),xytext=(2.2,-1.1),color='white',arrowprops={'arrowstyle':'->','color':'white'})
        ax.set(xlim=(1,5.5),ylim=(-1.5,1.5),aspect='equal',title=LABELS[name],xlabel='x (m)',ylabel='y (m)')
    fig.colorbar(art,ax=list(axes.flat),label='Depth at 20 s (m)',shrink=.8);fig.suptitle('G2 local depth and sampled critical transition at 20 s\nCyan edges straddle Fr=1; spatial observations unavailable');fig.savefig(OUT/'g2-controls-local-depth-20s.png',dpi=160);figures.append('g2-controls-local-depth-20s.png');plt.close(fig)
    summary=[]
    for name,work,metric,manifest,rows in records:summary.append(dict(variant=name,label=LABELS[name],metrics=metric,input_sha256=manifest['input_sha256']))
    (OUT/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
    analytical=json.loads((OUT/'closed-window-jumps/summary.json').read_text());assert len(analytical)==16
    (OUT/'report-provenance.json').write_text(json.dumps(dict(created_utc=dt.datetime.now(dt.timezone.utc).isoformat(),script_sha256=sha(__file__),display_specs_sha256=sha(display_path),cases={r[0]:r[3]['input_sha256'] for r in records},figures=figures,figure_sha256={name:sha(OUT/name) for name in figures},reference_sha256=sha(BASE/'reference/observations.csv'),closed_jump_cases=len(analytical),closed_jump_all_pass=all(all(r['checks'].values()) for r in analytical)),indent=2)+'\n')
    lines=['# Test 6A: G2 hydraulic-jump diagnostic controls','','All three new variants and the archived control completed 120 seconds. These are sensitivity experiments, not replacements for the canonical benchmark or its regression anchor. No coefficients or gauge locations were fitted.','',
    'The original 0.1 m target mesh, uniform-depth initial condition and CFL 0.4 form the control. Each variant changes one declared factor. All cases retain Manning n=0.01, free-slip walls, Coriolis OFF, Cs=0 and accepted cell q/h velocity output. The local refinement uses the unchanged GUI constrained mesher with a graded size callback; its no-refinement result reproduced the original mesh bit for bit. The nominal 0.05 m local target reduces median local edge length from 0.122 m to 0.061 m. Boundary geometry, bank toes, gate interface and obstruction are audited independently.','',
    'The uniform-level variant initializes h=max(H-z_cell,0), with H=0.4 m upstream and 0.02 m downstream, under the same FLAT storage closure. Main report wording and specification depth wording conflict. This declared variant changes initial storage from 16.618 m3 to 15.07377 m3; it is not silently adopted as a correction.','',
    'Only visibility-selected digitized UCL measurement diamonds from UK Figures 4.25/4.26 are used. G6 measurements and original full records remain unavailable; marker extraction has no independent second-person review. RMSE uses the same recovered samples and segmented trapezoidal weights, excluding gaps longer than 1 s. Exact errors remain provisional. The [Environment Agency report](https://assets.publishing.service.gov.uk/media/6033a943d3bf7f721f4b0d49/_SC120002_Benchmarking_2D_hydraulic_models_Report.pdf) supplies the source panels and test specification.','',
    'Each case uses one solver thread on the same Apple M1 Max host as the preceding wall study. Runs share machine resources; elapsed times in their metrics are not controlled performance measurements. All three new cases use the same immutable solver CLI and library as the archived control.','',
    'The [independent input-factor audit](factor-audit.json) verifies the intended changes and equality of unrelated input sections. The finer mesh naturally reduces the stable timestep at the same CFL; the smaller-CFL coarse control measures temporal sensitivity separately. This pair is not a formal mesh-convergence study.','',
    '| Configuration | G2 level RMSE (m) | G2 speed RMSE (m/s) | G4 level RMSE (m) | G4 speed RMSE (m/s) | G5 level RMSE (m) | Volume residual (m3) | Evidence |','|---|---:|---:|---:|---:|---:|---:|---|']
    for name,work,metric,manifest,rows in records:
        values={(r['probe'],r['quantity']):r['rmse'] for r in metric['observed']['metrics']}
        numbers=' | '.join(f'{values[key]:.6g}' for key in [('G2','level_m'),('G2','speed_mps'),('G4','level_m'),('G4','speed_mps'),('G5','level_m')])
        lines.append(f"| {LABELS[name]} | {numbers} | {metric['volume_residual_m3']:.6g} | [INP]({name}/model.inp), [CSV]({name}/probes.csv), [metrics]({name}/metrics.json), [identity]({name}/manifest.json) |")
    lines+=['','## Jump and wall-pressure verification','',
    'Sixteen closed-domain checks exercise stationary, upstream-moving, oblique-flow and wall-reflected jumps on triangular meshes, both reconstruction orders, and 0/64 degree orientations. References follow independent mass/momentum jump relations. Errors are scored at 0.5 s inside a causal window isolated from artificial outer-wall disturbances. Whole-domain volume is conserved. The frozen criteria, per-case fields and residuals remain in [the verification plan](closed-window-jumps/plan.json) and [results](closed-window-jumps/summary.json). The same inputs are now retained as the repeatable analytical/hydraulic_jumps suite; its [committed-source run](regression-jumps-committed/scores.json) passes all sixteen cases.','',
    'The earlier open-stage-boundary fixtures did not retain the assumed far-field discharge; their failures are retained in [the stage-boundary results](analytical-jumps/summary.json), not relabelled as passing. They do not qualify a prescribed-discharge solution. Test 6 itself has solid exterior walls. The initial analytical fixture with inconsistent global/output steps was rejected before a solver verdict; its [rejection record](rejected-analytical-fixture-clock/rejection.json) is retained.','',
    'Passing these controlled checks does not establish the correct two-dimensional front trajectory around the building. Second-order rotation differences are reported, not assumed zero. [Rotation comparison](closed-window-jumps/rotation-comparisons.json).','',
    '## Local transition and gauge histories','',
    'The front diagnostic records the first downstream crossing of speed/sqrt(g*h)=1 along y=-0.6 m. It is sampled from cell-constant fields and is not a shock-normal tracking solution. No measured spatial front trajectory is available. Gauge sampling remains the containing cell, with deterministic shared-edge handling.','']
    for name in figures:lines+=['',f'![G2 diagnostic: {name}]({name})']
    lines+=['','[Preregistered controls](assessment-plan.json). [Case summary](summary.json). [Front samples](front-positions.csv). [G2 sampled states](G2-sampled-states.json). [Report identity](report-provenance.json).']
    interpretation=OUT/'interpretation.json'
    if interpretation.exists():
        value=json.loads(interpretation.read_text());lines+=['','## Interpretation','',value['finding'],'',value['qualification']]
    (OUT/'report.html').write_text(render.render('\n'.join(lines)+'\n'))
    print('Finalized four control records, six figures and local technical report.',flush=True)

if __name__=='__main__':final()
