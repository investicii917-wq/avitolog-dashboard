import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';

const root=new URL('..',import.meta.url).pathname.replace(/^\/(.:)/,'$1');
const collect=(folder,base=folder)=>readdirSync(folder).flatMap(name=>{const path=join(folder,name);return statSync(path).isDirectory()?collect(path,base):[relative(base,path).replace(/\\/g,'/')];}).sort();
test('GitHub Pages and local static trees stay identical',()=>{
 const docs=join(root,'docs'),local=join(root,'public');
 const docsFiles=collect(docs),localFiles=collect(local);
 assert.deepEqual(localFiles,docsFiles);
 for(const file of docsFiles)assert.deepEqual(readFileSync(join(local,file)),readFileSync(join(docs,file)),file);
});