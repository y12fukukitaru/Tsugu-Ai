// =============================================================
// 情報の守り（2026-10-10）の試験
//   ・データベース：20261010000000_security_hardening.sql の中身（実際の挙動は hard_run.sh で 36 件）
//   ・関数：通知・メール・LINE に中身を出さない／契約のリンクは関数で組む／大きすぎる依頼を断る／退会でファイルも消す
//   ・画面：ログアウトで端末から消す・通知の登録を外す／CSP／部品の同梱と照合／中身の出し方の設定
//   ・説明：資料 security.html・3つの説明書・継ナビくんの案内文・資料の一覧
// =============================================================
const fs = require('fs'), crypto = require('crypto');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
let n = 0, bad = [];
function ok(name, cond) { n++; if (!cond) bad.push(name); }
const SRC = R('index.html');

// ① データベース
const SQL = R('supabase/migrations/20261010000000_security_hardening.sql');
ok('SQL：通知の中身（既定は出さない）', /add column if not exists preview_on boolean not null default false/.test(SQL) && /add column if not exists ext_full\s+boolean not null default false/.test(SQL));
ok('SQL：信頼できる道の判定は invoker', /function public\.tsugu_trusted_write\(\)[\s\S]*?security invoker[\s\S]*?current_user not in \('authenticated', 'anon'\)/.test(SQL));
ok('SQL：権限の列のトリガーは invoker', /function public\.profiles_freeze_privileged\(\)[\s\S]*?security invoker/.test(SQL));
ok('SQL：代表だけの列', /array\['role','admin_role','admin_perms','consultant_id'\]/.test(SQL));
ok('SQL：運営だけの列（プラン・ランク）', /array\['plan','plan_from','plan_prev','fde_rank'\]/.test(SQL));
ok('SQL：新規はいつも顧客', /n := jsonb_set\(n, '\{role\}', '"customer"', true\);/.test(SQL));
ok('SQL：メールはログインのメール', /auth\.jwt\(\) ->> 'email'/.test(SQL));
ok('SQL：法人の管理者の for all をやめる', /drop policy if exists "ep_clients manager" on public\.ep_clients/.test(SQL) && /drop policy if exists "ep_members manager" on public\.ep_members/.test(SQL) && /drop policy if exists "ep_grants manager" on public\.ep_grants/.test(SQL));
ok('SQL：割当は稼働中の顧問先と席どうし', /public\.ep_grant_ok\(ep_id, member_id, customer_id\)/.test(SQL));
ok('SQL：顧問先の追加は自法人の担当者の顧客だけ', /m\.user_id = v_cons and m\.status = 'active'/.test(SQL));
ok('SQL：席の追加は外に顧客を持たない人だけ', /c\.consultant_id = v_id and c\.role = 'customer'/.test(SQL));
ok('SQL：添付の判定は席→本人で結ぶ', /join public\.ep_members m on m\.id = g\.member_id and m\.ep_id = g\.ep_id/.test(SQL) && !/where customer_id = \$1 and member_id = \$2/.test(SQL));
ok('SQL：枠はメールの本人だけ', /lower\(coalesce\(o ->> mail_col, ''\)\) = my_email/.test(SQL));
ok('SQL：2名体制の申請は担当の会社だけ・承認は運営', /2名体制の申請は、ご自身が担当している顧客についてだけできます/.test(SQL) && /n := jsonb_set\(n, '\{status\}', '"pending"', true\);/.test(SQL));
ok('SQL：担当替えで前の担当の2名体制を終える', /create trigger profiles_end_stale/.test(SQL) && /a\.main_id is distinct from p\.consultant_id/.test(SQL));
ok('SQL：ログイン前は definer を呼べない（ポリシーで使うものと契約は残す）', /p\.prosecdef/.test(SQL) && /'contract_open', 'contract_agree'/.test(SQL) && /from pg_policies pol/.test(SQL));
ok('SQL：添付の置き場 10MB・HTML/SVG なし', /file_size_limit = 10485760/.test(SQL) && !/'text\/html'/.test(SQL) && !/'image\/svg\+xml'/.test(SQL));
ok('SQL：確かめ', /as "通知の中身"/.test(SQL) && /as "添付の上限"/.test(SQL));
ok('SQL：試験の土台に本番よけ', /ここは本番です/.test(R('scratchpad/hard_stub.sql')));

