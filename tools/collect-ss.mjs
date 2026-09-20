#!/usr/bin/env node
// Collects long-term apartment rentals from ss.ge for the House Hunt site.
//
//   node tools/collect-ss.mjs                    # writes data/ss.json
//   node tools/collect-ss.mjs --out out/ss.json  # elsewhere (used by CI)
//   node tools/collect-ss.mjs --pages 10         # fewer search pages
//
// How it works
//   1. GET a search page on home.ss.ge → __NEXT_DATA__ carries an anonymous
//      API token (valid ~1 h) and the district/sub-district catalogue.
//   2. POST api-gateway.ss.ge/v1/RealEstate/LegendSearch, newest first,
//      restricted to the sub-districts that match data/properties.json's
//      requirements.districts. The API ignores price filters, so price and
//      area are filtered here.
//   3. For every candidate, GET its detail page: __NEXT_DATA__.applicationData
//      has coordinates, amenities, description and contact details.
//   4. Output uses the same listing schema as the myhome.ge scraper so the
//      site can merge both sources. Listings keep their previous first_seen_at.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const argValue=(name,def)=>{const i=args.indexOf(name);return i>=0?args[i+1]:def};
const outFile=path.resolve(argValue('--out',path.join(root,'data','ss.json')));
const MAX_PAGES=Number(argValue('--pages',30));
const MAX_AGE_DAYS=Number(argValue('--days',4));
const PAGE_SIZE=30;             // the API rejects larger pages
const MAX_PRICE_GEL=1000, MIN_AREA=38;
const CITY_TBILISI=95, TYPE_FLAT=5, DEAL_RENT=1;

const SITE='https://home.ss.ge';
const API='https://api-gateway.ss.ge/v1/RealEstate';
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36 house-hunt-report/1.0';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const nowIso=new Date().toISOString();

const reqFile=path.join(root,'data','properties.json');
let wanted=['ვაკე-საბურთალო','დიდუბე','სანზონა','მესამე მასივი'];
try{const r=JSON.parse(fs.readFileSync(reqFile,'utf8')).requirements?.districts;if(Array.isArray(r)&&r.length)wanted=r}catch{}
const norm=s=>String(s||'').replace(/[\s.\-–]/g,'').toLowerCase();
const wantedNorm=new Set(wanted.map(norm));

let previous={};
try{const j=JSON.parse(fs.readFileSync(outFile,'utf8'));for(const p of j.properties||[])previous[p.id]=p}catch{}

async function getHtml(url){
  const r=await fetch(url,{headers:{'User-Agent':UA,'Accept':'text/html','Accept-Language':'ka'}});
  if(!r.ok)throw new Error(`HTTP ${r.status} for ${url}`);
  return r.text();
}
function nextData(html){
  const m=html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if(!m)throw new Error('__NEXT_DATA__ not found');
  return JSON.parse(m[1]);
}

// 1. token + location catalogue
const searchHtml=await getHtml(`${SITE}/ka/udzravi-qoneba/l/bina/qiravdeba?cityIdList=${CITY_TBILISI}&currencyId=1&order=1`);
const pp=nextData(searchHtml).props.pageProps;
const token=pp.credentialsToken;
if(!token)throw new Error('No credentialsToken on the search page');
const city=(pp.locations?.visibleCities||[]).find(c=>c.cityId===CITY_TBILISI);
const subIds=[];const subNames={};
for(const d of city?.districts||[]){
  const dWanted=wantedNorm.has(norm(d.districtTitle));
  for(const s of d.subDistricts||[]){
    subNames[s.subDistrictId]=s.subDistrictTitle;
    if(dWanted||wantedNorm.has(norm(s.subDistrictTitle)))subIds.push(s.subDistrictId);
  }
}
console.log(`districts wanted: ${wanted.join(', ')} → ${subIds.length} sub-districts`);

const apiHeaders={'Accept':'application/json','Content-Type':'application/json','accept-language':'ka','authorization':'Bearer '+token,'os':'web','User-Agent':UA,'Origin':SITE,'Referer':SITE+'/'};

// 2. search, newest first
const candidates=new Map();
const cutoff=Date.now()-MAX_AGE_DAYS*86400000;
for(let page=1;page<=MAX_PAGES;page++){
  const body={realEstateType:TYPE_FLAT,realEstateDealType:DEAL_RENT,cityIdList:[CITY_TBILISI],subdistrictIds:subIds,areaFrom:MIN_AREA,order:1,page,pageSize:PAGE_SIZE};
  const r=await fetch(`${API}/LegendSearch`,{method:'POST',headers:apiHeaders,body:JSON.stringify(body)});
  if(!r.ok){console.warn(`search page ${page}: HTTP ${r.status}`);break}
  const items=(await r.json()).realStateItemModel||[];
  if(!items.length)break;
  let oldest=Infinity;
  for(const it of items){
    const t=Date.parse(it.orderDate);if(Number.isFinite(t))oldest=Math.min(oldest,t);
    const geo=it.price?.priceGeo;
    if(it.type!==TYPE_FLAT||it.dealType!==DEAL_RENT)continue;
    if(!Number.isFinite(geo)||geo<=0||geo>MAX_PRICE_GEL)continue;
    if(!(Number(it.totalArea)>=MIN_AREA))continue;
    candidates.set(String(it.applicationId),it);
  }
  console.log(`page ${page}: ${items.length} items, ${candidates.size} candidates so far`);
  if(oldest<cutoff)break;
  await sleep(250);
}
// keep re-checking listings we already hold
for(const id of Object.keys(previous))if(!candidates.has(id.replace(/^ss-/,'')))candidates.set(id.replace(/^ss-/,''),null);

