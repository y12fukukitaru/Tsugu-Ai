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
  ok('うまくいっていないアカウントは色を変える', /var dead=\/つなぎ直し\/\.test\(er\), nocal=\/カレンダーが使えません\/\.test\(er\);/.test(gb));
  ok('切れているアカウントに「つなぎ直す」を出す', /dead\?'<button[^']*googleCalStart\('\+i\+'\)">つなぎ直す/.test(gb));
  ok('全体の見出しも、だめなら赤', /anyBad\?'⚠ うまくつながっていないアカウントがあります'/.test(gb));
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
  ok('取り直しが続いたら止めて知らせる', /if \(\+\+resets > 2\) \{ lnotes\.push\(`\$\{cal\.name\}：取り直しが続いたので止めました`\); break; \}/.test(SYNC));
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
  ok('取り込んだ予定にアカウントを書く', /link_id: link\.id,\s*\n\s*cal_id: cal\.cal_id,\s*\n\s*source: "google"/.test(SYNC));
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
  ok('パートナー：Workspace にカレンダーが無い場合', /そのアカウントにカレンダーの機能が付いていません/.test(MANP));
  ok('継ナビくんの案内も直す', /もう1つのアカウントをつなぐ/.test(SRC) && !/「Googleの予定をこの画面に取り込む」/.test(SRC));
  ok('手順書：SQL は4つ順に', /20260917030000_google_multi_account\.sql/.test(GUIDE) && /pgcrypto_search_path/.test(GUIDE));
  ok('手順書：つまずきの表', /ICS 購読/.test(GUIDE) && /signed up for Google Calendar/.test(GUIDE));
  ok('手順書：Edge Function は画面を出さない', /Edge Function は画面を出しません/.test(GUIDE));
}
// ⑬ 出せない先を、送り先に選ばせない
//    （カレンダーの機能が付いていないアカウントで実際に起きた）
{
  const gb = gbAll();
  //  理由は二つ。直しかたが違うので分けて見る
  ok('二つの理由を分けて見る', /var bad=dead\|\|nocal;/.test(gb));
  //  ここが肝。出せない先には「送り先にする」を出さない
  ok('だめなアカウントに送り先の選択を出さない', /\+\(bad\|\|l\.push_target\|\|!many\?''/.test(gb));
  no('切れているかどうかだけで判断しない', /\+\(dead\|\|l\.push_target\|\|!many\?''/.test(gb));
  ok('だめなアカウントに取り込みの切り替えも出さない', /\+\(bad\?''\s*\n\s*: '<label[\s\S]{0,200}<input type="checkbox"/.test(gb));
  //  つなぎ直しても直らないので、そのボタンは出さない
  ok('カレンダーが無いときは「つなぎ直す」を出さない', /\+\(dead\?'<button[\s\S]{0,160}つなぎ直す<\/button>':''\)/.test(gb));
  ok('何をすればよいかを書く', /Google 管理コンソール（アプリ → Google Workspace → カレンダー）で有効に/.test(gb));
  ok('つなぎ直しても直らないと言い切る', /つなぎ直しても直りません/.test(gb));
  //  すでに送り先になっている先がだめになった場合（切り替えの取りこぼし）
  ok('送り先がだめなら、いちばん先に知らせる', /if\(bad\)\{ anyBad=true; if\(l\.push_target\) tgtBad=true; \}/.test(gb));
  ok('送り先がだめなときの言葉', /いま送り先になっているアカウントは使えません。/.test(gb));
  ok('ほかがあれば乗り換えを促す', /ほかのアカウントの「この画面で入れた予定の送り先にする」を選んでください。/.test(gb));
  //  英語のままでは何をすればよいか分からない。日本語に置き換える
  ok('英語の返事を日本語にする', /signed up for Google Calendar\/i\.test\(n\)/.test(SYNC));
  ok('画面への合図になる言葉を先頭に置く', /"カレンダーが使えません：このGoogleアカウントには、カレンダーの機能が付いていません。"/.test(SYNC));
  ok('なぜその言葉なのかを書き残す', /画面はこの言葉を見て、そのアカウントに「送り先にする」を/.test(SYNC));
  //  説明書
  ok('パートナー：日本語で出ると書く', /カレンダーが使えません/.test(MANP));
  ok('手順書：日本語で出ると書く', /カレンダーが使えません/.test(GUIDE));
}
// ⑭ 他のカレンダー（家族・誕生日・共有・祝日）をカレンダーごとに選んで取り込む
{
  const GC = R('supabase/migrations/20260917040000_google_calendars.sql');
  //  --- SQL ---
  ok('カレンダーの一覧の表', /create table if not exists public\.google_calendars/.test(GC) && /primary key \(link_id, cal_id\)/.test(GC));
  ok('一覧の表は画面から触れない', /revoke all on public\.google_calendars from authenticated, anon, public;/.test(GC));
  ok('札はカレンダーごと', /sync_token text,\s*-- 差分の札。カレンダーごと/.test(GC));
  ok('予定にカレンダーを持たせる', /alter table public\.agenda_events add column if not exists cal_id text;/.test(GC));
  ok('アカウントの札は捨てる', /update public\.google_cal_links set sync_token = null where sync_token is not null;/.test(GC));
  //  合わせるときの約束：オン／オフと札は触らない。メインだけ最初からオン
  ok('はじめて見つけたときはメインだけオン', /coalesce\(x\.is_primary, false\),   -- はじめて見つけたとき：メインだけオン/.test(GC));
  const mg = GC.slice(GC.indexOf('function public.google_cal_list_merge'), GC.indexOf('-- ④'));
  no('合わせるときにオン／オフを上書きしない', /set[\s\S]{0,200}enabled\s*=\s*excluded/.test(mg));
  no('合わせるときに札を上書きしない', /sync_token\s*=\s*excluded/.test(mg));
  ok('無くなったカレンダーは予定ごと消す', /delete from public\.agenda_events e[\s\S]{0,200}not exists[\s\S]{0,120}x\.id = e\.cal_id/.test(mg));
  ok('合わせる関数は画面から呼べない', /revoke all on function public\.google_cal_list_merge\(uuid, jsonb\) from public, anon, authenticated;/.test(GC));
  ok('状態にカレンダーの一覧が付く', /'calendars',    coalesce\(\(/.test(GC) && /order by c\.is_primary desc, c\.name/.test(GC));
  //  切り替え
  ok('切り替えは本人だけ', /function public\.google_cal_set_cal\(p_link uuid, p_cal text, p_on boolean\)/.test(GC) && /grant execute on function public\.google_cal_set_cal\(uuid, text, boolean\) to authenticated;/.test(GC));
  ok('外したらそのカレンダーの予定だけ消す', /and cal_id = p_cal;/.test(GC));
  ok('外したら同じアカウントのほかの札も捨てる（招待で両方に出る予定を戻すため）', /update public\.google_calendars set sync_token = null\s*\n\s*where link_id = p_link and enabled;/.test(GC));
  ok('確かめに一覧の表が読めるかが出る', /as 画面から一覧の表が読めるか/.test(GC));

  //  --- 同期 ---
  ok('一覧を Google から取る', /users\/me\/calendarList\?minAccessRole=reader&showHidden=false/.test(SYNC));
  ok('一覧は SQL で合わせる', /sb\.rpc\("google_cal_list_merge", \{ p_link: link\.id, p_items: items \}\)/.test(SYNC));
  ok('オンのカレンダーだけ取る', /\.eq\("link_id", link\.id\)\.eq\("enabled", true\)/.test(SYNC));
  ok('カレンダーの番号は URL 用に包む', /calendars\/\$\{encodeURIComponent\(cal\.cal_id\)\}\/events/.test(SYNC));
  ok('札はカレンダーごとに進める', /sb\.from\("google_calendars"\)\.update\(\{ sync_token: nextSync \}\)/.test(SYNC));
  ok('札を捨てるのもカレンダーごと', /sb\.from\("google_calendars"\)\.update\(\{ sync_token: null \}\)/.test(SYNC));
  no('アカウントの札はもう使わない', /google_cal_links"\)\.update\(\{ sync_token/.test(SYNC));
  ok('取り込んだ予定にカレンダーを書く', /cal_id: cal\.cal_id,/.test(SYNC));
  ok('どのカレンダーで止まったか分かる', /`\$\{cal\.name\}：取ってこられませんでした/.test(SYNC));
  ok('送り先はメインのまま', /const CAL = "primary";/.test(SYNC));
  //  TsuguAi 自身の予定が戻ってこないように（二重の守り）
  ok('旧来の購読は一覧から外す', /function isSelfFeed/.test(SYNC) && /\.filter\(\(c: any\) => !isSelfFeed\(c\)\)/.test(SYNC));
  ok('旧来の購読の名前で見分ける', /\^TsuguAi 継ナビくん\$/.test(SYNC));
  ok('ICS 経由の予定も取り込まない', /if \(\/@tsugu-ai\$\/\.test\(String\(it\.iCalUID \?\? ""\)\)\) continue;/.test(SYNC));
  ok('色は形を確かめてから使う', /\^#\[0-9a-f\]\{6\}\$\/i\.test\(String\(c\.backgroundColor/.test(SYNC));

  //  --- 画面 ---
  const gb = gbAll();
  ok('取り込むアカウントには一覧を出す', /\+\(l\.pull_private===false\?'':gcalCalsHtml\(l, i\)\)/.test(gb));
  const ch = takeFn('gcalCalsHtml');
  ok('つないだ直後（一覧が空）の言葉', /カレンダーの一覧は、次の同期のあとに並びます。/.test(ch));
  ok('カレンダーごとのチェック', /onchange="googleCalCal\('\+i\+',this\.value,this\.checked\)"/.test(ch));
  ok('カレンダーの番号は属性用に包む', /value="'\+escA\(c\.id\)\+'"/.test(ch));
  ok('色は形を確かめてから使う（画面）', /\^#\[0-9a-f\]\{6\}\$\/i\.test\(String\(c\.color/.test(ch));
  ok('メインに印', /メイン<\/span>/.test(ch));
  const cc = takeFn('googleCalCal');
  ok('切り替えは SQL の関数で', /sb\.rpc\('google_cal_set_cal',\{ p_link:l\.id, p_cal:calId, p_on:!!on \}\)/.test(cc));
  ok('入れたらすぐ同期して見せる', /if\(on\)\{[\s\S]{0,120}googleCalSync\(true\)/.test(cc));
  ok('外したら描き直すだけ', /gcalSayLater\('このカレンダーの予定を外しました。'\)/.test(cc));

  //  --- 説明書 ---
  ok('経営者：他のカレンダーも取り込めると書く', /「家族」「誕生日」「共有されたカレンダー」「日本の祝日」なども取り込めます/.test(MANC));
  ok('パートナー：他のカレンダーも取り込めると書く', /「取り込むカレンダー」/.test(MANP));
  ok('継ナビくんの案内にも', /「取り込むカレンダー」でチェックを入れれば入る/.test(SRC));
  ok('手順書：SQL は5つ', /20260917040000_google_calendars\.sql/.test(GUIDE));
  ok('手順書：他のカレンダーの節', /### 他のカレンダー（家族・誕生日・共有・祝日など）/.test(GUIDE) && /メインだけ最初からオン/.test(GUIDE));
  ok('手順書：旧来の購読は出さないと書く', /旧来の ICS 購読（「TsuguAi 継ナビくん」）は一覧に出しません/.test(GUIDE));
}
// ⑮ 予定タブの操作列は、下へ送っても上に残す
{
  const rc = takeFn('knvRenderCal');
  ok('操作列を包む', /h\+='<div class="cal-stick'\+\(wk\?' week':''\)\+'">';/.test(rc) && /h\+='<\/div>';   \/\/ \.cal-stick/.test(rc));
  //  印を「wk」にすると .wk{min-width} に当たって操作列が広がる（実際になった）
  no('印は .wk と同じ名前にしない', /class="cal-stick'\+\(wk\?' wk':''\)/.test(rc) || /\.cal-stick\.wk\{/.test(SRC));
  //  包みの中に、切り替え・前後・今日・＋予定がぜんぶ入っていること
  const inside = rc.slice(rc.indexOf('<div class="cal-stick'), rc.indexOf('// .cal-stick'));
  ok('切り替えと前後・今日・＋予定が中に入る', /class="vaseg"/.test(inside) && /calMove\(-1\)/.test(inside) && /calToday\(\)/.test(inside) && /calOpenForm\(\)">＋ 予定/.test(inside));
  ok('入力の窓は暦の中に置かない', !/id="cal-form"/.test(rc) && /別の窓（calOpenForm → \.cfm-bg）で開く/.test(rc));
  ok('貼り付けの CSS', /\.cal-stick\{position:sticky;top:-12px;z-index:8;background:var\(--bg\);margin:-12px -12px 6px;/.test(SRC));
  ok('週の目盛りより上に', /z-index は週表示の左の目盛り/.test(SRC));
  //  週表示は曜日の見出しも一緒に貼り付ける
  const wv = takeFn('calWeekVertical');
  ok('曜日の見出しは別の箱で返す', /var head='<div class="wk-head"><div class="wk">';/.test(wv) && /return \{ head:head, body:h \};/.test(wv));
  ok('本体は上の罫線を落とす印を持つ', /var h='<div class="wk-wrap under"><div class="wk">';/.test(wv));
  ok('見出しは操作列の中に入れる', /if\(wk\) h\+=wk\.head;/.test(inside) || /if\(wk\) h\+=wk\.head;/.test(rc));
  ok('週表示のときだけ包みに印を付ける', /'<div class="cal-stick'\+\(wk\?' week':''\)\+'">'/.test(rc));
  ok('見出しは先に作る', /wk=calWeekVertical\(byDay, ws\);/.test(rc) && rc.indexOf('wk=calWeekVertical(byDay, ws);') < rc.indexOf('<div class="cal-stick'));
  ok('横スクロールを本体に合わせる', /wrap\.addEventListener\('scroll', function\(\)\{ whead\.scrollLeft=wrap\.scrollLeft; \}\);/.test(rc));
  ok('見出しの CSS', /\.wk-head\{overflow-x:hidden;border:1px solid var\(--softline\);border-bottom:0;border-radius:10px 10px 0 0;/.test(SRC));
  ok('本体は上の角を落とす', /\.wk-wrap\.under\{border-top:0;border-radius:0 0 10px 10px;\}/.test(SRC));
  ok('週表示では包みの下の余白を消す', /\.cal-stick\.week\{margin-bottom:0;padding-bottom:0;box-shadow:none;\}/.test(SRC));
  //  終日の帯も一緒に貼り付ける。増えても背が高くならないよう 3件まで
  const hd = wv.slice(wv.indexOf("var head='<div class=\"wk-head\">"), wv.indexOf("var h='<div class=\"wk-wrap under\">"));
  ok('終日の帯は見出しの箱の中', /head\+='<div class="wk-row wk-sep"><div class="wk-corner"[^>]*>終日<\/div>';/.test(hd));
  no('終日の帯は本体に残さない', /h\+='<div class="wk-row wk-sep"><div class="wk-corner"[^>]*>終日/.test(wv));
  ok('1日 3件まで', /var AD_MAX=3;/.test(hd) && /ads\.slice\(0, AD_MAX\)/.test(hd));
  ok('超えたぶんは +n の札', /if\(ads\.length>AD_MAX\)\{/.test(hd) && /class="wk-chip wk-more"/.test(hd));
  ok('+n を押すとその日の一覧が開く', /calPick\(\\''\+k0\+'\\'\)">\+'\+\(ads\.length-AD_MAX\)\+'<\/span>'/.test(hd));
  ok('なぜ 3件までかを書き残す', /貼り付けたまま時間の枠が見えなくなる/.test(hd));
  ok('+n の札の CSS', /\.wk-more\{background:var\(--soft\);color:var\(--muted\);border:1px dashed var\(--line\);/.test(SRC));
}
// ⑯ スマホ：予定の入力は別の窓で。触れると拡大して横に揺れる問題も止める
{
  const of = takeFn('calOpenForm'), rc = takeFn('knvRenderCal');
  ok('入力は別の窓（.cfm-bg）', /el\.className='cfm-bg'; el\.id='cal-fm';/.test(of) && /document\.body\.appendChild\(el\);/.test(of));
  ok('開くとき、開きかけの窓と小窓を片付ける', /calCloseForm\(true\);/.test(of) && /calPeekClose\(\);/.test(of));
  ok('外側を押したら閉じる（打ちかけは確かめる）', /if\(ev\.target===el\) calFormDismiss\(\);/.test(of));
  ok('Esc で閉じる', /document\.addEventListener\('keydown', calFormKey\);/.test(of) && /if\(ev\.key==='Escape'\) calFormDismiss\(\);/.test(takeFn('calFormKey')));
  ok('スマホでは勝手に焦点を当てない（板が上がって窓が隠れる）', /!\/Mobi\|Android\|iPhone\|iPad\/i\.test\(navigator\.userAgent\)\) t\.focus/.test(of));
  ok('欄に見出しを付ける', /class="cfm-lbl">予定の名前</.test(of) && /class="cfm-lbl">日時</.test(of));
  const ds = takeFn('calFormDismiss');
  ok('打ちかけがあれば確かめてから閉じる', /confirm\('入力した内容を捨てて閉じます。よろしいですか？'\)/.test(ds));
  const cf = takeFn('calCloseForm');
  ok('閉じるときは窓を消して Esc の見張りも外す', /var e=\$\('cal-fm'\); if\(e && e\.parentNode\) e\.parentNode\.removeChild\(e\);/.test(cf) && /document\.removeEventListener\('keydown', calFormKey\);/.test(cf));
  ok('保存したら窓を閉じる', /calCloseForm\(\); knvAgendaReset\(\);/.test(takeFn('calSave')));
  //  描き直しで開き直さない（打ちかけの文字が消える）
  no('描き直しで開き直さない', /if\(CAL_EDIT!==null\) calOpenForm\(CAL_EDIT, CAL_EDIT_WHEN\);/.test(rc));
  ok('週の空き枠を押したら、その日時で窓を開く', /calOpenForm\('', key\+'T'\+\('0'\+hh\)\.slice\(-2\)\+':00'\);/.test(takeFn('calWkSlot')));
  //  窓は上に寄せ、外側がスクロールする（文字入力の板が出ていても保存まで届く）
  ok('窓は上寄せで外側がスクロール', /\.cfm-bg\{position:fixed;inset:0;[^}]*overflow-y:auto;[^}]*align-items:flex-start;/.test(SRC));
  ok('窓は小窓より上に重なる', /\.cfm-bg\{[^}]*z-index:82;/.test(SRC) && /\.cpk-bg\{[^}]*z-index:80;/.test(SRC));
  ok('なぜ別の窓かを書き残す', /上に貼り付いた操作列と、下から\s*\n\s*上がってくるスマホの文字入力の板に挟まれて/.test(SRC));
  //  iPhone の拡大（16px 未満の欄に触れると起きる）を止める
  ok('スマホでは入力欄をぜんぶ 16px に', /@media\(max-width:760px\)\{\s*\n\s*\.cfm-bg\{[^}]*\}\s*\n\s*\.cfm\{[^}]*\}[\s\S]{0,200}input,select,textarea\{font-size:16px!important;\}/.test(SRC));
  ok('なぜ 16px かを書き残す', /iPhone が画面を拡大し、そのまま横に/.test(SRC));
  //  入力の窓は body 直下に出す。継ナビくんの「外側を押したら閉じる」に
  //  外側と見なされないよう、閉じなくてよい側の一覧に入っていること
  //  （入れ忘れて、「やめる」や ✕ で継ナビくんごと閉じていた）
  ok('入力の窓を押しても継ナビくんは閉じない', /var KNV_KEEP_CLASS=\['cpk-bg','cfm-bg','upd-bar'\];/.test(SRC));
  ok('小窓も同じ扱いのまま', /KNV_KEEP_CLASS=\[[^\]]*'cpk-bg'/.test(SRC));
}
// ⑰ スマホの週表示は7日を幅に収める（横スクロールをなくし、見出しの遅れも消す）
{
  const mob = SRC.slice(SRC.indexOf('@media(max-width:600px){'), SRC.indexOf('/* 継ナビくんの顔チップ'));
  ok('横幅の下限を外す', /\.wk\{min-width:0;\}/.test(mob));
  ok('目盛りの幅を詰める', /\.wk-row\{grid-template-columns:40px repeat\(7,minmax\(0,1fr\)\);\}/.test(mob));
  ok('罫線と今の線も詰めた幅に合わせる', /\.wk-line,\.wk-now\{left:40px;\}/.test(mob));
  ok('曜日の文字を少し小さく', /\.wk-hcell\{font-size:9\.5px;\}/.test(mob));
  ok('なぜ横スクロールをなくすかを書き残す', /指の動きに一拍遅れて見えた/.test(mob));
  //  パソコンの幅では今までどおり（514px の下限）
  ok('広い画面の下限はそのまま', /\n  \.wk\{min-width:514px;\}/.test(SRC));
}
// ⑱ スマホの予定の枠を Google カレンダーと同じ読み方に（色を塗り、題名を折り返す）
{
  const mob = SRC.slice(SRC.indexOf('@media(max-width:600px){'), SRC.indexOf('/* 継ナビくんの顔チップ'));
  const wv = takeFn('calWeekVertical');
  ok('枠を種類の色で塗り、白い字に（明るい色は濃い字）', /\.wk-ev\{background:var\(--fg\)!important;color:var\(--fgtxt,#fff\)!important;/.test(mob));
  ok('題名は折り返す（行数は JS が決める）', /\.wk-ev b\{white-space:normal;word-break:break-all;display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden;/.test(mob));
  ok('枠の中の時刻は出さない（目盛りで分かる）', /\.wk-ev span\{display:none;\}/.test(mob));
  ok('横に3文字入る大きさ（10px・余白 2px）', /\.wk-ev\{[^}]*font-size:10px;line-height:1\.25;padding:2px 2px;/.test(mob) && /横に3文字は入る大きさに/.test(mob));
  ok('終日の札も3文字入る余白', /\.wk-chip\{[^}]*font-size:9\.5px;padding:1px 2px;/.test(mob));
  ok('終日の札も塗る', /\.wk-chip\{background:var\(--fg\)!important;color:var\(--fgtxt,#fff\)!important;/.test(mob));
  ok('塗る色を枠に持たせる（自分の予定は青）', /'--fg:'\+\(kk\?kk\.fg:'#2C5DA8'\)\+';--fgtxt:/.test(wv) && /style="--fg:'\+\(k\?k\.fg:'#2C5DA8'\)\+';--fgtxt:/.test(wv));
  ok('何行まで折り返すかは枠の高さから', /var lines=Math\.max\(1, Math\.floor\(\(hgt-4\)\/12\.5\)\);/.test(wv) && /-webkit-line-clamp:'\+lines\+';/.test(wv));
  //  1時間の高さはスマホで 54px、パソコンは 42px のまま
  ok('1時間の高さは画面の幅で変える', /function wkPx\(\)/.test(SRC) && /matchMedia\('\(max-width:600px\)'\)\.matches\) \? 54 : WK_PX/.test(SRC));
  ok('週表示は wkPx を使う', /var PX=wkPx\(\);/.test(wv) && !/WK_PX/.test(wv));
  ok('空き枠を押したときの時刻も wkPx で', /\/wkPx\(\)\)\)\);/.test(takeFn('calWkSlot')));
  ok('なぜ Google と同じ読み方にするかを書き残す', /淡い色に細い罫線では、狭い枠が格子に溶けて見えない/.test(mob));
}
// ⑲ 横に払って前後の月・週へ
{
  const sw = takeFn('calSwipeBind');
  ok('暦の箱に一度だけ結ぶ', /if\(!box \|\| box\.__swipe\) return;/.test(sw) && /box\.__swipe=1;/.test(sw));
  ok('指の始まりと終わりを見る（passive）', /addEventListener\('touchstart'/.test(sw) && /addEventListener\('touchend'/.test(sw) && (sw.match(/\{ passive:true \}/g)||[]).length===2);
  ok('縦のスクロールと見分ける（横 50px 以上・縦の2倍以上・0.8秒以内）', /Math\.abs\(dx\)<50 \|\| Math\.abs\(dx\)<Math\.abs\(dy\)\*2 \|\| Date\.now\(\)-s\.at>800/.test(sw));
  ok('一覧の表示では何もしない', /if\(calViewGet\(\)==='list'\) return;/.test(sw));
  ok('週の枠が横にはみ出すときは、そちらを優先', /wrap\.scrollWidth>wrap\.clientWidth\+2\) return;/.test(sw));
  ok('左へ払うと次へ、右へ払うと前へ', /calMove\(dx<0\?1:-1\);/.test(sw));
  ok('描き直しのたびに結び直しを試みる（重複はしない）', /calSwipeBind\(\);      \/\/ 横に払って前後へ/.test(takeFn('knvRenderCal')));
  //  動いたことが分かる滑り込み
  ok('‹ › と払いで向きを覚える', /CAL_CUR=d; CAL_PICK=null; CAL_SLIDE=n; knvRenderCal\(\);/.test(takeFn('calMove')));
  const si = takeFn('calSlideIn');
  ok('次へは右から、前へは左から', /el\.classList\.add\(n>0\?'cal-in-r':'cal-in-l'\);/.test(si));
  ok('週の枠か、月の升目に掛ける', /box\.querySelector\('\.wk-wrap'\) \|\| box\.querySelector\('\.cal-grid \+ \.cal-grid'\)/.test(si));
  ok('滑り込みの CSS', /@keyframes calInR\{from\{transform:translateX\(28px\)/.test(SRC) && /\.cal-in-l\{animation:calInL \.22s ease-out;\}/.test(SRC));
}
// ⑳ 色：Google のカレンダーごとの色・課題（ToDo）は橙・＋予定は金
{
  //  Google のカレンダーの色を、種類の色と同じ形に
  const ct = takeFn('calTint');
  ok('Google の色を fg/bg/bd に組み直す', /bg:'rgba\('\+r\+','\+g\+','\+b\+',\.10\)'/.test(ct) && /bd:'rgba\('\+r\+','\+g\+','\+b\+',\.38\)'/.test(ct));
  ok('明るい色には濃い字（白では読めない）', /txt:\(lum>0\.62\?'#0E1B33':'#fff'\)/.test(ct));
  ok('色の元は Google → 種類の順', /return \(x && x\.color && calTint\(x\.color, x\.calName\)\) \|\| \(x && CAL_KINDS\[x\.kind\]\) \|\| null;/.test(takeFn('calKindOf')));
  //  予定に、どのカレンダーかと色を持たせる
  const cf = takeFn('calFetch');
  ok('予定にカレンダーの番号を持たせる', /calId:e\.cal_id\|\|''/.test(cf));
  ok('一覧（google_cal_status）から色と名前を引く', /cmap\[c\.id\]=\{ color:c\.color\|\|'', name:c\.name\|\|'' \};/.test(cf) && /e\.color=c\.color; e\.calName=c\.name;/.test(cf));
  ok('一覧が無いときだけ引く（連携欄と共用）', /if\(!GCAL\)\{ var gs=await sb\.rpc\('google_cal_status'\)/.test(cf));
  //  描く側はぜんぶ calKindOf を通す
  const wv = takeFn('calWeekVertical');
  ok('週の枠', /var kk=calKindOf\(x\);/.test(wv) && /--fgtxt:'\+\(\(kk&&kk\.txt\)\|\|'#fff'\)/.test(wv));
  ok('終日の札', /var k=calKindOf\(x\);\s*\n\s*head\+='<span class="wk-chip"/.test(wv) && /--fgtxt:'\+\(\(k&&k\.txt\)\|\|'#fff'\)/.test(wv));
  ok('月の点', /var k=calKindOf\(x\);\s*\n\s*return '<span class="cal-dot"/.test(takeFn('knvRenderCal')));
  ok('一覧の札', /var own=\(x\.kind==='own'\), k=calKindOf\(x\);/.test(takeFn('calCard')));
  const pk = takeFn('calPeek');
  ok('小窓の札', /var k=calKindOf\(x\), own=\(x\.kind==='own'\);/.test(pk));
  ok('小窓にカレンダー名', /if\(own && x\.calName\) rows\+=row\('カレンダー', x\.calName\+'（Google）'\);/.test(pk));
  ok('スマホの塗りつぶしの字の色は変えられる', /\.wk-ev\{background:var\(--fg\)!important;color:var\(--fgtxt,#fff\)!important;/.test(SRC) && /\.wk-chip\{background:var\(--fg\)!important;color:var\(--fgtxt,#fff\)!important;/.test(SRC));
  //  課題（ToDo）の色は自分の予定の青と分ける
  ok('課題は橙', /task:  \{ label:'課題',   bd:'#EFD3BE', bg:'rgba\(200,104,33,\.08\)',   fg:'#C86821' \},/.test(SRC));
  no('課題と自分の予定が同じ青ではない', /task:  \{[^}]*fg:'#2C5DA8'/.test(SRC));
  //  ＋予定は金
  ok('＋予定は金のボタン', /class="btn2 btn-gold"[^>]*onclick="calOpenForm\(\)">＋ 予定<\/button>/.test(SRC));
  ok('金のボタンの CSS（字は濃紺）', /\.btn2\.btn-gold\{background:var\(--gold\);color:#0E1B33;font-weight:700;/.test(SRC));
}
// ㉑ 色の見分け（凡例）。自分の予定・面談・課題・支払・調達・補助金・週次と
//    Google のカレンダーごとの色。読み込んだ予定にある種類だけ並ぶ
{
  const lg = takeFn('calLegend');
  ok('凡例の関数がある', !!lg);
  ok('自分の予定は青で固定', /<span><i style="background:#2C5DA8;"><\/i>自分の予定<\/span>/.test(lg));
  ok('種類は実際にある分だけ', /if\(x\.kind && CAL_KINDS\[x\.kind\]\) seen\[x\.kind\]=1;/.test(lg) && /if\(seen\[k\]\) out\.push/.test(lg));
  ok('種類の色は CAL_KINDS の fg', /CAL_KINDS\[k\]\.fg\+'/.test(lg) && /esc\(CAL_KINDS\[k\]\.label\)/.test(lg));
  ok('Google のカレンダーは色と名前（重複なし）', /if\(!gcal\[x\.calId\]\)\{ gcal\[x\.calId\]=\{ color:x\.color, name:x\.calName\|\|'Google' \}; gorder\.push\(x\.calId\); \}/.test(lg));
  ok('Google の色は文字を無害化して出す', /background:'\+esc\(gcal\[id\]\.color\)\+'/.test(lg));
  ok('暦の下に並ぶ', /h\+=calLegend\(CAL_ROWS\.rows\);\s*\n\s*h\+='<div style="font-size:11px;color:#94A2B6;line-height:1\.7;margin-top:6px;">'/.test(takeFn('knvRenderCal')));
  ok('凡例の CSS', /\.cal-lg\{display:flex;flex-wrap:wrap;gap:4px 11px;/.test(SRC) && /\.cal-lg i\{width:9px;height:9px;border-radius:50%;/.test(SRC));
  //  実際に動かして確かめる
  const F = new Function('esc', 'CAL_KINDS', lg + '\nreturn calLegend;');
  const CK = { meet:{label:'面談',fg:'#8A6A12'}, task:{label:'課題',fg:'#C86821'}, pay:{label:'支払',fg:'#A9403D'} };
  const e = s => String(s==null?'':s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const legend = F(e, CK);
  const h0 = legend([]);
  ok('予定が無くても自分の予定だけ出る', h0 === '<div class="cal-lg"><span><i style="background:#2C5DA8;"></i>自分の予定</span></div>');
  const h1 = legend([
    { kind:'own' }, { kind:'task' }, { kind:'task' }, { kind:'pay' },
    { kind:'own', calId:'fam', color:'#8e24aa', calName:'家族' }, { kind:'own', calId:'fam', color:'#8e24aa', calName:'家族' },
    { kind:'own', calId:'x"y', color:'#33b679', calName:'<共有>' }
  ]);
  ok('ある種類だけ、CAL_KINDS の順で', h1.indexOf('課題') > 0 && h1.indexOf('支払') > h1.indexOf('課題') && h1.indexOf('面談') < 0);
  ok('Google のカレンダーは一度だけ', (h1.match(/家族/g)||[]).length === 1 && /background:#8e24aa;"><\/i>家族/.test(h1));
  ok('名前と色は無害化', /&lt;共有&gt;/.test(h1) && !/<共有>/.test(h1) && !/x"y/.test(h1));
}
// ㉒ 説明書に今日の更新分（スワイプ・上に残る操作列・別の窓の入力・スマホの週表示・色・Workspace の注意）
{
  const MANA = R('manual-admin.html');
  [['経営者', MANC], ['パートナー', MANP]].forEach(([w, M]) => {
    ok(w + '：横スワイプで前後へ', /横にスワイプ<\/b>すると前の月・次の月/.test(M));
    ok(w + '：操作列・曜日・終日が上に残る', /曜日の見出し・終日の帯<\/b>は、下へ送っても<b>上に貼り付いたまま<\/b>/.test(M));
    ok(w + '：入力は別の窓、✕で継ナビくんは閉じない', /入力の窓だけを閉じ、継ナビくんはそのまま開いています/.test(M));
    ok(w + '：スマホの週表示は7日が幅に収まる', /スマホでも7日が画面の幅に収まり、予定は色で塗られて題名が折り返されます/.test(M));
    ok(w + '：＋予定は金色', /金色の<b>「＋ 予定」<\/b>/.test(M));
    ok(w + '：色の見分け', /暦の下に<b>色の見分け<\/b>/.test(M));
    ok(w + '：Workspace のカレンダー無しの注意', /「カレンダーが使えません」<\/b>と出るときは/.test(M) && /つなぎ直しても直りません/.test(M));
  });
  no('パートナー：古い「入力欄は暦の上」が残っていない', /入力欄は暦の上にあるので/.test(MANP));
  ok('運営：Google 連携と Workspace の注意', /「Googleでつなぐ」で Google カレンダーと双方向/.test(MANA) && /カレンダーが使えません/.test(MANA));
  //  継ナビくんの案内（サポートの受け答え）にも入っている。両ロール分
  const guide = SRC.match(/横に払う\(スワイプ\)と前後の月・週へ。操作列/g) || [];
  is('継ナビくんの案内にスワイプと上に残る操作列（2ロール）', guide.length, 2);
  is('継ナビくんの案内に色と入力の窓（2ロール）', (SRC.match(/色は青=自分の予定・金=面談・橙=課題の期日/g) || []).length, 2);
  is('継ナビくんの案内に Workspace の注意（2ロール）', (SRC.match(/「カレンダーが使えません」と出るときは、そのアカウントにカレンダーの機能が付いていない/g) || []).length, 2);
}
// ⑨ 版
{
  const build = SRC.match(/var APP_BUILD='([^']+)'/)[1];
  is('版が揃う', [build, VER.build], ['20260925-03', '20260925-03']);
}
console.log(bad.length ? JSON.stringify(bad, null, 1) : 'ALL OK', n, 'checks,', bad.length, 'failed');
process.exit(bad.length ? 1 : 0);
