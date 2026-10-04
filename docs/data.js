
import {sampleState,VERSION} from './model.js';
const DB='avitolog-workspace-v3';
let dbPromise;
function database(){
 if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{
  const req=indexedDB.open(DB,1);
  req.onupgradeneeded=()=>req.result.createObjectStore('workspace');
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(Error('Не удалось открыть хранилище браузера'));
 });
 return dbPromise;
}
export async function saveState(state){
 const db=await database();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('workspace','readwrite');tx.objectStore('workspace').put(state,'current');
  tx.oncomplete=resolve;tx.onerror=()=>reject(Error('Не удалось сохранить данные. Возможно, память браузера заполнена.'));
  tx.onabort=()=>reject(Error('Сохранение прервано. Изменения не записаны.'));
 });
}
export async function readState(){
 const db=await database();
 const s=await new Promise((resolve,reject)=>{const req=db.transaction('workspace').objectStore('workspace').get('current');req.onsuccess=()=>resolve(req.result);req.onerror=reject;});
 if(s&&s.version===VERSION)return s;
 const initial=sampleState();await saveState(initial);return initial;
}
export const AUTH_KEY='avitolog-unlocked-v3';
