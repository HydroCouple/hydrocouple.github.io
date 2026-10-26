"""Assemble a review article and portable evidence from completed suite outputs."""
from __future__ import annotations
import argparse
import csv
import json
import hashlib
import importlib.util
from pathlib import Path
import shutil
import numpy as np

HERE=Path(__file__).resolve().parent
SITE=HERE.parents[1]
BENCH=SITE.parent/'openswmm.engine.benchmarks'
SLUG='uk-2d-benchmark-assessment'


def copy_evidence(source,destination,image_root):
    destination.mkdir(parents=True,exist_ok=True)
    scores=json.loads((source/'scores.json').read_text(encoding='utf-8'))
    completed={c['case'] for c in scores['cells'] if c.get('checks') and c['solver']=='swmm2d-cpu-full-swe-rk2'}
    replacements={}
    for figure in sorted(source.glob('uk-ea-*/figures/*.png')):
        if figure.parent.parent.name not in completed:continue
        sub=destination.relative_to(HERE/'evidence').parts
        prefix=('-'.join(sub)+'-') if sub else ''
        name=prefix+figure.parent.parent.name+'-'+figure.name
        shutil.copy2(figure,image_root/name)
        # Report is nested beneath articles/<slug>/evidence[/regression].
        depth=len(destination.relative_to(HERE).parts)+2
        replacements[figure.relative_to(source).as_posix()]='../'*depth+'img/articles/'+SLUG+'/'+name
    for file in sorted(source.rglob('*')):
        if not file.is_file() or any(p.startswith('.') for p in file.relative_to(source).parts):continue
        first=file.relative_to(source).parts[0]
        if first.startswith('uk-ea-') and first not in completed:continue
        if file.suffix not in ('.csv','.json','.md','.html','.inp','.log','.rpt'):continue
        if file.name in ('process.log','model.rpt'):continue
        target=destination/file.relative_to(source);target.parent.mkdir(parents=True,exist_ok=True)
        if file.suffix in ('.html','.md') or file.name=='report-output-register.csv':
            text=file.read_text(encoding='utf-8')
            for old,new in replacements.items():text=text.replace(old,new)
            target.write_text(text,encoding='utf-8')
        else:shutil.copy2(file,target)


