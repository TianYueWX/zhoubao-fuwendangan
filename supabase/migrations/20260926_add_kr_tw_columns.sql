-- ================================================================
-- 官网卡表同步：cards_base 增加韩文/繁中文本列
--
-- 背景：playriftbound.com 官方卡表接口实测只有 en_US / zh_CN / ko_KR /
-- zh_TW 有卡牌级本地化；其中韩文、繁中的文本（名字/副标题/效果）在库内
-- 没有对应列，无法落库。本迁移补上这 6 列。
--
-- 说明：
--   * 全部可空；不迁移期间官网面板会自动降级为只同步卡图。
--   * effect_kr / effect_tw 存与 effect_cn 相同的「纯文本 + {{标记}}」约定
--     （官网的 :rb_*: 与 [关键词] 已由同步流程转换）。
--   * 官网没有韩/繁中副标题时 sub_title_* 留空，可在卡牌编辑器手填。
--
-- 执行方式：Supabase SQL Editor 或 psql 直接运行一次即可（幂等）。
-- ================================================================

alter table public.cards_base
  add column if not exists card_name_kr text,
  add column if not exists sub_title_kr text,
  add column if not exists effect_kr    text,
  add column if not exists card_name_tw text,
  add column if not exists sub_title_tw text,
  add column if not exists effect_tw    text;

comment on column public.cards_base.card_name_kr is '官网韩文卡名（playriftbound.com ko-kr）';
comment on column public.cards_base.sub_title_kr is '官网韩文副标题（官网缺失时手填）';
comment on column public.cards_base.effect_kr is '官网韩文效果文本（纯文本 + {{标记}}）';
comment on column public.cards_base.card_name_tw is '官网繁中卡名（playriftbound.com zh-tw）';
comment on column public.cards_base.sub_title_tw is '官网繁中副标题（官网缺失时手填）';
comment on column public.cards_base.effect_tw is '官网繁中效果文本（纯文本 + {{标记}}）';
