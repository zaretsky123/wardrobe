// This endpoint uses custom, one-use authentication, not the user's password.
const base=Deno.env.get('SUPABASE_URL')!;
const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const adminHeaders={apikey:service,Authorization:`Bearer ${service}`,'Content-Type':'application/json'};
function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});}
Deno.serve(async req=>{
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  try{
    const {ticket}=await req.json();
    if(typeof ticket!=='string'||!/^[0-9a-f]{64}$/.test(ticket))return json({error:'Unauthorized'},401);
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ticket));
    const hash=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
    // DELETE ... RETURNING consumes the ticket atomically; concurrent replay returns no row.
    const consume=await fetch(`${base}/rest/v1/wardrobe_agent_tickets?token_hash=eq.${hash}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}`,{method:'DELETE',headers:{...adminHeaders,Prefer:'return=representation'}});
    if(!consume.ok)return json({error:'Service unavailable'},503);
    const [grant]=await consume.json();if(!grant)return json({error:'Unauthorized'},401);
    const ownerQuery=await fetch(`${base}/rest/v1/wardrobe_access?user_id=eq.${grant.user_id}&select=user_id`,{headers:adminHeaders});
    if(!ownerQuery.ok||!(await ownerQuery.json()).length)return json({error:'Unauthorized'},401);
    const entries=[];
    for(let offset=0;;offset+=200){
      const entriesResponse=await fetch(`${base}/rest/v1/wardrobe_entries?user_id=eq.${grant.user_id}&deleted_at=is.null&select=*,photos:wardrobe_photos(*),links:wardrobe_outfit_items!wardrobe_outfit_items_outfit_fk(*)&order=created_at.desc&limit=200&offset=${offset}`,{headers:adminHeaders});
      if(!entriesResponse.ok)return json({error:'Service unavailable'},503);
      const batch=await entriesResponse.json();entries.push(...batch);if(batch.length<200)break;
    }
    const paths=entries.flatMap((e:any)=>e.photos.map((p:any)=>p.path));
    const links=new Map<string,string>();
    for(let offset=0;offset<paths.length;offset+=100){
      const signed=await fetch(`${base}/storage/v1/object/sign/wardrobe`,{method:'POST',headers:adminHeaders,body:JSON.stringify({paths:paths.slice(offset,offset+100),expiresIn:300})});
      if(!signed.ok)return json({error:'Service unavailable'},503);
      for(const item of await signed.json()){
        const path=item.signedURL||item.signedUrl;
        if(path)links.set(item.path,path.startsWith('http')?path:`${base}/storage/v1${path}`);
      }
    }
    for(const entry of entries){entry.photos.sort((a:any,b:any)=>a.position-b.position);entry.photos=entry.photos.map((p:any)=>({...p,url:links.get(p.path)}));entry.item_ids=entry.links.map((l:any)=>l.item_id);}
    return json({entries,photos_expire_in:300});
  }catch{return json({error:'Invalid request'},400);}
});
