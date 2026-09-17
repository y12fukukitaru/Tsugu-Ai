// =============================================================
// Googleカレンダー連携（双方向）の試験
//   ・鍵が画面に降りてこないこと（いちばん大事）
//   ・同じ予定が二つにならない作りになっていること
//   ・面談は Google 側の操作で消えないこと
//   ・つないでいないときは、これまでの ICS が残ること
// =============================================================
const fs = require('fs');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
const SRC = R('index.html');
const SQL = R('supabase/migrations/20260916020000_google_calendar.sql');
const OAUTH = R('supabase/functions/google-oauth/index.ts');
const SYNC = R('supabase/functions/google-sync/index.ts');
const GUIDE = R('docs/google-calendar-setup.md');
const MANC = R('manual-customer.html'), MANP = R('manual-partner.html');
const VER = JSON.parse(R('version.json'));
let n = 0, bad = [];
function is(name, got, want) { n++; const g = JSON.stringify(got), w = JSON.stringify(want); if (g !== w) bad.push({ name, got: g, want: w }); }
function ok(name, cond) { is(name, !!cond, true); }
function no(name, cond) { is(name, !!cond, false); }
function gbAll() { return takeFn('googleCalBox'); }
function takeFn(name) {
  const re = new RegExp('\\n  (?:async )?function ' + name + '\\s*\\(', 'g');
  let m, last = null, cnt = 0;
  while ((m = re.exec(SRC)) !== null) { last = m; cnt++; }
  if (!last) throw new Error('見つかりません: ' + name);
  is('定義は一つだけ: ' + name, cnt, 1);
  const end = SRC.indexOf('\n  }\n', last.index);
  return SRC.slice(last.index, end + 4);
}

