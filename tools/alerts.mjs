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
const excluded=new Set([...cfg.excludeSubdistricts,...(readJson(path.join(root,'data','properties.json'),{}).requirements?.excluded_locations||[])].map(norm));

const main=readJson(path.join(root,'data','properties.json'),{properties:[]});
const ss=argValue('--ss')?readJson(argValue('--ss'),{properties:[]}):{properties:[]};
const hist=readJson(argValue('--history','data/history.json'),{listings:{}});
const prev=readJson(argValue('--prev','/dev/null'),{listings:{}});
const geo=readJson(argValue('--geo','data/geo.json'),{listings:{}}).listings||{};
const dry=args.includes('--dry')||!process.env.TELEGRAM_BOT_TOKEN||!process.env.TELEGRAM_CHAT_ID;

const eligible=p=>Number.isFinite(p.price)&&p.price>0&&p.price<=cfg.maxPriceGel&&p.currency==='GEL'&&p.size>=cfg.minSizeM2&&p.transaction==='rent_monthly'&&p.property_type==='apartment'&&p.screening==='include'&&![p.district,p.neighborhood,...(p.district_groups||[])].some(v=>excluded.has(norm(v)));
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
// 1) same source + same place/size/rooms/floor/address = one flat re-posted under new ids → keep the newest
const normAddr=s=>String(s||'').replace(/[\s.,\-–\/]/g,'').toLowerCase();
const listedAt=p=>Date.parse(p.listing_date)||Date.parse(p.first_seen_at)||0;
const groups=new Map();let solo=0;
for(const p of all){const k=key(p);const gk=k?`${src(p)}|${k}|${normAddr(p.address)}`:`solo|${solo++}`;(groups.get(gk)||groups.set(gk,[]).get(gk)).push(p)}
const hosts=[];for(const g of groups.values()){g.sort((a,b)=>listedAt(b)-listedAt(a));if(g.length>1)g[0].reposts=g.slice(1);hosts.push(g[0])}
const idsOf=p=>[p.id,...(p.reposts||[]).map(r=>r.id)];
// 2) across sources: one entry, the other source noted
const seen=new Map();const current=[];
for(const p of hosts){const k=key(p);if(k&&seen.has(k)&&src(seen.get(k))!==src(p)){(seen.get(k).also||(seen.get(k).also=[])).push(p);continue}if(k&&!seen.has(k))seen.set(k,p);current.push(p)}
const byId=new Map(current.flatMap(p=>idsOf(p).map(id=>[id,p])));
const allIds=new Set(all.map(p=>p.id));

const prevL=prev.listings||{},curL=hist.listings||{};
// a flat is "new" only if no copy of it (by id, or by place+size+rooms+floor+address) was in the previous run
const gkeyOf=p=>{const k=key(p);return k?`${src(p)}|${k}|${normAddr(p.address)}`:null};
const prevKeys=new Map();for(const [id,r] of Object.entries(prevL)){if(Number.isFinite(r.lat)&&Number.isFinite(r.lng)&&r.size){const gk=`${r.source||'myhome.ge'}|${r.lat.toFixed(3)},${r.lng.toFixed(3)}|${r.size}|${r.rooms??''}|${r.floor??''}|${normAddr(r.address)}`;(prevKeys.get(gk)||prevKeys.set(gk,[]).get(gk)).push(id)}}
const prevIdsOf=p=>[...new Set([...idsOf(p).filter(id=>prevL[id]),...(prevKeys.get(gkeyOf(p))||[])])];
const isNew=p=>!prevIdsOf(p).length;
const currentKeys=new Set(current.map(gkeyOf).filter(Boolean));
const lastPrice=r=>r?.prices?.length?r.prices[r.prices.length-1].price:null;
const fresh=current.filter(isNew);
const prevPrice=p=>{const r=prevIdsOf(p).map(id=>prevL[id]).filter(r=>r&&r.prices?.length).sort((a,b)=>Date.parse(b.last_seen||0)-Date.parse(a.last_seen||0))[0];return lastPrice(r)};
const changes=current.filter(p=>!isNew(p)&&prevPrice(p)!==null&&prevPrice(p)!==p.price).map(p=>({p,from:prevPrice(p),to:p.price}));
const drops=changes.filter(c=>c.to<c.from),rises=changes.filter(c=>c.to>c.from);
const snapAt=Date.parse(hist.snapshot_at||new Date().toISOString());
const gone=Object.entries(prevL).filter(([id,r])=>!byId.has(id)&&!allIds.has(id)&&!(Number.isFinite(r.lat)&&currentKeys.has(`${r.source||'myhome.ge'}|${r.lat.toFixed(3)},${r.lng.toFixed(3)}|${r.size}|${r.rooms??''}|${r.floor??''}|${normAddr(r.address)}`))&&r.last_seen&&Date.parse(r.last_seen)>=snapAt-3*86400000).map(([id,r])=>({id,r,days:Math.round((Date.parse(r.last_seen)-Date.parse(r.first_seen))/86400000)})).filter(g=>Number.isFinite(g.days)&&g.days<=cfg.goneMaxDays);

const byDist=(a,b)=>(dist(a)??99)-(dist(b)??99);
const who=p=>p.advertiser?(p.advertiser==='Individual'?'🧑 Owner':'🏢 Agency'):'';
const floorTxt=p=>p.floor!=null?`${p.floor}${p.total_floors?'/'+p.total_floors:''} fl`:null;
const specs=p=>[`${p.size} m²`,p.rooms?`${p.rooms} ${p.rooms===1?'room':'rooms'}`:null,floorTxt(p)].filter(Boolean).join(' · ');
const tags=p=>[p.furniture===true?'furnished':null,p.air_conditioning===true?'A/C':null,p.balcony?'balcony':null].filter(Boolean).join(', ');
// One listing = a small card: price line, place line, tags line
const card=(p,extra='')=>{const t=tags(p);return [
  `<b>${money(p.price)} ₾</b>${extra} · ${esc(specs(p))}`,
  `📍 <a href="${esc(p.url)}">${esc(p.neighborhood||p.district||'—')}</a>${who(p)?` · ${who(p)}`:''}`,
  `<i>${esc(src(p))}${p.also?` · also on ${p.also.map(a=>esc(src(a))).join(', ')}`:''}${p.reposts?.length?` · re-posted ×${p.reposts.length+1}`:''}${t?` · ${esc(t)}`:''}</i>`
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
