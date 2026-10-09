begin;

-- Only the owner account is allowed. Clients cannot enroll themselves.
create table public.wardrobe_access (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  login text not null unique check (length(login) between 1 and 120),
  login_email text not null
);
alter table public.wardrobe_access enable row level security;
revoke all on public.wardrobe_access from public, anon, authenticated;
grant select (user_id) on public.wardrobe_access to authenticated;
grant all on public.wardrobe_access to service_role;
create policy owner_access on public.wardrobe_access for select to authenticated
  using (user_id = (select auth.uid()));

create table public.wardrobe_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('item','inspiration','outfit','wishlist')),
  title text not null check (length(trim(title)) between 1 and 160),
  category text check (length(category)<=100),
  color text check (length(color)<=80),
  brand text check (length(brand)<=100),
  size text check (length(size)<=40),
  fit text check (length(fit)<=100),
  seasons text[] not null default '{}' check (seasons <@ array['Весна','Лето','Осень','Зима']),
  source_url text check (source_url is null or (length(source_url)<=2048 and source_url ~ '^https?://')),
  note text not null default '' check (length(note)<=5000),
  price numeric(12,2) check (price>=0),
  favorite boolean not null default false,
  inspiration_id uuid,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id,user_id),
  constraint wardrobe_entries_inspiration_fk foreign key (inspiration_id,user_id) references public.wardrobe_entries(id,user_id)
    on delete set null (inspiration_id)
);
create index wardrobe_entries_user_kind_idx on public.wardrobe_entries(user_id,kind,created_at desc);
create index wardrobe_entries_inspiration_idx on public.wardrobe_entries(inspiration_id,user_id) where inspiration_id is not null;
alter table public.wardrobe_entries enable row level security;
revoke all on public.wardrobe_entries from public,anon,authenticated;
grant select,insert,update,delete on public.wardrobe_entries to authenticated;
grant all on public.wardrobe_entries to service_role;
create policy owner_entries on public.wardrobe_entries for all to authenticated
  using (user_id = (select auth.uid()) and exists (select 1 from public.wardrobe_access where user_id=(select auth.uid())))
  with check (user_id = (select auth.uid()) and exists (select 1 from public.wardrobe_access where user_id=(select auth.uid())));

create table public.wardrobe_photos (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  path text not null unique,
  role text not null default 'Отдельно' check (role in ('С сайта','Отдельно','На мне','Деталь','Образ')),
  caption text not null default '' check (length(caption)<=300),
  position integer not null default 0 check (position between 0 and 19),
  created_at timestamptz not null default now(),
  constraint wardrobe_photos_entry_fk foreign key (entry_id,user_id) references public.wardrobe_entries(id,user_id) on delete cascade,
  check (path ~ ('^' || user_id::text || '/' || entry_id::text || '/[0-9a-f-]+\.(jpg|jpeg|png|webp|avif)$'))
);
create index wardrobe_photos_entry_idx on public.wardrobe_photos(entry_id,user_id,position);
create index wardrobe_photos_owner_idx on public.wardrobe_photos(user_id);
alter table public.wardrobe_photos enable row level security;
revoke all on public.wardrobe_photos from public,anon,authenticated;
grant select,insert,update,delete on public.wardrobe_photos to authenticated;
grant all on public.wardrobe_photos to service_role;
create policy owner_photos on public.wardrobe_photos for all to authenticated
  using (user_id = (select auth.uid()) and exists (select 1 from public.wardrobe_access where user_id=(select auth.uid())))
  with check (user_id = (select auth.uid()) and exists (select 1 from public.wardrobe_access where user_id=(select auth.uid())));

