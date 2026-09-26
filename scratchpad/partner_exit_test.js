// =============================================================
// パートナーの契約の終了（2026-09-27）
//   ① SQL：お申し出の表・停止中の列・停止の止め・まとめて引き継ぎ（代表のみ）
//   ② パートナー：「お支払い」のいちばん下から申し出る・取り下げる・停止中の帯・送信の止め
//   ③ 運営：サポート管理の一覧・停止/再開・引き継ぎ・継ナビくんの件数・毎朝のメール
//   ④ 説明書・継ナビくんの知識
// =============================================================
const fs = require('fs');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
const SRC = R('index.html');
const SQL = R('supabase/migrations/20260927000000_partner_exit.sql');
const HB = R('supabase/functions/agent-heartbeat/index.ts');
const MANP = R('manual-partner.html'), MANA = R('manual-admin.html'), MANE = R('manual-ep.html');
let n = 0, bad = [];
function ok(name, c) { n++; if (!c) bad.push(name); }
function takeFn(name) {
  const re = new RegExp('\\n  (?:async )?function ' + name + '\\s*\\(', 'g');
  let m, last = null, cnt = 0;
  while ((m = re.exec(SRC)) !== null) { last = m; cnt++; }
  if (!last) throw new Error('見つかりません: ' + name);
  ok('定義は一つだけ: ' + name, cnt === 1);
  return SRC.slice(last.index, SRC.indexOf('\n  }\n', last.index) + 4);
}

