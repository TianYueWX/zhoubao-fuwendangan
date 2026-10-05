-- 网页构筑工具的管理员私有卡组库。与桌面项目卡组表独立。
-- 在 Supabase SQL Editor 执行；可重复执行，不清空卡组。
begin;
create table if not exists public.web_decks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  document jsonb not null check (jsonb_typeof(document) = 'object' and document ->> 'formatVersion' = '1'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists web_decks_owner_updated_idx on public.web_decks (owner_id, updated_at desc, id);
alter table public.web_decks enable row level security;
revoke all on public.web_decks from public, anon, authenticated;
grant select, insert, update, delete on public.web_decks to authenticated;

drop policy if exists "web_decks owner read" on public.web_decks;
create policy "web_decks owner read" on public.web_decks for select to authenticated
using (owner_id = (select auth.uid()) and (select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin');
drop policy if exists "web_decks owner insert" on public.web_decks;
create policy "web_decks owner insert" on public.web_decks for insert to authenticated
with check (owner_id = (select auth.uid()) and (select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin');
drop policy if exists "web_decks owner update" on public.web_decks;
create policy "web_decks owner update" on public.web_decks for update to authenticated
using (owner_id = (select auth.uid()) and (select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin')
with check (owner_id = (select auth.uid()) and (select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin');
drop policy if exists "web_decks owner delete" on public.web_decks;
create policy "web_decks owner delete" on public.web_decks for delete to authenticated
using (owner_id = (select auth.uid()) and (select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin');

create or replace function public.web_decks_touch_updated_at()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;
revoke execute on function public.web_decks_touch_updated_at() from public, anon, authenticated;
drop trigger if exists web_decks_updated_at on public.web_decks;
create trigger web_decks_updated_at before update on public.web_decks
for each row execute function public.web_decks_touch_updated_at();
commit;
