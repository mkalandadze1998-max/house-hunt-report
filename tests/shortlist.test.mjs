import test from 'node:test';
import assert from 'node:assert/strict';
import { loadShortlist, planListingChecks } from '../tools/shortlist.mjs';
const now=Date.parse('2026-10-26T00:00:00Z');
const post=(id,h)=>({id,last_checked_at:new Date(now-h*3600000).toISOString()});

test('new-only scan skips all saved homes and hidden new IDs',()=>{
 const choices={hidden:new Set(['hidden-new']),favorites:new Set(['saved'])};
 const posts=[post('saved',200),post('ordinary',200)];
 assert.deepEqual(planListingChecks(posts,['new','hidden-new'],choices,now,72,0).candidates,['new']);
});
test('hidden posts are never checked, including hidden favorites and rediscovered IDs; other old posts are',()=>{
 const choices={hidden:new Set(['hidden','hidden-new']),favorites:new Set(['hidden','favorite'])};
 const p=planListingChecks([post('hidden',200),post('favorite',72),post('ordinary',200),post('fresh-ordinary',5)],['hidden-new','new'],choices,now,72,35);
 assert.deepEqual(p.candidates,['new','ordinary','favorite'],'oldest check first; a listing checked 5 h ago waits');
});
test('favorites wait 72 hours, other listings 20 hours; new posts get capacity first; old ones rotate',()=>{
 const choices={hidden:new Set(),favorites:new Set(['old','older','recent'])};
 const posts=[post('old',72),post('older',120),post('recent',71),post('plain',21),post('plain-new',19)];
 assert.deepEqual(planListingChecks(posts,['new'],choices,now,72,1).candidates,['new','older']);
 assert.deepEqual(planListingChecks(posts,['new'],choices,now,72,35).candidates,['new','older','old','plain']);
 assert.deepEqual(planListingChecks(posts,['new'],choices,now,72,35,1).candidates,['new']);
 assert.equal(planListingChecks(posts,['new'],choices,now,72,35,1).deferred,3);
 assert.deepEqual(planListingChecks(posts,[],choices,now,72,35,Infinity,48).candidates,['older','old'],'a longer age for ordinary listings');
});
test('shared choices are paged without notes; hidden wins over favorite',async()=>{
 let calls=0;
 const result=await loadShortlist({password:'test-only',fetchImpl:async(url,options)=>{
  calls++;
  if(calls===1){assert(url.includes('/auth/'));return Response.json({access_token:'test-token'});}
  assert(!url.includes('note'));assert.equal(options.headers.Authorization,'Bearer test-token');
  if(calls===2)return Response.json(Array.from({length:1000},(_,i)=>({listing_id:String(i),hidden:i===0,favorite:true})));
  assert(url.includes('offset=1000'));return Response.json([{listing_id:'1000',hidden:true,favorite:true}]);
 }});
 assert.equal(calls,3);assert(result.hidden.has('1000'));assert(!result.favorites.has('0'));assert.equal(result.favorites.size,999);
});
test('missing secret or unreadable choices stops collection instead of guessing',async()=>{
 await assert.rejects(loadShortlist({password:'',fetchImpl:()=>{throw Error('Must not fetch');}}),/HH_PASSWORD/);
 await assert.rejects(loadShortlist({password:'test',fetchImpl:async()=>new Response('',{status:401})}),/sign-in failed/);
});
