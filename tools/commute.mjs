#!/usr/bin/env node
// Driving time from home for every listing, cached in commute.json.
//
//   node tools/commute.mjs --commute out/commute.json --geo out/geo.json \
//        [--extra out/ss.json] [--extra out/korter.json]
//
// Uses the public OSRM demo router (router.project-osrm.org, OpenStreetMap
// data) — the table service gives durations from one origin to up to ~100
// destinations per request. Only listings without a cached result (or whose
// coordinates changed) are requested, so a normal run needs 0–2 requests.
// commute.json = { generated_at, home, listings: { <id>: {drive_min, drive_km, lat, lng} } }
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const argValue=(n,d=null)=>{const i=args.indexOf(n);return i>=0?args[i+1]:d};
const readJson=(f,fallback)=>{try{return JSON.parse(fs.readFileSync(path.resolve(f),'utf8'))}catch{return fallback}};
const HOME={lat:41.770639,lng:44.793083};
const OSRM=process.env.OSRM_URL||'https://router.project-osrm.org';
const BATCH=90, KEEP_DAYS=90;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

const outFile=path.resolve(argValue('--commute',path.join(root,'data','commute.json')));
const geo=readJson(argValue('--geo',path.join(root,'data','geo.json')),{listings:{}}).listings||{};
let props=(readJson(path.join(root,'data','properties.json'),{properties:[]}).properties||[]);
for(let i=0;i<args.length;i++)if(args[i]==='--extra'&&args[i+1])props=props.concat(readJson(args[i+1],{properties:[]}).properties||[]);
const cache=readJson(outFile,{listings:{}});cache.listings??={};

const coords=p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng)?{lat:p.lat,lng:p.lng}:geo[p.id]&&Number.isFinite(geo[p.id].lat)?{lat:geo[p.id].lat,lng:geo[p.id].lng}:null;
const same=(a,b)=>a&&b&&Math.abs(a.lat-b.lat)<1e-5&&Math.abs(a.lng-b.lng)<1e-5;
const todo=[];const seen=new Set();
for(const p of props){const c=coords(p);if(!c||seen.has(p.id))continue;seen.add(p.id);const cached=cache.listings[p.id];if(cached&&same(cached,c)&&Number.isFinite(cached.drive_min)){cached.seen=new Date().toISOString();continue}todo.push({id:p.id,...c})}
console.log(`commute: ${props.length} listings, ${todo.length} need routing`);

let done=0,failed=0;
for(let i=0;i<todo.length;i+=BATCH){
  const batch=todo.slice(i,i+BATCH);
  const pts=[HOME,...batch].map(c=>`${c.lng},${c.lat}`).join(';');
  const url=`${OSRM}/table/v1/driving/${pts}?sources=0&annotations=duration,distance`;
  try{
    const r=await fetch(url,{headers:{'User-Agent':'house-hunt-report/1.0 (github action)'}});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const j=await r.json();
    if(j.code!=='Ok')throw new Error(j.code);
    const dur=j.durations?.[0]||[],dist=j.distances?.[0]||[];
    batch.forEach((c,k)=>{const d=dur[k+1],m=dist[k+1];if(Number.isFinite(d)){cache.listings[c.id]={lat:c.lat,lng:c.lng,drive_min:Math.round(d/60),drive_km:Math.round((m||0)/100)/10,seen:new Date().toISOString()};done++}else failed++});
  }catch(e){console.warn(`  batch ${i/BATCH+1}: ${e.message}`);failed+=batch.length}
  if(i+BATCH<todo.length)await sleep(1200);
}
// forget listings not seen for a while
const cutoff=Date.now()-KEEP_DAYS*86400000;let pruned=0;
for(const [id,r] of Object.entries(cache.listings))if(!seen.has(id)&&(!r.seen||Date.parse(r.seen)<cutoff)){delete cache.listings[id];pruned++}
cache.generated_at=new Date().toISOString();cache.home=HOME;cache.router='OSRM / OpenStreetMap driving';
fs.mkdirSync(path.dirname(outFile),{recursive:true});
fs.writeFileSync(outFile,JSON.stringify(cache,null,1));
console.log(`commute: ${done} routed, ${failed} failed, ${pruned} pruned → ${path.relative(root,outFile)}`);
