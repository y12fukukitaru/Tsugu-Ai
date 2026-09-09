-- =============================================================
-- 口座を「預かる」形にしたあとの試験
-- =============================================================
set client_min_messages = warning;

create table if not exists public.__t (n text, ok boolean, got text, want text);
truncate public.__t;
create or replace function public.chk(n text, got text, want text) returns void
  language sql as $$ insert into public.__t values (n, got is not distinct from want, got, want) $$;

insert into auth.users values
  ('00000000-0000-0000-0000-00000000a101','admin@x.jp'),
  ('00000000-0000-0000-0000-00000000b101','p1@x.jp'),
  ('00000000-0000-0000-0000-00000000b202','p2@x.jp'),
  ('00000000-0000-0000-0000-00000000c101','mgr@x.jp'),
  ('00000000-0000-0000-0000-00000000d101','staff@x.jp');
insert into public.profiles (id, role, email, full_name) values
  ('00000000-0000-0000-0000-00000000a101','admin','admin@x.jp','運営'),
  ('00000000-0000-0000-0000-00000000b101','consultant','p1@x.jp','山田 太郎'),
  ('00000000-0000-0000-0000-00000000b202','consultant','p2@x.jp','鈴木 花子'),
  ('00000000-0000-0000-0000-00000000c101','consultant','mgr@x.jp','法人の管理者'),
  ('00000000-0000-0000-0000-00000000d101','consultant','staff@x.jp','法人の担当者');
insert into public.ep_orgs values
  ('00000000-0000-0000-0000-00000000e101','継パートナーズ株式会社','EP1');
insert into public.ep_members values
  ('00000000-0000-0000-0000-00000000e101','00000000-0000-0000-0000-00000000c101','manager','active'),
  ('00000000-0000-0000-0000-00000000e101','00000000-0000-0000-0000-00000000d101','staff','active');

-- =============================================================
-- ① 登録すると、平文はどこにも残らない
-- =============================================================
select public.be('00000000-0000-0000-0000-00000000b101');
select public.chk('登録できる',
  public.payout_account_submit('三井住友銀行','0009','本店営業部','001','futsu','1234567','ヤマダ タロウ'),
  'ok');
--  ★ここが預かる設計のいちばんの前提。平文の列に一文字も入らないこと
select public.chk('平文の口座番号は残っていない',
  (select coalesce(account_no,'（空）') from public.payout_accounts
    where user_id='00000000-0000-0000-0000-00000000b101'), '（空）');
select public.chk('平文の名義も残っていない',
  (select coalesce(holder_kana,'（空）') from public.payout_accounts
    where user_id='00000000-0000-0000-0000-00000000b101'), '（空）');
select public.chk('平文の支店も残っていない',
  (select coalesce(branch_name,'（空）') from public.payout_accounts
    where user_id='00000000-0000-0000-0000-00000000b101'), '（空）');
select public.chk('暗号文が入っている',
  (select (account_enc is not null)::text from public.payout_accounts
    where user_id='00000000-0000-0000-0000-00000000b101'), 'true');
--  暗号文の中に、口座番号がそのまま見えていないこと
select public.chk('暗号文に口座番号が透けていない',
  (select (position('1234567' in encode(account_enc,'escape')) > 0)::text
     from public.payout_accounts where user_id='00000000-0000-0000-0000-00000000b101'), 'false');
select public.chk('下4桁は控えとして残る',
  (select last4 from public.payout_accounts
    where user_id='00000000-0000-0000-0000-00000000b101'), '4567');

-- =============================================================
-- ② 形の確認は、これまでどおり効いている
-- =============================================================
select public.chk('桁が足りないと止まる',
  public.payout_account_submit('三井住友銀行','0009','本店','001','futsu','12','ヤマダ'),
  'error: 口座番号は数字4〜8桁です（多くの銀行は7桁）');
select public.chk('漢字の名義は止まる',
  public.payout_account_submit('三井住友銀行','0009','本店','001','futsu','1234567','山田太郎'),
  'error: 口座名義はカタカナ・英数字でご入力ください（漢字・ひらがなは通りません）');
select public.chk('銀行名は必須',
  public.payout_account_submit('','0009','本店','001','futsu','1234567','ヤマダ'),
  'error: 銀行名をご入力ください');

