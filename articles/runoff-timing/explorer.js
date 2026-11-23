// Generated from model.mjs, study/design.mjs and explorer.mjs by assemble.mjs.
(() => {
const ACRE_M2 = 4046.8564224;
const CONFIG = Object.freeze({
  sideSlope: 0.02,
  centerSlope: 0.005,
  roughness: 0.03,
  hours: 48,
});
const METHODS = [
  { id: "lumped", label: "SWMM lumped runoff", color: "#9c6c28" },
  { id: "book", label: "2D open book", color: "#087f78" },
  { id: "drop", label: "2D teardrop", color: "#ad4561" },
];
const STATIONS = [0, 0.08, 0.2, 0.35, 0.5, 0.64, 0.76, 0.86, 0.94, 0.98, 1];
const WIDTHS = [0.05, 0.24, 0.53, 0.74, 0.94, 1, 0.96, 0.82, 0.58, 0.34, 0.12];
const SHAPE_AREA = STATIONS.slice(1).reduce(
  (sum, y, i) => sum + ((y - STATIONS[i]) * (WIDTHS[i] + WIDTHS[i + 1])) / 2,
  0,
);
function parameters(input) {
  const areaAcres = Number(input.areaAcres),
    ratio = Number(input.ratio),
    resolution = Number(input.resolution ?? 1);
  if (
    !Number.isFinite(areaAcres) ||
    areaAcres < 0.1 ||
    areaAcres > 100000 ||
    !Number.isFinite(ratio) ||
    ratio < 0.25 ||
    ratio > 4 ||
    resolution !== 1
  )
    throw new Error(
      "Area or shape ratio is outside the supported range, or the fixed baseline was changed.",
    );
  return { areaAcres, ratio, resolution };
}
function geometry(input, shape = "book") {
  const p = parameters(input),
    area = p.areaAcres * ACRE_M2;
  const length = Math.sqrt(
    area / (p.ratio * (shape === "drop" ? SHAPE_AREA : 1)),
  );
  return {
    area,
    length,
    width: p.ratio * length,
    swmmWidth: 2 * Math.sqrt(area / p.ratio),
  };
}
function halfWidth(yFraction, maxWidth, shape) {
  if (shape === "book") return maxWidth / 2;
  const i = Math.min(
    STATIONS.length - 2,
    Math.max(0, STATIONS.findIndex((y) => y > yFraction) - 1),
  );
  if (yFraction >= 1) return (WIDTHS.at(-1) * maxWidth) / 2;
  const f = (yFraction - STATIONS[i]) / (STATIONS[i + 1] - STATIONS[i]);
  return ((WIDTHS[i] * (1 - f) + WIDTHS[i + 1] * f) * maxWidth) / 2;
}
function bed(x, y, sideSlope = CONFIG.sideSlope) {
  return sideSlope * (Math.abs(x) + y / 4);
}
function stormRates(storm) {
  const cumulative = storm.temporal.cumulative_fraction;
  if (!cumulative || cumulative.length !== 49)
    throw new Error("The NOAA storm record is incomplete.");
  return cumulative
    .slice(1)
    .map(
      (v, i) => (v - cumulative[i]) * storm.frequency.depth_inches * 25.4 * 2,
    );
}
function buildModel(input, method, storm, mesh = null) {
  const p = parameters(input),
    shape = method === "drop" ? "drop" : "book",
    g = geometry(p, shape);
  if (!METHODS.some((m) => m.id === method))
    throw new Error("Unknown comparison method.");
  const slope = input.slopePercent === undefined ? CONFIG.sideSlope : input.slopePercent / 100;
  const shortEvent = Array.isArray(storm.blocksPercent);
  const sections = new Map();
  const add = (key, ...rows) =>
    sections.set(key, [...(sections.get(key) ?? []), ...rows]);
  add(
    "TITLE",
    `NYC ${storm.frequency.return_period_years}-year ${shortEvent ? 1 : 24}-hour | ${method} | ${p.areaAcres} acres | width/length ${p.ratio}`,
  );
  add(
    "OPTIONS",
    "FLOW_UNITS CMS",
    "INFILTRATION HORTON",
    "FLOW_ROUTING DYNWAVE",
    "START_DATE 01/01/2024",
    shortEvent ? "END_DATE 01/01/2024" : "END_DATE 01/03/2024",
    shortEvent ? "END_TIME 08:00:00" : "END_TIME 00:00:00",
    "REPORT_STEP 00:01:00",
    "WET_STEP 00:00:10",
    "DRY_STEP 00:01:00",
    "ROUTING_STEP 10",
    "THREADS 1",
  );
  add("EVAPORATION", "CONSTANT 0");
  add("RAINGAGES", shortEvent ? "RG INTENSITY 0:05 1 TIMESERIES RAIN" : "RG INTENSITY 0:30 1 TIMESERIES RAIN");
  const rain = shortEvent ? storm.blocksPercent.map(percent => percent / 100 * storm.frequency.depth_inches * 25.4 * 12) : stormRates(storm);
  rain.forEach((rate, i) =>
    add(
      "TIMESERIES",
      shortEvent ? `RAIN 01/01/2024 0:${String(i*5).padStart(2,"0")} ${rate.toFixed(9)}` : `RAIN 01/01/2024 ${Math.floor(i / 2)}:${i % 2 ? "30" : "00"} ${rate.toFixed(9)}`,
    ),
  );
  add("TIMESERIES", shortEvent ? "RAIN 01/01/2024 1:00 0" : "RAIN 01/02/2024 0:00 0");
  add(
    "REPORT",
    "CONTINUITY YES",
    "SUBCATCHMENTS ALL",
    "NODES ALL",
    "LINKS ALL",
  );
  if (method === "lumped") {
    add("OUTFALLS", "OUT 0 FREE NO");
      add(
        "SUBCATCHMENTS",
        `S0 RG OUT ${g.area / 10000} 100 ${g.swmmWidth} ${slope * 100} 0`,
      );
      add(
        "SUBAREAS",
        `S0 ${CONFIG.roughness} ${CONFIG.roughness} 0 0 100 OUTLET`,
      );
      add("INFILTRATION", "S0 0 0 0 0 0");
  } else {
    add(
      "2D_OPTIONS",
      "MOMENTUM_EQUATION FULL_SWE",
      "RECONSTRUCTION_ORDER 2",
      "LTS_TIERS 1",
      "CFL_NUMBER 0.4",
      "MAX_TIMESTEP 10",
      "CELL_CLOSURE VFR",
      "FACE_RECONSTRUCTION VFR_FACE",
      "DRY_DEPTH 0.00001",
      "H_MOVE 0.00002",
      "RAINFALL_MODE SYSTEM",
      "EVAPORATION NO",
      "INFILTRATION NO",
      "REPORT_2D NO",
    );
    if (!mesh) throw new Error("A native MeshKit mesh is required for the 1 m² baseline.");
    mesh.vertices.forEach((v) => add("2D_VERTICES", v.map((n) => n.toPrecision(17)).join(" ")));
    mesh.triangles.forEach((v) => add("2D_TRIANGLES", v.join(" ") + " " + CONFIG.roughness + " 0"));
    const openingHalfWidth = halfWidth(0, g.width, shape) / 4;
    mesh.triangles.forEach((cell, index) => {
      for (let edge = 0; edge < 3; edge++) {
        const a = mesh.vertices[cell[(edge + 1) % 3]], b = mesh.vertices[cell[(edge + 2) % 3]];
        if (Math.abs(a[1]) < 1e-8 && Math.abs(b[1]) < 1e-8 && Math.max(Math.abs(a[0]), Math.abs(b[0])) < openingHalfWidth + 1e-8)
          add("2D_BOUNDARY_CONDITIONS", index + " " + edge + " NORMAL_FLOW " + slope / 4);
      }
    });
  }
  return (
    [...sections]
      .map(([key, rows]) => `[${key}]\n${rows.join("\n")}`)
      .join("\n\n") + "\n"
  );
}


const areas = [0.1, 4, 64];
const ratios = [0.25, 1, 4];
const slopes = [0.5, 2];
const periods = [2, 25, 100];
// NOAA Atlas 14 Vol. 10, NYC PDS 60-minute point estimates (archived in evidence/).
const depths = {2: 1.68, 25: 2.89, 100: 3.60};
const blocksPercent = [2, 3, 4, 6, 10, 20, 25, 12, 8, 5, 3, 2];
const hours = 8;
const methods = METHODS;
const scenarios = [];
for (const areaAcres of areas) for (const ratio of ratios)
  for (const slopePercent of slopes) for (const period of periods) {
    scenarios.push({id: `a${areaAcres}-r${ratio}-s${slopePercent}-y${period}`,
      areaAcres, ratio, slopePercent, period});
  }

function surface(settings, shape, refinement) {
  const {width, length} = geometry(settings, shape);
  const stations = shape === 'drop' ? STATIONS : Array.from({length: 9}, (_, j) => j / 8);
  const lines = stations.slice(1).flatMap((end, j) =>
    Array.from({length: refinement}, (_, i) => stations[j] + (end-stations[j])*i/refinement));
  lines.push(1);
  const columns = 8 * refinement;
  const vertices = [], triangles = [];
  for (const f of lines) {
    for (let i = 0; i <= columns; i++) {
      const x = halfWidth(f, width, shape) * (2*i/columns - 1), y = f*length;
      vertices.push([x,y,bed(x,y,settings.slopePercent/100)]);
    }
  }
  for (let j=0; j<lines.length-1; j++) for (let i=0; i<columns; i++) {
    const a=j*(columns+1)+i, b=a+1, c=b+columns+1, d=c-1;
    // Mirror diagonals about the fold to preserve the symmetry of both wings.
    if (i<columns/2) triangles.push([a,b,c],[a,c,d]);
    else triangles.push([a,b,d],[b,c,d]);
  }
  return {vertices,triangles};
}
function inputFor(settings, method, refinement=1) {
  const storm = {blocksPercent, frequency:{return_period_years:settings.period, depth_inches:depths[settings.period]}};
  return buildModel(settings, method, storm, method==='lumped' ? null : surface(settings,method,refinement));
}


// Use the same rainfall scale across storms, zoom levels and basin geometries.
const rainTicks = [0, 3, 6, 9, 12];
const rainInk = '#286889';
const rainFill = '#b6daea';
function rainBars(period, xMinute, yIntensity, fromMinute, toMinute) {
  return blocksPercent.map((percent, i) => {
    const start = Math.max(i*5, fromMinute), end = Math.min((i+1)*5, toMinute);
    if (end <= start) return '';
    const intensity = depths[period] * (percent/100) / (5/60);
    const top = yIntensity(0);
    return `<rect x="${xMinute(start)}" y="${top}" width="${xMinute(end)-xMinute(start)}" height="${yIntensity(intensity)-top}" fill="${rainFill}" stroke="#71a7bf" stroke-width="0.7"><title>Minutes ${i*5}–${(i+1)*5}: ${intensity.toFixed(2)} in/h</title></rect>`;
  }).join('');
}


// Fit both surfaces using one scale so that the equal-area footprints remain comparable.
function terrainViews(settings) {
  const project = (x, y) => [
    0.88*x + 0.52*y,
    0.26*x - 0.64*y - 8*bed(x,y,settings.slopePercent/100),
  ];
  const surfaces = ['book','drop'].map(shape => {
    const g = geometry(settings,shape);
    const vertices = STATIONS.flatMap(f => [-1,0,1].map(sign =>
      project(sign*halfWidth(f,g.width,shape),f*g.length)));
    const xs = vertices.map(p=>p[0]), ys = vertices.map(p=>p[1]);
    const left=Math.min(...xs), top=Math.min(...ys);
    const width=Math.max(...xs)-left, height=Math.max(...ys)-top;
    return {shape,g,width,height,centerX:left+width/2,centerY:top+height/2};
  });
  const scale=Math.min(...surfaces.flatMap(s=>[450/s.width,225/s.height]));
  return Object.fromEntries(surfaces.map(({shape,g,centerX,centerY}) => {
    const toSvg = (x,y) => {
      const [u,v]=project(x,y);
      return [270+scale*(u-centerX),145+scale*(v-centerY)];
    };
    return [shape,drawTerrain(g,shape,toSvg)];
  }));
}

function drawTerrain(g, shape, project) {
  const pt = (x, y) =>
    project(x, y)
      .map((v) => v.toFixed(1))
      .join(",");
  const marker = `arrow-${shape}`;
  let html = `<defs><marker id="${marker}" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto"><path d="M0 0 L5 2.5 L0 5 Z" fill="#087f78"/></marker></defs>`;
  const levels = shape === "drop" ? STATIONS : Array.from({length:13}, (_,i) => i/12);
  for (let j = levels.length - 2; j >= 0; j--) {
    const y0 = levels[j] * g.length,
      y1 = levels[j+1] * g.length,
      h0 = halfWidth(levels[j], g.width, shape),
      h1 = halfWidth(levels[j+1], g.width, shape);
    for (const sign of [-1, 1])
      html += `<polygon points="${pt(0, y0)} ${pt(sign * h0, y0)} ${pt(sign * h1, y1)} ${pt(0, y1)}" fill="${sign < 0 ? "#dce9d9" : "#c4d9cc"}" stroke="#a5bfb0" stroke-width=".6"/>`;
  }
  html += `<path d="M${pt(0, g.length)} L${pt(0, 0)}" stroke="#306f68" stroke-width="3.2"/>`;
  for (const f of [0.3, 0.58, 0.84]) {
    const y = f * g.length,
      h = halfWidth(f, g.width, shape);
    for (const sign of [-1, 1])
      html += `<path d="M${pt(sign * h * 0.82, y)} L${pt(sign * h * 0.08, y - g.length * 0.06)}" fill="none" stroke="#087f78" stroke-width="1.8" marker-end="url(#${marker})"/>`;
  }
  html += `<path d="M${pt(0, g.length * 0.4)} L${pt(0, g.length * 0.08)}" stroke="#087f78" stroke-width="2.6" marker-end="url(#${marker})"/>`;
  const outletHalf = halfWidth(0,g.width,shape)/4;
  html += `<path d="M${pt(-outletHalf,0)} L${pt(outletHalf,0)}" stroke="#173c3a" stroke-width="5" stroke-linecap="round"/>`;
  const outlet = project(0, 0);
  html += `<circle cx="${outlet[0]}" cy="${outlet[1]}" r="4" fill="#173c3a"/><text x="${outlet[0]}" y="${outlet[1] + 22}" text-anchor="middle" fill="#365650" font-size="17">Outlet</text>`;
  return html;
}


const root = document.getElementById('runoff-explorer');
if (root) initialize(root);

function initialize(root) {
  const $ = id => root.querySelector('#rt-'+id);
  const fmt=(n,d=2)=>n.toLocaleString('en-US',{maximumFractionDigits:d});
  const signed=(n,d=1)=>n===0?'0':(n>0?'+':'−')+Math.abs(n).toFixed(d);
  const cfs=35.3146667;
  const controls=[
    {id:'storm',field:'period',values:periods,format:v=>v+' years · '+depths[v].toFixed(2)+' in'},
    {id:'area',field:'areaAcres',values:areas,format:v=>v+' acres'},
    {id:'ratio',field:'ratio',values:ratios,format:v=>String(v)},
    {id:'slope',field:'slopePercent',values:slopes,format:v=>v+'%'}
  ];
  const rows=globalThis.RUNOFF_STUDY;
  if(!Array.isArray(rows)||rows.length!==areas.length*ratios.length*periods.length*slopes.length) {
    $('status').textContent='The simulation data could not be loaded. Open the offline report to explore the complete matrix.';
    return;
  }
  let current, view='flow', zoom=true;
  function select() {
    const selected={};
    for(const c of controls) {
      const el=$(c.id), value=c.values[+el.value];
      selected[c.field]=value;
      $(c.id+'-value').textContent=c.format(value);
      el.setAttribute('aria-valuetext',c.format(value));
    }
    current=rows.find(s=>controls.every(c=>s[c.field]===selected[c.field]));
    if(!current) throw Error('Missing completed scenario');
    const s=current, base=s.runs[0];
    $('status').textContent=`${s.period}-year storm · ${s.areaAcres} acres · width/length ${s.ratio} · side slope ${s.slopePercent}% · valley slope ${s.slopePercent/4}%`;
    $('metrics').innerHTML=s.runs.map((r,i)=>{
      const difference=100*(r.peak/base.peak-1), delay=(r.peakTime-base.peakTime)/60;
      return `<tr><th scope="row">${methods[i].label}</th><td>${fmt(r.peak*cfs,3)}</td><td><strong>${i?signed(difference)+'%':'Reference'}</strong></td><td>${r.peakTime/60}</td><td><strong>${i?signed(delay,0):'—'}</strong></td><td>${fmt(r.centroid/60,1)}</td></tr>`;
    }).join('');
    $('volumes').innerHTML=s.runs.map((r,i)=>
      `<tr><th scope="row">${methods[i].label}</th><td>${fmt(r.rain,3)}</td><td>${fmt(r.atRainEnd,3)}</td><td>${fmt(r.volume,3)}</td><td>${i?signed(100*(r.volume/base.volume-1),3)+'%':'Reference'}</td><td>${i?fmt(r.storage,4):'—'}</td><td>${i?(Math.abs(r.closure)<0.000001?'&lt;0.000001%':fmt(Math.abs(r.closure),6)+'%'):'—'}</td></tr>`
    ).join('');
    const terrain = terrainViews(s);
    for(const id of ['book','drop']) {
      const g=geometry(s,id);
      $(id).innerHTML = terrain[id];
      $(id+'-dim').textContent=`${fmt(g.width,1)} m maximum width × ${fmt(g.length,1)} m long · ${fmt(halfWidth(0,g.width,id)/2,2)} m outlet`;
    }
    $('refinement').textContent = s.refinement
      ? 'After doubling mesh resolution in each direction, the change from the plotted 2D result was '+
        s.refinement.map((r,i)=>methods[i+1].label+': '+signed(r.peakChangePct)+'% in peak and '+signed(r.timeChangeMin,0)+' min in timing').join(' · ')+'.'
      : 'This selection uses the baseline mesh. Four selected scenarios also have a finer-mesh check.';
    chart();
  }
  function chart() {
    const s=current;
    const peaks=s.runs.map(r=>r.peakTime/60);
    const lo=zoom?Math.max(0,Math.min(...peaks)-20):0;
    const hi=zoom?Math.min(hours*60,Math.max(...peaks)+30):hours*60;
    const value=(q,v)=>view==='volume'?100*v/s.runs[0].rain:q*cfs/(view==='unit'?s.areaAcres:1);
    const curves=s.runs.map(r=>r.samples.slice(lo,hi+1).map(([q,v],i)=>[i+lo,value(q,v)]));
    const top=Math.max(...curves.flat().map(p=>p[1]))*1.07;
    const left=81, right=925;
    const rainTop=32, rainBottom=140, plotTop=190, bottom=465;
    const x=t=>left+(t-lo)/(hi-lo)*(right-left);
    const y=v=>bottom-v/top*(bottom-plotTop);
    const rainY=intensity=>rainTop+intensity/rainTicks.at(-1)*(rainBottom-rainTop);
    const path=points=>points.map(([t,v],i)=>(i?'L':'M')+x(t).toFixed(2)+','+y(v).toFixed(2)).join(' ');
    const label=(a,b,str,align='middle')=>`<text x="${a}" y="${b}" text-anchor="${align}" font-size="15" fill="#3e5855">${str}</text>`;
    let mark=`<defs><clipPath id="rt-plot-clip"><rect x="${left}" y="${plotTop-2}" width="${right-left}" height="${bottom-plotTop+4}"/></clipPath></defs>`;
    mark+=`<path d="M${left},${rainTop} H${right}" stroke="${rainInk}"/>`;
    mark+=rainBars(s.period,x,rainY,lo,hi);
    for(let i=0;i<=4;i++) {
      const v=top*i/4;
      mark+=`<path d="M81,${y(v)} H${right}" stroke="#dbe4e1"/>`+label(72,y(v)+5,fmt(v,top<2?2:1),'end');
    }
    for(let i=0;i<=5;i++) {const t=lo+(hi-lo)*i/5;mark+=label(x(t),bottom+27,fmt(t,1));}
    mark+=`<path d="M${right},${rainTop} V${rainBottom}" stroke="${rainInk}"/>`;
    for(const tick of rainTicks) {
      const tickY=rainY(tick);
      mark+=`<path d="M${right},${tickY} h6" stroke="${rainInk}"/><text x="${right+12}" y="${tickY+5}" font-size="15" fill="${rainInk}">${tick}</text>`;
    }
    mark+=`<text x="${right}" y="20" text-anchor="end" font-size="16" fill="${rainInk}">Rainfall (in/h)</text>`;
    const colors=methods.map(m=>m.color), dashes=['9 5','','4 4'];
    curves.forEach((pts,i)=>{mark+=`<path d="${path(pts)}" clip-path="url(#rt-plot-clip)" fill="none" stroke="${colors[i]}" stroke-width="3" stroke-dasharray="${dashes[i]}"/>`;});
    if(view!=='volume') s.runs.forEach((r,i)=>{mark+=`<circle cx="${x(r.peakTime/60)}" cy="${y(value(r.peak,0))}" r="4" fill="${colors[i]}"/>`;});
    const flowLabel=view==='volume'?'Cumulative volume (% of rain)':view==='unit'?'Outlet flow (ft³/s per acre)':'Outlet flow (ft³/s)';
    $('chart-label').textContent=flowLabel;
    $('chart').innerHTML=mark+label(left,plotTop-13,flowLabel,'start')+label((left+right)/2,bottom+59,'Minutes from storm start');
  }
  for (const c of controls) {
    const input=$(c.id); input.max=String(c.values.length-1);
    input.addEventListener('input',select); input.disabled=false;
  }
  root.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{
    view=b.dataset.view;
    root.querySelectorAll('[data-view]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));
    chart();
  });
  $('zoom').onclick=()=>{zoom=!zoom;$('zoom').setAttribute('aria-pressed',String(zoom));chart();};
  const download=(filename,text,type='text/plain')=>{
    const url=URL.createObjectURL(new Blob([text],{type})), a=document.createElement('a');
    a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  $('csv').onclick=()=>{
    const rows=['minute,'+methods.flatMap(m=>[m.id+'_cfs',m.id+'_volume_m3']).join(',')];
    current.runs[0].samples.forEach((_,i)=>rows.push([i,...current.runs.flatMap(r=>[r.samples[i][0]*cfs,r.samples[i][1]])].join(',')));
    download(current.id+'.csv',rows.join('\n')+'\n','text/csv');
  };
  for(const ext of ['inp','rpt']) $(ext).onclick=()=>{
    const method=$('model').value, idx=methods.findIndex(m=>m.id===method);
    download(current.id+'-'+method+'.'+ext,ext==='inp'?inputFor(current,method):current.runs[idx].report);
  };
  select();
}

})();