create table public.wardrobe_outfit_items (
  outfit_id uuid not null,
  item_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  position integer not null default 0 check (position>=0),
  primary key (outfit_id,item_id),
  constraint wardrobe_outfit_items_outfit_fk foreign key (outfit_id,user_id) references public.wardrobe_entries(id,user_id) on delete cascade,
  constraint wardrobe_outfit_items_item_fk foreign key (item_id,user_id) references public.wardrobe_entries(id,user_id) on delete restrict,
  check (outfit_id<>item_id)
);
create index wardrobe_outfit_items_item_idx on public.wardrobe_outfit_items(item_id,user_id);
create index wardrobe_outfit_items_owner_idx on public.wardrobe_outfit_items(user_id);
create index wardrobe_outfit_items_outfit_owner_idx on public.wardrobe_outfit_items(outfit_id,user_id);
alter table public.wardrobe_outfit_items enable row level security;
revoke all on public.wardrobe_outfit_items from public,anon,authenticated;
grant select,insert,update,delete on public.wardrobe_outfit_items to authenticated;
grant all on public.wardrobe_outfit_items to service_role;
create policy owner_outfit_items on public.wardrobe_outfit_items for all to authenticated
  using (user_id=(select auth.uid()) and exists (select 1 from public.wardrobe_access where user_id=(select auth.uid())))
  with check (user_id=(select auth.uid()) and exists (select 1 from public.wardrobe_access where user_id=(select auth.uid())));

create or replace function public.wardrobe_link_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (select 1 from public.wardrobe_entries where id=new.outfit_id and user_id=new.user_id and kind='outfit')
    or not exists (select 1 from public.wardrobe_entries where id=new.item_id and user_id=new.user_id and kind='item') then
    raise exception 'An outfit can reference only wardrobe items';
  end if;
  return new;
end $$;
revoke all on function public.wardrobe_link_guard() from public,anon,authenticated;
create trigger wardrobe_link_guard before insert or update on public.wardrobe_outfit_items
  for each row execute function public.wardrobe_link_guard();

create or replace function public.wardrobe_touch_entry() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if old.kind<>new.kind and (
    exists(select 1 from public.wardrobe_outfit_items where item_id=old.id) or
    exists(select 1 from public.wardrobe_outfit_items where outfit_id=old.id) or
    exists(select 1 from public.wardrobe_entries where inspiration_id=old.id)
  ) then raise exception 'Нельзя менять тип карточки, которая используется в образах.'; end if;
  new.updated_at = now(); return new;
end $$;
revoke all on function public.wardrobe_touch_entry() from public,anon,authenticated;
create trigger wardrobe_touch_entry before update on public.wardrobe_entries for each row execute function public.wardrobe_touch_entry();

-- A single transaction saves a card, its ordered photo metadata and outfit links.
create or replace function public.save_wardrobe_entry(p_entry jsonb,p_photos jsonb,p_item_ids uuid[] default '{}') returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_owner uuid := auth.uid();
  v_id uuid := (p_entry->>'id')::uuid;
  v_removed text[];
  p jsonb;
  v_position integer := 0;
  v_item uuid;
begin
  if v_owner is null or not exists (select 1 from public.wardrobe_access where user_id=v_owner) then raise exception 'Access denied'; end if;
  if jsonb_typeof(p_photos)<>'array' or jsonb_array_length(p_photos)>20 then raise exception 'Invalid photo list'; end if;
  if p_entry->>'kind'='outfit' and coalesce(array_length(p_item_ids,1),0)=0 then raise exception 'Choose at least one item'; end if;
  if p_entry->>'kind'<>'outfit' and coalesce(array_length(p_item_ids,1),0)>0 then raise exception 'Only outfits can have items'; end if;
  if exists (select 1 from public.wardrobe_entries where id=v_id and user_id<>v_owner) then raise exception 'Access denied'; end if;
  if nullif(p_entry->>'inspiration_id','') is not null and not exists (
    select 1 from public.wardrobe_entries where id=(p_entry->>'inspiration_id')::uuid and user_id=v_owner and kind='inspiration'
  ) then raise exception 'Invalid inspiration'; end if;
  insert into public.wardrobe_entries(id,user_id,kind,title,category,color,brand,size,fit,seasons,source_url,note,price,favorite,inspiration_id)
  values (v_id,v_owner,p_entry->>'kind',trim(p_entry->>'title'),nullif(p_entry->>'category',''),nullif(p_entry->>'color',''),
    nullif(p_entry->>'brand',''),nullif(p_entry->>'size',''),nullif(p_entry->>'fit',''),
    array(select jsonb_array_elements_text(coalesce(p_entry->'seasons','[]'::jsonb))),nullif(p_entry->>'source_url',''),
    coalesce(p_entry->>'note',''),nullif(p_entry->>'price','')::numeric,coalesce((p_entry->>'favorite')::boolean,false),nullif(p_entry->>'inspiration_id','')::uuid)
  on conflict(id) do update set kind=excluded.kind,title=excluded.title,category=excluded.category,color=excluded.color,brand=excluded.brand,
    size=excluded.size,fit=excluded.fit,seasons=excluded.seasons,source_url=excluded.source_url,note=excluded.note,price=excluded.price,
    favorite=excluded.favorite,inspiration_id=excluded.inspiration_id;

  select coalesce(array_agg(path),'{}') into v_removed from public.wardrobe_photos
    where entry_id=v_id and user_id=v_owner and path not in (select value->>'path' from jsonb_array_elements(p_photos));
  delete from public.wardrobe_photos where entry_id=v_id and user_id=v_owner;
  for p in select value from jsonb_array_elements(p_photos) loop
    insert into public.wardrobe_photos(id,entry_id,user_id,path,role,caption,position)
      values ((p->>'id')::uuid,v_id,v_owner,p->>'path',coalesce(p->>'role','Отдельно'),coalesce(p->>'caption',''),v_position);
    v_position:=v_position+1;
  end loop;
  delete from public.wardrobe_outfit_items where outfit_id=v_id and user_id=v_owner;
  v_position:=0;
  foreach v_item in array coalesce(p_item_ids,'{}'::uuid[]) loop
    insert into public.wardrobe_outfit_items(outfit_id,item_id,user_id,position) values (v_id,v_item,v_owner,v_position);
    v_position:=v_position+1;
  end loop;
  return jsonb_build_object('id',v_id,'removed_paths',v_removed);
