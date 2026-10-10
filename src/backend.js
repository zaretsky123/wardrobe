import {createClient} from '@supabase/supabase-js';
import JSZip from 'jszip';
import {validateEntry,filename} from './domain.js';

export class WardrobeBackend {
  constructor(config) {
    if(!config.supabaseUrl||!config.publishableKey)throw new Error('CONFIG_MISSING');
    this.config=config;
    this.client=createClient(config.supabaseUrl,config.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storageKey:'wardrobe-auth'}});
    this.user=null;
    this.signed=new Map();
  }
  async session(){const {data,error}=await this.client.auth.getSession();if(error)throw error;return data.session;}
  async authorize(){
    const {data:{user},error}=await this.client.auth.getUser();if(error)throw error;
    const {data,error:accessError}=await this.client.from('wardrobe_access').select('user_id').eq('user_id',user.id).maybeSingle();
    if(accessError)throw accessError;
    if(!data){await this.client.auth.signOut();throw new Error('У этого аккаунта нет доступа к гардеробу.');}
    this.user=user;return user;
  }
  async login(login,password){
    const response=await fetch(`${this.config.supabaseUrl}/functions/v1/wardrobe-login`,{method:'POST',headers:{'Content-Type':'application/json',apikey:this.config.publishableKey},body:JSON.stringify({login,password})});
    const result=await response.json();
    if(!response.ok)throw new Error(response.status===429?'Слишком много попыток. Подожди немного.':'Не удалось войти. Проверь логин и пароль.');
    const {error}=await this.client.auth.setSession({access_token:result.access_token,refresh_token:result.refresh_token});if(error)throw error;
    await this.authorize();
  }
  async logout(){const {error}=await this.client.auth.signOut();if(error)throw error;this.user=null;this.signed.clear();}
  async load(){
    const entries=[];
    for(let offset=0;;offset+=200){
      const {data,error}=await this.client.from('wardrobe_entries').select('*, photos:wardrobe_photos(*), links:wardrobe_outfit_items!wardrobe_outfit_items_outfit_fk(*)').order('created_at',{ascending:false}).range(offset,offset+199);
      if(error)throw error;entries.push(...data);if(data.length<200)break;
    }
    const paths=entries.flatMap(e=>e.photos.map(p=>p.path));
    for(let offset=0;offset<paths.length;offset+=100){
      const {data:urls,error:signError}=await this.client.storage.from('wardrobe').createSignedUrls(paths.slice(offset,offset+100),900);if(signError)throw signError;
      for(const u of urls||[]){if(u.error)throw new Error('Не удалось открыть фотографию.');this.signed.set(u.path,u.signedUrl);}
    }
    for(const e of entries){e.tags=e.tags||[];e.photos.sort((a,b)=>a.position-b.position);e.photos=e.photos.map(p=>({...p,url:this.signed.get(p.path)}));e.item_ids=e.links.map(l=>l.item_id);}
    return entries;
  }
  async save(draft,photoDrafts){
    const entry=validateEntry(draft);
    const uploaded=[];
    try{
      const photos=[];
      for(let i=0;i<photoDrafts.length;i++){
        const p=photoDrafts[i];
        let path=p.path;
        if(p.file){
          const blob=await prepareImage(p.file);
          path=`${this.user.id}/${entry.id}/${crypto.randomUUID()}.jpg`;
          const {error}=await this.client.storage.from('wardrobe').upload(path,blob,{contentType:'image/jpeg',upsert:false});if(error)throw error;
          uploaded.push(path);
        }
        photos.push({id:p.id||crypto.randomUUID(),path,role:p.role||'Отдельно',caption:p.caption||'',position:i});
      }
      const {data,error}=await this.client.rpc('save_wardrobe_entry',{p_entry:entry,p_photos:photos,p_item_ids:entry.item_ids||[]});if(error)throw error;
      const removed=data?.removed_paths||[];
      if(removed.length){const {error:cleanupError}=await this.client.storage.from('wardrobe').remove(removed);if(cleanupError)console.warn('Photo cleanup deferred');}
      return data;
    }catch(error){
      if(uploaded.length){
        // A lost HTTP response may follow a successful commit. Never delete files
        // unless a separate read confirms that no saved photo uses their paths.
        const {data:adopted,error:checkError}=await this.client.from('wardrobe_photos').select('path').in('path',uploaded);
        if(!checkError){const used=new Set(adopted.map(p=>p.path));const unused=uploaded.filter(path=>!used.has(path));if(unused.length)await this.client.storage.from('wardrobe').remove(unused).catch(()=>{});}
      }
      throw error;
    }
  }
  async update(id,patch){const {error}=await this.client.from('wardrobe_entries').update(patch).eq('id',id);if(error)throw error;}
  async removeForever(entry){
    const {error}=await this.client.rpc('purge_wardrobe_entry',{p_id:entry.id});if(error)throw error;
    const paths=entry.photos.map(p=>p.path);if(paths.length){const {error:removeError}=await this.client.storage.from('wardrobe').remove(paths);if(removeError)throw new Error('Карточка удалена. Очистка фотографий не завершилась; попробуй позже.');}
  }
  async export(entries,onProgress){
    const zip=new JSZip();
    const clean=entries.map(({photos,links,item_ids,...e})=>({...e,item_ids,photos:photos.map(({url,...p})=>p)}));
    zip.file('wardrobe.json',JSON.stringify({format:'personal-wardrobe',version:1,exported_at:new Date().toISOString(),entries:clean},null,2));
    const photos=entries.flatMap(e=>e.photos);
    for(let i=0;i<photos.length;i++){
      const p=photos[i];onProgress?.(i+1,photos.length);
      const {data,error}=await this.client.storage.from('wardrobe').download(p.path);if(error)throw error;
      zip.file(`photos/${p.path}`,data);
    }
    const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE'});
    downloadBlob(blob,`${filename('Гардероб')}-${new Date().toISOString().slice(0,10)}.zip`);
  }
}

export async function prepareImage(file){
  if(file.size>25*1024*1024)throw new Error('Фото слишком большое. Максимум — 25 МБ.');
  let bitmap;
  try{bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});}catch{throw new Error('Не удалось прочитать фото. Попробуй JPEG, PNG, WebP или скриншот.');}
  const scale=Math.min(1,2400/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.9));if(!blob)throw new Error('Не удалось обработать фото.');return blob;
}
export function downloadBlob(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
