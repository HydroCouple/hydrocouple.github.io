/* An illustrative linear cascade; this does not invoke a model engine. */
(() => {
const lab=document.getElementById('sensitivity-lab'); if(!lab)return;
const gain=lab.querySelector('#mapping-gain'), sigma=lab.querySelector('#input-uncertainty'), rho=lab.querySelector('#input-correlation');
const put=(id,value)=>{lab.querySelector('#'+id).textContent=value;};
function update(){
 const m=Number(gain.value), s1=Number(sigma.value), s2=0.10, r=Number(rho.value);
 // A=[[1,.2],[.1,.8]], M=diag(m,1), B=[[1.2,.4],[.3,.9]].
 const J=[[1.2*m+.04,.24*m+.32],[.3*m+.09,.06*m+.72]];
 const C=[[s1*s1,r*s1*s2],[r*s1*s2,s2*s2]];
 const std=J.map(row=>Math.sqrt(Math.max(0,row[0]*row[0]*C[0][0]+2*row[0]*row[1]*C[0][1]+row[1]*row[1]*C[1][1])));
 put('gain-value',m.toFixed(2));put('uncertainty-value',s1.toFixed(2));put('correlation-value',r.toFixed(2));
 J.forEach((row,i)=>row.forEach((v,j)=>{const cell=lab.querySelector('#j'+i+j);cell.textContent=v.toFixed(3);cell.style.backgroundColor=`rgba(0,113,191,${0.07+0.25*Math.min(1,Math.abs(v)/1.9)})`;}));
 put('std-output-1',std[0].toFixed(3));put('std-output-2',std[1].toFixed(3));
 put('jvp-result',`(${(J[0][0]*.01).toFixed(4)}, ${(J[1][0]*.01).toFixed(4)})`);
 put('vjp-result',`(${J[0][0].toFixed(3)}, ${J[0][1].toFixed(3)})`);
}
[gain,sigma,rho].forEach(input=>input.addEventListener('input',update));
lab.querySelector('#reset-sensitivity').addEventListener('click',()=>{gain.value=1;sigma.value=.15;rho.value=0;update();});
update();lab.querySelector('.standards-controls').hidden=false;lab.querySelector('.standards-results').hidden=false;lab.querySelector('.standards-nojs').hidden=true;
})();