def river_supplement(source,image_root):
    """Publish only evidence that belongs to the finalized river sweep."""
    source=Path(source);scores=json.loads((source/'scores.json').read_text(encoding='utf-8'))
    if not scores.get('coverage'):raise ValueError('River sweep has not finalized coverage')
    destination=HERE/'evidence/river';destination.mkdir(parents=True,exist_ok=True)
    completed={c['case'] for c in scores['cells'] if c['solver']=='swmm2d-cpu-full-swe-rk2' and c.get('checks') and c['verdict']=='PASS'}
    expected={'uk-river-'+k for k in ['a1','a2','a3','a4','a5','e','f-mean','f-high','l','l-fine']}
    if expected-completed:raise ValueError('River article requires all ten source-derived executions; missing '+','.join(sorted(expected-completed)))
    replacements={}
    for case in sorted(completed):
        key=case.removeprefix('uk-river-')
        suffix='gauges' if key.startswith('l') else 'profile' if key.startswith('a') else 'profiles' if key.startswith('f-') else 'histories'
        for figure in source.glob(f'figures/{key}-{suffix}.png'):
            name='river-'+figure.name;shutil.copy2(figure,image_root/name)
            replacements[figure.relative_to(source).as_posix()]='../../../../img/articles/'+SLUG+'/'+name
    # Case-level evidence and independent tables stay with their executed manifests.
    for file in sorted(source.rglob('*')):
        if not file.is_file():continue
        rel=file.relative_to(source)
        if rel.parts[0].startswith('uk-river-') and rel.parts[0] not in completed:continue
        if file.suffix not in ['.csv','.json','.inp','.md','.html']:continue
        if file.name in ['probes.csv'] or any(p.startswith('.') for p in rel.parts):continue
        target=destination/rel;target.parent.mkdir(parents=True,exist_ok=True)
        if file.suffix in ['.md','.html'] or file.name=='report-output-register.csv':
            text=file.read_text(encoding='utf-8')
            for old,new in replacements.items():text=text.replace(old,new)
            target.write_text(text,encoding='utf-8')
        else:shutil.copy2(file,target)
    # The unavailable bridge still has real measured targets; include those separately.
    bridge=BENCH/'corpus/uk-ea-river/uk-river-j/reference'
    for file in bridge.glob('*'):
        target=destination/'bridge-targets'/file.name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(file,target)
    rows=[]
    if {'uk-river-l','uk-river-l-fine'}<=completed:
        coarse=json.loads((source/'uk-river-l/metrics.json').read_text())['reference_fit']['metrics']
        fine=json.loads((source/'uk-river-l-fine/metrics.json').read_text())['reference_fit']['metrics']
        for a,b in zip(coarse,fine):rows.append(f'| {a["probe"]} | {1000*a["rmse_m"]:.2f} | {1000*b["rmse_m"]:.2f} |')
    figures=[]
    for key in ['l','a1','f-mean']:
        if 'uk-river-'+key not in completed:continue
        suffix='gauges' if key=='l' else 'profile' if key=='a1' else 'profiles'
        matches=sorted(source.glob(f'figures/{key}-{suffix}.png'))
        if matches:figures.append(f'![River Test {key.upper()}: SWMM2D and independent reference](../../img/articles/{SLUG}/river-{matches[0].name})')
    repeat=''
    if (source/'regression-repeat.json').exists():
        records=json.loads((source/'regression-repeat.json').read_text(encoding='utf-8'))['cases']
        if len(records)!=10 or any(r['verdict']!='BASELINE-PASS' for r in records):raise ValueError('Incomplete river regression repeat')
        maximum=max(r['maximum_absolute_change'] for r in records)
        repeat=f'All ten executable configurations also passed a separate repeat against their reviewed numerical anchors. The maximum absolute change in saved probe quantities was {maximum:.6g}. This is local numerical repeatability; cross-platform tolerance qualification and physical validation remain separate. The [repeat identity records](evidence/river/regression-repeat.json) bind the inputs, analysis, references and executed binaries.\n\n'
    return '''## Additional river benchmarks and recovered measurements

Additional resources identify an earlier Environment Agency river benchmark collection, W5-105, separate from the numbered 2D scenarios above. A separately retrieved official test specification supplies the analytical water-level tables for Test A and the laboratory measurement tables for Test L. The latter are original tabulated observations, rather than values digitized from a chart. The source result-PDF filenames for Tests K and L are swapped; cover titles and report identifiers establish their identity.

The new dedicated `uk_river` suite runs SWMM2D reproductions of five one-hour Test A profiles, the full four-hour Ippen scenario, two full 30-hour monoclinal-wave roughness variants, and Test L at two mesh spacings. It remains excluded from engine-to-engine parity. Numerical PASS denotes complete output and conservation checks, while analytical and measured residuals are reported separately.

Test L represents the physical 19.3 m constricted laboratory channel, with fitted 45-degree taper walls. All four source gauges have 251 tabulated measurements from 0 to 10 seconds at 0.04-second intervals. The fit uses 250 measurements per gauge after the first saved output, without fitting a time shift. The physical gate opened over approximately 0.2 seconds; these runs release it instantaneously. This physical-channel setup differs from the historical result report's extended reservoir and delayed analytical initialization.

| Gauge | 0.05 m mesh RMSE (mm) | 0.025 m mesh RMSE (mm) |
|---|---:|---:|
'''+chr(10).join(rows)+'''

Refinement does not uniformly improve agreement: it improves S4 and slightly worsens S1–S3. This two-grid result does not establish convergence or successful validation. Gate opening, measurement sampling and other representation effects need further investigation. Instrument uncertainty is not supplied; the table rounds water levels to 0.001 m.

'''+chr(10).join(figures)+'''

The five Test A comparisons retain the published analytical elevations and source bed geometry. Their residuals include SWMM2D's bed-friction treatment versus the source 1D finite-width hydraulic-radius treatment. The monoclinal cases likewise compare the report's constant-Manning variants against the source-declared analytical profile translated at its prescribed wave speed; the analytical wave uses constant Chézy resistance. These model-form differences prevent treating the errors as isolated numerical discretization errors.

Test J's four measured bridge-afflux targets are preserved, but a faithful bridge plus paired no-bridge model remains pending. Test E completes its numerical scenario, while its published analytical reference remains unqualified: the source report identifies a sine/cosine phase conflict, and its linear-friction formula leaves a representative velocity unspecified. No fitted phase, friction value or surrogate bridge loss is used to manufacture a comparison.

'''+repeat+'''The [river technical report](evidence/river/report.html), [scores and coverage](evidence/river/scores.json), and [output register](evidence/river/report-output-register.csv) retain the results, reference tables, identities and pending counterparts. These added references do not resolve the numbered 2D Test 6A measurement gap or Test 8A/8B inputs. The supplement is partial and does not claim reproduction of every panel in the earlier river reports.

Source: Crowder and colleagues, Environment Agency [W5-105/TR1 test specifications](https://assets.publishing.service.gov.uk/media/602ac6a2d3bf7f031e1bdcea/_Benchmarking_of_Hydraulic_River_Modelling_Software_Packages_-_Test_Specifications.pdf), Appendices A and C, and the corresponding W5-105/TR2 result reports. Only analytical or measured reference series appear in the new comparisons.

'''


