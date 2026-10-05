#!/usr/bin/env node
// Collects long-term apartment rentals from korter.ge for the House Hunt site.
//
//   node tools/collect-korter.mjs                        # writes data/korter.json
//   node tools/collect-korter.mjs --out out/korter.json  # elsewhere (used by CI)
//   node tools/collect-korter.mjs --pages 5              # fewer pages per area
//
// How it works
//   1. korter.ge renders its listing pages server-side with the data embedded
//      as `window.INITIAL_STATE = {...}`; no token or API key is needed.
//   2. One listing URL per target area (Saburtalo, Didube, Dighomi Massive,
//      Sanzona …) with ?max_price (USD-equivalent) and ?min_area filters,
//      newest first, paged with ?page=N. Cards carry price + currency, area,
//      rooms, floor, address, sub-district and coordinates.
//   3. Each candidate's detail page (same INITIAL_STATE trick) adds photos,
//      description, publish date, bedrooms and the seller (owner / agency).
//   4. Output uses the same listing schema as the myhome.ge scraper so the
//      site can merge all sources. Listings keep their previous first_seen_at.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const argValue=(name,def)=>{const i=args.indexOf(name);return i>=0?args[i+1]:def};
const outFile=path.resolve(argValue('--out',path.join(root,'data','korter.json')));
const MAX_PAGES=Number(argValue('--pages',12));
const MAX_AGE_DAYS=Number(argValue('--days',4));
const MAX_PRICE_GEL=1000, MIN_AREA=38;
const SITE='https://korter.ge';
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36 house-hunt-report/1.0';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const nowIso=new Date().toISOString();

/* korter.ge area pages ↔ the Georgian names used by the myhome.ge scraper */
const AREAS={
  'saburtalo':   {district:'ვაკე-საბურთალო',sub:'საბურთალო',   wanted:['ვაკე-საბურთალო','საბურთალო']},
  'didi-dighomi':{district:'ვაკე-საბურთალო',sub:'დიდი დიღომი', wanted:['ვაკე-საბურთალო','დიდი დიღომი']},
  'didube':      {district:'დიდუბე-ჩუღურეთი',sub:'დიდუბე',     wanted:['დიდუბე']},
  'digomi':      {district:'დიდუბე-ჩუღურეთი',sub:'დიღმის მასივი',wanted:['დიღმის მე-3 მასივი','დიღმის მასივი']},
  'sanzona':     {district:'გლდანი-ნაძალადევი',sub:'სანზონა',   wanted:['სანზონა']},
};
const SUB_KA={'Saburtalo':'საბურთალო','Didi Dighomi':'დიდი დიღომი','Vashlijvari':'ვაშლიჯვარი','Didube':'დიდუბე','Dighomi Massive':'დიღმის მასივი','Sanzona':'სანზონა','Temka':'თემქა','Vazha-Pshavela Blocks':'ვაჟა ფშაველას კვარტლები','Vake':'ვაკე','Bagebi':'ბაგები','Vera':'ვერა','Chugureti':'ჩუღურეთი','Nadzaladevi':'ნაძალადევი'};
const DISTRICT_KA={'Saburtalo District':'ვაკე-საბურთალო','Vake District':'ვაკე-საბურთალო','Didube District':'დიდუბე-ჩუღურეთი','Chugureti District':'დიდუბე-ჩუღურეთი','Nadzaladevi District':'გლდანი-ნაძალადევი','Gldani District':'გლდანი-ნაძალადევი','საბურთალოს რაიონი':'ვაკე-საბურთალო','ვაკის რაიონი':'ვაკე-საბურთალო','დიდუბის რაიონი':'დიდუბე-ჩუღურეთი','ჩუღურეთის რაიონი':'დიდუბე-ჩუღურეთი','ნაძალადევის რაიონი':'გლდანი-ნაძალადევი','გლდანის რაიონი':'გლდანი-ნაძალადევი'};
// Listing pages are read in English (stable field names); detail pages in Georgian so descriptions and addresses keep their original wording.
const DETAIL_URL=id=>`${SITE}/qiravdeba-binebi-tbilisshi/${id}`;

