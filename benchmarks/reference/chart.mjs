import{readFile,writeFile}from'node:fs/promises';
const d=JSON.parse(await readFile(new URL('./results/comparison.json',import.meta.url),'utf8'));
const ink='#183047',muted='#52687a',grid='#dfe7ec',blue='#315e96',green='#14735c';
const text=(x,y,t,size=14,color=ink,weight=400,anchor='start')=>`<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-weight="${weight}" text-anchor="${anchor}">${t}</text>`;
const line=(x,y,xx,yy,color=grid,width=1)=>`<line x1="${x}" y1="${y}" x2="${xx}" y2="${yy}" stroke="${color}" stroke-width="${width}"/>`;
const selected=d.summary.find(x=>x.depth===32).build_20_queries_us;
let s=text(44,38,'DOT BOUNDARY / PERMISSION PROCESSING',13,green,700)+text(44,80,`${selected.paired_speedup_median.toFixed(0)}× faster in the 32-stage workload`,34,ink,700)+text(44,113,'Construct a 32-stage provenance chain. Evaluate 20 reader permissions.',16,muted);
s+=text(44,155,`CaMeL ${selected.camel.toFixed(1)} µs · Boundary ${selected.boundary.toFixed(1)} µs · allowed/denied decisions match`,16,ink,600);
const panels=[['build_us','Graph construction',0,3],['query_us','One reader check',-1,4],['build_20_queries_us','Construction + 20 checks',0,5]];
for(const[key,title,low,high]of panels){const i=panels.findIndex(p=>p[0]===key),left=88+i*388,right=left+290,top=240,bottom=565;
 s+=text(left-28,205,title,18,ink,700)+text(left-28,225,'µs · logarithmic axis',12,muted);
 const y=v=>bottom-(Math.log10(v)-low)/(high-low)*(bottom-top);
 for(let power=low;power<=high;power++){const v=10**power,yy=y(v);s+=line(left,yy,right,yy)+text(left-9,yy+4,v<1?v.toFixed(1):v>=1000?`${v/1000}k`:v,12,muted,400,'end');}
 for(const[engine,color]of[['camel',blue],['boundary',green]]){
  const points=d.summary.map((r,j)=>[left+j*(right-left)/5,y(r[key][engine])]);
  for(let j=1;j<points.length;j++)s+=line(...points[j-1],...points[j],color,2.5);
  for(const[x,yy]of points)s+=`<circle cx="${x}" cy="${yy}" r="4" fill="${color}"/>`;
 }
 d.summary.forEach((r,j)=>s+=text(left+j*(right-left)/5,bottom+23,r.depth,12,muted,400,'middle'));
 s+=text((left+right)/2,bottom+46,'Derivation stages',13,muted,400,'middle');
}
s+=`<circle cx="64" cy="652" r="5" fill="${blue}"/>`+text(84,657,'CaMeL capability core',15)+`<circle cx="570" cy="652" r="5" fill="${green}"/>`+text(590,657,'Dot Boundary',15);

const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1250" height="690" viewBox="0 0 1250 690" role="img" aria-labelledby="title"><title id="title">Capability-core comparison: construction and reader-permission resolution</title><rect width="1250" height="690" fill="white"/><g font-family="Arial,Helvetica,sans-serif">${s}</g></svg>`;
await writeFile(new URL('../../docs/figures/reference-overhead.svg',import.meta.url),svg);
console.log('Rendered measured comparison SVG.');
