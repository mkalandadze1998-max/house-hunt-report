import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../script.js',import.meta.url),'utf8');
const block=source.slice(source.indexOf('const idsOf='),source.indexOf('function normalizeSelected'));
function matches(property,hidden,notes){
 const context=vm.createContext({saved:{hidden,favorites:[]},notes});
 vm.runInContext(block+'\nglobalThis.matches=hasHiddenComment;',context);
 return context.matches(property);
}
test('requires both a hidden mark and a non-empty comment',()=>{
 assert.equal(matches({id:'a'},['a'],{a:'Called the owner'}),true);
 assert.equal(matches({id:'a'},[],{a:'Called the owner'}),false);
 assert.equal(matches({id:'a'},['a'],{}),false);
 assert.equal(matches({id:'a'},['a'],{a:'  \n '}),false);
});
test('keeps comments linked to reposts and copies on another source',()=>{
 const p={id:'new',reposts:[{id:'old'}],also_on:[{id:'ss-copy'}]};
 assert.equal(matches(p,['new'],{old:'My note'}),true);
 assert.equal(matches(p,['old'],{'ss-copy':'My note'}),true);
 assert.equal(matches(p,['unrelated'],{old:'My note'}),false);
});