const reqFile=path.join(root,'data','properties.json');
let wanted=['ვაკე-საბურთალო','დიდუბე','სანზონა','დიღმის მე-3 მასივი'];
let excluded=["მესამე მასივი","ვეძისი","სოფ. დიღომი","ნუცუბიძის ფერდობი","ვაშლიჯვარი","ვაკე","დიღომი 1-9"];
try{const req=JSON.parse(fs.readFileSync(reqFile,'utf8')).requirements;if(Array.isArray(req?.districts)&&req.districts.length)wanted=req.districts;if(Array.isArray(req?.excluded_locations))excluded=[...new Set([...excluded,...req.excluded_locations])]}catch{}
const norm=s=>String(s||'').replace(/[\s.\-–]/g,'').toLowerCase();
const wantedNorm=new Set(wanted.map(norm)),excludedNorm=new Set(excluded.map(norm));
const isDighomiThird=(sub,address='',description='')=>sub==='დიღმის მე-3 მასივი'||(sub==='დიღმის მასივი'&&/(?:მე[-\s]*3|მესამე|(?<![\dA-Z])III(?![A-Z])|(?<!\d)3|3rd|third)[-\s]*(?:ე[-\s]*)?(?:კვარტალ|მასივ|quarter|massive|micro)/iu.test(String(address)+' '+String(description)));

let previous={};let rate=2.6;
try{const j=JSON.parse(fs.readFileSync(outFile,'utf8'));for(const p of j.properties||[])previous[p.id]=p}catch{}

async function getHtml(url){
  const r=await fetch(url,{headers:{'User-Agent':UA,'Accept':'text/html','Accept-Language':'en'}});
  if(!r.ok)throw new Error(`HTTP ${r.status} for ${url}`);
  return r.text();
}
// window.INITIAL_STATE = {...};  — find the object by brace matching (strings may contain braces)
export function initialState(html){
  const marker='window.INITIAL_STATE = ';const i=html.indexOf(marker);
  if(i<0)throw new Error('INITIAL_STATE not found');
  let j=i+marker.length,depth=0,inStr=false,esc=false;
  for(let k=j;k<html.length;k++){const c=html[k];
    if(inStr){if(esc)esc=false;else if(c==='\\')esc=true;else if(c==='"')inStr=false;continue}
    if(c==='"')inStr=true;else if(c==='{')depth++;else if(c==='}'){depth--;if(depth===0)return JSON.parse(html.slice(j,k+1))}}
  throw new Error('INITIAL_STATE not terminated');
}
export const toGel=(price,currency,rate)=>currency==='GEL'?Number(price):currency==='USD'?Math.round(Number(price)*rate):null;

