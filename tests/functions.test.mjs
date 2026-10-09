import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto,createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {transform} from 'esbuild';
const OWNER='11111111-1111-4111-8111-111111111111';
async function handler(name,fetch){
 let serve;
 const {code}=await transform(await readFile(new URL(`../supabase/functions/${name}/index.ts`,import.meta.url),'utf8'),{loader:'ts'});
 runInNewContext(code,{Deno:{env:{get:key=>({SUPABASE_URL:'https://example.test',SUPABASE_SERVICE_ROLE_KEY:'test-server-key',SUPABASE_ANON_KEY:'test-public-key'}[key])},serve:h=>{serve=h;}},fetch,Response,Request,TextEncoder,Uint8Array,crypto:webcrypto,URL,Date,Map});
 return serve;
}
const post=body=>new Request('https://example.test/function',{method:'POST',body:JSON.stringify(body),headers:{'content-type':'application/json'}});
const ok=body=>new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
test('login alias is checked on server, valid password alone does not grant access',async()=>{
 const requests=[];
 const h=await handler('wardrobe-login',async(url,options)=>{requests.push(url);if(url.includes('/wardrobe_access'))return ok([{user_id:OWNER,login:'artur',login_email:'private@example.test'}]);if(url.includes('/token'))return ok({access_token:'test-access',refresh_token:'test-refresh',user:{id:OWNER}});return ok({});});
 const denied=await h(post({login:'stranger',password:'correct-password'}));assert.equal(denied.status,401);assert(requests.some(url=>url.includes('/logout')));
 const allowed=await h(post({login:'ARTUR',password:'correct-password'}));assert.equal(allowed.status,200);const data=await allowed.json();assert.equal(data.access_token,'test-access');assert.equal(data.login_email,undefined);
});
test('agent photo access requires a ticket and atomically prevents replay',async()=>{
 const ticket='a'.repeat(64),hash=createHash('sha256').update(ticket).digest('hex');let remaining=true,reads=0;
 const h=await handler('wardrobe-agent',async(url,options)=>{
  if(url.includes('/wardrobe_agent_tickets')){assert.equal(options.method,'DELETE');assert(url.includes(hash));if(remaining){remaining=false;return ok([{user_id:OWNER}]);}return ok([]);}
  if(url.includes('/wardrobe_access'))return ok([{user_id:OWNER}]);
  if(url.includes('/wardrobe_entries')){reads++;return ok([{id:'item',photos:[{path:'owner/item/a.jpg',position:0}],links:[]}]);}
  if(url.includes('/object/sign'))return ok([{path:'owner/item/a.jpg',signedURL:'/object/sign/wardrobe/owner/item/a.jpg?token=test'}]);
  throw new Error('Unexpected endpoint');
 });
 assert.equal((await h(post({}))).status,401);assert.equal(reads,0);
 const valid=await h(post({ticket}));assert.equal(valid.status,200);const data=await valid.json();assert.equal(data.entries[0].photos[0].url,'https://example.test/storage/v1/object/sign/wardrobe/owner/item/a.jpg?token=test');
 assert.equal((await h(post({ticket}))).status,401);assert.equal(reads,1);
});
test('first-account setup has a one-use gate and cannot add a second account',async()=>{
 let used=false,created=false;
 const h=await handler('wardrobe-setup',async(url,options)=>{
  if(url.includes('/wardrobe_access')&&options.method==='POST'){created=true;return ok({});}
  if(url.includes('/wardrobe_access'))return ok(created?[{user_id:OWNER}]:[]);
  if(url.includes('/wardrobe_setup_tokens')){if(used)return ok([]);used=true;return ok([{singleton:true}]);}
  if(url.includes('/admin/users'))return ok({id:OWNER});
  throw new Error('Unexpected endpoint');
 });
 const body={ticket:'b'.repeat(64),login:'artur',email:'owner@example.test',password:'long-test-password'};
 assert.equal((await h(post({...body,ticket:''}))).status,401);
 assert.equal((await h(post(body))).status,200);
 assert.equal((await h(post(body))).status,409);
});
