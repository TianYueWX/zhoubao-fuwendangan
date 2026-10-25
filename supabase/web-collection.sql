-- 网页端「我的卡池」：管理员私有的持有卡台账，按「印本号 + 语言」逐张记账。
-- 与桌面项目的卡库独立。在 Supabase SQL Editor 执行；可重复执行，不清空已有卡池。
-- 本脚本只建表、索引和行级安全策略，不创建任何函数与触发器；
-- updated_at 由前端写入时自带，插入时省略则取 now()。
begin;

create table if not exists public.web_collection (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  -- 印本号原样保存 card_prints.card_no_extend，例如 OGN-001 / OGN-001S / VEN-136a / UNL-233*
  card_no text not null check (card_no ~ '^[A-Za-z0-9][A-Za-z0-9*-]*$' and char_length(card_no) between 3 and 32),
  -- 语言代码，目前只有 SC / EN
  language text not null check (language ~ '^[A-Z]{2,4}$'),
  -- 持有张数；0 张由前端删行，不在库里留 quantity = 0 的记录
  quantity integer not null check (quantity between 1 and 999),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 一个账号 + 一个印版 + 一种语言只允许一行：前端 upsert 的冲突目标
create unique index if not exists web_collection_owner_print_uidx
  on public.web_collection (owner_id, card_no, language);
-- 列表分页：updated_at 可能重复，末尾缀主键，避免翻页静默丢行
create index if not exists web_collection_owner_updated_idx
  on public.web_collection (owner_id, updated_at desc, id);

alter table public.web_collection enable row level security;
revoke all on public.web_collection from public, anon, authenticated;
grant select, insert, update, delete on public.web_collection to authenticated;

drop policy if exists "web_collection owner read" on public.web_collection;
create policy "web_collection owner read" on public.web_collection for select to authenticated
using (owner_id = (select auth.uid()) and (select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin');
drop policy if exists "web_collection owner insert" on public.web_collection;
create policy "web_collection owner insert" on public.web_collection for insert to authenticated
with check (owner_id = (select auth.uid()) and (select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin');
drop policy if exists "web_collection owner update" on public.web_collection;
create policy "web_collection owner update" on public.web_collection for update to authenticated
using (owner_id = (select auth.uid()) and (select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin')
with check (owner_id = (select auth.uid()) and (select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin');
drop policy if exists "web_collection owner delete" on public.web_collection;
create policy "web_collection owner delete" on public.web_collection for delete to authenticated
using (owner_id = (select auth.uid()) and (select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin');

comment on table public.web_collection is '管理员私有的持有卡台账：按印本号与语言逐张记账，quantity 为持有张数（1–999，0 张即删行）。';
comment on column public.web_collection.card_no is '印本号，取自 card_prints.card_no_extend，原样保存（区分大小写与 * 后缀）。';
comment on column public.web_collection.language is '印本语言：SC 简中 / EN 英文。';
comment on column public.web_collection.quantity is '持有张数，1–999；减到 0 时前端删除整行。';

commit;

-- 回滚（确认不再需要时手动执行）：
-- drop table if exists public.web_collection;
