import { readFile, writeFile, mkdir } from 'node:fs/promises';
const data=JSON.parse(await readFile(new URL('./results/latest.json',import.meta.url),'utf8'));
const dir=new URL('../docs/figures/',import.meta.url);await mkdir(dir,{recursive:true});
const ink='#172d43',muted='#54677a',grid='#dce5ec',blue='#2377a5',orange='#ce6731',green='#18735c';
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const txt=(x,y,s,size=15,color=ink,anchor='start',weight=400)=>`<text x="${x}" y="${y}" font-size="${size}" fill="${color}" text-anchor="${anchor}" font-weight="${weight}">${esc(s)}</text>`;
const line=(x1,y1,x2,y2,color=grid,width=1)=>`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}"/>`;
function svg(title,body,height=620){return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${height}" viewBox="0 0 1200 ${height}" role="img" aria-labelledby="title"><title id="title">${esc(title)}</title><rect width="1200" height="${height}" fill="#fff"/><g font-family="Arial,Helvetica,sans-serif">${body}</g></svg>`;}

let s=txt(48,46,'DOT BOUNDARY / REPRODUCIBLE EVALUATION',13,green,'start',700)+txt(48,87,'Privacy enforcement under adversarial execution',29,ink,'start',700)+txt(48,119,'300 cases · 3 repetitions · measured HTTP dispatch',16,muted);
const panels=[{x:310,key:'forbiddenRate',ci:'forbidden95CI',title:'Forbidden egress ↓',color:orange},{x:760,key:'benignCompletionRate',ci:'benign95CI',title:'Benign workflows completed ↑',color:blue}];
for(const p of panels){s+=txt(p.x,174,p.title,18,ink,'start',700);for(let tick=0;tick<=100;tick+=25){const x=p.x+tick*3.3;s+=line(x,197,x,517)+txt(x,541,`${tick}%`,13,muted,'middle');}}
data.summary.forEach((r,i)=>{const y=229+i*65;s+=txt(48,y+6,r.name,17,ink,'start',r.strategy==='boundary'?700:400);
  for(const p of panels){const w=r[p.key]*330,color=r.strategy==='boundary'?green:p.color;s+=`<rect x="${p.x}" y="${y-13}" width="${Math.max(w,1.5)}" height="26" rx="3" fill="${color}"/>`;
    const [lo,hi]=r[p.ci].map(v=>p.x+v*330);s+=line(lo,y,hi,y,ink,1.5)+line(lo,y-5,lo,y+5,ink,1.5)+line(hi,y-5,hi,y+5,ink,1.5);
    s+=txt(p.x+350,y+6,`${(r[p.key]*100).toFixed(1)}%`,16,ink,'start',700);
  }
});
await writeFile(new URL('enforcement.svg',dir),svg('Forbidden egress and benign completion by enforcement mechanism',s,570));

let h=txt(48,46,'DOT BOUNDARY / FAILURE SURFACE',13,green,'start',700)+txt(48,87,'Where information crosses an unauthorized boundary',28,ink,'start',700)+txt(48,120,'Forbidden dispatch rate per attack family · 25 cases per cell · lower is better',16,muted);
const cols=data.summary;
cols.forEach((r,i)=>{const x=340+i*165;h+=txt(x+73,180,r.name,12,ink,'middle',700);});
data.byFamily.filter(f=>f.attack).forEach((f,j)=>{const y=208+j*43;h+=txt(48,y+25,f.label,17);
  cols.forEach((r,i)=>{const rate=f.results[r.strategy].forbidden/f.results[r.strategy].cases,x=340+i*165;const fill=rate===0?'#e5f1ec':rate===1?'#b34b2e':'#e4a37e';
    h+=`<rect x="${x}" y="${y}" width="146" height="35" rx="4" fill="${fill}"/>`+txt(x+73,y+24,`${Math.round(rate*100)}%`,16,rate>.6?'#fff':ink,'middle',700);
  });
});
await writeFile(new URL('failure-surface.svg',dir),svg('Forbidden egress by attack family',h,580));

let l=txt(48,46,'DOT BOUNDARY / RUNTIME COST',13,green,'start',700)+txt(48,87,'Measured policy and provenance overhead',29,ink,'start',700)+txt(48,119,'Matched in-process completions · 300 samples per size · model and network time excluded',16,muted);
const top=175,bottom=465,left=120,right=1110,max=Math.ceil(Math.max(...data.latency.map(r=>r.boundary.p95))/100)*100;
for(let i=0;i<=5;i++){const v=i*max/5,y=bottom-v/max*(bottom-top);l+=line(left,y,right,y)+txt(left-15,y+5,`${Math.round(v)}`,14,muted,'end');}
l+=txt(50,162,'µs',15,muted);
const xs=data.latency.map((_,i)=>left+i*(right-left)/3);
for(const [key,color,label] of [['direct',blue,'Direct adapter'],['boundary',green,'Dot Boundary']]){
  const points=data.latency.map((r,i)=>`${xs[i]},${bottom-r[key].median/max*(bottom-top)}`).join(' ');
  l+=`<polyline points="${points}" fill="none" stroke="${color}" stroke-width="3"/>`;
  data.latency.forEach((r,i)=>{const x=xs[i],y=bottom-r[key].median/max*(bottom-top),high=bottom-r[key].p95/max*(bottom-top);l+=line(x,y,x,high,color,2)+line(x-5,high,x+5,high,color,2)+`<circle cx="${x}" cy="${y}" r="5" fill="${color}"/>`;});
  const lx=key==='direct'?120:380;l+=`<circle cx="${lx+18}" cy="537" r="5" fill="${color}"/>`+txt(lx+44,543,label,16);
}
data.latency.forEach((r,i)=>l+=txt(xs[i],495,r.inputBytes<1024?`${r.inputBytes} B`:`${r.inputBytes/1024} KiB`,15,muted,'middle'));
l+=txt(800,543,'Dots: median · whiskers: p95',15,muted);
await writeFile(new URL('runtime-cost.svg',dir),svg('Matched runtime latency by input size',l,570));

const table=data.summary.map(r=>`| ${r.name} | ${r.forbidden}/${r.attackCases} | ${(r.forbiddenRate*100).toFixed(1)}% | ${r.benignCompleted}/${r.benignCases} |`).join('\n');
const perf=data.latency.map(r=>`| ${r.inputBytes} | ${r.direct.median.toFixed(2)} | ${r.boundary.median.toFixed(2)} | ${r.boundary.p95.toFixed(2)} |`).join('\n');
await writeFile(new URL('./RESULTS.md',import.meta.url),`# Boundary evaluation\n\nGenerated from [raw results](results/latest.json). Reproduce with \`npm run bench && npm run charts\`.\n\n![Enforcement comparison](../docs/figures/enforcement.svg)\n\n| Mechanism | Forbidden cases | Forbidden rate | Benign completions |\n|---|---:|---:|---:|\n${table}\n\nThe 25 unapproved safe-aggregate cases measure the cost of conservative provenance: the derived answer is harmless, but its source is private and no release was authorized. Boundary preserves the restriction. Owner-approved release cases complete. Literal filtering instead blocks the approved releases because their content still matches the marker.\n\n![Failure surface](../docs/figures/failure-surface.svg)\n\n![Runtime cost](../docs/figures/runtime-cost.svg)\n\n| Input bytes | Direct median µs | Boundary median µs | Boundary p95 µs |\n|---:|---:|---:|---:|\n${perf}\n\n[Methodology](METHODOLOGY.md) · [CSV](results/summary.csv) · [${data.methodology.episodes.toLocaleString('en-US')} episode receipts](results/episodes.jsonl)\n`);
console.log('Generated 3 standalone SVG figures and benchmark report from measured results.');
