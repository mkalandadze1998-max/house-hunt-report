#!/usr/bin/env node
// Fetches lat/lng for every listing in data/properties.json that is not yet
// in geo.json, using the same myhome.ge API the scraper uses.
//
//   node tools/geocode.mjs                 # updates data/geo.json in place
//   node tools/geocode.mjs --geo out.json  # read/write a different geo file
//   node tools/geocode.mjs --force         # re-fetch every listing
//
// The GitHub Action in .github/workflows/geocode.yml runs this automatically
// after each scrape and publishes the result to the `geo-data` branch.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const argValue=name=>{const i=args.indexOf(name);return i>=0?args[i+1]:null};
const propsFile=path.join(root,'data','properties.json');
const geoFile=path.resolve(argValue('--geo')||path.join(root,'data','geo.json'));
const force=args.includes('--force');
const API='https://api-statements.tnet.ge/v1/statements/';
const HEADERS={'X-Website-Key':'myhome','Accept':'application/json','locale':'ka','User-Agent':'house-hunt-report/1.0'};

const props=JSON.parse(fs.readFileSync(propsFile,'utf8')).properties||[];
let geo={listings:{}};
try{geo=JSON.parse(fs.readFileSync(geoFile,'utf8'))}catch{}
if(!geo||typeof geo!=='object')geo={};
geo.listings??={};

const todo=props.filter(p=>!(Number.isFinite(p.lat)&&Number.isFinite(p.lng))&&!String(p.id).startsWith('ss-')&&(force||!geo.listings[p.id]));
console.log(`${props.length} listings, ${todo.length} to geocode → ${path.relative(root,geoFile)}`);

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let ok=0,fail=0;
for(const p of todo){
  try{
    const r=await fetch(API+p.id,{headers:HEADERS});
    if(!r.ok)throw new Error('HTTP '+r.status);
    const s=(await r.json())?.data?.statement;
    let lat=Number(s?.lat),lng=Number(s?.lng);
    if(!Number.isFinite(lat)||!Number.isFinite(lng))throw new Error('no coordinates');
    if(lat>44&&lng<42)[lat,lng]=[lng,lat]; // API occasionally swaps them
    geo.listings[p.id]={lat,lng,metro:s.metro_station_id??null,source:'myhome_api'};
    ok++;
  }catch(e){fail++;console.warn(`  ${p.id}: ${e.message}`)}
  await sleep(150);
}
geo.generated_at=new Date().toISOString();
geo.source='api-statements.tnet.ge statement lat/lng';
fs.mkdirSync(path.dirname(geoFile),{recursive:true});
fs.writeFileSync(geoFile,JSON.stringify(geo,null,1));
console.log(`done: ${ok} added, ${fail} failed, ${Object.keys(geo.listings).length} total`);
if(fail&&!ok&&todo.length)process.exitCode=1;
