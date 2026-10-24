import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const script=fs.readFileSync(new URL('../script.js',import.meta.url),'utf8');
const block=script.slice(script.indexOf('// Seller classification:'),script.indexOf('// End seller classification.'));
const ctx=vm.createContext({});
vm.runInContext(block,ctx);
const classify=(description,advertiser='Broker')=>ctx.advertiserEvidence({description,advertiser});
test('clear Georgian owner requests override account labels',()=>{
 for(const text of [
  'აგენტები და მაკლერები არ დამიკავშირდეთ',
  'აგენტები და ბროკერები ნუ დამიკავშირდებით.',
  'აგენტებმა არ დარეკოთ!!!',
  'სააგენტოები არ გამომეხმაურონ',
  'მაკლერებისგან ზარების მიღება არ გვინდათ!',
  'არ ვთანამშრომლობ მაკლერებთან',
  'სააგენტოებთან არ ვთანამშრომლობ!',
  'მაკლერები ნუ გამომეხმაურებით.',
  'მესაკუთრის განცხადება!',
  'ქირავდება მესაკუთრესგან გარემონტებული ბინა',
  'ვარ მეპატრონე.',
  'Owner. One-room apartment for rent', 'მეტრო ახლოსაა.........Owner. One-room apartment'
 ])assert.equal(classify(text).type,'owner',text);
});
test('explicit agent claims win over requests to other agents',()=>{
 for(const text of ['აგენტი ვარ','ვარ უძრავი ქონების აგენტი.','2 თვის წინასწარი გადახდით (აგენტი)','აგენტი ვარ, არ ვთანამშრომლობ სხვა აგენტებთან! agents don’t call me']){
  assert.equal(classify(text,'Individual').type,'agent',text);
 }
});
test('mere mentions do not imply owner and missing labels remain unknown',()=>{
 for(const text of ['სააგენტოებთან ვთანამშრომლობ 50% ზე','აგენტები დამიკავშირდით','ბინა ახლოსაა მეტროსთან']){
  assert.equal(classify(text).type,'agent',text);
  assert.equal(classify(text,null).type,'unknown',text);
 }
 assert.equal(classify('', 'Construction').type,'unknown');
 assert.equal(classify('ვარ მეპატრონე და აგენტი ვარ').type,'unknown');
});
test('HTML and whitespace do not break classification; evidence explains inference',()=>{
 const result=classify('<p>აგენტები და მაკლერები</p><p>არ დამიკავშირდეთ</p>');
 assert.equal(result.type,'owner');
 assert.match(result.basis,/inferred/);
});

test('negated role claims do not assign that role',()=>{assert.equal(classify('არ ვარ აგენტი',null).type,'unknown');assert.equal(classify('არ ვარ მეპატრონე',null).type,'unknown');});
