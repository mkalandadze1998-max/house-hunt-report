#!/usr/bin/env node
// Telegram alerts for House Hunt.
//
//   node tools/alerts.mjs --history out/history.json --prev prev-hist.json \
//        [--ss out/ss.json] [--geo out/geo.json] [--dry]
//
// Compares the listing set of this run against the previous history.json and
// sends one message with: new listings, price drops/rises, and listings that
// disappeared. Needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in the
// environment; without them it prints what it would send and exits 0.
// data/alerts.json (optional) can exclude sub-districts and set thresholds.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const argValue=(n,d=null)=>{const i=args.indexOf(n);return i>=0?args[i+1]:d};
const readJson=(f,fallback)=>{try{return JSON.parse(fs.readFileSync(path.resolve(f),'utf8'))}catch{return fallback}};

const HOME={lat:41.770639,lng:44.793083};
const SITE_URL='https://mkalandadze1998-max.github.io/house-hunt-report/';
const cfg={excludeSubdistricts:[],maxPriceGel:1000,minSizeM2:38,goneMaxDays:21,...readJson(path.join(root,'data','alerts.json'),{})};
const norm=s=>String(s||'').replace(/[\s.\-–\/]/g,'').toLowerCase();
const excluded=new Set(cfg.excludeSubdistricts.map(norm));

const main=readJson(path.join(root,'data','properties.json'),{properties:[]});
const ss=argValue('--ss')?readJson(argValue('--ss'),{properties:[]}):{properties:[]};
const hist=readJson(argValue('--history','data/history.json'),{listings:{}});
const prev=readJson(argValue('--prev','/dev/null'),{listings:{}});
const geo=readJson(argValue('--geo','data/geo.json'),{listings:{}}).listings||{};
const dry=args.includes('--dry')||!process.env.TELEGRAM_BOT_TOKEN||!process.env.TELEGRAM_CHAT_ID;

const eligible=p=>Number.isFinite(p.price)&&p.price>0&&p.price<=cfg.maxPriceGel&&p.currency==='GEL'&&p.size>=cfg.minSizeM2&&p.transaction==='rent_monthly'&&p.property_type==='apartment'&&p.screening==='include'&&!excluded.has(norm(p.neighborhood));
const coords=p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng)?{lat:p.lat,lng:p.lng}:geo[p.id]&&Number.isFinite(geo[p.id].lat)?geo[p.id]:null;
const km=(a,b)=>{const R=6371,r=x=>x*Math.PI/180,dl=r(b.lat-a.lat),dn=r(b.lng-a.lng),h=Math.sin(dl/2)**2+Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dn/2)**2;return 2*R*Math.asin(Math.sqrt(h))};
const dist=p=>{const c=coords(p);return c?km(HOME,c):null};
const fmtKm=d=>d===null?'':d<1?`${Math.round(d*1000)} m`:`${d.toFixed(1)} km`;
const money=n=>Number(n).toLocaleString('en-US');
const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const src=p=>p.source&&p.source!=='myhome.ge'?p.source:'myhome.ge';

// same dedup rule as the site: ~100 m + size + rooms + floor
const key=p=>{const c=coords(p);return c&&p.size?`${c.lat.toFixed(3)},${c.lng.toFixed(3)}|${p.size}|${p.rooms??''}|${p.floor??''}`:null};
const all=[...(main.properties||[]),...(ss.properties||[])].filter(eligible);
const seen=new Map();const current=[];
for(const p of all){const k=key(p);if(k&&seen.has(k)){(seen.get(k).also||(seen.get(k).also=[])).push(p);continue}if(k)seen.set(k,p);current.push(p)}
const byId=new Map(current.map(p=>[p.id,p]));

