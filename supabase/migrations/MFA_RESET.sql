-- =============================================================
-- 【運営の代表だけ】スマホをなくした・壊れた方の二段階認証をやり直す
-- ---------------------------------------------------------------
--  これは毎回使う「手順のひな形」です。マイグレーションではありません。
--  先に 20261010010000_mfa_required.sql を流しておくこと（記録の表を作るため）。
--
--  ■ 実行する前に、必ずご本人であることを確かめる（メールだけのご依頼では外さない）
--    メールの受信箱ごと乗っ取られている場合があるため、次のうち2つ以上で確かめます。
--      ① ビデオ通話で、お顔と身分証（運転免許証など）を見る
--      ② 契約・登録の情報で、運営が控えている電話番号へ運営から折り返す
--      ③ ご本人しか知らないこと（担当パートナーの名前・ご契約の月・会社の所在地など）を聞く
--    経営者の方は、担当パートナーからの依頼を受けて、運営が上の確かめを行います。
--
--  ■ この SQL がすること
--    ・その方の二段階認証の設定を外す（次のログインで、新しいスマホで設定し直せる）
--    ・その方のすべての端末からログアウトさせる（なくしたスマホに残ったログインも切る）
--    ・mfa_resets に記録を残す
--
--  ■ 使いかた
--    下の3か所（メール・理由・確かめかた）を書き換えて、SQL Editor で Run。
--    結果に1行出れば完了。0行なら、メールが登録と違います。
--
--  ■ 終わったら、ご本人に伝えること
--    ・パスワードも変えてください（なくしたスマホにパスワードが残っていた場合に備えて）
--    ・次のログインで「二段階認証を設定します」の画面が出るので、新しいスマホで設定してください
--      （運営・パートナーは必須なので、自動で出ます。経営者は 設定 → 🔐 二段階認証 から）
-- =============================================================

with target as (
  select id, email from auth.users
   where lower(email) = lower('ここにその方のメール')                -- ← ① 書き換える
),
removed_factors as (
  delete from auth.mfa_factors where user_id in (select id from target) returning 1
),
removed_sessions as (
  delete from auth.sessions where user_id in (select id from target) returning 1
)
insert into public.mfa_resets (user_id, email, reason, verified_how, factors_removed, sessions_removed)
select t.id, t.email,
       '紛失',                                                         -- ← ② 紛失／故障／盗難 など
       'ビデオ通話で身分証を確認・登録の電話へ折り返し',               -- ← ③ 本人の確かめかた
       (select count(*) from removed_factors),
       (select count(*) from removed_sessions)
  from target t
returning email, reason, verified_how, factors_removed as "外した設定", sessions_removed as "切ったログイン", done_at;
