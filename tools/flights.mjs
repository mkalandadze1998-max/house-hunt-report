#!/usr/bin/env node
// Flight price tracker (Travelpayouts / Aviasales data API).
//
//   node tools/flights.mjs --out out/flights.json          # needs TRAVELPAYOUTS_TOKEN
//   node tools/flights.mjs --out out/flights.json --dry    # no token: keeps the file, prints what it would do
//
// Routes come from data/flights.json:
//   { "routes": [ { "id": "kut-crl-dec", "label": "Kutaisi → Brussels Charleroi",
//                   "from": "KUT", "to": "CRL", "depart": "2026-12-03", "return": "2026-12-10",
//                   "currency": "gel", "direct": false, "alert_threshold": 0 } ] }
// For every route it records the cheapest round trip for the exact dates (one
// check per run; a history point is kept when the price changes or 12 h passed)
// and a "nearby" table: cheapest combinations in the same months, 3–14 nights.
// Output: { generated_at, routes: { id: { ...config, currency, checks:[{at,price,airline,
//   transfers,departure_at,return_at,link}], latest, previous, min, max, nearby:[…],
//   changed_at, checked_at } } }
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const argValue=(n,d=null)=>{const i=args.indexOf(n);return i>=0?args[i+1]:d};
const readJson=(f,fb)=>{try{return JSON.parse(fs.readFileSync(path.resolve(f),'utf8'))}catch{return fb}};
const outFile=path.resolve(argValue('--out',path.join(root,'data','flights.json')));
const cfg=readJson(path.join(root,'data','flights.json'),{routes:[]});
const TOKEN=process.env.TRAVELPAYOUTS_TOKEN;
const dry=args.includes('--dry')||!TOKEN;
const API=process.env.TRAVELPAYOUTS_API||'https://api.travelpayouts.com/aviasales/v3/prices_for_dates';
const KEEP_DAYS=120, MIN_HOURS_BETWEEN_POINTS=12;
const now=new Date().toISOString();

const prev=readJson(outFile,{routes:{}});prev.routes??={};
const out={generated_at:now,source:'Travelpayouts / Aviasales cached fares',routes:{}};

async function api(params){
  const u=new URL(API);for(const [k,v] of Object.entries(params))if(v!==undefined&&v!==null)u.searchParams.set(k,String(v));u.searchParams.set('token',TOKEN);
  const r=await fetch(u,{headers:{'Accept-Encoding':'gzip','Accept':'application/json'}});
  if(!r.ok)throw new Error(`HTTP ${r.status} for ${u.pathname}?${[...u.searchParams].filter(([k])=>k!=='token').map(([k,v])=>k+'='+v).join('&')}`);
  const j=await r.json();if(j.success===false)throw new Error(j.error||'API error');
  return j.data||[];
}
const nights=(a,b)=>Math.round((Date.parse(b)-Date.parse(a))/86400000);
const link=l=>l?`https://www.aviasales.com${l}`:null;
const norm=x=>({price:Number(x.price),airline:x.airline||null,flight_number:x.flight_number||null,transfers:x.transfers??null,return_transfers:x.return_transfers??null,departure_at:(x.departure_at||'').slice(0,16),return_at:(x.return_at||'').slice(0,16),duration:x.duration??null,link:link(x.link)});