const prevL=prev.listings||{},curL=hist.listings||{};
const isNew=p=>!prevL[p.id];
const lastPrice=r=>r?.prices?.length?r.prices[r.prices.length-1].price:null;
const fresh=current.filter(isNew);
const changes=current.filter(p=>!isNew(p)&&lastPrice(prevL[p.id])!==null&&lastPrice(prevL[p.id])!==p.price).map(p=>({p,from:lastPrice(prevL[p.id]),to:p.price}));
const drops=changes.filter(c=>c.to<c.from),rises=changes.filter(c=>c.to>c.from);
const snapAt=Date.parse(hist.snapshot_at||new Date().toISOString());
const gone=Object.entries(prevL).filter(([id,r])=>!byId.has(id)&&!all.some(p=>p.id===id)&&r.last_seen&&Date.parse(r.last_seen)>=snapAt-3*86400000).map(([id,r])=>({id,r,days:Math.round((Date.parse(r.last_seen)-Date.parse(r.first_seen))/86400000)})).filter(g=>Number.isFinite(g.days)&&g.days<=cfg.goneMaxDays);

const byDist=(a,b)=>(dist(a)??99)-(dist(b)??99);
const line=(p,extra='')=>{const d=fmtKm(dist(p));const who=p.advertiser?(p.advertiser==='Individual'?'Owner':'Agency'):'';return `• <a href="${esc(p.url)}">${money(p.price)} ₾</a> · ${p.size} m² · ${p.rooms??'?'} rm · ${p.floor??'?'}/${p.total_floors??'?'} · ${esc(p.neighborhood)}${d?` · ${d}`:''}${who?` · ${who}`:''}${extra} <i>${esc(src(p))}</i>${p.also?` <i>+${p.also.length} dup</i>`:''}`};

const parts=[];
const stamp=new Date().toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Tbilisi'});
if(fresh.length)parts.push(`✦ <b>${fresh.length} new</b>\n`+fresh.sort(byDist).map(p=>line(p)).join('\n'));
if(drops.length)parts.push(`↓ <b>${drops.length} price ${drops.length===1?'drop':'drops'}</b>\n`+drops.sort((a,b)=>byDist(a.p,b.p)).map(c=>line(c.p,` · <b>was ${money(c.from)}</b>`)).join('\n'));
if(rises.length)parts.push(`↑ <b>${rises.length} price ${rises.length===1?'rise':'rises'}</b>\n`+rises.sort((a,b)=>byDist(a.p,b.p)).map(c=>line(c.p,` · was ${money(c.from)}`)).join('\n'));
if(gone.length)parts.push(`🚫 <b>${gone.length} gone</b>\n`+gone.map(g=>`• ${money(lastPrice(g.r))} ₾ · ${g.r.size??'?'} m² · ${esc(g.r.neighborhood)} · listed ${g.days} d${g.r.source?` <i>${esc(g.r.source)}</i>`:''}`).join('\n'));

if(!parts.length){console.log('alerts: nothing changed, no message');process.exit(0)}
const header=`🏠 <b>House Hunt</b> · ${stamp} · ${current.length} homes\n\n`;
const footer=`\n\n<a href="${SITE_URL}">Open the shortlist →</a>`;
let text=header+parts.join('\n\n')+footer;

// split at Telegram's 4096-char limit on paragraph boundaries
const chunks=[];const LIMIT=4000;
while(text.length>LIMIT){let cut=text.lastIndexOf('\n',LIMIT);if(cut<LIMIT/2)cut=LIMIT;chunks.push(text.slice(0,cut));text=text.slice(cut).replace(/^\n+/,'')}
chunks.push(text);

console.log(`alerts: ${fresh.length} new, ${drops.length} drops, ${rises.length} rises, ${gone.length} gone → ${chunks.length} message(s)`);
if(dry){console.log(dry&&!process.env.TELEGRAM_BOT_TOKEN?'(TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set — dry run)':'(dry run)');console.log(chunks.join('\n---\n'));process.exit(0)}

for(const chunk of chunks){
  const r=await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:process.env.TELEGRAM_CHAT_ID,text:chunk,parse_mode:'HTML',disable_web_page_preview:true})});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.ok){console.error('telegram error:',r.status,JSON.stringify(j).slice(0,300));process.exitCode=1;break}
  await new Promise(res=>setTimeout(res,400));
}