def wall_supplement(source,image_root):
    """Publish a finalized planned wall study without partial or stale cases."""
    source=Path(source)
    plan=json.loads((source/'assessment-plan.json').read_text(encoding='utf-8'))
    cw=plan['cw'];expected=set()
    for phase in plan['phases']:
        for location in phase['locations']:
            expected.add(f"{phase['test']}-cs{phase['cs']:g}-{location}-cw{cw:g}")
    if not expected:raise ValueError('Wall study plan has no cases')
    completed={};identities=[];reference_ids=[];pinned_hashes=None
    for name in expected:
        work=source/name
        if not (work/'metrics.json').exists():
            raise ValueError('Wall article requires every planned case; missing '+name)
        metric=json.loads((work/'metrics.json').read_text(encoding='utf-8'))
        manifest=json.loads((work/'manifest.json').read_text(encoding='utf-8'))
        if metric.get('returncode')!=0 or not metric.get('checks') or not all(metric['checks'].values()):
            raise ValueError('Wall article requires passing numerical checks: '+name)
        if hashlib.sha256((work/'model.inp').read_bytes()).hexdigest()!=manifest['input_sha256']:
            raise ValueError('Wall executed input hash mismatch: '+name)
        if hashlib.sha256((work/'probe-locations.csv').read_bytes()).hexdigest()!=manifest['probe_sha256']:
            raise ValueError('Wall executed probe identity mismatch: '+name)
        if manifest['uk_test']=='6a' and metric['observed']['status']!='compared':
            raise ValueError('Wall laboratory comparison missing: '+name)
        if manifest['uk_test']=='6a':
            reference=hashlib.sha256((work/'reference/observations.csv').read_bytes()).hexdigest()
            if reference!=manifest['observations_sha256']:
                raise ValueError('Wall measured reference identity mismatch: '+name)
            reference_ids.append(reference)
        if pinned_hashes is None:
            provenance=json.loads((source/'build-provenance.json').read_text(encoding='utf-8'))
            pinned_hashes=set(provenance['binaries'].values())
        if len(manifest.get('binaries',{}))<2 or not set(manifest['binaries'].values())<=pinned_hashes:
            raise ValueError('Wall executed binary identity mismatch: '+name)
        identities.append(manifest['binaries'])
        completed[name]=metric
    if any(identity!=identities[0] for identity in identities):
        raise ValueError('Wall cases require identical executed CLI/library identities')
    if len(set(reference_ids))!=1:
        raise ValueError('Wall cases require the same measured subset')
    report_identity=json.loads((source/'report-provenance.json').read_text(encoding='utf-8'))
    if set(report_identity['cases'])!=expected:
        raise ValueError('Wall report does not cover the finalized case set')
    if hashlib.sha256((source/'figure-display-specs.json').read_bytes()).hexdigest()!=report_identity['display_specs_sha256']:
        raise ValueError('Wall report axis specification identity mismatch')
    for name in expected:
        if report_identity['cases'][name]!=json.loads((source/name/'manifest.json').read_text())['input_sha256']:
            raise ValueError('Wall report input identity mismatch: '+name)
    summary=json.loads((source/'summary.json').read_text(encoding='utf-8'))
    if {row['case']:row for row in summary}!=completed:
        raise ValueError('Wall summary is not finalized against the executed metrics')
    interpretation=json.loads((source/'interpretation.json').read_text(encoding='utf-8'))
    if not interpretation.get('finding') or not interpretation.get('qualification'):
        raise ValueError('Wall study interpretation has not been finalized')
    destination=HERE/'evidence/wall-sensitivity'
    if destination.exists():shutil.rmtree(destination)
    destination.mkdir(parents=True)
    for name in ['report.md','summary.json','assessment-plan.json','build-provenance.json','interpretation.json','report-provenance.json','merge-provenance.json','paired-comparisons.json','implementation-verification.json','figure-display-specs.json']:
        shutil.copy2(source/name,destination/name)
    for preflight in source.glob('preflight-clock-*/verification.json'):
        target=destination/preflight.parent.name;target.mkdir()
        shutil.copy2(preflight,target/preflight.name)
    for name in sorted(completed):
        work=source/name;target=destination/name;target.mkdir()
        for filename in ['metrics.json','manifest.json','model.inp','case.json','canonical-case.json','probes.csv','probe-locations.csv','probe-map.json','volume.csv','process.log']:
            shutil.copy2(work/filename,target/filename)
        if (work/'reference').exists():
            (target/'reference').mkdir()
            for ref in (work/'reference').iterdir():
                if ref.suffix in ['.csv','.json']:shutil.copy2(ref,target/'reference'/ref.name)
    report=(destination/'report.md').read_text(encoding='utf-8')
    for figure in source.glob('6*-cs*-*.png'):
        name='wall-'+figure.name;shutil.copy2(figure,image_root/name)
        report=report.replace(']('+figure.name+')','](../../../../img/articles/'+SLUG+'/'+name+')')
    (destination/'report.md').write_text(report,encoding='utf-8')
    spec=importlib.util.spec_from_file_location('wall_evidence_renderer',BENCH/'suites/uk_2d/render.py')
    renderer=importlib.util.module_from_spec(spec);spec.loader.exec_module(renderer)
    (destination/'report.html').write_text(renderer.render(report),encoding='utf-8')
    coverage_control=any('-all-' in name for name in expected)
    coverage=(' A further Test 6A control applies the same coefficient to every exterior wall to assess wall coverage.' if coverage_control else '')
    featured='6a-cs0-uk-4-26.png' if coverage_control else '6a-cs0.1-uk-4-26.png'
    figure=(f'![Test 6A wall-friction controls against recovered UCL markers, using UK Figure 4.26 gauge panels and axes.](../../img/articles/{SLUG}/wall-{featured})\n\n'
            if (source/featured).exists() else '')
    return f"""## Selective wall friction and Smagorinsky mixing

The 25 October follow-up executes {len(completed)} full-duration Test 6 configurations. Tangential wall drag is assigned separately to the throat and obstruction, with prescribed dimensionless Cw={cw:g}; this is a diagnostic sensitivity value, not a measured material property.{coverage} Bed roughness, initial conditions and constrained geometry remain fixed. Coriolis is off. The earlier assessment’s speed used the edge-flux reconstruction; all configurations in this follow-up use accepted cell q/h, so wall effects are evaluated within its paired runs.

{interpretation['finding']}

{interpretation['qualification']}

{figure}The [wall-friction technical report](evidence/wall-sensitivity/report.html) reproduces the gauge panels and axis limits of UK Figures 4.25–4.28, with full-range companions. It retains the executed inputs, measured-subset errors, water balances, wall-energy accounting and exact binary identities. Laboratory comparison uses the recovered UCL markers only; Test 6B remains a numerical scenario. Native report-grid checks verify 0.1 s and 1 s output before the long runs.

"""