// 3. details
const yes=v=>v===true?true:v===false?false:null;
function mapListing(ad,li){
  const a=ad.address||li?.address||{};
  const price=ad.price||li?.price||{};
  const lat=Number(ad.locationLatitude)||Number(ad.streetLocationLatitude)||null;
  const lng=Number(ad.locationLongitude)||Number(ad.streetLocationLongitude)||null;
  const imgs=(ad.appImages||li?.appImages||[]).map(i=>i.fileName).filter(Boolean);
  const groups=[a.districtTitle,a.subdistrictTitle].filter(Boolean);
  const id='ss-'+ad.applicationId;
  const prev=previous[id];
  const desc=typeof ad.description==='object'?(ad.description.ka||ad.description.en||ad.description.ru||''):String(ad.description||li?.description||'');
  const phones=(ad.applicationPhones||[]).map(p=>p.phoneNumber).filter(Boolean);
  const cond=ad.state||null;
  const considerations=[];
  if(price.currencyType===2)considerations.push('Asking rent is in USD; GEL shown at ss.ge rate.');
  if(ad.userEntityType&&ad.userEntityType!=='Individual')considerations.push(`Posted by ${ad.userEntityType.toLowerCase()}${ad.agencyName?' ('+ad.agencyName+')':''} — expect a commission.`);
  considerations.push('Photos have not been visually screened by the automated collector.');
  return {
    id,url:`${SITE}/ka/udzravi-qoneba/${li?.detailUrl||ad.applicationId}`,source:'ss.ge',
    retrieved_at:nowIso,last_checked_at:nowIso,retrieval_date_precision:'timestamp',
    transaction:'rent_monthly',property_type:'apartment',
    price:Number(price.priceGeo),currency:'GEL',
    price_basis:'GEL total shown by ss.ge; USD listings converted by ss.ge',
    original_currency:price.currencyType===2?'USD':'GEL',price_usd:price.priceUsd??null,
    district:a.districtTitle||null,neighborhood:a.subdistrictTitle||a.districtTitle||null,
    address:[a.streetTitle,a.streetNumber].filter(Boolean).join(' ')||null,
    district_groups:groups,
    size:Number(ad.totalArea)||Number(li?.totalArea)||null,
    rooms:Number(ad.rooms)||null,bedrooms:Number(ad.bedrooms)||null,
    floor:Number(ad.floor)||null,total_floors:Number(ad.floors)||null,
    condition:cond,condition_original:cond,
    furniture:yes(ad.furniture),furniture_items:[],
    heating:ad.heating===true?'Heating listed':null,
    parking:ad.garage===true?'Garage listed':null,
    air_conditioning:yes(ad.airConditioning),
    balcony:ad.balcony===true?(ad.balcony_Loggia?`${ad.balcony_Loggia} balcony`:'Balcony'):null,
    elevator:yes(ad.elevator),pet_friendly:yes(ad.isPetFriendly),
    building_status:ad.realEstateStatus||null,
    advertiser:ad.userEntityType||null,agency:ad.agencyName||ad.companyName||null,contact_person:ad.contactPerson||null,
    contact_phones:phones,
    description:desc,
    main_image:imgs[0]||null,images:imgs,source_images:imgs,
    listing_date:ad.orderDate||li?.orderDate||null,published_at:li?.createDate||null,
    listing_date_note:'ss.ge orderDate (renewals move it forward); createDate saved as published_at',
    advance_months:null,screening:'include',
    photos_reviewed:'Not visually reviewed by the automated collector.',
    condition_review:'Seller-reported condition. Physical condition unverified.',
    considerations,
    lat,lng,view_count:ad.viewCount??null,
    first_seen_at:prev?.first_seen_at||li?.createDate||nowIso,
  };
}

const out=[];let ok=0,gone=0,fail=0;
for(const [id,li] of candidates){
  const url=li?.detailUrl?`${SITE}/ka/udzravi-qoneba/${li.detailUrl}`:previous['ss-'+id]?.url;
  if(!url){fail++;continue}
  try{
    const ad=nextData(await getHtml(url)).props.pageProps.applicationData;
    if(!ad||ad.isInactiveApplication||(ad.status&&ad.status!=='Active')){gone++;continue}
    const p=mapListing(ad,li);
    if(!(p.price>0&&p.price<=MAX_PRICE_GEL&&p.size>=MIN_AREA)){gone++;continue}
    if(!p.district_groups.some(g=>wantedNorm.has(norm(g)))){gone++;continue}
    out.push(p);ok++;
  }catch(e){fail++;console.warn(`  ${id}: ${e.message}`)}
  await sleep(300);
}
out.sort((a,b)=>Date.parse(b.listing_date)-Date.parse(a.listing_date));
const result={retrieved_at:nowIso,source:SITE,method:'ss_api',method_label:'ss.ge search API + detail pages',
  coverage_note:`Newest ${MAX_PAGES} search pages (${PAGE_SIZE} each) in the target sub-districts, up to ${MAX_AGE_DAYS} days back; retained listings rechecked. Not exhaustive.`,
  requirements:{max_price_gel:MAX_PRICE_GEL,min_size_m2:MIN_AREA,districts:wanted},properties:out};
fs.mkdirSync(path.dirname(outFile),{recursive:true});
fs.writeFileSync(outFile,JSON.stringify(result,null,1));
console.log(`done: ${ok} listings kept, ${gone} dropped/inactive, ${fail} failed → ${path.relative(root,outFile)}`);
if(!ok&&candidates.size)process.exitCode=1;