// 2. details
const yes=v=>v===true?true:v===false?false:null;
export function mapListing(objectId,st,card,areaHint){
  const L=st.layoutLandingStore,lay=L.layout,b=L.building||{},seller=L.seller||{};
  const id='korter-'+objectId,prev=previous[id];
  const currency=lay.currency||card?.currency||'USD';
  const price=toGel(lay.price,currency,rate);
  const subEn=card?.subLocalityNominative||null;
  const districtEn=(b.geoObjects||[]).find(g=>!g.isMain)?.nominative||null;
  const sub=SUB_KA[subEn]||subEn||areaHint?.sub||null;
  const district=DISTRICT_KA[districtEn]||areaHint?.district||null;
  const groups=[district,sub].filter(Boolean);
  const address=lay.address||b.address||card?.address||null;
  const desc=String(lay.description||'');
  if(isDighomiThird(sub,address,desc))groups.push('დიღმის მე-3 მასივი');
  const imgs=(lay.images||[]).map(i=>i.mediaSrc?.default?.x1||i.mediaSrc?.mobile?.x2).filter(Boolean);
  if(!imgs.length&&card?.mediaSrc?.default?.x2)imgs.push(card.mediaSrc.default.x2);
  const floorNums=(lay.floorsByHouse||[]).flatMap(h=>h.floorNumbers||[]).map(Number).filter(Number.isFinite);
  const floor=floorNums[0]??(card?.floorNumbers?.[0]??null);
  const totalFloors=lay.floorsByHouse?.[0]?.floorCount||card?.house?.floorCount||null;
  const pos=card?.building?.position;
  const lat=Number(pos?.lat)||null,lng=Number(pos?.lng)||null;
  const phones=(seller.phones||[]).map(p=>p.displayNumber).filter(Boolean);
  const advertiser=seller.sellerType==='owner'?'Individual':seller.sellerType?'Agency':null;
  const considerations=[];
  if(currency==='USD')considerations.push(`Asking rent is in USD ($${lay.price}); GEL shown at korter.ge rate ${rate}.`);
  if(advertiser==='Agency')considerations.push(`Posted by an agency${seller.agency?.name?' ('+seller.agency.name+')':''} — expect a commission.`);
  if(!/furnish|მოწყობილი|ავეჯ/i.test(desc))considerations.push('Furniture not stated in the listing.');
  considerations.push('Photos have not been visually screened by the automated collector.');
  return {
    id,url:`${SITE}/en/apartments-for-rent-tbilisi/${objectId}`,source:'korter.ge',
    retrieved_at:nowIso,last_checked_at:nowIso,retrieval_date_precision:'timestamp',
    transaction:'rent_monthly',property_type:'apartment',
    price,currency:'GEL',
    price_basis:currency==='GEL'?'GEL as listed on korter.ge':'USD listing converted to GEL at korter.ge rate',
    original_currency:currency,price_usd:currency==='USD'?Number(lay.price):null,
    district,neighborhood:sub||district,address,district_groups:groups,
    size:Number(lay.area)||Number(card?.area)||null,
    rooms:Number(lay.roomCount)||Number(card?.roomCount)||null,bedrooms:Number(lay.bedroomCount)||null,
    floor:Number.isFinite(floor)?floor:null,total_floors:Number(totalFloors)||null,
    condition:null,condition_original:null,
    furniture:/fully furnished|furnished|მოწყობილი|ავეჯით|ავეჯი/i.test(desc)?true:/unfurnished|without furniture|ავეჯის გარეშე|ცარიელი/i.test(desc)?false:null,furniture_items:[],
    heating:/central heating|heating|გათბობ/i.test(desc)?'Heating mentioned':null,
    parking:lay.parking?String(lay.parking):/parking|garage|პარკინგ|ავტოფარეხ|გარაჟ/i.test(desc)?'Parking mentioned':null,
    air_conditioning:/air[- ]?condition|a\/c\b|კონდიციონერ/i.test(desc)?true:null,
    balcony:lay.hasBalcony===true?'Balcony':lay.hasTerrace===true?'Terrace':null,
    elevator:/elevator|lift|ლიფტ/i.test(desc)?true:null,pet_friendly:/\bpets?\b|ცხოველ/i.test(desc)?true:null,
    building_status:null,
    advertiser,agency:seller.agency?.name||null,contact_person:seller.name||null,contact_phones:phones,
    description:desc,
    main_image:imgs[0]||null,images:imgs,source_images:imgs,
    listing_date:lay.actualizeTime||card?.actualizeTime||null,published_at:lay.publishTime||lay.createTime||null,
    listing_date_note:'korter.ge actualizeTime (renewals move it forward); publishTime saved as published_at',
    advance_months:null,screening:'include',
    photos_reviewed:'Not visually reviewed by the automated collector.',
    condition_review:'Renovation state is not structured on korter.ge; read the description. Physical condition unverified.',
    considerations,
    lat,lng,
    first_seen_at:prev?.first_seen_at||lay.publishTime||lay.createTime||nowIso,
  };
}


