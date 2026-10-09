// Login alias is resolved on the server. Passwords are verified only by Supabase Auth.
const base=Deno.env.get('SUPABASE_URL')!;
const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const anon=Deno.env.get('SUPABASE_ANON_KEY')!;
const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type,apikey','Access-Control-Allow-Methods':'POST,OPTIONS'};
function response(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers});}
Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return response({error:'Method not allowed'},405);
  if(Number(req.headers.get('content-length')||0)>4096)return response({error:'Invalid request'},413);
  try{
    const {login,password}=await req.json();
    if(typeof login!=='string'||typeof password!=='string'||login.length>120||password.length>1024||!password)return response({error:'Invalid credentials'},401);
    const lookup=await fetch(`${base}/rest/v1/wardrobe_access?select=user_id,login,login_email&singleton=eq.true&limit=1`,{headers:{apikey:service,Authorization:`Bearer ${service}`}});
    if(!lookup.ok)return response({error:'Service unavailable'},503);
    const [account]=await lookup.json();
    if(!account)return response({error:'Service unavailable'},503);
    // The same Auth verification runs for a wrong alias, avoiding alias timing enumeration.
    const result=await fetch(`${base}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:anon,'Content-Type':'application/json'},body:JSON.stringify({email:account.login_email,password})});
    const session=await result.json();
    if(!result.ok||login.trim().toLowerCase()!==account.login.toLowerCase()||session.user?.id!==account.user_id){
      if(result.ok&&session.access_token)await fetch(`${base}/auth/v1/logout?scope=local`,{method:'POST',headers:{apikey:anon,Authorization:`Bearer ${session.access_token}`}});
      return response({error:'Invalid credentials'},result.status===429?429:401);
    }
    return response({access_token:session.access_token,refresh_token:session.refresh_token});
  }catch{return response({error:'Invalid request'},400);}
});
