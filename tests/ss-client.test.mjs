import test from 'node:test';
import assert from 'node:assert/strict';
import {publicSession,readDistricts} from '../tools/ss-client.mjs';

test('SS uses the current public cookie without logging it',()=>{
 const response={headers:new Headers()};
 response.headers.append('Set-Cookie','ss-session-token=public-test; Path=/; HttpOnly');
 assert.equal(publicSession(response,{}),'public-test');
 assert.equal(publicSession({headers:new Headers()},{credentialsToken:'legacy-test'}),'legacy-test');
 assert.throws(()=>publicSession({headers:new Headers()},{}),/session is missing/);
});
test('SS maps current district data and rejects empty or broken data',async()=>{
 const fetchImpl=async()=>({ok:true,json:async()=>[{id:1,title:'district',subDistricts:[{id:2,title:'area'}]}]});
 assert.deepEqual(await readDistricts('test',fetchImpl),[{districtTitle:'district',subDistricts:[{subDistrictId:2,subDistrictTitle:'area'}]}]);
 await assert.rejects(readDistricts('test',async()=>({ok:true,json:async()=>[]})),/data changed/);
 await assert.rejects(readDistricts('test',async()=>({ok:false,status:403})),/HTTP 403/);
});
