-- =============================================================
-- 企業価値診断を、3系統ぜんぶで見られるようにする
-- ---------------------------------------------------------------
--  これまでの診断は EBITDA×倍率 の一本でした。けれど EBITDA は
--  「評価手法」ではなく「指標」です。年買法もマルチプルも、EBITDA を
--  入力の一部として使う、別々の手法にすぎません。
--
--  評価の系統は三つしかありません。
--
--    コスト（純資産）  … いまの資産価値 … 時価純資産法
--    インカム（収益）  … 将来の稼ぐ力   … 収益還元法・DCF
--    マーケット（比較）… 他社との比較   … EBITDAマルチプル
--
--  中小の実務でいちばん使われるのは、この折衷である**年買法**
--  （時価純資産＋実質利益×年数）です。社長に説明しやすい代わりに、
--  「なぜ3年なのか」に理屈で答えられません。だから一本だけ出すのは
--  やめて、**並べて見せます。**
--
--  ■ 同じ会社に、値段は少なくとも三つ付く
--    ① 相続税評価額  … 親族に渡すときの税額を決める
--    ② M&A実勢価格   … 外に出すときの値段
--    ③ 簿価純資産    … 決算書に書いてある数字
--
--    中小企業では ① と ② が3倍以上ひらくことが珍しくありません。
--    不動産や含み益のある保険を持つ会社では、とくにそうです。
--    社長はこの差を知りません。決算書しか見ていないからです。
--
--  ■ けれど、①の金額はこの画面では出しません
--    相続税評価額を具体的に算定して示すのは、税理士法52条の
--    税務相談にあたるおそれがあります。無償でも同じです。
--    ですからこの画面が出すのは、②と③、そして時価純資産まで。
--    ①については「差が大きいので顧問税理士に確かめましょう」と
--    **問いを立てる側に回ります。** そのほうが価値もあります。
--    社長がご自分の税理士に聞きに行き、差の大きさに驚いて戻ってくる。
--
--  ■ 表は増やさず、いまの診断履歴に列を足す
--    月ごとの推移を一本の表で追えているのが、この機能の値打ちです。
--    別の表に分けると、どちらが最新か分からなくなります。
--
--  確かめかた：足した列=17、診断の表=1、これまでの列=1
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           何度流しても同じ結果になります。
-- =============================================================

-- ---------------------------------------------------------------
-- ① 時価純資産をつくるための、含み損益と調整
-- ---------------------------------------------------------------
alter table public.valuation_snapshots
  add column if not exists bs_net_assets  integer,
  add column if not exists adj_estate     integer,
  add column if not exists adj_insurance  integer,
  add column if not exists adj_securities integer,
  add column if not exists adj_retire     integer,
  add column if not exists adj_other      integer;

comment on column public.valuation_snapshots.bs_net_assets  is '簿価純資産（決算書の数字）';
comment on column public.valuation_snapshots.adj_estate     is '不動産の含み損益。＋で含み益';
comment on column public.valuation_snapshots.adj_insurance  is '保険の含み損益（解約返戻金 − 資産計上額）';
comment on column public.valuation_snapshots.adj_securities is '有価証券の含み損益';
comment on column public.valuation_snapshots.adj_retire     is
  '未計上の退職給付債務など。正の数で入れて、時価純資産から差し引きます';
comment on column public.valuation_snapshots.adj_other      is 'その他の調整。＋で加算';

-- ---------------------------------------------------------------
-- ② 手法ごとの前提
-- ---------------------------------------------------------------
--  実質営業利益は、役員報酬の適正化・一時的な損益の除外をしたあとの
--  「ふだんの稼ぐ力」。年買法と収益還元法はこちらを使います。
--  営業利益をそのまま使うと、社長の報酬の取り方だけで会社の値段が
--  変わってしまいます
alter table public.valuation_snapshots
  add column if not exists real_op_profit integer,
  add column if not exists nenbai_years   numeric(4,1),
  add column if not exists cap_rate       numeric(5,2),
  add column if not exists close_cost     integer;

comment on column public.valuation_snapshots.real_op_profit is
  '実質営業利益（役員報酬の適正化・一時損益の除外後）。年買法と収益還元法で使います';
comment on column public.valuation_snapshots.nenbai_years is '年買法の年数（実務では2〜5年）';
comment on column public.valuation_snapshots.cap_rate     is '収益還元法の資本還元率（％）';
comment on column public.valuation_snapshots.close_cost   is '清算コスト（退職金・原状回復・在庫処分など）';

-- ---------------------------------------------------------------
-- ③ 手法ごとの結果
-- ---------------------------------------------------------------
--  そのときの前提で出した値を残します。あとで倍率の相場が変わっても、
--  「あのとき何をどう見たか」が読み返せるように
alter table public.valuation_snapshots
  add column if not exists val_net_asset integer,
  add column if not exists val_nenbai    integer,
  add column if not exists val_multiple  integer,
  add column if not exists val_income    integer,
  add column if not exists val_close     integer;

-- ---------------------------------------------------------------
-- ④ どんな承継を考えているか、と打ち手
-- ---------------------------------------------------------------
--  同じ会社でも、誰に渡すかで「見るべき値段」が変わります。
--  親族なら時価純資産、外に出すなら年買法とマルチプル、
--  従業員なら買い手の資金調達力が天井になります
alter table public.valuation_snapshots
  add column if not exists succession_kind text,
  add column if not exists actions         jsonb;

do $do$ begin
  if not exists (select 1 from pg_constraint
                  where conrelid='public.valuation_snapshots'::regclass
                    and conname='valuation_succession_kind_check') then
    alter table public.valuation_snapshots
      add constraint valuation_succession_kind_check
      check (succession_kind is null
             or succession_kind in ('family','employee','ma','close','undecided'));
  end if;
end $do$;

comment on column public.valuation_snapshots.succession_kind is
  'family＝親族内／employee＝従業員（MBO）／ma＝第三者（M&A）／close＝廃業・清算／undecided＝未定';
comment on column public.valuation_snapshots.actions is
  '選んだ打ち手（[{id,amount,when}]）。マイルストーンの組み立てに使います';

-- ---------------------------------------------------------------
-- ⑤ 確かめ
-- ---------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='valuation_snapshots'
      and column_name in ('bs_net_assets','adj_estate','adj_insurance','adj_securities',
                          'adj_retire','adj_other','real_op_profit','nenbai_years',
                          'cap_rate','close_cost','val_net_asset','val_nenbai',
                          'val_multiple','val_income','val_close','succession_kind','actions'))
                                                                as "足した列",
  (select count(*) from information_schema.tables
    where table_schema='public' and table_name='valuation_snapshots') as "診断の表",
  --  これまでの列を消していないこと。消すと過去の診断が読めなくなる
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='valuation_snapshots'
      and column_name='equity_value')                            as "これまでの列";
--  期待値：足した列=17、診断の表=1、これまでの列=1
-- =============================================================
