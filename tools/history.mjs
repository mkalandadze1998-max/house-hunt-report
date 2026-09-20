#!/usr/bin/env node
// Maintains a per-listing price history across snapshots.
//
//   node tools/history.mjs                       # updates data/history.json
//   node tools/history.mjs --history out/h.json  # read/write another file
//
// history.json = { generated_at, listings: { <id>: {
//   first_seen, last_seen, prices: [{at, price}], ...
// } } }
// A price point is appended only when the price differs from the last
// recorded one, so the array is a compact change log. Listings that drop
// out of a snapshot keep their record (last_seen stops advancing).
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const argValue=name=>{const i=args.indexOf(name);return i>=0?args[i+1]:null};
const propsFile=path.join(root,'data','properties.json');
const histFile=path.resolve(argValue('--history')||path.join(root,'data','history.json'));

const snap=JSON.parse(fs.readFileSync(propsFile,'utf8'));
const snapAt=snap.retrieved_at||new Date().toISOString();const at=snapAt;
let props=(snap.properties||[]).filter(p=>Number.isFinite(p.price)&&p.currency==='GEL');
// --extra <file> [--extra <file>…]: more listing files in the same schema (e.g. ss.json)
for(let i=0;i<args.length;i++)if(args[i]==='--extra'&&args[i+1]){try{const j=JSON.parse(fs.readFileSync(path.resolve(args[i+1]),'utf8'));const extra=(j.properties||[]).filter(p=>Number.isFinite(p.price)&&p.currency==='GEL').map(p=>({...p,_at:j.retrieved_at||at}));props=props.concat(extra);console.log(`extra: ${extra.length} listings from ${args[i+1]}`)}catch(e){console.warn(`extra ${args[i+1]}: ${e.message}`)}}

let hist={listings:{}};
try{hist=JSON.parse(fs.readFileSync(histFile,'utf8'))}catch{}
if(!hist||typeof hist!=='object')hist={};
hist.listings??={};

let added=0,changed=0,seen=0;
for(const p of props){
  const at=p._at||snapAt;
  const rec=hist.listings[p.id]??={first_seen:p.first_seen_at||at,prices:[]};
  rec.first_seen??=p.first_seen_at||at;
  if(!rec.prices.length){rec.prices.push({at:p.first_seen_at&&p.first_seen_at<at?p.first_seen_at:at,price:p.price});added++}
  else{const last=rec.prices[rec.prices.length-1];if(last.price!==p.price&&last.at!==at){rec.prices.push({at,price:p.price});changed++}}
  if(!rec.last_seen||rec.last_seen<at)rec.last_seen=at;
  rec.size=p.size;rec.neighborhood=p.neighborhood;if(p.source)rec.source=p.source;
  seen++;
}
const gone=Object.entries(hist.listings).filter(([,r])=>r.last_seen<snapAt).length;
hist.generated_at=new Date().toISOString();
hist.snapshot_at=at;
fs.mkdirSync(path.dirname(histFile),{recursive:true});
fs.writeFileSync(histFile,JSON.stringify(hist,null,1));
console.log(`snapshot ${at}: ${seen} listings, ${added} new, ${changed} price changes, ${gone} no longer listed → ${path.relative(root,histFile)}`);