def g2_supplement(source,image_root):
    """Require complete one-factor controls before exposing the jump diagnosis."""
    source=Path(source)
    plan=json.loads((source/'assessment-plan.json').read_text())
    expected={'control'}|{row['name'] for row in plan['variants']}
    if expected!={'control','uniform-level','cfl02','local005'}:
        raise ValueError('G2 supplement requires the three declared diagnostic controls')
    if any(not (source/name/'metrics.json').exists() for name in expected):
        raise ValueError('G2 supplement requires every planned full-duration control')
    identities=[];references=[];completed={}
    for name in sorted(expected):
        work=source/name;metric=json.loads((work/'metrics.json').read_text());manifest=json.loads((work/'manifest.json').read_text())
        if hashlib.sha256((work/'model.inp').read_bytes()).hexdigest()!=manifest['input_sha256']:
            raise ValueError('G2 executed input hash mismatch: '+name)
        if metric['returncode']!=0 or not metric['checks'] or not all(metric['checks'].values()):
            raise ValueError('G2 numerical checks incomplete: '+name)
        if metric['observed']['status']!='compared':raise ValueError('G2 measured comparison missing: '+name)
        probe=hashlib.sha256((work/'probe-locations.csv').read_bytes()).hexdigest()
        reference=hashlib.sha256((work/'reference/observations.csv').read_bytes()).hexdigest()
        if probe!=manifest['probe_sha256'] or reference!=manifest['observations_sha256']:
            raise ValueError('G2 probe or measured reference identity mismatch: '+name)
        rows=list(csv.DictReader((work/'probes.csv').open()))
        if len(rows)!=7200 or float(rows[-1]['time_s'])!=120:
            raise ValueError('G2 output duration incomplete: '+name)
        identities.append(manifest['binaries']);references.append(reference);completed[name]=(metric,manifest)
    if any(value!=identities[0] for value in identities) or len(identities[0])<2 or len(set(references))!=1:
        raise ValueError('G2 controls require identical binary and measured-reference identities')
    factors=json.loads((source/'factor-audit.json').read_text())
    if factors['status']!='PASS' or any(factors['cases'][name]['input_sha256']!=completed[name][1]['input_sha256'] for name in expected-{'control'}):
        raise ValueError('G2 controlled-factor audit does not match the executed inputs')
    summary=json.loads((source/'summary.json').read_text())
    if {r['variant']:r['metrics'] for r in summary}!={name:value[0] for name,value in completed.items()}:
        raise ValueError('G2 summary differs from executed records')
    provenance=json.loads((source/'report-provenance.json').read_text())
    if set(provenance['figures'])!=set(provenance['figure_sha256']):
        raise ValueError('G2 report figure register is incomplete')
    if provenance['cases']!={name:value[1]['input_sha256'] for name,value in completed.items()}:
        raise ValueError('G2 report input identity mismatch')
    if hashlib.sha256((source/'figure-display-specs.json').read_bytes()).hexdigest()!=provenance['display_specs_sha256']:
        raise ValueError('G2 report axis specification identity mismatch')
    for name,value in provenance['figure_sha256'].items():
        if hashlib.sha256((source/name).read_bytes()).hexdigest()!=value:raise ValueError('G2 figure identity mismatch: '+name)
    native=json.loads((source/'regression-jumps-committed/scores.json').read_text())
    if len(native['cells'])!=16 or any(row['verdict']!='PASS' for row in native['cells']):
        raise ValueError('G2 analytical jump regression is incomplete')
    native_plan=json.loads((source/'regression-jumps-committed/plan.json').read_text())
    if native_plan['binaries']!=identities[0]:raise ValueError('G2 jump regression binary identity mismatch')
    for relative,key in [('suite.py','suite_sha256'),('references.py','reference_sha256')]:
        if hashlib.sha256((BENCH/'suites/analytical/hydraulic_jumps'/relative).read_bytes()).hexdigest()!=native_plan[key]:
            raise ValueError('G2 jump regression source identity mismatch: '+relative)
    native_cases=list((source/'regression-jumps-committed').glob('*-order*'))
    if {work.name for work in native_cases}!={cell['case'] for cell in native['cells']}:
        raise ValueError('G2 analytical case register is incomplete')
    for work in native_cases:
        manifest=json.loads((work/'manifest.json').read_text())
        if manifest['binaries']!=identities[0] or hashlib.sha256((work/'model.inp').read_bytes()).hexdigest()!=manifest['input_sha256']:
            raise ValueError('G2 analytical case identity mismatch: '+work.name)
    interpretation=json.loads((source/'interpretation.json').read_text())
    if not interpretation.get('finding') or not interpretation.get('qualification'):
        raise ValueError('G2 interpretation is not finalized')
    for filename,key in [('interpretation.json','interpretation_sha256'),('report.html','report_sha256')]:
        if hashlib.sha256((source/filename).read_bytes()).hexdigest()!=provenance.get(key):
            raise ValueError('G2 reviewed report identity mismatch: '+filename)
    destination=HERE/'evidence/g2-jump-sensitivity'
    if destination.exists():shutil.rmtree(destination)
    destination.mkdir(parents=True)
    for name in ['assessment-plan.json','summary.json','factor-audit.json','paired-comparisons.json','report-provenance.json','figure-display-specs.json','front-positions.csv','G2-sampled-states.json','interpretation.json','analytical-build-provenance.json']:
        shutil.copy2(source/name,destination/name)
    for name in completed:
        work=source/name;target=destination/name;target.mkdir()
        for filename in ['model.inp','case.json','manifest.json','metrics.json','probes.csv','probe-locations.csv','probe-map.json','volume.csv','process.log']:
            shutil.copy2(work/filename,target/filename)
        if (work/'mesh-provenance.json').exists():shutil.copy2(work/'mesh-provenance.json',target/'mesh-provenance.json')
        shutil.copytree(work/'reference',target/'reference')
    for relative in ['closed-window-jumps/plan.json','closed-window-jumps/summary.json','closed-window-jumps/rotation-comparisons.json',
                     'analytical-jumps/plan.json','analytical-jumps/summary.json','rejected-analytical-fixture-clock/rejection.json',
                     'local-mesh/mesh-request.json','local-mesh/mesh-provenance.json','coarse-mesh-equivalence/mesh-provenance.json',
                     'regression-jumps-committed/scores.json','regression-jumps-committed/plan.json','regression-jumps-committed/report.md']:
        target=destination/relative;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source/relative,target)
    for work in native_cases:
        target=destination/'regression-jumps-committed'/work.name;target.mkdir()
        for filename in ['manifest.json','reference.json','metrics.json']:shutil.copy2(work/filename,target/filename)
    scripts=destination/'verification-source';scripts.mkdir()
    for filename in ['run_controls.py','prepare_mesh.py','audit_factors.py','check_jumps.py','check_closed_jumps.py','summarize_controls.py']:
        shutil.copy2(BENCH/'tests/verification/g2-diagnosis-2026-10-25'/filename,scripts/filename)
    for filename in ['suite.py','references.py','README.md']:
        (scripts/'regression').mkdir(exist_ok=True)
        shutil.copy2(BENCH/'suites/analytical/hydraulic_jumps'/filename,scripts/'regression'/filename)
    report=(source/'report.html').read_text()
    for filename in provenance['figures']:
        name='jump-'+filename;shutil.copy2(source/filename,image_root/name)
        report=report.replace('src="'+filename+'"','src="../../../../img/articles/'+SLUG+'/'+name+'"')
    (destination/'report.html').write_text(report)
    return f'''## Investigating the G2 hydraulic jump

The follow-up isolates initial water-surface interpretation, timestep size and local mesh refinement in three full-duration Test 6A controls. All retain the same pinned solver, free-slip walls, Cs=0 and measured subset. The jump is assessed through its local depth/speed histories and a sampled critical-front trajectory, rather than water balance alone.

{interpretation['finding']}

{interpretation['qualification']}

![Test 6A diagnostic controls against recovered UCL markers, using UK Figure 4.26 panels and axes.](../../img/articles/{SLUG}/jump-g2-controls-uk-4-26.png)

The [G2 technical report](evidence/g2-jump-sensitivity/report.html) includes the one-factor comparisons, local flow maps, exact inputs, and sixteen analytical jump/reflection regression checks. The canonical UK inputs and reviewed anchors remain unchanged.

'''


