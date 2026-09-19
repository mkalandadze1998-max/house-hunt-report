#!/usr/bin/env node
// Fetches lat/lng for every listing in data/properties.json that is not yet
// in data/geo.json, using the same myhome.ge API the scraper uses.
// Run after each scrape:  node tools/geocode.mjs
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const propsFile=path.join(root,'data','properties.json');
const geoFile=path.join(root,'data','geo.json');
const API='https://api-statements.tnet.ge/v1/statements/';
const HEADERS={'X-Website-Key':'myhome','Accept':'application/json','locale':'ka','User-Agent':'house-hunt-report/1.0'};

const props=JSON.parse(fs.readFileSync(propsFile,'utf8')).properties||[];
const geo=fs.existsSync(geoFile)?JSON.parse(fs.readFileSync(geoFile,'utf8')):{listings:{}};
geo.listings??={};
const force=process.argv.includes('--force');
const todo=props.filter(p=>force||!geo.listings[p.id]);
console.log(`${props.length} listings, ${todo.length} to geocode`);

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
fs.writeFileSync(geoFile,JSON.stringify(geo,null,1));
console.log(`done: ${ok} added, ${fail} failed, ${Object.keys(geo.listings).length} total in geo.json`);
