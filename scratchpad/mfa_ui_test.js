// =============================================================
// 二段階認証（2026-10-10）の試験：画面の流れ・データベースの守り・説明
//   実際の挙動は scratchpad/pw の mfa.js（ブラウザ）と hard_run.sh（mfa_test.sql 11件）
// =============================================================
const fs = require('fs');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
let n = 0, bad = [];
function ok(name, cond) { n++; if (!cond) bad.push(name); }
const SRC = R('index.html');
ok('運営とパートナーは必須', /var MFA_REQUIRED_ROLES=\['admin','consultant'\];/.test(SRC));
ok('ログインの最初にコードを確かめる（プロフィールを読む前）', /ME=session\.user\.id;\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*if\(await mfaNeedsChallenge\(\)\)\{ showMfa\('challenge'\); return; \}\s*var prof=await getProfile\(session\);/.test(SRC));
ok('アプリに入る前に、必須の方は設定', /async function enterApp\(prof, email\)\{\s*\/\/[^\n]*\n\s*if\(mfaRequiredFor\(prof && prof\.role\) && !\(await mfaHasFactor\(\)\)\)\{ showMfa\('enroll', true\); return; \}/.test(SRC));
ok('aal2 が要るのに aal1 ならコード', /d\.nextLevel==='aal2' && d\.currentLevel!=='aal2'/.test(SRC));
ok('確かめられないときは止めない', /if\(l\.error\) return true;/.test(SRC));
ok('設定：途中でやめた要素を片づけてから作る', /all\[i\]\.status!=='verified'\)\{ try\{ await sb\.auth\.mfa\.unenroll/.test(SRC) && /sb\.auth\.mfa\.enroll\(\{ factorType:'totp'/.test(SRC));
ok('設定：QR・アプリで開く・手で入れる', /alt="設定用のQRコード"/.test(SRC) && /📲 認証アプリで開く/.test(SRC) && /手で入れるとき：/.test(SRC));
ok('設定・コード：challengeAndVerify', (SRC.match(/sb\.auth\.mfa\.challengeAndVerify\(/g) || []).length === 2);
ok('コード：6桁', /autocomplete="one-time-code" maxlength="6"/.test(SRC) && /code\.length!==6/.test(SRC));
ok('必須の方は閉じられない（ログアウトだけ）', /\(MFA_REQ\?out:'<div class="link" onclick="mfaCancel\(\)"/.test(SRC));
ok('ログイン画面に戻るときは隠す', /function showAuth\(\)\{ mfaHide\(\);/.test(SRC));
ok('設定の画面に欄', /<div id="set-mfa"/.test(SRC) && /renderAvatar\(\);\s*mfaSettingsPaint\(\);/.test(SRC));
ok('必須の方は外せない', /運営とパートナーの方は必須のため、外すことはできません。/.test(SRC) && /\(mfaRequiredFor\(role\)\?'':'<button[^\n]*mfaRemove/.test(SRC));
ok('経営者は外せる', /onclick="mfaRemove\(/.test(SRC) && /sb\.auth\.mfa\.unenroll\(\{ factorId:id \}\)/.test(SRC));
ok('継ナビくん：二段階認証を答えられる', /二段階認証=ログインのたびにスマホの認証アプリ/.test(SRC));
const SQL = R('supabase/migrations/20261010010000_mfa_required.sql');
ok('SQL：設定済みなら aal2 だけ', /coalesce\(auth\.jwt\(\) ->> 'aal', 'aal1'\) = 'aal2'/.test(SQL) && /f\.status = 'verified'/.test(SQL));
ok('SQL：すべての表に止める側の決まり', /as restrictive for all to authenticated/.test(SQL) && /c\.relrowsecurity/.test(SQL));
ok('SQL：(select 関数()) にしない（無限の読み返しになる）', !/\(select public\.tsugu_aal_ok\(\)\)/.test(SQL));
ok('SQL：置き場にも', /on storage\.objects as restrictive/.test(SQL));
ok('SQL：スマホをなくしたとき（手順は MFA_RESET.sql）', /MFA_RESET\.sql/.test(SQL));
ok('資料：二段階認証の頁', /data-t="二段階認証"/.test(R('security.html')) && /メールだけでは外しません/.test(R('security.html')));
ok('説明書：経営者（任意）', /🔐 二段階認証（おすすめ）/.test(R('manual-customer.html')));
ok('説明書：パートナー（必須）', /はじめに、二段階認証を設定します（必須）/.test(R('manual-partner.html')));
ok('説明書：運営（SQL とやり直し）', /20261010010000_mfa_required\.sql/.test(R('manual-admin.html')) && /サポート管理の<b>「🔐 二段階認証のやり直し」<\/b>で/.test(R('manual-admin.html')) && !/delete from auth\.mfa_factors where user_id = \(select id/.test(R('manual-admin.html')));
// スマホを替える・なくしたとき
ok('スマホを替える：ボタン', /onclick="showMfa\(\\'enroll\\', false, true\)">📱 スマホを替える<\/button>/.test(SRC));
ok('スマホを替える：新しいスマホで確かめてから前の設定を外す', /if\(MFA_SWITCH\)\{[\s\S]{0,400}\.filter\(function\(f\)\{ return f\.id!==newId; \}\)[\s\S]{0,200}sb\.auth\.mfa\.unenroll\(\{ factorId:olds\[i\]\.id \}\)/.test(SRC));
ok('コードの画面：なくしたときの連絡先・メールだけでは外さない', /メールだけのご依頼では外しません/.test(SRC));
ok('設定：英数字を紙に控える', /紙に書いて、人の目に触れない場所/.test(SRC));
const RESET = R('supabase/migrations/MFA_RESET.sql');
ok('やり直し：本人確認2つ以上', /2つ以上/.test(RESET) && /メールだけのご依頼では外さない/.test(RESET));
ok('やり直し：設定を外し・全端末ログアウト・記録', /delete from auth\.mfa_factors/.test(RESET) && /delete from auth\.sessions/.test(RESET) && /insert into public\.mfa_resets/.test(RESET));
ok('記録の表', /create table if not exists public\.mfa_resets/.test(SQL) && /"mfa resets admin read"/.test(SQL));
['manual-customer.html', 'manual-partner.html'].forEach((f) => ok(f + '：スマホを替える・なくしたとき', /data-t="スマホを替える・なくしたとき"/.test(R(f)) && /📱 スマホを替える/.test(R(f))));
ok('運営：やり直しの手順', /data-t="二段階認証のやり直し（紛失のとき）"/.test(R('manual-admin.html')) && /MFA_RESET\.sql/.test(R('manual-admin.html')));
ok('継ナビくん：機種変更・紛失を答えられる', /機種変更\(前のスマホが手元にある\)は/.test(SRC) && /サポート管理の「🔐 二段階認証のやり直し」/.test(SRC));

// 運営コンソール：やり直しの手順とSQL
ok('サポート管理に欄', /<div id="adm-mfareset"><\/div>/.test(SRC) && /loadAdmDeletions\(\); loadAdmMfaReset\(\);/.test(SRC));
ok('本人確認の印が2つ以上でないと作らない', /if\(cks\.length<2\) return ng\('ご本人の確かめを2つ以上してから作ってください'\);/.test(SRC));
ok('値は引用符をエスケープ', /function sqlq\(v\)\{ return "'"\+String\(v==null\?'':v\)\.replace\(\/'\/g,"''"\)\+"'"; \}/.test(SRC));
ok('作るSQLは MFA_RESET と同じ3つ', /delete from auth\.mfa_factors where user_id in \(select id from target\)/.test(SRC) && /delete from auth\.sessions where user_id in \(select id from target\)/.test(SRC) && /insert into public\.mfa_resets/.test(SRC));
ok('画面は実行しない（SQL Editor を開くだけ）', /var SUPABASE_SQL_URL='https:\/\/supabase\.com\/dashboard\/project\/[a-z]+\/sql\/new';/.test(SRC) && !/sb\.rpc\('mfa_reset/.test(SRC));
ok('記録を一覧', /from\('mfa_resets'\)\.select\('\*'\)\.order\('done_at'/.test(SRC));
const sqlq = new Function("return function sqlq(v){ return \"'\"+String(v==null?'':v).replace(/'/g,\"''\")+\"'\"; }")();
ok('エスケープの中身', sqlq("O'Brien'); drop") === "'O''Brien''); drop'");
ok('説明書：サポート管理から', /サポート管理 →「🔐 二段階認証のやり直し」/.test(R('manual-admin.html')));

if (bad.length) { console.log(bad.join('\n')); console.log(n + ' 件中 ' + bad.length + ' 件 不合格'); process.exit(1); }
console.log(n + ' 件 ぜんぶ通りました');
