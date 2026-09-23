-- ================================================================
-- 卡牌常见问题（QA）列表
--
-- 数据源：POST /cardCommonQa/getCardCommonQaList（符文战场玩家端小程序）
--   { pageNum, pageSize, searchContent } -> { code, message, result: [
--       { id, code, sort, cardNo[], cardName[], question, answer } ] }
--
-- 真实样例（2026-09-23 抓取，未带 token）：
--   cardNo 形如 "OGN·021/298"、"UNL-074/219"、令牌 "UNL-T06"
--   前端同步前需归一化为 cards_base.card_no（OGN·021/298 -> OGN-021），否则 FK 插入失败
--
-- 归一化、视图还原与 updated_at 维护由前端同步逻辑处理。
-- ================================================================

begin;

-- 问答主表
create table public.qa_entries (
  id          uuid primary key default gen_random_uuid(),
  source      text not null default 'xcx',
  source_id   text unique,
  question    text not null,
  question_en text,
  answer      text not null,
  answer_en   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table  public.qa_entries is '卡牌常见问题（QA）；数据源 POST /cardCommonQa/getCardCommonQaList';
comment on column public.qa_entries.source is '数据来源渠道：xcx=玩家端小程序、manual=后台手录、import=批量导入等';
comment on column public.qa_entries.source_id is '上游小程序问答 id，用于幂等导入；本地主键为 id';
comment on column public.qa_entries.question is '原样存储，含 Q： 前缀';
comment on column public.qa_entries.answer is '原样存储，含 A： 前缀，可能含换行';

-- 问答↔卡牌 多对多（真实 FK，指向 cards_base.card_no）
create table public.qa_entry_cards (
  qa_id    uuid not null references public.qa_entries(id) on delete cascade,
  card_no  text not null references public.cards_base(card_no) on update cascade on delete restrict,
  position integer not null default 0 check (position >= 0),
  primary key (qa_id, card_no)
);

-- 主键只能加速 qa_id 开头的查询；反查某张卡的 QA 需要单独索引。
create index qa_entry_cards_card_no_idx on public.qa_entry_cards (card_no);

comment on table  public.qa_entry_cards is '问答与卡牌的多对多关联；card_no 为归一化后的 cards_base.card_no';
comment on column public.qa_entry_cards.position is '与接口 cardNo 数组同序，用于还原展示顺序';

-- RLS：公开只读，写入限管理员（与 cards_base / card_prints 一致）
alter table public.qa_entries     enable row level security;
alter table public.qa_entry_cards enable row level security;

-- Data API 权限与 RLS 是两层独立门禁。新建表显式授权，不依赖项目的默认权限配置。
revoke all on table public.qa_entries from anon, authenticated;
revoke all on table public.qa_entry_cards from anon, authenticated;
grant select on table public.qa_entries, public.qa_entry_cards to anon, authenticated;
grant insert, update, delete on table public.qa_entries, public.qa_entry_cards to authenticated;

create policy "qa_entries public read"
  on public.qa_entries for select to anon, authenticated using (true);
create policy "admin insert qa_entries"
  on public.qa_entries for insert to authenticated with check (public.is_card_admin());
create policy "admin update qa_entries"
  on public.qa_entries for update to authenticated
  using (public.is_card_admin()) with check (public.is_card_admin());
create policy "admin delete qa_entries"
  on public.qa_entries for delete to authenticated using (public.is_card_admin());

create policy "qa_entry_cards public read"
  on public.qa_entry_cards for select to anon, authenticated using (true);
create policy "admin insert qa_entry_cards"
  on public.qa_entry_cards for insert to authenticated with check (public.is_card_admin());
create policy "admin update qa_entry_cards"
  on public.qa_entry_cards for update to authenticated
  using (public.is_card_admin()) with check (public.is_card_admin());
create policy "admin delete qa_entry_cards"
  on public.qa_entry_cards for delete to authenticated using (public.is_card_admin());

-- QA 发布与其他内容一样通过 version.updated_at 通知客户端刷新。
insert into public.version (name, updated_at)
values ('qa', now())
on conflict (name) do nothing;

commit;