for(const route of cfg.routes||[]){
  const r={...(prev.routes[route.id]||{}),...route,currency:(route.currency||'gel').toUpperCase()};
  const AIRLINES={W6:'Wizz Air',W4:'Wizz Air Malta',TK:'Turkish Airlines',PC:'Pegasus',LO:'LOT',A3:'Aegean',OS:'Austrian',LH:'Lufthansa',A9:'Georgian Airways',FR:'Ryanair',SN:'Brussels Airlines',AZ:'ITA',LX:'Swiss',KL:'KLM',AF:'Air France',EK:'Emirates',QR:'Qatar Airways',FZ:'flydubai'};
  r.airline_names=AIRLINES;
  r.checks=Array.isArray(r.checks)?r.checks:[];r.nearby=Array.isArray(r.nearby)?r.nearby:[];
  r.checked_at=now;
  if(dry){out.routes[route.id]=r;console.log(`flights: ${route.id} — dry run (TRAVELPAYOUTS_TOKEN not set), keeping ${r.checks.length} history points`);continue}
  try{
    // 1) the exact trip
    const exact=(await api({origin:route.from,destination:route.to,departure_at:route.depart,return_at:route.return,one_way:false,direct:route.direct?true:false,currency:route.currency||'gel',sorting:'price',unique:false,limit:10})).map(norm).filter(x=>Number.isFinite(x.price)&&x.price>0).sort((a,b)=>a.price-b.price);
    const best=exact[0]||null;
    const last=r.checks[r.checks.length-1]||null;
    if(best){
      const changed=!last||last.price!==best.price;
      const stale=!last||Date.parse(now)-Date.parse(last.at)>=MIN_HOURS_BETWEEN_POINTS*3600000;
      if(changed||stale)r.checks.push({at:now,...best});
      if(changed&&last){r.changed_at=now;r.previous_price=last.price}
      else if(!last){r.changed_at=now;r.previous_price=null}
      r.latest=best;r.unavailable_since=null;
    }else{
      // no cached fare for these dates right now — keep the history, flag it
      r.unavailable_since??=now;
      console.log(`flights: ${route.id} — no cached fare for ${route.depart}/${route.return}`);
    }
    // 2) nearby combinations in the same months (cheapest per departure day, 3–14 nights)
    const depMonth=route.depart.slice(0,7),retMonth=route.return.slice(0,7);
    const months=[...new Set([depMonth,retMonth])];
    let combos=[];
    for(const dm of months)for(const rm of months){
      if(rm<dm)continue;
      try{combos=combos.concat((await api({origin:route.from,destination:route.to,departure_at:dm,return_at:rm,one_way:false,direct:route.direct?true:false,currency:route.currency||'gel',sorting:'price',unique:false,limit:1000})).map(norm))}catch(e){console.warn(`  nearby ${dm}/${rm}: ${e.message}`)}
    }
    const minN=route.min_nights??3,maxN=route.max_nights??14;
    combos=combos.filter(x=>Number.isFinite(x.price)&&x.price>0&&x.departure_at&&x.return_at).filter(x=>{const n=nights(x.departure_at.slice(0,10),x.return_at.slice(0,10));return n>=minN&&n<=maxN});
    const byDay=new Map();for(const c of combos){const k=c.departure_at.slice(0,10)+'|'+c.return_at.slice(0,10);if(!byDay.has(k)||byDay.get(k).price>c.price)byDay.set(k,c)}
    r.nearby=[...byDay.values()].sort((a,b)=>a.price-b.price).slice(0,40).map(c=>({...c,nights:nights(c.departure_at.slice(0,10),c.return_at.slice(0,10))}));
    r.nearby_at=now;
    console.log(`flights: ${route.id} — ${best?best.price+' '+r.currency+(best.airline?' ('+best.airline+')':''):'no fare'}; ${r.nearby.length} nearby combos`);
  }catch(e){console.warn(`flights: ${route.id} failed — ${e.message}`)}
  // trim history
  const cutoff=Date.parse(now)-KEEP_DAYS*86400000;
  r.checks=r.checks.filter(c=>Date.parse(c.at)>=cutoff);
  const prices=r.checks.map(c=>c.price);
  r.min=prices.length?Math.min(...prices):null;r.max=prices.length?Math.max(...prices):null;
  r.booking_url=`https://www.wizzair.com/en-gb/booking/select-flight/${route.from}/${route.to}/${route.depart}/${route.return}/${route.adults||1}/0/0/null`;
  out.routes[route.id]=r;
}
fs.mkdirSync(path.dirname(outFile),{recursive:true});
fs.writeFileSync(outFile,JSON.stringify(out,null,1));
console.log(`flights: ${Object.keys(out.routes).length} route(s) → ${path.relative(root,outFile)}${dry?' (dry)':''}`);