-- =============================================================
-- ③ EP-I の担当者は、これまでどおり止める
-- =============================================================
select public.be('00000000-0000-0000-0000-00000000d101');
select public.chk('EP-Iの担当者は登録できない',
  public.payout_account_submit('三菱UFJ銀行','0005','本店','001','futsu','7654321','ホウジン タントウ'),
  'error: EP-I のお支払いは法人口座へまとめます。口座のご登録は、法人の管理者にお願いしてください');
select public.be('00000000-0000-0000-0000-00000000c101');
select public.chk('EP-Iの管理者は登録できる',
  public.payout_account_submit('三菱UFJ銀行','0005','丸の内支店','101','touza','7654321','カ）ツグパートナーズ'),
  'ok');
select public.chk('法人の口座として入る',
  (select (ep_id is not null)::text from public.payout_accounts
    where user_id='00000000-0000-0000-0000-00000000c101'), 'true');

-- =============================================================
-- ④ 運営が開くと、復号できて、記録が残る
-- =============================================================
select public.be('00000000-0000-0000-0000-00000000a101');
select public.chk('復号できる（口座番号）',
  (select account_no from public.payout_account_reveal('00000000-0000-0000-0000-00000000b101')),
  '1234567');
select public.chk('復号できる（名義）',
  (select holder_kana from public.payout_account_reveal('00000000-0000-0000-0000-00000000b101')),
  'ヤマダ タロウ');
select public.chk('復号できる（支店）',
  (select branch_name from public.payout_account_reveal('00000000-0000-0000-0000-00000000b101')),
  '本店営業部');
select public.chk('開いた記録が残る',
  (select count(*)::text from public.payout_account_reads
    where target_user='00000000-0000-0000-0000-00000000b101' and purpose='screen'), '3');

-- =============================================================
-- ⑤ 「確認しました」を押しても、もう消えない
-- =============================================================
--  以前はここで口座番号が消えていた。消えると翌月に振り込めない
select public.chk('確認できる',
  public.payout_account_collect('00000000-0000-0000-0000-00000000b101'), 'ok');
select public.chk('確認しても暗号文は残る',
  (select (account_enc is not null)::text from public.payout_accounts
    where user_id='00000000-0000-0000-0000-00000000b101'), 'true');
select public.chk('状態は登録済みになる',
  (select status from public.payout_accounts
    where user_id='00000000-0000-0000-0000-00000000b101'), 'registered');
select public.chk('確認したあとも復号できる',
  (select account_no from public.payout_account_reveal('00000000-0000-0000-0000-00000000b101')),
  '1234567');

-- =============================================================
-- ⑥ 振込のための取り出し
-- =============================================================
select public.chk('確認済みの口座は取り出せる',
  (select account_no from public.payout_account_for_transfer(
    array['00000000-0000-0000-0000-00000000b101']::uuid[])), '1234567');
--  ★確認前の口座に振り込んではいけない。変更の途中かもしれない
select public.chk('確認前の口座は取り出せない',
  (select count(*)::text from public.payout_account_for_transfer(
    array['00000000-0000-0000-0000-00000000c101']::uuid[])), '0');
select public.chk('取り出した記録も残る',
  (select count(*)::text from public.payout_account_reads
    where target_user='00000000-0000-0000-0000-00000000b101' and purpose='transfer'), '1');
--  取り出せなかった相手も記録する。読もうとしたこと自体が記録に値する
select public.chk('取り出せなくても記録は残る',
  (select count(*)::text from public.payout_account_reads
    where target_user='00000000-0000-0000-0000-00000000c101' and purpose='transfer'), '1');
--  ブラウザから呼べないこと（authenticated に実行権が無いこと）
select public.chk('取り出しはブラウザから呼べない',
  (select has_function_privilege('authenticated',
    'public.payout_account_for_transfer(uuid[])','execute'))::text, 'false');

-- =============================================================
-- ⑦ 口座を変えると、確認からやり直しになる
-- =============================================================
select public.be('00000000-0000-0000-0000-00000000b101');
select public.chk('口座を変えられる',
  public.payout_account_submit('ゆうちょ銀行','9900','〇一八支店','018','futsu','98765432','ヤマダ タロウ'),
  'ok');
select public.chk('確認待ちに戻る',
  (select status from public.payout_accounts
    where user_id='00000000-0000-0000-0000-00000000b101'), 'pending');
select public.be('00000000-0000-0000-0000-00000000a101');
--  ★古い口座へ振り込んでしまわないこと
select public.chk('変更中は取り出せない',
  (select count(*)::text from public.payout_account_for_transfer(
    array['00000000-0000-0000-0000-00000000b101']::uuid[])), '0');
