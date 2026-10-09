const base=Deno.env.get('SUPABASE_URL')!;
const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin={apikey:service,Authorization:`Bearer ${service}`,'Content-Type':'application/json'};
const cors={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type,apikey','Access-Control-Allow-Methods':'POST,OPTIONS'};
function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:cors});}
Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  try{
    const {ticket,login,email,password}=await req.json();
    if(typeof ticket!=='string'||!/^[0-9a-f]{64}$/.test(ticket))return json({error:'Ссылка настройки недействительна.'},401);
    if(typeof login!=='string'||login.trim().length<3||login.length>60||typeof email!=='string'||email.length>254||!/^\S+@\S+\.\S+$/.test(email)||typeof password!=='string'||password.length<12||password.length>1024)return json({error:'Проверь логин, email и пароль (не менее 12 символов).'},400);
    const owner=await fetch(`${base}/rest/v1/wardrobe_access?select=user_id&limit=1`,{headers:admin});
    if(!owner.ok)return json({error:'Сервис временно недоступен.'},503);
    if((await owner.json()).length)return json({error:'Аккаунт уже настроен. Открой обычный вход.'},409);
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ticket));
    const hash=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
    const consume=await fetch(`${base}/rest/v1/wardrobe_setup_tokens?token_hash=eq.${hash}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}`,{method:'DELETE',headers:{...admin,Prefer:'return=representation'}});
    if(!consume.ok)return json({error:'Сервис временно недоступен.'},503);
    if(!(await consume.json()).length)return json({error:'Ссылка использована или срок её действия истёк.'},401);
    const create=await fetch(`${base}/auth/v1/admin/users`,{method:'POST',headers:admin,body:JSON.stringify({email,password,email_confirm:true})});
    if(!create.ok)return json({error:'Не удалось создать аккаунт. Администратору нужно обновить ссылку настройки.'},400);
    const result=await create.json();const user=result.user||result;
    const access=await fetch(`${base}/rest/v1/wardrobe_access`,{method:'POST',headers:admin,body:JSON.stringify({singleton:true,user_id:user.id,login:login.trim().toLowerCase(),login_email:email.trim().toLowerCase()})});
    if(!access.ok){await fetch(`${base}/auth/v1/admin/users/${user.id}`,{method:'DELETE',headers:admin});return json({error:'Не удалось завершить настройку. Администратору нужно обновить ссылку.'},503);}
    return json({ok:true});
  }catch{return json({error:'Не удалось обработать запрос.'},400);}
});
