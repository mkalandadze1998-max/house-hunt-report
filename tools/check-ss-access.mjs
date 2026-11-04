const url='https://home.ss.ge/ka/udzravi-qoneba/l/bina/qiravdeba?cityIdList=95&currencyId=1&order=1';
for(const [name,target,headers] of [
 ['direct',url,{}],
 ['browser headers',url,{'User-Agent':'Mozilla/5.0','Accept':'text/html'}],
 ['public reader','https://r.jina.ai/'+url,{'X-Return-Format':'html','X-No-Cache':'true'}]
]){
 try{
 const r=await fetch(target,{headers,signal:AbortSignal.timeout(60000)});
 const text=await r.text();
 const m=text.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
 const pp=m?JSON.parse(m[1]).props.pageProps:null;
 console.log(JSON.stringify({name,status:r.status,server:r.headers.get('server'),challenge:r.headers.get('cf-mitigated'),hasData:!!pp,hasPublicToken:!!pp?.credentialsToken,length:text.length,title:text.match(/<title>(.*?)<\/title>/)?.[1]}));
 if(pp?.credentialsToken){
 const api=await fetch('https://api-gateway.ss.ge/v1/RealEstate/LegendSearch',{method:'POST',headers:{'Content-Type':'application/json',authorization:'Bearer '+pp.credentialsToken,os:'web','accept-language':'ka'},body:JSON.stringify({realEstateType:5,realEstateDealType:1,cityIdList:[95],order:1,page:1,pageSize:30}),signal:AbortSignal.timeout(30000)});
 const body=await api.text();let j;try{j=JSON.parse(body)}catch{}
 console.log(JSON.stringify({apiStatus:api.status,rows:j?.realStateItemModel?.length}));
 }
 }catch(e){console.log(name,e.name)}
}

for(const [url,method] of [
 ['https://home.ss.ge/api/refresh_access_token','POST'],
 ['https://home.ss.ge/','GET'],
 ['https://home.ss.ge/_next/data/ydTJl7rB8PNLIrdvdeTND/ka/real-estate/l/bina/qiravdeba.json?cityIdList=95&currencyId=1&order=1','GET']
]){
 const r=await fetch(url,{method,signal:AbortSignal.timeout(30000)});
 const cookies=r.headers.getSetCookie();
 const text=await r.text();
 console.log(JSON.stringify({url,status:r.status,challenge:r.headers.get('cf-mitigated'),hasSession:cookies.some(x=>x.startsWith('ss-session-token=')),json:text.startsWith('{')}));
}

const { execFileSync } = await import('node:child_process');
try {
 const html=execFileSync('google-chrome',['--headless','--no-sandbox','--disable-dev-shm-usage','--dump-dom','--timeout=30000','--virtual-time-budget=15000','https://home.ss.ge/ka/udzravi-qoneba/l/bina/qiravdeba'],{encoding:'utf8',timeout:45000,maxBuffer:10e6,stdio:['ignore','pipe','ignore']});
 console.log(JSON.stringify({name:'browser',hasData:html.includes('__NEXT_DATA__'),title:html.match(/<title>(.*?)<\/title>/)?.[1]}));
} catch { console.log('browser check failed'); }