select public.chk('新しい口座が読める',
  (select account_no from public.payout_account_reveal('00000000-0000-0000-0000-00000000b101')),
  '98765432');

-- =============================================================
-- ⑧ 消す
-- =============================================================
select public.chk('理由が無いと消せない',
  public.payout_account_forget('00000000-0000-0000-0000-00000000b101','  '),
  'error: 消す理由をご記入ください（記録に残ります）');
select public.chk('消せる',
  public.payout_account_forget('00000000-0000-0000-0000-00000000b101','ご本人のお申し出により'), 'ok');
select public.chk('暗号文が消えている',
  (select (account_enc is null)::text from public.payout_accounts
    where user_id='00000000-0000-0000-0000-00000000b101'), 'true');
select public.chk('消した記録が残る',
  (select count(*)::text from public.payout_account_reads
    where target_user='00000000-0000-0000-0000-00000000b101'
      and purpose like 'forget:%'), '1');
select public.chk('二度は消せない',
  public.payout_account_forget('00000000-0000-0000-0000-00000000b101','もう一度'),
  'error: 見つかりません（すでに消えています）');
--  消したあとに振り込もうとしても、何も出てこない
select public.chk('消したあとは取り出せない',
  (select count(*)::text from public.payout_account_for_transfer(
    array['00000000-0000-0000-0000-00000000b101']::uuid[])), '0');
--  ご本人からも消せる
select public.be('00000000-0000-0000-0000-00000000c101');
select public.chk('ご本人も消せる', public.payout_account_forget_mine(), 'ok');
select public.chk('ご本人が消したあとは空',
  (select (account_enc is null)::text from public.payout_accounts
    where user_id='00000000-0000-0000-0000-00000000c101'), 'true');
select public.chk('ご登録が無ければそう言う',
  public.payout_account_forget_mine(), 'error: ご登録がありません');

-- =============================================================
-- ⑨ 運営でない人には見せない
-- =============================================================
select public.be('00000000-0000-0000-0000-00000000b202');
do $$ begin
  begin
    perform public.payout_account_reveal('00000000-0000-0000-0000-00000000b101');
    perform public.chk('運営でないと開けない','開けてしまった','運営のみが確認できます');
  exception when others then
    perform public.chk('運営でないと開けない', sqlerrm, '運営のみが確認できます');
  end;
end $$;
select public.chk('運営でないと確認できない',
  public.payout_account_collect('00000000-0000-0000-0000-00000000b101'),
  'error: 運営のみが操作できます');
select public.chk('運営でないと消せない',
  public.payout_account_forget('00000000-0000-0000-0000-00000000b101','ずる'),
  'error: 運営のみが操作できます');

-- =============================================================
-- ⑩ 控えは読める（自分の口座が合っているか確かめられる）
-- =============================================================
select public.be('00000000-0000-0000-0000-00000000b101');
select public.chk('控えの下4桁',
  (select last4 from public.payout_account_mine()), '5432');
select public.chk('控えに「預かっているか」が出る',
  (select held::text from public.payout_account_mine()), 'false');

-- =============================================================
-- ⑪ 列の権限
-- =============================================================
select public.chk('口座の列はブラウザから読めない',
  (select count(*)::text from information_schema.column_privileges
    where table_schema='public' and table_name='payout_accounts'
      and grantee='authenticated' and privilege_type='SELECT'
      and column_name in ('account_no','holder_kana','bank_code','branch_code','account_enc')), '0');
select public.chk('鍵の表は誰にも渡していない',
  (select count(*)::text from information_schema.table_privileges
    where table_schema='public' and table_name='payout_keys'
      and grantee in ('authenticated','anon')), '0');
select public.chk('鍵の関数もブラウザから呼べない',
  (select has_function_privilege('authenticated','public.payout_key()','execute'))::text, 'false');
select public.chk('関数の数',
  (select count(*)::text from information_schema.routines
    where routine_schema='public' and routine_name like 'payout%'), '13');

-- =============================================================
select count(*) || ' 件中 ' || count(*) filter (where ok) || ' 件 合格、'
       || count(*) filter (where not ok) || ' 件 不合格' as "結果"
  from public.__t;
select n as "落ちた試験", got as "実際", want as "あるべき"
  from public.__t where not ok;
