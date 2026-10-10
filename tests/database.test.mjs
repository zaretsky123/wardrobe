import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const OWNER='11111111-1111-4111-8111-111111111111';
const OTHER='22222222-2222-4222-8222-222222222222';
const ITEM='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OUTFIT='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REFERENCE='cccccccc-cccc-4ccc-8ccc-cccccccccccc';

test('database policies, transactional saving and outfit references',async t=>{
 const db=new PGlite();
 await db.exec(`
 create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema public,auth to anon,authenticated,service_role;
 grant execute on function auth.uid() to anon,authenticated,service_role;
 create schema storage;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;
 create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
 grant usage on schema storage to anon,authenticated,service_role;
 grant execute on function storage.foldername(text) to authenticated;
 grant select,insert,update,delete on storage.objects to authenticated;
 insert into auth.users values('${OWNER}'),('${OTHER}');
 `);
 await db.exec(await readFile(new URL('../supabase/schema.sql',import.meta.url),'utf8'));
 await db.query('insert into public.wardrobe_access(user_id,login,login_email) values($1,$2,$3)',[OWNER,'artur','owner@example.test']);
 const as=async(role,user,callback)=>db.transaction(async tx=>{await tx.exec(`set local role ${role}`);await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[user||'']);return callback(tx);});
 const save=(tx,e,photos=[],ids=[])=>tx.query('select public.save_wardrobe_entry($1::jsonb,$2::jsonb,$3::uuid[]) as result',[JSON.stringify({seasons:[],...e}),JSON.stringify(photos),ids]);

 await t.test('single owner is enforced; anonymous and other accounts have no access',async()=>{
   await assert.rejects(db.query('insert into wardrobe_access(user_id,login,login_email) values($1,$2,$3)',[OTHER,'other','other@example.test']),/duplicate/);
   await assert.rejects(as('anon',null,tx=>tx.query('select * from wardrobe_entries')),/permission denied/);
   const result=await as('authenticated',OTHER,tx=>tx.query('select id from wardrobe_entries'));assert.equal(result.rows.length,0);
   await assert.rejects(as('authenticated',OTHER,tx=>save(tx,{id:ITEM,kind:'item',title:'Не мой гардероб'})),/Access denied/);
   await assert.rejects(as('authenticated',OWNER,tx=>tx.query('select login_email from wardrobe_access')),/permission denied/);
 });
 await t.test('owner saves a garment and photo atomically; bad paths roll back edits',async()=>{
   const photo={id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',path:`${OWNER}/${ITEM}/dddddddd-dddd-4ddd-8ddd-dddddddddddd.jpg`,role:'На мне',caption:'Спереди'};
   const result=await as('authenticated',OWNER,tx=>save(tx,{id:ITEM,kind:'item',title:'Джинсы',category:'Джинсы'},[photo]));assert.equal(result.rows[0].result.id,ITEM);
   await assert.rejects(as('authenticated',OWNER,tx=>save(tx,{id:ITEM,kind:'item',title:'Испорчено'},[{...photo,path:`${OTHER}/${ITEM}/dddddddd-dddd-4ddd-8ddd-dddddddddddd.jpg`}])),/check constraint/);
   const row=await db.query('select title from wardrobe_entries where id=$1',[ITEM]);assert.equal(row.rows[0].title,'Джинсы');
   const photos=await db.query('select count(*)::int as count from wardrobe_photos where entry_id=$1',[ITEM]);assert.equal(photos.rows[0].count,1);
 });
 await t.test('tags persist independently, survive older clients and can be cleared',async()=>{
   await as('authenticated',OWNER,tx=>save(tx,{id:ITEM,kind:'item',title:'Джинсы',tags:['От отца','Тёмное','Любимое'],favorite:false}));
   let result=await as('authenticated',OWNER,tx=>tx.query('select tags,favorite from wardrobe_entries where id=$1',[ITEM]));
   assert.deepEqual(result.rows[0],{tags:['От отца','Тёмное','Любимое'],favorite:false});
   await as('authenticated',OWNER,tx=>tx.query('update wardrobe_entries set favorite=true where id=$1',[ITEM]));
   await as('authenticated',OWNER,tx=>save(tx,{id:ITEM,kind:'item',title:'Джинсы',favorite:true}));
   result=await as('authenticated',OWNER,tx=>tx.query('select tags from wardrobe_entries where id=$1',[ITEM]));
   assert.deepEqual(result.rows[0].tags,['От отца','Тёмное','Любимое']);
   await as('authenticated',OWNER,tx=>save(tx,{id:ITEM,kind:'item',title:'Джинсы',tags:[],favorite:true}));
   result=await as('authenticated',OWNER,tx=>tx.query('select tags,favorite from wardrobe_entries where id=$1',[ITEM]));
   assert.deepEqual(result.rows[0],{tags:[],favorite:true});
   await assert.rejects(as('authenticated',OWNER,tx=>tx.query('update wardrobe_entries set tags=array[null]::text[] where id=$1',[ITEM])),/check constraint/);
 });
 await t.test('outfits reference only real wardrobe items and reject empty selections',async()=>{
   await as('authenticated',OWNER,tx=>save(tx,{id:REFERENCE,kind:'inspiration',title:'Референс'}));
   await as('authenticated',OWNER,tx=>save(tx,{id:OUTFIT,kind:'outfit',title:'На вечер',inspiration_id:REFERENCE,tags:['Тёплый']},[],[ITEM]));
   const tags=await as('authenticated',OWNER,tx=>tx.query('select tags from wardrobe_entries where id=$1',[OUTFIT]));assert.deepEqual(tags.rows[0].tags,['Тёплый']);
   await assert.rejects(as('authenticated',OWNER,tx=>save(tx,{id:OUTFIT,kind:'outfit',title:'Ошибка'},[],[REFERENCE])),/only wardrobe items/);
   await assert.rejects(as('authenticated',OWNER,tx=>save(tx,{id:OUTFIT,kind:'outfit',title:'Ошибка'},[],[])),/at least one/);
   const row=await db.query('select title from wardrobe_entries where id=$1',[OUTFIT]);assert.equal(row.rows[0].title,'На вечер');
 });
 await t.test('trash preserves links and blocks permanent deletion of a used item',async()=>{
   await as('authenticated',OWNER,tx=>tx.query('update wardrobe_entries set deleted_at=now() where id=$1',[ITEM]));
   await assert.rejects(as('authenticated',OWNER,tx=>tx.query('select purge_wardrobe_entry($1)',[ITEM])),/Сначала убери/);
   await as('authenticated',OWNER,tx=>tx.query('update wardrobe_entries set deleted_at=null where id=$1',[ITEM]));
   const links=await db.query('select item_id from wardrobe_outfit_items where outfit_id=$1',[OUTFIT]);assert.equal(links.rows[0].item_id,ITEM);
 });
 await t.test('private storage checks owner path; tickets are unavailable to clients',async()=>{
   await assert.rejects(as('authenticated',OWNER,tx=>tx.query('select * from wardrobe_agent_tickets')),/permission denied/);
   await assert.rejects(as('authenticated',OWNER,tx=>tx.query('select * from wardrobe_setup_tokens')),/permission denied/);
   await as('authenticated',OWNER,tx=>tx.query('insert into storage.objects(bucket_id,name) values($1,$2)',['wardrobe',`${OWNER}/${ITEM}/a.jpg`]));
   await assert.rejects(as('authenticated',OWNER,tx=>tx.query('insert into storage.objects(bucket_id,name) values($1,$2)',['wardrobe',`${OTHER}/${ITEM}/a.jpg`])),/row-level security/);
   const result=await as('authenticated',OTHER,tx=>tx.query('select * from storage.objects'));assert.equal(result.rows.length,0);
   const bucket=await db.query('select public from storage.buckets where id=$1',['wardrobe']);assert.equal(bucket.rows[0].public,false);
 });
 await db.close();
});