// ① SQL
ok('SQL：お申し出の表', /create table if not exists public\.partner_exit_requests/.test(SQL) && /check \(status in \('open','done','withdrawn'\)\)/.test(SQL));
ok('SQL：受付中は一人一つ', /partner_exit_requests_open_uniq\s+on public\.partner_exit_requests \(partner_id\) where status = 'open'/.test(SQL));
ok('SQL：出せるのはパートナー本人だけ（受付中として）', /with check \(partner_id = auth\.uid\(\) and status = 'open'\s+and exists \(select 1 from public\.profiles p\s+where p\.id = auth\.uid\(\) and p\.role = 'consultant'\)\)/.test(SQL));
ok('SQL：本人ができるのは取り下げだけ', /using \(partner_id = auth\.uid\(\) and status = 'open'\)\s+with check \(partner_id = auth\.uid\(\) and status = 'withdrawn'\)/.test(SQL));
ok('SQL：運営はすべて', /create policy "partner_exit admin all"[\s\S]*?using \(public\.ep_is_admin\(\)\)/.test(SQL));
ok('SQL：停止中の列', /add column if not exists partner_status text not null default 'active'/.test(SQL) && /check \(partner_status in \('active','suspended'\)\)/.test(SQL));
ok('SQL：本人は停止を変えられない（元に戻す）', /if tg_op = 'UPDATE' then new\.partner_status := old\.partner_status;/.test(SQL) && /ok := coalesce\(public\.ep_is_admin\(\), false\);/.test(SQL));
ok('SQL：停止中は招待・顧問契約を作れない', /customer_invites_suspend_block before insert on public\.customer_invites/.test(SQL) && /contract_offers_suspend_block before insert on public\.contract_offers/.test(SQL) && /raise exception 'partner_suspended:/.test(SQL));
ok('SQL：停止中は登録済みの顧客を担当にできない（claim_client）', /if me_role = 'consultant' and public\.partner_is_suspended\(me\) then\s+return 'error: ただいま停止中のため、新しい顧客を担当にできません';/.test(SQL));
ok('SQL：claim_client の横取り防止は元のまま', /すでにほかのパートナーが担当しています/.test(SQL) && /該当する顧客アカウントが見つかりません/.test(SQL));
ok('SQL：引き継ぎは代表だけ', /if auth\.uid\(\) is null or not coalesce\(public\.is_owner\(\), false\) then\s+return json_build_object\('ok', false, 'error', '担当の付け替えは代表だけができます'\);/.test(SQL));
ok('SQL：停止中の方へは引き継がない', /if public\.partner_is_suspended\(p_to\) then/.test(SQL));
ok('SQL：担当顧客・2名体制・招待・同意待ちの顧問契約をまとめて', /update public\.profiles set consultant_id = p_to\s+where consultant_id = p_from and role = 'customer'/.test(SQL)
  && /set status = 'ended', decided_at = now\(\)/.test(SQL) && /update public\.customer_invites set consultant_id = p_to/.test(SQL)
  && /update public\.contract_offers set consultant_id = p_to\s+where kind = 'customer' and status = 'sent'/.test(SQL));
ok('SQL：何度流しても同じ・Edge Function の案内', /何度流しても同じ結果になります/.test(SQL) && /drop policy if exists "partner_exit admin all"/.test(SQL) && /agent-heartbeat を更新したときから届きます/.test(SQL));

// ② パートナー
ok('お支払いのいちばん下に「ご契約の終了について」', /\+'<div id="my-pexit"><\/div>'\n        \+'<\/div>'\n        \+'<div class="panel" id="sec-support">/.test(SRC));
ok('読み込み', /poInitDefaults\(\); loadMyPexit\(\);/.test(SRC));
const lp = takeFn('loadMyPexit');
ok('運営の見え方では出さない', /if\(window\.__role!=='consultant'\)\{ box\.innerHTML=''; return; \}/.test(lp));
ok('表が無くても申し出る先は出す', /「運営への問い合わせ」からお知らせください/.test(lp));
ok('受付中は「承りました」と取り下げ', /契約の終了のお申し出を承りました/.test(lp) && /onclick="pexitWithdraw\(\)">取り下げる/.test(lp));
ok('押してすぐ使えなくならないと言う', /押してすぐに使えなくなることはありません/.test(lp));
ok('法人所属の方への案内（EP-I は席を外すだけ）', /席を外す<\/b>だけで済みます/.test(lp) && /EP-II の所属の方は、ご本人の契約なので/.test(lp));
const po = takeFn('pexitOpen');
ok('希望の終了は翌月〜6か月先の月末か「相談」', /for\(var i=1;i<=6;i\+\+\)/.test(po) && /運営と相談して決める/.test(po));
ok('理由と伝えたいことは任意', /理由をお聞かせください（任意）/.test(po) && /お伝えしておきたいこと（任意）/.test(po));
const ps = takeFn('pexitSend');
ok('送る中身', /insert\(\{ partner_id:ME, end_month:month, reason:reason, note:note \}\)/.test(ps) && /すでにお申し出を承っています/.test(ps));
ok('取り下げは withdrawn に', /update\(\{ status:'withdrawn' \}\)\.eq\('id',MYPEXIT\.id\)/.test(takeFn('pexitWithdraw')));
ok('停止中の帯（ダッシュボード）', /\+pexitSuspendedHtml\(prof\)/.test(SRC) && /ただいま停止中です/.test(takeFn('pexitSuspendedHtml')));
ok('停止中は招待・担当追加・顧問契約を押す前に止める', /if\(partnerSuspended\(\)\)\{ msg\.style\.color='#A9403D'; msg\.textContent=PEXIT_SUSPENDED_MSG; return; \}/.test(takeFn('inviteClient'))
  && /if\(partnerSuspended\(\)\)/.test(takeFn('claimClient')) && /if\(kind==='customer' && partnerSuspended\(\)\) return say\(PEXIT_SUSPENDED_MSG\);/.test(takeFn('ctSend'))
  && /if\(\/partner_suspended\/\.test\(m\)\) return say\(PEXIT_SUSPENDED_MSG\);/.test(takeFn('ctSend')));
ok('運営の見え方では止めない', /return p\.role==='consultant' && p\.partner_status==='suspended';/.test(takeFn('partnerSuspended')));

// ③ 運営
ok('サポート管理に一覧', /\+'<div id="adm-cancels"><\/div>'\n        \+'<div id="adm-pexits"><\/div>'/.test(SRC) && /loadAdmCancels\(\); loadAdmPexits\(\);/.test(SRC));
const la = takeFn('loadAdmPexits');
ok('一覧：手順・希望の終了・担当の社数・停止中', /① お話をうかがう/.test(la) && /pexitMonthLabel\(x\.end_month\)/.test(la) && /担当 '\+nc\+'社/.test(la) && /停止中/.test(la));
ok('停止中にする／再開する', /partner_status:st/.test(takeFn('admPartnerStatus')) && /停止中にする/.test(takeFn('admPartnerActions')) && /再開する/.test(takeFn('admPartnerActions')));
ok('停止できたかを確かめる（RLS で黙って弾かれても気づく）', /if\(got!==st\)/.test(takeFn('admPartnerStatus')));
ok('引き継ぎは代表だけに出す', /if\(ADMIN_ROLE!=='owner'\)/.test(takeFn('admHandoverOpen')));
ok('引き継ぎ先に停止中と本人は出さない', /p\.id!==pid && p\.partner_status!=='suspended'/.test(takeFn('admHandoverOpen')));
ok('引き継ぎは partner_handover', /sb\.rpc\('partner_handover',\{ p_from:pid, p_to:to \}\)/.test(takeFn('admHandoverRun')));
ok('対応済みにする', /update\(\{ status:'done', handled_at:new Date\(\)\.toISOString\(\), handled_by:ME \}\)/.test(takeFn('admPexitDone')));
ok('パートナー一覧にも停止中の札と操作', /u\.partner_status==='suspended'\?'<span class="tag gold">停止中<\/span>'/.test(SRC) && /admPartnerActions\(u\.id, u\.partner_status, 'fde-'\+u\.id\)/.test(SRC));
ok('顧客の担当セレクタ：停止中の方は選べない', /\(f\.sus&&u\.consultant_id!==f\.id\?' disabled':''\)/.test(SRC) && /\(f\.sus\?'（停止中）':''\)/.test(SRC));
const kb = takeFn('knvAdminBadge');
ok('継ナビくんの件数に数える', /from\('partner_exit_requests'\)\.select\('id'\)\.eq\('status','open'\)/.test(kb) && /window\.__KNV_BELL=todo\+cx\+px\+ov;/.test(kb));
ok('継ナビくん：内訳とサポートタブ', /⚠ パートナーの契約の終了 <b>'\+px\+'<\/b>件/.test(SRC) && /⚠ パートナーから契約の終了のお申し出が '\+pxn\+'件/.test(SRC));
ok('毎朝のメール（agent-heartbeat）', /const pexits = await adminPartnerExitAlerts\(sb\);/.test(HB) && /kind: "partner_exit_alert"/.test(HB) && /\.from\("partner_exit_requests"\)/.test(HB) && /partner_exit_alerts: pexits/.test(HB));

// ④ 説明書・知識
ok('パートナーの説明書：新しい頁', /data-t="ご自身の契約を終えるとき"/.test(MANP) && /契約を終えたい（TsuguAiをやめたい）/.test(MANP) && /<b>ログイン・カルテの閲覧・報酬明細はそのまま<\/b>/.test(MANP));
ok('パートナーの説明書：古い「画面から終える操作はありません」は無い', !/ご自身の契約を画面から終える操作はありません/.test(MANP));
ok('運営の説明書：新しい頁', /data-t="パートナーの契約の終了"/.test(MANA) && /「担当顧問先を引き継ぐ…」（代表のみ）/.test(MANA) && /専門家の確認を経てから/.test(MANA));
ok('EPの説明書', /EP-I の担当者の方は席を外すだけで済みます/.test(MANE));
ok('継ナビくん：パートナー', /いちばん下に「ご契約の終了について」=ご自身がTsuguAiの契約を終えたいときは「契約の終了を申し出る」/.test(SRC));
ok('継ナビくん：運営', /パートナーが契約を終えたい→本人が「お支払い」のいちばん下から申し出ると/.test(SRC));

if (bad.length) { bad.forEach(b => console.log('NG', b)); console.log(n + ' checks, ' + bad.length + ' failed'); process.exit(1); }
console.log('ALL OK ' + n + ' checks, 0 failed');