// ② 関数
const HB = R('supabase/functions/agent-heartbeat/index.ts');
ok('ブリーフ：設定を読む（無ければ出さない）', /select\("preview_on, ext_full"\)/.test(HB) && /let preview = false, extFull = false;/.test(HB));
ok('ブリーフ：メールは中身なしが既定', /const mailBrief = extFull \? brief : safe;/.test(HB) && /html: emailHtml\(mailBrief, kind\)/.test(HB));
ok('ブリーフ：通知', /title: `継ナビくん｜\$\{safe\.title\}`, body: "内容はアプリを開いてご確認ください"/.test(HB));
ok('ブリーフ：LINE', /`✦ \$\{safe\.title\}\\n\\n\$\{safe\.body\}/.test(HB));
ok('ブリーフ：アンケートは問いを送る', /if \(kind === "survey"\) \{ preview = true; extFull = true; \}/.test(HB));
ok('ブリーフ：見出しを無害に', /\$\{String\(brief\.title \|\| ""\)\.replace\(\/&\/g, "&amp;"\)/.test(HB));
const PR = R('supabase/functions/push-reminders/index.ts');
ok('予定・TODO等：中身を隠してから送る', /const plan = maskPlan\(buildPlan\(\{/.test(PR) && /\}\), prefs\);/.test(PR));
const plan = PR.slice(PR.indexOf('// ===== PLAN START'), PR.indexOf('// ===== PLAN END'));
const P = new Function(plan + '\nreturn { maskPlan, SAFE_TEXT };')();
const sample = [{ user_id: 'u1', kind: 'msg', title: '✉️ 株式会社A からメッセージ', body: '売上が3割落ちました' }, { user_id: 'u2', kind: 'event', title: '📅 30分後：銀行と面談', body: '10:00から　○○銀行' }];
const m1 = P.maskPlan(sample, {});
ok('隠す：会社名・文面が消える', m1[0].title === '✉️ 新しいメッセージが届きました' && m1[0].body === '内容はアプリを開いてご確認ください' && m1[1].title === '📅 まもなく予定があります' && !/銀行/.test(JSON.stringify(m1)));
const m2 = P.maskPlan(sample, { u1: { preview_on: true } });
ok('選んだ方だけ中身を出す', m2[0].title === sample[0].title && m2[1].title === '📅 まもなく予定があります');
ok('どの種類にも隠した文', ['event', 'meeting', 'todo', 'morning', 'msg', 'reply', 'ann', 'act', 'share', 'report', 'inq', 'cancel', 'pexit', 'plan'].every((k) => P.SAFE_TEXT[k]));
const CS = R('supabase/functions/contract-send/index.ts');
ok('契約：リンクは関数で組む（画面の url は使わない）', /const url = `\$\{APP_URL\}\?c=\$\{token\}`;/.test(CS) && !/body\.url \?\?/.test(CS));
ok('AI：大きすぎる依頼は断る', /len > 8 \* 1024 \* 1024/.test(R('supabase/functions/ai-proxy/index.ts')));
const DU = R('supabase/functions/admin-delete-user/index.ts');
ok('退会：添付を先に消す・消せなければ止める', /storage\.from\("chat-attach"\)\.list\(targetId/.test(DU) && /アカウントはまだ消していません/.test(DU) && DU.indexOf('chat-attach') < DU.indexOf('sb.auth.admin.deleteUser'));

// ③ 画面
ok('ログアウト：通知の登録を先に外す', /try\{ await Promise\.race\(\[pushForgetDevice\(\), new Promise\(function\(r\)\{ setTimeout\(r, 2000\); \}\)\]\); \}catch\(e\)\{\}\n\s*await sb\.auth\.signOut\(\);/.test(SRC));
ok('ログアウト：端末から消す（見た目の好みだけ残す）', /function signOutWipe\(\)/.test(SRC) && /var WIPE_KEEP=\['tsugu_boot_dark','tsugu_knv_max','tsugu_swipe_hint_v2','tsugu_push_ask_until'\];/.test(SRC) && /sessionStorage\.clear\(\)/.test(SRC) && /caches\.delete\('tsugu-badge'\)/.test(SRC));
ok('ログアウト：表示の設定（tsugu_prefs_）は残す', /WIPE_KEEP\.indexOf\(k\)<0 && !\/\^tsugu_prefs_\/\.test\(k\)/.test(SRC));
ok('ログアウト：通知の登録を外す中身', /sb\.from\('push_subscriptions'\)\.delete\(\)\.eq\('user_id',ME\)\.eq\('subscription->>endpoint', j\.endpoint\)/.test(SRC) && /await sub\.unsubscribe\(\)/.test(SRC));
const csp = (SRC.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/) || [])[1] || '';
ok('CSP：ある', !!csp);
ok('CSP：送れる先は Supabase だけ', /connect-src 'self' https:\/\/yaururnkxjhtiowkpvyu\.supabase\.co wss:\/\/yaururnkxjhtiowkpvyu\.supabase\.co;/.test(csp));
ok('CSP：外部のスクリプトを読まない', /script-src 'self' 'unsafe-inline';/.test(csp) && !/jsdelivr/.test(csp));
ok('CSP：object・base', /object-src 'none'/.test(csp) && /base-uri 'self'/.test(csp));
ok('referrer', /<meta name="referrer" content="strict-origin">/.test(SRC));
ok('外部の配信網から読まない', !/cdn\.jsdelivr\.net/.test(SRC) && !/cdn\.jsdelivr\.net\/npm\/@supabase/.test(R('sozoku.html')));
function sri(f) { return 'sha384-' + crypto.createHash('sha384').update(fs.readFileSync(__dirname + '/../' + f)).digest('base64'); }
const sb = SRC.match(/<script src="(vendor\/supabase-js@[\d.]+\.js)" integrity="([^"]+)"><\/script>/);
ok('同梱：supabase の照合が中身と一致', sb && sri(sb[1]) === sb[2]);
ok('同梱：相続のページも同じもの', R('sozoku.html').indexOf(sb && sb[0]) >= 0);
const xl = SRC.match(/s\.src='(vendor\/xlsx@[^']+)'; s\.integrity='([^']+)';/);
ok('同梱：xlsx の照合が中身と一致', xl && sri(xl[1]) === xl[2]);
const pdf = [...SRC.matchAll(/srcs\.push\(\['(vendor\/[^']+)','([^']+)'\]\)/g)];
ok('同梱：PDF 部品2つの照合が中身と一致', pdf.length === 2 && pdf.every((m) => sri(m[1]) === m[2]));
ok('同梱：PDF 部品に照合を付けて読む', /s\.src=src\[0\]; s\.integrity=src\[1\];/.test(SRC));
ok('同梱：使用許諾', ['supabase-js', 'xlsx', 'html2canvas', 'jspdf'].every((x) => fs.existsSync(__dirname + '/../vendor/' + x + '.LICENSE')));
ok('添付を開く：noopener', /window\.open\(u,'_blank','noopener'\);/.test(SRC));
ok('設定：中身をどこまで出すか', /🔒 中身をどこまで出すか/.test(SRC) && /id="np-pv"/.test(SRC) && /id="np-ex"/.test(SRC) && /preview_on:pv==='on', ext_full:ex==='on'/.test(SRC));
ok('設定：列がまだ無い環境', /\/preview_on\|ext_full\/\.test\(r\.error\.message\|\|''\)/.test(SRC));

// ④ 説明
const SEC = R('security.html');
const titles = [...SEC.matchAll(/<section class="slide[^"]*" data-t="([^"]+)"/g)].map((m) => m[1]);
['5つの約束', '守っている情報', 'データベースの扉', '権限の書き換えを止める', '招いた方・2名体制・法人', '継ナビくんへの相談', '添付ファイル', '通知・メール・LINE', '外部のサービス', '端末での守り', '運営の中での扱い', '退会とデータの削除', '万一のとき', 'さらに固めること', 'よくあるご質問']
  .forEach((t) => ok('資料：' + t, titles.indexOf(t) >= 0));
const secText = titles.length ? SEC.slice(SEC.indexOf('<section')).replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, '') : '';
ok('資料：「絶対」「100%」と言わない', secText.length > 1000 && !/絶対|100%|１００％/.test(secText));
ok('資料：学習に使われない', /AIの学習には使われません/.test(SEC));
ok('資料：プライバシーポリシーへの明記は「これから」', /専門家の確認を経て、利用規約・プライバシーポリシーに明記します/.test(SEC));
ok('資料：一覧に（3つの役割）', /\{ f:'security\.html', i:'🔒', n:'お客様の情報を守る仕組み'[^\n]*who:\{ customer:[^\n]*consultant:[^\n]*admin:/.test(SRC));
ok('説明書：経営者', /data-t="お客様の情報を守る仕組み"/.test(R('manual-customer.html')));
ok('説明書：パートナー（外のAIに貼らない）', /data-t="お客様の情報を守る"/.test(R('manual-partner.html')) && /TsuguAi の外の AI（無料の生成AIなど）/.test(R('manual-partner.html')));
ok('説明書：運営の手順', /data-t="情報の守り（運営の手順）"/.test(R('manual-admin.html')) && /20261010000000_security_hardening\.sql/.test(R('manual-admin.html')));
const gi = SRC.indexOf('function secUsageGuide'), guide = SRC.slice(gi, SRC.indexOf('\n  function ', gi + 30));
ok('継ナビくん：情報の守りを答えられる', /【情報の守り\(聞かれたら事実だけを簡潔に。「絶対」「100%」とは言わない\)】/.test(guide) && /継ナビくんへの相談はご本人だけ\(運営も読めない/.test(guide));
ok('継ナビくん：パートナー・運営向けの補足', /TsuguAiの外のAI\(無料の生成AIなど\)/.test(guide) && /20261010000000_security_hardening\.sql\(確かめがすべて1で完了\)/.test(guide));

if (bad.length) { console.log(bad.join('\n')); console.log(n + ' 件中 ' + bad.length + ' 件 不合格'); process.exit(1); }
console.log(n + ' 件 ぜんぶ通りました');
