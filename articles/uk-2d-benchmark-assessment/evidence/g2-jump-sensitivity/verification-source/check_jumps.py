"""Independent Rankine-Hugoniot jump and wall-reflection CLI checks."""
from pathlib import Path
import json,math,os,subprocess,sys,time
ROOT=Path(__file__).resolve().parents[3];sys.path.insert(0,str(ROOT));os.chdir(ROOT)
import h5py,numpy as np
from harness import engines
from suites.analytical.momentum2d.suite import deck
from suites.uk_2d.suite import binary_manifest
from suites.uk_2d.sources import digest

OUT=ROOT/'results/uk_2d/g2-jump-assessment-2026-10-25/analytical-jumps'
EXE=OUT.parent.parent/'wall-assessment-2026-10-25/pinned-clock/bin/openswmm'
G=9.80665;H1=.03;U1=1.7;T=1.;DX=.025;NY=4;DY=.05

def reference(kind):
    if kind=='wall':
        lo,hi=H1*1.000001,1.
        for _ in range(150):
            mid=(lo+hi)/2
            residual=.5*G*(mid+H1)*(mid-H1)**2-H1*mid*U1**2
            if residual>0:hi=mid
            else:lo=mid
        h2=(lo+hi)/2;return h2,0.,-H1*U1/(h2-H1),0.
    ratio=.5*(math.sqrt(1+8*U1**2/(G*H1))-1);h2=H1*ratio
    boost=-.3 if kind=='moving-upstream' else 0.
    return h2,H1*U1/h2+boost,boost,.4 if kind=='oblique' else 0.

def make(kind,order,angle):
    h2,u2,s,vt=reference(kind);ul=U1+(s if kind!='wall' else 0.)
    nx=160 if kind=='wall' else 400;x0=-4. if kind=='wall' else -5.
    vertices=np.array([(x0+i*DX,j*DY-.1) for i in range(nx+1) for j in range(NY+1)])
    cells=[]
    for i in range(nx):
        for j in range(NY):
            a=i*(NY+1)+j;b=a+NY+1;cells.extend([(a,b,b+1),(a,b+1,a+1)])
    cells=np.array(cells);cx=vertices[cells,0].mean(1)
    theta=math.radians(angle);co,si=math.cos(theta),math.sin(theta)
    rotation=np.array([[co,-si],[si,co]]);xy=vertices@rotation.T
    h=np.where(cx<0,H1,h2) if kind!='wall' else np.full(len(cells),H1)
    u=np.where(cx<0,ul,u2) if kind!='wall' else np.full(len(cells),U1)
    uv=np.column_stack([u,np.full(len(cells),vt)])@rotation.T
    text=deck('lake',order,0).split('[2D_VERTICES]')[0]
    text=text.replace('END_TIME 00:00:20','END_TIME 00:00:01').replace('REPORT_STEP 00:00:01','REPORT_STEP 0:00:00.1').replace('MAX_TIMESTEP 0.25','MAX_TIMESTEP 0.01')
    text=text.replace('ROUTING_STEP 1','ROUTING_STEP 0.1')
    lines=[text,'[2D_VERTICES]']+[f'{x:.17g} {y:.17g} 0' for x,y in xy]
    lines+=['[2D_TRIANGLES]']+[f'{a} {b} {c} 1e-12 {v:.17g}' for (a,b,c),v in zip(cells,h)]
    lines+=['[2D_INITIAL_VELOCITY]']+[f'{i} {a:.17g} {b:.17g}' for i,(a,b) in enumerate(uv)]
    owners={}
    for c,ids in enumerate(cells):
        for edge in range(3):owners.setdefault(tuple(sorted((int(ids[(edge+1)%3]),int(ids[(edge+2)%3])))),[]).append((c,edge))
    lines+=['[2D_BOUNDARY_CONDITIONS]']
    for (a,b),slots in owners.items():
        if len(slots)!=1:continue
        c,edge=slots[0];xmid=float(vertices[[a,b],0].mean());right=abs(xmid-(x0+nx*DX))<1e-9;left=abs(xmid-x0)<1e-9
        wall=(kind=='wall' and right) or (kind!='oblique' and not left and not right)
        level=H1 if xmid<0 or kind=='wall' else h2
        lines.append(f'{c} {edge} '+('WALL' if wall else f'SPECIFIED_STAGE {level:.17g}'))
    return '\n'.join(lines)+'\n',dict(h2=h2,u2=u2,shock_speed=s,vt=vt,ul=ul,nx=nx,x0=x0,angle=angle,order=order,kind=kind),cx

