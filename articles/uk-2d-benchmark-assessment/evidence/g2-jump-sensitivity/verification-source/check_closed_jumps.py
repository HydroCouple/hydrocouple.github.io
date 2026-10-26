"""Exact jump states inside a causal window, isolated from artificial open boundaries."""
from pathlib import Path
import importlib.util,json,math,os,subprocess,sys
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('open_jump_checks',HERE/'check_jumps.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
import h5py,numpy as np
from harness import engines
from suites.uk_2d.suite import binary_manifest
from suites.uk_2d.sources import digest

OUT=m.OUT.with_name('closed-window-jumps');T=.5
m.NY=40;m.DY=.05
YCENTRE=m.NY*m.DY/2-.1

def assess(path,ref,cx):
    with h5py.File(path,'r') as f:
        raw=f['time'][:];times=(raw-np.floor(raw[0]))*86400
        assert times.shape==(10,) and np.allclose(times,np.arange(.1,1.01,.1),atol=.002,rtol=0)
        h=f['Mesh2_face_depth'][4];ux=f['Mesh2_face_vx'][4];uy=f['Mesh2_face_vy'][4];area=f['Mesh2_face_area'][:]
        a=math.radians(ref['angle']);co,si=math.cos(a),math.sin(a);u=ux*co+uy*si;v=-ux*si+uy*co;y=-f['Mesh2_face_x'][:]*si+f['Mesh2_face_y'][:]*co
        front=ref['shock_speed']*T
        region=(abs(cx)<.5)&(abs(y-YCENTRE)<.1)
        href=np.where(cx<front,m.H1,ref['h2']);uref=np.where(cx<front,ref['ul'],ref['u2'])
        weight=area[region];l1=float(np.sum(weight*abs(h[region]-href[region]))/np.sum(weight*href[region]));ul1=float(np.sum(weight*abs(u[region]-uref[region]))/np.sum(weight*np.maximum(abs(uref[region]),.1)));vl1=float(np.average(abs(v[region]-ref['vt']),weights=weight)/m.U1)
        j=np.arange(m.NY);keep=abs(-.1+(j+.5)*m.DY-YCENTRE)<.1
        profile=h.reshape(ref['nx'],m.NY,2)[:,keep,:].mean((1,2));x=ref['x0']+(np.arange(ref['nx'])+.5)*m.DX
        middle=(m.H1+ref['h2'])/2;cross=np.flatnonzero((profile[:-1]<middle)&(profile[1:]>=middle)&(x[:-1]>-.8)&(x[:-1]<.8))
        position=None if not len(cross) else float(x[cross[0]]+(middle-profile[cross[0]])/(profile[cross[0]+1]-profile[cross[0]])*m.DX)
        initial=float(np.sum(area*(m.H1 if ref['kind']=='wall' else np.where(cx<0,m.H1,ref['h2']))));relative_volume=abs(float(area@h)-initial)/initial
        left=(cx>front-.3)&(cx<front-.15)&(abs(y-YCENTRE)<.1);right=(cx>front+.15)&(cx<front+.3)&(abs(y-YCENTRE)<.1)
        if ref['kind']=='wall':right=(cx>front+.1)&(cx<-.02)&(abs(y-YCENTRE)<.1)
        ql=float(np.average(h[left]*u[left],weights=area[left]));qr=float(np.average(h[right]*u[right],weights=area[right]));ml=float(np.average(h[left]*u[left]**2+.5*m.G*h[left]**2,weights=area[left]));mr=float(np.average(h[right]*u[right]**2+.5*m.G*h[right]**2,weights=area[right]));residual=abs(ref['shock_speed']*(qr-ql)-(mr-ml))/max(abs(ml),abs(mr),1e-12)
        checks=dict(finite=bool(np.isfinite(h).all() and np.isfinite(u).all() and np.isfinite(v).all()),nonnegative_depth=bool((h>=0).all()),window_depth_l1=l1<.05,window_normal_velocity_l1=ul1<.08,window_transverse_velocity_l1=vl1<.05,shock_position=position is not None and abs(position-front)<3*m.DX,closed_volume=relative_volume<1e-10,momentum_jump=residual<.03)
        np.savez_compressed(path.with_name('window-fields.npz'),h=h[region],u=u[region],v=v[region],cx=cx[region],cy=y[region])
        return dict(checks=checks,window_depth_l1=l1,window_normal_velocity_l1=ul1,window_transverse_velocity_l1=vl1,shock_position_m=position,expected_shock_position_m=front,closed_volume_relative_error=relative_volume,momentum_jump_relative_residual=residual)

def main():
    OUT.mkdir(exist_ok=True);identity=binary_manifest(m.EXE)
    plan=dict(created='Before closed-window execution; original stage-boundary failures retained separately',reference='Same independently derived compressive jump/reflected-bore states; closed walls outside the analytical window. At0.5s the outer-wall waves cannot reach the window. The reflection wall atx=0 is part of the wall case reference.',window=dict(x_min=-.5,x_max=.5,y_centre=YCENTRE,y_half_width=.1,time_s=T),duration_s=1,report_step_s=.1,gravity_m_s2=m.G,dx_m=m.DX,dy_m=m.DY,angles_deg=[0,64],orders=[1,2],kinds=['stationary','moving-upstream','oblique','wall'],criteria=dict(window_depth_l1=.05,window_normal_velocity_l1=.08,window_transverse_velocity_l1=.05,shock_position_cells=3,closed_volume_relative=1e-10,momentum_jump_relative=.03),binaries=identity,driver_sha256=digest(Path(__file__).read_bytes()),reference_driver_sha256=digest((HERE/'check_jumps.py').read_bytes()))
    (OUT/'plan.json').write_text(json.dumps(plan,indent=2)+'\n');results=[]
    for kind in plan['kinds']:
        for angle in plan['angles_deg']:
            for order in plan['orders']:
                name=f'{kind}-angle{angle}-order{order}';work=OUT/name;work.mkdir(exist_ok=False)
                text,ref,cx=m.make(kind,order,angle)
                start=text.index('[2D_BOUNDARY_CONDITIONS]');rows=text[start:].splitlines()[1:]
                text=text[:start]+'[2D_BOUNDARY_CONDITIONS]\n'+'\n'.join(' '.join(row.split()[:2])+' WALL' for row in rows if row.strip())+'\n'
                (work/'model.inp').write_text(text);(work/'reference.json').write_text(json.dumps(ref,indent=2)+'\n')
                with (work/'process.log').open('w') as log:
                    process=subprocess.run([str(m.EXE),str(work/'model.inp'),str(work/'model.rpt'),str(work/'model.out')],cwd=work,env=engines.env(1,[str(m.EXE.parent),str(m.EXE.parent.parent/'engine')]),stdout=log,stderr=subprocess.STDOUT,timeout=300)
                assert process.returncode==0 and binary_manifest(m.EXE)==identity,name
                result=dict(case=name,**assess(work/'surface.h5',ref,cx));(work/'metrics.json').write_text(json.dumps(result,indent=2)+'\n');results.append(result);(OUT/'summary.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(result),flush=True)
    rotations=[]
    for kind in plan['kinds']:
        for order in plan['orders']:
            with np.load(OUT/f'{kind}-angle0-order{order}/window-fields.npz') as a,np.load(OUT/f'{kind}-angle64-order{order}/window-fields.npz') as b:
                # Coordinate roundoff can change the set at the window edge; align by original cell order.
                if a['h'].shape==b['h'].shape:
                    rotations.append(dict(kind=kind,order=order,max_depth_difference_m=float(np.max(abs(a['h']-b['h']))),max_velocity_difference_m_s=float(max(np.max(abs(a['u']-b['u'])),np.max(abs(a['v']-b['v']))))))
                else:rotations.append(dict(kind=kind,order=order,status='Window edge tie requires cell-index alignment'))
    (OUT/'rotation-comparisons.json').write_text(json.dumps(rotations,indent=2)+'\n')
    return 0 if all(all(r['checks'].values()) for r in results) else 1

if __name__=='__main__':raise SystemExit(main())
