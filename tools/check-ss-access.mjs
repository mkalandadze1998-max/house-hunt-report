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