// ① 鍵の守り（ここが破れると、他人のカレンダーが読まれます）
{
  ok('つながりの表は画面から触れない', /revoke all on public\.google_cal_links from authenticated, anon, public;/.test(SQL));
  ok('更新用の鍵は暗号化してしまう', /pgp_sym_encrypt\(p_refresh, public\.google_key\(\)\)/.test(SQL));
  ok('鍵は Vault から、無ければ自前の表から', /vault\.create_secret/.test(SQL) && /google_keys/.test(SQL));
  ok('鍵を出す関数は画面から呼べない', /revoke all on function public\.google_refresh_get\(uuid\) from public, anon, authenticated;/.test(SQL));
  ok('しまう関数も画面から呼べない', /revoke all on function public\.google_link_save\(uuid, text, text\) from public, anon, authenticated;/.test(SQL));
  //  画面に返すのは「つながっているか」だけ
  const st = SQL.slice(SQL.indexOf('function public.google_cal_status'), SQL.indexOf('google_cal_set_private'));
  no('状態に鍵は含めない', /refresh_enc'|access_token|sync_token/.test(st.replace('g.refresh_enc is not null', '')));
  ok('返すのは4つだけ', /'linked'/.test(st) && /'email'/.test(st) && /'pull_private'/.test(st) && /'last_sync_at'/.test(st));
  ok('状態は本人のぶんだけ', /g\.user_id = auth\.uid\(\)/.test(st));
}
// ② 同じ予定が二つにならない
{
  ok('Googleの番号で一意', /create unique index if not exists agenda_events_google_uniq/.test(SQL));
  ok('出どころを持つ', /source\s+text not null default 'tsugu'/.test(SQL));
  ok('出どころは2つだけ', /check \(source in \('tsugu','google'\)\)/.test(SQL));
  //  送ったものを取り込み直さない
  ok('送るときに印を付ける', /extendedProperties: \{ private: \{ tsuguai: e\.id \} \}/.test(SYNC));
  ok('印の付いたものは取り込まない', /if \(mark\.tsuguai \|\| mark\.tsuguai_meeting\) continue;/.test(SYNC));
  ok('Googleから来たものは送り返さない', /if \(e\.source === "google"\) continue;/.test(SYNC));
  ok('直していなければ送らない', /if \(e\.google_id && e\.synced_at && new Date\(e\.synced_at\) >= new Date\(e\.updated_at\)\) continue;/.test(SYNC));
  ok('取り込みは番号で上書き', /onConflict: "owner_id,google_id"/.test(SYNC));
}
// ③ 消えかたの約束
{
  //  面談は顧客との約束。カレンダーの操作で消えては困る
  ok('Googleで消えても、消すのは取り込んだぶんだけ', /\.eq\("owner_id", uid\)\.eq\("google_id", it\.id\)\.eq\("source", "google"\)/.test(SYNC));
  ok('面談が消えない理由が書いてある', /顧客との約束なので/.test(SYNC));
  //  解除したときの後始末
  //  「確かめ」は冒頭の説明にも出るので、末尾から数えて切り出す
  const un = SQL.slice(SQL.indexOf('function public.google_cal_unlink'), SQL.lastIndexOf('-- 確かめ'));
  ok('解除で取り込んだ予定を消す', /delete from public\.agenda_events[\s\S]{0,80}source = 'google'/.test(un));
  ok('解除でこちらの予定は残す', /set google_id = null/.test(un));
  ok('解除でつながりを消す', /delete from public\.google_cal_links where user_id = auth\.uid\(\)/.test(un));
}
// ④ 差分の取り方
{
  ok('前回からの差分をもらう札を使う', /syncToken/.test(SYNC) && /nextSyncToken/.test(SYNC));
  ok('札が古くなったら取り直す', /r\.status === 410/.test(SYNC));
  ok('取り直しでも無限に回らない', /if \(\+\+pages > 20\) break;/.test(SYNC) && /\+\+resets > 2/.test(SYNC));
  ok('取り込まない設定を見る', /link\.pull_private !== false/.test(SYNC));
}
// ⑤ 同意のときの札（他人のカレンダーを結び付けられないように）
{
  ok('札に署名する', /HMAC/.test(OAUTH) && /function hmac/.test(OAUTH));
  ok('札は10分で切れる', /600000/.test(OAUTH));
  ok('署名は時間差の出ない比べ方', /diff \|= want\.charCodeAt\(i\) \^ p\[2\]\.charCodeAt\(i\)/.test(OAUTH));
  ok('更新用の鍵をもらう指定', /access_type: "offline"/.test(OAUTH) && /prompt: "consent select_account"/.test(OAUTH));
  ok('求める権限は予定とアカウントだけ', /calendar\.events/.test(OAUTH) && !/auth\/gmail|auth\/drive|contacts/.test(OAUTH));
  //  Verify JWT を切るので、自分で確かめる
  ok('ログインを自分で確かめる（oauth）', /sb\.auth\.getUser\(token\)/.test(OAUTH));
  ok('ログインを自分で確かめる（sync）', /sb\.auth\.getUser\(token\)/.test(SYNC));
  ok('つなぎ直しで鍵が来なくても消さない', /coalesce\(excluded\.refresh_enc, public\.google_cal_links\.refresh_enc\)/.test(SQL));
  ok('デプロイ手順が書いてある', /google-oauth --no-verify-jwt/.test(OAUTH) && /google-sync --no-verify-jwt/.test(SYNC));
}
// ⑥ 画面
{
  const gb = takeFn('googleCalBox');
  ok('つないでいなければ「つなぐ」', /Googleでつなぐ/.test(gb));
  ok('つないでいれば、相手と最後の同期', /つながっています/.test(gb) && /最後の同期/.test(gb));
  ok('私用を取り込むかの切り替え', /googleCalPriv/.test(gb));
  ok('解除の道がある', /googleCalUnlink/.test(gb));
  //  切れているのに緑のままだと、直す必要に気づけない（アカウントごとに見る）
  ok('切れているアカウントは色を変える', /var dead=\/つなぎ直し\/\.test\(String\(l\.last_error\|\|''\)\);/.test(gb));
  ok('切れているアカウントに「つなぎ直す」を出す', /dead\?'<button[^']*googleCalStart\('\+i\+'\)">つなぎ直す/.test(gb));
  ok('全体の見出しも切れていれば赤', /anyDead\?'⚠ つながりが切れているアカウントがあります'/.test(gb));
  //  SQL 未実行のときは、これまでの ICS が残る
  ok('SQL 未実行なら ICS に戻す', /if\(!r \|\| r\.error\)\{ box\.innerHTML=''; GCAL=null; GCAL_LINKS=\[\]; calendarFeedSetup\(\); return; \}/.test(gb));
  ok('つないだら ICS は出さない', /var cf=\$\('calfeed-box'\); if\(cf\) cf\.innerHTML='';/.test(gb));
  const au = takeFn('gcalAuto');
  ok('開いたら黙って同期する', /googleCalSync\(false\)/.test(au));
  ok('同期は5分に一度まで', /300000/.test(au));
  const ul = takeFn('googleCalUnlink');
  ok('解除は確認してから', /confirm\(/.test(ul) && /この画面で作った予定は残ります/.test(ul));
  //  予定がどちらから来たか分かる
  const cf = takeFn('calFetch');
  ok('Google由来かを持つ', /g:\(e\.source==='google'\)/.test(cf));
}
// ⑦ 継ナビくんが予定を入れられること（前からある仕組み。壊していないこと）
{
  const an = takeFn('calAskNote');
  ok('頼まれたときだけ出す', /頼まれていないときは絶対に出さないこと/.test(an));
  ok('登録しましたとは書かせない', /「登録しました」とは書かないこと/.test(an));
  const dc = takeFn('calDraftClean');
  ok('昨日より前・2年より先は受けない', /diff< -1 \|\| diff>730/.test(dc));
  const ds = takeFn('calDraftSave');
  ok('押して初めて入る', /from\('agenda_events'\)\.insert/.test(ds));
  ok('確認のカードが出る', /この予定を登録しますか/.test(takeFn('calDraftCard')));
}
// ⑧ 説明書と手順書
{
  ok('経営者：双方向だと書く', /どちらに入れても両方に出ます/.test(MANC));
  ok('経営者：他の人に見えないと書く', /ご本人だけが見られます/.test(MANC));
  ok('経営者：AIには渡ることも書く', /継ナビくんに「今日の予定は？」と聞くと/.test(MANC));
  ok('パートナー：面談は Google で消えないと書く', /Google側で面談を消しても、TsuguAiの面談は消えません/.test(MANP));
  ok('継ナビくんの案内に双方向', /Googleでつなぐ」でGoogleカレンダーと双方向/.test(SRC));
  ok('継ナビくんの案内に、話しかけて登録する手順', /確認のカードが出て、「登録する」を押すと入る/.test(SRC));
  //  運営がやることの手順書
  ok('手順書に Google Cloud の段取り', /Google Calendar API/.test(GUIDE) && /OAuth 同意画面/.test(GUIDE));
  ok('手順書にリダイレクトURI', /functions\/v1\/google-oauth/.test(GUIDE));
  ok('手順書に Secrets 5つ', ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'GOOGLE_STATE_SECRET', 'APP_URL'].every((k) => GUIDE.indexOf(k) > 0));
  ok('手順書に Verify JWT を切る注意', /Verify JWT は必ず OFF/.test(GUIDE));
  ok('手順書に審査のこと', /審査/.test(GUIDE) && /100名/.test(GUIDE));
  ok('手順書に私用の予定の注意', /私用の予定について/.test(GUIDE));
}
// ⑩ 暗号の棚（pgcrypto）— ここが合わないと、つなぐ手前で必ず止まる
{
  const FIX = R('supabase/migrations/20260917010000_pgcrypto_search_path.sql');
  ok('pgcrypto が無ければ入れる', /create extension pgcrypto/.test(FIX));
  //  名指しにすると、今後足した関数が漏れる
  ok('pgp_sym を使う関数を探して直す', /p\.prosrc like '%pgp_sym%'/.test(FIX));
  ok('中身は触らず search_path だけ足す', /alter function %s set search_path = public, %I/.test(FIX));
  //  数えるだけでは動くか分からない。実際に暗号化してみる
  ok('本当に暗号化できるかを試す関数', /function public\.crypto_ok\(\)/.test(FIX) && /perform pgp_sym_encrypt\('test', public\.google_key\(\)\)/.test(FIX));
  ok('確かめに「暗号化できるか」が出る', /as 暗号化できるか/.test(FIX) && /まだ直っていない関数/.test(FIX));
  ok('crypto_ok は画面から呼べない', /revoke all on function public\.crypto_ok\(\) from public, anon, authenticated;/.test(FIX));
  //  口座のほうも同じ不具合だった（総合振込の手前で止まる）
  ok('口座の関数も同じ書き方だと書いてある', /payout_account_submit/.test(FIX) && /総合振込ファイルを作る手前/.test(FIX));
  //  戻りの画面が文字として出てしまった件 → 画面は出さず、TsuguAi へ戻す
  no('HTML の画面はもう出さない', /<!doctype html>/.test(OAUTH));
  ok('結果は URL に添えて戻す', /u\.searchParams\.set\("gcal", ok \? "ok" : "err"\);/.test(OAUTH) && /status: 302/.test(OAUTH));
  ok('だめだった理由も添える', /if \(!ok\) u\.searchParams\.set\("m", msg\);/.test(OAUTH));
  ok('なぜ画面を出さないかを書き残す', /文字のまま\*\*表示されます/.test(OAUTH));
}
// ⑪ 取り込みのループ（do…while の continue で取り直せていなかった）
{
  const RE = R('supabase/migrations/20260917020000_google_relink_reset.sql');
  //  do…while の continue は条件式に飛ぶ。ここは自前で終わらせる
  no('取り込みに do…while は使わない', /do \{[\s\S]{0,400}\} while \(pageToken/.test(SYNC));
  ok('終わり方を自分で書く', /while \(true\) \{/.test(SYNC) && /if \(!pageToken\) break;/.test(SYNC));
  ok('ページと取り直しは別々に数える', /let pages = 0;/.test(SYNC) && /let resets = 0;/.test(SYNC));
  ok('取り直しが続いたら止めて知らせる', /if \(\+\+resets > 2\) \{ lnotes\.push\("取り直しが続いたので止めました"\); break; \}/.test(SYNC));
  ok('なぜ do…while が駄目かを書き残す', /条件式に飛ぶので/.test(SYNC));
  //  そもそも古い札を残さない（入口で正しくする）
  ok('相手が変わったら札を捨てる', /sync_token   = case/.test(RE) && /then null/.test(RE));
  ok('相手が変わったら短い鍵も捨てる', /access_token = case/.test(RE));
  ok('相手が変わったら前の取り込みも消す', /delete from public\.agenda_events[\s\S]{0,60}source = 'google'/.test(RE));
  ok('いま残っている札を一度捨てる', /update public\.google_cal_links[\s\S]{0,80}set sync_token = null/.test(RE));
  ok('pgcrypto の棚を見る', /set search_path = public, extensions/.test(RE));
  ok('確かめに札の残りが出る', /as 札が残っている行/.test(RE));
}
// ⑫ 自動で戻る・複数アカウント
{
  const MA = R('supabase/migrations/20260917030000_google_multi_account.sql');
  //  --- 自動で戻る ---
  const st = takeFn('googleCalStart');
  ok('同じ窓で Google へ行く（別の窓にしない）', /location\.href=j\.url;/.test(st) && !/window\.open\(/.test(st));
  ok('つなぎ直しはアカウントを先に伝える', /&hint='\+encodeURIComponent\(hint\)/.test(st) && /p\.set\("login_hint", hint\)/.test(OAUTH));
  const rt = takeFn('gcalReturn');
  ok('戻りの URL を読む', /\/\[\?&\]gcal=\(ok\|err\)\//.test(rt));
  ok('読んだら URL から外す', /history\.replaceState/.test(rt));
  ok('予定タブへ連れて行く', /knvToggle\(true\); knvShowTab\('cal'\);/.test(rt));
  ok('ログイン直後に読む', /gcalReturn\(\);   \/\/ Google の画面から戻ってきたなら/.test(takeFn('knvInit')));
  const rs = takeFn('gcalReturnSay');
  ok('戻ったら声を出して同期する', /googleCalSync\(true\)/.test(rs));
  ok('だめだった理由を赤で出す', /gcalMsg\(rr\.msg\|\|'つなげませんでした。もう一度お試しください。', true\)/.test(rs));
  //  同期のあとの描き直しで言葉が消えないよう、預けてから出す
  const sy = takeFn('googleCalSync');
  ok('同期の結果は預けてから出す', /gcalSayLater\(/.test(sy) && !/gcalMsg\(bad\?/.test(sy));
  ok('描き直しのあとで預けた言葉を出す', /gcalSaid\(\);/.test(gbAll()));
  ok('入れ損ねと切れたアカウントは成功の顔をさせない', /if\(j\.relink\) bad=/.test(sy) && /j\.notes\.join/.test(sy));

  //  --- 複数アカウント（SQL）---
  ok('主キーを id に付け替える', /drop constraint google_cal_links_pkey/.test(MA) && /add primary key \(id\)/.test(MA));
  ok('同じアカウントは二度つながない', /google_cal_links_user_email_uniq[\s\S]{0,80}\(user_id, google_email\)/.test(MA));
  ok('送り先は1人に一つだけ', /google_cal_links_target_uniq[\s\S]{0,80}\(user_id\) where push_target/.test(MA));
  ok('予定にアカウントを持たせる', /add column if not exists link_id uuid/.test(MA) && /on delete set null/.test(MA));
  ok('前回の手直し（条件なしの索引）を残す', /drop index if exists public\.agenda_events_google_uniq;[\s\S]{0,120}on public\.agenda_events \(owner_id, google_id\);/.test(MA));
  no('索引に条件を付けない', /\(owner_id, google_id\) where/.test(MA));
  ok('前回の手直し（札を捨てる）を残す', /update public\.google_cal_links set sync_token = null where sync_token is not null;/.test(MA));
  ok('保存は行の番号を返す', /returns uuid/.test(MA) && /returning id into v_id/.test(MA));
  ok('はじめてのアカウントが送り先になる', /not v_has_target/.test(MA));
  ok('取り出しはつながりの番号で', /google_refresh_get\(p_link uuid\)/.test(MA));
  ok('新しい関数も pgcrypto の棚を見る', (MA.match(/set search_path = public, extensions/g) || []).length >= 2);
  ok('状態はアカウントの一覧で返す', /'links', coalesce\(\(/.test(MA) && /'push_target',  g\.push_target/.test(MA));
  const stt = MA.slice(MA.indexOf('function public.google_cal_status'), MA.indexOf('google_cal_set_private'));
  no('一覧に鍵は含めない', /refresh_enc'|access_token|sync_token/.test(stt.replace(/g\.refresh_enc is not null/g, '')));
  ok('取り込むかはアカウントごと', /google_cal_set_private\(p_link uuid, p_on boolean\)/.test(MA));
  ok('古い形の関数は消す', /drop function if exists public\.google_cal_set_private\(boolean\);/.test(MA) && /drop function if exists public\.google_cal_unlink\(\);/.test(MA));
  ok('送り先の切り替えは先に外してから付ける', /set push_target = false[\s\S]{0,120}set push_target = true/.test(MA));
  ok('解除はそのアカウントのぶんだけ消す', /source = 'google'\s*\n\s*and \(link_id = p_link or link_id is null\)/.test(MA));
  ok('解除で送り先が無くなれば引き継ぐ', /order by created_at limit 1/.test(MA));
  ok('画面から呼べるのは本人用の4つ', ['google_cal_status()', 'google_cal_set_private(uuid, boolean)', 'google_cal_set_target(uuid)', 'google_cal_unlink(uuid)']
    .every((f) => MA.indexOf('grant execute on function public.' + f + ' to authenticated;') > 0));
  ok('確かめに送り先の重なりが出る', /as 送り先が二つある人/.test(MA));

  //  --- 複数アカウント（同期）---
  ok('つないだ全部を回す', /for \(const link of live\) \{/.test(SYNC));
  ok('送り先は一つ（預かっている予定はそのまま）', /const here = e\.link_id \? e\.link_id === link\.id : !!link\.push_target;/.test(SYNC));
  ok('面談は送り先にだけ', /if \(link\.push_target && nameOf\.size\) \{/.test(SYNC));
  ok('取り込んだ予定にアカウントを書く', /link_id: link\.id,\s*\n\s*source: "google"/.test(SYNC));
  ok('入れ損ねたら札を進めない', /if \(nextSync && !pullBad\) \{/.test(SYNC));
  ok('入れ損ねを黙って落とさない', /入れられませんでした：\$\{row\.title\}/.test(SYNC));
  ok('切れたアカウントは飛ばして知らせる', /if \(!access\) \{ relink = true; continue; \}/.test(SYNC));
  ok('鍵の取り直しはつながりの番号で', /google_refresh_get", \{ p_link: link\.id \}/.test(SYNC));
  ok('oauth も番号で短い鍵を入れる', /\.eq\("id", linkId\)/.test(OAUTH));

  //  --- 複数アカウント（画面）---
  const gb = gbAll();
  ok('もう1つつなぐ道がある', /もう1つのアカウントをつなぐ/.test(gb));
  ok('送り先は選べる（2つ以上のとき）', /googleCalTarget\('\+i\+'\)/.test(gb) && /この画面の予定の送り先/.test(gb));
  ok('取り込みはアカウントごと', /googleCalPriv\('\+i\+',this\.checked\)/.test(gb));
  ok('解除はアカウントごと', /googleCalUnlink\('\+i\+'\)/.test(gb) && /p_link:l\.id/.test(takeFn('googleCalUnlink')));
  ok('二つ以上のときは決まりを添える', /「送り先」のアカウントにだけ出ます/.test(gb));

  //  --- 説明書 ---
  ok('経営者：自動で戻ると書く', /自動でこの画面に戻り、そのまま同期が始まります/.test(MANC));
  ok('経営者：複数アカウントの決まり', /「送り先」に選んだ1つのアカウントにだけ/.test(MANC));
  ok('パートナー：Workspace にカレンダーが無い場合', /The user must be signed up for Google Calendar/.test(MANP));
  ok('継ナビくんの案内も直す', /もう1つのアカウントをつなぐ/.test(SRC) && !/「Googleの予定をこの画面に取り込む」/.test(SRC));
  ok('手順書：SQL は4つ順に', /20260917030000_google_multi_account\.sql/.test(GUIDE) && /pgcrypto_search_path/.test(GUIDE));
  ok('手順書：つまずきの表', /ICS 購読/.test(GUIDE) && /signed up for Google Calendar/.test(GUIDE));
  ok('手順書：Edge Function は画面を出さない', /Edge Function は画面を出しません/.test(GUIDE));
}
// ⑨ 版
{
  const build = SRC.match(/var APP_BUILD='([^']+)'/)[1];
  is('版が揃う', [build, VER.build], ['20260917-01', '20260917-01']);
}
console.log(bad.length ? JSON.stringify(bad, null, 1) : 'ALL OK', n, 'checks,', bad.length, 'failed');
process.exit(bad.length ? 1 : 0);
