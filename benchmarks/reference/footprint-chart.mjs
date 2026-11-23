import {readFile,writeFile} from 'node:fs/promises';
const d=JSON.parse(await readFile(new URL('./results/footprint.json',import.meta.url),'utf8'));
const ink='#183047',muted='#52687a',green='#14735c',blue='#315e96';
const text=(x,y,t,size=16,color=ink,weight=400)=>`<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-weight="${weight}">${t}</text>`;
let s=text(48,44,'DOT BOUNDARY / DISTRIBUTION FOOTPRINT',13,green,700);
s+=text(48,100,`${(d.boundary_release.archive_bytes/1024).toFixed(1)} KiB. Zero runtime dependencies.`,37,ink,700);
s+=text(48,140,'Published v0.1.0 package · SDK, gateway and examples',18,muted);
s+=text(48,213,'Executable source',23,ink,700)+text(680,213,'Declared runtime dependencies',23,ink,700);
for(const [i,r]of d.rows.entries()){
 const y=272+i*132,c=i===0?green:blue;
 s+=text(48,y,r.name,18,ink,600)+text(680,y,r.name,18,ink,600);
 s+=`<rect x="48" y="${y+18}" width="${r.source_bytes/1024/350*470}" height="32" rx="4" fill="${c}"/>`;
 s+=text(48+r.source_bytes/1024/350*470+14,y+41,`${(r.source_bytes/1024).toFixed(1)} KiB`,18,c,700);
 s+=`<rect x="680" y="${y+18}" width="${Math.max(2,r.direct_runtime_dependencies/11*360)}" height="32" rx="4" fill="${c}"/>`;
 s+=text(696+r.direct_runtime_dependencies/11*360,y+41,r.direct_runtime_dependencies,18,c,700);
}
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="510" viewBox="0 0 1200 510" role="img" aria-labelledby="title"><title id="title">Published package size, executable source footprint and direct dependency counts</title><rect width="1200" height="510" fill="white"/><g font-family="Arial,Helvetica,sans-serif">${s}</g></svg>`;
await writeFile(new URL('../../docs/figures/footprint.svg',import.meta.url),svg);
console.log('Rendered measured footprint SVG.');