export async function main(){
// 1. search pages per area, newest first
const cutoff=Date.now()-MAX_AGE_DAYS*86400000;
const areas=Object.entries(AREAS).filter(([,a])=>a.wanted.some(w=>wantedNorm.has(norm(w))));
console.log(`areas: ${areas.map(([k])=>k).join(', ')} (districts wanted: ${wanted.join(', ')})`);
const candidates=new Map();
for(const [slug,area] of areas){
  for(let page=1;page<=MAX_PAGES;page++){
    const url=`${SITE}/en/apartments-for-rent-tbilisi-${slug}?max_price=${Math.ceil(MAX_PRICE_GEL/2.4)}&min_area=${MIN_AREA}${page>1?`&page=${page}`:''}`;
    let st;try{st=initialState(await getHtml(url))}catch(e){console.warn(`${slug} page ${page}: ${e.message}`);break}
    rate=Number(st.currencyStore?.rate)||rate;
    const items=st.apartmentListingStore?.apartments||[];
    if(!items.length)break;
    let oldest=Infinity;
    for(const it of items){
      const t=Date.parse(it.actualizeTime);if(Number.isFinite(t))oldest=Math.min(oldest,t);
      if(it.section!=='rent'||it.propertyCategory!=='flat')continue;
      const gel=toGel(it.price,it.currency,rate);
      if(!Number.isFinite(gel)||gel<=0||gel>MAX_PRICE_GEL)continue;
      if(!(Number(it.area)>=MIN_AREA))continue;
      candidates.set(String(it.objectId),{card:it,area});
    }
    console.log(`${slug} page ${page}: ${items.length} items, ${candidates.size} candidates so far`);
    if(oldest<cutoff)break;
    await sleep(400);
  }
}
// keep re-checking listings we already hold
for(const id of Object.keys(previous))if(!candidates.has(id.replace(/^korter-/,'')))candidates.set(id.replace(/^korter-/,''),null);

const out=[];let ok=0,gone=0,fail=0;
for(const [objectId,c] of candidates){
  const url=DETAIL_URL(objectId);
  try{
    const st=initialState(await getHtml(url));
    const lay=st.layoutLandingStore?.layout;
    if(!lay||lay.publicationStatus!=='published'||lay.available==='no'||lay.section!=='rent'){gone++;continue}
    const prevCard=previous['korter-'+objectId];
    const card=c?.card||(prevCard?{subLocalityNominative:Object.keys(SUB_KA).find(k=>SUB_KA[k]===prevCard.neighborhood)||null,building:{position:{lat:prevCard.lat,lng:prevCard.lng}},floorNumbers:[prevCard.floor],house:{floorCount:prevCard.total_floors}}:null);
    const p=mapListing(objectId,st,card,c?.area);
    if(!(p.price>0&&p.price<=MAX_PRICE_GEL&&p.size>=MIN_AREA)){gone++;continue}
    if([p.district,p.neighborhood,...p.district_groups].some(g=>excludedNorm.has(norm(g)))){gone++;continue}
    if(!p.district_groups.some(g=>wantedNorm.has(norm(g)))){gone++;continue}
    out.push(p);ok++;
  }catch(e){fail++;console.warn(`  ${objectId}: ${e.message}`)}
  await sleep(350);
}
out.sort((a,b)=>Date.parse(b.listing_date)-Date.parse(a.listing_date));
const result={retrieved_at:nowIso,source:SITE,method:'korter_html',method_label:'korter.ge listing + detail pages (embedded state)',
  coverage_note:`Newest ${MAX_PAGES} pages (20 each) per target area, up to ${MAX_AGE_DAYS} days back; retained listings rechecked. Not exhaustive.`,
  requirements:{max_price_gel:MAX_PRICE_GEL,min_size_m2:MIN_AREA,districts:wanted,excluded_locations:excluded},properties:out};
fs.mkdirSync(path.dirname(outFile),{recursive:true});
fs.writeFileSync(outFile,JSON.stringify(result,null,1));
console.log(`done: ${ok} listings kept, ${gone} dropped/inactive, ${fail} failed → ${path.relative(root,outFile)}`);
if(!ok&&candidates.size)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