end $$;
revoke all on function public.save_wardrobe_entry(jsonb,jsonb,uuid[]) from public,anon;
grant execute on function public.save_wardrobe_entry(jsonb,jsonb,uuid[]) to authenticated;

create or replace function public.purge_wardrobe_entry(p_id uuid) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (select 1 from public.wardrobe_entries where id=p_id and user_id=auth.uid() and deleted_at is not null) then
    raise exception 'Only your trashed cards can be permanently deleted';
  end if;
  if exists (select 1 from public.wardrobe_outfit_items where item_id=p_id) then
    raise exception 'Сначала убери вещь из образов, в которых она используется.';
  end if;
  delete from public.wardrobe_entries where id=p_id and user_id=auth.uid();
end $$;
revoke all on function public.purge_wardrobe_entry(uuid) from public,anon;
grant execute on function public.purge_wardrobe_entry(uuid) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('wardrobe','wardrobe',false,10485760,array['image/jpeg','image/png','image/webp','image/avif'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy wardrobe_storage_owner on storage.objects for all to authenticated
  using (bucket_id='wardrobe' and (storage.foldername(name))[1]=(select auth.uid())::text and exists(select 1 from public.wardrobe_access where user_id=(select auth.uid())))
  with check (bucket_id='wardrobe' and (storage.foldername(name))[1]=(select auth.uid())::text and exists(select 1 from public.wardrobe_access where user_id=(select auth.uid())));

-- Agents with authorized database access mint a short-lived, one-use photo ticket.
-- Only the hash is stored. Browser clients cannot read, create or consume tickets.
create table public.wardrobe_agent_tickets (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null check (expires_at <= now() + interval '10 minutes'),
  created_at timestamptz not null default now()
);
alter table public.wardrobe_agent_tickets enable row level security;
revoke all on public.wardrobe_agent_tickets from public,anon,authenticated;
grant select,insert,delete on public.wardrobe_agent_tickets to service_role;
create index wardrobe_agent_tickets_expiry_idx on public.wardrobe_agent_tickets(expires_at);
create index wardrobe_agent_tickets_owner_idx on public.wardrobe_agent_tickets(user_id);

create table public.wardrobe_setup_tokens (
  singleton boolean primary key default true check (singleton),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.wardrobe_setup_tokens enable row level security;
revoke all on public.wardrobe_setup_tokens from public,anon,authenticated;
grant select,insert,update,delete on public.wardrobe_setup_tokens to service_role;

-- The dashboard's optional automatic-RLS event trigger is internal, not an API.
do $$ begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;

commit;