def assess(path,ref,cx):
    with h5py.File(path,'r') as f:
        times=f['time'][:];times=(times-np.floor(times[0]))*86400
        expected=np.arange(.1,1.01,.1)
        assert times.shape==expected.shape and np.allclose(times,expected,atol=.002,rtol=0),'Incomplete analytical output schedule'
        h=f['Mesh2_face_depth'][-1];ux=f['Mesh2_face_vx'][-1];uy=f['Mesh2_face_vy'][-1];area=f['Mesh2_face_area'][:]
        theta=math.radians(ref['angle']);u=ux*math.cos(theta)+uy*math.sin(theta);v=-ux*math.sin(theta)+uy*math.cos(theta)
        front=ref['shock_speed']*T
        href=np.where(cx<front,H1,ref['h2']);uref=np.where(cx<front,ref['ul'],ref['u2'])
        l1=float(np.sum(area*abs(h-href))/np.sum(area*href));vl1=float(np.sum(area*abs(u-uref))/np.sum(area*np.maximum(abs(uref),.1)))
        profile=h.reshape(ref['nx'],2*NY).mean(1);x=ref['x0']+(np.arange(ref['nx'])+.5)*DX
        mid=(H1+ref['h2'])/2;cross=np.flatnonzero((profile[:-1]<mid)&(profile[1:]>=mid))
        position=float('nan') if len(cross)==0 else float(x[cross[0]]+(mid-profile[cross[0]])/(profile[cross[0]+1]-profile[cross[0]])*DX)
        volume=float(area@h);initial=float(np.sum(area*(H1 if ref['kind']=='wall' else np.where(cx<0,H1,ref['h2']))))
        boundary_rate=.2*(H1*ref['ul']-(0 if ref['kind']=='wall' else ref['h2']*ref['u2']))
        volume_error=abs(volume-initial-boundary_rate*T)/initial
        transverse_l1=float(np.average(abs(v-ref['vt']),weights=area)/U1)
        checks=dict(finite=bool(np.isfinite(h).all() and np.isfinite(u).all() and np.isfinite(v).all()),positive_depth=bool((h>=0).all()),depth_l1=l1<.05,normal_velocity_l1=vl1<.08,shock_position=bool(np.isfinite(position) and abs(position-front)<=3*DX),tangential_velocity_l1=transverse_l1<.05,analytical_boundary_volume=volume_error<1e-5)
        # Far-field states must satisfy the moving-shock momentum relation.
        left=(cx<front-.2)&(cx>front-.5);right=(cx>front+.2)&(cx<front+.5)
        if ref['kind']=='wall':right=(cx>front+.15)&(cx<-.05)
        hl=float(np.average(h[left],weights=area[left]));hr=float(np.average(h[right],weights=area[right]));ql=float(np.average(h[left]*u[left],weights=area[left]));qr=float(np.average(h[right]*u[right],weights=area[right]));ml=float(np.average(h[left]*u[left]**2+.5*G*h[left]**2,weights=area[left]));mr=float(np.average(h[right]*u[right]**2+.5*G*h[right]**2,weights=area[right]));residual=abs(ref['shock_speed']*(qr-ql)-(mr-ml))/max(abs(ml),abs(mr),1e-12)
        checks['momentum_jump']=residual<.03
        return dict(checks=checks,depth_l1=l1,normal_velocity_l1=vl1,transverse_velocity_l1=transverse_l1,shock_position_m=position,expected_shock_position_m=front,volume_relative_error=volume_error,momentum_jump_relative_residual=residual)

def main():
    OUT.mkdir(exist_ok=True);identity=binary_manifest(EXE)
    plan=dict(gravity_m_s2=G,h1_m=H1,u1_m_s=U1,dx_m=DX,duration_s=T,angles_deg=[0,64],orders=[1,2],kinds=['stationary','moving-upstream','oblique','wall'],criteria=dict(depth_l1=.05,normal_velocity_l1=.08,shock_position_cells=3,tangential_velocity_l1=.05,boundary_volume_relative=1e-5,momentum_jump_relative=.03),reference='Mass and momentum Rankine-Hugoniot equations with the compressive hydraulic-jump root; wall-reflected bore uses zero post-bore velocity. No reference hydraulic software or fitted values.',binaries=identity,driver_sha256=digest(Path(__file__).read_bytes()),fixture_review='Prior incomplete-clock fixture rejected before any solver verdict; see rejected-analytical-fixture-clock/rejection.json. Transverse accuracy is an integrated5% criterion; exact rotation covariance is assessed separately.')
    (OUT/'plan.json').write_text(json.dumps(plan,indent=2)+'\n');results=[]
    for kind in plan['kinds']:
        for angle in plan['angles_deg']:
            for order in plan['orders']:
                name=f'{kind}-angle{angle}-order{order}';work=OUT/name;work.mkdir(exist_ok=False)
                text,ref,cx=make(kind,order,angle);(work/'model.inp').write_text(text);(work/'reference.json').write_text(json.dumps(ref,indent=2)+'\n')
                with (work/'process.log').open('w') as log:
                    process=subprocess.run([str(EXE),str(work/'model.inp'),str(work/'model.rpt'),str(work/'model.out')],cwd=work,env=engines.env(1,[str(EXE.parent),str(EXE.parent.parent/'engine')]),stdout=log,stderr=subprocess.STDOUT,timeout=180)
                assert process.returncode==0 and binary_manifest(EXE)==identity,name
                result=dict(case=name,**assess(work/'surface.h5',ref,cx));(work/'metrics.json').write_text(json.dumps(result,indent=2)+'\n');results.append(result)
                (OUT/'summary.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(result),flush=True)
    return 0 if all(all(r['checks'].values()) for r in results) else 1

if __name__=='__main__':raise SystemExit(main())
