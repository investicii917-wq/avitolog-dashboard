import {sampleState,VERSION} from './model.js?v=12';
const DB='avitolog-workspace-v3';
const STORE='workspace',MEDIA='media';
let dbPromise;
function database(){
 if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{
  const req=indexedDB.open(DB,2);
  req.onupgradeneeded=()=>{
   const db=req.result;
   if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE);
   if(!db.objectStoreNames.contains(MEDIA))db.createObjectStore(MEDIA);
  };
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(Error('Не удалось открыть хранилище браузера'));
 });
 return dbPromise;
}
const keyFor=(listingId,photo)=>photo.mediaKey||`${listingId}:${photo.id}`;
function compactPhoto(listingId,photo,media){
 if(!photo)return photo;
 const mediaKey=keyFor(listingId,photo);
 if(photo.src||(!photo.mediaKey&&photo.preview))media.set(mediaKey,{mediaKey,src:photo.src||null,preview:photo.preview||null});
 return {...photo,mediaKey,src:null,preview:null};
}
function compactItem(item,media){
 const compact=photos=>(photos||[]).map(photo=>compactPhoto(item.id,photo,media));
 return {...item,photos:compact(item.photos),sourcePhotos:compact(item.sourcePhotos),imageHistory:(item.imageHistory||[]).map(group=>({...group,photos:compact(group.photos)}))};
}
function compactState(state,media){
 const compactDraft=state.newDraft?compactItem({...state.newDraft,id:state.newDraft.id||state.newDraft.key||'new'},media):state.newDraft;
 return {...state,mediaSeparated:true,items:(state.items||[]).map(item=>compactItem(item,media)),newDraft:compactDraft};
}
async function writeCompact(state){
 const db=await database(),media=new Map(),compact=compactState(state,media);
 return new Promise((resolve,reject)=>{
  const tx=db.transaction([STORE,MEDIA],'readwrite'),workspace=tx.objectStore(STORE),files=tx.objectStore(MEDIA);
  workspace.put(compact,'current');
  for(const value of media.values())files.put(value,value.mediaKey);
  tx.oncomplete=()=>resolve(compact);
  tx.onerror=()=>reject(Error('Не удалось сохранить данные. Возможно, память браузера заполнена.'));
  tx.onabort=()=>reject(Error('Сохранение прервано. Изменения не записаны.'));
 });
}
export async function saveState(state){await writeCompact(state);}
export async function readState(){
 const db=await database();
 const state=await new Promise((resolve,reject)=>{const req=db.transaction(STORE).objectStore(STORE).get('current');req.onsuccess=()=>resolve(req.result);req.onerror=reject;});
 if(state&&state.version===VERSION){
  if(!state.mediaSeparated)return writeCompact(state);
  return state;
 }
 const initial=sampleState();await writeCompact(initial);return initial;
}
export async function readPhotoMedia(listingId,photos,{full=false}={}){
 const wanted=(photos||[]).filter(photo=>photo?.mediaKey||photo?.id);
 if(!wanted.length)return photos||[];
 const db=await database();
 const values=await new Promise((resolve,reject)=>{
  const tx=db.transaction(MEDIA),store=tx.objectStore(MEDIA),result=new Map();
  for(const photo of wanted){const key=keyFor(listingId,photo),request=store.get(key);request.onsuccess=()=>{if(request.result)result.set(key,request.result);};request.onerror=()=>reject(request.error);}
  tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);
 });
 return (photos||[]).map(photo=>{
  const value=values.get(keyFor(listingId,photo));
  if(!value)return photo;
  return full?{...photo,src:value.src||value.preview||null,preview:value.preview||null}:{...photo,preview:value.preview||value.src||null};
 });
}