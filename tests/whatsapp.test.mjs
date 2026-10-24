import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const s=fs.readFileSync(new URL('../script.js',import.meta.url),'utf8');
const ctx=vm.createContext({URL});
vm.runInContext(s.split('\n').find(x=>x.startsWith('function safeUrl(')),ctx);
vm.runInContext(s.slice(s.indexOf('// WhatsApp helpers:'),s.indexOf('// End WhatsApp helpers.')),ctx);
test('normalizes Georgian and explicit international phone formats',()=>{
 for(const n of ['555123456','+995 555 12 34 56','995555123456','00995 (555) 123-456'])assert.equal(ctx.whatsappNumber(n),'995555123456');
 assert.equal(ctx.whatsappNumber('+44 7700 900123'),'447700900123');
});
test('rejects hidden, partial, ambiguous and injected numbers',()=>{
 for(const n of [null,{},'555***456','123','555123456 / 555123457','javascript:alert(1)','07700900123','+000','+995555123456?text=hello'])assert.equal(ctx.whatsappNumber(n),null,String(n));
});
test('opens first valid saved contact with no draft or automatic send',()=>{
 const t=ctx.whatsappTarget({contact_phones:['hidden','555123456','555123457']});
 assert.equal(t.url,'https://web.whatsapp.com/send?phone=995555123456');assert.equal(t.fallback,false);
 assert.equal(new URL(t.url).searchParams.has('text'),false);
});
test('missing or invalid phone opens WhatsApp Web, never source or description numbers',()=>{
 for(const contact_phones of [undefined,[],['hidden']]){
 const t=ctx.whatsappTarget({contact_phones,description:'555123456',url:'https://www.myhome.ge/example/'});
 assert.equal(t.url,'https://web.whatsapp.com/');assert.equal(t.fallback,true);
 }
 assert.equal(ctx.whatsappTarget({url:'javascript:alert(1)'}).url,'https://web.whatsapp.com/');
});