def assemble(results,regression,analytical,river=None,wall=None,g2_study=None):
    scores=json.loads((results/'scores.json').read_text(encoding='utf-8'))
    if not scores.get('coverage'):raise ValueError('Sweep has not finalized coverage')
    image_root=SITE/'img/articles'/SLUG;image_root.mkdir(parents=True,exist_ok=True)
    copy_evidence(results,HERE/'evidence',image_root)
    copy_evidence(regression,HERE/'evidence/regression',image_root)
    analog=json.loads((analytical/'scores.json').read_text(encoding='utf-8'))
    target=HERE/'evidence/analytical';target.mkdir(parents=True,exist_ok=True)
    shutil.copy2(analytical/'scores.json',target/'scores.json')
    for path in analytical.glob('*/comparison.npz'):
        with np.load(path) as f:
            with (target/(path.parent.name+'.csv')).open('w',newline='',encoding='utf-8') as stream:
                writer=csv.writer(stream);writer.writerow(['bed_m','reference_depth_m','final_computed_depth_m','final_speed_mps','maximum_depth_drift_m','maximum_speed_mps'])
                writer.writerows(zip(f['bed'],f['reference_depth'],f['computed_depth'],f['speed'],f['maximum_depth_drift'],f['maximum_speed']))
    coverage=scores['coverage'];revision=analog['engine_sha'];rows=[]
    shutil.copy2(BENCH/'results/uk_2d/official-source-verification.json',HERE/'evidence/official-source-verification.json')
    engine=HERE/'evidence/engine';engine.mkdir(parents=True,exist_ok=True)
    for name in ['output-freshness.patch','build-provenance.json','regression-proof.json','before-test.log','after-test.log']:
        shutil.copy2(BENCH/'results/uk_2d/output-freshness-fix'/name,engine/name)
    for cell in scores['cells']:
        if cell['case']=='required-coverage' or cell['solver']=='swmm2d-own-baseline':continue
        case=cell['case'].removeprefix('uk-ea-2013-t').lstrip('0').upper()
        rows.append(f"| {case} | {cell['verdict']} | {cell.get('observed_status','unavailable').replace('_',' ')} |")
    lake_rows=[]
    for cell in analog['cells']:
        m=cell['metrics'];lake_rows.append(f"| {cell['case'].replace('analytic-lake-at-rest-','').capitalize()} | {m['linf_m']:.3g} | {m['max_speed_mps']:.3g} | {cell['verdict']} |")
    one=results/'uk-ea-2013-t01';r=list(csv.DictReader((one/'probes.csv').open(encoding='utf-8')))
    final=next(x for x in reversed(r) if x['probe']=='2');retention=float(final['level_m']);error_mm=(retention-10.25)*1000
    high=next(x for x in r if x['probe']=='2' and float(x['time_s'])==39600)
    high_residual_mm=1000*(float(high['level_m'])-10.35)
    observed=results/'uk-ea-2013-t6a/metrics.json';fit_rows=[]
    mesh_note=''
    mesh_path=results/'uk-ea-2013-t6a/mesh-provenance.json'
    if mesh_path.exists():
        mesh=json.loads(mesh_path.read_text(encoding='utf-8'));audit=mesh['audit']
        mesh_note=f'''The Test 6 results below use the corrected GUI-generated constrained Delaunay mesh from 24 October 2026: {audit['vertex_count']:,} vertices and {audit['triangle_count']:,} triangles. The mesh follows the flume, dam abutments, 1 m opening and rotated building. It also restores the sloping side-bank strips from the dimensioned source drawing. The opening and bank toes remain internal edges; all {audit['wall_edge_count']:,} exposed edges are reflective walls. The minimum triangle angle is {audit['min_angle_deg']:.1f}°, with actual edge lengths {audit['min_edge_m']:.4f}–{audit['max_edge_m']:.4f} m, so 0.1 m describes the nominal target.

The active area is 354 m² and the initial volume is 16.618 m³. This is a drawing-based geometric reconstruction, not a vertexwise reproduction of the pixelated DEM. The [mesh and constraint audit](evidence/uk-ea-2013-t6a/mesh-provenance.json) records the exact geometry and generator source identity. Drawing-versus-DEM interpretation and mesh sensitivity remain to be qualified. Because the correction includes boundaries and bank elevations, any result change cannot be attributed to triangle shape alone.

![Corrected Test 6A GUI mesh: red walls, blue internal constraints and source gauges.](../../img/articles/{SLUG}/uk-ea-2013-t6a-constrained-mesh.png)

The earlier Cartesian, flat-bed Test 6 results are superseded. Their [metrics](evidence/history/cartesian-uk-ea-2013-t6a/metrics.json) and [input](evidence/history/cartesian-uk-ea-2013-t6a/model.inp) remain historical records. The [assessment history](evidence/assessment-history.json) identifies the new Test 6 executions and the unchanged earlier runs of Tests 1–5. Those remaining configurations still need their own domain, boundary and breakline mesh corrections.

For Test 6B, elevations are multiplied by 20 in accordance with the written specification and the explicit choice made for this assessment. The supplied 6B DEM scales XY but retains the 6A elevation matrix, so its side-bank heights conflict with that instruction. The [source-scale audit](evidence/uk-ea-2013-t6b/source-scale-audit.json) documents this discrepancy. The represented 6B bank height is 3.1 m; initial depths remain the prescribed 8 m upstream and 0.4 m downstream, with Manning roughness 0.05.
'''
    repeated=json.loads((regression/'scores.json').read_text(encoding='utf-8'))
    repeated_cases={c['case'] for c in repeated['cells'] if c['solver']=='swmm2d-own-baseline' and c['verdict']=='BASELINE-PASS'}
    repeat_note=('Tests 1 and 3, and the corrected Test 6A/6B inputs, have reviewed numerical baselines and separate full-duration repeated executions.'
                 if {'uk-ea-2013-t6a','uk-ea-2013-t6b'}<=repeated_cases else
                 'The two complete fast cases, Tests 1 and 3, have initial numerical baselines and a separate repeated-run check.')
    comparison_note=('The corrected 6B repeat completed before its first-run anchor was reviewed. Its saved outputs were compared after that review; '
                     'the [comparison record](evidence/regression/uk-ea-2013-t6b/post-run-baseline-comparison.json) preserves the sequence and the original unavailable-baseline qualification state.'
                     if (regression/'uk-ea-2013-t6b/post-run-baseline-comparison.json').exists() else '')
    if observed.exists():
        fit=json.loads(observed.read_text(encoding='utf-8'))['observed']
        for m in fit['metrics']:
            fit_rows.append(f"| {m['probe']} | {'Level (m)' if m['quantity']=='level_m' else 'Speed (m/s)'} | {m['n']} | {m['covered_duration_s']:.2f} | {m['bias']:.4g} | {m['rmse']:.4g} |")
    discrepancy='Agreement varies by gauge; this assessment does not establish successful laboratory validation.'
    if mesh_path.exists() and observed.exists():
        g2={m['quantity']:m['rmse'] for m in fit['metrics'] if m['probe']=='G2'}
        discrepancy=(f"The mesh correction has not resolved the G2 mismatch: level RMSE is {g2['level_m']:.3g} m and speed RMSE is {g2['speed_mps']:.3g} m/s against the recovered subset. "
                     'This assessment does not establish successful laboratory validation.')
    figures=[]
    completed={c['case'] for c in scores['cells'] if c.get('checks') and c['solver']=='swmm2d-cpu-full-swe-rk2'}
    for case,name,caption in [
        ('uk-ea-2013-t01','uk-4-3.png','Test 1: UK Figure 4.3 gauges and axes, with scoped equilibrium constraints. Dry intervals are omitted.'),
        ('uk-ea-2013-t6a','uk-4-25.png','Test 6A: UK Figure 4.25 gauge selection, with the recoverable UCL measurement subset. G6 has no recovered markers.'),
        ('uk-ea-2013-t6a','uk-4-26.png','Test 6A: UK Figure 4.26 speed comparison against recovered UCL markers.'),
        ('uk-ea-2013-t04','uk-4-12.png','Test 4: the UK report’s 0.15 m depth contours at one and three hours, shown for SWMM2D as a diagnostic.')]:
        if case not in completed or not (results/case/'figures'/name).exists():continue
        full=f'{case}-{name.replace(".png","-full-range.png")}'
        image=full if case=='uk-ea-2013-t6a' and (image_root/full).exists() else f'{case}-{name}'
        if (image_root/image).exists():figures.append((name,f'![{caption}](../../img/articles/{SLUG}/{image})'))
    fig=dict(figures)
    article=f'''# Assessing SWMM2D with the UK hydraulic benchmarks

### Initial analytical evidence, a digitized laboratory comparison and a reproducible regression corpus

Codex
October 22, 2026

The first implementation of the UK Environment Agency benchmark collection now provides executable SWMM2D models for Tests 1–5, 6A and 6B. This article presents the evidence available from that work: exact equilibrium checks, a limited comparison with published laboratory measurements, and numerical diagnostics from the historical scenarios.

The assessment is still partial. Original laboratory time series, the urban Test 8 inputs, a faithful Test 7 river/floodplain implementation, and spatial and temporal sensitivity studies remain outstanding. A completed simulation or an unchanged regression result does not establish experimental validation.

A fresh download of the official model archive matched the supplied archive byte-for-byte. Both contain Tests 1–7 and the supplementary profile workbooks, without the Test 8 inputs. The [source-verification record](evidence/official-source-verification.json) preserves the URL, date and checksums.

## What is being assessed

The controlling specification is Néelz and Pender’s 2013 Environment Agency report, SC120002/R. Its ten scenarios exercise disconnected ponding, depression filling, momentum over an obstruction, flood propagation, valley flooding, dam-break flow, river/floodplain exchange, urban rainfall and sewer surcharge.

These problems provide different kinds of evidence. Test 6A includes laboratory measurements. Test 1 supplies useful equilibrium constraints. Most other scenarios provide realistic hydraulic configurations without an independent measured or exact transient solution. Their results are therefore reported as diagnostics and regression evidence.

All comparisons in this assessment use SWMM2D with measured or analytical references where available. The complete [technical evidence report](evidence/report.html) retains the scenario coverage, output register, configuration, limitations and links to the underlying data.

## Analytical equilibrium preservation

Two separate lake-at-rest checks use the same CPU full shallow-water configuration as the UK assessment: explicit integration, second-order reconstruction and one timestep tier. One lake remains fully wet; the other contains an exposed region.

For a stationary lake, velocity is zero and the water surface is constant wherever wet. Here the exact reference is the equilibrium over the represented piecewise-flat bed. The test measures whether the solver preserves that state for 60 seconds. It does not establish transient accuracy or convergence over a smooth terrain surface.

| Lake | Maximum depth drift (m) | Maximum spurious speed (m/s) | Check |
|---|---:|---:|---|
{chr(10).join(lake_rows)}

The targets were declared before these runs: maximum depth drift of 0.000001 m, maximum speed of 0.000001 m/s, and continuity error no greater than 0.5%. The [analytical records and reference data](evidence/analytical/scores.json) identify the executed configuration. These are supplementary tests, outside the ten UK scenarios.

## Pond filling and retention

UK Test 1 raises a boundary stage, holds it while a depression fills, and then lowers it until the pond becomes disconnected. The specified high-stage equilibrium is 10.35 m; the retained pond level is 10.25 m.

At the prescribed 10 m spacing and 20-hour duration, SWMM2D’s final level at pond point 2 was {retention:.6f} m, a residual of {error_mm:.3f} mm relative to the specified retention level. At the end of the high-stage hold, the residual was {high_residual_mm:.3f} mm relative to 10.35 m. The report preserves both residuals. Refinement and wetting/drying sensitivity are needed to distinguish the effects of the terrain representation and numerical treatment.

{fig.get('uk-4-3.png','')}

These reference levels constrain equilibrium. They do not provide an exact hydrograph for the transient filling and draining process.

## A limited laboratory comparison

UK Test 6A represents a dam-break wave interacting with an isolated building. The specification requests 0.1 m spacing, a 120-second simulation, Manning roughness of 0.01, water-level output at six gauges, and velocity output where measurements exist.

{mesh_note}

The supplied archive contains the terrain and gauge coordinates but no original measured time series. To obtain an initial comparison, a conservative algorithm recovered only the distinctive isolated magenta diamond markers labelled as UCL measurements in Figures 4.25 and 4.26. It excluded the legend, continuous curves, and ambiguous or overlapping markers.

This recovered 611 markers, grouped into 446 samples by horizontal pixel column, across five gauge/quantity series. Most lie within the first 30 seconds. No reliable G6 markers survived recovery. The extracted points are a visibility-selected subset: the statistics below describe agreement with that subset and must not be generalized to the complete experiment.

| Gauge | Quantity | Samples | Covered time (s) | Bias | RMSE |
|---|---|---:|---:|---:|---:|
{chr(10).join(fit_rows)}

{discrepancy} Geometry, sampling and numerical-resolution effects require investigation with the original measurement records.

Bias and RMSE use the dimensional units shown in the quantity column. Predictions are sampled at the recovered observation times; intervals separated by more than one second are treated as gaps. No time shift is fitted to improve agreement.

{fig.get('uk-4-25.png','')}

{fig.get('uk-4-26.png','')}

Digitization uncertainty is conservatively one pixel in each axis, with physical conversions recorded per chart. Instrument uncertainty is unknown. SWMM2D’s reported speed is reconstructed from cell-edge fluxes; the original instrument and averaging metadata are still needed to establish the measurement operator. Overlapped observations, G6 and the original full records remain unavailable. Original-data recovery and an independent digitization review are required before a stronger laboratory-validation claim.

## The remaining UK scenarios

The requested coverage at this stage is shown below. PASS denotes successful numerical checks, including complete duration, nonnegative finite depths and the declared conservation checks. It is not a score of observed accuracy. Errors and unavailable cases remain part of the record.

| UK test | Numerical execution | Observed comparison |
|---|---|---|
{chr(10).join(rows)}

For example, the independently integrated inflow volumes are 97,200 m³ for Test 2, 1,310 m³ for Test 3, 285,000 m³ for Test 4 and 9,450,000 m³ for Test 5. Agreement with these budgets tests input application and water conservation. It does not determine the correct spatial flow field.

{fig.get('uk-4-12.png','')}

The technical report tracks the UK quantities and gauge selections, including the requested flood-front contours, valley and building-wake profiles, and additional Appendix A snapshots. Test 4 completed its full five-hour duration after an initial budget exclusion. Available counterparts are shown alongside the pending views. Its output register accounts for all 48 Chapter 4 figures and 13 tables. Unfinished counterparts and outstanding map/panel-layout checks are explicitly listed.

Test 6B is treated as a separate numerical scenario. Its geometry is enlarged from the laboratory problem, but the prescribed roughness does not preserve simple Froude-scaled similarity. Laboratory observations are therefore not relabelled as full-scale measurements.

## Retaining the evidence as the engine changes

The cases run in a dedicated suite in HydroCouple’s benchmark repository. Checks distinguish analytical equilibrium, measured goodness of fit, numerical consistency and change from an approved SWMM2D baseline.

{repeat_note} These local repeats reproduced their saved probe values within the recorded tolerances. This is initial regression evidence; cross-platform tolerance qualification remains outstanding. The [regression report](evidence/regression/report.html) records the checks and baseline scope.

{comparison_note}

The assessment uses an isolated build of base revision `{revision.split('+')[0]}` plus a [documented output-cache correction](evidence/engine/output-freshness.patch). The laboratory run exposed a defect that held reported velocities on a 30-second diagnostic cadence despite more frequent output. Refreshing that derived cache when output is prepared corrected the reporting path; a small end-to-end test fails before the correction and passes afterwards. The solver advance was unchanged, and the comparisons shown here use the corrected output. Run manifests preserve binary, source, model, reference and analysis identities. Geometry, boundary treatment, sampling and output cadence are recorded so that a changed result can be investigated. Baselines require an explicit review record and are not automatically overwritten after a failure.

## Scope of the present findings

This work establishes a working regression corpus, seven completed canonical UK simulations, analytical equilibrium-preservation evidence and an exploratory comparison with part of a published laboratory dataset. It also exposes the remaining work: complete experimental records, missing urban inputs, river/floodplain coupling, geometry checks, mesh and timestep sensitivity, peak-output qualification and the unfinished UK report views.

Those limitations define the next assessment stages. The downloadable evidence separates them from the checks already completed.

## References

Néelz, S. and Pender, G. (2013). [Benchmarking the latest generation of 2D hydraulic modelling packages](https://assets.publishing.service.gov.uk/media/6033a943d3bf7f721f4b0d49/_SC120002_Benchmarking_2D_hydraulic_models_Report.pdf). Environment Agency, SC120002/R. Appendix A defines the scenarios; Chapter 4 provides the reporting views; Section 5 discusses limitations of the tests.

[Environment Agency project and source datasets](https://www.gov.uk/flood-and-coastal-erosion-risk-management-research-reports/2d-benchmarking-evaluating-the-latest-generation-of-the-hydraulic-models-for-fcrm).

Soares-Frazão and Zech (2002), isolated-building IMPACT experiment, as cited in SC120002/R. The source charts identify the recovered points as UCL measurements. Their original machine-readable records remain an acquisition priority.
'''
    if river is not None:
        article=article.replace('## Scope of the present findings',river_supplement(river,image_root)+'## Scope of the present findings')
    if wall is not None:
        article=article.replace('## The remaining UK scenarios',wall_supplement(wall,image_root)+'## The remaining UK scenarios')
    if g2_study is not None:
        article=article.replace('## The remaining UK scenarios',g2_supplement(g2_study,image_root)+'## The remaining UK scenarios')
    (HERE/'article.md').write_text(article,encoding='utf-8')
    return HERE/'article.md'

if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--results',type=Path,default=BENCH/'results/uk_2d/assessment-2026-10-24')
    ap.add_argument('--regression',type=Path,default=BENCH/'results/uk_2d/assessment-regression-repeat-2026-10-24')
    ap.add_argument('--analytical',type=Path,default=BENCH/'results/uk_2d/assessment-analytical-2026-10-22')
    ap.add_argument('--river',type=Path,help='Finalized W5-105 river supplement output directory')
    ap.add_argument('--wall',type=Path,help='Finalized Test 6 wall-friction sensitivity directory')
    ap.add_argument('--g2',type=Path,help='Finalized Test 6A jump diagnostic controls')
    args=ap.parse_args();print(assemble(args.results,args.regression,args.analytical,args.river,args.wall,args.g2))
