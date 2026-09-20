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
const cfg={excludeSubdistricts:[],maxPriceGel:1000,minSizeM2:38,goneMaxDays:21,photoLimit:6,...readJson(path.join(root,'data','alerts.json'),{})};
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
for(const p of all){const k=key(p);if(k&&seen.has(k)&&src(seen.get(k))!==src(p)){(seen.get(k).also||(seen.get(k).also=[])).push(p);continue}if(k&&!seen.has(k))seen.set(k,p);current.push(p)}
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
const who=p=>p.advertiser?(p.advertiser==='Individual'?'🧑 Owner':'🏢 Agency'):'';
const floorTxt=p=>p.floor!=null?`${p.floor}${p.total_floors?'/'+p.total_floors:''} fl`:null;
const specs=p=>[`${p.size} m²`,p.rooms?`${p.rooms} ${p.rooms===1?'room':'rooms'}`:null,floorTxt(p)].filter(Boolean).join(' · ');
const tags=p=>[p.furniture===true?'furnished':null,p.air_conditioning===true?'A/C':null,p.balcony?'balcony':null].filter(Boolean).join(', ');
// One listing = a small card: price line, place line, tags line
const card=(p,extra='')=>{const d=fmtKm(dist(p));const t=tags(p);return [
  `<b>${money(p.price)} ₾</b>${extra} · ${esc(specs(p))}`,
  `📍 <a href="${esc(p.url)}">${esc(p.neighborhood||p.district||'—')}</a>${d?` · ${d} from home`:''}${who(p)?` · ${who(p)}`:''}`,
  `<i>${esc(src(p))}${p.also?` · also on ${p.also.map(a=>esc(src(a))).join(', ')}`:''}${t?` · ${esc(t)}`:''}</i>`
].join('\n')};
const section=(title,items)=>`${title}\n<blockquote expandable>${items.join('\n\n')}</blockquote>`;

const parts=[];
const stamp=new Date().toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Tbilisi'});
if(fresh.length)parts.push(section(`✦ <b>New</b> · ${fresh.length}`,fresh.sort(byDist).map(p=>card(p))));
if(drops.length)parts.push(section(`📉 <b>Price drops</b> · ${drops.length}`,drops.sort((a,b)=>byDist(a.p,b.p)).map(c=>card(c.p,` <s>${money(c.from)}</s>`))));
if(rises.length)parts.push(section(`📈 <b>Price rises</b> · ${rises.length}`,rises.sort((a,b)=>byDist(a.p,b.p)).map(c=>card(c.p,` (was ${money(c.from)})`))));
if(gone.length)parts.push(section(`🚫 <b>Gone</b> · ${gone.length}`,gone.map(g=>`<b>${money(lastPrice(g.r))} ₾</b> · ${g.r.size??'?'} m² · ${esc(g.r.neighborhood||'')}\n<i>${g.days===0?'listed today':`listed ${g.days} d`}${g.r.source?` · ${esc(g.r.source)}`:''}</i>`)));

if(!parts.length){console.log('alerts: nothing changed, no message');process.exit(0)}
const summary=[fresh.length?`✦ ${fresh.length} new`:'',drops.length?`📉 ${drops.length} ${drops.length===1?'drop':'drops'}`:'',rises.length?`📈 ${rises.length} ${rises.length===1?'rise':'rises'}`:'',gone.length?`🚫 ${gone.length} gone`:''].filter(Boolean).join('  ·  ');
const header=`🏠 <b>House Hunt</b> · ${stamp}\n${current.length} homes on the list  ·  ${summary}\n\n`;
const footer=`\n\n<a href="${SITE_URL}">Open the shortlist →</a>`;
let text=header+parts.join('\n\n')+footer;

// split at Telegram's 4096-char limit; never inside a blockquote
const chunks=[];const LIMIT=3900;
while(text.length>LIMIT){let cut=text.lastIndexOf('</blockquote>',LIMIT);cut=cut>0?cut+'</blockquote>'.length:text.lastIndexOf('\n\n',LIMIT);if(cut<LIMIT/3)cut=LIMIT;chunks.push(text.slice(0,cut));text=text.slice(cut).replace(/^\n+/,'')}
chunks.push(text);

// photo cards for the closest new listings (and every price drop)
const photoPicks=[...drops.map(c=>({p:c.p,extra:` <s>${money(c.from)}</s>`})),...fresh.sort(byDist).map(p=>({p}))].filter((x,i,a)=>a.findIndex(y=>y.p.id===x.p.id)===i).filter(x=>x.p.main_image&&/^https:\/\//.test(x.p.main_image)).slice(0,cfg.photoLimit);

console.log(`alerts: ${fresh.length} new, ${drops.length} drops, ${rises.length} rises, ${gone.length} gone → ${chunks.length} message(s), ${photoPicks.length} photo card(s)`);
if(dry){console.log(!process.env.TELEGRAM_BOT_TOKEN?'(TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set — dry run)':'(dry run)');console.log(chunks.join('\n---\n'));for(const x of photoPicks)console.log('PHOTO',x.p.main_image,'\n'+card(x.p,x.extra||''));process.exit(0)}

const tg=async(method,body)=>{const r=await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:process.env.TELEGRAM_CHAT_ID,...body})});const j=await r.json().catch(()=>({}));if(!r.ok||!j.ok)throw new Error(`${method} ${r.status} ${JSON.stringify(j).slice(0,200)}`);return j};
for(const chunk of chunks){
  try{await tg('sendMessage',{text:chunk,parse_mode:'HTML',disable_web_page_preview:true})}
  catch(e){console.error('telegram error:',e.message);process.exitCode=1;break}
  await new Promise(res=>setTimeout(res,400));
}
for(const x of photoPicks){
  const caption=card(x.p,x.extra||'');
  try{await tg('sendPhoto',{photo:x.p.main_image,caption,parse_mode:'HTML'})}
  catch(e){
    try{await tg('sendMessage',{text:`<a href="${esc(x.p.main_image)}">&#8203;</a>${caption}`,parse_mode:'HTML',link_preview_options:{is_disabled:false,url:x.p.main_image,prefer_large_media:true,show_above_text:true}})}
    catch(e2){console.warn('photo skipped:',x.p.id,e.message,'|',e2.message)}
  }
  await new Promise(res=>setTimeout(res,600));
}
